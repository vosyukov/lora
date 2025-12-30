/**
 * useMqttProxy - хук для управления MQTT прокси
 *
 * Телефон выступает MQTT прокси для Meshtastic устройства:
 * - Подключается к MQTT брокеру когда proxyToClientEnabled=true и устройство подключено
 * - Пересылает MqttClientProxyMessage от устройства в MQTT
 * - Пересылает сообщения из MQTT на устройство
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { meshtasticService } from '../services/MeshtasticService';
import { mqttProxyService, MqttConnectionState, MqttMessage } from '../services/MqttProxyService';
import { logger } from '../services/LoggerService';
import type { MqttSettings, MqttProxyState, Channel } from '../types';
import { DeviceStatusEnum, ChannelRole } from '../types';

export interface UseMqttProxyResult {
  // Connection state
  isConnected: boolean;
  connectionState: MqttConnectionState;
  error: string | null;

  // Stats
  subscribedTopics: string[];
  messagesProxied: number;
}

export function useMqttProxy(
  deviceStatus: DeviceStatusEnum,
  mqttSettings: MqttSettings | null,
  channels: Channel[],
  region?: string
): UseMqttProxyResult {
  const [connectionState, setConnectionState] = useState<MqttConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [subscribedTopics, setSubscribedTopics] = useState<string[]>([]);
  const [messagesProxied, setMessagesProxied] = useState(0);

  const isConnectedRef = useRef(false);
  const settingsRef = useRef<MqttSettings | null>(null);

  // Определяем нужно ли подключаться
  const shouldConnect =
    deviceStatus === DeviceStatusEnum.DeviceConfigured &&
    mqttSettings?.enabled === true &&
    mqttSettings?.proxyToClientEnabled === true &&
    mqttSettings?.address?.length > 0;

  // Логируем условия подключения
  useEffect(() => {
    logger.debug('useMqttProxy', 'Connection conditions:', {
      deviceConfigured: deviceStatus === DeviceStatusEnum.DeviceConfigured,
      mqttEnabled: mqttSettings?.enabled,
      proxyEnabled: mqttSettings?.proxyToClientEnabled,
      hasAddress: !!mqttSettings?.address,
      shouldConnect,
    });
  }, [deviceStatus, mqttSettings, shouldConnect]);

  // Подключение/отключение от MQTT
  useEffect(() => {
    const connectMqtt = async () => {
      if (!mqttSettings) return;

      logger.debug('useMqttProxy', 'Connecting to MQTT broker:', mqttSettings.address);
      settingsRef.current = mqttSettings;

      try {
        await mqttProxyService.connect(mqttSettings);
      } catch (err) {
        logger.error('useMqttProxy', 'Connection error:', err);
      }
    };

    const disconnectMqtt = async () => {
      logger.debug('useMqttProxy', 'Disconnecting from MQTT broker...');
      await mqttProxyService.disconnect();
      isConnectedRef.current = false;
    };

    if (shouldConnect && !isConnectedRef.current) {
      connectMqtt();
    } else if (!shouldConnect && isConnectedRef.current) {
      disconnectMqtt();
    }

    return () => {
      // Отключаемся при размонтировании
      if (isConnectedRef.current) {
        mqttProxyService.disconnect();
        isConnectedRef.current = false;
      }
    };
  }, [shouldConnect, mqttSettings]);

  // Подписываемся на изменения состояния MQTT
  useEffect(() => {
    const unsubConnectionState = mqttProxyService.onConnectionStateChange.subscribe((state) => {
      logger.debug('useMqttProxy', 'Connection state changed:', state);
      setConnectionState(state);
      isConnectedRef.current = state === 'connected';

      if (state === 'connected') {
        setError(null);
        // Подписываемся на топики после подключения
        updateSubscriptions();
      }
    });

    const unsubError = mqttProxyService.onError.subscribe((err) => {
      logger.error('useMqttProxy', 'MQTT error:', err.message);
      setError(err.message);
    });

    return () => {
      unsubConnectionState();
      unsubError();
    };
  }, []);

  // Обновляем подписки при изменении каналов
  const updateSubscriptions = useCallback(() => {
    if (!settingsRef.current || !isConnectedRef.current) return;

    const root = settingsRef.current.root || 'msh';
    const reg = region || 'EU_868';

    // Подписываемся на каналы с downlinkEnabled
    const topics = channels
      .filter((ch) => ch.role !== ChannelRole.DISABLED && ch.downlinkEnabled)
      .map((ch) => {
        const channelName = ch.name || `!${ch.index}`;
        // Формат: msh/{region}/2/e/{channelName}/# для encrypted
        return `${root}/${reg}/2/e/${channelName}/#`;
      });

    if (topics.length > 0) {
      logger.debug('useMqttProxy', 'Subscribing to topics:', topics);
      mqttProxyService.subscribe(topics);
      setSubscribedTopics(topics);
    }
  }, [channels, region]);

  // Обновляем подписки при изменении каналов
  useEffect(() => {
    if (connectionState === 'connected') {
      updateSubscriptions();
    }
  }, [channels, region, connectionState, updateSubscriptions]);

  // Пересылка сообщений: Device → MQTT Broker
  useEffect(() => {
    const unsubscribe = meshtasticService.onMqttClientProxyMessage.subscribe(async (message) => {
      if (!isConnectedRef.current) {
        logger.warn('useMqttProxy', 'Cannot forward to MQTT - not connected');
        return;
      }

      logger.debug('useMqttProxy', 'Forwarding to MQTT:', message.topic);
      const success = await mqttProxyService.publish(message);

      if (success) {
        setMessagesProxied((prev) => prev + 1);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Пересылка сообщений: MQTT Broker → Device
  useEffect(() => {
    const unsubscribe = mqttProxyService.onMessageReceived.subscribe(async (message: MqttMessage) => {
      logger.debug('useMqttProxy', 'Received from MQTT:', message.topic);

      // Конвертируем data из строки в Uint8Array
      // react-native-mqtt возвращает data как строку (возможно base64)
      let data: Uint8Array;
      try {
        // Пробуем декодировать как base64
        const binaryString = atob(message.data);
        data = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          data[i] = binaryString.charCodeAt(i);
        }
      } catch {
        // Если не base64, используем как UTF-8
        data = new TextEncoder().encode(message.data);
      }

      const success = await meshtasticService.sendMqttClientProxyMessage(
        message.topic,
        data,
        message.retain
      );

      if (success) {
        setMessagesProxied((prev) => prev + 1);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return {
    isConnected: connectionState === 'connected',
    connectionState,
    error,
    subscribedTopics,
    messagesProxied,
  };
}
