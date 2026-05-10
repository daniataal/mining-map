import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import MainNavigator from './src/navigation/MainNavigator';
import LoginScreen from './src/screens/LoginScreen';
import { theme } from './src/theme';

const queryClient = new QueryClient();

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    checkLoginStatus();
  }, []);

  const checkLoginStatus = async () => {
    const token = await SecureStore.getItemAsync('mining_token');
    setIsLoggedIn(!!token);
  };

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('mining_token');
    setIsLoggedIn(false);
  };

  if (isLoggedIn === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <StatusBar style="light" />
        {isLoggedIn ? (
          <MainNavigator />
        ) : (
          <LoginScreen onLoginSuccess={() => setIsLoggedIn(true)} />
        )}
      </NavigationContainer>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
