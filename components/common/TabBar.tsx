import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ActiveTab } from '../../types';

interface TabConfig {
  key: ActiveTab;
  icon: string;
  label: string;
}

const TABS: TabConfig[] = [
  { key: 'chat', icon: '💬', label: 'Чаты' },
  { key: 'map', icon: '🗺️', label: 'Карта' },
  { key: 'node', icon: '📡', label: 'Рация' },
  { key: 'settings', icon: '⚙️', label: 'Ещё' },
];

interface TabBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <View style={styles.container}>
      {TABS.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={styles.tabItem}
          activeOpacity={0.7}
          onPress={() => onTabChange(tab.key)}
        >
          <Text style={styles.tabIcon}>{tab.icon}</Text>
          <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#F8F8F8',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
    paddingBottom: 20,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: 24,
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 10,
    color: '#8E8E93',
  },
  tabLabelActive: {
    color: '#2AABEE',
    fontWeight: '600',
  },
});
