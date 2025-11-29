# Meshtastic Bluetooth API Documentation

Документация по взаимодействию с устройствами Meshtastic через Bluetooth Low Energy (BLE).

## Оглавление

- [Обзор](#обзор)
- [Bluetooth Сервис и Характеристики](#bluetooth-сервис-и-характеристики)
- [Протокол Коммуникации](#протокол-коммуникации)
- [Protobuf Структуры](#protobuf-структуры)
- [Типы Портов (PortNum)](#типы-портов-portnum)
- [Последовательность Подключения](#последовательность-подключения)
- [Примеры Использования](#примеры-использования)

## Обзор

Meshtastic использует Protocol Buffers (protobuf) для обмена данными между устройствами и приложениями. Протокол практически идентичен для BLE, Serial/USB и TCP транспортов.

**Основные ресурсы:**
- [Официальная документация Client API](https://meshtastic.org/docs/development/device/client-api/)
- [Репозиторий Protobuf определений](https://github.com/meshtastic/protobufs)
- [Buf Schema Registry](https://buf.build/meshtastic/protobufs)

## Bluetooth Сервис и Характеристики

### Основной BLE Сервис

**Service UUID:** `6ba1b218-15a8-461f-9fa8-5dcae273eafd`

Этот сервис предоставляет API для взаимодействия с mesh-сетью.

### Характеристики

| Название | UUID | Свойства | Назначение |
|----------|------|----------|------------|
| **ToRadio** | `f75c76d2-129e-4dad-a1dd-7866124401e7` | Write | Отправка команд/пакетов на устройство |
| **FromRadio** | `2c55e69e-4993-11ed-b878-0242ac120002` | Read | Чтение пакетов от устройства (до MAXPACKET байт) |
| **FromNum** | `ed9da18c-a800-4f66-a670-aa7547e34453` | Read, Notify | Счетчик доступных сообщений |
| **LogRadio** | `5a3d6e49-06e6-4423-9944-e9de8cdf9547` | Notify | Логи устройства в формате LogRecord protobuf |
| **LogRadio (legacy)** | `6c6fd238-78fa-436b-aacf-15c5be1ef2e2` | Notify | Устаревший UUID для логов |

## Протокол Коммуникации

### Инициализация Соединения

1. **Установка MTU:** Установить MTU размером 512 байт для оптимальной производительности
2. **Запрос конфигурации:** Отправить `ToRadio.want_config_id` для запроса полной NodeDB
3. **Чтение данных:** Многократно читать из FromRadio до получения пустого ответа
4. **Подписка на уведомления:** Подписаться на BLE notifications на FromNum для получения обновлений

### Формат Пакетов (Serial/TCP)

Для не-BLE транспортов пакеты имеют 4-байтовый заголовок:

```
Byte 0: 0x94 (START1)
Byte 1: 0xc3 (START2)
Bytes 2-3: Длина protobuf (MSB/LSB)
```

⚠️ Пакеты больше 512 байт указывают на повреждение данных.

### Последовательность Начальной Загрузки

После отправки `startConfig`, устройство отправляет пакеты в следующем порядке:

1. **RadioConfig** - настройки канала/радио
2. **User** - имя пользователя узла
3. **MyNodeInfo** - информация о локальном устройстве
4. **Серия NodeInfo** - база данных узлов mesh-сети
5. **EndConfig** - сигнал завершения
6. **MeshPackets** - кэшированные сообщения

## Protobuf Структуры

### ToRadio Message

Пакеты/команды, отправляемые на радио устройство.

```protobuf
message ToRadio {
  oneof payload_variant {
    MeshPacket packet = 1;              // Отправка mesh-пакета
    uint32 want_config_id = 3;          // Запрос полной NodeDB
    bool disconnect = 4;                // Сигнал отключения
    XModem xmodemPacket = 5;            // Чанк передачи файла
    MqttClientProxyMessage mqttClientProxyMessage = 6;
    Heartbeat heartbeat = 7;            // Поддержание соединения (serial)
  }
}
```

**Ключевые поля:**
- `packet` - отправка сообщений в mesh-сеть
- `want_config_id` - при отправке устройство ответит MyNodeInfo, owner, radio config и серией FromRadio.node_infos
- `disconnect` - сигнал клиенту об отключении
- `heartbeat` - используется для поддержания serial-соединений

### FromRadio Message

Пакеты от радио устройства к телефону.

```protobuf
message FromRadio {
  uint32 id = 1;

  oneof payload_variant {
    MeshPacket packet = 2;              // Mesh-пакет
    MyNodeInfo my_info = 3;             // Информация о локальном узле
    NodeInfo node_info = 4;             // Информация об узле сети
    Config config = 5;                  // Конфигурация устройства
    LogRecord log_record = 6;           // Лог-запись
    uint32 config_complete_id = 7;      // Завершение конфигурации
    bool rebooted = 8;                  // Флаг перезагрузки
    ModuleConfig moduleConfig = 9;      // Конфигурация модуля
    Channel channel = 10;               // Настройки канала
    QueueStatus queueStatus = 11;       // Статус очереди
    XModem xmodemPacket = 12;           // Чанк передачи файла
    DeviceMetadata metadata = 13;       // Метаданные устройства
    MqttClientProxyMessage mqttClientProxyMessage = 14;
    FileInfo fileInfo = 15;             // Информация о файле
    ClientNotification clientNotification = 16;
    DeviceUIConfig deviceuiConfig = 17; // Конфигурация UI
  }
}
```

### MeshPacket Structure

Конверт пакета, отправляемого/получаемого через mesh-сеть.

```protobuf
message MeshPacket {
  uint32 from = 1;           // Отправитель (node number)
  uint32 to = 2;             // Получатель (node number)
  uint32 channel = 3;        // Индекс канала (0-7)
  bytes encrypted = 4;       // Зашифрованный Data protobuf (если encrypted)
  Data decoded = 5;          // Расшифрованный Data protobuf
  uint32 id = 6;             // Уникальный ID пакета
  uint32 rx_time = 7;        // Время получения (Unix timestamp)
  float rx_snr = 8;          // SNR приема
  int32 hop_limit = 9;       // Лимит хопов
  bool want_ack = 10;        // Запрос подтверждения
  Priority priority = 11;    // Приоритет пакета
  int32 rx_rssi = 12;        // RSSI приема
  uint32 delayed = 13;       // Задержка отправки (секунды)
  bool via_mqtt = 14;        // Получено через MQTT
  uint32 hop_start = 15;     // Начальное значение hop_limit
  bool public_key = 16;      // Публичный ключ для PKC
}
```

### Data Protobuf

Фактический payload, отправляемый внутри radio-пакета.

```protobuf
message Data {
  PortNum portnum = 1;       // Тип приложения/модуля
  bytes payload = 2;         // Данные (формат зависит от portnum)
  bool want_response = 3;    // Запрос ответа
  uint32 dest = 4;           // Назначение (node number)
  uint32 source = 5;         // Источник (node number)
  uint32 request_id = 6;     // ID запроса для связи запрос-ответ
  uint32 reply_id = 7;       // ID исходного запроса (для ответов)
  bytes emoji = 8;           // Эмоджи реакция
}
```

### NodeInfo Structure

Информация об узле в mesh-сети.

```protobuf
message NodeInfo {
  uint32 num = 1;                    // Node number
  User user = 2;                     // Пользовательская информация
  Position position = 3;             // Позиция устройства
  float snr = 4;                     // SNR последнего сообщения
  uint32 last_heard = 5;             // Время последнего контакта
  DeviceMetrics device_metrics = 6;  // Метрики устройства
  uint32 channel = 7;                // Индекс канала
  bool via_mqtt = 8;                 // Получено через MQTT
  uint32 hops_away = 9;              // Количество хопов
  bool is_favorite = 10;             // Избранный узел
  bool is_ignored = 11;              // Игнорируемый узел
  bool is_key_manually_verified = 12; // Ключ проверен вручную
}
```

### MyNodeInfo Structure

Уникальная локальная информация об этом узле.

```protobuf
message MyNodeInfo {
  uint32 my_node_num = 1;           // Номер узла (lowbyte of macaddr)
  uint32 reboot_count = 2;          // Счетчик перезагрузок
  uint32 min_app_version = 3;       // Минимальная версия приложения
  uint32 max_channels = 4;          // Максимум каналов
}
```

### User Structure

Информация о пользователе узла.

```protobuf
message User {
  string id = 1;              // Уникальный ID (обычно !xxxxxxxx)
  string long_name = 2;       // Полное имя
  string short_name = 3;      // Короткое имя (макс 4 символа)
  bytes macaddr = 4;          // MAC адрес устройства
  HardwareModel hw_model = 5; // Модель оборудования
  Role role = 6;              // Роль устройства
}
```

### Position Structure

GPS позиция устройства.

```protobuf
message Position {
  int32 latitude_i = 1;        // Широта * 1e-7
  int32 longitude_i = 2;       // Долгота * 1e-7
  int32 altitude = 3;          // Высота (метры)
  uint32 time = 4;             // Unix timestamp
  LocFlags location_flags = 5; // Флаги точности
  PositionPrecision precision = 6; // Точность позиции
}
```

### Channel Structure

Настройки канала для mesh-сети.

```protobuf
message Channel {
  uint32 index = 1;           // Индекс канала (0-7)
  ChannelSettings settings = 2;
  Role role = 3;              // Роль канала
}

message ChannelSettings {
  bytes psk = 1;              // Pre-Shared Key (0, 16 или 32 байта)
  string name = 2;            // Имя канала
  uint32 id = 3;              // Уникальный ID канала
  bool uplink_enabled = 4;    // MQTT uplink
  bool downlink_enabled = 5;  // MQTT downlink
  ModuleSettings module_settings = 6;
}
```

**PSK (Pre-Shared Key):**
- **0 байт** - без шифрования
- **16 байт** - AES128
- **32 байта** - AES256
- Дефолтное значение: `AQ==` (Base64 для 0x01) - публично известно!

### AdminMessage Structure

Административные команды для управления устройством.

```protobuf
message AdminMessage {
  oneof payload_variant {
    // Геттеры (чтение)
    bool get_owner_request = 1;
    ConfigType get_config_request = 2;
    ModuleConfigType get_module_config_request = 3;
    uint32 get_channel_request = 4;
    bool get_device_metadata_request = 5;
    bool get_canned_message_module_messages_request = 6;

    // Сеттеры (запись)
    User set_owner = 7;
    Config set_config = 8;
    ModuleConfig set_module_config = 9;
    Channel set_channel = 10;

    // Системные команды
    bool begin_edit_settings = 11;
    bool commit_edit_settings = 12;
    uint32 factory_reset_device = 13;
    uint32 reboot_ota_seconds = 14;
    bool exit_simulator = 15;
    uint32 reboot_seconds = 16;
    uint32 shutdown_seconds = 17;
    bool factory_reset_config = 18;
    bool nodedb_reset = 19;
    uint32 set_ignored_node = 20;
    uint32 remove_ignored_node = 21;
  }
}
```

**ConfigType Enum:**
- `DEVICE_CONFIG` - конфигурация устройства
- `POSITION_CONFIG` - настройки GPS
- `POWER_CONFIG` - управление питанием
- `NETWORK_CONFIG` - сетевые настройки
- `DISPLAY_CONFIG` - настройки дисплея
- `LORA_CONFIG` - LoRa параметры
- `BLUETOOTH_CONFIG` - Bluetooth настройки
- `SECURITY_CONFIG` - настройки безопасности

### Telemetry Structure

Телеметрические данные устройства.

```protobuf
message Telemetry {
  uint32 time = 1;
  oneof variant {
    DeviceMetrics device_metrics = 2;
    EnvironmentMetrics environment_metrics = 3;
    AirQualityMetrics air_quality_metrics = 4;
    PowerMetrics power_metrics = 5;
  }
}

message DeviceMetrics {
  uint32 battery_level = 1;     // 0-100%, >100 = питание от сети
  float voltage = 2;            // Напряжение батареи
  float channel_utilization = 3; // % использования канала
  float air_util_tx = 4;        // % эфирного времени передачи (час)
  uint32 uptime_seconds = 5;    // Время работы с последней загрузки
}
```

## Типы Портов (PortNum)

PortNum определяет тип приложения/модуля для обработки payload.

### Диапазоны

- **0-63:** Основное использование Meshtastic (не использовать для сторонних приложений)
- **64-127:** Зарегистрированные сторонние приложения
- **256-511:** Приватные приложения (не требуют регистрации)

### Основные PortNum

| PortNum | Значение | Описание |
|---------|----------|----------|
| `UNKNOWN_APP` | 0 | Сообщение извне mesh-сети (legacy OPAQUE) |
| `TEXT_MESSAGE_APP` | 1 | Простое UTF-8 текстовое сообщение |
| `REMOTE_HARDWARE_APP` | 2 | Управление GPIO |
| `POSITION_APP` | 3 | Встроенное приложение позиционирования |
| `NODEINFO_APP` | 4 | Встроенное приложение информации о пользователе |
| `ROUTING_APP` | 5 | Пакеты управления mesh-протоколом |
| `ADMIN_APP` | 6 | Административные пакеты управления |
| `TEXT_MESSAGE_COMPRESSED_APP` | 7 | Сжатый текст (Unishox2) |
| `WAYPOINT_APP` | 8 | Точки маршрута |
| `AUDIO_APP` | 9 | Инкапсулированные codec2 пакеты |
| `DETECTION_SENSOR_APP` | 10 | Сообщения от сенсоров обнаружения |
| `ALERT_APP` | 11 | Критические оповещения |
| `KEY_VERIFICATION_APP` | 12 | Верификация ключей |
| `REPLY_APP` | 32 | Сервис 'ping' |
| `IP_TUNNEL_APP` | 33 | Python IP туннель |
| `PAXCOUNTER_APP` | 34 | Счетчик людей |
| `SERIAL_APP` | 64 | Hardware serial интерфейс |
| `STORE_FORWARD_APP` | 65 | Хранение и пересылка сообщений |
| `RANGE_TEST_APP` | 66 | Тестирование дальности |
| `TELEMETRY_APP` | 67 | Телеметрические данные |
| `ZPS_APP` | 68 | Оценка позиции без GPS |
| `SIMULATOR_APP` | 69 | Симуляция для Linux приложений |
| `TRACEROUTE_APP` | 70 | Traceroute функциональность |
| `NEIGHBORINFO_APP` | 71 | Информация о соседних узлах |
| `ATAK_PLUGIN` | 72 | Официальный ATAK плагин |
| `MAP_REPORT_APP` | 73 | Незашифрованная информация для карты |
| `POWERSTRESS_APP` | 74 | Тестирование энергопотребления |
| `RETICULUM_TUNNEL_APP` | 76 | Reticulum Network Stack туннель |
| `CAYENNE_APP` | 77 | Cayenne Low Power Payload |
| `PRIVATE_APP` | 256 | Приватное использование |
| `ATAK_FORWARDER` | 257 | ATAK Forwarder модуль |
| `MAX` | 511 | Максимальное значение portnum |

## Последовательность Подключения

### 1. Сканирование и Подключение

```typescript
// Поиск устройства Meshtastic
const SERVICE_UUID = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';

// При сканировании искать устройства с этим сервисом
bleManager.startDeviceScan(
  [SERVICE_UUID],
  null,
  (error, device) => {
    if (device?.name?.includes('Meshtastic')) {
      // Найдено Meshtastic устройство
    }
  }
);
```

### 2. Установка MTU

```typescript
// После подключения установить MTU 512 байт
await device.requestMTU(512);
```

### 3. Получение Характеристик

```typescript
const TORADIO_UUID = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
const FROMRADIO_UUID = '2c55e69e-4993-11ed-b878-0242ac120002';
const FROMNUM_UUID = 'ed9da18c-a800-4f66-a670-aa7547e34453';
const LOGRADIO_UUID = '5a3d6e49-06e6-4423-9944-e9de8cdf9547';

// Обнаружение сервисов и характеристик
await device.discoverAllServicesAndCharacteristics();
```

### 4. Запрос Конфигурации

```typescript
import { ToRadio } from '@meshtastic/protobufs';

// Создать ToRadio сообщение с want_config_id
const configRequest = ToRadio.create({
  wantConfigId: Date.now()  // Можно использовать timestamp
});

// Сериализовать в binary
const payload = ToRadio.encode(configRequest).finish();

// Отправить на устройство
await device.writeCharacteristicWithResponseForService(
  SERVICE_UUID,
  TORADIO_UUID,
  base64Encode(payload)
);
```

### 5. Чтение FromRadio

```typescript
import { FromRadio } from '@meshtastic/protobufs';

// Подписка на уведомления FromNum
device.monitorCharacteristicForService(
  SERVICE_UUID,
  FROMNUM_UUID,
  (error, characteristic) => {
    if (characteristic?.value) {
      // Есть новые сообщения - читать FromRadio
      readFromRadio();
    }
  }
);

async function readFromRadio() {
  const characteristic = await device.readCharacteristicForService(
    SERVICE_UUID,
    FROMRADIO_UUID
  );

  if (characteristic.value) {
    const data = base64Decode(characteristic.value);
    const fromRadio = FromRadio.decode(new Uint8Array(data));

    // Обработать сообщение
    handleFromRadio(fromRadio);
  }
}
```

### 6. Обработка FromRadio Messages

```typescript
function handleFromRadio(msg: FromRadio) {
  if (msg.myInfo) {
    // Информация о локальном узле
    console.log('My Node:', msg.myInfo);
  } else if (msg.nodeInfo) {
    // Информация об узле сети
    console.log('Node:', msg.nodeInfo);
  } else if (msg.config) {
    // Конфигурация
    console.log('Config:', msg.config);
  } else if (msg.channel) {
    // Канал
    console.log('Channel:', msg.channel);
  } else if (msg.packet) {
    // Mesh пакет
    handleMeshPacket(msg.packet);
  } else if (msg.configCompleteId) {
    // Завершение начальной конфигурации
    console.log('Config complete');
  }
}
```

## Примеры Использования

### Отправка Текстового Сообщения

```typescript
import { ToRadio, MeshPacket, Data, PortNum } from '@meshtastic/protobufs';

// Создать Data payload
const data = Data.create({
  portnum: PortNum.TEXT_MESSAGE_APP,
  payload: new TextEncoder().encode('Hello Mesh!'),
  wantResponse: false
});

// Создать MeshPacket
const meshPacket = MeshPacket.create({
  decoded: data,
  to: 0xFFFFFFFF,  // Broadcast
  wantAck: false,
  channel: 0
});

// Обернуть в ToRadio
const toRadio = ToRadio.create({
  packet: meshPacket
});

// Отправить
const payload = ToRadio.encode(toRadio).finish();
await device.writeCharacteristicWithResponseForService(
  SERVICE_UUID,
  TORADIO_UUID,
  base64Encode(payload)
);
```

### Запрос Конфигурации Устройства

```typescript
import { AdminMessage, ConfigType } from '@meshtastic/protobufs';

// Создать AdminMessage для запроса LORA_CONFIG
const adminMsg = AdminMessage.create({
  getConfigRequest: ConfigType.LORA_CONFIG
});

// Создать Data с ADMIN_APP portnum
const data = Data.create({
  portnum: PortNum.ADMIN_APP,
  payload: AdminMessage.encode(adminMsg).finish(),
  wantResponse: true
});

// Создать и отправить MeshPacket
const meshPacket = MeshPacket.create({
  decoded: data,
  to: myNodeNum,  // Отправить себе
  wantAck: false
});

const toRadio = ToRadio.create({
  packet: meshPacket
});

await sendToRadio(toRadio);
```

### Получение Позиции Узла

```typescript
function handleMeshPacket(packet: MeshPacket) {
  if (packet.decoded?.portnum === PortNum.POSITION_APP) {
    const position = Position.decode(packet.decoded.payload);

    const lat = position.latitudeI / 1e7;
    const lon = position.longitudeI / 1e7;
    const alt = position.altitude;

    console.log(`Position: ${lat}, ${lon}, ${alt}m`);
  }
}
```

### Изменение Имени Пользователя

```typescript
import { User } from '@meshtastic/protobufs';

// Создать User объект
const user = User.create({
  longName: 'My New Name',
  shortName: 'MNN'
});

// Создать AdminMessage
const adminMsg = AdminMessage.create({
  setOwner: user
});

// Отправить как обычно через ADMIN_APP
const data = Data.create({
  portnum: PortNum.ADMIN_APP,
  payload: AdminMessage.encode(adminMsg).finish()
});

// ... создать MeshPacket и отправить
```

### Настройка Канала

```typescript
import { Channel, ChannelSettings } from '@meshtastic/protobufs';

// Генерация случайного AES256 ключа
const psk = new Uint8Array(32);
crypto.getRandomValues(psk);

const settings = ChannelSettings.create({
  psk: psk,
  name: 'MyPrivateChannel',
  uplinkEnabled: false,
  downlinkEnabled: false
});

const channel = Channel.create({
  index: 0,  // PRIMARY канал
  settings: settings,
  role: Channel.Role.PRIMARY
});

const adminMsg = AdminMessage.create({
  setChannel: channel
});

// Отправить через ADMIN_APP
```

### Мониторинг Телеметрии

```typescript
function handleMeshPacket(packet: MeshPacket) {
  if (packet.decoded?.portnum === PortNum.TELEMETRY_APP) {
    const telemetry = Telemetry.decode(packet.decoded.payload);

    if (telemetry.deviceMetrics) {
      const metrics = telemetry.deviceMetrics;
      console.log('Battery:', metrics.batteryLevel + '%');
      console.log('Voltage:', metrics.voltage + 'V');
      console.log('Channel Utilization:', metrics.channelUtilization + '%');
      console.log('Uptime:', metrics.uptimeSeconds + 's');
    }
  }
}
```

## Важные Замечания

### Безопасность

1. **PSK по умолчанию публично известен!** Обязательно меняйте PSK для приватных коммуникаций
2. Используйте AES256 (32 байта) для максимальной безопасности
3. PRIMARY канал виден всем - используйте SECONDARY каналы для приватной связи

### Производительность

1. **MTU 512 байт** обязателен для оптимальной производительности
2. Пакеты >512 байт указывают на ошибку - нужна ресинхронизация
3. Используйте `FromNum` для эффективной проверки наличия новых сообщений

### Надежность

1. Всегда подписывайтесь на `FromNum` для уведомлений о новых сообщениях
2. Читайте `FromRadio` в цикле до получения пустого ответа
3. Используйте `wantAck` только когда действительно нужно подтверждение
4. Обрабатывайте `configCompleteId` для определения завершения начальной синхронизации

### Ограничения

1. Максимум 8 каналов (0-7)
2. Короткое имя пользователя - максимум 4 символа
3. PortNum для сторонних приложений: 64-127 (требуется регистрация) или 256-511 (приватные)

## Ресурсы

- [Meshtastic Documentation](https://meshtastic.org/docs/)
- [Client API Documentation](https://meshtastic.org/docs/development/device/client-api/)
- [Protobufs Repository](https://github.com/meshtastic/protobufs)
- [Buf Schema Registry](https://buf.build/meshtastic/protobufs)
- [Python API Documentation](https://python.meshtastic.org/)
- [JavaScript API Documentation](https://js.meshtastic.org/)
- [Android Implementation Reference](https://github.com/meshtastic/Meshtastic-Android)

---

*Документация составлена на основе официальной документации Meshtastic и protobuf определений версии 2.7.16 (November 2025)*
