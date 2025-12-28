import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  TextInput,
  Modal,
  Share,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Device, BleManager } from 'react-native-ble-plx';
import QRCode from 'react-native-qrcode-svg';
import MapLibreGL from '@maplibre/maplibre-react-native';

import { meshtasticService } from '../services/MeshtasticService';
import type { ActiveTab, Channel, ChatTarget } from '../types';
import { DeviceStatusEnum, ChannelRole } from '../types';

// Hooks
import { useGps } from '../hooks/useGps';
import { useStorage } from '../hooks/useStorage';
import { useMeshtastic } from '../hooks/useMeshtastic';
import { useOfflineMap } from '../hooks/useOfflineMap';

// Components
import QRScannerModal from '../components/QRScannerModal';

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
  } = useStorage();

  // Message handler for useMeshtastic
  const handleIncomingMessage = useCallback((message: any) => {
    addMessage(message);
  }, [addMessage]);

  // ACK handler for useMeshtastic
  const handleAck = useCallback((packetId: number, success: boolean) => {
    updateMessageStatus(packetId, success);
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
    getNodeName,
    isMyNode,
  } = useMeshtastic(device, handleIncomingMessage, handleAck);

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

  // Local UI state
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [openChat, setOpenChat] = useState<ChatTarget | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEncryption, setNewGroupEncryption] = useState<'none' | 'aes128' | 'aes256'>('aes256');
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareChannelUrl, setShareChannelUrl] = useState<string | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [targetMapLocation, setTargetMapLocation] = useState<{ latitude: number; longitude: number; senderName?: string } | null>(null);

  // Show name modal when device is configured and no name is set
  useEffect(() => {
    if (deviceStatus === DeviceStatusEnum.DeviceConfigured && userName === null) {
      setShowNameModal(true);
    }
  }, [deviceStatus, userName]);

  const handleSetUserName = async () => {
    const name = nameInput.trim();
    if (!name) return;

    const shortName = meshtasticService.generateShortName(name);
    const success = await meshtasticService.setOwner(name, shortName);

    if (success) {
      await saveUserName(name);
      setShowNameModal(false);
      setNameInput('');
    } else {
      Alert.alert('Error', 'Failed to set name. Try again.');
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

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert('Error', 'Please enter a group name');
      return;
    }

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
    if (newGroupEncryption === 'none') {
      psk = new Uint8Array();
    } else if (newGroupEncryption === 'aes128') {
      psk = meshtasticService.generatePsk(16);
    } else {
      psk = meshtasticService.generatePsk(32);
    }

    const success = await meshtasticService.setChannel(
      availableIndex,
      newGroupName.trim(),
      psk,
      ChannelRole.SECONDARY
    );

    if (success) {
      setShowCreateGroup(false);
      setNewGroupName('');
      setNewGroupEncryption('aes256');
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
      setShareChannelUrl(url);
      setShowShareModal(true);
    } else {
      Alert.alert('Error', 'Failed to generate share link');
    }
  };

  const handleShareLink = async () => {
    if (!shareChannelUrl) return;

    try {
      await Share.share({
        message: shareChannelUrl,
        title: 'Join my Meshtastic channel',
      });
    } catch (error) {
      // User cancelled or error
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
      default:
        return 'Disconnected';
    }
  };

  const getStatusColor = () => {
    if (isOffline || !device) return COLORS.warning;
    if (deviceStatus === DeviceStatusEnum.DeviceConfigured) return COLORS.success;
    if (deviceStatus === DeviceStatusEnum.DeviceReconnecting) return COLORS.warning;
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
          addFriend={addFriend}
          removeFriend={removeFriend}
          markChatAsRead={markChatAsRead}
          getUnreadCount={getUnreadCount}
          currentLocation={currentLocation}
          onShowQRScanner={() => setShowQRScanner(true)}
          onShowCreateGroup={() => setShowCreateGroup(true)}
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
        />
      )}

      {/* Tab Bar (hidden when chat is open) */}
      {!openChat && (
        <View style={styles.tabBar}>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('chat')}>
            <Text style={styles.tabIcon}>{activeTab === 'chat' ? '' : ''}</Text>
            <Text style={[styles.tabLabel, activeTab === 'chat' && styles.tabLabelActive]}>
              Chat
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('map')}>
            <Text style={styles.tabIcon}>{activeTab === 'map' ? '' : ''}</Text>
            <Text style={[styles.tabLabel, activeTab === 'map' && styles.tabLabelActive]}>
              Map
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('node')}>
            <Text style={styles.tabIcon}>{activeTab === 'node' ? '' : ''}</Text>
            <Text style={[styles.tabLabel, activeTab === 'node' && styles.tabLabelActive]}>
              Radio
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('settings')}>
            <Text style={styles.tabIcon}>{activeTab === 'settings' ? '' : ''}</Text>
            <Text style={[styles.tabLabel, activeTab === 'settings' && styles.tabLabelActive]}>
              Settings
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Create Group Modal */}
      <Modal
        visible={showCreateGroup}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateGroup(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Group</Text>
              <TouchableOpacity
                onPress={() => setShowCreateGroup(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Group Name</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter group name..."
              placeholderTextColor="#8E8E93"
              value={newGroupName}
              onChangeText={setNewGroupName}
              maxLength={30}
              autoFocus
            />

            <Text style={styles.modalLabel}>Encryption</Text>
            <View style={styles.encryptionOptions}>
              <TouchableOpacity
                style={[
                  styles.encryptionOption,
                  newGroupEncryption === 'aes256' && styles.encryptionOptionSelected,
                ]}
                onPress={() => setNewGroupEncryption('aes256')}
              >
                <Text style={[
                  styles.encryptionOptionText,
                  newGroupEncryption === 'aes256' && styles.encryptionOptionTextSelected,
                ]}>
                  AES-256
                </Text>
                <Text style={styles.encryptionOptionHint}>Recommended</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.encryptionOption,
                  newGroupEncryption === 'aes128' && styles.encryptionOptionSelected,
                ]}
                onPress={() => setNewGroupEncryption('aes128')}
              >
                <Text style={[
                  styles.encryptionOptionText,
                  newGroupEncryption === 'aes128' && styles.encryptionOptionTextSelected,
                ]}>
                  AES-128
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.encryptionOption,
                  newGroupEncryption === 'none' && styles.encryptionOptionSelected,
                ]}
                onPress={() => setNewGroupEncryption('none')}
              >
                <Text style={[
                  styles.encryptionOptionText,
                  newGroupEncryption === 'none' && styles.encryptionOptionTextSelected,
                ]}>
                  None
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                styles.createButton,
                !newGroupName.trim() && styles.createButtonDisabled,
              ]}
              onPress={handleCreateGroup}
              disabled={!newGroupName.trim()}
            >
              <Text style={styles.createButtonText}>Create Group</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Share Channel Modal */}
      <Modal
        visible={showShareModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowShareModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share Group</Text>
              <TouchableOpacity
                onPress={() => setShowShareModal(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>Done</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.qrContainer}>
              {shareChannelUrl && (
                <QRCode
                  value={shareChannelUrl}
                  size={200}
                  backgroundColor="white"
                  color="black"
                />
              )}
            </View>

            <Text style={styles.shareHint}>
              Scan this QR code with another Meshtastic device to join this channel
            </Text>

            <TouchableOpacity
              style={styles.shareUrlButton}
              onPress={handleShareLink}
            >
              <Text style={styles.shareUrlButtonText}>Share Link</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Name Setup Modal */}
      <Modal
        visible={showNameModal}
        animationType="fade"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>What's your name?</Text>
            <Text style={styles.modalSubtitle}>
              Your friends in the network will see this name
            </Text>
            <TextInput
              style={styles.nameInput}
              placeholder="Enter your name"
              placeholderTextColor="#8E8E93"
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSetUserName}
            />
            {nameInput.trim() && (
              <Text style={styles.shortNamePreview}>
                Short name: {meshtasticService.generateShortName(nameInput)}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.modalButton, !nameInput.trim() && styles.modalButtonDisabled]}
              onPress={handleSetUserName}
              disabled={!nameInput.trim()}
            >
              <Text style={styles.modalButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* QR Scanner Modal */}
      <QRScannerModal
        visible={showQRScanner}
        onClose={() => setShowQRScanner(false)}
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
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  nameInput: {
    backgroundColor: '#F4F4F5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: COLORS.text,
    width: '100%',
    marginBottom: 12,
  },
  shortNamePreview: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  modalButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  modalButtonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  modalButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.white,
  },
  modalCloseButton: {
    padding: 8,
  },
  modalCloseText: {
    fontSize: 16,
    color: COLORS.primary,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalInput: {
    backgroundColor: '#F4F4F5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 20,
  },
  encryptionOptions: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 8,
  },
  encryptionOption: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F4F4F5',
    alignItems: 'center',
  },
  encryptionOptionSelected: {
    backgroundColor: COLORS.primary,
  },
  encryptionOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  encryptionOptionTextSelected: {
    color: COLORS.white,
  },
  encryptionOptionHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  createButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  createButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.white,
  },
  // QR Share Modal
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    padding: 24,
    borderRadius: 16,
    marginBottom: 20,
  },
  shareHint: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  shareUrlButton: {
    backgroundColor: '#5856D6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  shareUrlButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.white,
  },
});
