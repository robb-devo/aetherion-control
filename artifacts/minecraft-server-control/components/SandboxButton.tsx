import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { customFetch } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { PrimaryButton } from '@/components/ControlUI';
import { useControlAuth } from '@/context/ControlAuth';
import { useColors } from '@/hooks/useColors';
import {
  SANDBOX_ROUTES,
  planSandboxCreate,
  sandboxErrorMessage,
  type SandboxOptions,
} from '@/lib/sandboxCreate';

type SandboxServer = {
  id: string;
  name: string;
  serverType?: string;
  version?: string;
  ramGb?: number;
  address?: string;
};

const ENGINE_LABEL: Record<string, string> = {
  paper: 'Paper',
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  purpur: 'Purpur',
};

function engineLabel(value: string | undefined) {
  if (!value) return 'Paper';
  return ENGINE_LABEL[value] ?? value;
}

export function SandboxButton() {
  const colors = useColors();
  const { isUnlocked } = useControlAuth();
  const [open, setOpen] = useState(false);

  if (!isUnlocked) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sandbox"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.entry,
          { backgroundColor: colors.primary },
          pressed && styles.pressed,
        ]}
      >
        <Feather name="box" size={14} color={colors.primaryForeground} />
        <Text style={[styles.entryText, { color: colors.primaryForeground }]}>Sandbox</Text>
      </Pressable>
      <SandboxSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SandboxSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [options, setOptions] = useState<SandboxOptions | null>(null);
  const [servers, setServers] = useState<SandboxServer[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const loadToken = useRef(0);

  const summary = useMemo(() => {
    if (!options) return null;
    try {
      return planSandboxCreate(options, 'sandbox');
    } catch {
      return null;
    }
  }, [options]);

  const load = useCallback(async () => {
    const token = loadToken.current + 1;
    loadToken.current = token;
    setLoading(true);
    const [optionsResult, listResult] = await Promise.all([
      customFetch<SandboxOptions>(SANDBOX_ROUTES.options, { responseType: 'json' }).then(
        (value) => ({ ok: true as const, value }),
        (cause: unknown) => ({ ok: false as const, cause }),
      ),
      customFetch<{ servers?: SandboxServer[] }>(SANDBOX_ROUTES.servers, { responseType: 'json' }).then(
        (value) => ({ ok: true as const, value }),
        (cause: unknown) => ({ ok: false as const, cause }),
      ),
    ]);

    if (token !== loadToken.current) return;

    if (optionsResult.ok) setOptions(optionsResult.value);
    else setOptions(null);

    if (listResult.ok) setServers(listResult.value.servers ?? []);

    if (!optionsResult.ok) setError(sandboxErrorMessage(optionsResult.cause));
    else if (!listResult.ok) setError(sandboxErrorMessage(listResult.cause));
    else setError(null);

    setLoading(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [load, visible]);

  const create = async () => {
    if (!options || creating) return;
    setNotice(null);
    let body;
    try {
      body = planSandboxCreate(options, name);
    } catch (cause) {
      setError(sandboxErrorMessage(cause));
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const created = await customFetch<SandboxServer>(SANDBOX_ROUTES.servers, {
        method: 'POST',
        body: JSON.stringify(body),
        responseType: 'json',
      });
      setName('');
      setNotice(created.address ? `Erstellt · ${created.address}` : 'Erstellt.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      await load();
    } catch (cause) {
      setError(sandboxErrorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  const run = async (id: string, action: 'start' | 'stop') => {
    setBusyId(id);
    setError(null);
    try {
      const result = await customFetch<{ running?: boolean | null }>(
        action === 'start' ? SANDBOX_ROUTES.start(id) : SANDBOX_ROUTES.stop(id),
        { method: 'POST', responseType: 'json' },
      );
      if (typeof result?.running === 'boolean') {
        setRunning((prev) => ({ ...prev, [id]: result.running as boolean }));
      }
    } catch (cause) {
      setError(sandboxErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  };

  const remove = (server: SandboxServer) => {
    Alert.alert('Sandbox löschen?', server.name, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          setBusyId(server.id);
          setError(null);
          void customFetch(SANDBOX_ROUTES.remove(server.id), { method: 'DELETE', responseType: 'json' })
            .then(async () => {
              setRunning((prev) => {
                const next = { ...prev };
                delete next[server.id];
                return next;
              });
              setNotice(null);
              await load();
            })
            .catch((cause: unknown) => setError(sandboxErrorMessage(cause)))
            .finally(() => setBusyId(null));
        },
      },
    ]);
  };

  const hint = summary ? `${summary.ramGb} GB · ${engineLabel(summary.serverType)}` : loading ? 'Lade…' : 'Nicht verfügbar';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable accessibilityLabel="Schließen" style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <KeyboardAwareScrollViewCompat
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: height * 0.78 }}
            contentContainerStyle={styles.sheetBody}
          >
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.kicker, { color: colors.primary }]}>SANDBOX</Text>
                <Text style={[styles.title, { color: colors.foreground }]}>Neuer Server</Text>
              </View>
              <Pressable accessibilityLabel="Schließen" hitSlop={10} onPress={onClose} style={({ pressed }) => [styles.close, { backgroundColor: colors.secondary }, pressed && styles.pressed]}>
                <Feather name="x" size={16} color={colors.foreground} />
              </Pressable>
            </View>
            <Text style={[styles.lede, { color: colors.mutedForeground }]}>Eigener Server. Getrennt vom Netzwerk.</Text>
            <View style={[styles.hintPill, { backgroundColor: colors.accent }]}>
              {loading && !summary ? <ActivityIndicator size="small" color={colors.accentForeground} /> : null}
              <Text style={[styles.hintText, { color: colors.accentForeground }]}>{hint}</Text>
            </View>

            <TextInput
              value={name}
              onChangeText={setName}
              onSubmitEditing={() => void create()}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={24}
              returnKeyType="done"
              placeholder="Name (optional)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            />

            <PrimaryButton
              icon="plus"
              label={creating ? 'Erstelle…' : 'Erstellen'}
              disabled={!summary || creating || busyId != null}
              onPress={() => void create()}
            />
            {creating ? <Text style={[styles.note, { color: colors.mutedForeground }]}>Dauert einen Moment.</Text> : null}
            {notice ? <Text style={[styles.note, { color: colors.success }]}>{notice}</Text> : null}
            {error ? <Text style={[styles.note, { color: colors.destructive }]}>{error}</Text> : null}

            <View style={styles.listHeader}>
              <Text style={[styles.listTitle, { color: colors.foreground }]}>Deine Sandboxes</Text>
              <Pressable accessibilityLabel="Aktualisieren" hitSlop={8} onPress={() => void load()} style={({ pressed }) => pressed && styles.pressed}>
                <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {servers.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>{loading ? 'Lade…' : 'Noch keine Sandbox.'}</Text>
            ) : (
              <View style={styles.list}>
                {servers.map((server) => {
                  const live = running[server.id];
                  const busy = busyId === server.id;
                  return (
                    <View key={server.id} style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{server.name}</Text>
                        <Text style={[styles.cardMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {engineLabel(server.serverType)} {server.version ?? ''} · {server.ramGb ?? summary?.ramGb ?? 16} GB
                          {live == null ? '' : live ? ' · läuft' : ' · gestoppt'}
                        </Text>
                        {server.address ? (
                          <Text selectable style={[styles.address, { color: colors.foreground }]}>{server.address}</Text>
                        ) : null}
                      </View>
                      <View style={styles.actions}>
                        <IconAction label="Start" icon="play" color={colors.success} disabled={busy || creating} onPress={() => void run(server.id, 'start')} />
                        <IconAction label="Stop" icon="square" color={colors.warning} disabled={busy || creating} onPress={() => void run(server.id, 'stop')} />
                        <IconAction label="Löschen" icon="trash-2" color={colors.destructive} disabled={busy || creating} onPress={() => remove(server)} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </KeyboardAwareScrollViewCompat>
        </View>
      </View>
    </Modal>
  );
}

function IconAction({
  icon,
  label,
  color,
  disabled,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconAction,
        { backgroundColor: colors.secondary, opacity: disabled ? 0.4 : 1 },
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Feather name={icon} size={14} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  entry: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 0,
  },
  entryText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  sheetBody: { paddingHorizontal: 20, paddingBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 2, marginBottom: 6 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, letterSpacing: -0.6 },
  close: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lede: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: 8 },
  hintPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hintText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 14,
    marginBottom: 12,
  },
  note: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, marginTop: 8 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  listTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 13, paddingVertical: 8 },
  list: { gap: 10 },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardName: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  cardMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
  address: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 6 },
  iconAction: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
