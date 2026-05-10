import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { theme } from '../theme';
import { MiningLicense } from '../types';
import { X, Shield, MapPin, Box, Calendar, Phone, User } from 'lucide-react-native';

interface DossierModalProps {
  item: MiningLicense | null;
  isVisible: boolean;
  onClose: () => void;
}

export default function DossierModal({ item, isVisible, onClose }: DossierModalProps) {
  if (!item) return null;

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Shield size={24} color={theme.colors.accent} />
              <Text style={styles.headerTitle}>INTELLIGENCE DOSSIER</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={24} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll}>
            <View style={styles.hero}>
              <Text style={styles.companyName}>{item.company}</Text>
              <View style={[styles.statusBadge, { borderColor: item.status === 'APPROVED' ? theme.colors.success : theme.colors.accent }]}>
                <Text style={[styles.statusText, { color: item.status === 'APPROVED' ? theme.colors.success : theme.colors.accent }]}>
                  {item.status.toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>GEOSPATIAL DATA</Text>
              <View style={styles.infoRow}>
                <MapPin size={18} color={theme.colors.accent} />
                <View>
                  <Text style={styles.infoLabel}>LOCATION</Text>
                  <Text style={styles.infoValue}>{item.region}, {item.country}</Text>
                  <Text style={styles.coords}>{item.lat.toFixed(4)}, {item.lng.toFixed(4)}</Text>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>OPERATIONAL ASSETS</Text>
              <View style={styles.grid}>
                <View style={styles.gridItem}>
                  <Box size={18} color={theme.colors.accent} />
                  <Text style={styles.infoLabel}>COMMODITY</Text>
                  <Text style={styles.infoValue}>{item.commodity}</Text>
                </View>
                <View style={styles.gridItem}>
                  <Calendar size={18} color={theme.colors.accent} />
                  <Text style={styles.infoLabel}>DATE ISSUED</Text>
                  <Text style={styles.infoValue}>{item.date || 'N/A'}</Text>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>CONTACT INTELLIGENCE</Text>
              <View style={styles.infoRow}>
                <User size={18} color={theme.colors.accent} />
                <View>
                  <Text style={styles.infoLabel}>CONTACT PERSON</Text>
                  <Text style={styles.infoValue}>{item.contactPerson || 'Classified'}</Text>
                </View>
              </View>
              <View style={[styles.infoRow, { marginTop: 16 }]}>
                <Phone size={18} color={theme.colors.accent} />
                <View>
                  <Text style={styles.infoLabel}>PHONE NUMBER</Text>
                  <Text style={styles.infoValue}>{item.phoneNumber || 'Classified'}</Text>
                </View>
              </View>
            </View>

            <TouchableOpacity style={styles.actionButton}>
              <Text style={styles.actionButtonText}>UPDATE INTELLIGENCE</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.9)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    height: '85%',
    borderTopWidth: 1,
    borderTopColor: theme.colors.accent + '40',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  closeButton: {
    padding: 4,
  },
  scroll: {
    padding: 24,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 32,
  },
  companyName: {
    fontSize: 28,
    fontWeight: '900',
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  section: {
    marginBottom: 32,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: theme.colors.accent,
    letterSpacing: 2,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  infoLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.colors.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  coords: {
    fontSize: 12,
    color: theme.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 4,
  },
  grid: {
    flexDirection: 'row',
    gap: 24,
  },
  gridItem: {
    flex: 1,
    gap: 12,
  },
  actionButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 40,
  },
  actionButtonText: {
    color: theme.colors.primary,
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1.5,
  }
});
