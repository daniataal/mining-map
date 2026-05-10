import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { theme } from '../theme';
import { LogOut, User, Shield, Info, Smartphone } from 'lucide-react-native';

export default function SettingsScreen() {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    const u = await SecureStore.getItemAsync('mining_username');
    const r = await SecureStore.getItemAsync('mining_role');
    setUsername(u || 'User');
    setRole(r || 'Standard');
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to terminate the secure session?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Logout', 
          style: 'destructive',
          onPress: async () => {
            await SecureStore.deleteItemAsync('mining_token');
            // This will trigger the App.tsx state change if we use a context or just restart
            // For now, let's just alert the user to restart the app or we can use a callback
            Alert.alert('Logged Out', 'Secure session terminated. Please restart the app.');
          }
        },
      ]
    );
  };

  const MenuItem = ({ icon: Icon, label, value, onPress, color = theme.colors.text }: any) => (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} disabled={!onPress}>
      <View style={styles.menuLeft}>
        <View style={styles.menuIcon}>
          <Icon size={20} color={color} />
        </View>
        <Text style={[styles.menuLabel, { color }]}>{label}</Text>
      </View>
      {value && <Text style={styles.menuValue}>{value}</Text>}
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.profileSection}>
        <View style={styles.avatar}>
          <User size={40} color={theme.colors.accent} />
        </View>
        <Text style={styles.username}>{username.toUpperCase()}</Text>
        <Text style={styles.role}>{role.toUpperCase()} ACCESS LEVEL</Text>
      </View>

      <Text style={styles.sectionTitle}>SYSTEM STATUS</Text>
      <View style={styles.menuGroup}>
        <MenuItem icon={Shield} label="Security Protocol" value="Active (AES-256)" />
        <MenuItem icon={Smartphone} label="App Version" value="2.0.0-PRO" />
        <MenuItem icon={Info} label="Backend Status" value="Online" />
      </View>

      <Text style={styles.sectionTitle}>SESSION CONTROL</Text>
      <View style={styles.menuGroup}>
        <MenuItem 
          icon={LogOut} 
          label="TERMINATE SESSION" 
          onPress={handleLogout} 
          color={theme.colors.error} 
        />
      </View>

      <Text style={styles.footer}>MERIDIAN TRADE INTELLIGENCE OS • CLASSIFIED</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: theme.colors.surface,
    borderRadius: 24,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: theme.colors.accent + '40',
  },
  username: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
  role: {
    color: theme.colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: theme.colors.textMuted,
    letterSpacing: 2,
    marginBottom: 12,
    marginLeft: 4,
  },
  menuGroup: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    marginBottom: 24,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuIcon: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  menuValue: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  footer: {
    textAlign: 'center',
    fontSize: 9,
    color: theme.colors.textMuted,
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 40,
  }
});
