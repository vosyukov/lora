import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  PermissionsAndroid,
  ActivityIndicator,
} from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';
import DeviceDetailScreen from './DeviceDetailScreen';

const bleManager = new BleManager();
const MESHTASTIC_SERVICE_UUID = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';

interface ScannedDevice {
  id: string;
  name: string | null;
  rssi: number | null;
  isMeshtastic: boolean;
  device: Device;
}

export default function HomeScreen() {
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [bluetoothState, setBluetoothState] = useState<State>(State.Unknown);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  useEffect(() => {
    // Подписка на состояние Bluetooth
    const subscription = bleManager.onStateChange((state) => {
      setBluetoothState(state);
    }, true);

    // Проверка и запрос разрешений при монтировании
    requestPermissions();

    return () => {
      subscription.remove();
      bleManager.stopDeviceScan();
      // Не уничтожаем bleManager здесь, так как он глобальный
    };
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      if (Platform.Version >= 31) {
        // Android 12+
        try {
          const granted = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ]);

          const allGranted = Object.values(granted).every(
            (status) => status === PermissionsAndroid.RESULTS.GRANTED
          );

          if (!allGranted) {
            console.log('Не все разрешения предоставлены');
          }
        } catch (err) {
          console.warn('Ошибка запроса разрешений:', err);
        }
      } else {
        // Android 11 и ниже
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
          );

          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            console.log('Разрешение на геолокацию не предоставлено');
          }
        } catch (err) {
          console.warn('Ошибка запроса разрешения:', err);
        }
      }
    }
  };

  const startScan = () => {
    if (bluetoothState !== State.PoweredOn) {
      console.log('Bluetooth не включен');
      return;
    }

    setDevices([]);
    setScanning(true);

    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error('Ошибка сканирования:', error);
        setScanning(false);
        return;
      }

      if (device) {
        const isMeshtastic = checkIfMeshtastic(device);

        setDevices((prevDevices) => {
          const existingIndex = prevDevices.findIndex((d) => d.id === device.id);

          const newDevice: ScannedDevice = {
            id: device.id,
            name: device.name,
            rssi: device.rssi,
            isMeshtastic,
            device,
          };

          if (existingIndex !== -1) {
            // Обновляем существующее устройство
            const updated = [...prevDevices];
            updated[existingIndex] = newDevice;
            return updated;
          } else {
            // Добавляем новое устройство
            return [...prevDevices, newDevice];
          }
        });
      }
    });

    // Остановить сканирование через 10 секунд
    setTimeout(() => {
      bleManager.stopDeviceScan();
      setScanning(false);
    }, 10000);
  };

  const stopScan = () => {
    bleManager.stopDeviceScan();
    setScanning(false);
  };

  const checkIfMeshtastic = (device: Device): boolean => {
    // Проверяем имя устройства
    if (device.name?.toLowerCase().includes('meshtastic')) {
      return true;
    }

    // Проверяем UUID сервиса (если доступно в advertised data)
    if (device.serviceUUIDs) {
      return device.serviceUUIDs.some(
        (uuid) => uuid.toLowerCase() === MESHTASTIC_SERVICE_UUID.toLowerCase()
      );
    }

    return false;
  };

  const connectToDevice = async (device: Device) => {
    try {
      // Остановить сканирование перед подключением
      if (scanning) {
        bleManager.stopDeviceScan();
        setScanning(false);
      }

      // Открыть экран деталей устройства
      setSelectedDevice(device);
    } catch (error) {
      console.error('Ошибка подключения:', error);
    }
  };

  const handleBackFromDevice = () => {
    setSelectedDevice(null);
  };

  const renderDevice = ({ item }: { item: ScannedDevice }) => (
    <TouchableOpacity
      style={[
        styles.deviceItem,
        item.isMeshtastic && styles.meshtasticDevice,
      ]}
      onPress={() => connectToDevice(item.device)}
    >
      <View style={styles.deviceInfo}>
        <Text style={[styles.deviceName, item.isMeshtastic && styles.meshtasticText]}>
          {item.name || 'Неизвестное устройство'}
        </Text>
        {item.isMeshtastic && (
          <View style={styles.meshtasticBadge}>
            <Text style={styles.badgeText}>MESHTASTIC</Text>
          </View>
        )}
        <Text style={styles.deviceId}>{item.id}</Text>
      </View>
      <Text style={styles.rssi}>{item.rssi} dBm</Text>
    </TouchableOpacity>
  );

  const getBluetoothStateText = () => {
    switch (bluetoothState) {
      case State.PoweredOn:
        return 'Bluetooth включен';
      case State.PoweredOff:
        return 'Bluetooth выключен';
      case State.Unauthorized:
        return 'Нет разрешения на Bluetooth';
      case State.Unsupported:
        return 'Bluetooth не поддерживается';
      default:
        return 'Проверка Bluetooth...';
    }
  };

  // Если устройство выбрано, показать экран деталей
  if (selectedDevice) {
    return (
      <DeviceDetailScreen
        device={selectedDevice}
        bleManager={bleManager}
        onBack={handleBackFromDevice}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Сканер устройств</Text>
        <Text style={styles.bluetoothState}>{getBluetoothStateText()}</Text>
      </View>

      <View style={styles.controls}>
        {!scanning ? (
          <TouchableOpacity
            style={[
              styles.scanButton,
              bluetoothState !== State.PoweredOn && styles.scanButtonDisabled,
            ]}
            onPress={startScan}
            disabled={bluetoothState !== State.PoweredOn}
          >
            <Text style={styles.scanButtonText}>Начать сканирование</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={stopScan}>
            <ActivityIndicator color="#fff" style={styles.spinner} />
            <Text style={styles.scanButtonText}>Остановить сканирование</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.deviceCount}>
          Найдено устройств: {devices.length}
          {devices.filter((d) => d.isMeshtastic).length > 0 &&
            ` (${devices.filter((d) => d.isMeshtastic).length} Meshtastic)`}
        </Text>
      </View>

      <FlatList
        data={devices.sort((a, b) => {
          // Сначала Meshtastic устройства, затем по RSSI
          if (a.isMeshtastic && !b.isMeshtastic) return -1;
          if (!a.isMeshtastic && b.isMeshtastic) return 1;
          return (b.rssi || -100) - (a.rssi || -100);
        })}
        keyExtractor={(item) => item.id}
        renderItem={renderDevice}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {scanning
                ? 'Поиск устройств...'
                : 'Нажмите кнопку для начала сканирования'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  bluetoothState: {
    fontSize: 14,
    color: '#666',
  },
  controls: {
    padding: 15,
  },
  scanButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  scanButtonDisabled: {
    backgroundColor: '#ccc',
  },
  stopButton: {
    backgroundColor: '#FF3B30',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  spinner: {
    marginRight: 10,
  },
  listHeader: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  deviceCount: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  listContent: {
    padding: 10,
  },
  deviceItem: {
    backgroundColor: '#fff',
    padding: 15,
    marginVertical: 5,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  meshtasticDevice: {
    backgroundColor: '#E8F5E9',
    borderColor: '#4CAF50',
    borderWidth: 2,
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
  meshtasticText: {
    color: '#2E7D32',
  },
  meshtasticBadge: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
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
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
});
