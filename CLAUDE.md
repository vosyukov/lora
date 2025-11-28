# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React Native mobile application built with Expo SDK 54, using TypeScript and React 19. The project targets iOS, Android, and web platforms and has React Native's new architecture enabled.

## Development Commands

- `npm start` - Start the Expo development server
- `npm run android` - Start the app on Android emulator/device
- `npm run ios` - Start the app on iOS simulator/device
- `npm run web` - Start the app in web browser

## Architecture

The application follows a minimal Expo setup:

- **Entry point**: `index.ts` registers the root component using `registerRootComponent()`
- **Root component**: `App.tsx` contains the main application component
- **TypeScript**: Strict mode is enabled, extends Expo's base tsconfig
- **Expo configuration**: `app.json` contains platform-specific settings and metadata

### Platform Configuration

- **New Architecture**: React Native's new architecture is enabled (`newArchEnabled: true`)
- **Android**: Edge-to-edge mode enabled, predictive back gesture disabled
- **iOS**: Tablet support enabled
- **Assets**: Icons and splash screens are in the `assets/` directory

## Code Structure

This is a fresh Expo project with a single-file app structure. As the codebase grows, components and features should be organized into appropriate directories.
