# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React Native mobile application built with Expo SDK 54, using TypeScript and React 19. The project implements a Meshtastic client application for communicating with Meshtastic mesh network devices via BLE (Bluetooth Low Energy). The app targets iOS, Android, and web platforms. React Native's new architecture is enabled.

**Meshtastic Integration**: See [MESHTASTIC_API.md](./MESHTASTIC_API.md) for complete documentation on Meshtastic Bluetooth protocol, protobuf structures, and API usage.

## Product Vision

**Target Audience**: Hunters, fishermen, tourists — regular people (not tech-savvy) who need to communicate with friends in areas without cell coverage.

**Use Case**: A group of friends in the wilderness (forest, mountains, fishing trip) using Meshtastic radios to stay connected, chat, and see each other's locations.

**Core Principle**: The app should "just work" — connect the radio, open the app, see your friends, send messages. No technical knowledge required.

## UI/UX Guidelines

**Design Reference**: Telegram messenger — familiar, intuitive interface that users already know.

**Key Features (by priority)**:
1. **Chat** — messaging with friends (like Telegram chats)
2. **Map** — see where friends are located
3. **Participants** — who's online in the network
4. **Simple Connection** — easy wizard to find and connect radio

**What to HIDE from users**:
- Technical details (protobuf, channels, LoRa configs)
- Complex device settings
- Debug logs and raw data
- Meshtastic-specific terminology

**Language**: Russian (primary UI language)

## Development Commands

- `npm start` - Start the Expo development server
- `npm run android` - Start the app on Android emulator/device
- `npm run ios` - Start the app on iOS simulator/device
- `npm run web` - Start the app in web browser
- `npx tsc --noEmit` - Check TypeScript compilation without building

## Project Structure

```
/
├── App.tsx                 # Root component, renders MainScreen
├── index.ts                # Entry point, registerRootComponent()
│
├── screens/
│   ├── MainScreen.tsx      # Connection management, auto-connect logic
│   └── DeviceDetailScreen.tsx  # Main app screen with tabs (Chat, Map, Node, Settings)
│
├── components/
│   ├── ScannerModal.tsx    # BLE device scanner wizard
│   ├── QRScannerModal.tsx  # QR code scanner for channel import
│   ├── common/             # Shared UI components
│   │   ├── TopStatusBar.tsx
│   │   ├── TabBar.tsx
│   │   └── EmptyState.tsx
│   └── map/                # Map-related components
│
├── hooks/
│   ├── useMeshtastic.ts    # Main hook for Meshtastic device communication
│   ├── useStorage.ts       # Persistent storage (friends, messages, settings)
│   ├── useGps.ts           # GPS location tracking and sending
│   ├── useOfflineMap.ts    # Offline map tiles management
│   └── index.ts            # Re-exports all hooks
│
├── services/
│   ├── MeshtasticService.ts    # BLE communication, protobuf encoding/decoding
│   └── NotificationService.ts  # Push notifications for messages
│
├── utils/
│   ├── ble.ts              # Shared BLE utility functions
│   └── index.ts            # Re-exports
│
├── types/
│   └── index.ts            # TypeScript type definitions
│
└── constants/
    └── meshtastic.ts       # Constants: UUIDs, colors, storage keys
```

## Architecture

### Application Flow

```
App.tsx
    └── MainScreen.tsx
            ├── [loading] → Shows spinner while checking saved device
            ├── [auto_connecting] → Scanning for previously connected device
            ├── [offline] → DeviceDetailScreen with device=null
            └── [connected] → DeviceDetailScreen with connected device

DeviceDetailScreen.tsx
    ├── Tab: Chat → Chat list + individual chats
    ├── Tab: Map → MapLibre with node positions
    ├── Tab: Node → Device info, telemetry, config
    └── Tab: Settings → User profile settings

ScannerModal.tsx (opened from DeviceDetailScreen)
    └── BLE scanning wizard → on success → connected device
```

### Key Hooks

| Hook | Purpose |
|------|---------|
| `useMeshtastic` | Manages Meshtastic device connection, subscribes to events, provides send methods |
| `useStorage` | Persists friends, messages, last read timestamps, user profile |
| `useGps` | Tracks device GPS, sends position to mesh network periodically |
| `useOfflineMap` | Manages offline map tile downloads using MapLibre |

### Services

| Service | Purpose |
|---------|---------|
| `MeshtasticService` | Low-level BLE communication, protobuf encoding/decoding, event emitters |
| `NotificationService` | Local push notifications for incoming messages |

## Key Dependencies

- **react-native-ble-plx**: Core BLE functionality for scanning and connecting to Bluetooth devices
- **@meshtastic/protobufs**: Meshtastic Protocol Buffer definitions for encoding/decoding messages (v2.7.8)
- **@maplibre/maplibre-react-native**: Map rendering with offline support
- **expo-location**: GPS access
- **expo-notifications**: Local push notifications
- **@react-native-async-storage/async-storage**: Persistent storage
- **React 19**: Latest React version with new architecture support

## Meshtastic Protocol

### Bluetooth Service

- **Service UUID**: `6ba1b218-15a8-461f-9fa8-5dcae273eafd`
- **ToRadio UUID**: `f75c76d2-129e-4dad-a1dd-7866124401e7` (Write)
- **FromRadio UUID**: `2c55e69e-4993-11ed-b878-0242ac120002` (Read)
- **FromNum UUID**: `ed9da18c-a800-4f66-a670-aa7547e34453` (Read/Notify)

### Connection Flow

1. Scan for devices with Meshtastic service UUID
2. Connect and set MTU to 512 bytes
3. Send `ToRadio.want_config_id` to request full NodeDB
4. Subscribe to FromNum for message notifications
5. Read FromRadio repeatedly until receiving all initial data
6. Process incoming MeshPackets based on portnum

### Documentation

For detailed information about protobuf structures, message types, and API usage, refer to [MESHTASTIC_API.md](./MESHTASTIC_API.md).

## Coding Guidelines

### Adding New Features

1. **New UI component**: Add to `components/` with appropriate subdirectory
2. **New business logic**: Create a hook in `hooks/` or extend existing service
3. **New constants**: Add to `constants/meshtastic.ts`
4. **New types**: Add to `types/index.ts`

### Styling

- Use `COLORS` from `constants/meshtastic.ts` for consistent theming
- Telegram-inspired color palette (primary: `#2AABEE`)
- Russian language for all user-facing text

### BLE Utilities

Use shared utilities from `utils/ble.ts`:
- `rssiToPercent(rssi)` - Convert RSSI to 0-100 percentage
- `getDeviceName(device)` - Clean device name, removes "Meshtastic_" prefix
- `requestBlePermissions()` - Request Android BLE permissions

### State Management

- Local component state for UI
- Hooks for domain logic (`useMeshtastic`, `useStorage`, etc.)
- `MeshtasticService` singleton for BLE connection management

## Future Improvements (TODO)

### Refactoring Candidates

1. **DeviceDetailScreen.tsx** (~1700 lines) - Should be split into:
   - `screens/tabs/ChatTab.tsx`
   - `screens/tabs/MapTab.tsx`
   - `screens/tabs/NodeTab.tsx`
   - `screens/tabs/SettingsTab.tsx`

2. **Create shared components**:
   - `components/common/NodeAvatar.tsx`
   - `components/common/StatusBadge.tsx`
   - `components/chat/MessageBubble.tsx`
   - `components/chat/ChatListItem.tsx`

3. **Add code quality tools**:
   - ESLint with React Native config
   - Prettier for consistent formatting
   - Husky for pre-commit hooks

### Missing Features

- [ ] Message delivery confirmation UI
- [ ] Node last seen timestamp display
- [ ] Channel QR code generation
- [ ] Device settings editing
- [ ] Message search

## EAS Build Configuration

The project is configured with EAS (Expo Application Services) for building and distribution:

- **Development**: Uses development client with internal distribution
- **Preview**: Internal distribution builds
- **Production**: Auto-increments version numbers

Project ID: `43aedf14-4cab-4a02-be50-53dcee098542`

## Platform Configuration

**iOS**:
- Tablet support enabled
- Bluetooth usage descriptions in `Info.plist` via `app.json`

**Android**:
- Package name: `com.yourcompany.myapp`
- Edge-to-edge mode enabled
- Comprehensive Bluetooth permissions for API levels 31+

**BLE Plugin**:
- Background mode enabled with both peripheral and central modes
- Configured via `react-native-ble-plx` Expo plugin in `app.json`

## Important Notes

- BLE manager is created at module level in MainScreen and cleaned up in useEffect
- Auto-reconnect logic tries to find previously connected device on app start
- Offline mode works without device connection (view cached messages)
- GPS position is sent to mesh every 5 minutes when connected
- Messages are persisted locally (up to 500 messages)
