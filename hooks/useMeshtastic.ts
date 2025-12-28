import { useState, useEffect, useCallback } from 'react';
import { Device } from 'react-native-ble-plx';
import { meshtasticService } from '../services/MeshtasticService';
import { notificationService } from '../services/NotificationService';
import type { NodeInfo, Message, Channel, DeviceConfig, DeviceMetadata, MyNodeInfoExtended } from '../types';
import { DeviceStatusEnum } from '../types';

export interface DeviceTelemetry {
  batteryLevel?: number;
  voltage?: number;
  channelUtilization?: number;
  airUtilTx?: number;
  uptimeSeconds?: number;
}

export interface UseMeshtasticResult {
  // Connection state
  deviceStatus: DeviceStatusEnum;
  myNodeNum: number | null;
  error: string | null;

  // Data
  nodes: NodeInfo[];
  channels: Channel[];
  deviceTelemetry: DeviceTelemetry;
  deviceConfig: DeviceConfig;
  deviceMetadata: DeviceMetadata;
  myNodeInfo: MyNodeInfoExtended | null;

  // Actions
  disconnect: () => void;
  sendMessage: (to: number, text: string) => Promise<Message | null>;
  sendChannelMessage: (text: string, channelIndex: number) => Promise<Message | null>;
  sendLocationMessage: (latitude: number, longitude: number, destination: number | 'broadcast', channelIndex?: number) => Promise<Message | null>;
  addChannelFromQR: (name: string, psk: Uint8Array, uplinkEnabled?: boolean, downlinkEnabled?: boolean) => Promise<{ success: boolean; channelIndex: number }>;

  // Helpers
  getNodeName: (node: NodeInfo) => string;
  isMyNode: (node: NodeInfo) => boolean;
}

export function useMeshtastic(
  device: Device | null,
  onMessage?: (message: Message) => void,
  onAck?: (packetId: number, success: boolean) => void
): UseMeshtasticResult {
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatusEnum>(
    DeviceStatusEnum.DeviceDisconnected
  );
  const [myNodeNum, setMyNodeNum] = useState<number | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deviceTelemetry, setDeviceTelemetry] = useState<DeviceTelemetry>({});
  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig>({});
  const [deviceMetadata, setDeviceMetadata] = useState<DeviceMetadata>({});
  const [myNodeInfo, setMyNodeInfo] = useState<MyNodeInfoExtended | null>(null);

  // Initialize notifications
  useEffect(() => {
    notificationService.initialize();
    return () => {
      notificationService.cleanup();
    };
  }, []);

  // Connect to device and subscribe to events
  useEffect(() => {
    console.log('[useMeshtastic] useEffect triggered, device:', device?.id || 'null');

    // Skip if no device (offline mode)
    if (!device) {
      console.log('[useMeshtastic] No device, setting disconnected status');
      setDeviceStatus(DeviceStatusEnum.DeviceDisconnected);
      return;
    }

    console.log('[useMeshtastic] Setting up subscriptions...');
    const subscriptions = [
      meshtasticService.onDeviceStatus.subscribe(setDeviceStatus),
      meshtasticService.onMyNodeInfo.subscribe((info) => {
        setMyNodeNum(info.myNodeNum);
      }),
      meshtasticService.onNodeInfoPacket.subscribe((nodeInfo) => {
        setNodes((prev) => {
          const existing = prev.findIndex((n) => n.nodeNum === nodeInfo.nodeNum);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = { ...updated[existing], ...nodeInfo };
            return updated;
          }
          return [...prev, nodeInfo];
        });
      }),
      meshtasticService.onChannelPacket.subscribe((channel) => {
        setChannels((prev) => {
          const existing = prev.findIndex((c) => c.index === channel.index);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = channel;
            return updated;
          }
          return [...prev, channel].sort((a, b) => a.index - b.index);
        });
      }),
      meshtasticService.onMessagePacket.subscribe((message) => {
        onMessage?.(message);
      }),
      meshtasticService.onMessageAck.subscribe(({ packetId, success }) => {
        onAck?.(packetId, success);
      }),
      meshtasticService.onTelemetryPacket.subscribe((packet) => {
        const telemetry = packet.data;
        if (telemetry.variant?.case === 'deviceMetrics') {
          const metrics = telemetry.variant.value;
          setDeviceTelemetry((prev) => ({
            ...prev,
            batteryLevel: metrics.batteryLevel,
            voltage: metrics.voltage,
            channelUtilization: metrics.channelUtilization,
            airUtilTx: metrics.airUtilTx,
            uptimeSeconds: metrics.uptimeSeconds,
          }));
        }
      }),
      meshtasticService.onError.subscribe((err) => {
        setError(err.message);
        setTimeout(() => setError(null), 5000);
      }),
      meshtasticService.onConfigPacket.subscribe((config) => {
        setDeviceConfig(config);
      }),
      meshtasticService.onMetadataPacket.subscribe((metadata) => {
        setDeviceMetadata(metadata);
      }),
      meshtasticService.onMyNodeInfoExtended.subscribe((info) => {
        setMyNodeInfo(info);
      }),
    ];

    // Connect
    console.log('[useMeshtastic] Calling meshtasticService.connect...');
    meshtasticService.connect(device).then(() => {
      console.log('[useMeshtastic] meshtasticService.connect completed');
    }).catch((err) => {
      console.log('[useMeshtastic] meshtasticService.connect error:', err);
    });

    return () => {
      console.log('[useMeshtastic] Cleanup: unsubscribing and disconnecting');
      subscriptions.forEach((unsub) => unsub());
      meshtasticService.disconnect();
    };
  }, [device, onMessage, onAck]);

  const disconnect = useCallback(() => {
    meshtasticService.disconnect();
  }, []);

  const sendMessage = useCallback(async (to: number, text: string): Promise<Message | null> => {
    return meshtasticService.sendMessage(to, text);
  }, []);

  const sendChannelMessage = useCallback(async (text: string, channelIndex: number): Promise<Message | null> => {
    return meshtasticService.sendText(text, 'broadcast', channelIndex);
  }, []);

  const sendLocationMessage = useCallback(async (
    latitude: number,
    longitude: number,
    destination: number | 'broadcast',
    channelIndex: number = 0
  ): Promise<Message | null> => {
    return meshtasticService.sendLocationMessage(latitude, longitude, destination, channelIndex);
  }, []);

  const addChannelFromQR = useCallback(async (
    name: string,
    psk: Uint8Array,
    uplinkEnabled: boolean = false,
    downlinkEnabled: boolean = false
  ): Promise<{ success: boolean; channelIndex: number }> => {
    return meshtasticService.addChannelFromQR(name, psk, uplinkEnabled, downlinkEnabled);
  }, []);

  const getNodeName = useCallback((node: NodeInfo): string => {
    return node.user?.longName || node.longName || node.shortName || `Node ${node.nodeNum.toString(16).toUpperCase()}`;
  }, []);

  const isMyNode = useCallback((node: NodeInfo): boolean => {
    return node.nodeNum === myNodeNum;
  }, [myNodeNum]);

  return {
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
  };
}
