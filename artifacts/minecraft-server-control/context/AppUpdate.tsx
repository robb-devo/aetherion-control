import Constants from 'expo-constants';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import app from '@/app.json';
import {
  decideUpdate,
  fetchLatestRelease,
  type UpdateDecision,
} from '@/lib/appUpdate';
import { downloadReleaseApk, openInstallPermissionSettings, openReleasePage, openSystemInstaller } from '@/lib/installApk';

export function installedAppVersion() {
  return Constants.expoConfig?.version || Constants.nativeApplicationVersion || app.expo.version;
}

type UpdatePhase =
  | { kind: 'checking' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; decision: UpdateDecision }
  | { kind: 'downloading'; decision: Extract<UpdateDecision, { kind: 'update' }>; written: number; total: number | null }
  | { kind: 'downloaded'; decision: Extract<UpdateDecision, { kind: 'update' }>; bytes: number }
  | { kind: 'handed-off'; decision: Extract<UpdateDecision, { kind: 'update' }> }
  | { kind: 'install-failed'; decision: Extract<UpdateDecision, { kind: 'update' }>; message: string; canInstall: boolean };

type AppUpdateValue = {
  phase: UpdatePhase;
  installed: string;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  openSettings: () => Promise<void>;
  openRelease: () => Promise<void>;
};

const AppUpdateContext = createContext<AppUpdateValue | null>(null);

function updateDecision(phase: UpdatePhase): Extract<UpdateDecision, { kind: 'update' }> | null {
  if (phase.kind === 'checking' || phase.kind === 'failed') return null;
  return phase.decision.kind === 'update' ? phase.decision : null;
}

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const installed = installedAppVersion();
  const [phase, setPhase] = useState<UpdatePhase>({ kind: 'checking' });

  const check = useCallback(async () => {
    setPhase({ kind: 'checking' });
    try {
      const release = await fetchLatestRelease();
      setPhase({ kind: 'ready', decision: decideUpdate(installed, release) });
    } catch (cause) {
      setPhase({ kind: 'failed', message: cause instanceof Error ? cause.message : 'Could not check GitHub releases.' });
    }
  }, [installed]);

  useEffect(() => {
    void check();
  }, [check]);

  const download = useCallback(async () => {
    if (Platform.OS !== 'android') {
      const current = phase.kind === 'ready' ? phase.decision : null;
      if (current?.kind === 'update') await openReleasePage(current.release.pageUrl);
      return;
    }
    const decision = updateDecision(phase);
    if (!decision) return;
    setPhase({ kind: 'downloading', decision, written: 0, total: decision.release.size });
    try {
      const result = await downloadReleaseApk(decision.release.url, decision.release.size, (progress) => {
        setPhase({ kind: 'downloading', decision, written: progress.written, total: progress.total });
      });
      setPhase({ kind: 'downloaded', decision, bytes: result.bytes });
    } catch (cause) {
      setPhase({ kind: 'install-failed', decision, canInstall: false, message: cause instanceof Error ? cause.message : 'Download failed.' });
    }
  }, [phase]);

  const install = useCallback(async () => {
    const decision = updateDecision(phase);
    if (!decision) return;
    try {
      await openSystemInstaller();
      setPhase({ kind: 'handed-off', decision });
    } catch (cause) {
      setPhase({
        kind: 'install-failed',
        decision,
        canInstall: true,
        message: cause instanceof Error ? cause.message : 'Android did not open the installer.',
      });
    }
  }, [phase]);

  const openSettings = useCallback(async () => {
    try {
      await openInstallPermissionSettings();
    } catch (cause) {
      const decision = updateDecision(phase);
      if (!decision) return;
      setPhase({
        kind: 'install-failed',
        decision,
        canInstall: true,
        message: cause instanceof Error ? cause.message : 'Android install settings could not be opened.',
      });
    }
  }, [phase]);

  const openRelease = useCallback(async () => {
    const decision = phase.kind === 'checking' || phase.kind === 'failed' ? null : phase.decision;
    if (!decision) return;
    await openReleasePage(decision.release.pageUrl);
  }, [phase]);

  const value = useMemo(
    () => ({ phase, installed, check, download, install, openSettings, openRelease }),
    [check, download, install, installed, openRelease, openSettings, phase],
  );

  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate() {
  const context = useContext(AppUpdateContext);
  if (!context) throw new Error('useAppUpdate must be used inside AppUpdateProvider');
  return context;
}
