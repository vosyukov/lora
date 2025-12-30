import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Message, MqttSettings } from '../types';
import {
  FRIENDS_STORAGE_KEY,
  MESSAGES_STORAGE_KEY,
  LAST_READ_STORAGE_KEY,
  USER_NAME_KEY,
  USER_PHONE_KEY,
  MQTT_SETTINGS_KEY,
  MAX_STORED_MESSAGES,
} from '../constants/meshtastic';

// Default MQTT settings (HiveMQ Cloud)
const DEFAULT_MQTT_SETTINGS: MqttSettings = {
  enabled: true,
  address: 'f40da9e7259b4a63884d57bd7cbbbf97.s1.eu.hivemq.cloud',
  username: 'testtest',
  password: 'Test1991',
  encryptionEnabled: true,
  tlsEnabled: true, // Port 8883
  root: 'msh',
  proxyToClientEnabled: false, // Radio connects to MQTT directly via WiFi
};

export interface UseStorageResult {
  // Friends
  friendIds: Set<number>;
  addFriend: (nodeNum: number) => Promise<void>;
  removeFriend: (nodeNum: number) => Promise<void>;
  isFriend: (nodeNum: number) => boolean;

  // Messages
  messages: Message[];
  addMessage: (message: Message) => void;
  updateMessageStatus: (packetId: number, success: boolean) => void;

  // Last read timestamps
  lastReadTimestamps: Record<string, number>;
  markChatAsRead: (chatKey: string) => void;
  getUnreadCount: (chatKey: string, chatMessages: Message[]) => number;

  // User profile
  userName: string | null;
  setUserName: (name: string) => Promise<void>;
  userPhone: string | null;
  setUserPhone: (phone: string) => Promise<void>;

  // MQTT settings
  mqttSettings: MqttSettings;
  setMqttSettings: (settings: MqttSettings) => Promise<void>;
}

export function useStorage(): UseStorageResult {
  const [friendIds, setFriendIds] = useState<Set<number>>(new Set());
  const [messages, setMessages] = useState<Message[]>([]);
  const [lastReadTimestamps, setLastReadTimestamps] = useState<Record<string, number>>({});
  const [userName, setUserNameState] = useState<string | null>(null);
  const [userPhone, setUserPhoneState] = useState<string | null>(null);
  const [mqttSettings, setMqttSettingsState] = useState<MqttSettings>(DEFAULT_MQTT_SETTINGS);

  // Load all data on mount
  useEffect(() => {
    loadFriends();
    loadMessages();
    loadLastRead();
    loadUserName();
    loadUserPhone();
    loadMqttSettings();
  }, []);

  // Friends
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

  const addFriend = useCallback(async (nodeNum: number) => {
    setFriendIds(prev => {
      const next = new Set(prev);
      next.add(nodeNum);
      saveFriends(next);
      return next;
    });
  }, []);

  const removeFriend = useCallback(async (nodeNum: number) => {
    setFriendIds(prev => {
      const next = new Set(prev);
      next.delete(nodeNum);
      saveFriends(next);
      return next;
    });
  }, []);

  const isFriend = useCallback((nodeNum: number) => {
    return friendIds.has(nodeNum);
  }, [friendIds]);

  // Messages
  const loadMessages = async () => {
    try {
      const stored = await AsyncStorage.getItem(MESSAGES_STORAGE_KEY);
      if (stored) {
        setMessages(JSON.parse(stored));
      }
    } catch {
      // Ignore load errors
    }
  };

  const saveMessages = async (msgs: Message[]) => {
    try {
      const toStore = msgs.slice(-MAX_STORED_MESSAGES);
      await AsyncStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // Ignore save errors
    }
  };

  const addMessage = useCallback((message: Message) => {
    setMessages(prev => {
      // Check for duplicates
      const isDuplicate = prev.some(
        m => m.from === message.from &&
          m.to === message.to &&
          m.text === message.text &&
          Math.abs(m.timestamp - message.timestamp) < 5000
      );

      if (isDuplicate) return prev;

      const updated = [...prev, message];
      saveMessages(updated);
      return updated;
    });
  }, []);

  const updateMessageStatus = useCallback((packetId: number, success: boolean) => {
    setMessages(prev => {
      const updated: Message[] = prev.map(m =>
        m.packetId === packetId
          ? { ...m, status: (success ? 'delivered' : 'failed') as Message['status'] }
          : m
      );
      saveMessages(updated);
      return updated;
    });
  }, []);

  // Last read timestamps
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

  const markChatAsRead = useCallback((chatKey: string) => {
    setLastReadTimestamps(prev => {
      const updated = { ...prev, [chatKey]: Date.now() };
      AsyncStorage.setItem(LAST_READ_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const getUnreadCount = useCallback((chatKey: string, chatMessages: Message[]) => {
    const lastRead = lastReadTimestamps[chatKey] || 0;
    return chatMessages.filter(m => !m.isOutgoing && m.timestamp > lastRead).length;
  }, [lastReadTimestamps]);

  // User name
  const loadUserName = async () => {
    try {
      const stored = await AsyncStorage.getItem(USER_NAME_KEY);
      if (stored) {
        setUserNameState(stored);
      }
    } catch {
      // Ignore load errors
    }
  };

  const setUserName = useCallback(async (name: string) => {
    try {
      await AsyncStorage.setItem(USER_NAME_KEY, name);
      setUserNameState(name);
    } catch {
      // Ignore save errors
    }
  }, []);

  // User phone
  const loadUserPhone = async () => {
    try {
      const stored = await AsyncStorage.getItem(USER_PHONE_KEY);
      if (stored) {
        setUserPhoneState(stored);
      }
    } catch {
      // Ignore load errors
    }
  };

  const setUserPhone = useCallback(async (phone: string) => {
    try {
      await AsyncStorage.setItem(USER_PHONE_KEY, phone);
      setUserPhoneState(phone);
    } catch {
      // Ignore save errors
    }
  }, []);

  // MQTT settings
  const loadMqttSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(MQTT_SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<MqttSettings>;
        setMqttSettingsState({ ...DEFAULT_MQTT_SETTINGS, ...parsed });
      }
    } catch {
      // Ignore load errors
    }
  };

  const setMqttSettings = useCallback(async (settings: MqttSettings) => {
    try {
      await AsyncStorage.setItem(MQTT_SETTINGS_KEY, JSON.stringify(settings));
      setMqttSettingsState(settings);
    } catch {
      // Ignore save errors
    }
  }, []);

  return {
    friendIds,
    addFriend,
    removeFriend,
    isFriend,
    messages,
    addMessage,
    updateMessageStatus,
    lastReadTimestamps,
    markChatAsRead,
    getUnreadCount,
    userName,
    setUserName,
    userPhone,
    setUserPhone,
    mqttSettings,
    setMqttSettings,
  };
}
