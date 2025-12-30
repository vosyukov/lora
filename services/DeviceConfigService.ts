/**
 * DeviceConfigService - handles device configuration (owner, MQTT, etc.)
 */

import { logger } from './LoggerService';
import { protobufCodecService } from './ProtobufCodecService';
import type { MqttSettings, NodeInfo } from '../types';

export interface DeviceConfigContext {
  writeToDevice: (payload: string) => Promise<void>;
  getMyNodeNum: () => number | null;
  getMyNode: () => NodeInfo | undefined;
  getMqttConfig: () => MqttSettings | null;
  updateNode: (node: NodeInfo) => void;
  dispatchError: (error: Error) => void;
  stopPolling: () => void;
  startPolling: () => void;
  isDeviceConnected: () => Promise<boolean>;
  delay: (ms: number) => Promise<void>;
}

class DeviceConfigService {
  /**
   * Check if owner name matches current radio config
   */
  private ownerMatches(
    longName: string,
    shortName: string,
    myNode: NodeInfo | undefined
  ): boolean {
    if (!myNode) {
      logger.debug('DeviceConfigService', 'Owner check: myNode not found');
      return false;
    }

    const normalizedShortName = shortName.slice(0, 4);
    const longNameMatch = myNode.longName === longName;
    const shortNameMatch = myNode.shortName === normalizedShortName;
    const allMatch = longNameMatch && shortNameMatch;

    logger.debug('DeviceConfigService', 'Owner comparison:', {
      radioOwner: { longName: myNode.longName, shortName: myNode.shortName },
      newOwner: { longName, shortName: normalizedShortName },
      matches: { longName: longNameMatch, shortName: shortNameMatch },
      allMatch,
    });

    return allMatch;
  }

  /**
   * Set the owner (user) info on the device
   */
  async setOwner(
    longName: string,
    shortName: string,
    force: boolean,
    context: DeviceConfigContext
  ): Promise<boolean> {
    const myNodeNum = context.getMyNodeNum();
    if (!myNodeNum) {
      return false;
    }

    const myNode = context.getMyNode();

    // Check if name already matches current config
    if (!force && this.ownerMatches(longName, shortName, myNode)) {
      logger.debug('DeviceConfigService', 'Owner SKIPPED - already matches radio');
      return true;
    }
    logger.debug('DeviceConfigService', 'Owner WILL BE SENT to radio');

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Mesh, Admin } = await import('@meshtastic/protobufs');

      const user = create(Mesh.UserSchema, {
        longName,
        shortName: shortName.slice(0, 4),
      });

      const adminMessage = create(Admin.AdminMessageSchema, {
        payloadVariant: {
          case: 'setOwner',
          value: user,
        },
      });

      const adminPayload = toBinary(Admin.AdminMessageSchema, adminMessage);
      const payload = await protobufCodecService.createAdminPacket(
        adminPayload,
        myNodeNum,
        myNodeNum
      );

      await context.writeToDevice(payload);

      // Update local node info
      if (myNode) {
        const updatedNode: NodeInfo = {
          ...myNode,
          longName,
          shortName,
        };
        context.updateNode(updatedNode);
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to set owner');
      context.dispatchError(error);
      return false;
    }
  }

  /**
   * Check if MQTT settings match current radio config
   */
  private mqttConfigMatches(settings: MqttSettings, currentConfig: MqttSettings | null): boolean {
    if (!currentConfig) {
      logger.debug('DeviceConfigService', 'MQTT config check: no config from radio yet');
      return false;
    }

    const matches = {
      enabled: currentConfig.enabled === settings.enabled,
      address: currentConfig.address === settings.address,
      username: currentConfig.username === settings.username,
      password: currentConfig.password === settings.password,
      encryptionEnabled: currentConfig.encryptionEnabled === settings.encryptionEnabled,
      tlsEnabled: currentConfig.tlsEnabled === settings.tlsEnabled,
      proxyToClientEnabled: currentConfig.proxyToClientEnabled === settings.proxyToClientEnabled,
    };

    const allMatch = Object.values(matches).every(v => v);

    logger.debug('DeviceConfigService', 'MQTT config comparison:', {
      radioConfig: {
        enabled: currentConfig.enabled,
        address: currentConfig.address,
        proxyToClientEnabled: currentConfig.proxyToClientEnabled,
      },
      newConfig: {
        enabled: settings.enabled,
        address: settings.address,
        proxyToClientEnabled: settings.proxyToClientEnabled,
      },
      matches,
      allMatch,
    });

    return allMatch;
  }

  /**
   * Configure MQTT settings on the device
   */
  async setMqttConfig(
    settings: MqttSettings,
    force: boolean,
    context: DeviceConfigContext
  ): Promise<boolean> {
    logger.debug('DeviceConfigService', 'setMqttConfig called with:', {
      enabled: settings.enabled,
      address: settings.address,
      proxyToClientEnabled: settings.proxyToClientEnabled,
    });

    const myNodeNum = context.getMyNodeNum();
    if (!myNodeNum) {
      logger.debug('DeviceConfigService', 'setMqttConfig: no myNodeNum');
      return false;
    }

    // Check if settings already match current config
    if (!force && this.mqttConfigMatches(settings, context.getMqttConfig())) {
      logger.debug('DeviceConfigService', 'MQTT config SKIPPED - already matches radio');
      return true;
    }
    logger.debug('DeviceConfigService', 'MQTT config WILL BE SENT to radio');

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Admin, ModuleConfig } = await import('@meshtastic/protobufs');

      const mqttConfig = create(ModuleConfig.ModuleConfig_MQTTConfigSchema, {
        enabled: settings.enabled,
        address: settings.address,
        username: settings.username,
        password: settings.password,
        encryptionEnabled: settings.encryptionEnabled,
        tlsEnabled: settings.tlsEnabled,
        root: settings.root || 'msh',
        proxyToClientEnabled: settings.proxyToClientEnabled,
      });

      const moduleConfig = create(ModuleConfig.ModuleConfigSchema, {
        payloadVariant: {
          case: 'mqtt',
          value: mqttConfig,
        },
      });

      const adminMessage = create(Admin.AdminMessageSchema, {
        payloadVariant: {
          case: 'setModuleConfig',
          value: moduleConfig,
        },
      });

      const adminPayload = toBinary(Admin.AdminMessageSchema, adminMessage);
      const payload = await protobufCodecService.createAdminPacket(
        adminPayload,
        myNodeNum,
        myNodeNum
      );

      // Stop polling - device may restart after config change
      context.stopPolling();

      logger.debug('DeviceConfigService', 'setMqttConfig: writing to device...');
      await context.writeToDevice(payload);

      logger.debug('DeviceConfigService', 'setMqttConfig: waiting for device to apply config...');
      await context.delay(3000);

      // Check if still connected
      const isConnected = await context.isDeviceConnected();
      if (!isConnected) {
        logger.debug('DeviceConfigService', 'setMqttConfig: device disconnected, waiting...');
        await context.delay(2000);
      }

      // Restart polling if still connected
      if (await context.isDeviceConnected()) {
        context.startPolling();
      }

      logger.debug('DeviceConfigService', 'MQTT config sent successfully');
      return true;
    } catch (err) {
      logger.debug('DeviceConfigService', 'setMqttConfig error:', err);
      const error = err instanceof Error ? err : new Error('Failed to set MQTT config');
      context.dispatchError(error);
      return false;
    }
  }

  /**
   * Generate short name from long name (max 4 characters)
   */
  generateShortName(longName: string): string {
    const words = longName.trim().split(/\s+/);

    if (words.length >= 2) {
      return words
        .slice(0, 4)
        .map(w => w[0]?.toUpperCase() || '')
        .join('');
    } else {
      return longName.slice(0, 4).toUpperCase();
    }
  }
}

export const deviceConfigService = new DeviceConfigService();
