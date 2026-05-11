import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { importLicensesCsvText } from '../api';
import { useMeridianTheme, type AppTheme } from '../theme';

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    content: { padding: theme.spacing.md, paddingBottom: 48 },
    title: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 2,
      color: theme.colors.accent,
      marginBottom: 8,
    },
    body: { fontSize: 12, color: theme.colors.textMuted, lineHeight: 18, marginBottom: 16 },
    mono: {
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
      fontSize: 10,
      color: theme.colors.textMuted,
      marginBottom: 12,
    },
    input: {
      minHeight: 180,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      padding: 12,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
      fontSize: 12,
      textAlignVertical: 'top',
    },
    btn: {
      marginTop: 16,
      backgroundColor: theme.colors.accent,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    btnText: { color: theme.colors.background, fontWeight: '900', letterSpacing: 1 },
    errBox: {
      marginTop: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.error + '55',
      backgroundColor: theme.colors.error + '18',
    },
    errText: { color: theme.colors.error, fontSize: 11, lineHeight: 16 },
  });
}

export default function BulkImportScreen() {
  const { theme } = useMeridianTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const queryClient = useQueryClient();
  const [text, setText] = useState(
    'company,country,region,commodity,license_type,status,lat,lng,phone_number,contact_person\n',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onImport = async () => {
    const csv = text.trim();
    if (!csv || csv.split('\n').length < 2) {
      Alert.alert('Nothing to import', 'Add a header row and at least one data row.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { importedCount } = await importLicensesCsvText(csv);
      await queryClient.invalidateQueries({ queryKey: ['licenses'] });
      Alert.alert('Import complete', `${importedCount} license(s) added.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>CSV BULK IMPORT</Text>
      <Text style={styles.body}>
        Paste UTF-8 CSV with the same columns as the web template. Required: company, country, lat, lng. Import is
        all-or-nothing: any bad row cancels the whole paste. See LICENSE_BULK_IMPORT.md in the repo root.
      </Text>
      <Text style={styles.mono}>company,country,region,commodity,license_type,status,lat,lng,...</Text>
      <TextInput
        style={styles.input}
        multiline
        value={text}
        onChangeText={setText}
        placeholder="Paste CSV here…"
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {error && (
        <View style={styles.errBox}>
          <Text style={styles.errText}>{error}</Text>
        </View>
      )}
      <TouchableOpacity style={styles.btn} onPress={() => void onImport()} disabled={busy}>
        {busy ? <ActivityIndicator color={theme.colors.background} /> : <Text style={styles.btnText}>IMPORT</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}
