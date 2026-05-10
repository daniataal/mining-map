import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityIndicator, View, StyleSheet, Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';

import MainNavigator from './src/navigation/MainNavigator';
import LoginScreen from './src/screens/LoginScreen';
import { theme } from './src/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes (matches web app)
      gcTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    checkLoginStatus();
    
    // Set Immersive Mode for Android
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
      NavigationBar.setBehaviorAsync('inset-touch'); // Allows swiping to show temporarily
    }
  }, []);

  const checkLoginStatus = async () => {
    const token = await SecureStore.getItemAsync('mining_token');
    setIsLoggedIn(!!token);
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
