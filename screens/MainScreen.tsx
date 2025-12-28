import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';

import DeviceDetailScreen from './DeviceDetailScreen';
import ScannerModal from '../components/ScannerModal';
import { MESHTASTIC_SERVICE_UUID, LAST_DEVICE_KEY, COLORS } from '../constants/meshtastic';
import { requestBlePermissions } from '../utils/ble';

const bleManager = new BleManager();

// Use shared colors from constants
const colors = COLORS;

type ConnectionState = 'loading' | 'auto_connecting' | 'offline' | 'connected';

interface SavedDevice {
  id: string;
  name: string;
  savedAt: number;
}

export default function MainScreen() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('loading');
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [savedDevice, setSavedDevice] = useState<SavedDevice | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [bluetoothState, setBluetoothState] = useState<State>(State.Unknown);
  const [savedDeviceLoaded, setSavedDeviceLoaded] = useState(false);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Monitor bluetooth state
  useEffect(() => {
    const subscription = bleManager.onStateChange((state) => {
      setBluetoothState(state);
    }, true);

    requestBlePermissions();
    loadSavedDevice();

    return () => {
      subscription.remove();
      bleManager.stopDeviceScan();
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, []);

  // Auto-connect when bluetooth is ready and we have a saved device
  useEffect(() => {
    console.log('[MainScreen] Auto-connect effect:', {
      connectionState,
      savedDeviceLoaded,
      bluetoothState,
      savedDevice: savedDevice?.id || 'null',
    });

    if (connectionState !== 'loading') {
      console.log('[MainScreen] Skipping - not in loading state');
      return;
    }
    if (!savedDeviceLoaded) {
      console.log('[MainScreen] Skipping - savedDevice not loaded yet');
      return;
    }

    if (bluetoothState !== State.PoweredOn) {
      if (bluetoothState === State.PoweredOff || bluetoothState === State.Unauthorized) {
        console.log('[MainScreen] Bluetooth off/unauthorized, going offline');
        // No bluetooth - go to offline mode without prompt
        setConnectionState('offline');
      } else {
        console.log('[MainScreen] Waiting for bluetooth, state:', bluetoothState);
      }
      return;
    }

    // Bluetooth is on, check if we have a saved device
    if (savedDevice) {
      console.log('[MainScreen] Bluetooth on, have saved device, auto-connecting...');
      autoConnectToSavedDevice();
    } else {
      console.log('[MainScreen] Bluetooth on but no saved device, going offline');
      // No saved device - go to offline mode
      setConnectionState('offline');
    }
  }, [bluetoothState, savedDevice, savedDeviceLoaded, connectionState]);

  const loadSavedDevice = async () => {
    console.log('[MainScreen] loadSavedDevice starting...');
    try {
      const stored = await AsyncStorage.getItem(LAST_DEVICE_KEY);
      console.log('[MainScreen] Stored device data:', stored);
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log('[MainScreen] Parsed saved device:', parsed);
        setSavedDevice(parsed);
      } else {
        console.log('[MainScreen] No saved device in storage');
        setSavedDevice(null);
      }
    } catch (err) {
      console.log('[MainScreen] Error loading saved device:', err);
      setSavedDevice(null);
    }
    setSavedDeviceLoaded(true);
  };

  const saveDevice = async (id: string, name: string) => {
    try {
      const device: SavedDevice = { id, name, savedAt: Date.now() };
      await AsyncStorage.setItem(LAST_DEVICE_KEY, JSON.stringify(device));
      setSavedDevice(device);
    } catch {
      // Ignore errors
    }
  };

  const clearSavedDevice = async () => {
    try {
      await AsyncStorage.removeItem(LAST_DEVICE_KEY);
      setSavedDevice(null);
    } catch {
      // Ignore errors
    }
  };

  const autoConnectToSavedDevice = () => {
    if (!savedDevice) {
      console.log('[MainScreen] autoConnectToSavedDevice: no saved device');
      return;
    }

    console.log('[MainScreen] autoConnectToSavedDevice starting, looking for:', savedDevice.id);
    setConnectionState('auto_connecting');
    let deviceFound = false;

    bleManager.startDeviceScan(
      [MESHTASTIC_SERVICE_UUID],
      { allowDuplicates: false },
      async (error, device) => {
        if (error) {
          console.log('[MainScreen] Scan error:', error);
          bleManager.stopDeviceScan();
          setConnectionState('offline');
          return;
        }

        if (device) {
          console.log('[MainScreen] Found device:', device.id, device.name, 'looking for:', savedDevice.id);
        }

        if (device && device.id === savedDevice.id) {
          console.log('[MainScreen] Found target device!');
          deviceFound = true;
          bleManager.stopDeviceScan();
          if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current);
          }

          try {
            console.log('[MainScreen] Connecting to device...');
            await device.connect();
            console.log('[MainScreen] Connected successfully!');
            setConnectedDevice(device);
            setConnectionState('connected');
          } catch (err) {
            console.log('[MainScreen] Connection failed:', err);
            setConnectionState('offline');
          }
        }
      }
    );

    // Timeout for auto-connect scan
    scanTimeoutRef.current = setTimeout(() => {
      if (!deviceFound) {
        console.log('[MainScreen] Scan timeout - device not found');
        bleManager.stopDeviceScan();
        setConnectionState('offline');
      }
    }, 10000);
  };

  const handleDeviceConnected = (device: Device, deviceName: string) => {
    console.log('[MainScreen] handleDeviceConnected:', device.id, deviceName);
    setShowScanner(false);
    setConnectedDevice(device);
    saveDevice(device.id, deviceName);
    setConnectionState('connected');
  };

  const handleDisconnect = () => {
    clearSavedDevice();
    setConnectedDevice(null);
    setConnectionState('offline');
  };

  const handleOpenScanner = () => {
    setShowScanner(true);
  };

  // Loading state
  if (connectionState === 'loading') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Загрузка...</Text>
      </View>
    );
  }

  // Auto-connecting to saved device
  if (connectionState === 'auto_connecting' && savedDevice) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.deviceIconCircle}>
          <Text style={styles.deviceIconEmoji}>📻</Text>
        </View>

        <Text style={styles.autoConnectTitle}>Подключение к рации</Text>

        <View style={styles.savedDeviceCard}>
          <Text style={styles.savedDeviceName}>{savedDevice.name}</Text>
          <View style={styles.savedDeviceStatus}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.savedDeviceStatusText}>Поиск...</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => {
            console.log('[MainScreen] Skip auto-connect, opening scanner');
            bleManager.stopDeviceScan();
            if (scanTimeoutRef.current) {
              clearTimeout(scanTimeoutRef.current);
            }
            setConnectionState('offline');
            setShowScanner(true);
          }}
        >
          <Text style={styles.skipButtonText}>Подключиться к другой рации</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => {
            bleManager.stopDeviceScan();
            if (scanTimeoutRef.current) {
              clearTimeout(scanTimeoutRef.current);
            }
            setConnectionState('offline');
          }}
        >
          <Text style={styles.cancelButtonText}>Продолжить без рации</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Connected or offline - show main UI
  return (
    <>
      <DeviceDetailScreen
        device={connectedDevice}
        bleManager={bleManager}
        onBack={handleDisconnect}
        onOpenScanner={handleOpenScanner}
        isOffline={connectionState === 'offline'}
      />

      <ScannerModal
        visible={showScanner}
        bleManager={bleManager}
        onClose={() => setShowScanner(false)}
        onDeviceConnected={handleDeviceConnected}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 17,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // Auto-connect screen
  deviceIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F4F4F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  deviceIconEmoji: {
    fontSize: 48,
  },
  autoConnectTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 24,
  },
  savedDeviceCard: {
    backgroundColor: '#F4F4F5',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    width: '100%',
    alignItems: 'center',
    marginBottom: 32,
  },
  savedDeviceName: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  savedDeviceStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  savedDeviceStatusText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  skipButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  skipButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  cancelButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  cancelButtonText: {
    fontSize: 17,
    color: colors.textSecondary,
  },
});
