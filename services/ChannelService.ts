/**
 * ChannelService - handles Meshtastic channel management
 */

import { logger } from './LoggerService';
import { protobufCodecService } from './ProtobufCodecService';
import type { Channel } from '../types';
import { ChannelRole } from '../types';

export interface ChannelWriteContext {
  writeToDevice: (payload: string) => Promise<void>;
  getMyNodeNum: () => number | null;
  updateChannel: (channel: Channel) => void;
  dispatchError: (error: Error) => void;
}

class ChannelService {
  /**
   * Create or update a channel
   */
  async setChannel(
    index: number,
    name: string,
    psk: Uint8Array,
    role: ChannelRole,
    context: ChannelWriteContext
  ): Promise<boolean> {
    const myNodeNum = context.getMyNodeNum();
    if (!myNodeNum) {
      return false;
    }

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Admin, Channel: ChannelProto } = await import('@meshtastic/protobufs');

      const channelSettings = create(ChannelProto.ChannelSettingsSchema, {
        name,
        psk,
      });

      const channel = create(ChannelProto.ChannelSchema, {
        index,
        role: role as number,
        settings: channelSettings,
      });

      const adminMessage = create(Admin.AdminMessageSchema, {
        payloadVariant: {
          case: 'setChannel',
          value: channel,
        },
      });

      const adminPayload = toBinary(Admin.AdminMessageSchema, adminMessage);
      const payload = await protobufCodecService.createAdminPacket(
        adminPayload,
        myNodeNum,
        myNodeNum
      );

      await context.writeToDevice(payload);

      const newChannel: Channel = {
        index,
        name,
        role,
        psk,
        hasEncryption: psk.length > 0,
      };
      context.updateChannel(newChannel);

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to set channel');
      context.dispatchError(error);
      return false;
    }
  }

  /**
   * Add a channel from QR code data
   */
  async addChannelFromQR(
    name: string,
    psk: Uint8Array,
    uplinkEnabled: boolean,
    downlinkEnabled: boolean,
    channels: Map<number, Channel>,
    context: ChannelWriteContext
  ): Promise<{ success: boolean; channelIndex: number }> {
    logger.debug('ChannelService', 'addChannelFromQR:', name);

    const myNodeNum = context.getMyNodeNum();
    if (!myNodeNum) {
      logger.debug('ChannelService', 'addChannelFromQR: no myNodeNum');
      return { success: false, channelIndex: -1 };
    }

    try {
      // Find first available channel slot (1-7, slot 0 is primary)
      let targetIndex = -1;
      for (let i = 1; i <= 7; i++) {
        const existingChannel = channels.get(i);
        if (!existingChannel || existingChannel.role === ChannelRole.DISABLED) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex === -1) {
        logger.debug('ChannelService', 'No available channel slots');
        context.dispatchError(new Error('Все слоты каналов заняты'));
        return { success: false, channelIndex: -1 };
      }

      logger.debug('ChannelService', 'Using channel slot:', targetIndex);

      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Admin, Channel: ChannelProto } = await import('@meshtastic/protobufs');

      const channelSettings = create(ChannelProto.ChannelSettingsSchema, {
        name,
        psk,
        uplinkEnabled,
        downlinkEnabled,
      });

      const channel = create(ChannelProto.ChannelSchema, {
        index: targetIndex,
        role: ChannelRole.SECONDARY as number,
        settings: channelSettings,
      });

      const adminMessage = create(Admin.AdminMessageSchema, {
        payloadVariant: {
          case: 'setChannel',
          value: channel,
        },
      });

      const adminPayload = toBinary(Admin.AdminMessageSchema, adminMessage);
      const payload = await protobufCodecService.createAdminPacket(
        adminPayload,
        myNodeNum,
        myNodeNum
      );

      await context.writeToDevice(payload);

      const newChannel: Channel = {
        index: targetIndex,
        name,
        role: ChannelRole.SECONDARY,
        psk,
        hasEncryption: psk.length > 0,
      };
      context.updateChannel(newChannel);

      logger.debug('ChannelService', 'Channel added successfully at index:', targetIndex);
      return { success: true, channelIndex: targetIndex };
    } catch (err) {
      logger.debug('ChannelService', 'addChannelFromQR error:', err);
      const error = err instanceof Error ? err : new Error('Failed to add channel');
      context.dispatchError(error);
      return { success: false, channelIndex: -1 };
    }
  }

  /**
   * Delete a channel (set role to DISABLED)
   */
  async deleteChannel(
    index: number,
    context: ChannelWriteContext
  ): Promise<boolean> {
    if (index === 0) {
      context.dispatchError(new Error('Cannot delete primary channel'));
      return false;
    }

    return this.setChannel(index, '', new Uint8Array(), ChannelRole.DISABLED, context);
  }

  /**
   * Update channel settings (uplink, downlink, position)
   */
  async updateChannelSettings(
    channel: Channel,
    uplinkEnabled: boolean,
    downlinkEnabled: boolean,
    positionPrecision: number,
    context: ChannelWriteContext
  ): Promise<boolean> {
    const myNodeNum = context.getMyNodeNum();
    if (!myNodeNum) {
      return false;
    }

    logger.debug('ChannelService', 'updateChannelSettings:', {
      index: channel.index,
      uplinkEnabled,
      downlinkEnabled,
      positionPrecision,
    });

    try {
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Admin, Channel: ChannelProto } = await import('@meshtastic/protobufs');

      const channelSettings = create(ChannelProto.ChannelSettingsSchema, {
        name: channel.name,
        psk: channel.psk || new Uint8Array(),
        uplinkEnabled,
        downlinkEnabled,
        moduleSettings: {
          positionPrecision,
        },
      });

      const channelProto = create(ChannelProto.ChannelSchema, {
        index: channel.index,
        role: channel.role as number,
        settings: channelSettings,
      });

      const adminMessage = create(Admin.AdminMessageSchema, {
        payloadVariant: {
          case: 'setChannel',
          value: channelProto,
        },
      });

      const adminPayload = toBinary(Admin.AdminMessageSchema, adminMessage);
      const payload = await protobufCodecService.createAdminPacket(
        adminPayload,
        myNodeNum,
        myNodeNum
      );

      await context.writeToDevice(payload);

      // Update local state
      const updatedChannel: Channel = {
        ...channel,
        uplinkEnabled,
        downlinkEnabled,
        positionPrecision,
      };
      context.updateChannel(updatedChannel);

      logger.debug('ChannelService', 'Channel settings updated successfully');
      return true;
    } catch (err) {
      logger.debug('ChannelService', 'updateChannelSettings error:', err);
      return false;
    }
  }

  /**
   * Check and fix channel settings for all active channels
   */
  async ensureChannelSettings(
    channels: Channel[],
    context: ChannelWriteContext,
    delay: (ms: number) => Promise<void>
  ): Promise<void> {
    const activeChannels = channels.filter(ch => ch.role !== ChannelRole.DISABLED);
    logger.debug('ChannelService', 'Checking channel settings for', activeChannels.length, 'channels');

    for (const channel of activeChannels) {
      const needsUpdate =
        channel.uplinkEnabled !== true ||
        channel.downlinkEnabled !== true ||
        (channel.positionPrecision ?? 0) < 32;

      if (needsUpdate) {
        logger.debug('ChannelService', 'Channel', channel.index, 'needs settings update');

        const success = await this.updateChannelSettings(
          channel,
          true,
          true,
          32,
          context
        );

        if (success) {
          logger.debug('ChannelService', 'Channel', channel.index, 'settings updated');
        } else {
          logger.debug('ChannelService', 'Channel', channel.index, 'settings update failed');
        }

        await delay(500);
      } else {
        logger.debug('ChannelService', 'Channel', channel.index, 'settings OK');
      }
    }
  }

  /**
   * Get channel URL for sharing
   */
  async getChannelUrl(channel: Channel): Promise<string | null> {
    return protobufCodecService.createChannelUrl(channel);
  }

  /**
   * Generate a random PSK of specified length
   */
  generatePsk(length: 16 | 32 = 32): Uint8Array {
    const psk = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      psk[i] = Math.floor(Math.random() * 256);
    }
    return psk;
  }
}

export const channelService = new ChannelService();
