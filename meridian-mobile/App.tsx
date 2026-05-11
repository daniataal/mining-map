import React, { useState, useEffect, useMemo } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, Theme as NavigationTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityIndicator, View, StyleSheet, Platform, AppState } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';

import MainNavigator from './src/navigation/MainNavigator';
import LoginScreen from './src/screens/LoginScreen';
import { ThemeProvider, useMeridianTheme } from './src/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

function AppContent() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const { theme, statusBarStyle, isDark } = useMeridianTheme();

  const navigationTheme = useMemo((): NavigationTheme => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.accent,
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.notification,
      },
    };
  }, [isDark, theme]);

  useEffect(() => {
    checkLoginStatus();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setStyle(isDark ? 'dark' : 'light');
      void NavigationBar.setVisibilityAsync('hidden');
    }
  }, [isDark]);

  /** Re-hide nav bar when the OS shows it (e.g. after overlay swipe) or when returning from background. */
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const hide = () => {
      NavigationBar.setStyle(isDark ? 'dark' : 'light');
      void NavigationBar.setVisibilityAsync('hidden');
    };
    hide();
    const visSub = NavigationBar.addVisibilityListener(({ visibility }) => {
      if (visibility === 'visible') hide();
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') hide();
    });
    return () => {
      visSub.remove();
      appSub.remove();
    };
  }, [isDark]);

  const checkLoginStatus = async () => {
    const token = await SecureStore.getItemAsync('mining_token');
    setIsLoggedIn(!!token);
  };

  if (isLoggedIn === null) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style={statusBarStyle} />
      {isLoggedIn ? (
        <MainNavigator />
      ) : (
        <LoginScreen onLoginSuccess={() => setIsLoggedIn(true)} />
      )}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
