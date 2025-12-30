/**
 * MqttProxyService - MQTT клиент для проксирования сообщений Meshtastic
 *
 * Телефон выступает MQTT прокси для устройства:
 * - Получает MqttClientProxyMessage от устройства через BLE
 * - Публикует их в MQTT брокер
 * - Принимает сообщения из MQTT и отправляет на устройство
 */

import { SimpleEventDispatcher } from 'ste-simple-events';
import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import type { MqttSettings, MqttClientProxyMessage } from '../types';
import { logger } from './LoggerService';

export type MqttConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface MqttMessage {
  topic: string;
  data: string;
  qos: number;
  retain: boolean;
}

class MqttProxyService {
  private client: MqttClient | null = null;
  private _connectionState: MqttConnectionState = 'disconnected';
  private _error: string | null = null;
  private _subscribedTopics: Set<string> = new Set();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private settings: MqttSettings | null = null;

  // Events
  readonly onConnectionStateChange = new SimpleEventDispatcher<MqttConnectionState>();
  readonly onMessageReceived = new SimpleEventDispatcher<MqttMessage>();
  readonly onError = new SimpleEventDispatcher<Error>();

  get connectionState(): MqttConnectionState {
    return this._connectionState;
  }

  get error(): string | null {
    return this._error;
  }

  get isConnected(): boolean {
    return this._connectionState === 'connected';
  }

  get subscribedTopics(): string[] {
    return Array.from(this._subscribedTopics);
  }

  private setConnectionState(state: MqttConnectionState, error?: string): void {
    this._connectionState = state;
    this._error = error || null;
    this.onConnectionStateChange.dispatch(state);
    if (error) {
      this.onError.dispatch(new Error(error));
    }
  }

  /**
   * Подключиться к MQTT брокеру
   */
  async connect(settings: MqttSettings): Promise<void> {
    if (this._connectionState === 'connected' || this._connectionState === 'connecting') {
      logger.debug('MqttProxy', 'Already connected or connecting');
      return;
    }

    this.settings = settings;
    this.setConnectionState('connecting');

    try {
      await this.createAndConnect(settings);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      logger.error('MqttProxy', 'Connection failed:', errorMsg);
      this.setConnectionState('error', errorMsg);
    }
  }

  private async createAndConnect(settings: MqttSettings): Promise<void> {
    // mqtt.js использует WebSocket для React Native
    // HiveMQ Cloud WebSocket порты: 8884 (wss), 8083 (ws)
    const protocol = settings.tlsEnabled ? 'wss' : 'ws';
    const port = settings.tlsEnabled ? 8884 : 8083;
    const url = `${protocol}://${settings.address}:${port}/mqtt`;

    logger.debug('MqttProxy', 'Connecting to:', url);

    const options: IClientOptions = {
      clientId: `meshtastic_proxy_${Date.now()}`,
      keepalive: 60,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
    };

    // Добавляем auth если есть
    if (settings.username) {
      options.username = settings.username;
      options.password = settings.password || '';
    }

    // Создаем клиент
    this.client = mqtt.connect(url, options);

    // Обработчики событий
    this.client.on('connect', () => {
      logger.debug('MqttProxy', 'Connected');
      this.setConnectionState('connected');

      // Переподписываемся на топики после подключения
      this._subscribedTopics.forEach((topic) => {
        this.client?.subscribe(topic, { qos: 0 }, (err) => {
          if (err) {
            logger.error('MqttProxy', 'Subscribe error:', err);
          }
        });
      });
    });

    this.client.on('close', () => {
      logger.debug('MqttProxy', 'Connection closed');
      if (this._connectionState === 'connected') {
        this.setConnectionState('disconnected');
      }
    });

    this.client.on('error', (err) => {
      logger.error('MqttProxy', 'Error:', err.message);
      this.setConnectionState('error', err.message);
    });

    this.client.on('offline', () => {
      logger.debug('MqttProxy', 'Offline');
      this.setConnectionState('disconnected');
    });

    this.client.on('message', (topic, payload) => {
      logger.debug('MqttProxy', 'Message received:', topic, 'size:', payload.length);

      // Конвертируем в base64 строку (payload это Uint8Array в RN)
      const bytes = new Uint8Array(payload);
      const data = btoa(String.fromCharCode.apply(null, Array.from(bytes)));

      this.onMessageReceived.dispatch({
        topic,
        data,
        qos: 0,
        retain: false,
      });
    });
  }

  /**
   * Отключиться от MQTT брокера
   */
  async disconnect(): Promise<void> {
    logger.debug('MqttProxy', 'Disconnecting...');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.client) {
      try {
        this.client.end(true);
      } catch (err) {
        logger.error('MqttProxy', 'Disconnect error:', err);
      }
      this.client = null;
    }

    this._subscribedTopics.clear();
    this.settings = null;
    this.setConnectionState('disconnected');
  }

  /**
   * Подписаться на топики
   */
  subscribe(topics: string[]): void {
    topics.forEach((topic) => {
      if (!this._subscribedTopics.has(topic)) {
        this._subscribedTopics.add(topic);
        if (this.client && this._connectionState === 'connected') {
          logger.debug('MqttProxy', 'Subscribing to:', topic);
          this.client.subscribe(topic, { qos: 0 }, (err) => {
            if (err) {
              logger.error('MqttProxy', 'Subscribe error:', err);
            }
          });
        }
      }
    });
  }

  /**
   * Отписаться от топиков
   */
  unsubscribe(topics: string[]): void {
    topics.forEach((topic) => {
      this._subscribedTopics.delete(topic);
      if (this.client && this._connectionState === 'connected') {
        this.client.unsubscribe(topic);
      }
    });
  }

  /**
   * Опубликовать сообщение (от устройства в MQTT)
   */
  async publish(message: MqttClientProxyMessage): Promise<boolean> {
    if (!this.client || this._connectionState !== 'connected') {
      logger.warn('MqttProxy', 'Cannot publish - not connected');
      return false;
    }

    try {
      // Конвертируем data в бинарную строку (React Native не имеет Buffer)
      let payloadStr: string;
      if (message.data) {
        const bytes = message.data instanceof Uint8Array ? message.data : new Uint8Array(message.data);
        payloadStr = String.fromCharCode.apply(null, Array.from(bytes));
      } else if (message.text) {
        payloadStr = message.text;
      } else {
        payloadStr = '';
      }

      logger.debug('MqttProxy', 'Publishing to:', message.topic, 'size:', payloadStr.length);

      return new Promise((resolve) => {
        this.client!.publish(
          message.topic,
          payloadStr,
          { qos: 0, retain: message.retained },
          (err) => {
            if (err) {
              logger.error('MqttProxy', 'Publish error:', err);
              resolve(false);
            } else {
              logger.debug('MqttProxy', 'Published successfully');
              resolve(true);
            }
          }
        );
      });
    } catch (err) {
      logger.error('MqttProxy', 'Publish error:', err);
      return false;
    }
  }

  /**
   * Опубликовать raw данные
   */
  async publishRaw(topic: string, data: Uint8Array, retained: boolean = false): Promise<boolean> {
    return this.publish({ topic, data, retained });
  }
}

// Singleton instance
export const mqttProxyService = new MqttProxyService();
