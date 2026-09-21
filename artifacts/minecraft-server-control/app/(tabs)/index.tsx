import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppUpdate } from '@/context/AppUpdate';
import { useServerControl } from '@/context/ServerContext';
import { MetricBar, SectionTitle, StatusDot, uiStyles } from '@/components/ControlUI';
import { findEdgeServer, formatPercent, summarizeServers } from '@/lib/liveServers';

export default function OverviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { servers, lines, lastAction, restartServer, backupServer, isLoading, error, refresh, syncedAt, consoleTargetId, clearAction } = useServerControl();
  const update = useAppUpdate();
  const summary = summarizeServers(servers);
  const waitingForFirstSync = isLoading && servers.length === 0;
  const operational = !error && summary.count > 0 && summary.online === summary.count && !summary.partial && !summary.stale;
  const updateReady = update.phase.kind === 'ready' && update.phase.decision.kind === 'update';
  const pill = waitingForFirstSync
    ? 'SYNCING WITH CRAFTY'
    : error
      ? 'CRAFTY CONNECTION ISSUE'
      : summary.stale
        ? 'CACHED SERVER STATS'
        : operational
          ? 'ALL SYSTEMS OPERATIONAL'
          : summary.partial
            ? 'STATS INCOMPLETE'
            : 'SYSTEMS NEED ATTENTION';
  const heroDetail = error
    ? `${error}${syncedAt ? ` Last confirmed ${clock(syncedAt)}.` : ''}`
    : summary.players == null
      ? 'Crafty has not reported player counts.'
      : summary.partial
        ? `${summary.players} Spieler gemeldet. Für einige Server fehlen Stats.`
        : `${summary.players} Spieler sind gerade im Netzwerk.`;

  return (
    <View style={[uiStyles.screen, { backgroundColor: colors.background }]}>
      <ScrollView refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => void refresh()} tintColor={colors.primary} colors={[colors.primary]} />} contentContainerStyle={[uiStyles.scroll, { paddingTop: insets.top + 16 }]}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.kicker, { color: colors.primary }]}>AETHERION</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Command center</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Dein Netzwerk auf einen Blick.</Text>
          </View>
          <View style={[styles.avatar, { backgroundColor: colors.accent, borderColor: colors.border }]}><Text style={[styles.avatarText, { color: colors.accentForeground }]}>MC</Text></View>
        </View>

        <LinearGradient colors={['#2C1747', '#11101B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.livePill}><StatusDot status={operational ? 'online' : error ? 'offline' : summary.stale || summary.partial ? 'unknown' : 'offline'} /><Text style={styles.liveText}>{pill}</Text></View>
            <Feather name="activity" size={20} color="#D7B8FF" />
          </View>
          <Text style={styles.heroTitle}>{waitingForFirstSync ? 'Loading live systems…' : `${summary.online}/${summary.count} systems online`}</Text>
          <Text style={styles.heroSubtitle}>{heroDetail}</Text>
          <View style={styles.heroRule} />
          <View style={styles.heroMetrics}>
            <View><Text style={styles.heroMetricValue}>{summary.count}</Text><Text style={styles.heroMetricLabel}>Crafty servers</Text></View>
            <View><Text style={styles.heroMetricValue}>{summary.players ?? '—'}</Text><Text style={styles.heroMetricLabel}>Reported players</Text></View>
            <View><Text style={styles.heroMetricValue}>{formatPercent(summary.averageCpu)}</Text><Text style={styles.heroMetricLabel}>Average CPU</Text></View>
          </View>
        </LinearGradient>

        {updateReady ? <Pressable onPress={() => router.push('/tools')} style={({ pressed }) => [styles.toast, { backgroundColor: colors.secondary, borderColor: colors.border }, pressed && { opacity: 0.8 }]}><Feather name="download" size={16} color={colors.primary} /><Text style={[styles.toastText, { color: colors.foreground }]}>Version {update.phase.kind === 'ready' ? update.phase.decision.release.version : ''} is published. Review the install steps in Tools.</Text></Pressable> : null}
        {lastAction ? <Pressable onPress={clearAction} style={[styles.toast, { backgroundColor: colors.secondary, borderColor: colors.border }]}><Feather name={lastAction.tone === 'error' ? 'alert-circle' : lastAction.tone === 'success' ? 'check-circle' : 'info'} size={16} color={lastAction.tone === 'error' ? colors.destructive : lastAction.tone === 'success' ? colors.success : colors.info} /><Text style={[styles.toastText, { color: colors.foreground }]}>{lastAction.text}</Text></Pressable> : null}

        <SectionTitle title="Quick actions" eyebrow="CONTROL" />
        <View style={styles.quickGrid}>
          <QuickAction icon="terminal" label="Open console" color={colors.info} onPress={() => router.push('/console')} />
          <QuickAction icon="rotate-cw" label="Restart proxy" color={colors.warning} onPress={() => {
            const edge = findEdgeServer(servers);
            if (!edge) {
              Alert.alert('No proxy found', 'Crafty did not return a Velocity, proxy, or gateway server.');
              return;
            }
            restartServer(edge.id);
          }} />
          <QuickAction icon="radio" label="Say message" color={colors.primary} onPress={() => router.push({ pathname: '/console', params: { prefill: 'say ' } })} />
          <QuickAction icon="archive" label="Backup now" color={colors.success} onPress={() => {
            const target = servers.find((server) => server.id === consoleTargetId) ?? servers.find((server) => server.tag === 'PLAY') ?? servers[0];
            if (!target) {
              Alert.alert('No server', 'Crafty has not returned a server to back up.');
              return;
            }
            backupServer(target.id);
          }} />
        </View>

        <SectionTitle title="Your servers" eyebrow="INFRASTRUCTURE" action="View all" onAction={() => router.push('/servers')} />
        <View style={styles.serverList}>
          {servers.slice(0, 3).map((server) => (
            <Pressable key={server.id} onPress={() => router.push(`/server/${server.id}` as never)} style={({ pressed }) => [styles.serverRow, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.78 }]}>
              <View style={[styles.serverIcon, { backgroundColor: server.status === 'offline' ? colors.secondary : colors.accent }]}><Feather name={server.tag === 'EDGE' ? 'shuffle' : 'box'} size={18} color={server.status === 'offline' ? colors.destructive : colors.primary} /></View>
              <View style={styles.serverInfo}><View style={styles.serverNameLine}><Text style={[styles.serverName, { color: colors.foreground }]}>{server.name}</Text><StatusDot status={server.status} /></View><Text style={[styles.serverMeta, { color: colors.mutedForeground }]}>{server.metricsKnown ? `${server.players ?? '—'}/${server.maxPlayers ?? '—'} players · ${server.uptime ?? '—'}${server.statsFresh ? '' : ' · cached'}` : 'Stats unavailable'}</Text>{server.cpu != null ? <MetricBar value={server.cpu} color={server.cpu > 80 ? colors.warning : colors.primary} /> : null}</View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          ))}
          {!isLoading && servers.length === 0 ? <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No Crafty servers were returned.</Text> : null}
        </View>

        <SectionTitle title="Recent activity" eyebrow="TIMELINE" />
        <View style={[styles.activityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {lines.slice(0, 3).map((line) => <Activity key={line.id} icon={line.tone === 'warning' ? 'alert-triangle' : line.tone === 'error' ? 'x-circle' : line.tone === 'success' ? 'check' : 'terminal'} title={line.text} meta="Crafty Controller" time={line.time} color={line.tone === 'warning' ? colors.warning : line.tone === 'error' ? colors.destructive : line.tone === 'success' ? colors.success : colors.info} />)}
        </View>
      </ScrollView>
    </View>
  );
}

function QuickAction({ icon, label, color, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; color: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.quickAction, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.75 }]}><View style={[styles.quickIcon, { backgroundColor: `${color}20` }]}><Feather name={icon} size={18} color={color} /></View><Text style={[styles.quickLabel, { color: colors.foreground }]}>{label}</Text></Pressable>;
}

function clock(value: number) {
  return new Date(value).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function Activity({ icon, title, meta, time, color }: { icon: keyof typeof Feather.glyphMap; title: string; meta: string; time: string; color: string }) {
  const colors = useColors();
  return <View style={styles.activityRow}><View style={[styles.activityIcon, { backgroundColor: `${color}18` }]}><Feather name={icon} size={14} color={color} /></View><View style={styles.activityCopy}><Text style={[styles.activityTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.activityMeta, { color: colors.mutedForeground }]}>{meta}</Text></View><Text style={[styles.activityTime, { color: colors.mutedForeground }]}>{time}</Text></View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 2.1, marginBottom: 7 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1.1 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 5 },
  avatar: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.5 },
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
  toastText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
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
