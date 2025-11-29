import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Device, BleManager } from 'react-native-ble-plx';

const MESHTASTIC_SERVICE_UUID = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';
const TORADIO_UUID = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
const FROMRADIO_UUID = '2c55e69e-4993-11ed-b878-0242ac120002';
const FROMNUM_UUID = 'ed9da18c-a800-4f66-a670-aa7547e34453';

interface DeviceDetailScreenProps {
  device: Device;
  bleManager: BleManager;
  onBack: () => void;
}

interface NodeInfo {
  nodeNum?: number;
  userName?: string;
  longName?: string;
  shortName?: string;
}

interface ConnectionState {
  connected: boolean;
  discovering: boolean;
  configuring: boolean;
}

export default function DeviceDetailScreen({
  device,
  bleManager,
  onBack,
}: DeviceDetailScreenProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    connected: false,
    discovering: false,
    configuring: false,
  });
  const [myNodeInfo, setMyNodeInfo] = useState<NodeInfo | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    connectToDevice();

    return () => {
      disconnectDevice();
    };
  }, []);

  const connectToDevice = async () => {
    try {
      setError(null);
      setConnectionState((prev) => ({ ...prev, discovering: true }));

      // Подключение к устройству
      const connectedDevice = await device.connect();
      console.log('Подключено к устройству:', connectedDevice.id);

      setConnectionState((prev) => ({ ...prev, connected: true }));

      // Установка MTU 512 байт
      await connectedDevice.requestMTU(512);
      console.log('MTU установлен: 512');

      // Обнаружение сервисов и характеристик
      await connectedDevice.discoverAllServicesAndCharacteristics();
      console.log('Сервисы и характеристики обнаружены');

      setConnectionState((prev) => ({ ...prev, discovering: false, configuring: true }));

      // Подписка на FromNum для уведомлений о новых сообщениях
      connectedDevice.monitorCharacteristicForService(
        MESHTASTIC_SERVICE_UUID,
        FROMNUM_UUID,
        (error, characteristic) => {
          if (error) {
            console.error('Ошибка мониторинга FromNum:', error);
            return;
          }

          if (characteristic?.value) {
            console.log('Новое сообщение доступно, FromNum:', characteristic.value);
            readFromRadio(connectedDevice);
          }
        }
      );

      // Запрос конфигурации
      await requestConfig(connectedDevice);

      // Начальное чтение данных
      await readInitialData(connectedDevice);

      setConnectionState((prev) => ({ ...prev, configuring: false }));
      addMessage('Успешно подключено и настроено');
    } catch (err) {
      console.error('Ошибка подключения:', err);
      setError(err instanceof Error ? err.message : 'Ошибка подключения');
      setConnectionState({
        connected: false,
        discovering: false,
        configuring: false,
      });
    }
  };

  const requestConfig = async (connectedDevice: Device) => {
    try {
      // Импорт @bufbuild/protobuf и @meshtastic/protobufs
      const { create, toBinary } = await import('@bufbuild/protobuf');
      const { Mesh } = await import('@meshtastic/protobufs');

      // Создание ToRadio сообщения с want_config_id
      // uint32 max value is 4,294,967,295, so we use a simple ID
      const configRequest = create(Mesh.ToRadioSchema, {
        payloadVariant: {
          case: 'wantConfigId',
          value: Math.floor(Date.now() / 1000) % 0xFFFFFFFF, // Convert to seconds and keep in uint32 range
        },
      });

      // Сериализация в binary
      const payload = toBinary(Mesh.ToRadioSchema, configRequest);

      // Конвертация в base64
      const base64Payload = btoa(
        String.fromCharCode.apply(null, Array.from(payload))
      );

      // Отправка на устройство
      await connectedDevice.writeCharacteristicWithResponseForService(
        MESHTASTIC_SERVICE_UUID,
        TORADIO_UUID,
        base64Payload
      );

      console.log('Запрос конфигурации отправлен');
      addMessage('Запрос конфигурации отправлен');
    } catch (err) {
      console.error('Ошибка запроса конфигурации:', err);
      throw err;
    }
  };

  const readInitialData = async (connectedDevice: Device) => {
    let emptyReads = 0;
    const maxEmptyReads = 3;

    while (emptyReads < maxEmptyReads) {
      try {
        const hasData = await readFromRadio(connectedDevice);
        if (!hasData) {
          emptyReads++;
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          emptyReads = 0;
        }
      } catch (err) {
        console.error('Ошибка чтения начальных данных:', err);
        break;
      }
    }

    console.log('Начальное чтение данных завершено');
  };

  const readFromRadio = async (connectedDevice: Device): Promise<boolean> => {
    try {
      const characteristic = await connectedDevice.readCharacteristicForService(
        MESHTASTIC_SERVICE_UUID,
        FROMRADIO_UUID
      );

      if (!characteristic.value) {
        return false;
      }

      // Декодирование base64
      const binaryString = atob(characteristic.value);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Парсинг protobuf
      const { fromBinary } = await import('@bufbuild/protobuf');
      const { Mesh } = await import('@meshtastic/protobufs');
      const fromRadio = fromBinary(Mesh.FromRadioSchema, bytes);

      handleFromRadio(fromRadio);

      return true;
    } catch (err) {
      console.error('Ошибка чтения FromRadio:', err);
      return false;
    }
  };

  const handleFromRadio = async (msg: any) => {
    console.log('FromRadio получено:', msg);

    if (msg.myInfo) {
      console.log('MyNodeInfo:', msg.myInfo);
      setMyNodeInfo({
        nodeNum: msg.myInfo.myNodeNum,
      });
      addMessage(`Локальный узел: ${msg.myInfo.myNodeNum}`);
    }

    if (msg.nodeInfo) {
      console.log('NodeInfo:', msg.nodeInfo);
      const nodeData: NodeInfo = {
        nodeNum: msg.nodeInfo.num,
        userName: msg.nodeInfo.user?.id,
        longName: msg.nodeInfo.user?.longName,
        shortName: msg.nodeInfo.user?.shortName,
      };
      setNodes((prev) => [...prev, nodeData]);
      addMessage(
        `Узел найден: ${nodeData.longName || nodeData.shortName || nodeData.nodeNum}`
      );
    }

    if (msg.config) {
      console.log('Config:', msg.config);
      addMessage('Конфигурация получена');
    }

    if (msg.channel) {
      console.log('Channel:', msg.channel);
      addMessage(`Канал ${msg.channel.index} получен`);
    }

    if (msg.packet) {
      console.log('MeshPacket:', msg.packet);
      await handleMeshPacket(msg.packet);
    }

    if (msg.configCompleteId) {
      console.log('Конфигурация завершена:', msg.configCompleteId);
      addMessage('Начальная конфигурация завершена');
    }
  };

  const handleMeshPacket = async (packet: any) => {
    if (!packet.decoded) {
      console.log('Пакет зашифрован или не содержит данных');
      return;
    }

    const { fromBinary } = await import('@bufbuild/protobuf');
    const { Portnums, Mesh, Telemetry } = await import('@meshtastic/protobufs');

    // Текстовое сообщение
    if (packet.decoded.portnum === Portnums.PortNum.TEXT_MESSAGE_APP) {
      const text = new TextDecoder().decode(packet.decoded.payload);
      console.log('Текстовое сообщение:', text);
      addMessage(`Сообщение от ${packet.from}: ${text}`);
    }

    // Позиция
    if (packet.decoded.portnum === Portnums.PortNum.POSITION_APP) {
      const position = fromBinary(Mesh.PositionSchema, packet.decoded.payload);
      const lat = (position.latitudeI || 0) / 1e7;
      const lon = (position.longitudeI || 0) / 1e7;
      console.log('Позиция:', { lat, lon, alt: position.altitude });
      addMessage(`Позиция от ${packet.from}: ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    }

    // Телеметрия
    if (packet.decoded.portnum === Portnums.PortNum.TELEMETRY_APP) {
      const telemetry = fromBinary(Telemetry.TelemetrySchema, packet.decoded.payload);
      if (telemetry.deviceMetrics) {
        console.log('Телеметрия:', telemetry.deviceMetrics);
        addMessage(
          `Батарея: ${telemetry.deviceMetrics.batteryLevel}%, Напряжение: ${telemetry.deviceMetrics.voltage}V`
        );
      }
    }
  };

  const disconnectDevice = async () => {
    try {
      const isConnected = await device.isConnected();
      if (isConnected) {
        await device.cancelConnection();
        console.log('Отключено от устройства');
      }
    } catch (err) {
      console.error('Ошибка отключения:', err);
    }
  };

  const handleDisconnect = async () => {
    await disconnectDevice();
    onBack();
  };

  const addMessage = (message: string) => {
    setMessages((prev) => [
      `[${new Date().toLocaleTimeString()}] ${message}`,
      ...prev,
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Заголовок */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleDisconnect} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{device.name || device.id}</Text>
      </View>

      {/* Статус подключения */}
      <View style={styles.statusContainer}>
        {connectionState.discovering && (
          <View style={styles.statusItem}>
            <ActivityIndicator size="small" color="#007AFF" />
            <Text style={styles.statusText}>Подключение...</Text>
          </View>
        )}
        {connectionState.configuring && (
          <View style={styles.statusItem}>
            <ActivityIndicator size="small" color="#007AFF" />
            <Text style={styles.statusText}>Настройка...</Text>
          </View>
        )}
        {connectionState.connected && !connectionState.configuring && (
          <View style={styles.statusItem}>
            <View style={styles.connectedIndicator} />
            <Text style={styles.statusText}>Подключено</Text>
          </View>
        )}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>

      {/* Информация об узле */}
      {myNodeInfo && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Локальный узел</Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>Номер узла: {myNodeInfo.nodeNum}</Text>
          </View>
        </View>
      )}

      {/* Список узлов сети */}
      {nodes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Узлы сети ({nodes.length})</Text>
          <ScrollView style={styles.nodesList}>
            {nodes.map((node, index) => (
              <View key={index} style={styles.nodeCard}>
                <Text style={styles.nodeName}>
                  {node.longName || node.shortName || `Узел ${node.nodeNum}`}
                </Text>
                {node.userName && (
                  <Text style={styles.nodeId}>{node.userName}</Text>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Лог сообщений */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Лог</Text>
        <ScrollView style={styles.messagesList}>
          {messages.map((msg, index) => (
            <Text key={index} style={styles.messageText}>
              {msg}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    padding: 5,
    marginRight: 10,
  },
  backButtonText: {
    color: '#007AFF',
    fontSize: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  statusContainer: {
    padding: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#666',
  },
  connectedIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
  },
  errorContainer: {
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 5,
    marginTop: 10,
  },
  errorText: {
    color: '#C62828',
    fontSize: 14,
  },
  section: {
    marginTop: 10,
    backgroundColor: '#fff',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    maxHeight: 200,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  infoCard: {
    backgroundColor: '#f9f9f9',
    padding: 10,
    borderRadius: 5,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
  },
  nodesList: {
    maxHeight: 150,
  },
  nodeCard: {
    backgroundColor: '#f9f9f9',
    padding: 10,
    borderRadius: 5,
    marginBottom: 5,
  },
  nodeName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  nodeId: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  messagesList: {
    maxHeight: 150,
  },
  messageText: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
    marginBottom: 3,
  },
});
