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

// Storage keys
export const FRIENDS_STORAGE_KEY = '@friends_ids';
export const MESSAGES_STORAGE_KEY = '@messages';
export const LAST_DEVICE_KEY = '@last_device';
export const LAST_READ_STORAGE_KEY = '@last_read';
export const MAX_STORED_MESSAGES = 500;
