import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';

import type { NodeInfo } from '../../types';
import { DeviceStatusEnum, ChannelRole } from '../../types';
import { sharedStyles, settingsStyles, COLORS } from './styles';
import type { NodeTabProps } from './types';

export default function NodeTab({
  device,
  isOffline,
  myNodeNum,
  nodes,
  friendIds,
  deviceStatus,
  deviceTelemetry,
  deviceConfig,
  deviceMetadata,
  myNodeInfo,
  channels,
  onOpenScanner,
}: NodeTabProps) {
  const activeChannels = useMemo(() =>
    channels.filter(ch => ch.role !== ChannelRole.DISABLED),
    [channels]
  );

  const getMyNode = (): NodeInfo | undefined => {
    if (!myNodeNum) return undefined;
    return nodes.find(n => n.nodeNum === myNodeNum);
  };

  const formatUptime = (seconds?: number): string => {
    if (!seconds) return '—';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const myNode = getMyNode();
  const statusText = deviceStatus === DeviceStatusEnum.DeviceConfigured ? 'Connected' :
                     deviceStatus === DeviceStatusEnum.DeviceReconnecting ? 'Reconnecting...' :
                     deviceStatus === DeviceStatusEnum.DeviceConnecting ? 'Connecting...' :
                     deviceStatus === DeviceStatusEnum.DeviceInitializing ? 'Initializing...' :
                     deviceStatus === DeviceStatusEnum.DeviceConfiguring ? 'Loading config...' :
                     'Disconnected';
  const statusColor = deviceStatus === DeviceStatusEnum.DeviceConfigured ? COLORS.success :
                      deviceStatus === DeviceStatusEnum.DeviceReconnecting ? COLORS.warning :
                      deviceStatus === DeviceStatusEnum.DeviceInitializing ? COLORS.primary :
                      deviceStatus === DeviceStatusEnum.DeviceConfiguring ? COLORS.primary :
                      COLORS.error;

  return (
    <ScrollView style={sharedStyles.nodesList} showsVerticalScrollIndicator={false}>
      {/* Radio Connection */}
      <Text style={sharedStyles.sectionHeader}>CONNECTION</Text>
      <View style={sharedStyles.nodeStatusCard}>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Status</Text>
          <View style={settingsStyles.connectionStatusContainer}>
            <View style={[
              settingsStyles.connectionStatusDot,
              { backgroundColor: isOffline || !device ? COLORS.warning : COLORS.success }
            ]} />
            <Text style={[
              sharedStyles.nodeStatusValue,
              { color: isOffline || !device ? COLORS.warning : COLORS.success }
            ]}>
              {isOffline || !device ? 'Not connected' : 'Connected'}
            </Text>
          </View>
        </View>
        {onOpenScanner && (
          <TouchableOpacity
            style={settingsStyles.settingsButton}
            onPress={onOpenScanner}
            activeOpacity={0.7}
          >
            <Text style={settingsStyles.settingsButtonText}>
              {isOffline || !device ? 'Connect radio' : 'Connect another radio'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Device Info */}
      <Text style={sharedStyles.sectionHeader}>DEVICE</Text>
      <View style={sharedStyles.nodeStatusCard}>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Name</Text>
          <Text style={sharedStyles.nodeStatusValue}>{device?.name || 'Unknown'}</Text>
        </View>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Status</Text>
          <Text style={[sharedStyles.nodeStatusValue, { color: statusColor }]}>{statusText}</Text>
        </View>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Node ID</Text>
          <Text style={sharedStyles.nodeStatusValue}>
            {myNodeNum ? `!${myNodeNum.toString(16)}` : '—'}
          </Text>
        </View>
        {(myNode?.hwModel || deviceMetadata.hwModel) && (
          <View style={sharedStyles.nodeStatusRow}>
            <Text style={sharedStyles.nodeStatusLabel}>Model</Text>
            <Text style={sharedStyles.nodeStatusValue}>{myNode?.hwModel || deviceMetadata.hwModel}</Text>
          </View>
        )}
        {deviceMetadata.firmwareVersion && (
          <View style={sharedStyles.nodeStatusRow}>
            <Text style={sharedStyles.nodeStatusLabel}>Firmware</Text>
            <Text style={sharedStyles.nodeStatusValue}>{deviceMetadata.firmwareVersion}</Text>
          </View>
        )}
        {deviceConfig.role && (
          <View style={sharedStyles.nodeStatusRow}>
            <Text style={sharedStyles.nodeStatusLabel}>Role</Text>
            <Text style={sharedStyles.nodeStatusValue}>{deviceConfig.role}</Text>
          </View>
        )}
        {myNodeInfo?.rebootCount !== undefined && (
          <View style={sharedStyles.nodeStatusRow}>
            <Text style={sharedStyles.nodeStatusLabel}>Reboots</Text>
            <Text style={sharedStyles.nodeStatusValue}>{myNodeInfo.rebootCount}</Text>
          </View>
        )}
      </View>

      {/* Battery & Metrics */}
      <Text style={sharedStyles.sectionHeader}>STATUS</Text>
      <View style={sharedStyles.nodeStatusCard}>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Battery</Text>
          <Text style={sharedStyles.nodeStatusValue}>
            {deviceTelemetry.batteryLevel !== undefined
              ? `${deviceTelemetry.batteryLevel}%`
              : '—'}
          </Text>
        </View>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Voltage</Text>
          <Text style={sharedStyles.nodeStatusValue}>
            {deviceTelemetry.voltage !== undefined
              ? `${deviceTelemetry.voltage.toFixed(2)}V`
              : '—'}
          </Text>
        </View>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Uptime</Text>
          <Text style={sharedStyles.nodeStatusValue}>{formatUptime(deviceTelemetry.uptimeSeconds)}</Text>
        </View>
      </View>

      {/* LoRa Config */}
      <Text style={sharedStyles.sectionHeader}>LORA</Text>
      <View style={sharedStyles.nodeStatusCard}>
        {deviceConfig.region && (
          <View style={sharedStyles.nodeStatusRow}>
            <Text style={sharedStyles.nodeStatusLabel}>Region</Text>
            <Text style={sharedStyles.nodeStatusValue}>{deviceConfig.region}</Text>
          </View>
        )}
        {deviceConfig.modemPreset && (
          <View style={sharedStyles.nodeStatusRow}>
            <Text style={sharedStyles.nodeStatusLabel}>Preset</Text>
            <Text style={sharedStyles.nodeStatusValue}>{deviceConfig.modemPreset}</Text>
          </View>
        )}
        {deviceConfig.txPower !== undefined && (
          <View style={sharedStyles.nodeStatusRow}>
            <Text style={sharedStyles.nodeStatusLabel}>TX Power</Text>
            <Text style={sharedStyles.nodeStatusValue}>{deviceConfig.txPower} dBm</Text>
          </View>
        )}
        {deviceConfig.hopLimit !== undefined && (
          <View style={sharedStyles.nodeStatusRow}>
            <Text style={sharedStyles.nodeStatusLabel}>Hop Limit</Text>
            <Text style={sharedStyles.nodeStatusValue}>{deviceConfig.hopLimit}</Text>
          </View>
        )}
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Channel Utilization</Text>
          <Text style={sharedStyles.nodeStatusValue}>
            {deviceTelemetry.channelUtilization !== undefined
              ? `${deviceTelemetry.channelUtilization.toFixed(1)}%`
              : '—'}
          </Text>
        </View>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>TX Utilization</Text>
          <Text style={sharedStyles.nodeStatusValue}>
            {deviceTelemetry.airUtilTx !== undefined
              ? `${deviceTelemetry.airUtilTx.toFixed(1)}%`
              : '—'}
          </Text>
        </View>
      </View>

      {/* Mesh Stats */}
      <Text style={sharedStyles.sectionHeader}>MESH NETWORK</Text>
      <View style={sharedStyles.nodeStatusCard}>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Nodes in network</Text>
          <Text style={sharedStyles.nodeStatusValue}>{nodes.length}</Text>
        </View>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Active channels</Text>
          <Text style={sharedStyles.nodeStatusValue}>{activeChannels.length}</Text>
        </View>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Friends</Text>
          <Text style={sharedStyles.nodeStatusValue}>{friendIds.size}</Text>
        </View>
        {myNodeInfo?.maxChannels !== undefined && (
          <View style={sharedStyles.nodeStatusRow}>
            <Text style={sharedStyles.nodeStatusLabel}>Max channels</Text>
            <Text style={sharedStyles.nodeStatusValue}>{myNodeInfo.maxChannels}</Text>
          </View>
        )}
      </View>

      <View style={sharedStyles.bottomPadding} />
    </ScrollView>
  );
}
