import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Share,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { COLORS } from '../../screens/tabs';

interface ShareChannelModalProps {
  visible: boolean;
  channelUrl: string | null;
  onClose: () => void;
}

export default function ShareChannelModal({
  visible,
  channelUrl,
  onClose,
}: ShareChannelModalProps) {
  const handleShareLink = async () => {
    if (!channelUrl) return;

    try {
      await Share.share({
        message: channelUrl,
        title: 'Join my Meshtastic channel',
      });
    } catch (error) {
      // User cancelled or error
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Share Group</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
              <Text style={styles.modalCloseText}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.qrContainer}>
            {channelUrl && (
              <QRCode
                value={channelUrl}
                size={200}
                backgroundColor="white"
                color="black"
              />
            )}
          </View>

          <Text style={styles.shareHint}>
            Scan this QR code with another Meshtastic device to join this channel
          </Text>

          <TouchableOpacity style={styles.shareUrlButton} onPress={handleShareLink}>
            <Text style={styles.shareUrlButtonText}>Share Link</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalCloseButton: {
    padding: 8,
  },
  modalCloseText: {
    fontSize: 16,
    color: COLORS.primary,
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    padding: 24,
    borderRadius: 16,
    marginBottom: 20,
  },
  shareHint: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  shareUrlButton: {
    backgroundColor: '#5856D6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  shareUrlButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.white,
  },
});
