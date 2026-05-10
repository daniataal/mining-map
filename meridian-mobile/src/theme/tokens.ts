import type { MapStyleElement } from 'react-native-maps';

export type MeridianColorSchemePreference = 'dark' | 'light' | 'system';

export type AppTheme = {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    success: string;
    error: string;
    border: string;
    card: string;
    notification: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  roundness: number;
};

const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

const roundness = 12;

export const darkTheme: AppTheme = {
  colors: {
    primary: '#0F172A',
    secondary: '#1E293B',
    accent: '#F59E0B',
    background: '#020617',
    surface: '#0F172A',
    text: '#F8FAFC',
    textMuted: '#94A3B8',
    success: '#10B981',
    error: '#EF4444',
    border: '#1E293B',
    card: '#1E293B',
    notification: '#F59E0B',
  },
  spacing,
  roundness,
};

export const lightTheme: AppTheme = {
  colors: {
    primary: '#0F172A',
    secondary: '#E2E8F0',
    accent: '#D97706',
    background: '#F8FAFC',
    surface: '#FFFFFF',
    text: '#0F172A',
    textMuted: '#64748B',
    success: '#059669',
    error: '#DC2626',
    border: '#E2E8F0',
    card: '#F1F5F9',
    notification: '#D97706',
  },
  spacing,
  roundness,
};

export const darkMapStyle: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#020617' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#020617' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#334155' }] },
];

export const lightMapStyle: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#eef2f6' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#334155' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f8fafc' }] },
  {
    featureType: 'administrative.country',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#94a3b8' }, { weight: 1 }],
  },
  { featureType: 'administrative.locality', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbeafe' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
];
