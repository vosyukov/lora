import { Device, Subscription } from 'react-native-ble-plx';
import { SimpleEventDispatcher } from 'ste-simple-events';
import type * as Protobuf from '@meshtastic/protobufs';

import { logger } from './LoggerService';
import { protobufCodecService } from './ProtobufCodecService';
import { channelService, ChannelWriteContext } from './ChannelService';
import { deviceConfigService, DeviceConfigContext } from './DeviceConfigService';
import { DeviceStatusEnum, ChannelRole } from '../types';
import type { NodeInfo, Message, PacketMetadata, Channel, DeviceConfig, DeviceMetadata, MyNodeInfoExtended, MqttSettings, MqttClientProxyMessage } from '../types';
import {
  MESHTASTIC_SERVICE_UUID,
  TORADIO_UUID,
  FROMRADIO_UUID,
  FROMNUM_UUID,
  BROADCAST_ADDR,
  MTU_SIZE,
  POLL_INTERVAL_MS,
  INITIAL_READ_DELAY_MS,
  MAX_EMPTY_READS,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_DELAY_MS,
} from '../constants/meshtastic';

/**
 * MeshtasticService - manages BLE connection and communication with Meshtastic devices.
 * Uses typed events from @meshtastic/core patterns with ste-simple-events.
 */
class MeshtasticService {
  private device: Device | null = null;
  private deviceId: string | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private monitorSubscription: Subscription | null = null;
  private _myNodeNum: number | null = null;
  private _deviceStatus: DeviceStatusEnum = DeviceStatusEnum.DeviceDisconnected;
  private nodes: Map<number, NodeInfo> = new Map();
  private channels: Map<number, Channel> = new Map();
  private reconnectAttempts: number = 0;
  private isReconnecting: boolean = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private bleManager: import('react-native-ble-plx').BleManager | null = null;
  private _deviceConfig: DeviceConfig = {};
  private _deviceMetadata: DeviceMetadata = {};
  private _myNodeInfo: MyNodeInfoExtended | null = null;
  private _mqttConfig: MqttSettings | null = null;
  private _expectingConfigRestart: boolean = false;

  // Typed event dispatchers (similar to @meshtastic/core EventSystem)
  readonly onDeviceStatus = new SimpleEventDispatcher<DeviceStatusEnum>();
  readonly onMyNodeInfo = new SimpleEventDispatcher<Protobuf.Mesh.MyNodeInfo>();
  readonly onNodeInfoPacket = new SimpleEventDispatcher<NodeInfo>();
  readonly onMessagePacket = new SimpleEventDispatcher<Message>();
  readonly onMessageAck = new SimpleEventDispatcher<{ packetId: number; success: boolean }>();
  readonly onPositionPacket = new SimpleEventDispatcher<PacketMetadata<Protobuf.Mesh.Position>>();
  readonly onTelemetryPacket = new SimpleEventDispatcher<PacketMetadata<Protobuf.Telemetry.Telemetry>>();
  readonly onChannelPacket = new SimpleEventDispatcher<Channel>();
  readonly onConfigPacket = new SimpleEventDispatcher<DeviceConfig>();
  readonly onMetadataPacket = new SimpleEventDispatcher<DeviceMetadata>();
  readonly onMyNodeInfoExtended = new SimpleEventDispatcher<MyNodeInfoExtended>();
  readonly onMqttConfigPacket = new SimpleEventDispatcher<MqttSettings>();
  readonly onMqttClientProxyMessage = new SimpleEventDispatcher<MqttClientProxyMessage>();
  readonly onError = new SimpleEventDispatcher<Error>();

  get myNodeNum(): number | null {
    return this._myNodeNum;
  }

  get deviceStatus(): DeviceStatusEnum {
    return this._deviceStatus;
  }

  getNodes(): NodeInfo[] {
    return Array.from(this.nodes.values());
  }

  getNode(nodeNum: number): NodeInfo | undefined {
    return this.nodes.get(nodeNum);
  }

  getChannels(): Channel[] {
    return Array.from(this.channels.values());
  }

  getChannel(index: number): Channel | undefined {
    return this.channels.get(index);
  }

  getActiveChannels(): Channel[] {
    return this.getChannels().filter(ch => ch.role !== ChannelRole.DISABLED);
  }

  getDeviceConfig(): DeviceConfig {
    return { ...this._deviceConfig };
  }

  getDeviceMetadata(): DeviceMetadata {
    return { ...this._deviceMetadata };
  }

  getMyNodeInfoExtended(): MyNodeInfoExtended | null {
    return this._myNodeInfo ? { ...this._myNodeInfo } : null;
  }

  getMqttConfig(): MqttSettings | null {
    return this._mqttConfig ? { ...this._mqttConfig } : null;
  }

  isConnected(): boolean {
    return this._deviceStatus >= DeviceStatusEnum.DeviceConnected;
  }

  private updateDeviceStatus(status: DeviceStatusEnum): void {
    if (this._deviceStatus !== status) {
      this._deviceStatus = status;
      this.onDeviceStatus.dispatch(status);
    }
  }

  /**
   * Set the BLE manager for reconnection
   */
  setBleManager(manager: import('react-native-ble-plx').BleManager): void {
    this.bleManager = manager;
  }

  async connect(device: Device): Promise<void> {
    try {
      logger.debug('MeshtasticService', 'Starting connect to:', device.id);

      // If connecting to a different device, clean up the old one first
      if (this.device && this.deviceId && this.deviceId !== device.id) {
        logger.debug('MeshtasticService', 'Different device, cleaning up old connection first');
        await this.disconnect();
      }

      // If already connecting/connected to this device, skip
      if (this.deviceId === device.id && this._deviceStatus >= DeviceStatusEnum.DeviceConnecting) {
        logger.debug('MeshtasticService', 'Already connecting/connected to this device, skipping');
        return;
      }

      this.updateDeviceStatus(DeviceStatusEnum.DeviceConnecting);
      this.deviceId = device.id;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      // Check if device is already connected (e.g., from HomeScreen.connectToDevice)
      logger.debug('MeshtasticService', 'Checking if device is already connected...');
      const alreadyConnected = await device.isConnected();

      let connectedDevice: Device;
      if (alreadyConnected) {
        logger.debug('MeshtasticService', 'Device already connected, reusing connection');
        connectedDevice = device;
      } else {
        logger.debug('MeshtasticService', 'Calling device.connect()...');
        const startTime = Date.now();
        connectedDevice = await device.connect();
        logger.debug('MeshtasticService', 'device.connect() done in', Date.now() - startTime, 'ms');
      }

      this.device = connectedDevice;

      this.updateDeviceStatus(DeviceStatusEnum.DeviceConnected);

      // Initialize BLE connection (MTU, service discovery, notifications)
      this.updateDeviceStatus(DeviceStatusEnum.DeviceInitializing);

      logger.debug('MeshtasticService', 'Requesting MTU...');
      try {
        await Promise.race([
          connectedDevice.requestMTU(MTU_SIZE),
          new Promise((_, reject) => setTimeout(() => reject(new Error('MTU timeout')), 5000))
        ]);
        logger.debug('MeshtasticService', 'MTU set');
      } catch (err) {
        logger.debug('MeshtasticService', 'MTU request failed (continuing):', err);
      }

      logger.debug('MeshtasticService', 'Discovering services...');
      await Promise.race([
        connectedDevice.discoverAllServicesAndCharacteristics(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Service discovery timeout')), 10000))
      ]);
      logger.debug('MeshtasticService', 'Services discovered');

      this.updateDeviceStatus(DeviceStatusEnum.DeviceConfiguring);

      // Subscribe to FromNum notifications
      logger.debug('MeshtasticService', 'Subscribing to FromNum notifications...');
      this.monitorSubscription = connectedDevice.monitorCharacteristicForService(
        MESHTASTIC_SERVICE_UUID,
        FROMNUM_UUID,
        async (error) => {
          if (error) {
            logger.debug('MeshtasticService', 'FromNum notification error:', error);
            // Dispatch error so UI can see it
            this.onError.dispatch(error);
            // Check if still connected
            try {
              const isConnected = await this.device?.isConnected();
              logger.debug('MeshtasticService', 'After FromNum error, isConnected:', isConnected);
              if (!isConnected) {
                this.stopPolling();
                this.startReconnect();
              }
            } catch {
              this.stopPolling();
              this.startReconnect();
            }
            return;
          }
          await this.readAllAvailable();
        }
      );
      logger.debug('MeshtasticService', 'FromNum subscription created');

      // Request initial configuration
      logger.debug('MeshtasticService', 'Requesting config...');
      await Promise.race([
        this.requestConfig(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Config request timeout')), 15000))
      ]);
      logger.debug('MeshtasticService', 'Config requested, reading initial data...');
      await this.readInitialData();
      logger.debug('MeshtasticService', 'Initial data read complete');

      this.updateDeviceStatus(DeviceStatusEnum.DeviceConfigured);
      logger.debug('MeshtasticService', 'Device fully configured!');

      // Start polling as fallback and connection monitoring
      this.startPollingInterval();
    } catch (err) {
      logger.debug('MeshtasticService', 'Connection error:', err);
      const error = err instanceof Error ? err : new Error('Connection failed');
      this.onError.dispatch(error);

      // If this was a reconnect attempt, schedule another one
      if (this.isReconnecting) {
        logger.debug('MeshtasticService', 'Was reconnecting, scheduling next attempt');
        this.scheduleReconnect();
      } else {
        logger.debug('MeshtasticService', 'Setting status to disconnected');
        this.updateDeviceStatus(DeviceStatusEnum.DeviceDisconnected);
      }
      throw error;
    }
  }

  private startReconnect(): void {
    logger.debug('MeshtasticService', 'startReconnect called, isReconnecting:', this.isReconnecting, 'deviceId:', this.deviceId, 'hasBleManager:', !!this.bleManager);

    if (this.isReconnecting || !this.deviceId || !this.bleManager) {
      logger.debug('MeshtasticService', 'startReconnect: skipping, setting disconnected');
      this.updateDeviceStatus(DeviceStatusEnum.DeviceDisconnected);
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts = 0;
    logger.debug('MeshtasticService', 'startReconnect: starting reconnection...');
    this.updateDeviceStatus(DeviceStatusEnum.DeviceReconnecting);
    this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    logger.debug('MeshtasticService', 'attemptReconnect called, attempt:', this.reconnectAttempts + 1, '/', MAX_RECONNECT_ATTEMPTS);

    if (!this.deviceId || !this.bleManager) {
      logger.debug('MeshtasticService', 'attemptReconnect: no deviceId or bleManager');
      this.stopReconnecting();
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.debug('MeshtasticService', 'attemptReconnect: max attempts reached');
      this.stopReconnecting();
      return;
    }

    this.reconnectAttempts++;

    try {
      // Clean up old connection
      if (this.monitorSubscription) {
        logger.debug('MeshtasticService', 'attemptReconnect: removing old subscription');
        this.monitorSubscription.remove();
        this.monitorSubscription = null;
      }

      // Try to get the device and connect
      logger.debug('MeshtasticService', 'attemptReconnect: getting device from bleManager...');
      const devices = await this.bleManager.devices([this.deviceId]);
      logger.debug('MeshtasticService', 'attemptReconnect: found', devices.length, 'devices');

      if (devices.length > 0) {
        const device = devices[0];

        // Check if already connected
        logger.debug('MeshtasticService', 'attemptReconnect: checking isConnected...');
        const isConnected = await device.isConnected();
        logger.debug('MeshtasticService', 'attemptReconnect: isConnected =', isConnected);

        if (isConnected) {
          this.device = device;
          await this.setupAfterReconnect();
          return;
        }

        // Try to connect
        logger.debug('MeshtasticService', 'attemptReconnect: calling device.connect()...');
        const connectedDevice = await device.connect();
        logger.debug('MeshtasticService', 'attemptReconnect: connected!');
        this.device = connectedDevice;
        await this.setupAfterReconnect();
        return;
      }

      // Device not found, schedule next attempt
      logger.debug('MeshtasticService', 'attemptReconnect: device not found, scheduling next');
      this.scheduleReconnect();
    } catch (err) {
      // Connection failed, schedule next attempt
      logger.debug('MeshtasticService', 'attemptReconnect error:', err);
      this.scheduleReconnect();
    }
  }

  private async setupAfterReconnect(): Promise<void> {
    if (!this.device) return;

    try {
      this.updateDeviceStatus(DeviceStatusEnum.DeviceConnected);

      // Initialize BLE connection (MTU, service discovery)
      this.updateDeviceStatus(DeviceStatusEnum.DeviceInitializing);

      await this.device.requestMTU(MTU_SIZE);
      await this.device.discoverAllServicesAndCharacteristics();

      this.updateDeviceStatus(DeviceStatusEnum.DeviceConfiguring);

      // Re-subscribe to FromNum notifications
      this.monitorSubscription = this.device.monitorCharacteristicForService(
        MESHTASTIC_SERVICE_UUID,
        FROMNUM_UUID,
        async (error) => {
          if (error) return;
          await this.readAllAvailable();
        }
      );

      // Request configuration again
      await this.requestConfig();
      await this.readInitialData();

      this.updateDeviceStatus(DeviceStatusEnum.DeviceConfigured);
      this.isReconnecting = false;
      this.reconnectAttempts = 0;

      // Restart polling
      this.startPollingInterval();
    } catch {
      // Setup failed, try reconnecting again
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.stopReconnecting();
      return;
    }

    this.reconnectTimeout = setTimeout(() => {
      this.attemptReconnect();
    }, RECONNECT_DELAY_MS);
  }

  private stopReconnecting(): void {
    this.isReconnecting = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.updateDeviceStatus(DeviceStatusEnum.DeviceDisconnected);
  }

  /**
   * Cancel any ongoing reconnection attempts
   */
  cancelReconnect(): void {
    this.stopReconnecting();
  }

  get reconnectAttemptsCount(): number {
    return this.reconnectAttempts;
  }

  get maxReconnectAttempts(): number {
    return MAX_RECONNECT_ATTEMPTS;
  }

  async disconnect(): Promise<void> {
    logger.debug('MeshtasticService', 'disconnect() called, deviceId:', this.deviceId);

    this.stopPolling();
    this.stopReconnecting();

    if (this.monitorSubscription) {
      logger.debug('MeshtasticService', 'Removing monitor subscription');
      this.monitorSubscription.remove();
      this.monitorSubscription = null;
    }

    if (this.device) {
      try {
        const isConnected = await this.device.isConnected();
        logger.debug('MeshtasticService', 'Device isConnected:', isConnected);
        if (isConnected) {
          logger.debug('MeshtasticService', 'Canceling connection...');
          await this.device.cancelConnection();
          logger.debug('MeshtasticService', 'Connection canceled');
        }
      } catch (err) {
        logger.debug('MeshtasticService', 'Disconnect error (ignored):', err);
      }
      this.device = null;
    }

    this.deviceId = null;
    this._myNodeNum = null;
    this.nodes.clear();
    this.channels.clear();
    this._deviceConfig = {};
    this._deviceMetadata = {};
    this._myNodeInfo = null;
    this._mqttConfig = null;
    logger.debug('MeshtasticService', 'State cleared, setting status to disconnected');
    this.updateDeviceStatus(DeviceStatusEnum.DeviceDisconnected);
  }

  async sendText(
    text: string,
    destination: number | 'broadcast' = 'broadcast',
    channel: number = 0,
    wantAck: boolean = true
  ): Promise<Message | null> {
    if (!this.device || !this._myNodeNum || !text.trim()) {
      return null;
    }

    const to = destination === 'broadcast' ? BROADCAST_ADDR : destination;

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Mesh, Portnums } = await import('@meshtastic/protobufs');

      const dataPayload = create(Mesh.DataSchema, {
        portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode(text),
      });

      const packetId = Math.floor(Math.random() * 0xFFFFFFFF);
      const meshPacket = create(Mesh.MeshPacketSchema, {
        to,
        from: this._myNodeNum,
        id: packetId,
        channel,
        wantAck,
        payloadVariant: {
          case: 'decoded',
          value: dataPayload,
        },
      });

      const toRadio = create(Mesh.ToRadioSchema, {
        payloadVariant: {
          case: 'packet',
          value: meshPacket,
        },
      });

      const payload = toBinary(Mesh.ToRadioSchema, toRadio);
      const base64Payload = btoa(String.fromCharCode.apply(null, Array.from(payload)));

      await this.device.writeCharacteristicWithResponseForService(
        MESHTASTIC_SERVICE_UUID,
        TORADIO_UUID,
        base64Payload
      );

      const message: Message = {
        id: `${this._myNodeNum}-${Date.now()}`,
        packetId,
        from: this._myNodeNum,
        to,
        text,
        timestamp: Date.now(),
        isOutgoing: true,
        channel,
        status: 'sent', // Sent to device, waiting for ACK
      };

      return message;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to send message');
      this.onError.dispatch(error);
      return null;
    }
  }

  // Alias for backward compatibility
  async sendMessage(to: number, text: string): Promise<Message | null> {
    return this.sendText(text, to);
  }

  /**
   * Send position from phone GPS to the node
   * The node will broadcast this position to the mesh network
   * @param latitude - Latitude in degrees
   * @param longitude - Longitude in degrees
   * @param altitude - Altitude in meters (optional)
   */
  async sendPosition(
    latitude: number,
    longitude: number,
    altitude?: number
  ): Promise<boolean> {
    if (!this.device || !this._myNodeNum) {
      return false;
    }

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Mesh, Portnums } = await import('@meshtastic/protobufs');

      // Create Position protobuf
      // Coordinates are stored as int32 with 1e-7 precision
      const position = create(Mesh.PositionSchema, {
        latitudeI: Math.round(latitude * 1e7),
        longitudeI: Math.round(longitude * 1e7),
        altitude: altitude ? Math.round(altitude) : 0,
        time: Math.floor(Date.now() / 1000),
      });

      const positionPayload = toBinary(Mesh.PositionSchema, position);

      // Create Data payload with POSITION_APP portnum
      const dataPayload = create(Mesh.DataSchema, {
        portnum: Portnums.PortNum.POSITION_APP,
        payload: positionPayload,
      });

      // Create MeshPacket to self - node will handle broadcasting
      const packetId = Math.floor(Math.random() * 0xFFFFFFFF);
      const meshPacket = create(Mesh.MeshPacketSchema, {
        to: this._myNodeNum,
        from: this._myNodeNum,
        id: packetId,
        wantAck: false,
        payloadVariant: {
          case: 'decoded',
          value: dataPayload,
        },
      });

      // Wrap in ToRadio
      const toRadio = create(Mesh.ToRadioSchema, {
        payloadVariant: {
          case: 'packet',
          value: meshPacket,
        },
      });

      const payload = toBinary(Mesh.ToRadioSchema, toRadio);
      const base64Payload = btoa(String.fromCharCode.apply(null, Array.from(payload)));

      await this.device.writeCharacteristicWithResponseForService(
        MESHTASTIC_SERVICE_UUID,
        TORADIO_UUID,
        base64Payload
      );

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to send position');
      this.onError.dispatch(error);
      return false;
    }
  }

  /**
   * Send location as a message to a specific destination (DM or channel)
   * @param latitude - Latitude in degrees
   * @param longitude - Longitude in degrees
   * @param destination - Target node number or 'broadcast' for channel
   * @param channel - Channel index (default 0)
   * @param altitude - Altitude in meters (optional)
   */
  async sendLocationMessage(
    latitude: number,
    longitude: number,
    destination: number | 'broadcast' = 'broadcast',
    channel: number = 0,
    altitude?: number
  ): Promise<Message | null> {
    if (!this.device || !this._myNodeNum) {
      return null;
    }

    const to = destination === 'broadcast' ? BROADCAST_ADDR : destination;

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Mesh, Portnums } = await import('@meshtastic/protobufs');

      // Create Position protobuf
      const position = create(Mesh.PositionSchema, {
        latitudeI: Math.round(latitude * 1e7),
        longitudeI: Math.round(longitude * 1e7),
        altitude: altitude ? Math.round(altitude) : 0,
        time: Math.floor(Date.now() / 1000),
      });

      const positionPayload = toBinary(Mesh.PositionSchema, position);

      // Create Data payload with POSITION_APP portnum
      const dataPayload = create(Mesh.DataSchema, {
        portnum: Portnums.PortNum.POSITION_APP,
        payload: positionPayload,
      });

      const packetId = Math.floor(Math.random() * 0xFFFFFFFF);
      const meshPacket = create(Mesh.MeshPacketSchema, {
        to,
        from: this._myNodeNum,
        id: packetId,
        channel,
        wantAck: destination !== 'broadcast',
        payloadVariant: {
          case: 'decoded',
          value: dataPayload,
        },
      });

      const toRadio = create(Mesh.ToRadioSchema, {
        payloadVariant: {
          case: 'packet',
          value: meshPacket,
        },
      });

      const payload = toBinary(Mesh.ToRadioSchema, toRadio);
      const base64Payload = btoa(String.fromCharCode.apply(null, Array.from(payload)));

      await this.device.writeCharacteristicWithResponseForService(
        MESHTASTIC_SERVICE_UUID,
        TORADIO_UUID,
        base64Payload
      );

      const message: Message = {
        id: `${this._myNodeNum}-${Date.now()}`,
        packetId,
        from: this._myNodeNum,
        to,
        text: '📍 Геолокация',
        timestamp: Date.now(),
        isOutgoing: true,
        channel,
        status: 'sent',
        type: 'location',
        location: {
          latitude,
          longitude,
          altitude,
          time: Math.floor(Date.now() / 1000),
        },
      };

      return message;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to send location');
      this.onError.dispatch(error);
      return null;
    }
  }

  /**
   * Send MQTT Client Proxy message to device
   * Used when phone receives message from MQTT broker and needs to forward to device
   * @param topic - MQTT topic
   * @param data - Binary payload
   * @param retained - Whether message is retained
   */
  async sendMqttClientProxyMessage(
    topic: string,
    data: Uint8Array,
    retained: boolean = false
  ): Promise<boolean> {
    if (!this.device) {
      logger.warn('MeshtasticService', 'Cannot send MQTT proxy - not connected');
      return false;
    }

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Mesh } = await import('@meshtastic/protobufs');

      // Create MqttClientProxyMessage
      const mqttProxyMessage = create(Mesh.MqttClientProxyMessageSchema, {
        topic,
        payloadVariant: {
          case: 'data',
          value: data,
        },
        retained,
      });

      // Wrap in ToRadio
      const toRadio = create(Mesh.ToRadioSchema, {
        payloadVariant: {
          case: 'mqttClientProxyMessage',
          value: mqttProxyMessage,
        },
      });

      const payload = toBinary(Mesh.ToRadioSchema, toRadio);
      const base64Payload = btoa(String.fromCharCode.apply(null, Array.from(payload)));

      await this.device.writeCharacteristicWithResponseForService(
        MESHTASTIC_SERVICE_UUID,
        TORADIO_UUID,
        base64Payload
      );

      logger.debug('MeshtasticService', 'MQTT proxy message sent:', topic);
      return true;
    } catch (err) {
      logger.error('MeshtasticService', 'Failed to send MQTT proxy message:', err);
      const error = err instanceof Error ? err : new Error('Failed to send MQTT proxy message');
      this.onError.dispatch(error);
      return false;
    }
  }

  /**
   * Get context for channel operations
   */
  private getChannelContext(): ChannelWriteContext {
    return {
      writeToDevice: async (payload: string) => {
        if (!this.device) throw new Error('Device not connected');
        await this.device.writeCharacteristicWithResponseForService(
          MESHTASTIC_SERVICE_UUID,
          TORADIO_UUID,
          payload
        );
      },
      getMyNodeNum: () => this._myNodeNum,
      updateChannel: (channel: Channel) => {
        this.channels.set(channel.index, channel);
        this.onChannelPacket.dispatch(channel);
      },
      dispatchError: (error: Error) => this.onError.dispatch(error),
    };
  }

  /**
   * Create or update a channel
   * @param index - Channel index (0-7)
   * @param name - Channel name
   * @param psk - Pre-shared key (0 bytes = no encryption, 16 = AES-128, 32 = AES-256)
   * @param role - Channel role (PRIMARY, SECONDARY, DISABLED)
   */
  async setChannel(
    index: number,
    name: string,
    psk: Uint8Array = new Uint8Array(),
    role: ChannelRole = ChannelRole.SECONDARY
  ): Promise<boolean> {
    if (!this.device || !this._myNodeNum) {
      return false;
    }
    return channelService.setChannel(index, name, psk, role, this.getChannelContext());
  }

  /**
   * Add a channel from QR code data
   * Finds the first available slot and adds the channel there
   */
  async addChannelFromQR(
    name: string,
    psk: Uint8Array,
    uplinkEnabled: boolean = false,
    downlinkEnabled: boolean = false
  ): Promise<{ success: boolean; channelIndex: number }> {
    if (!this.device || !this._myNodeNum) {
      return { success: false, channelIndex: -1 };
    }
    return channelService.addChannelFromQR(
      name,
      psk,
      uplinkEnabled,
      downlinkEnabled,
      this.channels,
      this.getChannelContext()
    );
  }

  /**
   * Delete a channel (set role to DISABLED)
   */
  async deleteChannel(index: number): Promise<boolean> {
    return channelService.deleteChannel(index, this.getChannelContext());
  }

  /**
   * Update channel settings (uplink, downlink, position)
   */
  async updateChannelSettings(
    index: number,
    uplinkEnabled: boolean,
    downlinkEnabled: boolean,
    positionPrecision: number = 32 // 32 = full precision
  ): Promise<boolean> {
    const channel = this.channels.get(index);
    if (!channel || !this.device || !this._myNodeNum) {
      return false;
    }
    return channelService.updateChannelSettings(
      channel,
      uplinkEnabled,
      downlinkEnabled,
      positionPrecision,
      this.getChannelContext()
    );
  }

  /**
   * Check and fix channel settings (uplink, downlink, position) for all active channels
   */
  async ensureChannelSettings(): Promise<void> {
    return channelService.ensureChannelSettings(
      this.getActiveChannels(),
      this.getChannelContext(),
      this.delay.bind(this)
    );
  }

  /**
   * Get context for device config operations
   */
  private getDeviceConfigContext(): DeviceConfigContext {
    return {
      writeToDevice: async (payload: string) => {
        if (!this.device) throw new Error('Device not connected');
        await this.device.writeCharacteristicWithResponseForService(
          MESHTASTIC_SERVICE_UUID,
          TORADIO_UUID,
          payload
        );
      },
      getMyNodeNum: () => this._myNodeNum,
      getMyNode: () => this._myNodeNum ? this.nodes.get(this._myNodeNum) : undefined,
      getMqttConfig: () => this._mqttConfig,
      updateNode: (node: NodeInfo) => {
        this.nodes.set(node.nodeNum, node);
        this.onNodeInfoPacket.dispatch(node);
      },
      dispatchError: (error: Error) => this.onError.dispatch(error),
      stopPolling: () => this.stopPolling(),
      startPolling: () => this.startPollingInterval(),
      isDeviceConnected: async () => {
        if (!this.device) return false;
        return this.device.isConnected();
      },
      delay: (ms: number) => this.delay(ms),
    };
  }

  /**
   * Set the owner (user) info on the device
   * @param longName - Full name (displayed in UI)
   * @param shortName - Short name (max 4 characters, used in compact views)
   * @param force - Force send even if name matches current config
   */
  async setOwner(longName: string, shortName: string, force: boolean = false): Promise<boolean> {
    if (!this.device || !this._myNodeNum) {
      return false;
    }
    return deviceConfigService.setOwner(longName, shortName, force, this.getDeviceConfigContext());
  }

  /**
   * Configure MQTT settings on the device
   * @param settings - MQTT configuration
   * @param force - Force send even if settings match current config
   */
  async setMqttConfig(settings: MqttSettings, force: boolean = false): Promise<boolean> {
    if (!this.device || !this._myNodeNum) {
      return false;
    }

    // Set flag before calling service
    this._expectingConfigRestart = true;

    try {
      const result = await deviceConfigService.setMqttConfig(settings, force, this.getDeviceConfigContext());
      return result;
    } finally {
      this._expectingConfigRestart = false;
    }
  }

  /**
   * Generate short name from long name (max 4 characters)
   * Takes first letters of words or first 4 characters
   */
  generateShortName(longName: string): string {
    return deviceConfigService.generateShortName(longName);
  }

  /**
   * Generate a random PSK of specified length
   * @param length - 16 for AES-128, 32 for AES-256
   */
  generatePsk(length: 16 | 32 = 32): Uint8Array {
    return channelService.generatePsk(length);
  }

  /**
   * Generate a shareable Meshtastic URL for a channel
   * @param channelIndex - Channel index to share
   * @returns Meshtastic URL or null if channel doesn't exist
   */
  async getChannelUrl(channelIndex: number): Promise<string | null> {
    const channel = this.channels.get(channelIndex);
    if (!channel) return null;
    return channelService.getChannelUrl(channel);
  }

  private async requestConfig(): Promise<void> {
    logger.debug('MeshtasticService', 'requestConfig starting...');
    if (!this.device) {
      logger.debug('MeshtasticService', 'requestConfig: no device, skipping');
      return;
    }

    logger.debug('MeshtasticService', 'Importing protobuf...');
    const { create, toBinary } = await import('@bufbuild/protobuf');
    const { Mesh } = await import('@meshtastic/protobufs');
    logger.debug('MeshtasticService', 'Protobuf imported');

    const configId = Math.floor(Date.now() / 1000) % 0xFFFFFFFF;
    logger.debug('MeshtasticService', 'Creating config request with id:', configId);
    const configRequest = create(Mesh.ToRadioSchema, {
      payloadVariant: {
        case: 'wantConfigId',
        value: configId,
      },
    });

    const payload = toBinary(Mesh.ToRadioSchema, configRequest);
    const base64Payload = btoa(String.fromCharCode.apply(null, Array.from(payload)));

    logger.debug('MeshtasticService', 'Writing config request to device...');
    await this.device.writeCharacteristicWithResponseForService(
      MESHTASTIC_SERVICE_UUID,
      TORADIO_UUID,
      base64Payload
    );
    logger.debug('MeshtasticService', 'Config request sent');
  }

  private async readInitialData(): Promise<void> {
    logger.debug('MeshtasticService', 'readInitialData starting');
    let emptyReads = 0;
    let totalReads = 0;
    const startTime = Date.now();
    const MAX_READ_TIME_MS = 15000; // 15 seconds max for initial data

    while (emptyReads < MAX_EMPTY_READS) {
      // Check timeout
      if (Date.now() - startTime > MAX_READ_TIME_MS) {
        logger.debug('MeshtasticService', 'readInitialData timeout after', totalReads, 'reads');
        break;
      }

      try {
        const hasData = await this.readFromRadio();
        totalReads++;
        if (!hasData) {
          emptyReads++;
          await this.delay(INITIAL_READ_DELAY_MS);
        } else {
          emptyReads = 0;
        }
      } catch (err) {
        logger.debug('MeshtasticService', 'readInitialData error:', err);
        break;
      }
    }
    logger.debug('MeshtasticService', 'readInitialData complete:', {
      totalReads,
      timeMs: Date.now() - startTime,
      myNodeNum: this._myNodeNum,
      nodesCount: this.nodes.size,
      channelsCount: this.channels.size,
    });
  }

  private async readAllAvailable(): Promise<void> {
    let hasMore = true;
    while (hasMore) {
      hasMore = await this.readFromRadio();
    }
  }

  private async readFromRadio(): Promise<boolean> {
    if (!this.device) return false;

    try {
      const characteristic = await this.device.readCharacteristicForService(
        MESHTASTIC_SERVICE_UUID,
        FROMRADIO_UUID
      );

      if (!characteristic.value) {
        return false;
      }

      const binaryString = atob(characteristic.value);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const { fromBinary } = await import('@bufbuild/protobuf');
      const { Mesh } = await import('@meshtastic/protobufs');
      const fromRadio = fromBinary(Mesh.FromRadioSchema, bytes);

      await this.handleFromRadio(fromRadio);

      return true;
    } catch {
      return false;
    }
  }

  private async handleFromRadio(msg: unknown): Promise<void> {
    const fromRadio = msg as { payloadVariant?: { case: string; value: unknown } };
    const variant = fromRadio.payloadVariant;
    if (!variant) return;

    switch (variant.case) {
      case 'myInfo': {
        const myInfo = variant.value as Protobuf.Mesh.MyNodeInfo & {
          rebootCount?: number;
          minAppVersion?: number;
          maxChannels?: number;
        };
        this._myNodeNum = myInfo.myNodeNum;
        this._myNodeInfo = {
          myNodeNum: myInfo.myNodeNum,
          rebootCount: myInfo.rebootCount,
          minAppVersion: myInfo.minAppVersion,
          maxChannels: myInfo.maxChannels,
        };
        this.onMyNodeInfo.dispatch(myInfo);
        this.onMyNodeInfoExtended.dispatch(this._myNodeInfo);
        break;
      }

      case 'nodeInfo': {
        const nodeInfo = variant.value as {
          num: number;
          user?: { longName?: string; shortName?: string; hwModel?: unknown };
          lastHeard?: number;
          position?: Protobuf.Mesh.Position;
          snr?: number;
        };
        const node: NodeInfo = {
          nodeNum: nodeInfo.num,
          longName: nodeInfo.user?.longName,
          shortName: nodeInfo.user?.shortName,
          hwModel: nodeInfo.user?.hwModel?.toString(),
          lastHeard: nodeInfo.lastHeard,
          position: nodeInfo.position,
          snr: nodeInfo.snr,
        };
        this.nodes.set(node.nodeNum, node);
        this.onNodeInfoPacket.dispatch(node);
        break;
      }

      case 'packet': {
        await this.handleMeshPacket(variant.value);
        break;
      }

      case 'channel': {
        const channelData = variant.value as {
          index: number;
          settings?: {
            name?: string;
            psk?: Uint8Array;
            uplinkEnabled?: boolean;
            downlinkEnabled?: boolean;
            moduleSettings?: {
              positionPrecision?: number;
            };
          };
          role?: number;
        };

        const role = channelData.role ?? 0;
        const psk = channelData.settings?.psk;
        const settings = channelData.settings;

        const channel: Channel = {
          index: channelData.index,
          name: settings?.name || (channelData.index === 0 ? 'Primary' : `Channel ${channelData.index}`),
          role: role as ChannelRole,
          psk,
          hasEncryption: psk !== undefined && psk.length > 0,
          uplinkEnabled: settings?.uplinkEnabled,
          downlinkEnabled: settings?.downlinkEnabled,
          positionPrecision: settings?.moduleSettings?.positionPrecision,
        };

        logger.debug('MeshtasticService', 'Channel received:', {
          index: channel.index,
          name: channel.name,
          uplinkEnabled: channel.uplinkEnabled,
          downlinkEnabled: channel.downlinkEnabled,
          positionPrecision: channel.positionPrecision,
        });

        this.channels.set(channel.index, channel);
        this.onChannelPacket.dispatch(channel);
        break;
      }

      case 'config': {
        const configData = variant.value as {
          payloadVariant?: { case: string; value: unknown };
        };
        if (configData.payloadVariant) {
          this.handleConfigPayload(configData.payloadVariant);
        }
        break;
      }

      case 'moduleConfig': {
        const moduleConfigData = variant.value as {
          payloadVariant?: { case: string; value: unknown };
        };
        logger.debug('MeshtasticService', 'Received moduleConfig:', moduleConfigData.payloadVariant?.case || 'unknown');
        if (moduleConfigData.payloadVariant?.case === 'mqtt') {
          const mqtt = moduleConfigData.payloadVariant.value as {
            enabled?: boolean;
            address?: string;
            username?: string;
            password?: string;
            encryptionEnabled?: boolean;
            tlsEnabled?: boolean;
            root?: string;
            proxyToClientEnabled?: boolean;
          };
          this._mqttConfig = {
            enabled: mqtt.enabled ?? false,
            address: mqtt.address ?? '',
            username: mqtt.username ?? '',
            password: mqtt.password ?? '',
            encryptionEnabled: mqtt.encryptionEnabled ?? false,
            tlsEnabled: mqtt.tlsEnabled ?? false,
            root: mqtt.root ?? 'msh',
            proxyToClientEnabled: mqtt.proxyToClientEnabled ?? true,
          };
          logger.debug('MeshtasticService', 'Received MQTT config from radio:', {
            enabled: this._mqttConfig.enabled,
            address: this._mqttConfig.address,
            proxyToClientEnabled: this._mqttConfig.proxyToClientEnabled,
          });
          this.onMqttConfigPacket.dispatch(this._mqttConfig);
        }
        break;
      }

      case 'metadata': {
        const metadata = variant.value as {
          firmwareVersion?: string;
          deviceStateVersion?: number;
          canShutdown?: boolean;
          hasWifi?: boolean;
          hasBluetooth?: boolean;
          hasEthernet?: boolean;
          role?: number;
          positionFlags?: number;
          hwModel?: number;
          hasRemoteHardware?: boolean;
        };
        this._deviceMetadata = {
          firmwareVersion: metadata.firmwareVersion,
          deviceStateVersion: metadata.deviceStateVersion,
          canShutdown: metadata.canShutdown,
          hasWifi: metadata.hasWifi,
          hasBluetooth: metadata.hasBluetooth,
          hasEthernet: metadata.hasEthernet,
          role: metadata.role !== undefined ? this.roleToString(metadata.role) : undefined,
          positionFlags: metadata.positionFlags,
          hwModel: metadata.hwModel !== undefined ? this.hwModelToString(metadata.hwModel) : undefined,
          hasRemoteHardware: metadata.hasRemoteHardware,
        };
        this.onMetadataPacket.dispatch(this._deviceMetadata);
        break;
      }

      case 'mqttClientProxyMessage': {
        const proxyMsg = variant.value as {
          topic?: string;
          payloadVariant?: { case: 'data' | 'text'; value: Uint8Array | string };
          retained?: boolean;
        };

        const message: MqttClientProxyMessage = {
          topic: proxyMsg.topic || '',
          retained: proxyMsg.retained ?? false,
        };

        if (proxyMsg.payloadVariant?.case === 'data') {
          message.data = proxyMsg.payloadVariant.value as Uint8Array;
        } else if (proxyMsg.payloadVariant?.case === 'text') {
          message.text = proxyMsg.payloadVariant.value as string;
        }

        logger.debug('MeshtasticService', 'MQTT proxy message received:', message.topic);
        this.onMqttClientProxyMessage.dispatch(message);
        break;
      }
    }
  }

  private handleConfigPayload(payload: { case: string; value: unknown }): void {
    switch (payload.case) {
      case 'device': {
        const device = payload.value as {
          role?: number;
          serialEnabled?: boolean;
          buttonGpio?: number;
          buzzerGpio?: number;
          rebroadcastMode?: number;
          nodeInfoBroadcastSecs?: number;
          doubleTapAsButtonPress?: boolean;
          tzdef?: string;
        };
        this._deviceConfig = {
          ...this._deviceConfig,
          role: device.role !== undefined ? this.roleToString(device.role) : undefined,
          serialEnabled: device.serialEnabled,
          buttonGpio: device.buttonGpio,
          buzzerGpio: device.buzzerGpio,
          rebroadcastMode: device.rebroadcastMode !== undefined ? this.rebroadcastModeToString(device.rebroadcastMode) : undefined,
          nodeInfoBroadcastSecs: device.nodeInfoBroadcastSecs,
          doubleTapAsButtonPress: device.doubleTapAsButtonPress,
          tzdef: device.tzdef,
        };
        this.onConfigPacket.dispatch(this._deviceConfig);
        break;
      }

      case 'position': {
        const position = payload.value as {
          positionBroadcastSecs?: number;
          positionBroadcastSmartEnabled?: boolean;
          gpsUpdateInterval?: number;
          gpsAttemptTime?: number;
          positionFlags?: number;
          rxGpio?: number;
          txGpio?: number;
          gpsEnGpio?: number;
          fixedPosition?: boolean;
        };
        this._deviceConfig = {
          ...this._deviceConfig,
          positionBroadcastSecs: position.positionBroadcastSecs,
          positionBroadcastSmartEnabled: position.positionBroadcastSmartEnabled,
          gpsUpdateInterval: position.gpsUpdateInterval,
          gpsAttemptTime: position.gpsAttemptTime,
          positionFlags: position.positionFlags,
          rxGpio: position.rxGpio,
          txGpio: position.txGpio,
          gpsEnGpio: position.gpsEnGpio,
          fixedPosition: position.fixedPosition,
        };
        this.onConfigPacket.dispatch(this._deviceConfig);
        break;
      }

      case 'power': {
        const power = payload.value as {
          isPowerSaving?: boolean;
          onBatteryShutdownAfterSecs?: number;
          adcMultiplierOverride?: number;
          waitBluetoothSecs?: number;
          sdsSecs?: number;
          lsSecs?: number;
          minWakeSecs?: number;
        };
        this._deviceConfig = {
          ...this._deviceConfig,
          isPowerSaving: power.isPowerSaving,
          onBatteryShutdownAfterSecs: power.onBatteryShutdownAfterSecs,
          adcMultiplierOverride: power.adcMultiplierOverride,
          waitBluetoothSecs: power.waitBluetoothSecs,
          sdsSecs: power.sdsSecs,
          lsSecs: power.lsSecs,
          minWakeSecs: power.minWakeSecs,
        };
        this.onConfigPacket.dispatch(this._deviceConfig);
        break;
      }

      case 'network': {
        const network = payload.value as {
          wifiEnabled?: boolean;
          wifiSsid?: string;
          ethEnabled?: boolean;
          ntpServer?: string;
        };
        this._deviceConfig = {
          ...this._deviceConfig,
          wifiEnabled: network.wifiEnabled,
          wifiSsid: network.wifiSsid,
          ethEnabled: network.ethEnabled,
          ntpServer: network.ntpServer,
        };
        this.onConfigPacket.dispatch(this._deviceConfig);
        break;
      }

      case 'display': {
        const display = payload.value as {
          screenOnSecs?: number;
          gpsFormat?: number;
          autoScreenCarouselSecs?: number;
          compassNorthTop?: boolean;
          flipScreen?: boolean;
          units?: number;
          oled?: number;
        };
        this._deviceConfig = {
          ...this._deviceConfig,
          screenOnSecs: display.screenOnSecs,
          gpsFormat: display.gpsFormat !== undefined ? this.gpsFormatToString(display.gpsFormat) : undefined,
          autoScreenCarouselSecs: display.autoScreenCarouselSecs,
          compassNorthTop: display.compassNorthTop,
          flipScreen: display.flipScreen,
          units: display.units !== undefined ? this.unitsToString(display.units) : undefined,
          oled: display.oled !== undefined ? this.oledToString(display.oled) : undefined,
        };
        this.onConfigPacket.dispatch(this._deviceConfig);
        break;
      }

      case 'lora': {
        const lora = payload.value as {
          region?: number;
          modemPreset?: number;
          hopLimit?: number;
          txPower?: number;
          txEnabled?: boolean;
          channelNum?: number;
          bandwidth?: number;
          spreadFactor?: number;
          codingRate?: number;
          frequencyOffset?: number;
          overrideDutyCycle?: boolean;
          ignoreMqtt?: boolean;
          okToMqtt?: boolean;
        };
        this._deviceConfig = {
          ...this._deviceConfig,
          region: lora.region !== undefined ? this.regionToString(lora.region) : undefined,
          modemPreset: lora.modemPreset !== undefined ? this.modemPresetToString(lora.modemPreset) : undefined,
          hopLimit: lora.hopLimit,
          txPower: lora.txPower,
          txEnabled: lora.txEnabled,
          channelNum: lora.channelNum,
          bandwidth: lora.bandwidth,
          spreadFactor: lora.spreadFactor,
          codingRate: lora.codingRate,
          frequencyOffset: lora.frequencyOffset,
          overrideDutyCycle: lora.overrideDutyCycle,
          ignoreMqtt: lora.ignoreMqtt,
          okToMqtt: lora.okToMqtt,
        };
        this.onConfigPacket.dispatch(this._deviceConfig);
        break;
      }

      case 'bluetooth': {
        const bluetooth = payload.value as {
          enabled?: boolean;
          mode?: number;
          fixedPin?: number;
        };
        this._deviceConfig = {
          ...this._deviceConfig,
          enabled: bluetooth.enabled,
          mode: bluetooth.mode !== undefined ? this.btModeToString(bluetooth.mode) : undefined,
          fixedPin: bluetooth.fixedPin,
        };
        this.onConfigPacket.dispatch(this._deviceConfig);
        break;
      }
    }
  }

  // Helper methods to convert enum values to readable strings
  private roleToString(role: number): string {
    const roles: Record<number, string> = {
      0: 'CLIENT',
      1: 'CLIENT_MUTE',
      2: 'ROUTER',
      3: 'ROUTER_CLIENT',
      4: 'REPEATER',
      5: 'TRACKER',
      6: 'SENSOR',
      7: 'TAK',
      8: 'CLIENT_HIDDEN',
      9: 'LOST_AND_FOUND',
      10: 'TAK_TRACKER',
    };
    return roles[role] ?? `UNKNOWN(${role})`;
  }

  private rebroadcastModeToString(mode: number): string {
    const modes: Record<number, string> = {
      0: 'ALL',
      1: 'ALL_SKIP_DECODING',
      2: 'LOCAL_ONLY',
      3: 'KNOWN_ONLY',
    };
    return modes[mode] ?? `UNKNOWN(${mode})`;
  }

  private regionToString(region: number): string {
    const regions: Record<number, string> = {
      0: 'UNSET',
      1: 'US',
      2: 'EU_433',
      3: 'EU_868',
      4: 'CN',
      5: 'JP',
      6: 'ANZ',
      7: 'KR',
      8: 'TW',
      9: 'RU',
      10: 'IN',
      11: 'NZ_865',
      12: 'TH',
      13: 'LORA_24',
      14: 'UA_433',
      15: 'UA_868',
      16: 'MY_433',
      17: 'MY_919',
      18: 'SG_923',
      19: 'PH_433',
      20: 'PH_868',
      21: 'PH_915',
    };
    return regions[region] ?? `UNKNOWN(${region})`;
  }

  private modemPresetToString(preset: number): string {
    const presets: Record<number, string> = {
      0: 'LONG_FAST',
      1: 'LONG_SLOW',
      2: 'VERY_LONG_SLOW',
      3: 'MEDIUM_SLOW',
      4: 'MEDIUM_FAST',
      5: 'SHORT_SLOW',
      6: 'SHORT_FAST',
      7: 'LONG_MODERATE',
      8: 'SHORT_TURBO',
    };
    return presets[preset] ?? `UNKNOWN(${preset})`;
  }

  private gpsFormatToString(format: number): string {
    const formats: Record<number, string> = {
      0: 'DEC',
      1: 'DMS',
      2: 'UTM',
      3: 'MGRS',
      4: 'OLC',
      5: 'OSGR',
    };
    return formats[format] ?? `UNKNOWN(${format})`;
  }

  private unitsToString(units: number): string {
    return units === 0 ? 'METRIC' : 'IMPERIAL';
  }

  private oledToString(oled: number): string {
    const types: Record<number, string> = {
      0: 'AUTO',
      1: 'SSD1306',
      2: 'SH1106',
      3: 'SH1107',
    };
    return types[oled] ?? `UNKNOWN(${oled})`;
  }

  private btModeToString(mode: number): string {
    const modes: Record<number, string> = {
      0: 'RANDOM_PIN',
      1: 'FIXED_PIN',
      2: 'NO_PIN',
    };
    return modes[mode] ?? `UNKNOWN(${mode})`;
  }

  private hwModelToString(model: number): string {
    const models: Record<number, string> = {
      0: 'UNSET',
      1: 'TLORA_V2',
      2: 'TLORA_V1',
      3: 'TLORA_V2_1_1P6',
      4: 'TBEAM',
      5: 'HELTEC_V2_0',
      6: 'TBEAM_V0P7',
      7: 'T_ECHO',
      8: 'TLORA_V1_1P3',
      9: 'RAK4631',
      10: 'HELTEC_V2_1',
      11: 'HELTEC_V1',
      12: 'LILYGO_TBEAM_S3_CORE',
      13: 'RAK11200',
      14: 'NANO_G1',
      15: 'TLORA_V2_1_1P8',
      16: 'TLORA_T3_S3',
      17: 'NANO_G1_EXPLORER',
      18: 'NANO_G2_ULTRA',
      19: 'LORA_TYPE',
      25: 'STATION_G1',
      26: 'RAK11310',
      32: 'HELTEC_WIRELESS_PAPER',
      33: 'HELTEC_WIRELESS_PAPER_V1_0',
      34: 'HELTEC_WIRELESS_TRACKER',
      35: 'HELTEC_WIRELESS_TRACKER_V1_0',
      36: 'HELTEC_VISION_MASTER_T190',
      37: 'HELTEC_VISION_MASTER_E213',
      38: 'HELTEC_VISION_MASTER_E290',
      39: 'HELTEC_MESH_NODE_T114',
      40: 'T_WATCH_S3',
      41: 'PICOMPUTER_S3',
      42: 'HELTEC_HT62',
      43: 'EBYTE_ESP32_S3',
      44: 'ESP32_S3_PICO',
      45: 'CHATTER_2',
      47: 'HELTEC_WIRELESS_PAPER_V1_1',
      48: 'HELTEC_WIRELESS_TRACKER_V1_1',
      49: 'UNPHONE',
      50: 'TD_LORAC',
      51: 'CDEBYTE_EORA_S3',
      52: 'TWC_MESH_V4',
      53: 'NRF52_PROMICRO_DIY',
      54: 'RADIOMASTER_900_BANDIT_NANO',
      55: 'HELTEC_CAPSULE_SENSOR_V3',
      56: 'HELTEC_VISION_MASTER_T',
      57: 'HELTEC_VISION_MASTER_E',
      58: 'HELTEC_MESH_NODE_114',
      255: 'PRIVATE_HW',
    };
    return models[model] ?? `HW_MODEL(${model})`;
  }

  private async handleMeshPacket(packet: unknown): Promise<void> {
    const meshPacket = packet as {
      from: number;
      to: number;
      id: number;
      channel?: number;
      rxTime?: number;
      payloadVariant?: { case: string; value: unknown };
    };

    const payloadVariant = meshPacket.payloadVariant;
    if (!payloadVariant || payloadVariant.case !== 'decoded') {
      return;
    }

    const decoded = payloadVariant.value as {
      portnum: number;
      payload: Uint8Array | Record<string, number>;
      requestId?: number;  // Present in ACK responses - references original packet ID
    };

    const { Portnums, Mesh, Telemetry } = await import('@meshtastic/protobufs');
    const { fromBinary } = await import('@bufbuild/protobuf');

    // Create packet metadata
    const metadata: Omit<PacketMetadata<unknown>, 'data'> = {
      id: meshPacket.id,
      rxTime: new Date(meshPacket.rxTime ? meshPacket.rxTime * 1000 : Date.now()),
      type: meshPacket.to === BROADCAST_ADDR ? 'broadcast' : 'direct',
      from: meshPacket.from,
      to: meshPacket.to,
      channel: meshPacket.channel ?? 0,
    };

    switch (decoded.portnum) {
      case Portnums.PortNum.TEXT_MESSAGE_APP: {
        // Ignore our own messages
        if (meshPacket.from === this._myNodeNum) return;

        // Accept messages for us or broadcast
        const isForMe = this._myNodeNum === null || meshPacket.to === this._myNodeNum;
        const isBroadcast = meshPacket.to === BROADCAST_ADDR;

        if (!isForMe && !isBroadcast) return;

        // Learn our nodeNum from incoming DM
        if (this._myNodeNum === null && !isBroadcast) {
          this._myNodeNum = meshPacket.to;
        }

        // Convert payload to Uint8Array
        let payloadBytes: Uint8Array;
        if (decoded.payload instanceof Uint8Array) {
          payloadBytes = decoded.payload;
        } else {
          payloadBytes = new Uint8Array(Object.values(decoded.payload));
        }

        const text = new TextDecoder().decode(payloadBytes);
        const message: Message = {
          id: `${meshPacket.from}-${meshPacket.id}`,
          from: meshPacket.from,
          to: meshPacket.to,
          text,
          timestamp: Date.now(),
          isOutgoing: false,
          channel: meshPacket.channel,
        };

        this.onMessagePacket.dispatch(message);
        break;
      }

      case Portnums.PortNum.POSITION_APP: {
        let payloadBytes: Uint8Array;
        if (decoded.payload instanceof Uint8Array) {
          payloadBytes = decoded.payload;
        } else {
          payloadBytes = new Uint8Array(Object.values(decoded.payload));
        }

        const position = fromBinary(Mesh.PositionSchema, payloadBytes);
        this.onPositionPacket.dispatch({ ...metadata, data: position } as PacketMetadata<Protobuf.Mesh.Position>);

        // If position is sent to us (DM) or broadcast (channel), create a location message
        // Skip our own position updates
        if (meshPacket.from !== this._myNodeNum) {
          const isForMe = this._myNodeNum === null || meshPacket.to === this._myNodeNum;
          const isBroadcast = meshPacket.to === BROADCAST_ADDR;

          if (isForMe || isBroadcast) {
            const positionData = position as { latitudeI?: number; longitudeI?: number; altitude?: number; time?: number };
            // Only create message if we have valid coordinates
            if (positionData.latitudeI && positionData.longitudeI) {
              const locationMessage: Message = {
                id: `${meshPacket.from}-${meshPacket.id}`,
                from: meshPacket.from,
                to: meshPacket.to,
                text: '📍 Геолокация',
                timestamp: Date.now(),
                isOutgoing: false,
                channel: meshPacket.channel,
                type: 'location',
                location: {
                  latitude: positionData.latitudeI / 1e7,
                  longitude: positionData.longitudeI / 1e7,
                  altitude: positionData.altitude,
                  time: positionData.time,
                },
              };
              this.onMessagePacket.dispatch(locationMessage);
            }
          }
        }
        break;
      }

      case Portnums.PortNum.TELEMETRY_APP: {
        let payloadBytes: Uint8Array;
        if (decoded.payload instanceof Uint8Array) {
          payloadBytes = decoded.payload;
        } else {
          payloadBytes = new Uint8Array(Object.values(decoded.payload));
        }

        const telemetry = fromBinary(Telemetry.TelemetrySchema, payloadBytes);
        this.onTelemetryPacket.dispatch({ ...metadata, data: telemetry } as PacketMetadata<Protobuf.Telemetry.Telemetry>);
        break;
      }

      case Portnums.PortNum.ROUTING_APP: {
        // Handle ACK/NACK packets
        let payloadBytes: Uint8Array;
        if (decoded.payload instanceof Uint8Array) {
          payloadBytes = decoded.payload;
        } else {
          payloadBytes = new Uint8Array(Object.values(decoded.payload));
        }

        try {
          const routing = fromBinary(Mesh.RoutingSchema, payloadBytes);
          const routingVariant = routing.variant;

          if (routingVariant?.case === 'errorReason') {
            // This is a response to our message
            // requestId is in the Data payload, not MeshPacket header
            const requestId = decoded.requestId;
            if (requestId) {
              // errorReason 0 = NONE = success
              const success = routingVariant.value === 0;
              this.onMessageAck.dispatch({ packetId: requestId, success });
            }
          }
        } catch {
          // Failed to parse routing packet
        }
        break;
      }
    }
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private startPollingInterval(): void {
    // Don't start if already polling
    if (this.pollInterval) return;

    this.pollInterval = setInterval(async () => {
      try {
        if (!this.device) return;

        // Skip disconnect check if expecting config restart
        if (this._expectingConfigRestart) {
          logger.debug('MeshtasticService', 'Polling: skipping disconnect check (expecting config restart)');
          return;
        }

        const isConnected = await this.device.isConnected();
        if (!isConnected) {
          logger.debug('MeshtasticService', 'Polling: device disconnected');
          this.stopPolling();
          // Start reconnection instead of just disconnecting
          this.startReconnect();
          return;
        }
        await this.readAllAvailable();
      } catch (pollErr) {
        // Skip reconnect if expecting config restart
        if (this._expectingConfigRestart) {
          logger.debug('MeshtasticService', 'Polling error during config restart, ignoring');
          return;
        }
        // Connection error - try to reconnect
        logger.debug('MeshtasticService', 'Polling error:', pollErr);
        this.stopPolling();
        this.startReconnect();
      }
    }, POLL_INTERVAL_MS);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const meshtasticService = new MeshtasticService();
