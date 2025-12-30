import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import type { Message, MessageStatus } from '../../types';
import { chatStyles } from '../../screens/tabs/styles';

interface MessageBubbleProps {
  message: Message;
  senderName: string;
  isChannel: boolean;
  formatTime: (timestamp: number) => string;
  onLocationPress?: (latitude: number, longitude: number, senderName: string) => void;
}

function StatusIcon({ status, isOutgoing }: { status?: MessageStatus; isOutgoing: boolean }) {
  if (!isOutgoing) return null;

  switch (status) {
    case 'delivered':
      return <Text style={chatStyles.statusIcon}>✓✓</Text>;
    case 'failed':
      return <Text style={[chatStyles.statusIcon, chatStyles.statusFailed]}>!</Text>;
    case 'sent':
    default:
      return <Text style={chatStyles.statusIcon}>✓</Text>;
  }
}

export default function MessageBubble({
  message,
  senderName,
  isChannel,
  formatTime,
  onLocationPress,
}: MessageBubbleProps) {
  const { isOutgoing, timestamp, status, type, location, text, id } = message;

  // Location message
  if (type === 'location' && location) {
    const { latitude, longitude, altitude } = location;
    const locationSenderName = isOutgoing ? 'You' : senderName;

    return (
      <View key={id}>
        {isChannel && !isOutgoing && (
          <Text style={chatStyles.channelSenderName}>{senderName}</Text>
        )}
        <TouchableOpacity
          style={[
            chatStyles.messageBubble,
            chatStyles.locationBubble,
            isOutgoing ? chatStyles.outgoingBubble : chatStyles.incomingBubble,
          ]}
          onPress={() => onLocationPress?.(latitude, longitude, locationSenderName)}
          activeOpacity={0.7}
        >
          <View style={chatStyles.locationContent}>
            <Text style={chatStyles.locationIcon}>📍</Text>
            <View style={chatStyles.locationInfo}>
              <Text
                style={[
                  chatStyles.locationTitle,
                  isOutgoing ? chatStyles.outgoingText : chatStyles.incomingText,
                ]}
              >
                Location
              </Text>
              <Text
                style={[
                  chatStyles.locationCoords,
                  isOutgoing ? chatStyles.outgoingCoords : chatStyles.incomingCoords,
                ]}
              >
                {latitude.toFixed(6)}, {longitude.toFixed(6)}
                {altitude ? ` @ ${altitude}m` : ''}
              </Text>
              <Text style={chatStyles.locationHint}>Show on map</Text>
            </View>
          </View>
          <View style={chatStyles.messageFooter}>
            <Text
              style={[
                chatStyles.messageTime,
                isOutgoing ? chatStyles.outgoingTime : chatStyles.incomingTime,
              ]}
            >
              {formatTime(timestamp)}
            </Text>
            <StatusIcon status={status} isOutgoing={isOutgoing} />
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  // Text message
  return (
    <View key={id}>
      {isChannel && !isOutgoing && (
        <Text style={chatStyles.channelSenderName}>{senderName}</Text>
      )}
      <View
        style={[
          chatStyles.messageBubble,
          isOutgoing ? chatStyles.outgoingBubble : chatStyles.incomingBubble,
        ]}
      >
        <Text
          style={[
            chatStyles.messageText,
            isOutgoing ? chatStyles.outgoingText : chatStyles.incomingText,
          ]}
        >
          {text}
        </Text>
        <View style={chatStyles.messageFooter}>
          <Text
            style={[
              chatStyles.messageTime,
              isOutgoing ? chatStyles.outgoingTime : chatStyles.incomingTime,
            ]}
          >
            {formatTime(timestamp)}
          </Text>
          <StatusIcon status={status} isOutgoing={isOutgoing} />
        </View>
      </View>
    </View>
  );
}
