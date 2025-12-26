import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_DEVICE_KEY = '@meshtastic_last_device';

export interface SavedDevice {
  id: string;
  name: string;
  savedAt: number;
}

export interface UseDeviceStorageResult {
  lastDevice: SavedDevice | null;
  isLoading: boolean;
  saveLastDevice: (id: string, name: string) => Promise<void>;
  clearLastDevice: () => Promise<void>;
}

export function useDeviceStorage(): UseDeviceStorageResult {
  const [lastDevice, setLastDevice] = useState<SavedDevice | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load last device on mount
  useEffect(() => {
    loadLastDevice();
  }, []);

  const loadLastDevice = async () => {
    try {
      const stored = await AsyncStorage.getItem(LAST_DEVICE_KEY);
      if (stored) {
        setLastDevice(JSON.parse(stored));
      }
    } catch {
      // Ignore load errors
    } finally {
      setIsLoading(false);
    }
  };

  const saveLastDevice = useCallback(async (id: string, name: string) => {
    try {
      const device: SavedDevice = {
        id,
        name,
        savedAt: Date.now(),
      };
      await AsyncStorage.setItem(LAST_DEVICE_KEY, JSON.stringify(device));
      setLastDevice(device);
    } catch {
      // Ignore save errors
    }
  }, []);

  const clearLastDevice = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(LAST_DEVICE_KEY);
      setLastDevice(null);
    } catch {
      // Ignore errors
    }
  }, []);

  return {
    lastDevice,
    isLoading,
    saveLastDevice,
    clearLastDevice,
  };
}
