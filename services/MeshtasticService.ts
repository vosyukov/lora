import { Device, Subscription } from 'react-native-ble-plx';
import { SimpleEventDispatcher } from 'ste-simple-events';
import type * as Protobuf from '@meshtastic/protobufs';

import { DeviceStatusEnum, ChannelRole } from '../types';
import type { NodeInfo, Message, PacketMetadata, Channel } from '../types';
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

  // Typed event dispatchers (similar to @meshtastic/core EventSystem)
  readonly onDeviceStatus = new SimpleEventDispatcher<DeviceStatusEnum>();
  readonly onMyNodeInfo = new SimpleEventDispatcher<Protobuf.Mesh.MyNodeInfo>();
  readonly onNodeInfoPacket = new SimpleEventDispatcher<NodeInfo>();
  readonly onMessagePacket = new SimpleEventDispatcher<Message>();
  readonly onMessageAck = new SimpleEventDispatcher<{ packetId: number; success: boolean }>();
  readonly onPositionPacket = new SimpleEventDispatcher<PacketMetadata<Protobuf.Mesh.Position>>();
  readonly onTelemetryPacket = new SimpleEventDispatcher<PacketMetadata<Protobuf.Telemetry.Telemetry>>();
  readonly onChannelPacket = new SimpleEventDispatcher<Channel>();
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
      this.updateDeviceStatus(DeviceStatusEnum.DeviceConnecting);
      this.deviceId = device.id;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      const connectedDevice = await device.connect();
      this.device = connectedDevice;

      this.updateDeviceStatus(DeviceStatusEnum.DeviceConnected);

      await connectedDevice.requestMTU(MTU_SIZE);
      await connectedDevice.discoverAllServicesAndCharacteristics();

      this.updateDeviceStatus(DeviceStatusEnum.DeviceConfiguring);

      // Subscribe to FromNum notifications
      this.monitorSubscription = connectedDevice.monitorCharacteristicForService(
        MESHTASTIC_SERVICE_UUID,
        FROMNUM_UUID,
        async (error) => {
          if (error) return;
          await this.readAllAvailable();
        }
      );

      // Request initial configuration
      await this.requestConfig();
      await this.readInitialData();

      this.updateDeviceStatus(DeviceStatusEnum.DeviceConfigured);

      // Start polling as fallback and connection monitoring
      this.pollInterval = setInterval(async () => {
        try {
          if (!this.device) return;
          const isConnected = await this.device.isConnected();
          if (!isConnected) {
            this.stopPolling();
            // Start reconnection instead of just disconnecting
            this.startReconnect();
            return;
          }
          await this.readAllAvailable();
        } catch {
          // Connection error - try to reconnect
          this.stopPolling();
          this.startReconnect();
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Connection failed');
      this.onError.dispatch(error);

      // If this was a reconnect attempt, schedule another one
      if (this.isReconnecting) {
        this.scheduleReconnect();
      } else {
        this.updateDeviceStatus(DeviceStatusEnum.DeviceDisconnected);
      }
      throw error;
    }
  }

  private startReconnect(): void {
    if (this.isReconnecting || !this.deviceId || !this.bleManager) {
      this.updateDeviceStatus(DeviceStatusEnum.DeviceDisconnected);
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts = 0;
    this.updateDeviceStatus(DeviceStatusEnum.DeviceReconnecting);
    this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    if (!this.deviceId || !this.bleManager) {
      this.stopReconnecting();
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.stopReconnecting();
      return;
    }

    this.reconnectAttempts++;

    try {
      // Clean up old connection
      if (this.monitorSubscription) {
        this.monitorSubscription.remove();
        this.monitorSubscription = null;
      }

      // Try to get the device and connect
      const devices = await this.bleManager.devices([this.deviceId]);
      if (devices.length > 0) {
        const device = devices[0];

        // Check if already connected
        const isConnected = await device.isConnected();
        if (isConnected) {
          this.device = device;
          await this.setupAfterReconnect();
          return;
        }

        // Try to connect
        const connectedDevice = await device.connect();
        this.device = connectedDevice;
        await this.setupAfterReconnect();
        return;
      }

      // Device not found, schedule next attempt
      this.scheduleReconnect();
    } catch {
      // Connection failed, schedule next attempt
      this.scheduleReconnect();
    }
  }

  private async setupAfterReconnect(): Promise<void> {
    if (!this.device) return;

    try {
      this.updateDeviceStatus(DeviceStatusEnum.DeviceConnected);

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
      this.pollInterval = setInterval(async () => {
        try {
          if (!this.device) return;
          const isConnected = await this.device.isConnected();
          if (!isConnected) {
            this.stopPolling();
            this.startReconnect();
            return;
          }
          await this.readAllAvailable();
        } catch {
          this.stopPolling();
          this.startReconnect();
        }
      }, POLL_INTERVAL_MS);
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
    this.stopPolling();
    this.stopReconnecting();

    if (this.monitorSubscription) {
      this.monitorSubscription.remove();
      this.monitorSubscription = null;
    }

    if (this.device) {
      try {
        const isConnected = await this.device.isConnected();
        if (isConnected) {
          await this.device.cancelConnection();
        }
      } catch {
        // Ignore disconnect errors
      }
      this.device = null;
    }

    this.deviceId = null;
    this._myNodeNum = null;
    this.nodes.clear();
    this.channels.clear();
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

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Mesh, Admin, Portnums, Channel: ChannelProto } = await import('@meshtastic/protobufs');

      // Create channel settings
      const channelSettings = create(ChannelProto.ChannelSettingsSchema, {
        name,
        psk,
      });

      // Create channel with role (ChannelSchema is in Channel namespace, not Mesh)
      const channel = create(ChannelProto.ChannelSchema, {
        index,
        role: role as number,
        settings: channelSettings,
      });

      // Create admin message
      const adminMessage = create(Admin.AdminMessageSchema, {
        payloadVariant: {
          case: 'setChannel',
          value: channel,
        },
      });

      // Wrap in data payload
      const dataPayload = create(Mesh.DataSchema, {
        portnum: Portnums.PortNum.ADMIN_APP,
        payload: toBinary(Admin.AdminMessageSchema, adminMessage),
        wantResponse: true,
      });

      // Create mesh packet to self (admin messages go to self)
      const packetId = Math.floor(Math.random() * 0xFFFFFFFF);
      const meshPacket = create(Mesh.MeshPacketSchema, {
        to: this._myNodeNum,
        from: this._myNodeNum,
        id: packetId,
        wantAck: true,
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

      // Update local channel state
      const newChannel: Channel = {
        index,
        name,
        role,
        psk,
        hasEncryption: psk.length > 0,
      };
      this.channels.set(index, newChannel);
      this.onChannelPacket.dispatch(newChannel);

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to set channel');
      this.onError.dispatch(error);
      return false;
    }
  }

  /**
   * Delete a channel (set role to DISABLED)
   */
  async deleteChannel(index: number): Promise<boolean> {
    // Channel 0 (PRIMARY) cannot be deleted
    if (index === 0) {
      this.onError.dispatch(new Error('Cannot delete primary channel'));
      return false;
    }

    return this.setChannel(index, '', new Uint8Array(), ChannelRole.DISABLED);
  }

  /**
   * Set the owner (user) info on the device
   * @param longName - Full name (displayed in UI)
   * @param shortName - Short name (max 4 characters, used in compact views)
   */
  async setOwner(longName: string, shortName: string): Promise<boolean> {
    if (!this.device || !this._myNodeNum) {
      return false;
    }

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Mesh, Admin, Portnums } = await import('@meshtastic/protobufs');

      // Create User object with names
      const user = create(Mesh.UserSchema, {
        longName,
        shortName: shortName.slice(0, 4), // Max 4 characters
      });

      // Create admin message with setOwner
      const adminMessage = create(Admin.AdminMessageSchema, {
        payloadVariant: {
          case: 'setOwner',
          value: user,
        },
      });

      // Wrap in data payload
      const dataPayload = create(Mesh.DataSchema, {
        portnum: Portnums.PortNum.ADMIN_APP,
        payload: toBinary(Admin.AdminMessageSchema, adminMessage),
        wantResponse: true,
      });

      // Create mesh packet to self (admin messages go to self)
      const packetId = Math.floor(Math.random() * 0xFFFFFFFF);
      const meshPacket = create(Mesh.MeshPacketSchema, {
        to: this._myNodeNum,
        from: this._myNodeNum,
        id: packetId,
        wantAck: true,
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

      // Update local node info
      const existingNode = this.nodes.get(this._myNodeNum);
      if (existingNode) {
        const updatedNode: NodeInfo = {
          ...existingNode,
          longName,
          shortName,
        };
        this.nodes.set(this._myNodeNum, updatedNode);
        this.onNodeInfoPacket.dispatch(updatedNode);
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to set owner');
      this.onError.dispatch(error);
      return false;
    }
  }

  /**
   * Generate short name from long name (max 4 characters)
   * Takes first letters of words or first 4 characters
   */
  generateShortName(longName: string): string {
    const words = longName.trim().split(/\s+/);

    if (words.length >= 2) {
      // Take first letter of each word (up to 4)
      return words
        .slice(0, 4)
        .map(w => w[0]?.toUpperCase() || '')
        .join('');
    } else {
      // Single word - take first 4 characters
      return longName.slice(0, 4).toUpperCase();
    }
  }

  /**
   * Generate a random PSK of specified length
   * @param length - 16 for AES-128, 32 for AES-256
   */
  generatePsk(length: 16 | 32 = 32): Uint8Array {
    const psk = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      psk[i] = Math.floor(Math.random() * 256);
    }
    return psk;
  }

  /**
   * Generate a shareable Meshtastic URL for a channel
   * @param channelIndex - Channel index to share
   * @returns Meshtastic URL or null if channel doesn't exist
   */
  async getChannelUrl(channelIndex: number): Promise<string | null> {
    const channel = this.channels.get(channelIndex);
    if (!channel) return null;

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { AppOnly, Channel: ChannelProto } = await import('@meshtastic/protobufs');

      // Create channel settings
      const channelSettings = create(ChannelProto.ChannelSettingsSchema, {
        name: channel.name,
        psk: channel.psk || new Uint8Array(),
      });

      // Create ChannelSet with this channel's settings
      const channelSet = create(AppOnly.ChannelSetSchema, {
        settings: [channelSettings],
      });

      // Encode to binary
      const payload = toBinary(AppOnly.ChannelSetSchema, channelSet);

      // Base64url encode (Meshtastic uses URL-safe base64)
      const base64 = btoa(String.fromCharCode.apply(null, Array.from(payload)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      return `https://meshtastic.org/e/#${base64}`;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to generate channel URL');
      this.onError.dispatch(error);
      return null;
    }
  }

  private async requestConfig(): Promise<void> {
    if (!this.device) return;

    const { create, toBinary } = await import('@bufbuild/protobuf');
    const { Mesh } = await import('@meshtastic/protobufs');

    const configId = Math.floor(Date.now() / 1000) % 0xFFFFFFFF;
    const configRequest = create(Mesh.ToRadioSchema, {
      payloadVariant: {
        case: 'wantConfigId',
        value: configId,
      },
    });

    const payload = toBinary(Mesh.ToRadioSchema, configRequest);
    const base64Payload = btoa(String.fromCharCode.apply(null, Array.from(payload)));

    await this.device.writeCharacteristicWithResponseForService(
      MESHTASTIC_SERVICE_UUID,
      TORADIO_UUID,
      base64Payload
    );
  }

  private async readInitialData(): Promise<void> {
    let emptyReads = 0;

    while (emptyReads < MAX_EMPTY_READS) {
      try {
        const hasData = await this.readFromRadio();
        if (!hasData) {
          emptyReads++;
          await this.delay(INITIAL_READ_DELAY_MS);
        } else {
          emptyReads = 0;
        }
      } catch {
        break;
      }
    }
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
        const myInfo = variant.value as Protobuf.Mesh.MyNodeInfo;
        this._myNodeNum = myInfo.myNodeNum;
        this.onMyNodeInfo.dispatch(myInfo);
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
          };
          role?: number;
        };

        const role = channelData.role ?? 0;
        const psk = channelData.settings?.psk;

        const channel: Channel = {
          index: channelData.index,
          name: channelData.settings?.name || (channelData.index === 0 ? 'Primary' : `Channel ${channelData.index}`),
          role: role as ChannelRole,
          psk,
          hasEncryption: psk !== undefined && psk.length > 0,
        };

        this.channels.set(channel.index, channel);
        this.onChannelPacket.dispatch(channel);
        break;
      }
    }
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const meshtasticService = new MeshtasticService();
