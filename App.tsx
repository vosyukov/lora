import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  PermissionsAndroid,
  Platform,
  Alert
} from 'react-native';
import { useState, useEffect } from 'react';
import { BleManager, Device, State } from 'react-native-ble-plx';

const bleManager = new BleManager();

interface ScannedDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

export default function App() {
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [bluetoothState, setBluetoothState] = useState<State>(State.Unknown);

  useEffect(() => {
    const subscription = bleManager.onStateChange((state) => {
      setBluetoothState(state);
      if (state === State.PoweredOn) {
        console.log('Bluetooth is powered on');
      }
    }, true);

    return () => {
      subscription.remove();
      bleManager.destroy();
    };
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      if (Platform.Version >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);

        return (
          granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    return true;
  };

  const startScan = async () => {
    if (bluetoothState !== State.PoweredOn) {
      Alert.alert('Bluetooth is not enabled', 'Please enable Bluetooth to scan for devices');
      return;
    }

    const hasPermission = await requestPermissions();
    if (!hasPermission) {
      Alert.alert('Permission denied', 'Bluetooth permissions are required to scan for devices');
      return;
    }

    setDevices([]);
    setIsScanning(true);

    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error('Scan error:', error);
        setIsScanning(false);
        Alert.alert('Scan Error', error.message);
        return;
      }

      if (device) {
        setDevices(prevDevices => {
          const existingIndex = prevDevices.findIndex(d => d.id === device.id);
          const newDevice: ScannedDevice = {
            id: device.id,
            name: device.name,
            rssi: device.rssi,
          };

          if (existingIndex !== -1) {
            const updatedDevices = [...prevDevices];
            updatedDevices[existingIndex] = newDevice;
            return updatedDevices;
          }
          return [...prevDevices, newDevice];
        });
      }
    });

    setTimeout(() => {
      stopScan();
    }, 10000);
  };

  const stopScan = () => {
    bleManager.stopDeviceScan();
    setIsScanning(false);
  };

  const renderDevice = ({ item }: { item: ScannedDevice }) => (
    <View style={styles.deviceItem}>
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>
          {item.name || 'Unknown Device'}
        </Text>
        <Text style={styles.deviceId}>{item.id}</Text>
      </View>
      <Text style={styles.rssi}>{item.rssi} dBm</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />

      <View style={styles.header}>
        <Text style={styles.title}>BLE Scanner</Text>
        <Text style={styles.subtitle}>
          Bluetooth: {bluetoothState === State.PoweredOn ? 'ON' : 'OFF'}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.button, isScanning && styles.buttonScanning]}
        onPress={isScanning ? stopScan : startScan}
        disabled={bluetoothState !== State.PoweredOn && !isScanning}
      >
        <Text style={styles.buttonText}>
          {isScanning ? 'Stop Scanning' : 'Start Scanning'}
        </Text>
      </TouchableOpacity>

      <View style={styles.devicesContainer}>
        <Text style={styles.devicesCount}>
          Found {devices.length} device{devices.length !== 1 ? 's' : ''}
        </Text>

        <FlatList
          data={devices}
          renderItem={renderDevice}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {isScanning ? 'Scanning for devices...' : 'No devices found'}
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: 50,
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 16,
    margin: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonScanning: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  devicesContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  devicesCount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  deviceItem: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 10,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  deviceId: {
    fontSize: 12,
    color: '#999',
  },
  rssi: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
});
