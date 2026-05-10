import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Dimensions, TextInput, Modal } from 'react-native';
import { Marker, Callout, PROVIDER_GOOGLE, Geojson } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';
import { useQuery } from '@tanstack/react-query';
import { getLicenses } from '../api';
import { theme } from '../theme';
import { MiningLicense } from '../types';
import { Search, Filter, Crosshair, X, Check } from 'lucide-react-native';
import DossierModal from '../components/DossierModal';
import { applyCollocationJitter } from '../lib/geo';

const COMMODITIES = ['All', 'Gold', 'Diamond', 'Bauxite', 'Lithium', 'Iron Ore'];

export default function MapScreen() {
  const { data: rawLicenses = [], isLoading, error: fetchError } = useQuery({
    queryKey: ['licenses'],
    queryFn: getLicenses,
  });

  const [geoJsonData, setGeoJsonData] = useState<any>(null);
  const [selectedItem, setSelectedItem] = useState<MiningLicense | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCommodity, setSelectedCommodity] = useState('All');
  const [isFilterVisible, setFilterVisible] = useState(false);

  const [mapRegion, setMapRegion] = useState({
    latitude: 7.9465, // Ghana
    longitude: -1.0232,
    latitudeDelta: 10,
    longitudeDelta: 10,
  });

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
      .then(res => res.json())
      .then(data => {
        const interested = ['ghana', 'togo', 'benin', 'cote d\'ivoire', 'burkina faso', 'nigeria'];
        const filtered = {
          ...data,
          features: data.features.filter((f: any) => {
            const name = (f.properties.ADMIN || f.properties.name || '').toLowerCase();
            return interested.some(country => name.includes(country));
          })
        };
        setGeoJsonData(filtered);
      })
      .catch(err => console.error("[MAP DEBUG] GeoJSON fetch failed:", err));
  }, []);

  const filteredLicenses = useMemo(() => {
    let result = rawLicenses;
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l => 
        l.company?.toLowerCase().includes(q) || 
        l.commodity?.toLowerCase().includes(q)
      );
    }

    if (selectedCommodity !== 'All') {
      result = result.filter(l => l.commodity?.toLowerCase().includes(selectedCommodity.toLowerCase()));
    }

    return applyCollocationJitter(result);
  }, [rawLicenses, searchQuery, selectedCommodity]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ClusteredMapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={mapRegion}
        customMapStyle={darkMapStyle}
        onRegionChangeComplete={setMapRegion}
        preserveClusterPressHierarchy={true}
        spiderLineColor={theme.colors.accent}
        radius={Dimensions.get('window').width * 0.12} // Responsive cluster radius
        extent={512}
        nodeSize={64}
        renderCluster={(cluster) => {
          const { id, pointCount, coordinate, onPress } = cluster;
          return (
            <Marker 
              key={`cluster-${id}`} 
              coordinate={coordinate} 
              onPress={onPress}
              tracksViewChanges={false}
            >
              <View style={styles.clusterWrapper}>
                <Text style={styles.clusterText}>{pointCount}</Text>
              </View>
            </Marker>
          );
        }}
      >
        {geoJsonData && (
          <Geojson 
            geojson={geoJsonData}
            strokeColor={theme.colors.accent + '99'} // Stronger Gold border
            fillColor={theme.colors.accent + '08'} 
            strokeWidth={2}
          />
        )}

        {filteredLicenses.map((item: any) => (
          <Marker
            key={item.id}
            coordinate={{ latitude: item._displayLat, longitude: item._displayLng }}
            pinColor={item.status === 'APPROVED' ? theme.colors.success : theme.colors.accent}
            onPress={() => setSelectedItem(item)}
            tracksViewChanges={false}
          >
            <Callout tooltip onPress={() => setSelectedItem(item)}>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{item.company}</Text>
                <Text style={styles.calloutSubtitle}>{item.commodity} | {item.status}</Text>
                {item._wasJittered && (
                   <Text style={styles.jitterText}>≈ Approx Location ({item._collocatedCount})</Text>
                )}
              </View>
            </Callout>
          </Marker>
        ))}
      </ClusteredMapView>

      <DossierModal 
        item={selectedItem} 
        isVisible={!!selectedItem} 
        onClose={() => setSelectedItem(null)} 
      />

      <View style={styles.topBar}>
        <View style={styles.searchBar}>
          <Search size={18} color={theme.colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search Tactical Intel..."
            placeholderTextColor={theme.colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          {searchQuery !== '' && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={16} color={theme.colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity 
          style={[styles.iconButton, selectedCommodity !== 'All' && { borderColor: theme.colors.accent }]}
          onPress={() => setFilterVisible(true)}
        >
          <Filter size={20} color={selectedCommodity !== 'All' ? theme.colors.accent : theme.colors.text} />
        </TouchableOpacity>
      </View>

      <Modal
        visible={isFilterVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setFilterVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.filterContent}>
            <View style={styles.filterHeader}>
              <Text style={styles.filterTitle}>FILTER TACTICAL DATA</Text>
              <TouchableOpacity onPress={() => setFilterVisible(false)}>
                <X size={24} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.filterLabel}>COMMODITY TYPE</Text>
            <View style={styles.chipContainer}>
              {COMMODITIES.map(c => (
                <TouchableOpacity 
                  key={c} 
                  style={[styles.chip, selectedCommodity === c && styles.chipActive]}
                  onPress={() => setSelectedCommodity(c)}
                >
                  <Text style={[styles.chipText, selectedCommodity === c && styles.chipTextActive]}>
                    {c.toUpperCase()}
                  </Text>
                  {selectedCommodity === c && <Check size={12} color={theme.colors.primary} style={{marginLeft: 4}} />}
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity 
              style={styles.applyBtn}
              onPress={() => setFilterVisible(false)}
            >
              <Text style={styles.applyBtnText}>APPLY FILTERS</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TouchableOpacity style={styles.fab}>
        <Crosshair size={24} color={theme.colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const darkMapStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#020617" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#94a3b8" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#020617" }] },
  { "featureType": "administrative", "elementType": "geometry", "stylers": [{ "color": "#1e293b" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#0f172a" }] },
  { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#334155" }] }
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  map: { width: Dimensions.get('window').width, height: Dimensions.get('window').height },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background },
  topBar: { position: 'absolute', top: 60, left: 20, right: 20, flexDirection: 'row', gap: 12 },
  searchBar: {
    flex: 1,
    height: 48,
    backgroundColor: theme.colors.surface + 'E6', 
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: '600' },
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
  clusterWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.primary,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  clusterText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  filterContent: { backgroundColor: theme.colors.background, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.colors.border },
  filterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  filterTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 2 },
  filterLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '900', marginBottom: 16, letterSpacing: 1 },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 30 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.border, flexDirection: 'row', alignItems: 'center' },
  chipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  chipText: { color: theme.colors.text, fontSize: 10, fontWeight: '800' },
  chipTextActive: { color: theme.colors.primary },
  applyBtn: { backgroundColor: theme.colors.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  applyBtnText: { color: theme.colors.primary, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  fab: { position: 'absolute', bottom: 30, right: 20, width: 56, height: 56, backgroundColor: theme.colors.accent, borderRadius: 28, justifyContent: 'center', alignItems: 'center', shadowColor: theme.colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  callout: { backgroundColor: theme.colors.surface, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, minWidth: 150 },
  calloutTitle: { color: theme.colors.text, fontWeight: '900', fontSize: 14 },
  calloutSubtitle: { color: theme.colors.accent, fontSize: 10, fontWeight: '700', marginTop: 4 },
  jitterText: { color: '#fbbf24', fontSize: 8, fontWeight: '800', marginTop: 4, fontStyle: 'italic' }
});
