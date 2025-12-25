import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Device } from 'react-native-ble-plx';

import { meshtasticService } from '../services/MeshtasticService';
import type { NodeInfo, Message, ActiveTab } from '../types';
import { DeviceStatusEnum } from '../types';
import {
  FRIENDS_STORAGE_KEY,
  MESSAGES_STORAGE_KEY,
  MAX_STORED_MESSAGES,
} from '../constants/meshtastic';

interface DeviceDetailScreenProps {
  device: Device;
  onBack: () => void;
}

export default function DeviceDetailScreen({
  device,
  onBack,
}: DeviceDetailScreenProps) {
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatusEnum>(
    DeviceStatusEnum.DeviceDisconnected
  );
  const [myNodeNum, setMyNodeNum] = useState<number | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [friendIds, setFriendIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('people');
  const [messages, setMessages] = useState<Message[]>([]);
  const [openChatWith, setOpenChatWith] = useState<number | null>(null);
  const [messageText, setMessageText] = useState('');

  const scrollViewRef = useRef<ScrollView>(null);

  // Filter friends and nearby (excluding self)
  const friends = useMemo(() =>
    nodes.filter(n => friendIds.has(n.nodeNum) && !isMyNode(n)),
    [nodes, friendIds, myNodeNum]
  );

  const nearby = useMemo(() =>
    nodes.filter(n => !friendIds.has(n.nodeNum) && !isMyNode(n)),
    [nodes, friendIds, myNodeNum]
  );

  // Messages for current chat
  const chatMessages = useMemo(() => {
    if (!openChatWith) return [];
    return messages
      .filter(m =>
        (m.from === openChatWith && m.to === myNodeNum) ||
        (m.from === myNodeNum && m.to === openChatWith)
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [messages, openChatWith, myNodeNum]);

  // Chat list (unique conversations)
  const chatList = useMemo(() => {
    const chats = new Map<number, { nodeNum: number; lastMessage: Message }>();

    messages.forEach(msg => {
      const otherNode = msg.isOutgoing ? msg.to : msg.from;
      if (otherNode === myNodeNum) return;

      const existing = chats.get(otherNode);
      if (!existing || msg.timestamp > existing.lastMessage.timestamp) {
        chats.set(otherNode, { nodeNum: otherNode, lastMessage: msg });
      }
    });

    return Array.from(chats.values()).sort(
      (a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp
    );
  }, [messages, myNodeNum]);

  // Load data from storage
  useEffect(() => {
    loadFriends();
    loadMessages();
  }, []);

  // Connect to device and subscribe to events
  useEffect(() => {
    // Subscribe to typed events from MeshtasticService
    const unsubStatus = meshtasticService.onDeviceStatus.subscribe(setDeviceStatus);

    const unsubMyInfo = meshtasticService.onMyNodeInfo.subscribe((info) => {
      setMyNodeNum(info.myNodeNum);
    });

    const unsubNodeInfo = meshtasticService.onNodeInfoPacket.subscribe((node) => {
      setNodes(prev => {
        const existing = prev.findIndex(n => n.nodeNum === node.nodeNum);
        if (existing !== -1) {
          const updated = [...prev];
          updated[existing] = node;
          return updated;
        }
        return [...prev, node];
      });
    });

    const unsubMessage = meshtasticService.onMessagePacket.subscribe((msg) => {
      setMessages(prev => {
        // Check for duplicates
        if (prev.some(m => m.id === msg.id)) {
          return prev;
        }

        const updated = [...prev, msg];
        saveMessages(updated);

        // Show notification if chat is not open
        const senderNode = meshtasticService.getNode(msg.from);
        const senderName = senderNode?.longName || senderNode?.shortName || 'Someone';

        if (openChatWith !== msg.from) {
          Alert.alert(
            senderName,
            msg.text.length > 50 ? msg.text.substring(0, 50) + '...' : msg.text,
            [
              { text: 'Close', style: 'cancel' },
              { text: 'Open', onPress: () => openChat(msg.from) },
            ]
          );
        }

        return updated;
      });
    });

    const unsubError = meshtasticService.onError.subscribe((err) => {
      setError(err.message);
    });

    meshtasticService.connect(device).catch(() => {
      // Error is handled via event
    });

    return () => {
      unsubStatus();
      unsubMyInfo();
      unsubNodeInfo();
      unsubMessage();
      unsubError();
      meshtasticService.disconnect();
    };
  }, []);

  const loadFriends = async () => {
    try {
      const stored = await AsyncStorage.getItem(FRIENDS_STORAGE_KEY);
      if (stored) {
        const ids = JSON.parse(stored) as number[];
        setFriendIds(new Set(ids));
      }
    } catch {
      // Ignore load errors
    }
  };

  const saveFriends = async (ids: Set<number>) => {
    try {
      await AsyncStorage.setItem(FRIENDS_STORAGE_KEY, JSON.stringify([...ids]));
    } catch {
      // Ignore save errors
    }
  };

  const loadMessages = async () => {
    try {
      const stored = await AsyncStorage.getItem(MESSAGES_STORAGE_KEY);
      if (stored) {
        const msgs = JSON.parse(stored) as Message[];
        setMessages(msgs);
      }
    } catch {
      // Ignore load errors
    }
  };

  const saveMessages = async (msgs: Message[]) => {
    try {
      const toSave = msgs.slice(-MAX_STORED_MESSAGES);
      await AsyncStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // Ignore save errors
    }
  };

  const sendMessage = async (toNodeNum: number, text: string) => {
    const sentMessage = await meshtasticService.sendMessage(toNodeNum, text);

    if (sentMessage) {
      setMessages(prev => {
        const updated = [...prev, sentMessage];
        saveMessages(updated);
        return updated;
      });
      setMessageText('');

      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } else {
      Alert.alert('Error', 'Failed to send message');
    }
  };

  const handleDisconnect = async () => {
    await meshtasticService.disconnect();
    onBack();
  };

  const addFriend = (nodeNum: number) => {
    const newIds = new Set([...friendIds, nodeNum]);
    setFriendIds(newIds);
    saveFriends(newIds);
  };

  const removeFriend = (nodeNum: number) => {
    const newIds = new Set(friendIds);
    newIds.delete(nodeNum);
    setFriendIds(newIds);
    saveFriends(newIds);
  };

  const openChat = (nodeNum: number) => {
    setOpenChatWith(nodeNum);
    setActiveTab('chat');
  };

  const handleNodePress = (node: NodeInfo) => {
    const isFriend = friendIds.has(node.nodeNum);
    const nodeName = getNodeName(node);

    Alert.alert(
      nodeName,
      isFriend ? 'What would you like to do?' : 'Add to friends?',
      isFriend
        ? [
            { text: 'Message', onPress: () => openChat(node.nodeNum) },
            { text: 'Remove friend', style: 'destructive', onPress: () => removeFriend(node.nodeNum) },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: 'Message', onPress: () => openChat(node.nodeNum) },
            { text: 'Add friend', onPress: () => addFriend(node.nodeNum) },
            { text: 'Cancel', style: 'cancel' },
          ]
    );
  };

  const getInitials = (node: NodeInfo | undefined): string => {
    if (node?.shortName) {
      return node.shortName.slice(0, 2).toUpperCase();
    }
    return '📻';
  };

  const getNodeName = (node: NodeInfo | undefined): string => {
    if (!node) return 'Unknown';
    return node.longName || node.shortName || `Node ${node.nodeNum.toString(16)}`;
  };

  const getNodeByNum = (nodeNum: number): NodeInfo | undefined => {
    return nodes.find(n => n.nodeNum === nodeNum);
  };

  function isMyNode(node: NodeInfo): boolean {
    return myNodeNum !== null && node.nodeNum === myNodeNum;
  }

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const renderNodeCard = (node: NodeInfo, isFriend: boolean = false) => (
    <TouchableOpacity
      key={node.nodeNum}
      style={styles.nodeCard}
      onPress={() => handleNodePress(node)}
      activeOpacity={0.7}
    >
      <View style={[
        styles.nodeAvatar,
        isFriend && styles.friendAvatar,
      ]}>
        <Text style={styles.nodeAvatarText}>{getInitials(node)}</Text>
      </View>
      <View style={styles.nodeInfo}>
        <Text style={styles.nodeName}>{getNodeName(node)}</Text>
        <Text style={styles.nodeDetail}>
          {isFriend ? 'Online' : 'Nearby'}
        </Text>
      </View>
      {!isFriend && (
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => addFriend(node.nodeNum)}
          activeOpacity={0.7}
        >
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      )}
      {isFriend && (
        <Text style={styles.chevron}>›</Text>
      )}
    </TouchableOpacity>
  );

  const renderPeopleTab = () => (
    <ScrollView style={styles.nodesList} showsVerticalScrollIndicator={false}>
      {friends.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>
            FRIENDS ({friends.length})
          </Text>
          {friends.map(node => renderNodeCard(node, true))}
        </>
      )}

      {nearby.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeader}>
              NEARBY ({nearby.length})
            </Text>
          </View>
          <View style={styles.sectionHint}>
            <Text style={styles.sectionHintText}>
              These radios are in range. Tap + to add as friend.
            </Text>
          </View>
          {nearby.map(node => renderNodeCard(node, false))}
        </>
      )}

      {nodes.length === 0 && deviceStatus === DeviceStatusEnum.DeviceConfigured && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyTitle}>No one nearby</Text>
          <Text style={styles.emptyText}>
            When friends turn on their radios, they will appear here
          </Text>
        </View>
      )}

      {friends.length === 0 && nearby.length > 0 && (
        <View style={styles.tipCard}>
          <Text style={styles.tipIcon}>💡</Text>
          <Text style={styles.tipText}>
            Add friends to quickly find them in the list and on the map
          </Text>
        </View>
      )}

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderChatList = () => (
    <ScrollView style={styles.nodesList} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionHeader}>MESSAGES</Text>

      {chatList.length > 0 ? (
        chatList.map(chat => {
          const node = getNodeByNum(chat.nodeNum);
          return (
            <TouchableOpacity
              key={chat.nodeNum}
              style={styles.chatListItem}
              onPress={() => setOpenChatWith(chat.nodeNum)}
              activeOpacity={0.7}
            >
              <View style={[styles.nodeAvatar, styles.friendAvatar]}>
                <Text style={styles.nodeAvatarText}>{getInitials(node)}</Text>
              </View>
              <View style={styles.chatListInfo}>
                <View style={styles.chatListHeader}>
                  <Text style={styles.chatListName}>{getNodeName(node)}</Text>
                  <Text style={styles.chatListTime}>
                    {formatTime(chat.lastMessage.timestamp)}
                  </Text>
                </View>
                <Text style={styles.chatListPreview} numberOfLines={1}>
                  {chat.lastMessage.isOutgoing ? 'You: ' : ''}{chat.lastMessage.text}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>No messages</Text>
          <Text style={styles.emptyText}>
            Tap on a friend in the People tab to start a conversation
          </Text>
        </View>
      )}

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderOpenChat = () => {
    const chatPartner = openChatWith ? getNodeByNum(openChatWith) : undefined;

    return (
      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.chatHeader}>
          <TouchableOpacity
            onPress={() => setOpenChatWith(null)}
            style={styles.chatBackButton}
          >
            <Text style={styles.backButtonText}>‹</Text>
          </TouchableOpacity>
          <View style={[styles.chatHeaderAvatar, styles.friendAvatar]}>
            <Text style={styles.chatHeaderAvatarText}>{getInitials(chatPartner)}</Text>
          </View>
          <View style={styles.chatHeaderInfo}>
            <Text style={styles.chatHeaderName}>{getNodeName(chatPartner)}</Text>
            <Text style={styles.chatHeaderStatus}>Online</Text>
          </View>
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {chatMessages.length === 0 ? (
            <View style={styles.emptyChatState}>
              <Text style={styles.emptyChatText}>
                Start a conversation with {getNodeName(chatPartner)}
              </Text>
            </View>
          ) : (
            chatMessages.map(msg => (
              <View
                key={msg.id}
                style={[
                  styles.messageBubble,
                  msg.isOutgoing ? styles.outgoingBubble : styles.incomingBubble,
                ]}
              >
                <Text style={[
                  styles.messageText,
                  msg.isOutgoing ? styles.outgoingText : styles.incomingText,
                ]}>
                  {msg.text}
                </Text>
                <Text style={[
                  styles.messageTime,
                  msg.isOutgoing ? styles.outgoingTime : styles.incomingTime,
                ]}>
                  {formatTime(msg.timestamp)}
                </Text>
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="Message..."
            placeholderTextColor="#8E8E93"
            value={messageText}
            onChangeText={setMessageText}
            multiline
            maxLength={200}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              !messageText.trim() && styles.sendButtonDisabled,
            ]}
            onPress={() => openChatWith && sendMessage(openChatWith, messageText)}
            disabled={!messageText.trim()}
            activeOpacity={0.7}
          >
            <Text style={styles.sendButtonText}>›</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  };

  const renderChatTab = () => {
    if (openChatWith) {
      return renderOpenChat();
    }
    return renderChatList();
  };

  return (
    <View style={styles.container}>
      {!openChatWith && (
        <View style={styles.header}>
          <TouchableOpacity onPress={handleDisconnect} style={styles.backButton}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {device.name || 'Radio'}
          </Text>
          <View style={styles.headerRight} />
        </View>
      )}

      {!openChatWith && (deviceStatus < DeviceStatusEnum.DeviceConfigured || error) && (
        <View style={styles.statusContainer}>
          {deviceStatus === DeviceStatusEnum.DeviceConnecting && (
            <View style={styles.statusItem}>
              <ActivityIndicator size="small" color="#2AABEE" />
              <Text style={styles.statusText}>Connecting...</Text>
            </View>
          )}
          {deviceStatus === DeviceStatusEnum.DeviceConfiguring && (
            <View style={styles.statusItem}>
              <ActivityIndicator size="small" color="#2AABEE" />
              <Text style={styles.statusText}>Loading data...</Text>
            </View>
          )}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>
      )}

      {activeTab === 'people' && renderPeopleTab()}
      {activeTab === 'chat' && renderChatTab()}
      {activeTab === 'map' && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🗺️</Text>
          <Text style={styles.emptyTitle}>Map</Text>
          <Text style={styles.emptyText}>Map with friends coming soon</Text>
        </View>
      )}
      {activeTab === 'settings' && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>⚙️</Text>
          <Text style={styles.emptyTitle}>Settings</Text>
          <Text style={styles.emptyText}>Settings coming soon</Text>
        </View>
      )}

      {!openChatWith && (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => setActiveTab('people')}
          >
            <Text style={styles.tabIcon}>👥</Text>
            <Text style={[styles.tabLabel, activeTab === 'people' && styles.tabLabelActive]}>
              People
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => setActiveTab('chat')}
          >
            <Text style={styles.tabIcon}>💬</Text>
            <Text style={[styles.tabLabel, activeTab === 'chat' && styles.tabLabelActive]}>
              Chat
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => setActiveTab('map')}
          >
            <Text style={styles.tabIcon}>🗺️</Text>
            <Text style={[styles.tabLabel, activeTab === 'map' && styles.tabLabelActive]}>
              Map
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => setActiveTab('settings')}
          >
            <Text style={styles.tabIcon}>⚙️</Text>
            <Text style={[styles.tabLabel, activeTab === 'settings' && styles.tabLabelActive]}>
              More
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F4F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  backButton: {
    width: 70,
  },
  backButtonText: {
    fontSize: 17,
    color: '#2AABEE',
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    textAlign: 'center',
  },
  headerRight: {
    width: 70,
  },
  statusContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#8E8E93',
  },
  errorContainer: {
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 8,
  },
  errorText: {
    color: '#C62828',
    fontSize: 14,
  },
  nodesList: {
    flex: 1,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 16,
  },
  sectionHint: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sectionHintText: {
    fontSize: 13,
    color: '#8E8E93',
    lineHeight: 18,
  },
  nodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  nodeAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#8E8E93',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  friendAvatar: {
    backgroundColor: '#2AABEE',
  },
  nodeAvatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  nodeInfo: {
    flex: 1,
  },
  nodeName: {
    fontSize: 17,
    color: '#000000',
    marginBottom: 2,
  },
  nodeDetail: {
    fontSize: 14,
    color: '#8E8E93',
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2AABEE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 24,
    color: '#FFFFFF',
    fontWeight: '300',
    marginTop: -2,
  },
  chevron: {
    fontSize: 24,
    color: '#C7C7CC',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 22,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF9E6',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
  },
  tipIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: '#8B6914',
    lineHeight: 20,
  },
  bottomPadding: {
    height: 100,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  tabLabel: {
    fontSize: 10,
    color: '#8E8E93',
  },
  tabLabelActive: {
    color: '#2AABEE',
    fontWeight: '600',
  },
  chatListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  chatListInfo: {
    flex: 1,
  },
  chatListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatListName: {
    fontSize: 17,
    fontWeight: '500',
    color: '#000000',
  },
  chatListTime: {
    fontSize: 14,
    color: '#8E8E93',
  },
  chatListPreview: {
    fontSize: 15,
    color: '#8E8E93',
  },
  chatContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  chatBackButton: {
    width: 30,
    marginRight: 8,
  },
  chatHeaderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  chatHeaderAvatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  chatHeaderInfo: {
    flex: 1,
  },
  chatHeaderName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
  },
  chatHeaderStatus: {
    fontSize: 13,
    color: '#31B545',
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: '#F4F4F5',
  },
  messagesContent: {
    padding: 16,
  },
  emptyChatState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyChatText: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    marginBottom: 8,
  },
  incomingBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 4,
  },
  outgoingBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#2AABEE',
    borderBottomRightRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  incomingText: {
    color: '#000000',
  },
  outgoingText: {
    color: '#FFFFFF',
  },
  messageTime: {
    fontSize: 11,
    marginTop: 4,
  },
  incomingTime: {
    color: '#8E8E93',
  },
  outgoingTime: {
    color: 'rgba(255,255,255,0.7)',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#F4F4F5',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000000',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2AABEE',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#E5E5EA',
  },
  sendButtonText: {
    fontSize: 24,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
