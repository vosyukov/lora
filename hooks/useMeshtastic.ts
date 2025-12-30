import { useState, useEffect, useCallback, useRef } from 'react';
import { Device } from 'react-native-ble-plx';
import { meshtasticService } from '../services/MeshtasticService';
import { notificationService } from '../services/NotificationService';
import { logger } from '../services/LoggerService';
import type { NodeInfo, Message, Channel, DeviceConfig, DeviceMetadata, MyNodeInfoExtended, MqttSettings, DeviceTelemetry } from '../types';
import { DeviceStatusEnum } from '../types';

// Re-export for backward compatibility
export type { DeviceTelemetry } from '../types';

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
  radioMqttConfig: MqttSettings | null; // MQTT config from radio

  // Actions
  disconnect: () => void;
  sendMessage: (to: number, text: string, packetId?: number) => Promise<Message | null>;
  sendChannelMessage: (text: string, channelIndex: number, packetId?: number) => Promise<Message | null>;
  sendLocationMessage: (latitude: number, longitude: number, destination: number | 'broadcast', channelIndex?: number, packetId?: number) => Promise<Message | null>;
  addChannelFromQR: (name: string, psk: Uint8Array, uplinkEnabled?: boolean, downlinkEnabled?: boolean) => Promise<{ success: boolean; channelIndex: number }>;
  setMqttConfig: (settings: MqttSettings) => Promise<boolean>;

  // Helpers
  getNodeName: (node: NodeInfo) => string;
  isMyNode: (node: NodeInfo) => boolean;
}

export function useMeshtastic(
  device: Device | null,
  onMessage?: (message: Message) => void,
  onAck?: (packetId: number, success: boolean) => void,
  mqttSettings?: MqttSettings
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
  const [radioMqttConfig, setRadioMqttConfig] = useState<MqttSettings | null>(null);
  const mqttConfigSentRef = useRef(false);

  // Initialize notifications
  useEffect(() => {
    notificationService.initialize();
    return () => {
      notificationService.cleanup();
    };
  }, []);

  // Connect to device and subscribe to events
  useEffect(() => {
    logger.debug('useMeshtastic', 'useEffect triggered, device:', device?.id || 'null');

    // Skip if no device (offline mode)
    if (!device) {
      logger.debug('useMeshtastic', 'No device, setting disconnected status');
      setDeviceStatus(DeviceStatusEnum.DeviceDisconnected);
      return;
    }

    logger.debug('useMeshtastic', 'Setting up subscriptions...');
    const subscriptions = [
      meshtasticService.onDeviceStatus.subscribe((status) => {
        logger.debug('useMeshtastic', 'onDeviceStatus:', status);
        setDeviceStatus(status);
      }),
      meshtasticService.onMyNodeInfo.subscribe((info) => {
        logger.debug('useMeshtastic', 'onMyNodeInfo:', info.myNodeNum);
        setMyNodeNum(info.myNodeNum);
      }),
      meshtasticService.onNodeInfoPacket.subscribe((nodeInfo) => {
        logger.debug('useMeshtastic', 'onNodeInfoPacket:', nodeInfo.nodeNum, nodeInfo.longName);
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
        logger.debug('useMeshtastic', 'onChannelPacket:', channel.index, channel.name);
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
        logger.debug('useMeshtastic', 'onMessagePacket:', message.from, message.text?.slice(0, 20));
        onMessage?.(message);
      }),
      meshtasticService.onMessageAck.subscribe(({ packetId, success }) => {
        logger.debug('useMeshtastic', 'onMessageAck:', packetId, success);
        onAck?.(packetId, success);
      }),
      meshtasticService.onTelemetryPacket.subscribe((packet) => {
        const telemetry = packet.data;
        if (telemetry.variant?.case === 'deviceMetrics') {
          const metrics = telemetry.variant.value;
          logger.debug('useMeshtastic', 'onTelemetryPacket deviceMetrics:', {
            battery: metrics.batteryLevel,
            voltage: metrics.voltage,
          });
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
        logger.debug('useMeshtastic', 'onError:', err.message);
        setError(err.message);
        setTimeout(() => setError(null), 5000);
      }),
      meshtasticService.onConfigPacket.subscribe((config) => {
        logger.debug('useMeshtastic', 'onConfigPacket:', Object.keys(config).length, 'keys');
        setDeviceConfig(config);
      }),
      meshtasticService.onMetadataPacket.subscribe((metadata) => {
        logger.debug('useMeshtastic', 'onMetadataPacket:', metadata.firmwareVersion);
        setDeviceMetadata(metadata);
      }),
      meshtasticService.onMyNodeInfoExtended.subscribe((info) => {
        logger.debug('useMeshtastic', 'onMyNodeInfoExtended:', info);
        setMyNodeInfo(info);
      }),
      meshtasticService.onMqttConfigPacket.subscribe((config) => {
        logger.debug('useMeshtastic', 'onMqttConfigPacket:', { enabled: config.enabled, address: config.address });
        setRadioMqttConfig(config);
      }),
    ];

    // Connect
    logger.debug('useMeshtastic', 'Calling meshtasticService.connect...');
    mqttConfigSentRef.current = false; // Reset on new connection
    meshtasticService.connect(device).then(() => {
      logger.debug('useMeshtastic', 'meshtasticService.connect completed');
    }).catch((err) => {
      logger.debug('useMeshtastic', 'meshtasticService.connect error:', err);
    });

    return () => {
      logger.debug('useMeshtastic', 'Cleanup: unsubscribing and disconnecting');
      subscriptions.forEach((unsub) => unsub());
      meshtasticService.disconnect();
    };
  }, [device, onMessage, onAck]);

  // Send MQTT config and check channel settings when device is configured
  // Wait a bit for moduleConfig to arrive from radio before sending
  useEffect(() => {
    if (
      deviceStatus === DeviceStatusEnum.DeviceConfigured &&
      mqttSettings &&
      mqttSettings.enabled &&
      mqttSettings.address &&
      !mqttConfigSentRef.current
    ) {
      logger.debug('useMeshtastic', 'Device configured, waiting 2s for radio config...');
      const timer = setTimeout(async () => {
        if (mqttConfigSentRef.current) return; // Already sent

        logger.debug('useMeshtastic', 'Checking MQTT config, radioMqttConfig:',
          radioMqttConfig ? { enabled: radioMqttConfig.enabled, address: radioMqttConfig.address } : 'null'
        );

        mqttConfigSentRef.current = true;

        // 1. Check and fix channel settings (uplink, downlink, position)
        logger.debug('useMeshtastic', 'Checking channel settings...');
        await meshtasticService.ensureChannelSettings();

        // 2. Send MQTT config
        const success = await meshtasticService.setMqttConfig(mqttSettings);
        if (success) {
          logger.debug('useMeshtastic', 'MQTT config sent/skipped successfully');
        } else {
          logger.debug('useMeshtastic', 'MQTT config send failed');
          mqttConfigSentRef.current = false; // Allow retry
        }
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [deviceStatus, mqttSettings, radioMqttConfig]);

  const disconnect = useCallback(() => {
    meshtasticService.disconnect();
  }, []);

  const sendMessage = useCallback(async (to: number, text: string, packetId?: number): Promise<Message | null> => {
    logger.debug('useMeshtastic', 'sendMessage called:', { to, textLength: text.length, packetId });
    const result = await meshtasticService.sendText(text, to, 0, true, packetId);
    logger.debug('useMeshtastic', 'sendMessage result:', result ? { id: result.id, packetId: result.packetId } : 'null');
    return result;
  }, []);

  const sendChannelMessage = useCallback(async (text: string, channelIndex: number, packetId?: number): Promise<Message | null> => {
    logger.debug('useMeshtastic', 'sendChannelMessage called:', { channelIndex, textLength: text.length, packetId });
    const result = await meshtasticService.sendText(text, 'broadcast', channelIndex, true, packetId);
    logger.debug('useMeshtastic', 'sendChannelMessage result:', result ? { id: result.id, packetId: result.packetId } : 'null');
    return result;
  }, []);

  const sendLocationMessage = useCallback(async (
    latitude: number,
    longitude: number,
    destination: number | 'broadcast',
    channelIndex: number = 0,
    packetId?: number
  ): Promise<Message | null> => {
    return meshtasticService.sendLocationMessage(latitude, longitude, destination, channelIndex, packetId);
  }, []);

  const addChannelFromQR = useCallback(async (
    name: string,
    psk: Uint8Array,
    uplinkEnabled: boolean = false,
    downlinkEnabled: boolean = false
  ): Promise<{ success: boolean; channelIndex: number }> => {
    return meshtasticService.addChannelFromQR(name, psk, uplinkEnabled, downlinkEnabled);
  }, []);

  const setMqttConfig = useCallback(async (settings: MqttSettings): Promise<boolean> => {
    return meshtasticService.setMqttConfig(settings);
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
    radioMqttConfig,
    disconnect,
    sendMessage,
    sendChannelMessage,
    sendLocationMessage,
    addChannelFromQR,
    setMqttConfig,
    getNodeName,
    isMyNode,
  };
}
