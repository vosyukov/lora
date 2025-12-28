// Meshtastic BLE Service UUIDs
export const MESHTASTIC_SERVICE_UUID = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';
export const TORADIO_UUID = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
export const FROMRADIO_UUID = '2c55e69e-4993-11ed-b878-0242ac120002';
export const FROMNUM_UUID = 'ed9da18c-a800-4f66-a670-aa7547e34453';

// Meshtastic protocol constants
export const BROADCAST_ADDR = 0xFFFFFFFF;
export const MTU_SIZE = 512;

// Polling configuration
export const POLL_INTERVAL_MS = 2000;
export const INITIAL_READ_DELAY_MS = 200;
export const MAX_EMPTY_READS = 5;

// Reconnect configuration
export const MAX_RECONNECT_ATTEMPTS = 10;
export const RECONNECT_DELAY_MS = 3000;
export const RECONNECT_SCAN_TIMEOUT_MS = 10000;

// Storage keys
export const FRIENDS_STORAGE_KEY = '@friends_ids';
export const MESSAGES_STORAGE_KEY = '@messages';
export const LAST_DEVICE_KEY = '@last_device';
export const LAST_READ_STORAGE_KEY = '@last_read';
export const USER_NAME_KEY = '@user_name';
export const USER_PHONE_KEY = '@user_phone';
export const GPS_ENABLED_KEY = '@gps_enabled';
export const MAX_STORED_MESSAGES = 500;

// GPS configuration
export const GPS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Map configuration
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const OFFLINE_PACK_NAME = 'meshNetwork';

// UI Colors (Telegram-inspired palette)
export const COLORS = {
  // Brand colors
  primary: '#2AABEE',
  primaryDark: '#229ED9',

  // Status colors
  success: '#31B545',
  warning: '#FF9500',
  error: '#FF3B30',

  // Text colors
  text: '#000000',
  textPrimary: '#000000',
  textSecondary: '#8E8E93',
  textHint: '#999999',

  // Background colors
  background: '#FFFFFF',
  backgroundGray: '#F4F4F5',
  cardBackground: '#FFFFFF',

  // Other
  border: '#E5E5EA',
  white: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.5)',
} as const;
