import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  PermissionsAndroid,
  ActivityIndicator,
  Animated,
  Easing,
  ScrollView,
  Linking,
} from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';
import { MESHTASTIC_SERVICE_UUID } from '../constants/meshtastic';

const colors = {
  primary: '#2AABEE',
  primaryDark: '#229ED9',
  background: '#FFFFFF',
  backgroundGray: '#F4F4F5',
  text: '#000000',
  textSecondary: '#8E8E93',
  textHint: '#999999',
  success: '#31B545',
  error: '#FF3B30',
  warning: '#FF9500',
  border: '#E5E5EA',
  cardBackground: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

type ScanStep =
  | 'welcome'
  | 'scanning'
  | 'found_one'
  | 'found_many'
  | 'not_found'
  | 'connecting'
  | 'error';

interface MeshtasticDevice {
  id: string;
  name: string;
  rssi: number;
  signalPercent: number;
  device: Device;
}

interface ScannerModalProps {
  visible: boolean;
  bleManager: BleManager;
  onClose: () => void;
  onDeviceConnected: (device: Device, deviceName: string) => void;
}

export default function ScannerModal({
  visible,
  bleManager,
  onClose,
  onDeviceConnected,
}: ScannerModalProps) {
  const [step, setStep] = useState<ScanStep>('welcome');
  const [devices, setDevices] = useState<MeshtasticDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<MeshtasticDevice | null>(null);
  const [bluetoothState, setBluetoothState] = useState<State>(State.Unknown);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Monitor bluetooth state
  useEffect(() => {
    const subscription = bleManager.onStateChange((state) => {
      setBluetoothState(state);
    }, true);

    return () => {
      subscription.remove();
    };
  }, [bleManager]);

  // Request permissions when modal opens
  useEffect(() => {
    if (visible) {
      requestPermissions();
      setStep('welcome');
      setDevices([]);
      setSelectedDevice(null);
      setErrorMessage('');
    } else {
      bleManager.stopDeviceScan();
    }
  }, [visible]);

  // Pulse animation for icon
  useEffect(() => {
    if (step === 'welcome' || step === 'scanning') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [step, pulseAnim]);

  // Progress bar for scanning
  useEffect(() => {
    if (step === 'scanning') {
      progressAnim.setValue(0);
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    }
  }, [step, progressAnim]);

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

  const rssiToPercent = (rssi: number): number => {
    const minRssi = -100;
    const maxRssi = -30;
    const percent = ((rssi - minRssi) / (maxRssi - minRssi)) * 100;
    return Math.max(0, Math.min(100, Math.round(percent)));
  };

  const getDeviceName = (device: Device): string => {
    if (device.name) {
      return device.name.replace(/^Meshtastic_?/i, '').trim() || 'Рация';
    }
    return 'Рация';
  };

  const startScan = () => {
    if (bluetoothState !== State.PoweredOn) {
      setStep('error');
      setErrorMessage('bluetooth_off');
      return;
    }

    setDevices([]);
    setStep('scanning');

    const foundDevices: Map<string, MeshtasticDevice> = new Map();

    bleManager.startDeviceScan(
      [MESHTASTIC_SERVICE_UUID],
      { allowDuplicates: true },
      (error, device) => {
        if (error) {
          setStep('error');
          setErrorMessage('scan_error');
          return;
        }

        if (device) {
          const meshtasticDevice: MeshtasticDevice = {
            id: device.id,
            name: getDeviceName(device),
            rssi: device.rssi || -100,
            signalPercent: rssiToPercent(device.rssi || -100),
            device,
          };

          foundDevices.set(device.id, meshtasticDevice);
          setDevices(Array.from(foundDevices.values()));
        }
      }
    );

    setTimeout(() => {
      bleManager.stopDeviceScan();

      const deviceList = Array.from(foundDevices.values());

      if (deviceList.length === 0) {
        setStep('not_found');
      } else if (deviceList.length === 1) {
        setSelectedDevice(deviceList[0]);
        setStep('found_one');
      } else {
        deviceList.sort((a, b) => b.rssi - a.rssi);
        setDevices(deviceList);
        setStep('found_many');
      }
    }, 8000);
  };

  const stopScan = () => {
    bleManager.stopDeviceScan();
    setStep('welcome');
  };

  const selectDevice = (device: MeshtasticDevice) => {
    setSelectedDevice(device);
    connectToDevice(device);
  };

  const connectToDevice = async (device: MeshtasticDevice) => {
    setStep('connecting');

    try {
      await device.device.connect();
      onDeviceConnected(device.device, device.name);
    } catch {
      setStep('error');
      setErrorMessage('connection_failed');
    }
  };

  const resetScan = () => {
    setStep('welcome');
    setDevices([]);
    setSelectedDevice(null);
    setErrorMessage('');
  };

  const openBluetoothSettings = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS');
    } else {
      Linking.openURL('App-Prefs:Bluetooth');
    }
  };

  const renderSignalIndicator = (percent: number) => {
    const bars = 4;
    const filledBars = Math.ceil((percent / 100) * bars);

    return (
      <View style={styles.signalContainer}>
        {Array.from({ length: bars }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.signalBar,
              { height: 6 + i * 3 },
              i < filledBars ? styles.signalBarActive : styles.signalBarInactive,
            ]}
          />
        ))}
      </View>
    );
  };

  const renderContent = () => {
    // WELCOME
    if (step === 'welcome') {
      return (
        <View style={styles.content}>
          <Animated.View
            style={[
              styles.iconCircle,
              { transform: [{ scale: pulseAnim }] }
            ]}
          >
            <Text style={styles.iconEmoji}>📻</Text>
          </Animated.View>

          <Text style={styles.title}>Подключение рации</Text>

          <Text style={styles.description}>
            Включите вашу рацию и убедитесь, что она находится рядом
          </Text>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              bluetoothState !== State.PoweredOn && styles.primaryButtonDisabled,
            ]}
            onPress={startScan}
            disabled={bluetoothState !== State.PoweredOn}
            activeOpacity={0.7}
          >
            <Text style={styles.primaryButtonText}>Найти рацию</Text>
          </TouchableOpacity>

          {bluetoothState !== State.PoweredOn && (
            <TouchableOpacity
              style={styles.warningCard}
              onPress={openBluetoothSettings}
              activeOpacity={0.7}
            >
              <View style={styles.warningIconContainer}>
                <Text style={styles.warningIcon}>⚠️</Text>
              </View>
              <View style={styles.warningContent}>
                <Text style={styles.warningTitle}>Bluetooth выключен</Text>
                <Text style={styles.warningText}>Нажмите, чтобы включить</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.textButton}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.textButtonLabel}>Отмена</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // SCANNING
    if (step === 'scanning') {
      const progressWidth = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
      });

      return (
        <View style={styles.content}>
          <Animated.View
            style={[
              styles.iconCircle,
              { transform: [{ scale: pulseAnim }] }
            ]}
          >
            <ActivityIndicator size="large" color={colors.primary} />
          </Animated.View>

          <Text style={styles.title}>Поиск рации</Text>

          <Text style={styles.description}>
            {devices.length > 0
              ? `Найдено устройств: ${devices.length}`
              : 'Ищем устройства поблизости...'}
          </Text>

          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[styles.progressFill, { width: progressWidth }]}
              />
            </View>
          </View>

          <View style={styles.hintCard}>
            <Text style={styles.hintIcon}>💡</Text>
            <Text style={styles.hintText}>
              Убедитесь, что светодиод на рации мигает
            </Text>
          </View>

          <TouchableOpacity
            style={styles.textButton}
            onPress={stopScan}
            activeOpacity={0.7}
          >
            <Text style={styles.textButtonLabel}>Отмена</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // FOUND ONE
    if (step === 'found_one' && selectedDevice) {
      return (
        <View style={styles.content}>
          <View style={styles.successCircle}>
            <Text style={styles.successCheck}>✓</Text>
          </View>

          <Text style={styles.title}>Рация найдена</Text>

          <TouchableOpacity
            style={styles.deviceCard}
            onPress={() => connectToDevice(selectedDevice)}
            activeOpacity={0.7}
          >
            <View style={styles.deviceAvatar}>
              <Text style={styles.deviceAvatarText}>📻</Text>
            </View>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>{selectedDevice.name}</Text>
              <Text style={styles.deviceStatus}>Готова к подключению</Text>
            </View>
            {renderSignalIndicator(selectedDevice.signalPercent)}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => connectToDevice(selectedDevice)}
            activeOpacity={0.7}
          >
            <Text style={styles.primaryButtonText}>Подключить</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.textButton}
            onPress={resetScan}
            activeOpacity={0.7}
          >
            <Text style={styles.textButtonLabel}>Это не моя рация</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // FOUND MANY
    if (step === 'found_many') {
      return (
        <View style={styles.listContainer}>
          <View style={styles.listHeader}>
            <TouchableOpacity
              style={styles.headerBackButton}
              onPress={resetScan}
              activeOpacity={0.7}
            >
              <Text style={styles.headerBackText}>‹ Назад</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Выбор рации</Text>
            <View style={styles.headerRight} />
          </View>

          <ScrollView style={styles.deviceList} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionHeader}>НАЙДЕННЫЕ УСТРОЙСТВА</Text>

            {devices.map((device, index) => (
              <TouchableOpacity
                key={device.id}
                style={styles.deviceListItem}
                onPress={() => selectDevice(device)}
                activeOpacity={0.7}
              >
                <View style={styles.deviceAvatar}>
                  <Text style={styles.deviceAvatarText}>📻</Text>
                </View>
                <View style={styles.deviceListInfo}>
                  <Text style={styles.deviceListName}>{device.name}</Text>
                  <Text style={styles.deviceListHint}>
                    {index === 0 ? 'Ближайшее устройство' : 'Нажмите для подключения'}
                  </Text>
                </View>
                {renderSignalIndicator(device.signalPercent)}
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}

            <View style={styles.hintCard}>
              <Text style={styles.hintIcon}>💡</Text>
              <Text style={styles.hintText}>
                Поднесите телефон ближе к нужной рации для лучшего сигнала
              </Text>
            </View>
          </ScrollView>
        </View>
      );
    }

    // NOT FOUND
    if (step === 'not_found') {
      return (
        <View style={styles.content}>
          <View style={styles.errorCircle}>
            <Text style={styles.errorIcon}>📡</Text>
          </View>

          <Text style={styles.title}>Рация не найдена</Text>

          <Text style={styles.description}>
            Не удалось обнаружить устройства поблизости
          </Text>

          <View style={styles.checklistCard}>
            <Text style={styles.checklistTitle}>Проверьте:</Text>
            <View style={styles.checklistItem}>
              <Text style={styles.checklistBullet}>•</Text>
              <Text style={styles.checklistText}>Рация включена</Text>
            </View>
            <View style={styles.checklistItem}>
              <Text style={styles.checklistBullet}>•</Text>
              <Text style={styles.checklistText}>Bluetooth на рации активен</Text>
            </View>
            <View style={styles.checklistItem}>
              <Text style={styles.checklistBullet}>•</Text>
              <Text style={styles.checklistText}>Устройство находится рядом</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={startScan}
            activeOpacity={0.7}
          >
            <Text style={styles.primaryButtonText}>Повторить поиск</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.textButton}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.textButtonLabel}>Закрыть</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // CONNECTING
    if (step === 'connecting') {
      return (
        <View style={styles.content}>
          <View style={styles.connectingAnimation}>
            <Text style={styles.connectingPhone}>📱</Text>
            <View style={styles.connectingDots}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
            <Text style={styles.connectingRadio}>📻</Text>
          </View>

          <Text style={styles.title}>Подключение</Text>

          <Text style={styles.description}>
            Устанавливаем соединение с рацией...
          </Text>
        </View>
      );
    }

    // ERROR
    if (step === 'error') {
      let errorTitle = 'Ошибка';
      let errorDesc = 'Произошла неизвестная ошибка';
      let actionText = 'Повторить';
      let onAction = resetScan;

      if (errorMessage === 'bluetooth_off') {
        errorTitle = 'Bluetooth выключен';
        errorDesc = 'Для поиска рации необходимо включить Bluetooth';
        actionText = 'Открыть настройки';
        onAction = openBluetoothSettings;
      } else if (errorMessage === 'connection_failed') {
        errorTitle = 'Ошибка подключения';
        errorDesc = 'Не удалось установить соединение. Попробуйте перезагрузить рацию';
      } else if (errorMessage === 'scan_error') {
        errorTitle = 'Ошибка поиска';
        errorDesc = 'Не удалось выполнить сканирование устройств';
      }

      return (
        <View style={styles.content}>
          <View style={styles.errorCircle}>
            <Text style={styles.errorIconLarge}>!</Text>
          </View>

          <Text style={styles.title}>{errorTitle}</Text>

          <Text style={styles.description}>{errorDesc}</Text>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={onAction}
            activeOpacity={0.7}
          >
            <Text style={styles.primaryButtonText}>{actionText}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.textButton}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.textButtonLabel}>Закрыть</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>
        {renderContent()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  listContainer: {
    flex: 1,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerBackButton: {
    width: 80,
  },
  headerBackText: {
    fontSize: 17,
    color: colors.primary,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  headerRight: {
    width: 80,
  },

  // Icons
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.backgroundGray,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  iconEmoji: {
    fontSize: 48,
  },
  successCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.success,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successCheck: {
    fontSize: 36,
    color: '#FFFFFF',
  },
  errorCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.backgroundGray,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  errorIcon: {
    fontSize: 48,
  },
  errorIconLarge: {
    fontSize: 48,
    color: colors.error,
    fontWeight: 'bold',
  },

  // Typography
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
    paddingHorizontal: 16,
  },

  // Buttons
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonDisabled: {
    backgroundColor: colors.border,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  textButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  textButtonLabel: {
    color: colors.primary,
    fontSize: 17,
  },

  // Warning Card
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF9E6',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    width: '100%',
    marginBottom: 16,
  },
  warningIconContainer: {
    marginRight: 12,
  },
  warningIcon: {
    fontSize: 24,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  warningText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  chevron: {
    fontSize: 24,
    color: colors.textHint,
    marginLeft: 8,
  },

  // Progress Bar
  progressContainer: {
    width: '100%',
    marginBottom: 32,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.backgroundGray,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },

  // Hint Card
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundGray,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    marginHorizontal: 16,
  },
  hintIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  hintText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },

  // Device Card
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundGray,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 24,
  },
  deviceAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  deviceAvatarText: {
    fontSize: 24,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  deviceStatus: {
    fontSize: 14,
    color: colors.textSecondary,
  },

  // Device List
  deviceList: {
    flex: 1,
    backgroundColor: colors.backgroundGray,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  deviceListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  deviceListInfo: {
    flex: 1,
  },
  deviceListName: {
    fontSize: 17,
    color: colors.text,
    marginBottom: 2,
  },
  deviceListHint: {
    fontSize: 14,
    color: colors.textSecondary,
  },

  // Signal Indicator
  signalContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 18,
    marginRight: 8,
    gap: 2,
  },
  signalBar: {
    width: 4,
    borderRadius: 1,
  },
  signalBarActive: {
    backgroundColor: colors.success,
  },
  signalBarInactive: {
    backgroundColor: colors.border,
  },

  // Checklist
  checklistCard: {
    backgroundColor: colors.backgroundGray,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    marginBottom: 24,
  },
  checklistTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  checklistBullet: {
    fontSize: 15,
    color: colors.textSecondary,
    marginRight: 8,
    marginTop: 1,
  },
  checklistText: {
    flex: 1,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
  },

  // Connecting Animation
  connectingAnimation: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
  },
  connectingPhone: {
    fontSize: 48,
  },
  connectingDots: {
    marginHorizontal: 20,
  },
  connectingRadio: {
    fontSize: 48,
  },
});
