import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { getLicenses } from '../api';
import { useMeridianTheme, type AppTheme } from '../theme';
import { Truck, MapPin, ArrowRight, Package, Check, X, Anchor, Plus, Trash2 } from 'lucide-react-native';

const STORAGE_KEY = 'meridian_shipments';

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    list: {
      padding: theme.spacing.md,
      paddingTop: 60,
    },
    header: {
      marginBottom: 24,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '900',
      color: theme.colors.text,
      letterSpacing: 2,
    },
    addBtn: {
      backgroundColor: theme.colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: 12,
      gap: 8,
    },
    addBtnText: {
      color: theme.colors.primary,
      fontWeight: '900',
      fontSize: 12,
      letterSpacing: 1,
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
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
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
    deleteBtn: {
      padding: 4,
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
    },
    empty: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 100,
    },
    emptyText: {
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: '900',
      marginTop: 16,
      letterSpacing: 1,
    },
    emptySubtext: {
      color: theme.colors.textMuted,
      fontSize: 12,
      marginTop: 8,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.7)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
      maxHeight: '80%',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 24,
    },
    modalTitle: {
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: '900',
      letterSpacing: 2,
    },
    form: {
      gap: 16,
    },
    inputLabel: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '900',
      marginBottom: 8,
      letterSpacing: 1,
    },
    input: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      padding: 14,
      color: theme.colors.text,
      fontSize: 14,
      marginBottom: 16,
    },
    submitBtn: {
      backgroundColor: theme.colors.accent,
      paddingVertical: 16,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 16,
      marginBottom: 40,
    },
    submitBtnText: {
      color: theme.colors.primary,
      fontWeight: '900',
      fontSize: 14,
      letterSpacing: 1,
    },
  });
}

export default function LogisticsScreen() {
  const { theme } = useMeridianTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const statusConfig = useMemo(
    () => ({
      planned: { label: 'Planned', color: theme.colors.textMuted, icon: Package },
      'in-transit': { label: 'In Transit', color: '#3B82F6', icon: Truck },
      delivered: { label: 'Delivered', color: theme.colors.success, icon: Check },
      cancelled: { label: 'Cancelled', color: theme.colors.error, icon: X },
    }),
    [theme],
  );

  const [shipments, setShipments] = useState<any[]>([]);
  const [isModalVisible, setModalVisible] = useState(false);
  const [newShipment, setNewShipment] = useState({
    dealLabel: '',
    origin: '',
    destination: '',
    status: 'planned',
    incoterm: 'FOB',
    eta: '',
  });

  useQuery({
    queryKey: ['licenses'],
    queryFn: getLicenses,
  });

  useEffect(() => {
    loadShipments();
  }, []);

  const loadShipments = async () => {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (stored) {
      setShipments(JSON.parse(stored));
    }
  };

  const saveShipments = async (updated: any[]) => {
    setShipments(updated);
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(updated));
  };

  const handleAddShipment = () => {
    if (!newShipment.origin || !newShipment.destination || !newShipment.dealLabel) {
      Alert.alert('Missing Fields', 'Please fill in Company, Origin, and Destination.');
      return;
    }
    const shipment = {
      ...newShipment,
      id: `ship-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    saveShipments([shipment, ...shipments]);
    setModalVisible(false);
    setNewShipment({
      dealLabel: '',
      origin: '',
      destination: '',
      status: 'planned',
      incoterm: 'FOB',
      eta: '',
    });
  };

  const handleDeleteShipment = (id: string) => {
    Alert.alert('Delete Shipment', 'Are you sure you want to delete this shipment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          saveShipments(shipments.filter((s) => s.id !== id));
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: any }) => {
    const config = statusConfig[item.status as keyof typeof statusConfig] || statusConfig.planned;
    const Icon = config.icon;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.dealLabel}>{item.dealLabel.toUpperCase()}</Text>
          <View style={styles.headerActions}>
            <View style={[styles.badge, { backgroundColor: config.color + '20', borderColor: config.color }]}>
              <Icon size={12} color={config.color} />
              <Text style={[styles.badgeText, { color: config.color }]}>{config.label.toUpperCase()}</Text>
            </View>
            <TouchableOpacity onPress={() => handleDeleteShipment(item.id)} style={styles.deleteBtn}>
              <Trash2 size={16} color={theme.colors.error} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.routeRow}>
          <View style={styles.routePoint}>
            <MapPin size={14} color={theme.colors.textMuted} />
            <Text style={styles.routeText} numberOfLines={1}>
              {item.origin}
            </Text>
          </View>
          <ArrowRight size={16} color={theme.colors.accent} />
          <View style={styles.routePoint}>
            <MapPin size={14} color={theme.colors.accent} />
            <Text style={styles.routeText} numberOfLines={1}>
              {item.destination}
            </Text>
          </View>
        </View>

        <View style={styles.detailsRow}>
          <View style={styles.detail}>
            <Text style={styles.detailLabel}>INCOTERM</Text>
            <Text style={styles.detailValue}>{item.incoterm}</Text>
          </View>
          <View style={styles.detail}>
            <Text style={styles.detailLabel}>EST. ARRIVAL</Text>
            <Text style={styles.detailValue}>{item.eta || 'N/A'}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={shipments}
        renderItem={renderItem}
        keyExtractor={(item: { id: string }) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={() => (
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Anchor size={24} color={theme.colors.accent} />
              <Text style={styles.headerTitle}>LOGISTICS HUB</Text>
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
              <Plus size={20} color={theme.colors.primary} />
              <Text style={styles.addBtnText}>NEW SHIPMENT</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Truck size={48} color={theme.colors.textMuted} opacity={0.3} />
            <Text style={styles.emptyText}>No Active Shipments Found</Text>
            <Text style={styles.emptySubtext}>Tap &quot;New Shipment&quot; to start tracking</Text>
          </View>
        )}
      />

      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>NEW TACTICAL SHIPMENT</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color={theme.colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.form}>
              <Text style={styles.inputLabel}>COMPANY / DEAL LABEL</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Ashanti Gold Corp"
                placeholderTextColor={theme.colors.textMuted}
                value={newShipment.dealLabel}
                onChangeText={(val: string) => setNewShipment({ ...newShipment, dealLabel: val })}
              />

              <Text style={styles.inputLabel}>ORIGIN</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Accra, Ghana"
                placeholderTextColor={theme.colors.textMuted}
                value={newShipment.origin}
                onChangeText={(val: string) => setNewShipment({ ...newShipment, origin: val })}
              />

              <Text style={styles.inputLabel}>DESTINATION</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Dubai, UAE"
                placeholderTextColor={theme.colors.textMuted}
                value={newShipment.destination}
                onChangeText={(val: string) => setNewShipment({ ...newShipment, destination: val })}
              />

              <Text style={styles.inputLabel}>ETA (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                placeholder="2024-12-31"
                placeholderTextColor={theme.colors.textMuted}
                value={newShipment.eta}
                onChangeText={(val: string) => setNewShipment({ ...newShipment, eta: val })}
              />

              <TouchableOpacity style={styles.submitBtn} onPress={handleAddShipment}>
                <Text style={styles.submitBtnText}>CONFIRM LOGISTICS LEG</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
