import Constants from 'expo-constants';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useControlAuth } from '@/context/ControlAuth';

type ReleaseInfo = {
  tag: string;
  version: string;
  notes: string;
  apkUrl: string;
};

function currentVersion() {
  const fromExpo = Constants.expoConfig?.version;
  const fromNative = Constants.nativeAppVersion;
  const fromManifest = (Constants as { manifest?: { version?: string } }).manifest?.version;
  return String(fromNative || fromExpo || fromManifest || '0.0.0').replace(/^v/i, '');
}

function parseVersion(value: string) {
  return value
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part.replace(/\D/g, ''), 10) || 0);
}

function isNewer(remote: string, local: string) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
}

async function fetchLatestViaApi(): Promise<ReleaseInfo | null> {
  const data = await customFetch<{
    tag?: string;
    version?: string;
    notes?: string;
    apkUrl?: string;
  }>('/api/app/latest');
  if (!data?.version || !data?.apkUrl) return null;
  return {
    tag: data.tag ?? `v${data.version}`,
    version: data.version,
    notes: (data.notes ?? '').trim().slice(0, 280),
    apkUrl: data.apkUrl,
  };
}

type Props = {
  /** Manual check from Tools — always show a result modal. */
  force?: boolean;
  onClose?: () => void;
};

export function AppUpdateGate({ force = false, onClose }: Props = {}) {
  const colors = useColors();
  const { isUnlocked } = useControlAuth();
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(force);
  const local = currentVersion();

  const dismiss = useCallback(() => {
    setRelease(null);
    setMessage(null);
    setBusy(false);
    onClose?.();
  }, [onClose]);

  const check = useCallback(async () => {
    if (!isUnlocked) {
      if (force) setMessage('Unlock the app first, then check again.');
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const latest = await fetchLatestViaApi();
      if (latest && isNewer(latest.version, local)) {
        setRelease(latest);
        setMessage(null);
      } else if (force) {
        setRelease(null);
        setMessage(
          latest
            ? `You are on ${local}. Latest is ${latest.version} — already up to date.`
            : `You are on ${local}. No release metadata returned.`,
        );
      }
    } catch (cause) {
      if (force) setMessage(cause instanceof Error ? cause.message : 'Update check failed');
    } finally {
      setBusy(false);
    }
  }, [force, isUnlocked, local]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!force && !isUnlocked) return;
    const timer = setTimeout(() => void check(), force ? 0 : 1400);
    return () => clearTimeout(timer);
  }, [check, force, isUnlocked]);

  const visible = Boolean(release || message || (force && busy));
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.kicker, { color: colors.primary }]}>
            {busy ? 'CHECKING' : release ? 'UPDATE AVAILABLE' : 'UPDATE CHECK'}
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {release ? `AETHERION ${release.tag}` : 'AETHERION Control'}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {busy
              ? 'Talking to your control API…'
              : release
                ? `Installed: ${local} · New: ${release.version}. Download opens via your API, then install the APK.`
                : message}
          </Text>
          {release?.notes ? (
            <Text style={[styles.notes, { color: colors.mutedForeground }]} numberOfLines={5}>
              {release.notes}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable onPress={dismiss} style={[styles.btn, { backgroundColor: colors.secondary }]} disabled={busy}>
              <Text style={[styles.btnText, { color: colors.foreground }]}>{release ? 'Later' : 'OK'}</Text>
            </Pressable>
            {release ? (
              <Pressable
                onPress={() => {
                  void Linking.openURL(release.apkUrl);
                  dismiss();
                }}
                style={[styles.btn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Update</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ManualUpdateButton() {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.manualBtn,
          { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={[styles.manualTitle, { color: colors.foreground }]}>Check for app updates</Text>
        <Text style={[styles.manualMeta, { color: colors.mutedForeground }]}>
          Installed {currentVersion()} · via control API
        </Text>
      </Pressable>
      {open ? <AppUpdateGate force onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,7,13,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
  },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.8, marginBottom: 8 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.5 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 8 },
  notes: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
    opacity: 0.9,
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  manualBtn: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  manualTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  manualMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4 },
});
