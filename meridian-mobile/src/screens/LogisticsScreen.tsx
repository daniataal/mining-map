import React from 'react';
import { StyleSheet, View, Text, FlatList, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getLicenses } from '../api';
import { theme } from '../theme';
import { Truck, MapPin, ArrowRight, Package, Check, X, Anchor } from 'lucide-react-native';

const STATUS_CONFIG: any = {
  planned:    { label: 'Planned',    color: theme.colors.textMuted,    icon: Package },
  'in-transit': { label: 'In Transit', color: '#3B82F6',    icon: Truck },
  delivered:  { label: 'Delivered',  color: theme.colors.success, icon: Check },
  cancelled:  { label: 'Cancelled',  color: theme.colors.error,         icon: X },
};

export default function LogisticsScreen() {
  // We'll use licenses as a proxy for deals for now, since real shipments 
  // are in localStorage on web. In a real app, these would come from the backend.
  const { data: licenses = [], isLoading } = useQuery({
    queryKey: ['licenses'],
    queryFn: getLicenses,
  });

  // Mock shipments for demo
  const mockShipments = licenses.slice(0, 5).map((l, idx) => ({
    id: `leg-${idx}`,
    dealLabel: l.company,
    origin: l.region + ', ' + l.country,
    destination: 'Dubai, UAE',
    status: idx % 4 === 0 ? 'delivered' : idx % 4 === 1 ? 'in-transit' : 'planned',
    incoterm: 'FOB',
    eta: '2024-06-15',
  }));

  const renderItem = ({ item }: { item: any }) => {
    const config = STATUS_CONFIG[item.status];
    const Icon = config.icon;

    return (
      <TouchableOpacity style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.dealLabel}>{item.dealLabel.toUpperCase()}</Text>
          <View style={[styles.badge, { backgroundColor: config.color + '20', borderColor: config.color }]}>
            <Icon size={12} color={config.color} />
            <Text style={[styles.badgeText, { color: config.color }]}>{config.label.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.routeRow}>
          <View style={styles.routePoint}>
            <MapPin size={14} color={theme.colors.textMuted} />
            <Text style={styles.routeText} numberOfLines={1}>{item.origin}</Text>
          </View>
          <ArrowRight size={16} color={theme.colors.accent} />
          <View style={styles.routePoint}>
            <MapPin size={14} color={theme.colors.accent} />
            <Text style={styles.routeText} numberOfLines={1}>{item.destination}</Text>
          </View>
        </View>

        <View style={styles.detailsRow}>
          <View style={styles.detail}>
            <Text style={styles.detailLabel}>INCOTERM</Text>
            <Text style={styles.detailValue}>{item.incoterm}</Text>
          </View>
          <View style={styles.detail}>
            <Text style={styles.detailLabel}>EST. ARRIVAL</Text>
            <Text style={styles.detailValue}>{item.eta}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={mockShipments}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={() => (
          <View style={styles.header}>
            <Anchor size={24} color={theme.colors.accent} />
            <Text style={styles.headerTitle}>LOGISTICS HUB</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  list: {
    padding: theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    paddingLeft: 4,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: theme.colors.text,
    letterSpacing: 2,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  dealLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: theme.colors.accent,
    letterSpacing: 1,
    flex: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  routePoint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  routeText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 12,
  },
  detail: {
    gap: 4,
  },
  detailLabel: {
    color: theme.colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  detailValue: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '700',
  }
});
