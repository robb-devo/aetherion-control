import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useControlAuth } from '@/context/ControlAuth';
import { useServerControl } from '@/context/ServerContext';
import { CrystalWaveHeader } from '@/components/CrystalWaveHeader';
import { NameEditorModal } from '@/components/NameEditorModal';
import { MetricBar, SectionTitle, StatusDot, uiStyles } from '@/components/ControlUI';

export default function OverviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { displayName, setDisplayName } = useControlAuth();
  const { servers, lines, lastAction, restartProxy, backupNow, isLoading, error, refresh } = useServerControl();
  const [nameOpen, setNameOpen] = useState(false);
  const online = servers.filter((server) => server.status === 'online').length;
  const totalPlayers = servers.reduce((sum, server) => sum + server.players, 0);
  const averageCpu = servers.length ? Math.round(servers.reduce((sum, server) => sum + server.cpu, 0) / servers.length) : 0;
  const operational = !error && servers.length > 0 && online === servers.length;

  return (
          <View style={[uiStyles.screen, { backgroundColor: colors.background }]}>
        <ScrollView
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => void refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
          contentContainerStyle={[uiStyles.scroll, { paddingTop: 0, paddingBottom: insets.bottom + 112 }]}
        >
          <CrystalWaveHeader name={displayName} onEditName={() => setNameOpen(true)} />

          <LinearGradient colors={['#2C1747', '#11101B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.livePill}>
                <StatusDot status={operational ? 'online' : error ? 'offline' : 'degraded'} />
                <Text style={styles.liveText}>
                  {isLoading ? 'SYNCING WITH CRAFTY' : operational ? 'ALL SYSTEMS OPERATIONAL' : error ? 'CRAFTY CONNECTION ISSUE' : 'SYSTEMS NEED ATTENTION'}
                </Text>
              </View>
              <Feather name="activity" size={20} color="#D7B8FF" />
            </View>
            <Text style={styles.heroTitle}>{isLoading && !servers.length ? 'Loading live systems…' : `${online}/${servers.length} systems online`}</Text>
            <Text style={styles.heroSubtitle}>{error ?? `${totalPlayers} players currently on the network.`}</Text>
            <View style={styles.heroRule} />
            <View style={styles.heroMetrics}>
              <View>
                <Text style={styles.heroMetricValue}>{servers.length}</Text>
                <Text style={styles.heroMetricLabel}>Crafty servers</Text>
              </View>
              <View>
                <Text style={styles.heroMetricValue}>{totalPlayers}</Text>
                <Text style={styles.heroMetricLabel}>Online players</Text>
              </View>
              <View>
                <Text style={styles.heroMetricValue}>{averageCpu}%</Text>
                <Text style={styles.heroMetricLabel}>Average CPU</Text>
              </View>
            </View>
          </LinearGradient>

          {lastAction ? (
            <Pressable onPress={() => undefined} style={[styles.toast, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Feather name="check-circle" size={16} color={colors.success} />
              <Text style={[styles.toastText, { color: colors.foreground }]}>{lastAction}</Text>
            </Pressable>
          ) : null}

          <SectionTitle title="Quick actions" eyebrow="CONTROL" />
          <View style={styles.quickGrid}>
            <QuickAction icon="terminal" label="Open console" color={colors.info} onPress={() => router.push('/console')} />
            <QuickAction icon="rotate-cw" label="Restart proxy" color={colors.warning} onPress={restartProxy} />
            <QuickAction icon="radio" label="Broadcast" color={colors.primary} onPress={() => router.push('/console')} />
            <QuickAction icon="archive" label="Backup now" color={colors.success} onPress={backupNow} />
          </View>

          <SectionTitle title="Your servers" eyebrow="INFRASTRUCTURE" action="View all" onAction={() => router.push('/servers')} />
          <View style={styles.serverList}>
            {servers.slice(0, 3).map((server) => (
              <Pressable
                key={server.id}
                onPress={() => router.push('/servers')}
                style={({ pressed }) => [styles.serverRow, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.78 }]}
              >
                <View style={[styles.serverIcon, { backgroundColor: server.status === 'degraded' ? '#3A3020' : colors.accent }]}>
                  <Feather name={server.tag === 'EDGE' ? 'shuffle' : 'box'} size={18} color={server.status === 'degraded' ? colors.warning : colors.primary} />
                </View>
                <View style={styles.serverInfo}>
                  <View style={styles.serverNameLine}>
                    <Text style={[styles.serverName, { color: colors.foreground }]}>{server.name}</Text>
                    <StatusDot status={server.status} />
                  </View>
                  <Text style={[styles.serverMeta, { color: colors.mutedForeground }]}>
                    {server.players}/{server.maxPlayers} players ? {server.uptime} uptime
                  </Text>
                  <MetricBar value={server.cpu} color={server.status === 'degraded' ? colors.warning : colors.primary} />
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
            {!isLoading && servers.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No Crafty servers were returned.</Text>
            ) : null}
          </View>

          <SectionTitle title="Recent activity" eyebrow="TIMELINE" />
          <View style={[styles.activityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {lines.slice(0, 3).map((line) => (
              <Activity
                key={line.id}
                icon={line.tone === 'warning' ? 'alert-triangle' : line.tone === 'error' ? 'x-circle' : line.tone === 'success' ? 'check' : 'terminal'}
                title={line.text}
                meta="Crafty Controller"
                time={line.time}
                color={line.tone === 'warning' ? colors.warning : line.tone === 'error' ? colors.destructive : line.tone === 'success' ? colors.success : colors.info}
              />
            ))}
          </View>
        </ScrollView>

        <NameEditorModal
          visible={nameOpen}
          initialName={displayName}
          onClose={() => setNameOpen(false)}
          onSave={(name) => void setDisplayName(name)}
        />
      </View>
  );
}

function QuickAction({ icon, label, color, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; color: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickAction, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.75 }]}>
      <View style={[styles.quickIcon, { backgroundColor: `${color}20` }]}>
        <Feather name={icon} size={18} color={color} />
      </View>
      <Text style={[styles.quickLabel, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

function Activity({ icon, title, meta, time, color }: { icon: keyof typeof Feather.glyphMap; title: string; meta: string; time: string; color: string }) {
  const colors = useColors();
  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityIcon, { backgroundColor: `${color}18` }]}>
        <Feather name={icon} size={14} color={color} />
      </View>
      <View style={styles.activityCopy}>
        <Text style={[styles.activityTitle, { color: colors.foreground }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.activityMeta, { color: colors.mutedForeground }]}>{meta}</Text>
      </View>
      <Text style={[styles.activityTime, { color: colors.mutedForeground }]}>{time}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 24, padding: 19, minHeight: 190 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  livePill: { flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: 'rgba(143,240,214,0.12)', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7 },
  liveText: { color: '#8FF0D6', fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.7 },
  heroTitle: { color: '#F5F7FA', fontFamily: 'Inter_700Bold', fontSize: 26, marginTop: 22, letterSpacing: -0.7 },
  heroSubtitle: { color: '#B7CDC8', fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 5 },
  heroRule: { height: 1, backgroundColor: 'rgba(183,243,74,0.16)', marginVertical: 18 },
  heroMetrics: { flexDirection: 'row', justifyContent: 'space-between' },
  heroMetricValue: { color: '#F5F7FA', fontFamily: 'Inter_700Bold', fontSize: 14 },
  heroMetricLabel: { color: '#8BA39D', fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 4 },
  toast: { flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: 1, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 14, marginTop: 14 },
  toastText: { fontFamily: 'Inter_500Medium', fontSize: 12, flex: 1 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickAction: { width: '48%', minHeight: 78, borderRadius: 17, borderWidth: 1, padding: 12, justifyContent: 'space-between' },
  quickIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  serverList: { gap: 9 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', paddingVertical: 24 },
  serverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 13 },
  serverIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  serverInfo: { flex: 1, gap: 5 },
  serverNameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  serverName: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  serverMeta: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  activityCard: { borderRadius: 18, borderWidth: 1, padding: 15, gap: 16 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  activityIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  activityCopy: { flex: 1 },
  activityTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  activityMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
  activityTime: { fontFamily: 'Inter_500Medium', fontSize: 11 },
});
