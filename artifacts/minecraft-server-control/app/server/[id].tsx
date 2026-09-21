import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getCraftyServerStats,
  getGetCraftyServerLogsQueryKey,
  getGetCraftyServerStatsQueryKey,
  getListCraftyServerBackupsQueryKey,
  getListCraftyServerPluginsQueryKey,
  listCraftyServerBackups,
  listCraftyServerFiles,
  useDeleteCraftyServerFile,
  useGetCraftyServerLogs,
  useGetCraftyServerStats,
  useListCraftyServerBackups,
  useListCraftyServerPlugins,
  useRunCraftyServerAction,
  useSaveCraftyServerFile,
  type CraftyActionRequestAction,
  type CraftyFileEntry,
  type CraftyFileResponse,
  type CraftyStats,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Chip, MetricBar, PrimaryButton, uiStyles } from '@/components/ControlUI';
import { useServerControl } from '@/context/ServerContext';
import { useColors } from '@/hooks/useColors';

type Tab = 'Overview' | 'Players' | 'Logs' | 'Files' | 'Plugins' | 'Backups';

export default function ServerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { servers, refresh: refreshServers } = useServerControl();
  const server = servers.find((item) => item.id === id);
  const [tab, setTab] = useState<Tab>('Overview');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [filePath, setFilePath] = useState('');
  const [files, setFiles] = useState<CraftyFileResponse | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const stats = useGetCraftyServerStats(id, { query: { queryKey: getGetCraftyServerStatsQueryKey(id), refetchInterval: 10000 } });
  const logs = useGetCraftyServerLogs(id, { query: { queryKey: getGetCraftyServerLogsQueryKey(id), enabled: tab === 'Logs', refetchInterval: 5000 } });
  const plugins = useListCraftyServerPlugins(id, { query: { queryKey: getListCraftyServerPluginsQueryKey(id), enabled: tab === 'Plugins' } });
  const backups = useListCraftyServerBackups(id, { query: { queryKey: getListCraftyServerBackupsQueryKey(id), enabled: tab === 'Backups' } });
  const action = useRunCraftyServerAction();
  const saveFile = useSaveCraftyServerFile();
  const deleteFile = useDeleteCraftyServerFile();
  const loading = (stats.isLoading && !stats.data) || busy;

  const loadPath = async (path: string) => {
    setFileError(null);
    try {
      const result = await listCraftyServerFiles(id, { path });
      setFilePath(result.path);
      setFiles(result);
      setFileContent(result.content ?? '');
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : 'Could not load this path.');
    }
  };

  useEffect(() => {
    if (tab === 'Files' && files === null) void loadPath('');
  }, [tab, files]);

  const runAction = (nextAction: CraftyActionRequestAction, label: string, warning: string) => {
    if (!id) return;
    Alert.alert(`${label} ${server?.name ?? 'server'}?`, warning, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: label,
        style: nextAction === 'stop_server' ? 'destructive' : 'default',
        onPress: () => {
          void (async () => {
            setBusy(true);
            const say = (text: string) => { if (mounted.current) setNote(text); };
            say(`Asking Crafty to ${label.toLowerCase()}…`);
            let backupBaseline: Set<string> | null = null;
            if (nextAction === 'backup_server') {
              try {
                const before = await listCraftyServerBackups(id);
                backupBaseline = new Set(before.backups.map((item) => item.id));
              } catch {
                backupBaseline = null;
              }
            }
            try {
              await action.mutateAsync({ id, data: { action: nextAction } });
              if (nextAction === 'backup_server') {
                if (!backupBaseline) {
                  say('Crafty accepted the backup. Existing archives could not be listed, so a new one is not confirmed.');
                } else {
                  say('Crafty accepted the backup. Waiting for a new archive to be listed.');
                  const created = await waitForBackup(id, backupBaseline, () => mounted.current);
                  say(created ? `Crafty listed a new backup: ${created}.` : 'Crafty accepted the backup, but no new archive is listed yet.');
                }
              } else if (nextAction === 'restart_server') {
                say('Crafty accepted the restart. Waiting until the server reports offline, then online.');
                const outcome = await waitForRestart(id, () => mounted.current);
                say(outcome === 'online'
                  ? 'Crafty reports the server online again.'
                  : outcome === 'offline'
                    ? 'Crafty accepted the restart. The server is still offline.'
                    : 'Crafty accepted the restart, but the server never reported offline. It is still running.');
              } else {
                const expected = nextAction === 'start_server';
                say(`Crafty accepted ${label.toLowerCase()}. Waiting for the server to report ${expected ? 'online' : 'offline'}.`);
                const confirmed = await waitForRunning(id, expected, () => mounted.current);
                say(confirmed
                  ? `Crafty reports the server ${expected ? 'online' : 'offline'}.`
                  : `Crafty accepted ${label.toLowerCase()}, but has not reported the server ${expected ? 'online' : 'offline'} yet.`);
              }
              if (mounted.current) {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: getGetCraftyServerStatsQueryKey(id) }),
                  queryClient.invalidateQueries({ queryKey: getGetCraftyServerLogsQueryKey(id) }),
                  queryClient.invalidateQueries({ queryKey: getListCraftyServerBackupsQueryKey(id) }),
                  refreshServers(),
                ]);
              }
            } catch (cause) {
              say(cause instanceof Error ? cause.message : 'Crafty did not accept the action.');
            } finally {
              if (mounted.current) setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const refresh = async () => {
    await Promise.all([stats.refetch(), refreshServers()]);
    if (tab === 'Logs') await logs.refetch();
    if (tab === 'Plugins') await plugins.refetch();
    if (tab === 'Backups') await backups.refetch();
    if (tab === 'Files') await loadPath(filePath);
  };

  const title = server?.name ?? 'Server';
  const tabs: Tab[] = ['Overview', 'Players', 'Logs', 'Files', 'Plugins', 'Backups'];
  return (
    <View style={[uiStyles.screen, { backgroundColor: colors.background }]}>
      <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={colors.primary} />} contentContainerStyle={[uiStyles.scroll, { paddingTop: insets.top + 14 }]}>
        <Text style={[styles.kicker, { color: colors.primary }]}>SERVER CONTROL</Text>
        <View style={styles.titleRow}><View style={{ flex: 1 }}><Text style={[styles.title, { color: colors.foreground }]}>{title}</Text><Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{server?.ip ?? id}</Text></View><View style={[styles.liveDot, { backgroundColor: stats.data ? (stats.data.running ? colors.success : colors.destructive) : colors.mutedForeground }]} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{tabs.map((item) => <Chip key={item} label={item} active={tab === item} onPress={() => setTab(item)} />)}</ScrollView>
        {note ? <View style={[styles.notice, { backgroundColor: colors.accent }]}><Text style={[styles.noticeText, { color: colors.accentForeground }]}>{note}</Text></View> : null}
        {stats.isError ? <Text style={[styles.error, { color: colors.destructive }]}>{stats.error instanceof Error ? stats.error.message : 'Crafty did not return stats.'}</Text> : null}
        {tab === 'Overview' ? <Overview stats={stats.data} known={Boolean(stats.data)} colors={colors} onAction={runAction} busy={busy} /> : null}
        {tab === 'Players' ? <ListCard title={stats.data ? `${stats.data.online}/${stats.data.maxPlayers} reported by Crafty` : 'Players'} empty={stats.data ? 'Crafty did not list any player names.' : 'Player names appear after Crafty returns stats.'} items={(stats.data?.players ?? []).map((name) => ({ icon: 'user' as const, title: name, meta: 'Name reported by Crafty' }))} /> : null}
        {tab === 'Logs' ? <View style={[styles.console, { backgroundColor: colors.card, borderColor: colors.border }]}>{logs.isLoading ? <Empty text="Loading logs…" /> : logs.data?.lines.length ? logs.data.lines.slice(-120).map((line, index) => <Text key={`${index}-${line}`} selectable style={[styles.logLine, { color: colors.mutedForeground }]}>{line}</Text>) : <Empty text="No log lines returned by Crafty." />}</View> : null}
        {tab === 'Files' ? <FilesPanel id={id} path={filePath} result={files} content={fileContent} error={fileError} onContent={setFileContent} onOpen={(path) => void loadPath(path)} onUp={() => void loadPath(filePath.split('/').slice(0, -1).join('/'))} onSave={() => saveFile.mutate({ id, data: { path: filePath, content: fileContent } }, { onSuccess: () => void loadPath(filePath) })} onDelete={(entry) => Alert.alert(`Delete ${entry.name}?`, 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => deleteFile.mutate({ id, data: { path: entry.path } }, { onSuccess: () => void loadPath(filePath) }) }])} busy={saveFile.isPending || deleteFile.isPending} /> : null}
        {tab === 'Plugins' ? <ListCard title="Installed extensions" empty="No plugin or mod files were found." items={(plugins.data?.plugins ?? []).map((item) => ({ icon: 'package' as const, title: item.name, meta: `${item.kind} · ${formatBytes(item.size)}` }))} /> : null}
        {tab === 'Backups' ? <View><PrimaryButton icon="archive" label={busy ? 'Waiting for Crafty…' : 'Create backup'} disabled={busy} onPress={() => runAction('backup_server', 'Back up', 'Crafty will be asked to create a backup. A new archive is confirmed only after Crafty lists it.')} /><ListCard title="Available backups" empty="No backups were returned by Crafty." items={(backups.data?.backups ?? []).map((item) => ({ icon: 'hard-drive' as const, title: item.name, meta: `${formatBytes(item.size)}${item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ''}` }))} /></View> : null}
      </ScrollView>
    </View>
  );
}

function Overview({ stats, known, colors, onAction, busy }: { stats: CraftyStats | undefined; known: boolean; colors: ReturnType<typeof useColors>; onAction: (action: CraftyActionRequestAction, label: string, warning: string) => void; busy: boolean }) {
  const controlsLocked = busy || !known;
  return (
    <View style={styles.sectionGap}>
      <View style={styles.metricGrid}>
        <Metric label="CPU" value={known ? stats?.cpu ?? null : null} colors={colors} />
        <Metric label="Memory" value={known ? stats?.memoryPercent ?? null : null} colors={colors} />
      </View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Row label="Status" value={known ? (stats?.running ? 'Online' : 'Offline') : 'Not reported'} colors={colors} />
        <Row label="Version" value={known ? (stats?.version || '—') : '—'} colors={colors} />
        <Row label="Players" value={known ? `${stats?.online ?? '—'}/${stats?.maxPlayers ?? '—'}` : '—'} colors={colors} />
        <Row label="Memory" value={known ? (stats?.memory || '—') : '—'} colors={colors} />
        <Row label="Uptime" value={known ? (stats?.uptime || '—') : '—'} colors={colors} />
        <Row label="World" value={known ? (stats?.worldSize || '—') : '—'} colors={colors} />
      </View>
      {!known ? <Text style={[styles.empty, { color: colors.mutedForeground }]}>Start, stop, and restart stay off until Crafty reports status.</Text> : null}
      <View style={styles.actions}>
        <PrimaryButton icon="play" label="Start" disabled={controlsLocked || !!stats?.running} onPress={() => onAction('start_server', 'Start', 'Crafty will be asked to start this server. Online is confirmed only after Crafty reports it running.')} />
        <PrimaryButton icon="square" label="Stop" disabled={controlsLocked || !stats?.running} onPress={() => onAction('stop_server', 'Stop', 'Crafty will be asked to stop this server. Connected players will be disconnected. Offline is confirmed only after Crafty reports it stopped.')} />
        <PrimaryButton icon="rotate-cw" label="Restart" disabled={controlsLocked || !stats?.running} onPress={() => onAction('restart_server', 'Restart', 'Crafty will be asked to restart this server. Done means Crafty reports it offline, then online again.')} />
      </View>
    </View>
  );
}

function FilesPanel({ id: _id, path, result, content, error, onContent, onOpen, onUp, onSave, onDelete, busy }: { id: string; path: string; result: CraftyFileResponse | null; content: string; error: string | null; onContent: (value: string) => void; onOpen: (path: string) => void; onUp: () => void; onSave: () => void; onDelete: (entry: CraftyFileEntry) => void; busy: boolean }) {
  const colors = useColors();
  if (error) return <Empty text={error} />;
  return <View style={styles.sectionGap}><View style={styles.pathRow}><Pressable disabled={!path} onPress={onUp}><Feather name="arrow-up" size={18} color={path ? colors.primary : colors.mutedForeground} /></Pressable><Text numberOfLines={1} style={[styles.path, { color: colors.mutedForeground }]}>/{path}</Text></View>{result?.directory ? <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>{result.entries.length ? result.entries.map((entry) => <View key={entry.path} style={styles.fileRow}><Pressable onPress={() => onOpen(entry.path)} style={styles.fileOpen}><Feather name={entry.directory ? 'folder' : 'file-text'} size={17} color={entry.directory ? colors.warning : colors.info} /><View style={{ flex: 1 }}><Text style={[styles.itemTitle, { color: colors.foreground }]}>{entry.name}</Text><Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>{entry.directory ? 'Folder' : formatBytes(entry.size)}</Text></View></Pressable><Pressable onPress={() => onDelete(entry)} hitSlop={8}><Feather name="trash-2" size={16} color={colors.destructive} /></Pressable></View>) : <Empty text="This folder is empty." />}</View> : <View><TextInput multiline value={content} onChangeText={onContent} autoCapitalize="none" autoCorrect={false} style={[styles.editor, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} /><PrimaryButton icon="save" label={busy ? 'Saving…' : 'Save file'} disabled={busy || !path} onPress={onSave} /></View>}</View>;
}

function ListCard({ title, empty, items }: { title: string; empty: string; items: { icon: keyof typeof Feather.glyphMap; title: string; meta: string }[] }) {
  const colors = useColors();
  return <View style={styles.sectionGap}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text><View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>{items.length ? items.map((item, index) => <View key={`${item.title}-${index}`} style={styles.item}><Feather name={item.icon} size={17} color={colors.primary} /><View style={{ flex: 1 }}><Text style={[styles.itemTitle, { color: colors.foreground }]}>{item.title}</Text><Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>{item.meta}</Text></View></View>) : <Empty text={empty} />}</View></View>;
}

function Metric({ label, value, colors }: { label: string; value: number | null; colors: ReturnType<typeof useColors> }) {
  const normalized = value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, Math.round(value * 10) / 10));
  return (
    <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{normalized == null ? '—' : `${normalized}%`}</Text>
      <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>{label}</Text>
      {normalized != null ? <MetricBar value={normalized} color={normalized > 80 ? colors.warning : colors.primary} /> : null}
    </View>
  );
}
function Row({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) { return <View style={styles.row}><Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>{label}</Text><Text style={[styles.rowValue, { color: colors.foreground }]}>{value}</Text></View>; }
function Empty({ text }: { text: string }) { const colors = useColors(); return <Text style={[styles.empty, { color: colors.mutedForeground }]}>{text}</Text>; }
function formatBytes(value: number) { if (!value) return 'Size unavailable'; const units = ['B', 'KB', 'MB', 'GB']; const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`; }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunning(id: string, expected: boolean, alive: () => boolean) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await sleep(3000);
    if (!alive()) return false;
    try {
      const stats = await getCraftyServerStats(id);
      if (stats.running === expected) return true;
    } catch {
      // A failed poll is not a state change.
    }
  }
  return false;
}

async function waitForRestart(id: string, alive: () => boolean): Promise<'online' | 'offline' | 'still-running'> {
  let sawStopped = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(3000);
    if (!alive()) return sawStopped ? 'offline' : 'still-running';
    try {
      const stats = await getCraftyServerStats(id);
      if (!stats.running) sawStopped = true;
      else if (sawStopped) return 'online';
    } catch {
      // Keep waiting for Crafty.
    }
  }
  try {
    const stats = await getCraftyServerStats(id);
    if (stats.running && sawStopped) return 'online';
    if (!stats.running) return 'offline';
  } catch {
    return sawStopped ? 'offline' : 'still-running';
  }
  return 'still-running';
}

async function waitForBackup(id: string, baseline: Set<string>, alive: () => boolean) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    if (!alive()) return null;
    try {
      const after = await listCraftyServerBackups(id);
      const created = after.backups.find((item) => !baseline.has(item.id));
      if (created) return created.name;
    } catch {
      // Keep waiting for the archive list.
    }
  }
  return null;
}

const styles = StyleSheet.create({
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 2, marginBottom: 7 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  tabs: { gap: 8, paddingVertical: 20 },
  notice: { padding: 12, borderRadius: 12, marginBottom: 12 },
  noticeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  error: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 12 },
  sectionGap: { gap: 12 },
  metricGrid: { flexDirection: 'row', gap: 10 },
  metricCard: { flex: 1, borderWidth: 1, borderRadius: 18, padding: 15, gap: 7 },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowValue: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  actions: { gap: 9 },
  console: { borderWidth: 1, borderRadius: 18, padding: 13, minHeight: 280 },
  logLine: { fontFamily: 'monospace', fontSize: 10, lineHeight: 16 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  itemTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  itemMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, paddingVertical: 12, textAlign: 'center' },
  pathRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  path: { flex: 1, fontFamily: 'monospace', fontSize: 12 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fileOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  editor: { minHeight: 320, borderWidth: 1, borderRadius: 16, padding: 13, fontFamily: 'monospace', fontSize: 12, textAlignVertical: 'top', marginBottom: 12 },
});