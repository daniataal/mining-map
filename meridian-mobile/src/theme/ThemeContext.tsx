import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  darkMapStyle,
  darkTheme,
  lightMapStyle,
  lightTheme,
  type AppTheme,
  type MeridianColorSchemePreference,
} from './tokens';
import type { MapStyleElement } from 'react-native-maps';

const STORAGE_KEY = 'meridian_theme_preference';

export type MeridianThemeContextValue = {
  theme: AppTheme;
  colorSchemePreference: MeridianColorSchemePreference;
  setColorSchemePreference: (next: MeridianColorSchemePreference) => Promise<void>;
  resolvedScheme: 'dark' | 'light';
  isDark: boolean;
  statusBarStyle: 'light' | 'dark';
  mapCustomStyle: MapStyleElement[];
};

const ThemeContext = createContext<MeridianThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<MeridianColorSchemePreference>('dark');

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (!alive) return;
      if (stored === 'dark' || stored === 'light' || stored === 'system') {
        setPreference(stored);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const setColorSchemePreference = useCallback(async (next: MeridianColorSchemePreference) => {
    setPreference(next);
    await AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const resolvedScheme: 'dark' | 'light' =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;

  const theme = resolvedScheme === 'dark' ? darkTheme : lightTheme;
  const isDark = resolvedScheme === 'dark';

  const value = useMemo<MeridianThemeContextValue>(
    () => ({
      theme,
      colorSchemePreference: preference,
      setColorSchemePreference,
      resolvedScheme,
      isDark,
      statusBarStyle: isDark ? 'light' : 'dark',
      mapCustomStyle: isDark ? darkMapStyle : lightMapStyle,
    }),
    [theme, preference, setColorSchemePreference, resolvedScheme, isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useMeridianTheme(): MeridianThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useMeridianTheme must be used within ThemeProvider');
  }
  return ctx;
}
