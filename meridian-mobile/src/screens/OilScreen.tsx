import React, { useMemo } from 'react';
import { StyleSheet, View, Text, FlatList, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getOilSummary } from '../api';
import { useMeridianTheme, type AppTheme } from '../theme';
import { OilTradeFlow } from '../types';
import { Droplets, ArrowUpRight, ArrowDownLeft } from 'lucide-react-native';

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
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
      alignItems: 'center',
      marginBottom: 24,
      marginTop: 12,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '900',
      color: theme.colors.text,
      letterSpacing: 2,
      marginTop: 12,
    },
    headerSubtitle: {
      fontSize: 10,
      color: theme.colors.textMuted,
      marginTop: 4,
      letterSpacing: 1,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    countryBadge: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: theme.colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    countryCode: {
      color: theme.colors.accent,
      fontWeight: '900',
      fontSize: 14,
    },
    headerText: {
      flex: 1,
    },
    countryName: {
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: '900',
    },
    category: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      marginTop: 2,
    },
    rankBadge: {
      backgroundColor: theme.colors.background,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
    },
    rankText: {
      color: theme.colors.text,
      fontSize: 12,
      fontWeight: '900',
    },
    valuesRow: {
      flexDirection: 'row',
      gap: 12,
    },
    valueBox: {
      flex: 1,
      backgroundColor: theme.colors.background,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    valueHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
    },
    valueLabel: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 1,
    },
    valueAmount: {
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: '900',
    },
  });
}

export default function OilScreen() {
  const { theme } = useMeridianTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { data, isLoading } = useQuery({
    queryKey: ['oil-summary'],
    queryFn: getOilSummary,
  });

  const flows = data?.flows || [];

  const renderItem = ({ item }: { item: OilTradeFlow }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.countryBadge}>
          <Text style={styles.countryCode}>{item.iso2}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.countryName}>{item.country}</Text>
          <Text style={styles.category}>{item.category.toUpperCase()} PETROLEUM</Text>
        </View>
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>#{item.rank}</Text>
        </View>
      </View>

      <View style={styles.valuesRow}>
        <View style={styles.valueBox}>
          <View style={styles.valueHeader}>
            <ArrowUpRight size={14} color={theme.colors.success} />
            <Text style={styles.valueLabel}>EXPORTS</Text>
          </View>
          <Text style={styles.valueAmount}>
            ${item.export_value_usd ? (item.export_value_usd / 1e9).toFixed(1) + 'B' : 'N/A'}
          </Text>
        </View>
        <View style={styles.valueBox}>
          <View style={styles.valueHeader}>
            <ArrowDownLeft size={14} color={theme.colors.error} />
            <Text style={styles.valueLabel}>IMPORTS</Text>
          </View>
          <Text style={styles.valueAmount}>
            ${item.import_value_usd ? (item.import_value_usd / 1e9).toFixed(1) + 'B' : 'N/A'}
          </Text>
        </View>
      </View>
    </View>
  );

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
        data={flows}
        renderItem={renderItem}
        keyExtractor={(item, index) => `${item.iso2}-${index}`}
        contentContainerStyle={styles.list}
        ListHeaderComponent={() => (
          <View style={styles.header}>
            <Droplets size={32} color={theme.colors.accent} />
            <Text style={styles.headerTitle}>GLOBAL TRADE FLOWS</Text>
            <Text style={styles.headerSubtitle}>Source: {data?.source || 'Loading...'}</Text>
          </View>
        )}
      />
    </View>
  );
}
