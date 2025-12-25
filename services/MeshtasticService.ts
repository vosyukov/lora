import { Device, Subscription } from 'react-native-ble-plx';
import { SimpleEventDispatcher } from 'ste-simple-events';
import type * as Protobuf from '@meshtastic/protobufs';

import { DeviceStatusEnum } from '../types';
import type { NodeInfo, Message, PacketMetadata } from '../types';
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
} from '../constants/meshtastic';

/**
 * MeshtasticService - manages BLE connection and communication with Meshtastic devices.
 * Uses typed events from @meshtastic/core patterns with ste-simple-events.
 */
class MeshtasticService {
  private device: Device | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private monitorSubscription: Subscription | null = null;
  private _myNodeNum: number | null = null;
  private _deviceStatus: DeviceStatusEnum = DeviceStatusEnum.DeviceDisconnected;
  private nodes: Map<number, NodeInfo> = new Map();

  // Typed event dispatchers (similar to @meshtastic/core EventSystem)
  readonly onDeviceStatus = new SimpleEventDispatcher<DeviceStatusEnum>();
  readonly onMyNodeInfo = new SimpleEventDispatcher<Protobuf.Mesh.MyNodeInfo>();
  readonly onNodeInfoPacket = new SimpleEventDispatcher<NodeInfo>();
  readonly onMessagePacket = new SimpleEventDispatcher<Message>();
  readonly onPositionPacket = new SimpleEventDispatcher<PacketMetadata<Protobuf.Mesh.Position>>();
  readonly onTelemetryPacket = new SimpleEventDispatcher<PacketMetadata<Protobuf.Telemetry.Telemetry>>();
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

  isConnected(): boolean {
    return this._deviceStatus >= DeviceStatusEnum.DeviceConnected;
  }

  private updateDeviceStatus(status: DeviceStatusEnum): void {
    if (this._deviceStatus !== status) {
      this._deviceStatus = status;
      this.onDeviceStatus.dispatch(status);
    }
  }

  async connect(device: Device): Promise<void> {
    try {
      this.updateDeviceStatus(DeviceStatusEnum.DeviceConnecting);

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

      // Start polling as fallback
      this.pollInterval = setInterval(async () => {
        try {
          if (!this.device) return;
          const isConnected = await this.device.isConnected();
          if (!isConnected) {
            this.stopPolling();
            this.updateDeviceStatus(DeviceStatusEnum.DeviceDisconnected);
            return;
          }
          await this.readAllAvailable();
        } catch {
          // Ignore polling errors
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Connection failed');
      this.onError.dispatch(error);
      this.updateDeviceStatus(DeviceStatusEnum.DeviceDisconnected);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.stopPolling();

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

    this._myNodeNum = null;
    this.nodes.clear();
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
        from: this._myNodeNum,
        to,
        text,
        timestamp: Date.now(),
        isOutgoing: true,
        channel,
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
