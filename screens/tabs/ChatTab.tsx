import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Keyboard,
  Animated,
  Pressable,
} from 'react-native';

import type { NodeInfo, Message, Channel, ChatTarget, MessageStatus, MqttStatus } from '../../types';
import { ChannelRole } from '../../types';
import { BROADCAST_ADDR } from '../../constants/meshtastic';

// Helper to generate packet ID
const generatePacketId = () => Math.floor(Math.random() * 0xFFFFFFFF);
import { sharedStyles, chatStyles } from './styles';
import type { ChatTabProps } from './types';
import { MessageBubble, ChatListItem } from '../../components/chat';
import { logger } from '../../services/LoggerService';

export default function ChatTab({
  myNodeNum,
  nodes,
  friendIds,
  getNodeName,
  channels,
  messages,
  openChat,
  setOpenChat,
  sendMessage,
  sendChannelMessage,
  sendLocationMessage,
  addMessage,
  updateMessageStatus,
  updateRadioStatus,
  updateMqttStatus,
  addFriend,
  removeFriend,
  markChatAsRead,
  getUnreadCount,
  currentLocation,
  onShowQRScanner,
  onShowCreateGroup,
  onShareChannel,
  onDeleteChannel,
  onNavigateToLocation,
}: ChatTabProps) {
  const [messageText, setMessageText] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);

  // Animation for send button
  const sendButtonScale = useRef(new Animated.Value(0)).current;
  const sendButtonOpacity = useRef(new Animated.Value(0)).current;

  // Animate send button when text changes
  useEffect(() => {
    const hasText = messageText.trim().length > 0;
    Animated.parallel([
      Animated.spring(sendButtonScale, {
        toValue: hasText ? 1 : 0.8,
        friction: 6,
        tension: 100,
        useNativeDriver: true,
      }),
      Animated.timing(sendButtonOpacity, {
        toValue: hasText ? 1 : 0.5,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [messageText]);

  // Filter friends and nearby (excluding self)
  const friends = useMemo(() =>
    nodes.filter(n => friendIds.has(n.nodeNum) && n.nodeNum !== myNodeNum),
    [nodes, friendIds, myNodeNum]
  );

  const nearby = useMemo(() =>
    nodes.filter(n => !friendIds.has(n.nodeNum) && n.nodeNum !== myNodeNum),
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
      return messages
        .filter(m =>
          m.to !== BROADCAST_ADDR && (
            (m.from === openChat.id && m.to === myNodeNum) ||
            (m.from === myNodeNum && m.to === openChat.id)
          )
        )
        .sort((a, b) => a.timestamp - b.timestamp);
    } else {
      return messages
        .filter(m => m.channel === openChat.id && m.to === BROADCAST_ADDR)
        .sort((a, b) => a.timestamp - b.timestamp);
    }
  }, [messages, openChat, myNodeNum]);

  // Chat list (unique DM conversations)
  const chatList = useMemo(() => {
    const chats = new Map<number, { nodeNum: number; lastMessage: Message }>();

    messages.forEach(msg => {
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

  // Mark messages as read when chat is open
  useEffect(() => {
    if (openChat && chatMessages.length > 0) {
      const chatKey = openChat.type === 'dm' ? `dm_${openChat.id}` : `channel_${openChat.id}`;
      markChatAsRead(chatKey);
    }
  }, [chatMessages.length, openChat, markChatAsRead]);

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

  // Helper functions
  const getChatKey = (target: ChatTarget): string => {
    return target.type === 'dm' ? `dm_${target.id}` : `channel_${target.id}`;
  };

  const getUnreadCountForChat = (target: ChatTarget): number => {
    const key = getChatKey(target);
    const targetMessages = target.type === 'dm'
      ? messages.filter(m => m.from === target.id && m.to === myNodeNum && !m.isOutgoing)
      : messages.filter(m => m.channel === target.id && m.to === BROADCAST_ADDR && !m.isOutgoing);
    return getUnreadCount(key, targetMessages);
  };

  const getInitials = (node: NodeInfo | undefined): string => {
    if (node?.shortName) {
      return node.shortName.slice(0, 2).toUpperCase();
    }
    return '';
  };

  const getNodeNameSafe = (node: NodeInfo | undefined): string => {
    if (!node) return 'Unknown';
    return getNodeName(node);
  };

  const getNodeByNum = (nodeNum: number): NodeInfo | undefined => {
    return nodes.find(n => n.nodeNum === nodeNum);
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  // Handlers
  const handleSendMessage = async () => {
    logger.debug('ChatTab', 'handleSendMessage called:', {
      hasOpenChat: !!openChat,
      openChatType: openChat?.type,
      openChatId: openChat?.id,
      messageText: messageText.substring(0, 50),
      messageLength: messageText.length,
    });

    if (!openChat || !messageText.trim() || !myNodeNum) {
      logger.debug('ChatTab', 'handleSendMessage ABORT: no openChat, empty text or no myNodeNum');
      return;
    }

    const text = messageText.trim();
    const packetId = generatePacketId();
    const isChannel = openChat.type === 'channel';
    const to = isChannel ? BROADCAST_ADDR : openChat.id;
    const channel = isChannel ? openChat.id : 0;

    // Check if MQTT uplink is enabled for this channel
    const targetChannel = isChannel ? channels.find(ch => ch.index === openChat.id) : null;
    const hasMqttUplink = targetChannel?.uplinkEnabled === true;

    // 1. Create message with initial status and save to DB first
    const pendingMessage: Message = {
      id: `${myNodeNum}-${Date.now()}`,
      packetId,
      from: myNodeNum,
      to,
      text,
      timestamp: Date.now(),
      isOutgoing: true,
      channel,
      status: 'pending', // Legacy field
      radioStatus: 'pending',
      mqttStatus: hasMqttUplink ? 'pending' : 'not_applicable',
    };

    logger.debug('ChatTab', 'handleSendMessage: saving pending message to DB:', {
      id: pendingMessage.id,
      packetId: pendingMessage.packetId,
    });

    addMessage(pendingMessage);
    setMessageText('');
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);

    // 2. Try to send via radio/MQTT
    let sentMessage: Message | null;

    if (isChannel) {
      logger.debug('ChatTab', 'handleSendMessage: sending channel message to channel', openChat.id);
      sentMessage = await sendChannelMessage(text, openChat.id, packetId);
    } else {
      logger.debug('ChatTab', 'handleSendMessage: sending DM to', openChat.id);
      sentMessage = await sendMessage(openChat.id, text, packetId);
    }

    logger.debug('ChatTab', 'handleSendMessage result:', sentMessage ? { id: sentMessage.id, packetId: sentMessage.packetId } : 'null');

    // 3. Update status based on send result
    if (sentMessage) {
      // Successfully sent to radio, update radio status to 'sent' (waiting for ACK)
      updateRadioStatus(packetId, 'sent');
      // Note: radioStatus will be updated to 'delivered' when radio ACK is received
      // mqttStatus will be updated to 'sent' when MQTT publish is confirmed
    } else {
      // Failed to send
      logger.debug('ChatTab', 'handleSendMessage FAILED: updating status to failed');
      updateRadioStatus(packetId, 'failed');
      if (hasMqttUplink) {
        updateMqttStatus(packetId, 'failed');
      }
    }
  };

  const handleSendLocation = async () => {
    if (!openChat || !myNodeNum) return;

    if (!currentLocation) {
      Alert.alert('Error', 'GPS not available. Enable location in settings.');
      return;
    }

    const packetId = generatePacketId();
    const isChannel = openChat.type === 'channel';
    const to = isChannel ? BROADCAST_ADDR : openChat.id;
    const channel = isChannel ? openChat.id : 0;

    // Check if MQTT uplink is enabled for this channel
    const targetChannel = isChannel ? channels.find(ch => ch.index === openChat.id) : null;
    const hasMqttUplink = targetChannel?.uplinkEnabled === true;

    // 1. Create location message with initial status and save to DB first
    const pendingMessage: Message = {
      id: `${myNodeNum}-${Date.now()}`,
      packetId,
      from: myNodeNum,
      to,
      text: '📍 Геолокация',
      timestamp: Date.now(),
      isOutgoing: true,
      channel,
      status: 'pending', // Legacy field
      radioStatus: 'pending',
      mqttStatus: hasMqttUplink ? 'pending' : 'not_applicable',
      type: 'location',
      location: {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        time: Math.floor(Date.now() / 1000),
      },
    };

    addMessage(pendingMessage);
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);

    // 2. Try to send via radio/MQTT
    let sentMessage: Message | null;

    if (isChannel) {
      sentMessage = await sendLocationMessage(
        currentLocation.latitude,
        currentLocation.longitude,
        'broadcast',
        openChat.id,
        packetId
      );
    } else {
      sentMessage = await sendLocationMessage(
        currentLocation.latitude,
        currentLocation.longitude,
        openChat.id,
        0,
        packetId
      );
    }

    // 3. Update status based on send result
    if (sentMessage) {
      updateRadioStatus(packetId, 'sent');
    } else {
      updateRadioStatus(packetId, 'failed');
      if (hasMqttUplink) {
        updateMqttStatus(packetId, 'failed');
      }
      Alert.alert('Error', 'Failed to send location');
    }
  };

  const openChatHandler = (target: ChatTarget) => {
    setOpenChat(target);
    markChatAsRead(getChatKey(target));
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

  // Render channel item
  const renderChannelItem = (channel: Channel) => {
    const channelMessages = messages.filter(m => m.channel === channel.index && m.to === BROADCAST_ADDR);
    const lastMessage = channelMessages.length > 0
      ? channelMessages[channelMessages.length - 1]
      : null;

    const canDelete = channel.role !== ChannelRole.PRIMARY;
    const unreadCount = getUnreadCountForChat({ type: 'channel', id: channel.index });

    return (
      <TouchableOpacity
        key={`channel-${channel.index}`}
        style={chatStyles.chatListItem}
        onPress={() => openChatHandler({ type: 'channel', id: channel.index })}
        onLongPress={canDelete ? () => onDeleteChannel(channel) : undefined}
        activeOpacity={0.7}
      >
        <View style={[sharedStyles.nodeAvatar, sharedStyles.channelAvatar]}>
          <Text style={sharedStyles.nodeAvatarText}>#</Text>
        </View>
        <View style={chatStyles.chatListInfo}>
          <View style={chatStyles.chatListHeader}>
            <Text style={[chatStyles.chatListName, unreadCount > 0 && chatStyles.chatListNameUnread]}>
              {channel.name}
              {channel.role === ChannelRole.PRIMARY && ' (Primary)'}
            </Text>
            {lastMessage && (
              <Text style={chatStyles.chatListTime}>
                {formatTime(lastMessage.timestamp)}
              </Text>
            )}
          </View>
          <Text style={[chatStyles.chatListPreview, unreadCount > 0 && chatStyles.chatListPreviewUnread]} numberOfLines={1}>
            {lastMessage
              ? (lastMessage.isOutgoing ? 'You: ' : '') + lastMessage.text
              : channel.hasEncryption ? 'Encrypted channel' : 'Open channel'
            }
          </Text>
        </View>
        {unreadCount > 0 && (
          <View style={sharedStyles.unreadBadge}>
            <Text style={sharedStyles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
        {unreadCount === 0 && channel.hasEncryption && (
          <Text style={chatStyles.lockIcon}>🔒</Text>
        )}
      </TouchableOpacity>
    );
  };

  // Render chat list
  const renderChatList = () => {
    const friendsWithChats = new Set(chatList.map(c => c.nodeNum));
    const friendsWithoutChats = friends.filter(f => !friendsWithChats.has(f.nodeNum));

    return (
      <ScrollView style={sharedStyles.nodesList} showsVerticalScrollIndicator={false}>
        {/* Groups section */}
        <View style={sharedStyles.sectionHeaderRow}>
          <Text style={sharedStyles.sectionHeader}>
            GROUPS {activeChannels.length > 0 ? `(${activeChannels.length})` : ''}
          </Text>
          <View style={chatStyles.groupButtonsRow}>
            <TouchableOpacity
              style={chatStyles.createGroupButton}
              onPress={onShowQRScanner}
              activeOpacity={0.7}
            >
              <Text style={chatStyles.createGroupButtonText}>QR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={chatStyles.createGroupButton}
              onPress={onShowCreateGroup}
              activeOpacity={0.7}
            >
              <Text style={chatStyles.createGroupButtonText}>+ Create</Text>
            </TouchableOpacity>
          </View>
        </View>

        {activeChannels.length > 0 ? (
          activeChannels.map(channel => renderChannelItem(channel))
        ) : (
          <View style={chatStyles.emptyGroupsHint}>
            <Text style={chatStyles.emptyGroupsText}>
              Create a group to chat with multiple people
            </Text>
          </View>
        )}

        {/* Messages section */}
        <Text style={sharedStyles.sectionHeader}>
          MESSAGES {(chatList.length + friendsWithoutChats.length) > 0 ? `(${chatList.length + friendsWithoutChats.length})` : ''}
        </Text>

        {chatList.map(chat => (
          <ChatListItem
            key={chat.nodeNum}
            node={getNodeByNum(chat.nodeNum)}
            lastMessage={chat.lastMessage}
            unreadCount={getUnreadCountForChat({ type: 'dm', id: chat.nodeNum })}
            onPress={() => openChatHandler({ type: 'dm', id: chat.nodeNum })}
            getNodeName={getNodeNameSafe}
            formatTime={formatTime}
          />
        ))}

        {friendsWithoutChats.map(node => (
          <ChatListItem
            key={node.nodeNum}
            node={node}
            unreadCount={0}
            onPress={() => openChatHandler({ type: 'dm', id: node.nodeNum })}
            onLongPress={() => handleNodePress(node)}
            getNodeName={getNodeNameSafe}
            formatTime={formatTime}
          />
        ))}

        {chatList.length === 0 && friendsWithoutChats.length === 0 && (
          <View style={chatStyles.emptyGroupsHint}>
            <Text style={chatStyles.emptyGroupsText}>
              Add friends from the Nearby section below
            </Text>
          </View>
        )}

        {/* Nearby section */}
        {nearby.length > 0 && (
          <>
            <Text style={sharedStyles.sectionHeader}>NEARBY ({nearby.length})</Text>
            <View style={chatStyles.sectionHint}>
              <Text style={chatStyles.sectionHintText}>
                These radios are in range. Tap + to add as friend.
              </Text>
            </View>
            {nearby.map(node => (
              <TouchableOpacity
                key={node.nodeNum}
                style={sharedStyles.nodeCard}
                onPress={() => handleNodePress(node)}
                activeOpacity={0.7}
              >
                <View style={sharedStyles.nodeAvatar}>
                  <Text style={sharedStyles.nodeAvatarText}>{getInitials(node)}</Text>
                </View>
                <View style={sharedStyles.nodeInfo}>
                  <Text style={sharedStyles.nodeName}>{getNodeName(node)}</Text>
                  <Text style={sharedStyles.nodeDetail}>Online</Text>
                </View>
                <TouchableOpacity
                  style={chatStyles.addButton}
                  onPress={() => addFriend(node.nodeNum)}
                  activeOpacity={0.7}
                >
                  <Text style={chatStyles.addButtonText}>+</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Empty state */}
        {activeChannels.length === 0 && chatList.length === 0 && friends.length === 0 && nearby.length === 0 && (
          <View style={sharedStyles.emptyState}>
            <Text style={sharedStyles.emptyIcon}>💬</Text>
            <Text style={sharedStyles.emptyTitle}>No one nearby</Text>
            <Text style={sharedStyles.emptyText}>
              When friends turn on their radios, they will appear here
            </Text>
          </View>
        )}

        <View style={sharedStyles.bottomPadding} />
      </ScrollView>
    );
  };

  // Render open chat
  const renderOpenChat = () => {
    if (!openChat) return null;

    const isChannel = openChat.type === 'channel';
    const chatPartner = !isChannel ? getNodeByNum(openChat.id) : undefined;
    const channel = isChannel ? channels.find(ch => ch.index === openChat.id) : undefined;

    const headerName = isChannel
      ? `#${channel?.name || `Channel ${openChat.id}`}`
      : getNodeNameSafe(chatPartner);
    const headerStatus = isChannel
      ? (channel?.hasEncryption ? 'Encrypted' : 'Open')
      : 'Online';
    const headerInitials = isChannel ? '#' : getInitials(chatPartner);

    return (
      <KeyboardAvoidingView
        style={chatStyles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={chatStyles.chatHeader}>
          <TouchableOpacity
            onPress={() => setOpenChat(null)}
            style={chatStyles.chatBackButton}
          >
            <Text style={chatStyles.backButtonText}>‹</Text>
          </TouchableOpacity>
          <View style={[
            chatStyles.chatHeaderAvatar,
            isChannel ? sharedStyles.channelAvatar : sharedStyles.friendAvatar
          ]}>
            <Text style={chatStyles.chatHeaderAvatarText}>{headerInitials}</Text>
          </View>
          <View style={chatStyles.chatHeaderInfo}>
            <Text style={chatStyles.chatHeaderName}>{headerName}</Text>
            <Text style={[
              chatStyles.chatHeaderStatus,
              isChannel && channel?.hasEncryption && chatStyles.encryptedStatus
            ]}>
              {headerStatus}
            </Text>
          </View>
          {isChannel && (
            <TouchableOpacity
              style={chatStyles.shareButton}
              onPress={() => onShareChannel(openChat.id)}
              activeOpacity={0.7}
            >
              <Text style={chatStyles.shareButtonText}>Share</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={chatStyles.messagesContainer}
          contentContainerStyle={chatStyles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {chatMessages.length === 0 ? (
            <View style={chatStyles.emptyChatState}>
              <Text style={chatStyles.emptyChatText}>
                {isChannel
                  ? `Send a message to ${headerName}`
                  : `Start a conversation with ${headerName}`
                }
              </Text>
            </View>
          ) : (
            chatMessages.map(msg => {
              const senderNode = getNodeByNum(msg.from);
              const senderName = getNodeNameSafe(senderNode);

              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  senderName={senderName}
                  isChannel={isChannel}
                  formatTime={formatTime}
                  onLocationPress={onNavigateToLocation}
                />
              );
            })
          )}
        </ScrollView>

        <View style={chatStyles.inputContainer}>
          <TouchableOpacity
            style={chatStyles.locationButton}
            onPress={handleSendLocation}
            activeOpacity={0.7}
          >
            <Text style={chatStyles.locationButtonText}></Text>
          </TouchableOpacity>
          <TextInput
            style={chatStyles.textInput}
            placeholder="Message..."
            placeholderTextColor="#8E8E93"
            value={messageText}
            onChangeText={setMessageText}
            multiline
            maxLength={200}
          />
          <Pressable
            onPress={handleSendMessage}
            disabled={!messageText.trim()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => [
              chatStyles.sendButton,
              !messageText.trim() && chatStyles.sendButtonDisabled,
              pressed && messageText.trim() && { transform: [{ scale: 0.9 }] },
            ]}
          >
            <Animated.View
              style={{
                transform: [{ scale: sendButtonScale }],
                opacity: sendButtonOpacity,
              }}
            >
              <Text style={chatStyles.sendButtonText}>↑</Text>
            </Animated.View>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  };

  // Main render
  if (openChat) {
    return renderOpenChat();
  }
  return renderChatList();
}
