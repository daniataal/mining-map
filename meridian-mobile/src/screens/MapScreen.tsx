import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Callout } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { getLicenses } from '../api';
import { theme } from '../theme';
import { MiningLicense } from '../types';
import { Search, Filter, Crosshair } from 'lucide-react-native';
import DossierModal from '../components/DossierModal';

export default function MapScreen() {
  const { data: licenses = [], isLoading } = useQuery({
    queryKey: ['licenses'],
    queryFn: getLicenses,
  });

  const [selectedItem, setSelectedItem] = useState<MiningLicense | null>(null);

  const [mapRegion, setMapRegion] = useState({
    latitude: 7.9465, // Ghana
    longitude: -1.0232,
    latitudeDelta: 10,
    longitudeDelta: 10,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={mapRegion}
        customMapStyle={darkMapStyle}
      >
        {licenses.map((item: MiningLicense) => (
          <Marker
            key={item.id}
            coordinate={{ latitude: item.lat, longitude: item.lng }}
            pinColor={item.status === 'APPROVED' ? theme.colors.success : theme.colors.accent}
            onPress={() => setSelectedItem(item)}
          >
            <Callout tooltip onPress={() => setSelectedItem(item)}>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{item.company}</Text>
                <Text style={styles.calloutSubtitle}>{item.commodity} | {item.status}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      <DossierModal 
        item={selectedItem} 
        isVisible={!!selectedItem} 
        onClose={() => setSelectedItem(null)} 
      />

      {/* Floating UI Elements */}
      <View style={styles.topBar}>
        <View style={styles.searchBar}>
          <Search size={18} color={theme.colors.textMuted} />
          <Text style={styles.searchPlaceholder}>Search Tactical Intel...</Text>
        </View>
        <TouchableOpacity style={styles.iconButton}>
          <Filter size={20} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.fab}>
        <Crosshair size={24} color={theme.colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const darkMapStyle = [
  {
    "elementType": "geometry",
    "stylers": [{ "color": "#020617" }]
  },
  {
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#94a3b8" }]
  },
  {
    "elementType": "labels.text.stroke",
    "stylers": [{ "color": "#020617" }]
  },
  {
    "featureType": "administrative",
    "elementType": "geometry",
    "stylers": [{ "color": "#1e293b" }]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [{ "color": "#0f172a" }]
  },
  {
    "featureType": "water",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#334155" }]
  }
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  topBar: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    gap: 12,
  },
  searchBar: {
    flex: 1,
    height: 48,
    backgroundColor: theme.colors.surface + 'E6', // 90% opacity
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchPlaceholder: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  iconButton: {
    width: 48,
    height: 48,
    backgroundColor: theme.colors.surface + 'E6',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    width: 56,
    height: 56,
    backgroundColor: theme.colors.accent,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: theme.colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  callout: {
    backgroundColor: theme.colors.surface,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minWidth: 150,
  },
  calloutTitle: {
    color: theme.colors.text,
    fontWeight: '900',
    fontSize: 14,
  },
  calloutSubtitle: {
    color: theme.colors.accent,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
  }
});
