import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { COLORS } from '../../screens/tabs';

export type EncryptionType = 'none' | 'aes128' | 'aes256';

interface CreateGroupModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, encryption: EncryptionType) => void;
}

export default function CreateGroupModal({
  visible,
  onClose,
  onCreate,
}: CreateGroupModalProps) {
  const [name, setName] = useState('');
  const [encryption, setEncryption] = useState<EncryptionType>('aes256');

  const handleCreate = () => {
    if (name.trim()) {
      onCreate(name.trim(), encryption);
      setName('');
      setEncryption('aes256');
    }
  };

  const handleClose = () => {
    setName('');
    setEncryption('aes256');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create Group</Text>
            <TouchableOpacity onPress={handleClose} style={styles.modalCloseButton}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.modalLabel}>Group Name</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="Enter group name..."
            placeholderTextColor="#8E8E93"
            value={name}
            onChangeText={setName}
            maxLength={30}
            autoFocus
          />

          <Text style={styles.modalLabel}>Encryption</Text>
          <View style={styles.encryptionOptions}>
            <TouchableOpacity
              style={[
                styles.encryptionOption,
                encryption === 'aes256' && styles.encryptionOptionSelected,
              ]}
              onPress={() => setEncryption('aes256')}
            >
              <Text
                style={[
                  styles.encryptionOptionText,
                  encryption === 'aes256' && styles.encryptionOptionTextSelected,
                ]}
              >
                AES-256
              </Text>
              <Text style={styles.encryptionOptionHint}>Recommended</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.encryptionOption,
                encryption === 'aes128' && styles.encryptionOptionSelected,
              ]}
              onPress={() => setEncryption('aes128')}
            >
              <Text
                style={[
                  styles.encryptionOptionText,
                  encryption === 'aes128' && styles.encryptionOptionTextSelected,
                ]}
              >
                AES-128
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.encryptionOption,
                encryption === 'none' && styles.encryptionOptionSelected,
              ]}
              onPress={() => setEncryption('none')}
            >
              <Text
                style={[
                  styles.encryptionOptionText,
                  encryption === 'none' && styles.encryptionOptionTextSelected,
                ]}
              >
                None
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.createButton, !name.trim() && styles.createButtonDisabled]}
            onPress={handleCreate}
            disabled={!name.trim()}
          >
            <Text style={styles.createButtonText}>Create Group</Text>
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
    padding: 4,
  },
  modalCloseText: {
    fontSize: 17,
    color: COLORS.primary,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginTop: 12,
  },
  modalInput: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 17,
    color: COLORS.text,
  },
  encryptionOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  encryptionOption: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  encryptionOptionSelected: {
    backgroundColor: COLORS.primary,
  },
  encryptionOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  encryptionOptionTextSelected: {
    color: COLORS.white,
  },
  encryptionOptionHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  createButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  createButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.white,
  },
});
