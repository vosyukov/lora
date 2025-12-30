import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { logger } from '../services/LoggerService';

interface ChannelData {
  name: string;
  psk: Uint8Array;
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
}

interface QRScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onChannelScanned: (channelData: ChannelData) => void;
}

const colors = {
  primary: '#2AABEE',
  background: '#000000',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  overlay: 'rgba(0, 0, 0, 0.6)',
  success: '#31B545',
  error: '#FF3B30',
};

export default function QRScannerModal({
  visible,
  onClose,
  onChannelScanned,
}: QRScannerModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (visible) {
      setScanned(false);
      setProcessing(false);
    }
  }, [visible]);

  const parseChannelUrl = async (url: string): Promise<ChannelData | null> => {
    try {
      logger.debug('QRScanner', 'Parsing URL:', url);

      // Meshtastic channel URLs:
      // https://meshtastic.org/e/#CgMSAQ... (base64 encoded ChannelSet protobuf)
      // Can be with or without https://
      const urlPattern = /meshtastic\.org\/e\/#(.+)/;
      const match = url.match(urlPattern);

      if (!match) {
        logger.debug('QRScanner', 'URL does not match Meshtastic pattern');
        logger.debug('QRScanner', 'Expected format: https://meshtastic.org/e/#<base64>');
        return null;
      }

      const base64Data = match[1];
      logger.debug('QRScanner', 'Base64 data length:', base64Data.length);
      logger.debug('QRScanner', 'Base64 data preview:', base64Data.substring(0, 50));

      // Decode base64 (URL-safe base64)
      let base64Standard = base64Data.replace(/-/g, '+').replace(/_/g, '/');
      // Add padding if needed
      while (base64Standard.length % 4 !== 0) {
        base64Standard += '=';
      }
      logger.debug('QRScanner', 'Normalized base64 length:', base64Standard.length);

      const binaryString = atob(base64Standard);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      logger.debug('QRScanner', 'Decoded bytes length:', bytes.length);

      // Parse ChannelSet protobuf
      const { fromBinary } = await import('@bufbuild/protobuf');
      const { AppOnly } = await import('@meshtastic/protobufs');

      logger.debug('QRScanner', 'Parsing protobuf...');
      const channelSet = fromBinary(AppOnly.ChannelSetSchema, bytes);
      logger.debug('QRScanner', 'Parsed ChannelSet:', JSON.stringify(channelSet, null, 2));

      if (!channelSet.settings || channelSet.settings.length === 0) {
        logger.debug('QRScanner', 'No channel settings in ChannelSet');
        return null;
      }

      // Get first channel settings
      const firstChannel = channelSet.settings[0];
      logger.debug('QRScanner', 'First channel name:', firstChannel.name);
      logger.debug('QRScanner', 'First channel psk length:', firstChannel.psk?.length || 0);

      return {
        name: firstChannel.name || 'Default',
        psk: firstChannel.psk || new Uint8Array(),
        uplinkEnabled: firstChannel.uplinkEnabled || false,
        downlinkEnabled: firstChannel.downlinkEnabled || false,
      };
    } catch (error) {
      logger.debug('QRScanner', 'Parse error:', error);
      if (error instanceof Error) {
        logger.debug('QRScanner', 'Error message:', error.message);
        logger.debug('QRScanner', 'Error stack:', error.stack);
      }
      return null;
    }
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned || processing) return;

    logger.debug('QRScanner', 'Scanned data:', data);
    setScanned(true);
    setProcessing(true);

    const channelData = await parseChannelUrl(data);

    if (channelData) {
      logger.debug('QRScanner', 'Successfully parsed channel:', channelData.name);
      onChannelScanned(channelData);
      onClose();
    } else {
      Alert.alert(
        'Неверный QR-код',
        'Это не QR-код группы Meshtastic. Отсканируйте QR-код из приложения Meshtastic.',
        [
          {
            text: 'Повторить',
            onPress: () => {
              setScanned(false);
              setProcessing(false);
            },
          },
          {
            text: 'Закрыть',
            onPress: onClose,
            style: 'cancel',
          },
        ]
      );
    }
  };

  const renderContent = () => {
    if (!permission) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.statusText}>Проверка разрешений...</Text>
        </View>
      );
    }

    if (!permission.granted) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.iconEmoji}>📷</Text>
          <Text style={styles.titleText}>Доступ к камере</Text>
          <Text style={styles.descriptionText}>
            Для сканирования QR-кода необходим доступ к камере
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Разрешить</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />

        {/* Overlay with viewfinder */}
        <View style={styles.overlay}>
          <View style={styles.overlayTop} />
          <View style={styles.overlayMiddle}>
            <View style={styles.overlaySide} />
            <View style={styles.viewfinder}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
            <View style={styles.overlaySide} />
          </View>
          <View style={styles.overlayBottom}>
            <Text style={styles.hintText}>
              Наведите камеру на QR-код группы
            </Text>
          </View>
        </View>

        {processing && (
          <View style={styles.processingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.processingText}>Обработка...</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Закрыть</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Сканировать QR</Text>
          <View style={styles.headerRight} />
        </View>

        {renderContent()}
      </View>
    </Modal>
  );
}

const VIEWFINDER_SIZE = 250;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.background,
  },
  closeButton: {
    width: 80,
  },
  closeButtonText: {
    fontSize: 17,
    color: colors.primary,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  headerRight: {
    width: 80,
  },

  // Center container for permissions
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconEmoji: {
    fontSize: 64,
    marginBottom: 24,
  },
  titleText: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  descriptionText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  statusText: {
    marginTop: 16,
    fontSize: 15,
    color: colors.textSecondary,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },

  // Camera
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },

  // Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayTop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  overlayMiddle: {
    flexDirection: 'row',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 32,
  },
  hintText: {
    fontSize: 15,
    color: colors.text,
    textAlign: 'center',
  },

  // Corners
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: colors.primary,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },

  // Processing overlay
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    marginTop: 16,
    fontSize: 17,
    color: colors.text,
  },
});
