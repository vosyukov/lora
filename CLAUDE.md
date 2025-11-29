# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React Native mobile application built with Expo SDK 54, using TypeScript and React 19. The project implements a Meshtastic client application for communicating with Meshtastic mesh network devices via BLE (Bluetooth Low Energy). The app targets iOS, Android, and web platforms. React Native's new architecture is enabled.

**Meshtastic Integration**: See [MESHTASTIC_API.md](./MESHTASTIC_API.md) for complete documentation on Meshtastic Bluetooth protocol, protobuf structures, and API usage.

## Key Dependencies

- **react-native-ble-plx**: Core BLE functionality for scanning and connecting to Bluetooth devices
- **@meshtastic/protobufs**: Meshtastic Protocol Buffer definitions for encoding/decoding messages (v2.7.8)
- **expo-status-bar**: Status bar management
- **expo-dev-client**: Development client for Expo
- **React 19**: Latest React version with new architecture support

## Development Commands

- `npm start` - Start the Expo development server
- `npm run android` - Start the app on Android emulator/device
- `npm run ios` - Start the app on iOS simulator/device
- `npm run web` - Start the app in web browser

## EAS Build Configuration

The project is configured with EAS (Expo Application Services) for building and distribution:

- **Development**: Uses development client with internal distribution
- **Preview**: Internal distribution builds
- **Production**: Auto-increments version numbers

Project ID: `43aedf14-4cab-4a02-be50-53dcee098542`

## Architecture

The application uses a simple screen-switching architecture:

- **Entry point**: `index.ts` registers the root component using `registerRootComponent()`
- **Root component**: `App.tsx` renders the HomeScreen component
- **Screens**:
  - `screens/HomeScreen.tsx` - BLE scanner with Meshtastic device detection
  - `screens/DeviceDetailScreen.tsx` - Meshtastic device connection and communication
- **Screen Navigation**: Conditional rendering based on state (no navigation library)
- **TypeScript**: Strict mode enabled, extends Expo's base tsconfig

### BLE Implementation

The app uses `react-native-ble-plx` for Bluetooth functionality:

**HomeScreen (Scanner)**:
- **BLE Manager**: Global singleton instance created at module level
- **Permissions**: Platform-specific handling (Android 31+ requires BLUETOOTH_SCAN, BLUETOOTH_CONNECT, and ACCESS_FINE_LOCATION)
- **Scanning**: Device scan runs for 10 seconds by default with automatic deduplication based on device ID
- **State Management**: React state for devices list, scanning status, and Bluetooth adapter state
- **Meshtastic Detection**: Devices are identified as Meshtastic by:
  - Service UUID: `6ba1b218-15a8-461f-9fa8-5dcae273eafd`
  - Device name containing "meshtastic"
- **UI Features**: Meshtastic devices are visually highlighted with green background, border, and badge

**DeviceDetailScreen (Connection)**:
- **Connection Flow**: Following Meshtastic BLE protocol:
  1. Connect to device
  2. Set MTU to 512 bytes
  3. Discover services and characteristics
  4. Subscribe to FromNum (0xed9da18c-a800-4f66-a670-aa7547e34453) for message notifications
  5. Send ToRadio.want_config_id to request configuration
  6. Read FromRadio repeatedly to receive initial data
- **Message Handling**: Processes FromRadio messages including:
  - MyNodeInfo - local node information
  - NodeInfo - mesh network nodes
  - Config/Channel - device configuration
  - MeshPacket - text messages, position data, telemetry
- **Protobuf**: Uses @meshtastic/protobufs for encoding ToRadio and decoding FromRadio messages
- **Real-time Updates**: Monitors FromNum characteristic for new message notifications

### Platform Configuration

**iOS**:
- Tablet support enabled
- Bluetooth usage descriptions in `Info.plist` via `app.json`

**Android**:
- Package name: `com.yourcompany.myapp`
- Edge-to-edge mode enabled
- Predictive back gesture disabled
- Comprehensive Bluetooth permissions for API levels 31+

**BLE Plugin**:
- Background mode enabled with both peripheral and central modes
- Configured via `react-native-ble-plx` Expo plugin in `app.json`

## Meshtastic Protocol

This application is designed to communicate with Meshtastic mesh network devices. Key integration points:

### Bluetooth Service

- **Service UUID**: `6ba1b218-15a8-461f-9fa8-5dcae273eafd`
- **ToRadio UUID**: `f75c76d2-129e-4dad-a1dd-7866124401e7` (Write)
- **FromRadio UUID**: `2c55e69e-4993-11ed-b878-0242ac120002` (Read)
- **FromNum UUID**: `ed9da18c-a800-4f66-a670-aa7547e34453` (Read/Notify)

### Protocol Buffers

The application uses Meshtastic protobuf definitions for all communication:

- **ToRadio**: Commands/packets sent to device
- **FromRadio**: Responses/packets from device
- **MeshPacket**: Envelope for mesh network packets
- **Data**: Actual payload with portnum-specific content

### Connection Flow

1. Scan for devices with Meshtastic service UUID
2. Connect and set MTU to 512 bytes
3. Send `ToRadio.want_config_id` to request full NodeDB
4. Subscribe to FromNum for message notifications
5. Read FromRadio repeatedly until receiving all initial data
6. Process incoming MeshPackets based on portnum

### Documentation

For detailed information about protobuf structures, message types, and API usage, refer to [MESHTASTIC_API.md](./MESHTASTIC_API.md).

## Important Notes

- The BLE manager instance is created at module level and cleaned up in the component's useEffect cleanup
- Bluetooth state changes are monitored via subscription
- Device list automatically deduplicates by device ID and updates RSSI values for existing devices
- Scanning requires Bluetooth to be powered on and appropriate permissions granted
- When connecting to Meshtastic devices, filter by service UUID `6ba1b218-15a8-461f-9fa8-5dcae273eafd` for efficiency
