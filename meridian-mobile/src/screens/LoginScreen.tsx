import React, { useState } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  Image, 
  KeyboardAvoidingView, 
  Platform,
  ActivityIndicator,
  Alert
} from 'react-native';
import { theme } from '../theme';
import { login } from '../api';
import * as SecureStore from 'expo-secure-store';
import { Anchor } from 'lucide-react-native';

export default function LoginScreen({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('Error', 'Please enter username and password');
      return;
    }

    setLoading(true);
    try {
      const data = await login(username, password);
      await SecureStore.setItemAsync('mining_token', data.access_token);
      await SecureStore.setItemAsync('mining_username', data.username);
      await SecureStore.setItemAsync('mining_role', data.role);
      await SecureStore.setItemAsync('mining_userid', data.id);
      onLoginSuccess();
    } catch (err: any) {
      console.error(err);
      Alert.alert('Login Failed', err.response?.data?.detail || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.inner}>
        <View style={styles.logoContainer}>
          <View style={styles.iconCircle}>
            <Anchor size={48} color={theme.colors.accent} strokeWidth={2.5} />
          </View>
          <Text style={styles.title}>MERIDIAN</Text>
          <Text style={styles.subtitle}>TRADE INTELLIGENCE OS</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>USERNAME</Text>
            <TextInput 
              style={styles.input}
              placeholder="Enter your username"
              placeholderTextColor={theme.colors.textMuted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput 
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor={theme.colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity 
            style={[styles.button, loading && styles.buttonDisabled]} 
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : (
              <Text style={styles.buttonText}>ESTABLISH CONNECTION</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>© 2024 MERIDIAN STRATEGIC SYSTEMS</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  inner: {
    flex: 1,
    padding: theme.spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 60,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.accent + '40', // 25% opacity
    marginBottom: 20,
    shadowColor: theme.colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: theme.colors.text,
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.accent,
    letterSpacing: 2,
    marginTop: 4,
  },
  form: {
    width: '100%',
    maxWidth: 400,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.roundness,
    padding: theme.spacing.md,
    color: theme.colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.roundness,
    padding: theme.spacing.md,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: theme.colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: theme.colors.primary,
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1.5,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    fontSize: 10,
    color: theme.colors.textMuted,
    letterSpacing: 1,
  }
});
