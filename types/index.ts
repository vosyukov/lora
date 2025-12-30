import { Device } from 'react-native-ble-plx';
import type * as Protobuf from '@meshtastic/protobufs';

// Device status enum (same as @meshtastic/core)
export enum DeviceStatusEnum {
  DeviceRestarting = 1,
  DeviceDisconnected = 2,
  DeviceConnecting = 3,
  DeviceReconnecting = 4,
  DeviceConnected = 5,
  DeviceConfiguring = 6,
  DeviceConfigured = 7,
  DeviceInitializing = 8, // MTU setup, service discovery, subscribing to notifications
}

// Packet metadata type (same as @meshtastic/core)
export type PacketDestination = 'broadcast' | 'direct';

export interface PacketMetadata<T> {
  id: number;
  rxTime: Date;
  type: PacketDestination;
  from: number;
  to: number;
  channel: number;
  data: T;
}

// Our custom types for the app
export interface NodeInfo {
  nodeNum: number;
  longName?: string;
  shortName?: string;
  hwModel?: string;
  lastHeard?: number;
  user?: Protobuf.Mesh.User;
  position?: Protobuf.Mesh.Position;
  snr?: number;
}

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';
export type MessageType = 'text' | 'location';

export interface LocationData {
  latitude: number;
  longitude: number;
  altitude?: number;
  time?: number;
}

export interface Message {
  id: string;
  packetId?: number;        // Meshtastic packet ID for tracking ACK
  from: number;
  to: number;
  text: string;
  timestamp: number;
  isOutgoing: boolean;
  channel?: number;
  status?: MessageStatus;   // Only for outgoing messages
  type?: MessageType;       // Message type (text or location)
  location?: LocationData;  // Location data for location messages
}

export type ActiveTab = 'chat' | 'map' | 'node' | 'settings';

export interface MeshtasticDevice {
  id: string;
  name: string;
  rssi: number;
  signalPercent: number;
  device: Device;
}

// Channel role enum (matches Meshtastic protocol)
export enum ChannelRole {
  DISABLED = 0,
  PRIMARY = 1,
  SECONDARY = 2,
}

// Channel type for Meshtastic channels (0-7)
export interface Channel {
  index: number;           // 0-7
  name: string;
  role: ChannelRole;
  psk?: Uint8Array;        // Encryption key (0=none, 16=AES-128, 32=AES-256)
  hasEncryption: boolean;
  uplinkEnabled?: boolean;   // MQTT uplink enabled
  downlinkEnabled?: boolean; // MQTT downlink enabled
  positionPrecision?: number; // Position precision (0 = disabled, 10-19 = low, 32 = full)
}

// Chat target - either a DM or a channel
export interface ChatTarget {
  type: 'dm' | 'channel';
  id: number;              // nodeNum for DM, channelIndex for channel
}

// Device configuration from Meshtastic
export interface DeviceConfig {
  // Device Config
  role?: string;                    // Node role (CLIENT, ROUTER, etc.)
  serialEnabled?: boolean;
  buttonGpio?: number;
  buzzerGpio?: number;
  rebroadcastMode?: string;
  nodeInfoBroadcastSecs?: number;
  doubleTapAsButtonPress?: boolean;
  tzdef?: string;                   // Timezone

  // Position Config
  positionBroadcastSecs?: number;
  positionBroadcastSmartEnabled?: boolean;
  gpsUpdateInterval?: number;
  gpsAttemptTime?: number;
  positionFlags?: number;
  rxGpio?: number;
  txGpio?: number;
  gpsEnGpio?: number;
  fixedPosition?: boolean;

  // Power Config
  isPowerSaving?: boolean;
  onBatteryShutdownAfterSecs?: number;
  adcMultiplierOverride?: number;
  waitBluetoothSecs?: number;
  sdsSecs?: number;                 // Super deep sleep seconds
  lsSecs?: number;                  // Light sleep seconds
  minWakeSecs?: number;

  // Network Config
  wifiEnabled?: boolean;
  wifiSsid?: string;
  ethEnabled?: boolean;
  ntpServer?: string;

  // Display Config
  screenOnSecs?: number;
  gpsFormat?: string;
  autoScreenCarouselSecs?: number;
  compassNorthTop?: boolean;
  flipScreen?: boolean;
  units?: string;                   // METRIC or IMPERIAL
  oled?: string;                    // OLED type

  // LoRa Config
  region?: string;                  // Region code (EU_868, US, etc.)
  modemPreset?: string;             // LONG_FAST, SHORT_SLOW, etc.
  hopLimit?: number;
  txPower?: number;                 // Transmit power in dBm
  txEnabled?: boolean;
  channelNum?: number;
  bandwidth?: number;
  spreadFactor?: number;
  codingRate?: number;
  frequencyOffset?: number;
  overrideDutyCycle?: boolean;
  ignoreMqtt?: boolean;
  okToMqtt?: boolean;

  // Bluetooth Config
  enabled?: boolean;
  mode?: string;                    // RANDOM_PIN, FIXED_PIN, NO_PIN
  fixedPin?: number;
}

// Device metadata from Meshtastic
export interface DeviceMetadata {
  firmwareVersion?: string;
  deviceStateVersion?: number;
  canShutdown?: boolean;
  hasWifi?: boolean;
  hasBluetooth?: boolean;
  hasEthernet?: boolean;
  role?: string;
  positionFlags?: number;
  hwModel?: string;
  hasRemoteHardware?: boolean;
}

// MyNodeInfo - additional info about local node
export interface MyNodeInfoExtended {
  myNodeNum: number;
  rebootCount?: number;
  minAppVersion?: number;
  maxChannels?: number;
}

// MQTT Settings for device configuration
export interface MqttSettings {
  enabled: boolean;
  address: string;           // MQTT server address (e.g., "mqtt.example.com")
  username: string;
  password: string;
  encryptionEnabled: boolean; // Send encrypted packets to MQTT
  tlsEnabled: boolean;        // Use TLS connection
  root: string;               // Root topic (default "msh")
  proxyToClientEnabled: boolean; // Use phone's internet for MQTT
}

// MQTT Client Proxy Message (from/to device via BLE)
export interface MqttClientProxyMessage {
  topic: string;
  data?: Uint8Array;
  text?: string;
  retained: boolean;
}

// MQTT Proxy connection state
export interface MqttProxyState {
  isConnected: boolean;
  error?: string;
}

// GPS Location
export interface GpsLocation {
  latitude: number;
  longitude: number;
  altitude?: number;
}

// Device Telemetry
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
  mqttSettings: MqttSettings;
  saveMqttSettings: (settings: MqttSettings) => Promise<void>;
  isConnected: boolean;
}
