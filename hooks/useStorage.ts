import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Message, MqttSettings } from '../types';
import {
  FRIENDS_STORAGE_KEY,
  MESSAGES_STORAGE_KEY,
  LAST_READ_STORAGE_KEY,
  USER_NAME_KEY,
  USER_PHONE_KEY,
  MQTT_SETTINGS_KEY,
} from '../constants/meshtastic';
import { databaseService } from '../services/DatabaseService';

const MIGRATION_DONE_KEY = '@meshtastic/migration_done';

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
  const dbInitialized = useRef(false);

  // Load all data on mount
  useEffect(() => {
    loadFriends();
    initDatabaseAndLoadMessages();
    loadLastRead();
    loadUserName();
    loadUserPhone();
    loadMqttSettings();
  }, []);

  // Initialize database and migrate from AsyncStorage if needed
  const initDatabaseAndLoadMessages = async () => {
    try {
      await databaseService.init();
      dbInitialized.current = true;

      // Check if migration is needed
      const migrationDone = await AsyncStorage.getItem(MIGRATION_DONE_KEY);
      if (!migrationDone) {
        await migrateFromAsyncStorage();
      }

      // Load messages from SQLite
      const dbMessages = await databaseService.getMessages(500);
      setMessages(dbMessages);
    } catch (error) {
      console.error('Failed to initialize database:', error);
      // Fallback to AsyncStorage
      loadMessagesFromAsyncStorage();
    }
  };

  // Migrate messages from AsyncStorage to SQLite
  const migrateFromAsyncStorage = async () => {
    try {
      const stored = await AsyncStorage.getItem(MESSAGES_STORAGE_KEY);
      if (stored) {
        const oldMessages = JSON.parse(stored) as Message[];
        if (oldMessages.length > 0) {
          await databaseService.importMessages(oldMessages);
          console.log(`Migrated ${oldMessages.length} messages to SQLite`);
        }
      }
      // Mark migration as done
      await AsyncStorage.setItem(MIGRATION_DONE_KEY, 'true');
      // Clean up old messages from AsyncStorage
      await AsyncStorage.removeItem(MESSAGES_STORAGE_KEY);
    } catch (error) {
      console.error('Migration failed:', error);
    }
  };

  // Fallback: load messages from AsyncStorage
  const loadMessagesFromAsyncStorage = async () => {
    try {
      const stored = await AsyncStorage.getItem(MESSAGES_STORAGE_KEY);
      if (stored) {
        setMessages(JSON.parse(stored));
      }
    } catch {
      // Ignore load errors
    }
  };

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

  // Messages (SQLite)
  const addMessage = useCallback((message: Message) => {
    // Optimistic update for UI
    setMessages(prev => {
      // Check for duplicates in current state
      const isDuplicate = prev.some(
        m => m.from === message.from &&
          m.to === message.to &&
          m.text === message.text &&
          Math.abs(m.timestamp - message.timestamp) < 5000
      );

      if (isDuplicate) return prev;
      return [...prev, message];
    });

    // Persist to SQLite
    if (dbInitialized.current) {
      databaseService.addMessage(message).catch(error => {
        console.error('Failed to save message to SQLite:', error);
      });
    }
  }, []);

  const updateMessageStatus = useCallback((packetId: number, success: boolean) => {
    const status = success ? 'delivered' : 'failed';

    // Optimistic update for UI
    setMessages(prev =>
      prev.map(m =>
        m.packetId === packetId
          ? { ...m, status: status as Message['status'] }
          : m
      )
    );

    // Persist to SQLite
    if (dbInitialized.current) {
      databaseService.updateMessageStatus(packetId, status).catch(error => {
        console.error('Failed to update message status in SQLite:', error);
      });
    }
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
