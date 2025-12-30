import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Device, BleManager } from 'react-native-ble-plx';
import MapLibreGL from '@maplibre/maplibre-react-native';

import { meshtasticService } from '../services/MeshtasticService';
import { logger } from '../services/LoggerService';
import type { ActiveTab, Channel, ChatTarget } from '../types';
import { DeviceStatusEnum, ChannelRole } from '../types';

// Hooks
import { useGps } from '../hooks/useGps';
import { useStorage } from '../hooks/useStorage';
import { useMeshtastic } from '../hooks/useMeshtastic';
import { useOfflineMap } from '../hooks/useOfflineMap';
import { useMqttProxy } from '../hooks/useMqttProxy';
import { useModalController } from '../hooks/useModalController';

// Components
import QRScannerModal from '../components/QRScannerModal';
import {
  CreateGroupModal,
  ShareChannelModal,
  NameSetupModal,
  EncryptionType,
} from '../components/modals';

// Tab components
import { ChatTab, MapTab, NodeTab, SettingsTab, COLORS } from './tabs';

// Initialize MapLibre
MapLibreGL.setAccessToken(null);

interface DeviceDetailScreenProps {
  device: Device | null;
  bleManager: BleManager;
  onBack: () => void;
  onOpenScanner?: () => void;
  isOffline?: boolean;
}

export default function DeviceDetailScreen({
  device,
  bleManager,
  onBack,
  onOpenScanner,
  isOffline = false,
}: DeviceDetailScreenProps) {
  // Set BLE manager for reconnection support
  useEffect(() => {
    meshtasticService.setBleManager(bleManager);
  }, [bleManager]);

  // Storage hook
  const {
    friendIds,
    addFriend,
    removeFriend,
    messages,
    addMessage,
    updateMessageStatus,
    lastReadTimestamps,
    markChatAsRead,
    getUnreadCount,
    userName,
    setUserName: saveUserName,
    userPhone,
    setUserPhone: saveUserPhone,
    mqttSettings,
    setMqttSettings: saveMqttSettings,
  } = useStorage();

  // Message handler for useMeshtastic
  const handleIncomingMessage = useCallback((message: any) => {
    addMessage(message);
  }, [addMessage]);

  // ACK handler for useMeshtastic
  const handleAck = useCallback((packetId: number, success: boolean) => {
    updateMessageStatus(packetId, success ? 'delivered' : 'failed');
  }, [updateMessageStatus]);

  // Meshtastic hook
  const {
    deviceStatus,
    myNodeNum,
    error,
    nodes,
    channels,
    deviceTelemetry,
    deviceConfig,
    deviceMetadata,
    myNodeInfo,
    disconnect,
    sendMessage,
    sendChannelMessage,
    sendLocationMessage,
    addChannelFromQR,
    setMqttConfig,
    getNodeName,
    isMyNode,
  } = useMeshtastic(device, handleIncomingMessage, handleAck, mqttSettings);

  // GPS hook
  const { currentLocation } = useGps(deviceStatus === DeviceStatusEnum.DeviceConfigured);

  // Offline map hook
  const {
    hasOfflinePack,
    isDownloading,
    offlineProgress,
    downloadOfflineRegion,
    deleteOfflineRegion,
  } = useOfflineMap();

  // MQTT Proxy hook - forwards messages between device and MQTT broker
  const mqttProxy = useMqttProxy(
    deviceStatus,
    mqttSettings,
    channels,
    deviceConfig?.region
  );

  // Log MQTT proxy status changes
  useEffect(() => {
    if (mqttProxy.isConnected) {
      logger.debug('DeviceDetailScreen', 'MQTT proxy connected, topics:', mqttProxy.subscribedTopics);
    } else if (mqttProxy.error) {
      logger.debug('DeviceDetailScreen', 'MQTT proxy error:', mqttProxy.error);
    }
  }, [mqttProxy.isConnected, mqttProxy.error, mqttProxy.subscribedTopics]);

  // Local UI state
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [openChat, setOpenChat] = useState<ChatTarget | null>(null);
  const [targetMapLocation, setTargetMapLocation] = useState<{ latitude: number; longitude: number; senderName?: string } | null>(null);

  // Modal controller
  const modals = useModalController();

  // Show name modal when device is configured and no name is set
  useEffect(() => {
    if (deviceStatus === DeviceStatusEnum.DeviceConfigured && userName === null) {
      modals.nameSetup.open();
    }
  }, [deviceStatus, userName, modals.nameSetup]);

  const handleSetUserName = async (name: string, shortName: string): Promise<boolean> => {
    const success = await meshtasticService.setOwner(name, shortName);

    if (success) {
      await saveUserName(name);
      modals.nameSetup.close();
      return true;
    } else {
      Alert.alert('Error', 'Failed to set name. Try again.');
      return false;
    }
  };

  const handleQRChannelScanned = async (channelData: {
    name: string;
    psk: Uint8Array;
    uplinkEnabled: boolean;
    downlinkEnabled: boolean;
  }) => {
    const result = await addChannelFromQR(
      channelData.name,
      channelData.psk,
      channelData.uplinkEnabled,
      channelData.downlinkEnabled
    );

    if (result.success) {
      Alert.alert('Success', `Group "${channelData.name}" added successfully`);
    } else {
      Alert.alert('Error', 'Failed to add group. Try again.');
    }
  };

  const handleCreateGroup = async (name: string, encryption: EncryptionType) => {
    // Find first available channel slot (1-7, as 0 is PRIMARY)
    let availableIndex = -1;
    for (let i = 1; i <= 7; i++) {
      const existingChannel = channels.find(ch => ch.index === i);
      if (!existingChannel || existingChannel.role === ChannelRole.DISABLED) {
        availableIndex = i;
        break;
      }
    }

    if (availableIndex === -1) {
      Alert.alert('Error', 'All channel slots are in use (max 7 groups)');
      return;
    }

    // Generate PSK based on encryption selection
    let psk: Uint8Array;
    if (encryption === 'none') {
      psk = new Uint8Array();
    } else if (encryption === 'aes128') {
      psk = meshtasticService.generatePsk(16);
    } else {
      psk = meshtasticService.generatePsk(32);
    }

    const success = await meshtasticService.setChannel(
      availableIndex,
      name,
      psk,
      ChannelRole.SECONDARY
    );

    if (success) {
      modals.createGroup.close();
      setOpenChat({ type: 'channel', id: availableIndex });
    } else {
      Alert.alert('Error', 'Failed to create group');
    }
  };

  const handleDeleteChannel = (channel: Channel) => {
    Alert.alert(
      'Delete Group',
      `Are you sure you want to delete "${channel.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const success = await meshtasticService.deleteChannel(channel.index);
            if (!success) {
              Alert.alert('Error', 'Failed to delete group');
            }
          },
        },
      ]
    );
  };

  const handleShareChannel = async (channelIndex: number) => {
    const url = await meshtasticService.getChannelUrl(channelIndex);
    if (url) {
      modals.shareChannel.open(url);
    } else {
      Alert.alert('Error', 'Failed to generate share link');
    }
  };

  const navigateToLocation = (latitude: number, longitude: number, senderName?: string) => {
    setTargetMapLocation({ latitude, longitude, senderName });
    setOpenChat(null);
    setActiveTab('map');
  };

  // Get battery fill color
  const getBatteryColor = (level?: number) => {
    if (!level) return COLORS.textSecondary;
    if (level <= 20) return COLORS.error;
    if (level <= 50) return COLORS.warning;
    return COLORS.success;
  };

  // Render status indicator text
  const getStatusText = () => {
    if (isOffline || !device) return 'Offline';
    switch (deviceStatus) {
      case DeviceStatusEnum.DeviceConfigured:
        return 'Connected';
      case DeviceStatusEnum.DeviceReconnecting:
        return 'Reconnecting...';
      case DeviceStatusEnum.DeviceConnecting:
        return 'Connecting...';
      case DeviceStatusEnum.DeviceInitializing:
        return 'Initializing...';
      case DeviceStatusEnum.DeviceConfiguring:
        return 'Loading config...';
      default:
        return 'Disconnected';
    }
  };

  const getStatusColor = () => {
    if (isOffline || !device) return COLORS.warning;
    if (deviceStatus === DeviceStatusEnum.DeviceConfigured) return COLORS.success;
    if (deviceStatus === DeviceStatusEnum.DeviceReconnecting) return COLORS.warning;
    if (deviceStatus === DeviceStatusEnum.DeviceInitializing) return COLORS.primary;
    if (deviceStatus === DeviceStatusEnum.DeviceConfiguring) return COLORS.primary;
    return COLORS.error;
  };

  return (
    <View style={styles.container}>
      {/* Top Status Bar */}
      <View style={styles.topStatusBar}>
        <View style={styles.topStatusCenter}>
          {isOffline || !device ? (
            onOpenScanner ? (
              <TouchableOpacity
                style={styles.topConnectButton}
                onPress={onOpenScanner}
                activeOpacity={0.7}
              >
                <Text style={styles.topConnectButtonText}>Connect</Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.topStatusText, { color: COLORS.warning }]}>Offline</Text>
            )
          ) : deviceStatus === DeviceStatusEnum.DeviceReconnecting ? (
            <View style={styles.topStatusRow}>
              <ActivityIndicator size="small" color={COLORS.warning} style={styles.topStatusSpinner} />
              <Text style={[styles.topStatusText, { color: COLORS.warning }]}>Reconnecting...</Text>
            </View>
          ) : deviceStatus === DeviceStatusEnum.DeviceInitializing || deviceStatus === DeviceStatusEnum.DeviceConfiguring ? (
            <View style={styles.topStatusRow}>
              <ActivityIndicator size="small" color={COLORS.primary} style={styles.topStatusSpinner} />
              <Text style={[styles.topStatusText, { color: COLORS.primary }]}>{getStatusText()}</Text>
            </View>
          ) : (
            <View style={styles.topStatusRow}>
              <View style={[styles.topStatusDot, { backgroundColor: getStatusColor() }]} />
              <Text style={[styles.topStatusText, { color: getStatusColor() }]}>{getStatusText()}</Text>
            </View>
          )}
        </View>
        <View style={styles.topStatusRight}>
          {deviceTelemetry.batteryLevel !== undefined && (
            <View style={styles.batteryContainer}>
              <View style={styles.batteryBody}>
                <View
                  style={[
                    styles.batteryFill,
                    {
                      width: `${deviceTelemetry.batteryLevel}%`,
                      backgroundColor: getBatteryColor(deviceTelemetry.batteryLevel),
                    },
                  ]}
                />
              </View>
              <View style={styles.batteryTip} />
              <Text style={styles.batteryText}>{deviceTelemetry.batteryLevel}%</Text>
            </View>
          )}
        </View>
      </View>

      {/* Error Banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      {/* Tab Content */}
      {activeTab === 'chat' && (
        <ChatTab
          device={device}
          isOffline={isOffline}
          myNodeNum={myNodeNum}
          nodes={nodes}
          friendIds={friendIds}
          getNodeName={getNodeName}
          channels={channels}
          messages={messages}
          openChat={openChat}
          setOpenChat={setOpenChat}
          sendMessage={sendMessage}
          sendChannelMessage={sendChannelMessage}
          sendLocationMessage={sendLocationMessage}
          addMessage={addMessage}
          updateMessageStatus={updateMessageStatus}
          addFriend={addFriend}
          removeFriend={removeFriend}
          markChatAsRead={markChatAsRead}
          getUnreadCount={getUnreadCount}
          currentLocation={currentLocation}
          onShowQRScanner={modals.qrScanner.open}
          onShowCreateGroup={modals.createGroup.open}
          onShareChannel={handleShareChannel}
          onDeleteChannel={handleDeleteChannel}
          onNavigateToLocation={navigateToLocation}
        />
      )}
      {activeTab === 'map' && (
        <MapTab
          device={device}
          isOffline={isOffline}
          myNodeNum={myNodeNum}
          nodes={nodes}
          friendIds={friendIds}
          getNodeName={getNodeName}
          currentLocation={currentLocation}
          hasOfflinePack={hasOfflinePack}
          isDownloading={isDownloading}
          offlineProgress={offlineProgress}
          downloadOfflineRegion={downloadOfflineRegion}
          targetMapLocation={targetMapLocation}
          setTargetMapLocation={setTargetMapLocation}
        />
      )}
      {activeTab === 'node' && (
        <NodeTab
          device={device}
          isOffline={isOffline}
          myNodeNum={myNodeNum}
          nodes={nodes}
          friendIds={friendIds}
          getNodeName={getNodeName}
          deviceStatus={deviceStatus}
          deviceTelemetry={deviceTelemetry}
          deviceConfig={deviceConfig}
          deviceMetadata={deviceMetadata}
          myNodeInfo={myNodeInfo}
          channels={channels}
          onOpenScanner={onOpenScanner}
        />
      )}
      {activeTab === 'settings' && (
        <SettingsTab
          userName={userName}
          userPhone={userPhone}
          saveUserName={saveUserName}
          saveUserPhone={saveUserPhone}
          mqttSettings={mqttSettings}
          saveMqttSettings={saveMqttSettings}
          isConnected={deviceStatus === DeviceStatusEnum.DeviceConfigured}
        />
      )}

      {/* Tab Bar (hidden when chat is open) */}
      {!openChat && (
        <View style={styles.tabBar}>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('chat')}>
            <Text style={styles.tabIcon}>{activeTab === 'chat' ? '💬' : '💬'}</Text>
            <Text style={[styles.tabLabel, activeTab === 'chat' && styles.tabLabelActive]}>
              Чаты
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('map')}>
            <Text style={styles.tabIcon}>{activeTab === 'map' ? '🗺️' : '🗺️'}</Text>
            <Text style={[styles.tabLabel, activeTab === 'map' && styles.tabLabelActive]}>
              Карта
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('node')}>
            <Text style={styles.tabIcon}>{activeTab === 'node' ? '📡' : '📡'}</Text>
            <Text style={[styles.tabLabel, activeTab === 'node' && styles.tabLabelActive]}>
              Рация
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('settings')}>
            <Text style={styles.tabIcon}>{activeTab === 'settings' ? '⚙️' : '⚙️'}</Text>
            <Text style={[styles.tabLabel, activeTab === 'settings' && styles.tabLabelActive]}>
              Ещё
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Create Group Modal */}
      <CreateGroupModal
        visible={modals.createGroup.visible}
        onClose={modals.createGroup.close}
        onCreate={handleCreateGroup}
      />

      {/* Share Channel Modal */}
      <ShareChannelModal
        visible={modals.shareChannel.visible}
        channelUrl={modals.shareChannel.data}
        onClose={modals.shareChannel.close}
      />

      {/* Name Setup Modal */}
      <NameSetupModal
        visible={modals.nameSetup.visible}
        onSave={handleSetUserName}
      />

      {/* QR Scanner Modal */}
      <QRScannerModal
        visible={modals.qrScanner.visible}
        onClose={modals.qrScanner.close}
        onChannelScanned={handleQRChannelScanned}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F4F5',
  },
  // Top Status Bar
  topStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 24) + 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
    backgroundColor: COLORS.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  topStatusCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topConnectButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  topConnectButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  topStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  topStatusSpinner: {
    marginRight: 6,
    transform: [{ scale: 0.7 }],
  },
  topStatusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  topStatusRight: {
    alignItems: 'flex-end',
  },
  batteryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  batteryBody: {
    width: 28,
    height: 12,
    borderWidth: 1.5,
    borderColor: COLORS.textSecondary,
    borderRadius: 3,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  batteryFill: {
    height: '100%',
    borderRadius: 1,
  },
  batteryTip: {
    width: 3,
    height: 6,
    backgroundColor: COLORS.textSecondary,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    marginLeft: 1,
  },
  batteryText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginLeft: 6,
    fontWeight: '500',
    minWidth: 32,
  },
  errorBanner: {
    backgroundColor: '#FFEBEE',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  errorBannerText: {
    color: '#C62828',
    fontSize: 13,
    textAlign: 'center',
  },
  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  tabLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  tabLabelActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
});
