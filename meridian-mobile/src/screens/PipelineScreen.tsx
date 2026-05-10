import React, { useState, useMemo } from 'react';
import { StyleSheet, View, Text, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getLicenses } from '../api';
import { useMeridianTheme, type AppTheme } from '../theme';
import { MiningLicense } from '../types';
import { ChevronRight, Box } from 'lucide-react-native';
import DossierModal from '../components/DossierModal';

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
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    iconContainer: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    headerText: {
      flex: 1,
    },
    company: {
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: '900',
      letterSpacing: 0.5,
    },
    licenseId: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
      marginTop: 2,
    },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      borderWidth: 1,
    },
    statusText: {
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 1,
    },
    cardBody: {
      paddingLeft: 52,
      marginBottom: 16,
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    label: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
    },
    value: {
      color: theme.colors.text,
      fontSize: 12,
      fontWeight: '700',
    },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingTop: 12,
      paddingLeft: 52,
    },
    footerText: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
    },
  });
}

export default function PipelineScreen() {
  const { theme } = useMeridianTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { data: licenses = [], isLoading } = useQuery({
    queryKey: ['licenses'],
    queryFn: getLicenses,
  });

  const [selectedItem, setSelectedItem] = useState<MiningLicense | null>(null);

  const renderItem = ({ item }: { item: MiningLicense }) => (
    <TouchableOpacity style={styles.card} onPress={() => setSelectedItem(item)}>
      <View style={styles.cardHeader}>
        <View style={styles.iconContainer}>
          <Box size={20} color={theme.colors.accent} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.company}>{item.company}</Text>
          <Text style={styles.licenseId}>ID: {item.id.substring(0, 8)}</Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            { borderColor: item.status === 'APPROVED' ? theme.colors.success : theme.colors.accent },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: item.status === 'APPROVED' ? theme.colors.success : theme.colors.accent },
            ]}
          >
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.infoRow}>
          <Text style={styles.label}>COMMODITY</Text>
          <Text style={styles.value}>{item.commodity}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.label}>REGION</Text>
          <Text style={styles.value}>
            {item.region}, {item.country}
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.footerText}>VIEW FULL INTELLIGENCE DOSSIER</Text>
        <ChevronRight size={16} color={theme.colors.textMuted} />
      </View>
    </TouchableOpacity>
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
        data={licenses}
        renderItem={renderItem}
        keyExtractor={(item: MiningLicense) => item.id}
        contentContainerStyle={styles.list}
      />
      <DossierModal item={selectedItem} isVisible={!!selectedItem} onClose={() => setSelectedItem(null)} />
    </View>
  );
}
