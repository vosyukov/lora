import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';

import DeviceDetailScreen from './DeviceDetailScreen';
import ScannerModal from '../components/ScannerModal';
import { MESHTASTIC_SERVICE_UUID, LAST_DEVICE_KEY } from '../constants/meshtastic';

const bleManager = new BleManager();

const colors = {
  primary: '#2AABEE',
  background: '#FFFFFF',
  text: '#000000',
  textSecondary: '#8E8E93',
};

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
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Monitor bluetooth state
  useEffect(() => {
    const subscription = bleManager.onStateChange((state) => {
      setBluetoothState(state);
    }, true);

    requestPermissions();
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
    if (connectionState !== 'loading') return;
    if (bluetoothState !== State.PoweredOn) {
      if (bluetoothState === State.PoweredOff || bluetoothState === State.Unauthorized) {
        setConnectionState('offline');
      }
      return;
    }

    // Bluetooth is on, check if we have a saved device
    if (savedDevice) {
      autoConnectToSavedDevice();
    } else if (savedDevice === null) {
      // No saved device, show scanner
      setConnectionState('offline');
      setShowScanner(true);
    }
  }, [bluetoothState, savedDevice, connectionState]);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      if (Platform.Version >= 31) {
        try {
          await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ]);
        } catch {
          // Ignore errors
        }
      } else {
        try {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
          );
        } catch {
          // Ignore errors
        }
      }
    }
  };

  const loadSavedDevice = async () => {
    try {
      const stored = await AsyncStorage.getItem(LAST_DEVICE_KEY);
      if (stored) {
        setSavedDevice(JSON.parse(stored));
      } else {
        setSavedDevice(null);
      }
    } catch {
      setSavedDevice(null);
    }
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
    if (!savedDevice) return;

    setConnectionState('auto_connecting');
    let deviceFound = false;

    bleManager.startDeviceScan(
      [MESHTASTIC_SERVICE_UUID],
      { allowDuplicates: false },
      async (error, device) => {
        if (error) {
          bleManager.stopDeviceScan();
          setConnectionState('offline');
          return;
        }

        if (device && device.id === savedDevice.id) {
          deviceFound = true;
          bleManager.stopDeviceScan();
          if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current);
          }

          try {
            await device.connect();
            setConnectedDevice(device);
            setConnectionState('connected');
          } catch {
            setConnectionState('offline');
          }
        }
      }
    );

    // Timeout for auto-connect scan
    scanTimeoutRef.current = setTimeout(() => {
      if (!deviceFound) {
        bleManager.stopDeviceScan();
        setConnectionState('offline');
      }
    }, 10000);
  };

  const handleDeviceConnected = (device: Device, deviceName: string) => {
    setShowScanner(false);
    setConnectedDevice(device);
    saveDevice(device.id, deviceName);
    setConnectionState('connected');
  };

  const handleDisconnect = () => {
    clearSavedDevice();
    setConnectedDevice(null);
    setConnectionState('offline');
    setShowScanner(true);
  };

  const handleOpenScanner = () => {
    setShowScanner(true);
  };

  // Loading state
  if (connectionState === 'loading' || connectionState === 'auto_connecting') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>
          {connectionState === 'loading' ? 'Загрузка...' : 'Подключение к рации...'}
        </Text>
        {connectionState === 'auto_connecting' && (
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
            <Text style={styles.cancelButtonText}>Отмена</Text>
          </TouchableOpacity>
        )}
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
  cancelButton: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  cancelButtonText: {
    fontSize: 17,
    color: colors.primary,
  },
});
