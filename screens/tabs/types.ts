import type { NodeInfo, Message, Channel, ChatTarget, DeviceConfig, DeviceMetadata, MyNodeInfoExtended } from '../../types';
import { DeviceStatusEnum } from '../../types';
import type { Device } from 'react-native-ble-plx';

export interface GpsLocation {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface DeviceTelemetry {
  batteryLevel?: number;
  voltage?: number;
  channelUtilization?: number;
  airUtilTx?: number;
  uptimeSeconds?: number;
}

// Common props for all tabs
export interface TabCommonProps {
  device: Device | null;
  isOffline: boolean;
  myNodeNum: number | null;
  nodes: NodeInfo[];
  friendIds: Set<number>;
  getNodeName: (node: NodeInfo) => string;
}

// ChatTab specific props
export interface ChatTabProps extends TabCommonProps {
  channels: Channel[];
  messages: Message[];
  openChat: ChatTarget | null;
  setOpenChat: (chat: ChatTarget | null) => void;
  sendMessage: (to: number, text: string) => Promise<Message | null>;
  sendChannelMessage: (text: string, channelIndex: number) => Promise<Message | null>;
  sendLocationMessage: (latitude: number, longitude: number, destination: number | 'broadcast', channelIndex?: number) => Promise<Message | null>;
  addMessage: (message: Message) => void;
  addFriend: (nodeNum: number) => Promise<void>;
  removeFriend: (nodeNum: number) => Promise<void>;
  markChatAsRead: (chatKey: string) => void;
  getUnreadCount: (chatKey: string, chatMessages: Message[]) => number;
  currentLocation: GpsLocation | null;
  onShowQRScanner: () => void;
  onShowCreateGroup: () => void;
  onShareChannel: (channelIndex: number) => void;
  onDeleteChannel: (channel: Channel) => void;
  onNavigateToLocation: (latitude: number, longitude: number, senderName?: string) => void;
}

// MapTab specific props
export interface MapTabProps extends TabCommonProps {
  currentLocation: GpsLocation | null;
  hasOfflinePack: boolean;
  isDownloading: boolean;
  offlineProgress: number | null;
  downloadOfflineRegion: (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => Promise<void>;
  targetMapLocation: { latitude: number; longitude: number; senderName?: string } | null;
  setTargetMapLocation: (location: { latitude: number; longitude: number; senderName?: string } | null) => void;
}

// NodeTab specific props
export interface NodeTabProps extends TabCommonProps {
  deviceStatus: DeviceStatusEnum;
  deviceTelemetry: DeviceTelemetry;
  deviceConfig: DeviceConfig;
  deviceMetadata: DeviceMetadata;
  myNodeInfo: MyNodeInfoExtended | null;
  channels: Channel[];
  onOpenScanner?: () => void;
}

// SettingsTab specific props
export interface SettingsTabProps {
  userName: string | null;
  userPhone: string | null;
  saveUserName: (name: string) => Promise<void>;
  saveUserPhone: (phone: string) => Promise<void>;
}
