import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { customFetch } from '@workspace/api-client-react';
import { Chip, PrimaryButton, SectionTitle, uiStyles } from '@/components/ControlUI';
import { ManualUpdateButton } from '@/components/AppUpdateGate';
import { useControlAuth } from '@/context/ControlAuth';
import { useServerControl } from '@/context/ServerContext';
import { useColors } from '@/hooks/useColors';

type SandboxType = 'vanilla' | 'paper' | 'fabric' | 'purpur';
type SandboxPreset = 'light' | 'balanced' | 'performance' | 'max' | 'custom';

type SandboxOptions = {
  poolGb: number;
  maxRamGb: number;
  poolCores: number;
  maxCores: number;
  usedRamGb: number;
  remainingRamGb: number;
  usedCores: number;
  remainingCores: number;
  publicIp: string;
  presets: Array<{ value: Exclude<SandboxPreset, 'custom'>; label: string; blurb: string; ramGb: number; cpuCores: number }>;
  serverTypes: Array<{ value: SandboxType; label: string; blurb: string }>;
  versions: Record<SandboxType, string[]>;
  ramChoices: number[];
  cpuChoices: number[];
  difficulties: string[];
  gamemodes: string[];
  defaults: {
    maxPlayers: number;
    viewDistance: number;
    simulationDistance: number;
    difficulty: string;
    gamemode: string;
    onlineMode: boolean;
    motd: string;
  };
};

type SandboxServer = {
  id: string;
  name: string;
  serverType: SandboxType;
  version: string;
  ramGb: number;
  cpuCores: number;
  preset: SandboxPreset;
  maxPlayers: number;
  address: string;
  onlineMode: boolean;
};

function Meter({ label, used, total, color }: { label: string; used: number; total: number; color: string }) {
  const colors = useColors();
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <View style={styles.meter}>
      <View style={styles.meterHeader}>
        <Text style={[styles.meterLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.meterValue, { color: colors.foreground }]}>{used}/{total}</Text>
      </View>
      <View style={[styles.meterTrack, { backgroundColor: colors.muted }]}>
        <View style={[styles.meterFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function ToolsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { apiBase, lock } = useControlAuth();
  const { refresh } = useServerControl();

  const [options, setOptions] = useState<SandboxOptions | null>(null);
  const [sandboxes, setSandboxes] = useState<SandboxServer[]>([]);
  const [name, setName] = useState('');
  const [serverType, setServerType] = useState<SandboxType>('paper');
  const [version, setVersion] = useState('');
  const [preset, setPreset] = useState<SandboxPreset>('balanced');
  const [ramGb, setRamGb] = useState(4);
  const [cpuCores, setCpuCores] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState(12);
  const [viewDistance, setViewDistance] = useState(8);
  const [simulationDistance, setSimulationDistance] = useState(6);
  const [difficulty, setDifficulty] = useState('normal');
  const [gamemode, setGamemode] = useState('survival');
  const [onlineMode, setOnlineMode] = useState(true);
  const [motd, setMotd] = useState('AETHERION Sandbox');
  const [startAfterCreate, setStartAfterCreate] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const versions = options?.versions?.[serverType] ?? [];
  const selectedVersion = useMemo(() => {
    if (version && versions.includes(version)) return version;
    return versions.find((item) => item.startsWith('1.21')) ?? versions[0] ?? '';
  }, [version, versions]);

  const applyPreset = (next: SandboxPreset) => {
    setPreset(next);
    if (next === 'custom') return;
    const found = options?.presets.find((item) => item.value === next);
    if (!found) return;
    setRamGb(found.ramGb);
    setCpuCores(found.cpuCores);
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextOptions, list] = await Promise.all([
        customFetch<SandboxOptions>('/api/sandbox/options'),
        customFetch<{ servers: SandboxServer[] }>('/api/sandbox/servers'),
      ]);
      setOptions(nextOptions);
      setSandboxes(list.servers);
      if (!version) {
        const preferred = nextOptions.versions.paper?.find((item) => item.startsWith('1.21')) ?? nextOptions.versions.paper?.[0];
        if (preferred) setVersion(preferred);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sandbox API unavailable');
    }
  }, [version]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (versions.length && !versions.includes(version)) {
      setVersion(versions.find((item) => item.startsWith('1.21')) ?? versions[0]);
    }
  }, [serverType, versions, version]);

  const canCreate =
    !busy &&
    name.trim().length >= 2 &&
    Boolean(selectedVersion) &&
    (options == null || (ramGb <= options.remainingRamGb && cpuCores <= options.remainingCores));

  const create = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await customFetch<SandboxServer & { address: string }>('/api/sandbox/servers', {
        method: 'POST',
        body: JSON.stringify({
          name,
          serverType,
          version: selectedVersion,
          ramGb,
          cpuCores,
          preset,
          maxPlayers,
          viewDistance,
          simulationDistance,
          difficulty,
          gamemode,
          onlineMode,
          motd,
          startAfterCreate,
        }),
      });
      setNotice(`Ready · ${created.address}`);
      setName('');
      await Promise.all([load(), refresh()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = (server: SandboxServer) => {
    Alert.alert(`Delete ${server.name}?`, 'Removes the Crafty instance and world files.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await customFetch(`/api/sandbox/servers/${encodeURIComponent(server.id)}`, { method: 'DELETE' });
              await Promise.all([load(), refresh()]);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Delete failed');
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const start = (server: SandboxServer) => {
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await customFetch<{ address: string; running: boolean | null }>(
          `/api/sandbox/servers/${encodeURIComponent(server.id)}/start`,
          { method: 'POST' },
        );
        setNotice(
          result.running
            ? `Online · ${result.address}`
            : `Start queued · ${result.address} — check Servers in a few seconds`,
        );
        await Promise.all([load(), refresh()]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Start failed');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
        <View style={[uiStyles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[uiStyles.scroll, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.kicker, { color: colors.primary }]}>SANDBOX FACTORY</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>New server</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Isolated from Velocity/MMO. Own port · same public IP · join as IP:port.
            </Text>
          </View>
        </View>

        <View style={styles.meters}>
          <Meter label="RAM pool" used={options?.usedRamGb ?? 0} total={options?.poolGb ?? 16} color={colors.primary} />
          <Meter label="CPU pool" used={options?.usedCores ?? 0} total={options?.poolCores ?? 8} color={colors.info} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>IDENTITY</Text>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="friends / event / test"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Engine</Text>
          <View style={styles.typeGrid}>
            {(options?.serverTypes ?? []).map((item) => {
              const active = serverType === item.value;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => setServerType(item.value)}
                  style={[styles.typeCard, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.accent : colors.background }]}
                >
                  <Text style={[styles.typeTitle, { color: colors.foreground }]}>{item.label}</Text>
                  <Text style={[styles.typeBlurb, { color: colors.mutedForeground }]}>{item.blurb}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Version</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {versions.slice(0, 16).map((item) => (
              <Chip key={item} label={item} active={selectedVersion === item} onPress={() => setVersion(item)} />
            ))}
          </ScrollView>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>RESOURCES</Text>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Preset</Text>
          <View style={styles.chips}>
            {(options?.presets ?? []).map((item) => (
              <Chip key={item.value} label={item.label} active={preset === item.value} onPress={() => applyPreset(item.value)} />
            ))}
            <Chip label="Custom" active={preset === 'custom'} onPress={() => applyPreset('custom')} />
          </View>
          {preset !== 'custom' ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              {(options?.presets ?? []).find((item) => item.value === preset)?.blurb} · {ramGb} GB RAM · {cpuCores} cores
            </Text>
          ) : null}

          <Text style={[styles.label, { color: colors.mutedForeground }]}>RAM ({ramGb} GB)</Text>
          <View style={styles.chips}>
            {(options?.ramChoices ?? [1, 2, 3, 4, 5, 6, 7, 8]).map((item) => (
              <Chip
                key={item}
                label={`${item}`}
                active={ramGb === item}
                onPress={() => {
                  setPreset('custom');
                  setRamGb(item);
                }}
              />
            ))}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>CPU cores ({cpuCores})</Text>
          <View style={styles.chips}>
            {(options?.cpuChoices ?? [1, 2, 3, 4]).map((item) => (
              <Chip
                key={item}
                label={`${item}`}
                active={cpuCores === item}
                onPress={() => {
                  setPreset('custom');
                  setCpuCores(item);
                }}
              />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            JVM gets Aikar flags + ActiveProcessorCount. Soft CPU cap — MMO network untouched.
          </Text>
        </View>

        <Pressable onPress={() => setShowAdvanced((value) => !value)} style={styles.advancedToggle}>
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>WORLD & NETWORK</Text>
          <Feather name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
        </Pressable>

        {showAdvanced ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Max players ({maxPlayers})</Text>
            <View style={styles.chips}>
              {[6, 8, 12, 16, 20, 30].map((item) => (
                <Chip key={item} label={`${item}`} active={maxPlayers === item} onPress={() => setMaxPlayers(item)} />
              ))}
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>View distance ({viewDistance})</Text>
            <View style={styles.chips}>
              {[6, 8, 10, 12].map((item) => (
                <Chip key={item} label={`${item}`} active={viewDistance === item} onPress={() => setViewDistance(item)} />
              ))}
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Simulation ({simulationDistance})</Text>
            <View style={styles.chips}>
              {[4, 6, 8, 10].map((item) => (
                <Chip key={item} label={`${item}`} active={simulationDistance === item} onPress={() => setSimulationDistance(item)} />
              ))}
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Difficulty</Text>
            <View style={styles.chips}>
              {(options?.difficulties ?? ['peaceful', 'easy', 'normal', 'hard']).map((item) => (
                <Chip key={item} label={item} active={difficulty === item} onPress={() => setDifficulty(item)} />
              ))}
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Gamemode</Text>
            <View style={styles.chips}>
              {(options?.gamemodes ?? ['survival', 'creative']).map((item) => (
                <Chip key={item} label={item} active={gamemode === item} onPress={() => setGamemode(item)} />
              ))}
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>MOTD</Text>
            <TextInput
              value={motd}
              onChangeText={setMotd}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            />

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.switchTitle, { color: colors.foreground }]}>Online mode</Text>
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>Off = cracked/offline friends testing</Text>
              </View>
              <Switch value={onlineMode} onValueChange={setOnlineMode} />
            </View>

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.switchTitle, { color: colors.foreground }]}>Start after create</Text>
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>Boot immediately when Crafty finishes install</Text>
              </View>
              <Switch value={startAfterCreate} onValueChange={setStartAfterCreate} />
            </View>
          </View>
        ) : null}

        <View style={[styles.preview, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Feather name="wifi" size={16} color={colors.primary} />
          <Text style={[styles.previewText, { color: colors.foreground }]}>
            Join preview · {options?.publicIp ?? '…'}:256xx · {ramGb}G / {cpuCores}C · {serverType} {selectedVersion || '…'}
          </Text>
        </View>

        {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
        {notice ? <Text style={[styles.notice, { color: colors.success }]}>{notice}</Text> : null}

        <PrimaryButton icon="zap" label={busy ? 'Provisioning…' : 'Create sandbox'} disabled={!canCreate} onPress={() => void create()} />

        <SectionTitle title="Active sandboxes" eyebrow="ISOLATED FLEET" />
        <View style={styles.list}>
          {sandboxes.length === 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>No sandboxes yet — pool is fully free.</Text>
          ) : (
            sandboxes.map((server) => (
              <View key={server.id} style={[styles.sandboxCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sandboxName, { color: colors.foreground }]}>{server.name}</Text>
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    {server.serverType} {server.version} · {server.ramGb}G / {server.cpuCores}C · {server.address}
                  </Text>
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    {server.maxPlayers} slots · {server.onlineMode ? 'online-mode' : 'offline-mode'}
                  </Text>
                </View>
                <View style={styles.sandboxActions}>
                  <Pressable onPress={() => start(server)} hitSlop={8} style={styles.sandboxAction}>
                    <Feather name="play" size={18} color={colors.success} />
                  </Pressable>
                  <Pressable onPress={() => remove(server)} hitSlop={8} style={styles.sandboxAction}>
                    <Feather name="trash-2" size={18} color={colors.destructive} />
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>

        <SectionTitle title="Session" eyebrow="DEVICE" />
        <ManualUpdateButton />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>{apiBase}</Text>
          <PrimaryButton icon="refresh-cw" label="Refresh pools" disabled={busy} onPress={() => void load()} />
          <Pressable
            onPress={() =>
              Alert.alert('End session?', 'The API key will leave this phone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => void lock().then(() => router.replace('/sign-in' as never)) },
              ])
            }
            style={({ pressed }) => [styles.danger, { borderColor: colors.destructive }, pressed && { opacity: 0.75 }]}
          >
            <Feather name="log-out" size={16} color={colors.destructive} />
            <Text style={[styles.dangerText, { color: colors.destructive }]}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 16 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 2, marginBottom: 7 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 6, lineHeight: 19, maxWidth: 320 },
  meters: { gap: 10, marginBottom: 14 },
  meter: { gap: 6 },
  meterHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  meterLabel: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  meterValue: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  meterTrack: { height: 7, borderRadius: 99, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 99 },
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.6 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 2 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: 'Inter_400Regular', fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeCard: { width: '48%', borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 },
  typeTitle: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  typeBlurb: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 15 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  advancedToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  switchTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  preview: { marginTop: 14, marginBottom: 12, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  previewText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17 },
  error: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 8 },
  notice: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 8 },
  list: { gap: 10 },
  sandboxCard: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sandboxName: { fontFamily: 'Inter_700Bold', fontSize: 14, marginBottom: 2 },
  sandboxActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sandboxAction: { padding: 6 },
  danger: { minHeight: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  dangerText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
});
