/**
 * ProtobufCodecService - handles Meshtastic protobuf encoding/decoding
 */

import { logger } from './LoggerService';
import type { Message, Channel, DeviceConfig, DeviceMetadata, MqttSettings, MqttClientProxyMessage, NodeInfo, PacketMetadata } from '../types';
import { ChannelRole } from '../types';
import { BROADCAST_ADDR } from '../constants/meshtastic';
import type * as Protobuf from '@meshtastic/protobufs';

// Enum to string converters
export function roleToString(role: number): string {
  const roles: Record<number, string> = {
    0: 'CLIENT', 1: 'CLIENT_MUTE', 2: 'ROUTER', 3: 'ROUTER_CLIENT',
    4: 'REPEATER', 5: 'TRACKER', 6: 'SENSOR', 7: 'TAK',
    8: 'CLIENT_HIDDEN', 9: 'LOST_AND_FOUND', 10: 'TAK_TRACKER',
  };
  return roles[role] ?? `UNKNOWN(${role})`;
}

export function rebroadcastModeToString(mode: number): string {
  const modes: Record<number, string> = {
    0: 'ALL', 1: 'ALL_SKIP_DECODING', 2: 'LOCAL_ONLY', 3: 'KNOWN_ONLY',
  };
  return modes[mode] ?? `UNKNOWN(${mode})`;
}

export function regionToString(region: number): string {
  const regions: Record<number, string> = {
    0: 'UNSET', 1: 'US', 2: 'EU_433', 3: 'EU_868', 4: 'CN',
    5: 'JP', 6: 'ANZ', 7: 'KR', 8: 'TW', 9: 'RU', 10: 'IN',
    11: 'NZ_865', 12: 'TH', 13: 'LORA_24', 14: 'UA_433', 15: 'UA_868',
    16: 'MY_433', 17: 'MY_919', 18: 'SG_923', 19: 'PH_433',
    20: 'PH_868', 21: 'PH_915',
  };
  return regions[region] ?? `UNKNOWN(${region})`;
}

export function modemPresetToString(preset: number): string {
  const presets: Record<number, string> = {
    0: 'LONG_FAST', 1: 'LONG_SLOW', 2: 'VERY_LONG_SLOW',
    3: 'MEDIUM_SLOW', 4: 'MEDIUM_FAST', 5: 'SHORT_SLOW',
    6: 'SHORT_FAST', 7: 'LONG_MODERATE', 8: 'SHORT_TURBO',
  };
  return presets[preset] ?? `UNKNOWN(${preset})`;
}

export function gpsFormatToString(format: number): string {
  const formats: Record<number, string> = {
    0: 'DEC', 1: 'DMS', 2: 'UTM', 3: 'MGRS', 4: 'OLC', 5: 'OSGR',
  };
  return formats[format] ?? `UNKNOWN(${format})`;
}

export function unitsToString(units: number): string {
  return units === 0 ? 'METRIC' : 'IMPERIAL';
}

export function oledToString(oled: number): string {
  const types: Record<number, string> = {
    0: 'AUTO', 1: 'SSD1306', 2: 'SH1106', 3: 'SH1107',
  };
  return types[oled] ?? `UNKNOWN(${oled})`;
}

export function btModeToString(mode: number): string {
  const modes: Record<number, string> = {
    0: 'RANDOM_PIN', 1: 'FIXED_PIN', 2: 'NO_PIN',
  };
  return modes[mode] ?? `UNKNOWN(${mode})`;
}

export function hwModelToString(model: number): string {
  const models: Record<number, string> = {
    0: 'UNSET', 1: 'TLORA_V2', 2: 'TLORA_V1', 3: 'TLORA_V2_1_1P6',
    4: 'TBEAM', 5: 'HELTEC_V2_0', 6: 'TBEAM_V0P7', 7: 'T_ECHO',
    8: 'TLORA_V1_1P3', 9: 'RAK4631', 10: 'HELTEC_V2_1', 11: 'HELTEC_V1',
    12: 'LILYGO_TBEAM_S3_CORE', 13: 'RAK11200', 14: 'NANO_G1',
    15: 'TLORA_V2_1_1P8', 16: 'TLORA_T3_S3', 17: 'NANO_G1_EXPLORER',
    18: 'NANO_G2_ULTRA', 19: 'LORA_TYPE', 25: 'STATION_G1',
    26: 'RAK11310', 32: 'HELTEC_WIRELESS_PAPER',
    33: 'HELTEC_WIRELESS_PAPER_V1_0', 34: 'HELTEC_WIRELESS_TRACKER',
    35: 'HELTEC_WIRELESS_TRACKER_V1_0', 36: 'HELTEC_VISION_MASTER_T190',
    37: 'HELTEC_VISION_MASTER_E213', 38: 'HELTEC_VISION_MASTER_E290',
    39: 'HELTEC_MESH_NODE_T114', 40: 'T_WATCH_S3', 41: 'PICOMPUTER_S3',
    42: 'HELTEC_HT62', 43: 'EBYTE_ESP32_S3', 44: 'ESP32_S3_PICO',
    45: 'CHATTER_2', 47: 'HELTEC_WIRELESS_PAPER_V1_1',
    48: 'HELTEC_WIRELESS_TRACKER_V1_1', 49: 'UNPHONE', 50: 'TD_LORAC',
    51: 'CDEBYTE_EORA_S3', 52: 'TWC_MESH_V4', 53: 'NRF52_PROMICRO_DIY',
    54: 'RADIOMASTER_900_BANDIT_NANO', 55: 'HELTEC_CAPSULE_SENSOR_V3',
    56: 'HELTEC_VISION_MASTER_T', 57: 'HELTEC_VISION_MASTER_E',
    58: 'HELTEC_MESH_NODE_114', 255: 'PRIVATE_HW',
  };
  return models[model] ?? `HW_MODEL(${model})`;
}

class ProtobufCodecService {
  /**
   * Encode binary data to base64 for BLE transmission
   */
  encodeToBase64(data: Uint8Array): string {
    return btoa(String.fromCharCode.apply(null, Array.from(data)));
  }

  /**
   * Decode base64 data from BLE to binary
   */
  decodeFromBase64(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Create a text message packet
   */
  async createTextMessagePacket(
    text: string,
    to: number,
    from: number,
    channel: number,
    wantAck: boolean
  ): Promise<{ payload: string; packetId: number }> {
    const { create, toBinary } = await import('@bufbuild/protobuf');
    const { Mesh, Portnums } = await import('@meshtastic/protobufs');

    const dataPayload = create(Mesh.DataSchema, {
      portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
      payload: new TextEncoder().encode(text),
    });

    const packetId = Math.floor(Math.random() * 0xFFFFFFFF);
    const meshPacket = create(Mesh.MeshPacketSchema, {
      to,
      from,
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
    return {
      payload: this.encodeToBase64(payload),
      packetId,
    };
  }

  /**
   * Create a position packet
   */
  async createPositionPacket(
    latitude: number,
    longitude: number,
    altitude: number | undefined,
    to: number,
    from: number,
    channel: number = 0,
    wantAck: boolean = false
  ): Promise<{ payload: string; packetId: number }> {
    const { create, toBinary } = await import('@bufbuild/protobuf');
    const { Mesh, Portnums } = await import('@meshtastic/protobufs');

    const position = create(Mesh.PositionSchema, {
      latitudeI: Math.round(latitude * 1e7),
      longitudeI: Math.round(longitude * 1e7),
      altitude: altitude ? Math.round(altitude) : 0,
      time: Math.floor(Date.now() / 1000),
    });

    const positionPayload = toBinary(Mesh.PositionSchema, position);

    const dataPayload = create(Mesh.DataSchema, {
      portnum: Portnums.PortNum.POSITION_APP,
      payload: positionPayload,
    });

    const packetId = Math.floor(Math.random() * 0xFFFFFFFF);
    const meshPacket = create(Mesh.MeshPacketSchema, {
      to,
      from,
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
    return {
      payload: this.encodeToBase64(payload),
      packetId,
    };
  }

  /**
   * Create config request packet
   */
  async createConfigRequest(): Promise<string> {
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
    return this.encodeToBase64(payload);
  }

  /**
   * Create MQTT proxy message packet
   */
  async createMqttProxyPacket(
    topic: string,
    data: Uint8Array,
    retained: boolean
  ): Promise<string> {
    const { create, toBinary } = await import('@bufbuild/protobuf');
    const { Mesh } = await import('@meshtastic/protobufs');

    const mqttProxyMessage = create(Mesh.MqttClientProxyMessageSchema, {
      topic,
      payloadVariant: {
        case: 'data',
        value: data,
      },
      retained,
    });

    const toRadio = create(Mesh.ToRadioSchema, {
      payloadVariant: {
        case: 'mqttClientProxyMessage',
        value: mqttProxyMessage,
      },
    });

    const payload = toBinary(Mesh.ToRadioSchema, toRadio);
    return this.encodeToBase64(payload);
  }

  /**
   * Create admin message packet
   */
  async createAdminPacket(
    adminPayload: Uint8Array,
    to: number,
    from: number
  ): Promise<string> {
    const { create, toBinary } = await import('@bufbuild/protobuf');
    const { Mesh, Portnums } = await import('@meshtastic/protobufs');

    const dataPayload = create(Mesh.DataSchema, {
      portnum: Portnums.PortNum.ADMIN_APP,
      payload: adminPayload,
      wantResponse: true,
    });

    const packetId = Math.floor(Math.random() * 0xFFFFFFFF);
    const meshPacket = create(Mesh.MeshPacketSchema, {
      to,
      from,
      id: packetId,
      wantAck: true,
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
    return this.encodeToBase64(payload);
  }

  /**
   * Create channel URL for sharing
   */
  async createChannelUrl(channel: Channel): Promise<string | null> {
    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { AppOnly, Channel: ChannelProto } = await import('@meshtastic/protobufs');

      const channelSettings = create(ChannelProto.ChannelSettingsSchema, {
        name: channel.name,
        psk: channel.psk || new Uint8Array(),
      });

      const channelSet = create(AppOnly.ChannelSetSchema, {
        settings: [channelSettings],
      });

      const payload = toBinary(AppOnly.ChannelSetSchema, channelSet);

      const base64 = btoa(String.fromCharCode.apply(null, Array.from(payload)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      return `https://meshtastic.org/e/#${base64}`;
    } catch (err) {
      logger.error('ProtobufCodecService', 'Failed to create channel URL:', err);
      return null;
    }
  }

  /**
   * Decode FromRadio packet
   */
  async decodeFromRadio(bytes: Uint8Array): Promise<unknown> {
    const { fromBinary } = await import('@bufbuild/protobuf');
    const { Mesh } = await import('@meshtastic/protobufs');
    return fromBinary(Mesh.FromRadioSchema, bytes);
  }

  /**
   * Parse config payload and update device config
   */
  parseConfigPayload(
    payload: { case: string; value: unknown },
    currentConfig: DeviceConfig
  ): DeviceConfig {
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
        return {
          ...currentConfig,
          role: device.role !== undefined ? roleToString(device.role) : undefined,
          serialEnabled: device.serialEnabled,
          buttonGpio: device.buttonGpio,
          buzzerGpio: device.buzzerGpio,
          rebroadcastMode: device.rebroadcastMode !== undefined ? rebroadcastModeToString(device.rebroadcastMode) : undefined,
          nodeInfoBroadcastSecs: device.nodeInfoBroadcastSecs,
          doubleTapAsButtonPress: device.doubleTapAsButtonPress,
          tzdef: device.tzdef,
        };
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
        return {
          ...currentConfig,
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
        return {
          ...currentConfig,
          isPowerSaving: power.isPowerSaving,
          onBatteryShutdownAfterSecs: power.onBatteryShutdownAfterSecs,
          adcMultiplierOverride: power.adcMultiplierOverride,
          waitBluetoothSecs: power.waitBluetoothSecs,
          sdsSecs: power.sdsSecs,
          lsSecs: power.lsSecs,
          minWakeSecs: power.minWakeSecs,
        };
      }

      case 'network': {
        const network = payload.value as {
          wifiEnabled?: boolean;
          wifiSsid?: string;
          ethEnabled?: boolean;
          ntpServer?: string;
        };
        return {
          ...currentConfig,
          wifiEnabled: network.wifiEnabled,
          wifiSsid: network.wifiSsid,
          ethEnabled: network.ethEnabled,
          ntpServer: network.ntpServer,
        };
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
        return {
          ...currentConfig,
          screenOnSecs: display.screenOnSecs,
          gpsFormat: display.gpsFormat !== undefined ? gpsFormatToString(display.gpsFormat) : undefined,
          autoScreenCarouselSecs: display.autoScreenCarouselSecs,
          compassNorthTop: display.compassNorthTop,
          flipScreen: display.flipScreen,
          units: display.units !== undefined ? unitsToString(display.units) : undefined,
          oled: display.oled !== undefined ? oledToString(display.oled) : undefined,
        };
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
        return {
          ...currentConfig,
          region: lora.region !== undefined ? regionToString(lora.region) : undefined,
          modemPreset: lora.modemPreset !== undefined ? modemPresetToString(lora.modemPreset) : undefined,
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
      }

      case 'bluetooth': {
        const bluetooth = payload.value as {
          enabled?: boolean;
          mode?: number;
          fixedPin?: number;
        };
        return {
          ...currentConfig,
          enabled: bluetooth.enabled,
          mode: bluetooth.mode !== undefined ? btModeToString(bluetooth.mode) : undefined,
          fixedPin: bluetooth.fixedPin,
        };
      }

      default:
        return currentConfig;
    }
  }

  /**
   * Parse device metadata
   */
  parseMetadata(metadata: {
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
  }): DeviceMetadata {
    return {
      firmwareVersion: metadata.firmwareVersion,
      deviceStateVersion: metadata.deviceStateVersion,
      canShutdown: metadata.canShutdown,
      hasWifi: metadata.hasWifi,
      hasBluetooth: metadata.hasBluetooth,
      hasEthernet: metadata.hasEthernet,
      role: metadata.role !== undefined ? roleToString(metadata.role) : undefined,
      positionFlags: metadata.positionFlags,
      hwModel: metadata.hwModel !== undefined ? hwModelToString(metadata.hwModel) : undefined,
      hasRemoteHardware: metadata.hasRemoteHardware,
    };
  }

  /**
   * Parse MQTT config from moduleConfig
   */
  parseMqttConfig(mqtt: {
    enabled?: boolean;
    address?: string;
    username?: string;
    password?: string;
    encryptionEnabled?: boolean;
    tlsEnabled?: boolean;
    root?: string;
    proxyToClientEnabled?: boolean;
  }): MqttSettings {
    return {
      enabled: mqtt.enabled ?? false,
      address: mqtt.address ?? '',
      username: mqtt.username ?? '',
      password: mqtt.password ?? '',
      encryptionEnabled: mqtt.encryptionEnabled ?? false,
      tlsEnabled: mqtt.tlsEnabled ?? false,
      root: mqtt.root ?? 'msh',
      proxyToClientEnabled: mqtt.proxyToClientEnabled ?? true,
    };
  }

  /**
   * Parse channel from FromRadio
   */
  parseChannel(channelData: {
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
  }): Channel {
    const role = channelData.role ?? 0;
    const psk = channelData.settings?.psk;
    const settings = channelData.settings;

    return {
      index: channelData.index,
      name: settings?.name || (channelData.index === 0 ? 'Primary' : `Channel ${channelData.index}`),
      role: role as ChannelRole,
      psk,
      hasEncryption: psk !== undefined && psk.length > 0,
      uplinkEnabled: settings?.uplinkEnabled,
      downlinkEnabled: settings?.downlinkEnabled,
      positionPrecision: settings?.moduleSettings?.positionPrecision,
    };
  }

  /**
   * Parse NodeInfo from FromRadio
   */
  parseNodeInfo(nodeInfo: {
    num: number;
    user?: { longName?: string; shortName?: string; hwModel?: unknown };
    lastHeard?: number;
    position?: Protobuf.Mesh.Position;
    snr?: number;
  }): NodeInfo {
    return {
      nodeNum: nodeInfo.num,
      longName: nodeInfo.user?.longName,
      shortName: nodeInfo.user?.shortName,
      hwModel: nodeInfo.user?.hwModel?.toString(),
      lastHeard: nodeInfo.lastHeard,
      position: nodeInfo.position,
      snr: nodeInfo.snr,
    };
  }

  /**
   * Parse MQTT proxy message from FromRadio
   */
  parseMqttProxyMessage(proxyMsg: {
    topic?: string;
    payloadVariant?: { case: 'data' | 'text'; value: Uint8Array | string };
    retained?: boolean;
  }): MqttClientProxyMessage {
    const message: MqttClientProxyMessage = {
      topic: proxyMsg.topic || '',
      retained: proxyMsg.retained ?? false,
    };

    if (proxyMsg.payloadVariant?.case === 'data') {
      message.data = proxyMsg.payloadVariant.value as Uint8Array;
    } else if (proxyMsg.payloadVariant?.case === 'text') {
      message.text = proxyMsg.payloadVariant.value as string;
    }

    return message;
  }
}

export const protobufCodecService = new ProtobufCodecService();
