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

export interface Message {
  id: string;
  from: number;
  to: number;
  text: string;
  timestamp: number;
  isOutgoing: boolean;
  channel?: number;
}

export type ActiveTab = 'people' | 'chat' | 'map' | 'settings';

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
}

// Chat target - either a DM or a channel
export interface ChatTarget {
  type: 'dm' | 'channel';
  id: number;              // nodeNum for DM, channelIndex for channel
}
