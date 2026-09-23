import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppUpdateCard } from '@/components/AppUpdateCard';
import { PrimaryButton, SectionTitle, uiStyles } from '@/components/ControlUI';
import { useControlAuth } from '@/context/ControlAuth';
import { useServerControl } from '@/context/ServerContext';
import { useColors } from '@/hooks/useColors';

export default function ToolsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { apiBase, lock } = useControlAuth();
  const { servers, refresh, isLoading, lastAction, error } = useServerControl();
  const online = servers.filter((server) => server.status === 'online').length;

  const disconnect = () => {
    Alert.alert('Session trennen?', 'API-Schlüssel wird vom Gerät entfernt.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Trennen',
        style: 'destructive',
        onPress: () => {
          void lock().then(() => router.replace('/sign-in' as never));
        },
      },
    ]);
  };

  return (
    <View style={[uiStyles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[uiStyles.scroll, { paddingTop: insets.top + 16 }]}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.kicker, { color: colors.primary }]}>SESSION</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Control</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Direkte Verbindung zu Crafty über deine private Control-API.
            </Text>
          </View>
          <View style={[styles.toolboxIcon, { backgroundColor: colors.accent }]}>
            <Feather name="settings" size={20} color={colors.primary} />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Row label="API" value={apiBase || '—'} colors={colors} />
          <Row label="Nodes" value={`${online}/${servers.length} online`} colors={colors} />
          <Row label="Status" value={error ? 'Fehler' : 'Verbunden'} colors={colors} />
          {lastAction ? <Row label="Last action" value={lastAction.text} colors={colors} /> : null}
        </View>

        <AppUpdateCard />

        <SectionTitle title="Actions" eyebrow="DEVICE" />
        <View style={styles.actions}>
          <PrimaryButton icon="refresh-cw" label={isLoading ? 'Refreshing…' : 'Refresh servers'} disabled={isLoading} onPress={() => void refresh()} />
          <Pressable onPress={disconnect} style={({ pressed }) => [styles.danger, { borderColor: colors.destructive }, pressed && { opacity: 0.75 }]}>
            <Feather name="log-out" size={16} color={colors.destructive} />
            <Text style={[styles.dangerText, { color: colors.destructive }]}>Session trennen</Text>
          </Pressable>
        </View>

        <View style={[styles.hint, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Feather name="info" size={16} color={colors.primary} />
          <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
            Start/Stop/Restart und Logs findest du unter Servers → Server antippen. Console schickt Befehle an den ausgewählten Node.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: colors.foreground }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 2, marginBottom: 7 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 5, maxWidth: 260 },
  toolboxIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 12 },
  row: { gap: 4 },
  rowLabel: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  rowValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  actions: { gap: 10 },
  danger: {
    minHeight: 48,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  dangerText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  hint: { marginTop: 24, borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', gap: 10 },
  hintText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
});
