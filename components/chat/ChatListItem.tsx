/**
 * ChatListItem - renders a DM chat item in the chat list
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

import type { NodeInfo, Message } from '../../types';
import { sharedStyles, chatStyles } from '../../screens/tabs/styles';

interface ChatListItemProps {
  node: NodeInfo | undefined;
  lastMessage?: Message;
  unreadCount: number;
  onPress: () => void;
  onLongPress?: () => void;
  getNodeName: (node: NodeInfo | undefined) => string;
  formatTime: (timestamp: number) => string;
}

export default function ChatListItem({
  node,
  lastMessage,
  unreadCount,
  onPress,
  onLongPress,
  getNodeName,
  formatTime,
}: ChatListItemProps) {
  const getInitials = (n: NodeInfo | undefined): string => {
    if (n?.shortName) {
      return n.shortName.slice(0, 2).toUpperCase();
    }
    return '';
  };

  const nodeName = getNodeName(node);

  return (
    <TouchableOpacity
      style={chatStyles.chatListItem}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      <View style={[sharedStyles.nodeAvatar, sharedStyles.friendAvatar]}>
        <Text style={sharedStyles.nodeAvatarText}>{getInitials(node)}</Text>
      </View>
      <View style={chatStyles.chatListInfo}>
        {lastMessage ? (
          <>
            <View style={chatStyles.chatListHeader}>
              <Text style={[chatStyles.chatListName, unreadCount > 0 && chatStyles.chatListNameUnread]}>
                {nodeName}
              </Text>
              <Text style={chatStyles.chatListTime}>
                {formatTime(lastMessage.timestamp)}
              </Text>
            </View>
            <Text
              style={[chatStyles.chatListPreview, unreadCount > 0 && chatStyles.chatListPreviewUnread]}
              numberOfLines={1}
            >
              {lastMessage.isOutgoing ? 'You: ' : ''}{lastMessage.text}
            </Text>
          </>
        ) : (
          <>
            <Text style={chatStyles.chatListName}>{nodeName}</Text>
            <Text style={chatStyles.chatListPreview}>Tap to send message</Text>
          </>
        )}
      </View>
      {unreadCount > 0 && (
        <View style={sharedStyles.unreadBadge}>
          <Text style={sharedStyles.unreadBadgeText}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
