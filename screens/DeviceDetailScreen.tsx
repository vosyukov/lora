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
  Modal,
  Share,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Device } from 'react-native-ble-plx';
import QRCode from 'react-native-qrcode-svg';

import { meshtasticService } from '../services/MeshtasticService';
import { notificationService } from '../services/NotificationService';
import type { NodeInfo, Message, ActiveTab, Channel, ChatTarget } from '../types';
import { DeviceStatusEnum, ChannelRole } from '../types';
import {
  FRIENDS_STORAGE_KEY,
  MESSAGES_STORAGE_KEY,
  LAST_READ_STORAGE_KEY,
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
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [openChat, setOpenChat] = useState<ChatTarget | null>(null);
  const [messageText, setMessageText] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEncryption, setNewGroupEncryption] = useState<'none' | 'aes128' | 'aes256'>('aes256');
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareChannelUrl, setShareChannelUrl] = useState<string | null>(null);
  const [lastReadTimestamps, setLastReadTimestamps] = useState<Record<string, number>>({});

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

  // Active channels (not disabled)
  const activeChannels = useMemo(() =>
    channels.filter(ch => ch.role !== ChannelRole.DISABLED),
    [channels]
  );

  // Messages for current chat
  const chatMessages = useMemo(() => {
    if (!openChat) return [];

    if (openChat.type === 'dm') {
      // DM: filter by sender/receiver
      return messages
        .filter(m =>
          (m.from === openChat.id && m.to === myNodeNum) ||
          (m.from === myNodeNum && m.to === openChat.id)
        )
        .sort((a, b) => a.timestamp - b.timestamp);
    } else {
      // Channel: filter by channel index (broadcast messages on this channel)
      return messages
        .filter(m => m.channel === openChat.id)
        .sort((a, b) => a.timestamp - b.timestamp);
    }
  }, [messages, openChat, myNodeNum]);

  // Scroll to bottom when chat opens or new messages arrive
  useEffect(() => {
    if (openChat && chatMessages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: false });
      }, 100);
    }
  }, [openChat]);

  useEffect(() => {
    if (openChat && chatMessages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [chatMessages.length]);

  // Scroll to bottom when keyboard appears
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', () => {
      if (openChat) {
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    });

    return () => {
      keyboardDidShowListener.remove();
    };
  }, [openChat]);

  // Chat list (unique DM conversations, excluding channel messages)
  const chatList = useMemo(() => {
    const chats = new Map<number, { nodeNum: number; lastMessage: Message }>();
    const BROADCAST_ADDR = 0xFFFFFFFF;

    messages.forEach(msg => {
      // Skip channel messages (broadcast)
      if (msg.to === BROADCAST_ADDR) return;

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

  // Load data from storage and initialize notifications
  useEffect(() => {
    loadFriends();
    loadMessages();
    loadLastRead();
    notificationService.initialize();

    return () => {
      notificationService.cleanup();
    };
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

    const unsubChannel = meshtasticService.onChannelPacket.subscribe((channel) => {
      setChannels(prev => {
        const existing = prev.findIndex(ch => ch.index === channel.index);
        if (existing !== -1) {
          const updated = [...prev];
          updated[existing] = channel;
          return updated;
        }
        return [...prev, channel];
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
        const BROADCAST_ADDR = 0xFFFFFFFF;
        const isChannelMessage = msg.to === BROADCAST_ADDR;

        // Check if this chat is already open
        const isChatOpen = openChat && (
          (openChat.type === 'dm' && openChat.id === msg.from) ||
          (openChat.type === 'channel' && openChat.id === msg.channel)
        );

        if (!isChatOpen && !msg.isOutgoing) {
          if (isChannelMessage) {
            const channel = meshtasticService.getChannel(msg.channel ?? 0);
            const channelName = channel?.name || `Канал ${msg.channel ?? 0}`;
            // Show push notification when app is in background
            notificationService.showMessageNotification(senderName, msg.text, true, channelName);
            // Show in-app alert
            Alert.alert(
              `#${channelName}`,
              `${senderName}: ${msg.text.length > 40 ? msg.text.substring(0, 40) + '...' : msg.text}`,
              [
                { text: 'Закрыть', style: 'cancel' },
                { text: 'Открыть', onPress: () => openChatHandler({ type: 'channel', id: msg.channel ?? 0 }) },
              ]
            );
          } else {
            // Show push notification when app is in background
            notificationService.showMessageNotification(senderName, msg.text, false);
            // Show in-app alert
            Alert.alert(
              senderName,
              msg.text.length > 50 ? msg.text.substring(0, 50) + '...' : msg.text,
              [
                { text: 'Закрыть', style: 'cancel' },
                { text: 'Открыть', onPress: () => openChatHandler({ type: 'dm', id: msg.from }) },
              ]
            );
          }
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
      unsubChannel();
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

  const loadLastRead = async () => {
    try {
      const stored = await AsyncStorage.getItem(LAST_READ_STORAGE_KEY);
      if (stored) {
        setLastReadTimestamps(JSON.parse(stored));
      }
    } catch {
      // Ignore load errors
    }
  };

  const saveLastRead = async (timestamps: Record<string, number>) => {
    try {
      await AsyncStorage.setItem(LAST_READ_STORAGE_KEY, JSON.stringify(timestamps));
    } catch {
      // Ignore save errors
    }
  };

  const getChatKey = (target: ChatTarget): string => {
    return target.type === 'dm' ? `dm_${target.id}` : `channel_${target.id}`;
  };

  const markChatAsRead = (target: ChatTarget) => {
    const key = getChatKey(target);
    const newTimestamps = { ...lastReadTimestamps, [key]: Date.now() };
    setLastReadTimestamps(newTimestamps);
    saveLastRead(newTimestamps);
  };

  const getUnreadCount = (target: ChatTarget): number => {
    const key = getChatKey(target);
    const lastRead = lastReadTimestamps[key] || 0;

    if (target.type === 'dm') {
      return messages.filter(m =>
        m.from === target.id &&
        m.to === myNodeNum &&
        !m.isOutgoing &&
        m.timestamp > lastRead
      ).length;
    } else {
      return messages.filter(m =>
        m.channel === target.id &&
        !m.isOutgoing &&
        m.timestamp > lastRead
      ).length;
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

  const handleSendMessage = async () => {
    if (!openChat || !messageText.trim()) return;

    let sentMessage;

    if (openChat.type === 'dm') {
      // Direct message
      sentMessage = await meshtasticService.sendMessage(openChat.id, messageText);
    } else {
      // Channel message (broadcast on channel)
      sentMessage = await meshtasticService.sendText(messageText, 'broadcast', openChat.id);
    }

    if (sentMessage) {
      setMessages(prev => {
        const updated = [...prev, sentMessage!];
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

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert('Error', 'Please enter a group name');
      return;
    }

    // Find first available channel slot (1-7, as 0 is PRIMARY)
    const usedIndices = new Set(channels.map(ch => ch.index));
    let availableIndex = -1;
    for (let i = 1; i <= 7; i++) {
      const existingChannel = channels.find(ch => ch.index === i);
      if (!existingChannel || existingChannel.role === ChannelRole.DISABLED) {
        availableIndex = i;
        break;
      }
    }

    if (availableIndex === -1) {
      Alert.alert('Error', 'All channel slots are in use (max 7 groups)');
      return;
    }

    // Generate PSK based on encryption selection
    let psk: Uint8Array;
    if (newGroupEncryption === 'none') {
      psk = new Uint8Array();
    } else if (newGroupEncryption === 'aes128') {
      psk = meshtasticService.generatePsk(16);
    } else {
      psk = meshtasticService.generatePsk(32);
    }

    const success = await meshtasticService.setChannel(
      availableIndex,
      newGroupName.trim(),
      psk,
      ChannelRole.SECONDARY
    );

    if (success) {
      setShowCreateGroup(false);
      setNewGroupName('');
      setNewGroupEncryption('aes256');
      // Open the new channel chat
      setOpenChat({ type: 'channel', id: availableIndex });
    } else {
      Alert.alert('Error', 'Failed to create group');
    }
  };

  const handleDeleteChannel = (channel: Channel) => {
    Alert.alert(
      'Delete Group',
      `Are you sure you want to delete "${channel.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const success = await meshtasticService.deleteChannel(channel.index);
            if (!success) {
              Alert.alert('Error', 'Failed to delete group');
            }
          },
        },
      ]
    );
  };

  const handleShareChannel = async (channelIndex: number) => {
    const url = await meshtasticService.getChannelUrl(channelIndex);
    if (url) {
      setShareChannelUrl(url);
      setShowShareModal(true);
    } else {
      Alert.alert('Error', 'Failed to generate share link');
    }
  };

  const handleShareLink = async () => {
    if (!shareChannelUrl) return;

    try {
      await Share.share({
        message: shareChannelUrl,
        title: 'Join my Meshtastic channel',
      });
    } catch (error) {
      // User cancelled or error
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

  const openChatHandler = (target: ChatTarget) => {
    setOpenChat(target);
    markChatAsRead(target);
  };

  const handleNodePress = (node: NodeInfo) => {
    const isFriend = friendIds.has(node.nodeNum);
    const nodeName = getNodeName(node);

    Alert.alert(
      nodeName,
      isFriend ? 'What would you like to do?' : 'Add to friends?',
      isFriend
        ? [
            { text: 'Message', onPress: () => openChatHandler({ type: 'dm', id: node.nodeNum }) },
            { text: 'Remove friend', style: 'destructive', onPress: () => removeFriend(node.nodeNum) },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: 'Message', onPress: () => openChatHandler({ type: 'dm', id: node.nodeNum }) },
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

  const renderChannelItem = (channel: Channel) => {
    // Get last message for this channel
    const channelMessages = messages.filter(m => m.channel === channel.index);
    const lastMessage = channelMessages.length > 0
      ? channelMessages[channelMessages.length - 1]
      : null;

    const canDelete = channel.role !== ChannelRole.PRIMARY;
    const unreadCount = getUnreadCount({ type: 'channel', id: channel.index });

    return (
      <TouchableOpacity
        key={`channel-${channel.index}`}
        style={styles.chatListItem}
        onPress={() => openChatHandler({ type: 'channel', id: channel.index })}
        onLongPress={canDelete ? () => handleDeleteChannel(channel) : undefined}
        activeOpacity={0.7}
      >
        <View style={[styles.nodeAvatar, styles.channelAvatar]}>
          <Text style={styles.nodeAvatarText}>#</Text>
        </View>
        <View style={styles.chatListInfo}>
          <View style={styles.chatListHeader}>
            <Text style={[styles.chatListName, unreadCount > 0 && styles.chatListNameUnread]}>
              {channel.name}
              {channel.role === ChannelRole.PRIMARY && ' (Primary)'}
            </Text>
            {lastMessage && (
              <Text style={styles.chatListTime}>
                {formatTime(lastMessage.timestamp)}
              </Text>
            )}
          </View>
          <Text style={[styles.chatListPreview, unreadCount > 0 && styles.chatListPreviewUnread]} numberOfLines={1}>
            {lastMessage
              ? (lastMessage.isOutgoing ? 'Вы: ' : '') + lastMessage.text
              : channel.hasEncryption ? 'Зашифрованный канал' : 'Открытый канал'
            }
          </Text>
        </View>
        {unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
        {unreadCount === 0 && channel.hasEncryption && (
          <Text style={styles.lockIcon}>🔒</Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderChatList = () => {
    // Friends with chat history (from chatList)
    const friendsWithChats = new Set(chatList.map(c => c.nodeNum));
    // Friends without chat history
    const friendsWithoutChats = friends.filter(f => !friendsWithChats.has(f.nodeNum));

    return (
      <ScrollView style={styles.nodesList} showsVerticalScrollIndicator={false}>
        {/* Groups (Channels) section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeader}>
            ГРУППЫ {activeChannels.length > 0 ? `(${activeChannels.length})` : ''}
          </Text>
          <TouchableOpacity
            style={styles.createGroupButton}
            onPress={() => setShowCreateGroup(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.createGroupButtonText}>+ Создать</Text>
          </TouchableOpacity>
        </View>

        {activeChannels.length > 0 ? (
          activeChannels.map(channel => renderChannelItem(channel))
        ) : (
          <View style={styles.emptyGroupsHint}>
            <Text style={styles.emptyGroupsText}>
              Создайте группу для общения с несколькими людьми
            </Text>
          </View>
        )}

        {/* Messages section - chats + friends without chats */}
        <Text style={styles.sectionHeader}>
          СООБЩЕНИЯ {(chatList.length + friendsWithoutChats.length) > 0 ? `(${chatList.length + friendsWithoutChats.length})` : ''}
        </Text>

        {chatList.map(chat => {
          const node = getNodeByNum(chat.nodeNum);
          const unreadCount = getUnreadCount({ type: 'dm', id: chat.nodeNum });
          return (
            <TouchableOpacity
              key={chat.nodeNum}
              style={styles.chatListItem}
              onPress={() => openChatHandler({ type: 'dm', id: chat.nodeNum })}
              activeOpacity={0.7}
            >
              <View style={[styles.nodeAvatar, styles.friendAvatar]}>
                <Text style={styles.nodeAvatarText}>{getInitials(node)}</Text>
              </View>
              <View style={styles.chatListInfo}>
                <View style={styles.chatListHeader}>
                  <Text style={[styles.chatListName, unreadCount > 0 && styles.chatListNameUnread]}>
                    {getNodeName(node)}
                  </Text>
                  <Text style={styles.chatListTime}>
                    {formatTime(chat.lastMessage.timestamp)}
                  </Text>
                </View>
                <Text style={[styles.chatListPreview, unreadCount > 0 && styles.chatListPreviewUnread]} numberOfLines={1}>
                  {chat.lastMessage.isOutgoing ? 'Вы: ' : ''}{chat.lastMessage.text}
                </Text>
              </View>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {friendsWithoutChats.map(node => (
          <TouchableOpacity
            key={node.nodeNum}
            style={styles.chatListItem}
            onPress={() => openChatHandler({ type: 'dm', id: node.nodeNum })}
            onLongPress={() => handleNodePress(node)}
            activeOpacity={0.7}
          >
            <View style={[styles.nodeAvatar, styles.friendAvatar]}>
              <Text style={styles.nodeAvatarText}>{getInitials(node)}</Text>
            </View>
            <View style={styles.chatListInfo}>
              <Text style={styles.chatListName}>{getNodeName(node)}</Text>
              <Text style={styles.chatListPreview}>Нажмите чтобы написать</Text>
            </View>
          </TouchableOpacity>
        ))}

        {chatList.length === 0 && friendsWithoutChats.length === 0 && (
          <View style={styles.emptyGroupsHint}>
            <Text style={styles.emptyGroupsText}>
              Добавьте друзей из секции «Рядом» ниже
            </Text>
          </View>
        )}

        {/* Nearby section */}
        {nearby.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>РЯДОМ ({nearby.length})</Text>
            <View style={styles.sectionHint}>
              <Text style={styles.sectionHintText}>
                Эти рации в зоне действия. Нажмите + чтобы добавить в друзья.
              </Text>
            </View>
            {nearby.map(node => (
              <TouchableOpacity
                key={node.nodeNum}
                style={styles.nodeCard}
                onPress={() => handleNodePress(node)}
                activeOpacity={0.7}
              >
                <View style={styles.nodeAvatar}>
                  <Text style={styles.nodeAvatarText}>{getInitials(node)}</Text>
                </View>
                <View style={styles.nodeInfo}>
                  <Text style={styles.nodeName}>{getNodeName(node)}</Text>
                  <Text style={styles.nodeDetail}>В сети</Text>
                </View>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => addFriend(node.nodeNum)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.addButtonText}>+</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Empty state when nothing */}
        {activeChannels.length === 0 && chatList.length === 0 && friends.length === 0 && nearby.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📡</Text>
            <Text style={styles.emptyTitle}>Никого рядом</Text>
            <Text style={styles.emptyText}>
              Когда друзья включат свои рации, они появятся здесь
            </Text>
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    );
  };

  const renderOpenChat = () => {
    if (!openChat) return null;

    const isChannel = openChat.type === 'channel';
    const chatPartner = !isChannel ? getNodeByNum(openChat.id) : undefined;
    const channel = isChannel ? channels.find(ch => ch.index === openChat.id) : undefined;

    // Get chat header info
    const headerName = isChannel
      ? `#${channel?.name || `Channel ${openChat.id}`}`
      : getNodeName(chatPartner);
    const headerStatus = isChannel
      ? (channel?.hasEncryption ? 'Encrypted' : 'Open')
      : 'Online';
    const headerInitials = isChannel ? '#' : getInitials(chatPartner);

    return (
      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.chatHeader}>
          <TouchableOpacity
            onPress={() => setOpenChat(null)}
            style={styles.chatBackButton}
          >
            <Text style={styles.backButtonText}>‹</Text>
          </TouchableOpacity>
          <View style={[
            styles.chatHeaderAvatar,
            isChannel ? styles.channelAvatar : styles.friendAvatar
          ]}>
            <Text style={styles.chatHeaderAvatarText}>{headerInitials}</Text>
          </View>
          <View style={styles.chatHeaderInfo}>
            <Text style={styles.chatHeaderName}>{headerName}</Text>
            <Text style={[
              styles.chatHeaderStatus,
              isChannel && channel?.hasEncryption && styles.encryptedStatus
            ]}>
              {headerStatus}
            </Text>
          </View>
          {isChannel && (
            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => handleShareChannel(openChat.id)}
              activeOpacity={0.7}
            >
              <Text style={styles.shareButtonText}>Share</Text>
            </TouchableOpacity>
          )}
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
                {isChannel
                  ? `Send a message to ${headerName}`
                  : `Start a conversation with ${headerName}`
                }
              </Text>
            </View>
          ) : (
            chatMessages.map(msg => {
              const senderNode = getNodeByNum(msg.from);
              const senderName = getNodeName(senderNode);

              return (
                <View key={msg.id}>
                  {/* Show sender name for channel messages (not outgoing) */}
                  {isChannel && !msg.isOutgoing && (
                    <Text style={styles.channelSenderName}>{senderName}</Text>
                  )}
                  <View
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
                </View>
              );
            })
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
            onPress={() => handleSendMessage()}
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
    if (openChat) {
      return renderOpenChat();
    }
    return renderChatList();
  };

  return (
    <View style={styles.container}>
      {!openChat && (
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

      {!openChat && (deviceStatus < DeviceStatusEnum.DeviceConfigured || error) && (
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

      {activeTab === 'chat' && renderChatTab()}
      {activeTab === 'map' && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🗺️</Text>
          <Text style={styles.emptyTitle}>Карта</Text>
          <Text style={styles.emptyText}>Карта с друзьями скоро будет</Text>
        </View>
      )}
      {activeTab === 'settings' && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>⚙️</Text>
          <Text style={styles.emptyTitle}>Настройки</Text>
          <Text style={styles.emptyText}>Настройки скоро будут</Text>
        </View>
      )}

      {!openChat && (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => setActiveTab('chat')}
          >
            <Text style={styles.tabIcon}>💬</Text>
            <Text style={[styles.tabLabel, activeTab === 'chat' && styles.tabLabelActive]}>
              Чаты
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => setActiveTab('map')}
          >
            <Text style={styles.tabIcon}>🗺️</Text>
            <Text style={[styles.tabLabel, activeTab === 'map' && styles.tabLabelActive]}>
              Карта
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => setActiveTab('settings')}
          >
            <Text style={styles.tabIcon}>⚙️</Text>
            <Text style={[styles.tabLabel, activeTab === 'settings' && styles.tabLabelActive]}>
              Ещё
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Create Group Modal */}
      <Modal
        visible={showCreateGroup}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateGroup(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Group</Text>
              <TouchableOpacity
                onPress={() => setShowCreateGroup(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Group Name</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter group name..."
              placeholderTextColor="#8E8E93"
              value={newGroupName}
              onChangeText={setNewGroupName}
              maxLength={30}
              autoFocus
            />

            <Text style={styles.modalLabel}>Encryption</Text>
            <View style={styles.encryptionOptions}>
              <TouchableOpacity
                style={[
                  styles.encryptionOption,
                  newGroupEncryption === 'aes256' && styles.encryptionOptionSelected,
                ]}
                onPress={() => setNewGroupEncryption('aes256')}
              >
                <Text style={[
                  styles.encryptionOptionText,
                  newGroupEncryption === 'aes256' && styles.encryptionOptionTextSelected,
                ]}>
                  AES-256
                </Text>
                <Text style={styles.encryptionOptionHint}>Recommended</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.encryptionOption,
                  newGroupEncryption === 'aes128' && styles.encryptionOptionSelected,
                ]}
                onPress={() => setNewGroupEncryption('aes128')}
              >
                <Text style={[
                  styles.encryptionOptionText,
                  newGroupEncryption === 'aes128' && styles.encryptionOptionTextSelected,
                ]}>
                  AES-128
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.encryptionOption,
                  newGroupEncryption === 'none' && styles.encryptionOptionSelected,
                ]}
                onPress={() => setNewGroupEncryption('none')}
              >
                <Text style={[
                  styles.encryptionOptionText,
                  newGroupEncryption === 'none' && styles.encryptionOptionTextSelected,
                ]}>
                  No encryption
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                styles.createButton,
                !newGroupName.trim() && styles.createButtonDisabled,
              ]}
              onPress={handleCreateGroup}
              disabled={!newGroupName.trim()}
            >
              <Text style={styles.createButtonText}>Create Group</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Share Channel Modal */}
      <Modal
        visible={showShareModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowShareModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share Group</Text>
              <TouchableOpacity
                onPress={() => setShowShareModal(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>Done</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.qrContainer}>
              {shareChannelUrl && (
                <QRCode
                  value={shareChannelUrl}
                  size={200}
                  backgroundColor="white"
                  color="black"
                />
              )}
            </View>

            <Text style={styles.shareHint}>
              Scan this QR code with another Meshtastic device to join this channel
            </Text>

            <TouchableOpacity
              style={styles.shareUrlButton}
              onPress={handleShareLink}
            >
              <Text style={styles.shareUrlButtonText}>Share Link</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  channelAvatar: {
    backgroundColor: '#5856D6',
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
  lockIcon: {
    fontSize: 16,
    marginLeft: 8,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2AABEE',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  chatListNameUnread: {
    fontWeight: '600',
  },
  chatListPreviewUnread: {
    color: '#000000',
    fontWeight: '500',
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
  encryptedStatus: {
    color: '#5856D6',
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
  channelSenderName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5856D6',
    marginBottom: 4,
    marginTop: 8,
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
  // Create Group Button
  createGroupButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  createGroupButtonText: {
    fontSize: 14,
    color: '#2AABEE',
    fontWeight: '600',
  },
  emptyGroupsHint: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  emptyGroupsText: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000000',
  },
  modalCloseButton: {
    padding: 8,
  },
  modalCloseText: {
    fontSize: 16,
    color: '#2AABEE',
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalInput: {
    backgroundColor: '#F4F4F5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#000000',
    marginBottom: 20,
  },
  encryptionOptions: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 8,
  },
  encryptionOption: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F4F4F5',
    alignItems: 'center',
  },
  encryptionOptionSelected: {
    backgroundColor: '#2AABEE',
  },
  encryptionOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  encryptionOptionTextSelected: {
    color: '#FFFFFF',
  },
  encryptionOptionHint: {
    fontSize: 11,
    color: '#8E8E93',
    marginTop: 2,
  },
  createButton: {
    backgroundColor: '#2AABEE',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  createButtonDisabled: {
    backgroundColor: '#E5E5EA',
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Share Button
  shareButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#5856D6',
    borderRadius: 14,
  },
  shareButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // QR Code Modal
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: 24,
    borderRadius: 16,
    marginBottom: 20,
  },
  shareHint: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  shareUrlButton: {
    backgroundColor: '#5856D6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  shareUrlButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
