import Constants from 'expo-constants';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { customFetch } from '@workspace/api-client-react';
import { MetricBar } from '@/components/ControlUI';
import { useColors } from '@/hooks/useColors';
import { useControlAuth } from '@/context/ControlAuth';
import { compareVersions, formatByteSize, releaseSizeMatches } from '@/lib/appUpdate';
import { downloadReleaseApk, openInstallPermissionSettings, openReleasePage, openSystemInstaller } from '@/lib/installApk';

type ReleaseInfo = {
  tag: string;
  version: string;
  notes: string;
  apkUrl: string;
  size: number;
  pageUrl: string | null;
};

type Phase =
  | { kind: 'checking' }
  | { kind: 'message'; text: string }
  | { kind: 'available'; release: ReleaseInfo }
  | { kind: 'downloading'; release: ReleaseInfo; written: number; total: number | null }
  | { kind: 'ready'; release: ReleaseInfo; bytes: number }
  | { kind: 'handed-off'; release: ReleaseInfo }
  | { kind: 'failed'; text: string; release?: ReleaseInfo; canInstall?: boolean };

function currentVersion() {
  const fromExpo = Constants.expoConfig?.version;
  const fromNative = Constants.nativeAppVersion;
  const fromManifest = (Constants as { manifest?: { version?: string } }).manifest?.version;
  return String(fromNative || fromExpo || fromManifest || '0.0.0').replace(/^v/i, '');
}

async function fetchLatestViaApi(): Promise<ReleaseInfo | null> {
  const data = await customFetch<{
    tag?: string;
    version?: string;
    notes?: string;
    apkUrl?: string;
    size?: number;
    pageUrl?: string;
  }>('/api/app/latest');
  if (!data?.version || !data?.apkUrl) return null;
  return {
    tag: data.tag ?? `v${data.version}`,
    version: data.version,
    notes: (data.notes ?? '').trim().slice(0, 280),
    apkUrl: data.apkUrl,
    size: typeof data.size === 'number' ? data.size : 0,
    pageUrl: data.pageUrl ?? null,
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
  const [phase, setPhase] = useState<Phase>(force ? { kind: 'checking' } : { kind: 'message', text: '' });
  const [visible, setVisible] = useState(false);
  const local = currentVersion();

  const dismiss = useCallback(() => {
    setVisible(false);
    onClose?.();
  }, [onClose]);

  const check = useCallback(async () => {
    if (!isUnlocked) {
      if (force) {
        setPhase({ kind: 'message', text: 'Unlock the app first, then check again.' });
        setVisible(true);
      }
      return;
    }
    setPhase({ kind: 'checking' });
    if (force) setVisible(true);
    try {
      const latest = await fetchLatestViaApi();
      if (!latest) {
        if (force) {
          setPhase({ kind: 'message', text: `You are on ${local}. No release metadata returned.` });
          setVisible(true);
        }
        return;
      }
      const comparison = compareVersions(latest.version, local);
      if (comparison === null) {
        setPhase({
          kind: 'message',
          text: `Installed ${local}. The control API published ${latest.version}, which is not a comparable version. Nothing will be installed.`,
        });
        setVisible(true);
        return;
      }
      if (comparison > 0) {
        if (!releaseSizeMatches(latest.size, latest.size)) {
          setPhase({
            kind: 'failed',
            release: latest,
            text: `Version ${latest.version} is published, but the control API did not report an APK size. The installer was not opened.`,
          });
        } else {
          setPhase({ kind: 'available', release: latest });
        }
        setVisible(true);
        return;
      }
      if (force) {
        setPhase({
          kind: 'message',
          text: comparison < 0
            ? `You are on ${local}, which is newer than ${latest.version}. No older APK will be downloaded.`
            : `You are on ${local}. Latest is ${latest.version} — already up to date.`,
        });
        setVisible(true);
      }
    } catch (cause) {
      if (force) {
        setPhase({ kind: 'failed', text: cause instanceof Error ? cause.message : 'Update check failed' });
        setVisible(true);
      }
    }
  }, [force, isUnlocked, local]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!force && !isUnlocked) return;
    const timer = setTimeout(() => void check(), force ? 0 : 1400);
    return () => clearTimeout(timer);
  }, [check, force, isUnlocked]);

  const release = phase.kind === 'available' || phase.kind === 'downloading' || phase.kind === 'ready' || phase.kind === 'handed-off'
    ? phase.release
    : phase.kind === 'failed'
      ? phase.release
      : undefined;
  const downloadTarget = phase.kind === 'available'
    ? phase.release
    : phase.kind === 'failed' && phase.release && !phase.canInstall && phase.release.size > 0
      ? phase.release
      : null;
  const installTarget = phase.kind === 'ready' || (phase.kind === 'failed' && phase.canInstall)
    ? phase.release
    : null;

  const download = async (next: ReleaseInfo) => {
    if (Platform.OS !== 'android') {
      if (next.pageUrl) await openReleasePage(next.pageUrl);
      else await openReleasePage(next.apkUrl);
      setPhase({
        kind: 'message',
        text: 'The release link was opened. This device does not install Android packages, and the app is not updated until Android finishes its own installer.',
      });
      return;
    }
    setPhase({ kind: 'downloading', release: next, written: 0, total: next.size });
    try {
      const result = await downloadReleaseApk(next.apkUrl, next.size, (progress) => {
        setPhase({ kind: 'downloading', release: next, written: progress.written, total: progress.total });
      });
      setPhase({ kind: 'ready', release: next, bytes: result.bytes });
    } catch (cause) {
      setPhase({
        kind: 'failed',
        release: next,
        canInstall: false,
        text: cause instanceof Error ? cause.message : 'Download failed.',
      });
    }
  };

  const install = async () => {
    const next = phase.kind === 'ready'
      ? phase.release
      : phase.kind === 'failed' && phase.canInstall
        ? phase.release
        : undefined;
    if (!next) return;
    try {
      await openSystemInstaller();
      setPhase({ kind: 'handed-off', release: next });
    } catch (cause) {
      setPhase({
        kind: 'failed',
        release: next,
        canInstall: true,
        text: cause instanceof Error ? cause.message : 'Android did not open the installer.',
      });
    }
  };

  if (!visible) return null;

  const title = phase.kind === 'checking'
    ? 'AETHERION Control'
    : release
      ? `AETHERION ${release.tag}`
      : 'AETHERION Control';
  const body = phase.kind === 'checking'
    ? 'Talking to your control API…'
    : phase.kind === 'available'
      ? `Installed: ${local}. New: ${phase.release.version} (${formatByteSize(phase.release.size)}). Download stays in this app, then Android's installer asks you to confirm. That screen is required, and this app cannot accept it.`
      : phase.kind === 'downloading'
        ? (phase.total
          ? `Downloaded ${formatByteSize(phase.written)} of ${formatByteSize(phase.total)}. The installer has not opened.`
          : `Downloaded ${formatByteSize(phase.written)}. The installer has not opened.`)
        : phase.kind === 'ready'
          ? `Downloaded ${formatByteSize(phase.bytes)}, matching the release. Continue when you are ready for Android's confirmation screen. Nothing is installed yet.`
          : phase.kind === 'handed-off'
            ? 'Android closed the installer. This app cannot see whether you confirmed it. If you did, the version changes after AETHERION restarts on that build. Cancelling leaves this build installed.'
            : phase.kind === 'failed' || phase.kind === 'message'
              ? phase.text
              : '';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.kicker, { color: colors.primary }]}>
            {phase.kind === 'checking' ? 'CHECKING' : release ? 'UPDATE AVAILABLE' : 'UPDATE CHECK'}
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.body, { color: phase.kind === 'failed' ? colors.destructive : colors.mutedForeground }]}>{body}</Text>
          {phase.kind === 'downloading' && phase.total ? (
            <MetricBar value={Math.min(100, (phase.written / phase.total) * 100)} color={colors.primary} />
          ) : null}
          {release?.notes ? (
            <Text style={[styles.notes, { color: colors.mutedForeground }]} numberOfLines={5}>
              {release.notes}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable onPress={dismiss} style={[styles.btn, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.btnText, { color: colors.foreground }]}>{release ? 'Later' : 'OK'}</Text>
            </Pressable>
            {downloadTarget ? (
              <Pressable
                onPress={() => void download(downloadTarget)}
                style={[styles.btn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
                  {Platform.OS === 'android' ? 'Download APK' : 'Open release'}
                </Text>
              </Pressable>
            ) : null}
            {installTarget ? (
              <Pressable onPress={() => void install()} style={[styles.btn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Open installer</Text>
              </Pressable>
            ) : null}
          </View>
          {Platform.OS === 'android' && (phase.kind === 'ready' || phase.kind === 'handed-off' || (phase.kind === 'failed' && phase.canInstall)) ? (
            <Pressable onPress={() => void openInstallPermissionSettings().catch(() => undefined)} hitSlop={8}>
              <Text style={[styles.link, { color: colors.primary }]}>Allow installs from this app</Text>
            </Pressable>
          ) : null}
          {release?.pageUrl ? (
            <Pressable onPress={() => void openReleasePage(release.pageUrl!)} hitSlop={8}>
              <Text style={[styles.link, { color: colors.primary }]}>Open the GitHub release</Text>
            </Pressable>
          ) : null}
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
          Installed {currentVersion()} · download, then the Android installer
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
    gap: 10,
  },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.8 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.5 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  notes: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    opacity: 0.9,
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'center', paddingTop: 4 },
  manualBtn: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  manualTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  manualMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4 },
});
