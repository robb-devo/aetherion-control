import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import {
  getCraftyServerStats,
  listCraftyServerBackups,
  listCraftyServers,
  runCraftyServerAction,
  sendCraftyServerCommand,
  type CraftyActionRequestAction,
  type CraftyStats,
} from '@workspace/api-client-react';
import { useControlAuth } from '@/context/ControlAuth';
import {
  mergeLiveServers,
  toMinecraftServer,
  withConfirmedStats,
  type MinecraftServer,
} from '@/lib/liveServers';

export type { MinecraftServer, ServerStatus } from '@/lib/liveServers';

export type ActionNotice = {
  tone: 'info' | 'success' | 'error';
  text: string;
};

export type ConsoleLine = {
  id: string;
  time: string;
  tone: 'normal' | 'success' | 'warning' | 'error';
  text: string;
};

const STORAGE_KEY = 'minecraft-server-control-state';
const LEGACY_ACTIVITY = /Connect to Crafty to load live console output|Connected to Crafty ·/;

const initialLines: ConsoleLine[] = [
  { id: 'activity-empty', time: '—', tone: 'normal', text: 'Actions Crafty accepts show up here.' },
];

type ServerContextValue = {
  servers: MinecraftServer[];
  lines: ConsoleLine[];
  lastAction: ActionNotice | null;
  isHydrated: boolean;
  isLoading: boolean;
  error: string | null;
  syncedAt: number | null;
  consoleTargetId: string | null;
  setConsoleTargetId: (id: string) => void;
  refresh: () => Promise<void>;
  restartServer: (id: string) => void;
  backupServer: (id: string) => void;
  runCommand: (command: string) => Promise<boolean>;
  clearAction: () => void;
};

const ServerContext = createContext<ServerContextValue | null>(null);

function nowLabel() {
  return new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const { isUnlocked } = useControlAuth();
  const [servers, setServers] = useState<MinecraftServer[]>([]);
  const [lines, setLines] = useState<ConsoleLine[]>(initialLines);
  const [lastAction, setLastAction] = useState<ActionNotice | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [consoleTargetId, setConsoleTargetId] = useState<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const restartingIds = useRef(new Set<string>());
  const serversRef = useRef(servers);
  serversRef.current = servers;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!value) return;
        const saved = JSON.parse(value) as { lines?: ConsoleLine[] };
        const restored = saved.lines?.filter((line) => !LEGACY_ACTIVITY.test(line.text)) ?? [];
        if (restored.length) setLines(restored);
      })
      .catch(() => undefined)
      .finally(() => setIsHydrated(true));
  }, []);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (options?.silent && inFlight.current) return;
    const gen = ++generation.current;
    inFlight.current = true;
    if (!options?.silent) setIsLoading(true);
    try {
      const response = await listCraftyServers();
      if (generation.current !== gen) return;
      const liveServers = await Promise.all(response.servers.map(async (server) => {
        try {
          return toMinecraftServer(server, await getCraftyServerStats(server.id));
        } catch {
          return toMinecraftServer(server, null);
        }
      }));
      if (generation.current !== gen) return;
      setServers((current) => mergeLiveServers(current, liveServers, restartingIds.current));
      setSyncedAt(Date.now());
      setError(null);
      setConsoleTargetId((current) => {
        if (current && liveServers.some((server) => server.id === current)) return current;
        const preferred =
          liveServers.find((server) => /mmo-r/i.test(server.name)) ??
          liveServers.find((server) => server.tag === 'PLAY') ??
          liveServers[0];
        return preferred?.id ?? null;
      });
    } catch (cause) {
      if (generation.current !== gen) return;
      const message = messageOf(cause, 'Crafty could not be reached.');
      setError(message);
      if (!options?.silent) setLastAction({ tone: 'error', text: message });
    } finally {
      if (generation.current === gen) {
        inFlight.current = false;
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (isHydrated && isUnlocked) {
      void refresh();
      const timer = setInterval(() => void refresh({ silent: true }), 10000);
      return () => clearInterval(timer);
    }
    if (isHydrated && !isUnlocked) {
      setIsLoading(false);
      setError(null);
    }
    return undefined;
  }, [isHydrated, isUnlocked, refresh]);

  useEffect(() => {
    if (!isHydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ lines })).catch(() => undefined);
  }, [isHydrated, lines]);

  const pushLine = useCallback((tone: ConsoleLine['tone'], text: string) => {
    setLines((current) => [{ id: `${Date.now()}-${tone}`, time: nowLabel(), tone, text }, ...current].slice(0, 20));
  }, []);

  const confirmRestart = useCallback(async (server: MinecraftServer) => {
    let sawStopped = false;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await sleep(3000);
      if (!restartingIds.current.has(server.id)) return;
      try {
        const stats = await getCraftyServerStats(server.id);
        if (!restartingIds.current.has(server.id)) return;
        if (!stats.running) {
          sawStopped = true;
          continue;
        }
        if (sawStopped) {
          restartingIds.current.delete(server.id);
          setServers((current) => current.map((item) => item.id === server.id ? withConfirmedStats(item, stats) : item));
          const text = `${server.name} is back online. Crafty reports it running.`;
          setLastAction({ tone: 'success', text });
          pushLine('success', text);
          return;
        }
      } catch {
        // Keep waiting. A missed poll is not confirmation either way.
      }
    }

    if (!restartingIds.current.has(server.id)) return;
    let latest: CraftyStats | null = null;
    try {
      latest = await getCraftyServerStats(server.id);
    } catch {
      latest = null;
    }
    restartingIds.current.delete(server.id);
    if (!latest) {
      setServers((current) => current.map((item) => item.id === server.id ? { ...item, status: 'unknown', statsFresh: false } : item));
      const text = `Crafty accepted the restart for ${server.name}, then stopped reporting stats.`;
      setLastAction({ tone: 'error', text });
      pushLine('error', text);
      return;
    }
    setServers((current) => current.map((item) => item.id === server.id ? withConfirmedStats(item, latest) : item));
    const text = latest.running && !sawStopped
      ? `Crafty accepted the restart for ${server.name}, but the server never reported offline. It is still running.`
      : `Crafty accepted the restart for ${server.name}. The server is still offline.`;
    setLastAction({ tone: 'info', text });
    pushLine('warning', text);
  }, [pushLine]);

  const restartServer = useCallback((id: string) => {
    const server = serversRef.current.find((item) => item.id === id);
    if (!server || server.status === 'restarting' || restartingIds.current.has(id)) return;
    Alert.alert(
      `Restart ${server.name}?`,
      'Crafty will be asked to restart this server. Players may be disconnected. This app will not call it finished until Crafty reports the server online again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restart',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
              setLastAction({ tone: 'info', text: `Asking Crafty to restart ${server.name}…` });
              try {
                await runCraftyServerAction(id, { action: 'restart_server' satisfies CraftyActionRequestAction });
              } catch (cause) {
                const text = messageOf(cause, 'Crafty rejected the restart.');
                setLastAction({ tone: 'error', text });
                pushLine('error', text);
                return;
              }
              restartingIds.current.add(id);
              setServers((current) => current.map((item) => item.id === id ? { ...item, status: 'restarting' } : item));
              const accepted = `Crafty accepted a restart for ${server.name}. Waiting for it to report back.`;
              setLastAction({ tone: 'info', text: accepted });
              pushLine('warning', accepted);
              void confirmRestart(server);
            })();
          },
        },
      ],
    );
  }, [confirmRestart, pushLine]);

  const backupServer = useCallback((id: string) => {
    const server = serversRef.current.find((item) => item.id === id);
    if (!server) return;
    Alert.alert(
      `Back up ${server.name}?`,
      'Crafty will be asked to create a backup. A new archive is confirmed only after Crafty lists it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Back up',
          onPress: () => {
            void (async () => {
              setLastAction({ tone: 'info', text: `Asking Crafty to back up ${server.name}…` });
              let baseline: Set<string> | null = null;
              try {
                const before = await listCraftyServerBackups(id);
                baseline = new Set(before.backups.map((item) => item.id));
              } catch {
                baseline = null;
              }
              try {
                await runCraftyServerAction(id, { action: 'backup_server' satisfies CraftyActionRequestAction });
              } catch (cause) {
                const text = messageOf(cause, 'Crafty rejected the backup.');
                setLastAction({ tone: 'error', text });
                pushLine('error', text);
                return;
              }
              pushLine('warning', `Crafty accepted a backup for ${server.name}.`);
              if (!baseline) {
                setLastAction({ tone: 'info', text: `Crafty accepted the backup for ${server.name}. Existing backups could not be listed, so a new archive is not confirmed.` });
                return;
              }
              setLastAction({ tone: 'info', text: `Crafty accepted the backup for ${server.name}. Waiting for a new archive to be listed.` });
              const deadline = Date.now() + 45_000;
              while (Date.now() < deadline) {
                await sleep(3000);
                try {
                  const after = await listCraftyServerBackups(id);
                  const created = after.backups.find((item) => !baseline?.has(item.id));
                  if (created) {
                    const text = `Crafty listed a new backup for ${server.name}: ${created.name}.`;
                    setLastAction({ tone: 'success', text });
                    pushLine('success', text);
                    return;
                  }
                } catch {
                  // Keep waiting for a listed archive.
                }
              }
              setLastAction({ tone: 'info', text: `Crafty accepted the backup for ${server.name}, but no new archive is listed yet.` });
            })();
          },
        },
      ],
    );
  }, [pushLine]);

  const runCommand = useCallback(async (command: string) => {
    const trimmed = command.trim();
    const target = serversRef.current.find((server) => server.id === consoleTargetId) ?? serversRef.current[0];
    if (!trimmed || !target) return false;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      await sendCraftyServerCommand(target.id, { command: trimmed });
    } catch (cause) {
      const text = messageOf(cause, 'Crafty rejected the command.');
      setLastAction({ tone: 'error', text });
      pushLine('error', text);
      return false;
    }
    const text = `Crafty accepted "${trimmed}" for ${target.name}.`;
    setLastAction({ tone: 'success', text });
    pushLine('success', text);
    return true;
  }, [consoleTargetId, pushLine]);

  const value = useMemo(
    () => ({
      servers,
      lines,
      lastAction,
      isHydrated,
      isLoading,
      error,
      syncedAt,
      consoleTargetId,
      setConsoleTargetId,
      refresh: () => refresh(),
      restartServer,
      backupServer,
      runCommand,
      clearAction: () => setLastAction(null),
    }),
    [backupServer, consoleTargetId, error, isHydrated, isLoading, lastAction, lines, refresh, restartServer, runCommand, servers, syncedAt],
  );
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServerControl() {
  const context = useContext(ServerContext);
  if (!context) throw new Error('useServerControl must be used inside ServerProvider');
  return context;
}
