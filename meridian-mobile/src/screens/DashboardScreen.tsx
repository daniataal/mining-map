import React from 'react';
import { StyleSheet, View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getLicenses, getMarketTicker } from '../api';
import { theme } from '../theme';
import { TrendingUp, Users, Shield, Zap } from 'lucide-react-native';

export default function DashboardScreen() {
  const { data: licenses = [], isLoading: loadingLicenses } = useQuery({
    queryKey: ['licenses'],
    queryFn: getLicenses,
  });

  const { data: prices = [], isLoading: loadingPrices } = useQuery({
    queryKey: ['market-ticker'],
    queryFn: getMarketTicker,
  });

  const stats = [
    { label: 'TOTAL ASSETS', value: licenses.length, icon: Shield, color: '#3B82F6' },
    { label: 'OPERATIONAL', value: licenses.filter(l => l.status === 'Operating').length, icon: Zap, color: '#10B981' },
    { label: 'PENDING APPROVAL', value: licenses.filter(l => l.status === 'PENDING').length, icon: TrendingUp, color: theme.colors.accent },
  ];

  if (loadingLicenses || loadingPrices) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>REAL-TIME METRICS</Text>
      <View style={styles.statsGrid}>
        {stats.map((stat, idx) => (
          <View key={idx} style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: stat.color + '20' }]}>
              <stat.icon size={24} color={stat.color} />
            </View>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>GLOBAL MARKET TICKER</Text>
      <View style={styles.marketContainer}>
        {prices.map((price: any, idx: number) => (
          <View key={idx} style={styles.marketRow}>
            <Text style={styles.marketSymbol}>{price.symbol}</Text>
            <Text style={styles.marketPrice}>{price.price}</Text>
            <Text style={[styles.marketChange, { color: price.up ? theme.colors.success : theme.colors.error }]}>
              {price.change}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: theme.colors.accent,
    letterSpacing: 2,
    marginBottom: 16,
    marginTop: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  statIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '900',
    color: theme.colors.text,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.colors.textMuted,
    letterSpacing: 1,
    marginTop: 4,
  },
  marketContainer: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  marketRow: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    alignItems: 'center',
  },
  marketSymbol: {
    flex: 1,
    color: theme.colors.text,
    fontWeight: '900',
    fontSize: 14,
  },
  marketPrice: {
    color: theme.colors.text,
    fontWeight: '700',
    fontSize: 14,
    marginRight: 16,
  },
  marketChange: {
    fontWeight: '900',
    fontSize: 12,
    width: 60,
    textAlign: 'right',
  }
});
