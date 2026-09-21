import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useServerControl, type MinecraftServer } from '@/context/ServerContext';
import { MetricBar, PrimaryButton, SectionTitle, StatusDot, uiStyles } from '@/components/ControlUI';
import { useListHetznerDedicatedServers } from '@workspace/api-client-react';

export default function ServersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { servers, restartServer, isLoading, error, refresh } = useServerControl();
  const hostsQuery = useListHetznerDedicatedServers();
  const averageCpu = servers.length ? Math.round(servers.reduce((sum, server) => sum + server.cpu, 0) / servers.length) : 0;
  return (
    <View style={[uiStyles.screen, { backgroundColor: colors.background }]}>
      <ScrollView refreshControl={<RefreshControl refreshing={isLoading || hostsQuery.isRefetching} onRefresh={() => void Promise.all([refresh(), hostsQuery.refetch()])} tintColor={colors.primary} colors={[colors.primary]} />} contentContainerStyle={[uiStyles.scroll, { paddingTop: insets.top + 16 }]}>
        <View style={styles.header}><View><Text style={[styles.kicker, { color: colors.primary }]}>INFRASTRUCTURE</Text><Text style={[styles.title, { color: colors.foreground }]}>Your servers</Text><Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Live health and capacity at a glance.</Text></View><View style={[styles.countBadge, { backgroundColor: colors.accent }]}><Text style={[styles.countText, { color: colors.accentForeground }]}>{servers.length} nodes</Text></View></View>
        <View style={styles.summaryRow}><Summary label="Online" value={String(servers.filter((server) => server.status === 'online').length)} color={colors.success} /><Summary label="Players" value={String(servers.reduce((sum, server) => sum + server.players, 0))} color={colors.info} /><Summary label="Avg. CPU" value={`${averageCpu}%`} color={colors.warning} /></View>
        {error ? <View style={[styles.errorCard, { backgroundColor: colors.secondary, borderColor: colors.destructive }]}><Feather name="alert-circle" size={16} color={colors.destructive} /><Text style={[styles.errorText, { color: colors.foreground }]}>{error}</Text></View> : null}
        <SectionTitle title="All nodes" eyebrow="LIVE STATUS" />
        <View style={styles.list}>{servers.map((server) => <ServerDetail key={server.id} server={server} onOpen={() => router.push(`/server/${server.id}` as never)} onRestart={() => restartServer(server.id)} />)}</View>
        <SectionTitle title="Dedicated infrastructure" eyebrow="HETZNER ROBOT" />
        <View style={styles.list}>
          {(hostsQuery.data?.hosts ?? []).map((host) => (
            <View key={host.id} style={[styles.hetznerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.hetznerTop}><View style={[styles.hetznerMark, { backgroundColor: '#D22F2F' }]}><Text style={styles.hetznerMarkText}>H</Text></View><View style={{ flex: 1 }}><Text style={[styles.hetznerTitle, { color: colors.foreground }]}>{host.name}</Text><Text style={[styles.hetznerMeta, { color: colors.mutedForeground }]}>{host.product} · {host.datacenter}</Text></View><Feather name="shield" size={17} color={colors.success} /></View>
              <View style={[styles.hetznerRule, { backgroundColor: colors.border }]} />
              <View style={styles.hetznerBottom}><View><Text style={[styles.hetznerCost, { color: colors.foreground }]}>{host.serverIp}</Text><Text style={[styles.hetznerMeta, { color: colors.mutedForeground }]}>Traffic {host.traffic} · paid until {host.paidUntil}</Text></View><Text style={[styles.hetznerLink, { color: host.status === 'ready' ? colors.success : colors.warning }]}>{host.status.toUpperCase()}</Text></View>
            </View>
          ))}
          {hostsQuery.isError ? <View style={[styles.errorCard, { backgroundColor: colors.secondary, borderColor: colors.destructive }]}><Feather name="alert-circle" size={16} color={colors.destructive} /><Text style={[styles.errorText, { color: colors.foreground }]}>Hetzner Robot could not be reached.</Text></View> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Summary({ label, value, color }: { label: string; value: string; color: string }) {
  const colors = useColors();
  return <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.summaryDot, { backgroundColor: color }]} /><Text style={[styles.summaryValue, { color: colors.foreground }]}>{value}</Text><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text></View>;
}

function ServerDetail({ server, onRestart, onOpen }: { server: MinecraftServer; onRestart: () => void; onOpen: () => void }) {
  const colors = useColors();
  const statusLabel = server.status === 'online' ? 'Operational' : server.status === 'degraded' ? 'Needs attention' : server.status === 'restarting' ? 'Restarting…' : 'Offline';
  return <Pressable onPress={onOpen} style={({ pressed }) => [styles.serverCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.82 : 1 }]}><View style={styles.serverTop}><View style={[styles.nodeIcon, { backgroundColor: server.status === 'degraded' ? colors.secondary : colors.accent }]}><Feather name={server.tag === 'EDGE' ? 'shuffle' : 'box'} size={20} color={server.status === 'degraded' ? colors.warning : colors.primary} /></View><View style={{ flex: 1 }}><View style={styles.nameRow}><Text style={[styles.serverName, { color: colors.foreground }]}>{server.name}</Text><Text style={[styles.serverTag, { color: colors.mutedForeground }]}>{server.tag}</Text></View><View style={styles.statusRow}><StatusDot status={server.status} /><Text style={[styles.statusText, { color: server.status === 'degraded' ? colors.warning : colors.success }]}>{statusLabel}</Text></View></View><Pressable onPress={(event) => { event.stopPropagation(); onRestart(); }} hitSlop={10} style={({ pressed }) => [styles.restartButton, { backgroundColor: colors.secondary }, pressed && { opacity: 0.7 }]}><Feather name="rotate-cw" size={15} color={colors.foreground} /></Pressable></View><View style={styles.serverMetrics}><Metric label="CPU" value={server.cpu} color={server.cpu > 65 ? colors.warning : colors.primary} /><Metric label="RAM" value={server.ram} color={server.ram > 70 ? colors.warning : colors.info} /><Metric label="Disk" value={server.disk} color={colors.success} /></View><View style={styles.detailFooter}><Text style={[styles.footerText, { color: colors.mutedForeground }]}>{server.players}/{server.maxPlayers} players · {server.ip}</Text><Text style={[styles.footerText, { color: colors.mutedForeground }]}>Manage <Feather name="chevron-right" size={10} /></Text></View>{server.status === 'restarting' ? <View style={{ marginTop: 13 }}><PrimaryButton label="Restarting server…" disabled /></View> : null}</Pressable>;
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  const colors = useColors();
  return <View style={styles.metric}><View style={styles.metricHeader}><Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.foreground }]}>{value}%</Text></View><MetricBar value={value} color={color} /></View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 2, marginBottom: 7 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 5 },
  countBadge: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  countText: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  summaryRow: { flexDirection: 'row', gap: 8 },
  summaryCard: { flex: 1, minHeight: 86, borderRadius: 16, borderWidth: 1, padding: 12 },
  summaryDot: { width: 7, height: 7, borderRadius: 4, marginBottom: 11 },
  summaryValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  summaryLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 3 },
  list: { gap: 11 },
  errorCard: { flexDirection: 'row', gap: 9, alignItems: 'center', borderRadius: 15, borderWidth: 1, padding: 12, marginTop: 12 },
  errorText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16 },
  serverCard: { borderRadius: 21, borderWidth: 1, padding: 15 },
  serverTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  nodeIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  serverName: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  serverTag: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  statusText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  restartButton: { width: 35, height: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  serverMetrics: { flexDirection: 'row', gap: 12, marginTop: 18 },
  metric: { flex: 1 },
  metricHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  metricLabel: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 10 },
  detailFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  footerText: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  hetznerCard: { borderRadius: 20, borderWidth: 1, padding: 15, marginTop: 26 },
  hetznerTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  hetznerMark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hetznerMarkText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 20 },
  hetznerTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  hetznerMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
  hetznerRule: { height: 1, marginVertical: 14 },
  hetznerBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hetznerCost: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  hetznerLink: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
});
