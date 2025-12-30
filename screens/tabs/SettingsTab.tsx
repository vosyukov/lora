import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Switch } from 'react-native';

import { meshtasticService } from '../../services/MeshtasticService';
import { sharedStyles, settingsStyles } from './styles';
import type { SettingsTabProps } from './types';
import type { MqttSettings } from '../../types';

export default function SettingsTab({
  userName,
  userPhone,
  saveUserName,
  saveUserPhone,
  mqttSettings,
  saveMqttSettings,
  isConnected,
}: SettingsTabProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [editNameInput, setEditNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');

  // MQTT editing state
  const [isEditingMqtt, setIsEditingMqtt] = useState(false);
  const [mqttForm, setMqttForm] = useState<MqttSettings>(mqttSettings);

  // Sync mqttForm with mqttSettings when not editing
  useEffect(() => {
    if (!isEditingMqtt) {
      setMqttForm(mqttSettings);
    }
  }, [mqttSettings, isEditingMqtt]);

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

  const handleSaveMqtt = async () => {
    // Validate required fields
    if (mqttForm.enabled && !mqttForm.address.trim()) {
      Alert.alert('Ошибка', 'Укажите адрес MQTT сервера');
      return;
    }

    await saveMqttSettings({
      ...mqttForm,
      address: mqttForm.address.trim(),
      username: mqttForm.username.trim(),
      password: mqttForm.password.trim(),
    });

    // If connected, send config to device immediately
    if (isConnected && mqttForm.enabled) {
      const success = await meshtasticService.setMqttConfig(mqttForm);
      if (success) {
        Alert.alert('Успешно', 'MQTT настройки отправлены на устройство');
      } else {
        Alert.alert('Ошибка', 'Не удалось отправить настройки на устройство');
      }
    }

    setIsEditingMqtt(false);
  };

  const handleCancelMqtt = () => {
    setMqttForm(mqttSettings);
    setIsEditingMqtt(false);
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
              <Text style={settingsStyles.editIcon}>✏️</Text>
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
              <Text style={settingsStyles.editIcon}>✏️</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* MQTT Settings */}
      <Text style={sharedStyles.sectionHeader}>MQTT (Интернет)</Text>
      <View style={sharedStyles.nodeStatusCard}>
        {isEditingMqtt ? (
          <>
            {/* Enabled toggle */}
            <View style={sharedStyles.nodeStatusRow}>
              <Text style={sharedStyles.nodeStatusLabel}>Включено</Text>
              <Switch
                value={mqttForm.enabled}
                onValueChange={(value) => setMqttForm({ ...mqttForm, enabled: value })}
                trackColor={{ false: '#E5E5EA', true: '#2AABEE' }}
              />
            </View>

            {/* Server address */}
            <View style={[sharedStyles.nodeStatusRow, { flexDirection: 'column', alignItems: 'flex-start' }]}>
              <Text style={sharedStyles.nodeStatusLabel}>Сервер</Text>
              <TextInput
                style={[settingsStyles.phoneInput, { width: '100%', marginTop: 4 }]}
                value={mqttForm.address}
                onChangeText={(value) => setMqttForm({ ...mqttForm, address: value })}
                placeholder="mqtt.example.com"
                placeholderTextColor="#8E8E93"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Username */}
            <View style={[sharedStyles.nodeStatusRow, { flexDirection: 'column', alignItems: 'flex-start' }]}>
              <Text style={sharedStyles.nodeStatusLabel}>Логин</Text>
              <TextInput
                style={[settingsStyles.phoneInput, { width: '100%', marginTop: 4 }]}
                value={mqttForm.username}
                onChangeText={(value) => setMqttForm({ ...mqttForm, username: value })}
                placeholder="username"
                placeholderTextColor="#8E8E93"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Password */}
            <View style={[sharedStyles.nodeStatusRow, { flexDirection: 'column', alignItems: 'flex-start' }]}>
              <Text style={sharedStyles.nodeStatusLabel}>Пароль</Text>
              <TextInput
                style={[settingsStyles.phoneInput, { width: '100%', marginTop: 4 }]}
                value={mqttForm.password}
                onChangeText={(value) => setMqttForm({ ...mqttForm, password: value })}
                placeholder="password"
                placeholderTextColor="#8E8E93"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Use phone's internet */}
            <View style={sharedStyles.nodeStatusRow}>
              <Text style={sharedStyles.nodeStatusLabel}>Через интернет телефона</Text>
              <Switch
                value={mqttForm.proxyToClientEnabled}
                onValueChange={(value) => setMqttForm({ ...mqttForm, proxyToClientEnabled: value })}
                trackColor={{ false: '#E5E5EA', true: '#2AABEE' }}
              />
            </View>

            {/* Encryption */}
            <View style={sharedStyles.nodeStatusRow}>
              <Text style={sharedStyles.nodeStatusLabel}>Шифрование</Text>
              <Switch
                value={mqttForm.encryptionEnabled}
                onValueChange={(value) => setMqttForm({ ...mqttForm, encryptionEnabled: value })}
                trackColor={{ false: '#E5E5EA', true: '#2AABEE' }}
              />
            </View>

            {/* TLS */}
            <View style={sharedStyles.nodeStatusRow}>
              <Text style={sharedStyles.nodeStatusLabel}>TLS (порт 8883)</Text>
              <Switch
                value={mqttForm.tlsEnabled}
                onValueChange={(value) => setMqttForm({ ...mqttForm, tlsEnabled: value })}
                trackColor={{ false: '#E5E5EA', true: '#2AABEE' }}
              />
            </View>

            {/* Save/Cancel buttons */}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
              <TouchableOpacity
                style={[settingsStyles.phoneSaveButton, { backgroundColor: '#E5E5EA' }]}
                onPress={handleCancelMqtt}
              >
                <Text style={[settingsStyles.phoneSaveButtonText, { color: '#000' }]}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={settingsStyles.phoneSaveButton}
                onPress={handleSaveMqtt}
              >
                <Text style={settingsStyles.phoneSaveButtonText}>Сохранить</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            {/* Status */}
            <View style={sharedStyles.nodeStatusRow}>
              <Text style={sharedStyles.nodeStatusLabel}>Статус</Text>
              <Text style={[sharedStyles.nodeStatusValue, { color: mqttSettings.enabled ? '#31B545' : '#8E8E93' }]}>
                {mqttSettings.enabled ? 'Включено' : 'Выключено'}
              </Text>
            </View>

            {mqttSettings.enabled && (
              <>
                <View style={sharedStyles.nodeStatusRow}>
                  <Text style={sharedStyles.nodeStatusLabel}>Сервер</Text>
                  <Text style={sharedStyles.nodeStatusValue}>{mqttSettings.address || '—'}</Text>
                </View>
                <View style={sharedStyles.nodeStatusRow}>
                  <Text style={sharedStyles.nodeStatusLabel}>Логин</Text>
                  <Text style={sharedStyles.nodeStatusValue}>{mqttSettings.username || '—'}</Text>
                </View>
                <View style={sharedStyles.nodeStatusRow}>
                  <Text style={sharedStyles.nodeStatusLabel}>Через телефон</Text>
                  <Text style={sharedStyles.nodeStatusValue}>{mqttSettings.proxyToClientEnabled ? 'Да' : 'Нет'}</Text>
                </View>
              </>
            )}

            {/* Edit button */}
            <TouchableOpacity
              style={{ marginTop: 8 }}
              onPress={() => setIsEditingMqtt(true)}
            >
              <Text style={{ color: '#2AABEE', fontSize: 16 }}>Настроить</Text>
            </TouchableOpacity>
          </>
        )}
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
