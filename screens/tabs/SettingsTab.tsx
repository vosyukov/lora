import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';

import { meshtasticService } from '../../services/MeshtasticService';
import { sharedStyles, settingsStyles } from './styles';
import type { SettingsTabProps } from './types';

export default function SettingsTab({
  userName,
  userPhone,
  saveUserName,
  saveUserPhone,
}: SettingsTabProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [editNameInput, setEditNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');

  const handleSaveName = async () => {
    const name = editNameInput.trim();
    if (name) {
      const shortName = meshtasticService.generateShortName(name);
      const success = await meshtasticService.setOwner(name, shortName);
      if (success) {
        await saveUserName(name);
      } else {
        Alert.alert('Error', 'Failed to save name to radio. Check connection.');
      }
    }
    setIsEditingName(false);
  };

  const handleSavePhone = () => {
    saveUserPhone(phoneInput.trim());
    setIsEditingPhone(false);
  };

  return (
    <ScrollView style={sharedStyles.nodesList} showsVerticalScrollIndicator={false}>
      {/* Profile */}
      <Text style={sharedStyles.sectionHeader}>PROFILE</Text>
      <View style={sharedStyles.nodeStatusCard}>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Name</Text>
          {isEditingName ? (
            <View style={settingsStyles.phoneInputContainer}>
              <TextInput
                style={settingsStyles.phoneInput}
                value={editNameInput}
                onChangeText={setEditNameInput}
                placeholder="Your name"
                placeholderTextColor="#8E8E93"
                autoFocus
              />
              <TouchableOpacity
                style={settingsStyles.phoneSaveButton}
                onPress={handleSaveName}
              >
                <Text style={settingsStyles.phoneSaveButtonText}>OK</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={settingsStyles.editableField}
              onPress={() => {
                setEditNameInput(userName || '');
                setIsEditingName(true);
              }}
            >
              <Text style={[sharedStyles.nodeStatusValue, !userName && settingsStyles.phoneEmpty]}>
                {userName || 'Add'}
              </Text>
              <Text style={settingsStyles.editIcon}></Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Phone</Text>
          {isEditingPhone ? (
            <View style={settingsStyles.phoneInputContainer}>
              <TextInput
                style={settingsStyles.phoneInput}
                value={phoneInput}
                onChangeText={setPhoneInput}
                placeholder="+1 234 567-8900"
                placeholderTextColor="#8E8E93"
                keyboardType="phone-pad"
                autoFocus
              />
              <TouchableOpacity
                style={settingsStyles.phoneSaveButton}
                onPress={handleSavePhone}
              >
                <Text style={settingsStyles.phoneSaveButtonText}>OK</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={settingsStyles.editableField}
              onPress={() => {
                setPhoneInput(userPhone || '');
                setIsEditingPhone(true);
              }}
            >
              <Text style={[sharedStyles.nodeStatusValue, !userPhone && settingsStyles.phoneEmpty]}>
                {userPhone || 'Add'}
              </Text>
              <Text style={settingsStyles.editIcon}></Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* About */}
      <Text style={sharedStyles.sectionHeader}>ABOUT</Text>
      <View style={sharedStyles.nodeStatusCard}>
        <View style={sharedStyles.nodeStatusRow}>
          <Text style={sharedStyles.nodeStatusLabel}>Version</Text>
          <Text style={sharedStyles.nodeStatusValue}>1.0.0</Text>
        </View>
      </View>

      <View style={sharedStyles.bottomPadding} />
    </ScrollView>
  );
}
