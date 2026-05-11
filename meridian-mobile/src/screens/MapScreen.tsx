import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  TextInput,
  Modal,
  ScrollView,
  Platform,
} from 'react-native';
import { Marker, Callout, PROVIDER_GOOGLE, Geojson } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';
import { useQuery } from '@tanstack/react-query';
import { getLicenses } from '../api';
import { useMeridianTheme, type AppTheme } from '../theme';
import { MiningLicense } from '../types';
import { Search, Filter, Crosshair, X, Check } from 'lucide-react-native';
import DossierModal from '../components/DossierModal';
import { applyCollocationJitter, type JitteredLicense } from '../lib/geo';

function normalizeLabel(val: string | undefined): string {
  const v = (val || 'Unknown').trim();
  return v
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    map: { width: Dimensions.get('window').width, height: Dimensions.get('window').height },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.background,
    },
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
    filterContent: {
      backgroundColor: theme.colors.background,
      borderRadius: 24,
      padding: 24,
      borderWidth: 1,
      borderColor: theme.colors.border,
      maxHeight: Dimensions.get('window').height * 0.85,
    },
    filterScroll: { flexGrow: 0 },
    filterFooter: { flexDirection: 'row', gap: 12, marginTop: 8 },
    resetBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    resetBtnText: { color: theme.colors.textMuted, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
    filterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    filterTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 2 },
    filterLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '900', marginBottom: 8, letterSpacing: 1 },
    filterHint: { color: theme.colors.textMuted, fontSize: 9, fontWeight: '600', marginBottom: 12, opacity: 0.85 },
    chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.colors.border,
      flexDirection: 'row',
      alignItems: 'center',
    },
    chipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    chipText: { color: theme.colors.text, fontSize: 10, fontWeight: '800' },
    chipTextActive: { color: theme.colors.primary },
    applyBtn: { backgroundColor: theme.colors.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
    applyBtnText: { color: theme.colors.primary, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
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
    calloutTitle: { color: theme.colors.text, fontWeight: '900', fontSize: 14 },
    calloutSubtitle: { color: theme.colors.accent, fontSize: 10, fontWeight: '700', marginTop: 4 },
    jitterText: { color: theme.colors.accent, fontSize: 8, fontWeight: '800', marginTop: 4, fontStyle: 'italic' },
  });
}

export default function MapScreen() {
  const { theme, mapCustomStyle } = useMeridianTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { data: rawLicenses = [], isLoading } = useQuery({
    queryKey: ['licenses'],
    queryFn: getLicenses,
  });

  const [geoJsonSource, setGeoJsonSource] = useState<any>(null);
  const [selectedItem, setSelectedItem] = useState<MiningLicense | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCommodities, setSelectedCommodities] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedLicenseTypes, setSelectedLicenseTypes] = useState<string[]>([]);
  const [isFilterVisible, setFilterVisible] = useState(false);

  const [mapRegion, setMapRegion] = useState({
    latitude: 7.9465,
    longitude: -1.0232,
    latitudeDelta: 10,
    longitudeDelta: 10,
  });

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
      .then((res) => res.json())
      .then(setGeoJsonSource)
      .catch((err) => console.error('[MAP DEBUG] GeoJSON fetch failed:', err));
  }, []);

  const activeCountries = useMemo(() => {
    const countries = new Set(rawLicenses.map((d) => (d.country ? d.country.toLowerCase() : 'ghana')));
    return Array.from(countries);
  }, [rawLicenses]);

  const filteredGeoJson = useMemo(() => {
    if (!geoJsonSource) return null;
    return {
      ...geoJsonSource,
      features: geoJsonSource.features.filter((f: any) => {
        const name = (f.properties.ADMIN || f.properties.name || '').toLowerCase();
        return activeCountries.some((ac) => name.includes(ac) || (ac === 'ghana' && name === 'ghana'));
      }),
    };
  }, [geoJsonSource, activeCountries]);

  const commodityOptions = useMemo(() => {
    const c = new Set(rawLicenses.map((item) => normalizeLabel(item.commodity)));
    return Array.from(c).sort();
  }, [rawLicenses]);

  const countryOptions = useMemo(() => {
    const c = new Set(rawLicenses.map((item) => item.country || 'Ghana'));
    return Array.from(c).sort();
  }, [rawLicenses]);

  const licenseTypeOptions = useMemo(() => {
    const t = new Set(rawLicenses.map((item) => normalizeLabel(item.licenseType)));
    return Array.from(t).sort();
  }, [rawLicenses]);

  const toggleInList = (list: string[], setList: (v: string[]) => void, value: string) => {
    if (list.includes(value)) setList(list.filter((x) => x !== value));
    else setList([...list, value]);
  };

  const filterActiveCount =
    selectedCommodities.length + selectedCountries.length + selectedLicenseTypes.length;

  const filteredLicenses = useMemo(() => {
    let result = rawLicenses;

    if (selectedCountries.length > 0) {
      result = result.filter((l) => selectedCountries.includes(l.country || 'Ghana'));
    }

    if (selectedCommodities.length > 0) {
      result = result.filter((l) => {
        const normalized = normalizeLabel(l.commodity);
        return selectedCommodities.includes(normalized);
      });
    }

    if (selectedLicenseTypes.length > 0) {
      result = result.filter((l) => {
        const normalized = normalizeLabel(l.licenseType);
        return selectedLicenseTypes.includes(normalized);
      });
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (l) =>
          (l.company && l.company.toLowerCase().includes(q)) ||
          (l.commodity && l.commodity.toLowerCase().includes(q)) ||
          (l.licenseType && l.licenseType.toLowerCase().includes(q)) ||
          (l.region && l.region.toLowerCase().includes(q)) ||
          (l.country && l.country.toLowerCase().includes(q)),
      );
    }

    const jittered = applyCollocationJitter(result);
    return jittered.filter(
      (item) =>
        item._displayLat != null &&
        item._displayLng != null &&
        !isNaN(item._displayLat) &&
        !isNaN(item._displayLng),
    );
  }, [rawLicenses, searchQuery, selectedCommodities, selectedCountries, selectedLicenseTypes]);

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
        customMapStyle={mapCustomStyle}
        onRegionChangeComplete={setMapRegion}
        spiderLineColor={theme.colors.accent}
        radius={70}
        extent={256}
        nodeSize={32}
        renderCluster={(cluster: {
          geometry?: { coordinates?: [number, number] };
          properties?: { point_count?: number; cluster_id?: number };
          onPress?: () => void;
        }) => {
          const { geometry, properties, onPress } = cluster;
          const coords = geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          const [longitude, latitude] = coords;
          if (
            typeof latitude !== 'number' ||
            typeof longitude !== 'number' ||
            isNaN(latitude) ||
            isNaN(longitude)
          ) {
            return null;
          }
          const pointCount = properties?.point_count ?? 0;
          const clusterId = properties?.cluster_id ?? `${longitude},${latitude},${pointCount}`;

          return (
            <Marker
              key={`cluster-${clusterId}`}
              coordinate={{ latitude, longitude }}
              onPress={onPress}
              tracksViewChanges={Platform.OS === 'android'}
            >
              <View style={styles.clusterWrapper}>
                <Text style={styles.clusterText}>{pointCount}</Text>
              </View>
            </Marker>
          );
        }}
      >
        {filteredGeoJson && filteredGeoJson.features?.length > 0 && (
          <Geojson
            geojson={filteredGeoJson}
            strokeColor={theme.colors.accent + '99'}
            fillColor={theme.colors.accent + '08'}
            strokeWidth={2}
          />
        )}

        {filteredLicenses.map((item: JitteredLicense, index: number) => (
          <Marker
            key={`${item.id}:${index}`}
            coordinate={{ latitude: item._displayLat, longitude: item._displayLng }}
            pinColor={item.status === 'APPROVED' ? theme.colors.success : theme.colors.accent}
            onPress={() => setSelectedItem(item)}
            tracksViewChanges={false}
          >
            <Callout tooltip onPress={() => setSelectedItem(item)}>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{item.company}</Text>
                <Text style={styles.calloutSubtitle}>
                  {item.commodity} | {item.status}
                </Text>
                {item._wasJittered && (
                  <Text style={styles.jitterText}>≈ Approx Location ({item._collocatedCount})</Text>
                )}
              </View>
            </Callout>
          </Marker>
        ))}
      </ClusteredMapView>

      <DossierModal item={selectedItem} isVisible={!!selectedItem} onClose={() => setSelectedItem(null)} />

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
          style={[styles.iconButton, filterActiveCount > 0 && { borderColor: theme.colors.accent }]}
          onPress={() => setFilterVisible(true)}
        >
          <Filter size={20} color={filterActiveCount > 0 ? theme.colors.accent : theme.colors.text} />
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

            <ScrollView style={styles.filterScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.filterLabel}>COMMODITY TYPE</Text>
              <Text style={styles.filterHint}>Tap to include; empty = all commodities</Text>
              <View style={styles.chipContainer}>
                {commodityOptions.map((c) => {
                  const active = selectedCommodities.includes(c);
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => toggleInList(selectedCommodities, setSelectedCommodities, c)}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.toUpperCase()}</Text>
                      {active && <Check size={12} color={theme.colors.primary} style={{ marginLeft: 4 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.filterLabel}>COUNTRY</Text>
              <Text style={styles.filterHint}>Empty = all countries</Text>
              <View style={styles.chipContainer}>
                {countryOptions.map((c) => {
                  const active = selectedCountries.includes(c);
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => toggleInList(selectedCountries, setSelectedCountries, c)}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.toUpperCase()}</Text>
                      {active && <Check size={12} color={theme.colors.primary} style={{ marginLeft: 4 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.filterLabel}>LICENSE CLASS</Text>
              <Text style={styles.filterHint}>Empty = all types</Text>
              <View style={styles.chipContainer}>
                {licenseTypeOptions.map((c) => {
                  const active = selectedLicenseTypes.includes(c);
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => toggleInList(selectedLicenseTypes, setSelectedLicenseTypes, c)}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.toUpperCase()}</Text>
                      {active && <Check size={12} color={theme.colors.primary} style={{ marginLeft: 4 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={styles.filterFooter}>
              <TouchableOpacity
                style={styles.resetBtn}
                onPress={() => {
                  setSelectedCommodities([]);
                  setSelectedCountries([]);
                  setSelectedLicenseTypes([]);
                }}
              >
                <Text style={styles.resetBtnText}>RESET</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={() => setFilterVisible(false)}>
                <Text style={styles.applyBtnText}>APPLY FILTERS</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <TouchableOpacity style={styles.fab}>
        <Crosshair size={24} color={theme.colors.primary} />
      </TouchableOpacity>
    </View>
  );
}
