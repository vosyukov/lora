import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { DeviceStatusEnum } from '../../types';

interface StatusInfo {
  text: string;
  color: string;
  showSpinner: boolean;
}

interface TopStatusBarProps {
  deviceStatus: DeviceStatusEnum;
  batteryLevel?: number;
  reconnectAttempts?: number;
  maxReconnectAttempts?: number;
  onBack: () => void;
}

function getStatusInfo(
  deviceStatus: DeviceStatusEnum,
  reconnectAttempts?: number,
  maxReconnectAttempts?: number
): StatusInfo {
  switch (deviceStatus) {
    case DeviceStatusEnum.DeviceConfigured:
      return { text: 'Подключено', color: '#31B545', showSpinner: false };
    case DeviceStatusEnum.DeviceReconnecting:
      return {
        text: `Переподключение (${reconnectAttempts ?? 0}/${maxReconnectAttempts ?? 10})`,
        color: '#FF9500',
        showSpinner: true,
      };
    case DeviceStatusEnum.DeviceConnecting:
      return { text: 'Подключение...', color: '#2AABEE', showSpinner: true };
    case DeviceStatusEnum.DeviceConfiguring:
      return { text: 'Загрузка...', color: '#2AABEE', showSpinner: true };
    default:
      return { text: 'Отключено', color: '#FF3B30', showSpinner: false };
  }
}

function getBatteryIcon(level: number): string {
  if (level > 80) return '🔋';
  if (level > 20) return '🔋';
  return '🪫';
}

export function TopStatusBar({
  deviceStatus,
  batteryLevel,
  reconnectAttempts,
  maxReconnectAttempts,
  onBack,
}: TopStatusBarProps) {
  const statusInfo = getStatusInfo(deviceStatus, reconnectAttempts, maxReconnectAttempts);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>‹</Text>
      </TouchableOpacity>

      <View style={styles.center}>
        <View style={styles.statusRow}>
          {statusInfo.showSpinner ? (
            <ActivityIndicator size="small" color={statusInfo.color} style={styles.spinner} />
          ) : (
            <View style={[styles.dot, { backgroundColor: statusInfo.color }]} />
          )}
          <Text style={[styles.statusText, { color: statusInfo.color }]}>
            {statusInfo.text}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        {batteryLevel !== undefined && (
          <View style={styles.battery}>
            <Text style={styles.batteryText}>{batteryLevel}%</Text>
            <Text style={styles.batteryIcon}>{getBatteryIcon(batteryLevel)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#F8F8F8',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: {
    fontSize: 32,
    color: '#2AABEE',
    fontWeight: '300',
    marginTop: -4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  spinner: {
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  right: {
    width: 60,
    alignItems: 'flex-end',
  },
  battery: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  batteryText: {
    fontSize: 12,
    color: '#8E8E93',
    marginRight: 2,
  },
  batteryIcon: {
    fontSize: 14,
  },
});
