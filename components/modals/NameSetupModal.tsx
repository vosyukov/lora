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
import { meshtasticService } from '../../services/MeshtasticService';

interface NameSetupModalProps {
  visible: boolean;
  onSave: (name: string, shortName: string) => Promise<boolean>;
}

export default function NameSetupModal({
  visible,
  onSave,
}: NameSetupModalProps) {
  const [nameInput, setNameInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    const name = nameInput.trim();
    if (!name || isSaving) return;

    setIsSaving(true);
    const shortName = meshtasticService.generateShortName(name);
    const success = await onSave(name, shortName);
    setIsSaving(false);

    if (success) {
      setNameInput('');
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>What's your name?</Text>
          <Text style={styles.modalSubtitle}>
            Your friends in the network will see this name
          </Text>
          <TextInput
            style={styles.nameInput}
            placeholder="Enter your name"
            placeholderTextColor="#8E8E93"
            value={nameInput}
            onChangeText={setNameInput}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSave}
            editable={!isSaving}
          />
          {nameInput.trim() && (
            <Text style={styles.shortNamePreview}>
              Short name: {meshtasticService.generateShortName(nameInput)}
            </Text>
          )}
          <TouchableOpacity
            style={[
              styles.modalButton,
              (!nameInput.trim() || isSaving) && styles.modalButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!nameInput.trim() || isSaving}
          >
            <Text style={styles.modalButtonText}>
              {isSaving ? 'Saving...' : 'Save'}
            </Text>
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
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  nameInput: {
    backgroundColor: '#F4F4F5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: COLORS.text,
    width: '100%',
    marginBottom: 12,
  },
  shortNamePreview: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  modalButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  modalButtonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  modalButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.white,
  },
});
