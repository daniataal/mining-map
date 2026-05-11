import React, { useMemo } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MapPin, LayoutGrid, PieChart, Droplets, Anchor, Settings } from 'lucide-react-native';
import { useMeridianTheme } from '../theme';
import { TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import MapScreen from '../screens/MapScreen';
import PipelineScreen from '../screens/PipelineScreen';
import DashboardScreen from '../screens/DashboardScreen';
import OilScreen from '../screens/OilScreen';
import LogisticsScreen from '../screens/LogisticsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BulkImportScreen from '../screens/BulkImportScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function TabNavigator() {
  const navigation = useNavigation<any>();
  const { theme } = useMeridianTheme();

  const tabScreenOptions = useMemo(
    () => ({
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ marginRight: 16 }}>
          <Settings size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>
      ),
      headerStyle: {
        backgroundColor: theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      headerTitleStyle: {
        color: theme.colors.text,
        fontWeight: '900' as const,
        letterSpacing: 2,
        fontSize: 16,
      },
      tabBarStyle: {
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        height: 70,
        paddingBottom: 12,
        paddingTop: 8,
      },
      tabBarActiveTintColor: theme.colors.accent,
      tabBarInactiveTintColor: theme.colors.textMuted,
      tabBarLabelStyle: {
        fontSize: 9,
        fontWeight: '800' as const,
        letterSpacing: 0.5,
      },
    }),
    [navigation, theme],
  );

  return (
    <Tab.Navigator screenOptions={tabScreenOptions}>
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          tabBarIcon: ({ color, size }) => <MapPin size={size} color={color} />,
          title: 'TACTICAL MAP',
        }}
      />
      <Tab.Screen
        name="Pipeline"
        component={PipelineScreen}
        options={{
          tabBarIcon: ({ color, size }) => <LayoutGrid size={size} color={color} />,
          title: 'INTEL PIPELINE',
        }}
      />
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({ color, size }) => <PieChart size={size} color={color} />,
          title: 'COMMAND CENTER',
        }}
      />
      <Tab.Screen
        name="Logistics"
        component={LogisticsScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Anchor size={size} color={color} />,
          title: 'LOGISTICS HUB',
        }}
      />
      <Tab.Screen
        name="Oil"
        component={OilScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Droplets size={size} color={color} />,
          title: 'PETROLEUM HUB',
        }}
      />
    </Tab.Navigator>
  );
}

export default function MainNavigator() {
  const { theme } = useMeridianTheme();

  const settingsOptions = useMemo(
    () => ({
      headerShown: true,
      title: 'SYSTEM CONFIG',
      headerStyle: { backgroundColor: theme.colors.surface },
      headerTitleStyle: { color: theme.colors.text, fontWeight: '900' as const, letterSpacing: 2 },
      headerTintColor: theme.colors.accent,
    }),
    [theme],
  );

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={settingsOptions} />
      <Stack.Screen
        name="BulkImport"
        component={BulkImportScreen}
        options={{
          headerShown: true,
          title: 'BULK IMPORT',
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTitleStyle: { color: theme.colors.text, fontWeight: '900' as const, letterSpacing: 2 },
          headerTintColor: theme.colors.accent,
        }}
      />
    </Stack.Navigator>
  );
}
