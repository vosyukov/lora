import { Platform, PermissionsAndroid } from 'react-native';
import { Device } from 'react-native-ble-plx';

/**
 * Convert RSSI value to percentage (0-100)
 * @param rssi - RSSI value from BLE device (typically -100 to -30)
 * @returns Percentage value between 0 and 100
 */
export function rssiToPercent(rssi: number): number {
  const minRssi = -100;
  const maxRssi = -30;
  const percent = ((rssi - minRssi) / (maxRssi - minRssi)) * 100;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

/**
 * Get clean device name from BLE device
 * Removes "Meshtastic_" prefix and returns fallback if empty
 * @param device - BLE device object
 * @returns Clean device name or "Рация" as fallback
 */
export function getDeviceName(device: Device): string {
  if (device.name) {
    return device.name.replace(/^Meshtastic_?/i, '').trim() || 'Рация';
  }
  return 'Рация';
}

/**
 * Request BLE permissions for Android
 * Handles different permission requirements for Android 31+ vs older versions
 */
export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    if (Platform.Version >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);

      return Object.values(results).every(
        (status) => status === PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch {
    return false;
  }
}

/**
 * Get signal strength description based on RSSI percentage
 * @param percent - Signal strength percentage
 * @returns Localized description string
 */
export function getSignalDescription(percent: number): string {
  if (percent >= 80) return 'Отличный сигнал';
  if (percent >= 60) return 'Хороший сигнал';
  if (percent >= 40) return 'Средний сигнал';
  if (percent >= 20) return 'Слабый сигнал';
  return 'Очень слабый сигнал';
}
