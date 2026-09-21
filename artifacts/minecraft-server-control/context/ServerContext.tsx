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
import { watchNewBackup, watchRestart, watchRunning } from '@/lib/craftyConfirm';
import {
  findEdgeServer,
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
  consoleDraft: string | null;
  setConsoleTargetId: (id: string) => void;
  stageConsoleCommand: (command: string) => void;
  clearConsoleDraft: () => void;
  refresh: () => Promise<void>;
  restartServer: (id: string) => void;
  restartProxy: () => void;
  backupNow: () => void;
  executeCraftyAction: (
    id: string,
    action: CraftyActionRequestAction,
    onUpdate?: (notice: ActionNotice) => void,
  ) => Promise<ActionNotice>;
  runCommand: (command: string) => Promise<boolean>;
  clearAction: () => void;
};

const ServerContext = createContext<ServerContextValue | null>(null);

function nowLabel() {
  return new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function messageOf(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function readStats(id: string): Promise<CraftyStats | null> {
  return getCraftyServerStats(id).catch(() => null);
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
  const [consoleDraft, setConsoleDraft] = useState<string | null>(null);
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
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ lines: lines.slice(0, 30) })).catch(() => undefined);
  }, [isHydrated, lines]);

  const pushLine = useCallback((tone: ConsoleLine['tone'], text: string) => {
    setLines((current) => [{ id: `${Date.now()}-${tone}`, time: nowLabel(), tone, text }, ...current].slice(0, 20));
  }, []);

  const report = useCallback((tone: ActionNotice['tone'], text: string, onUpdate?: (notice: ActionNotice) => void) => {
    const notice = { tone, text };
    setLastAction(notice);
    onUpdate?.(notice);
    return notice;
  }, []);

  const executeCraftyAction = useCallback(async (
    id: string,
    action: CraftyActionRequestAction,
    onUpdate?: (notice: ActionNotice) => void,
  ) => {
    const server = serversRef.current.find((item) => item.id === id);
    const name = server?.name ?? 'server';
    if (action === 'restart_server' && (server?.status === 'restarting' || restartingIds.current.has(id))) {
      return report('info', `${name} is already restarting.`, onUpdate);
    }

    let baseline: Set<string> | null = null;
    if (action === 'backup_server') {
      report('info', `Asking Crafty to back up ${name}…`, onUpdate);
      try {
        const before = await listCraftyServerBackups(id);
        baseline = new Set(before.backups.map((item) => item.id));
      } catch {
        baseline = null;
      }
    } else {
      const verb = action === 'restart_server' ? 'restart' : action === 'start_server' ? 'start' : action === 'stop_server' ? 'stop' : action.replace('_', ' ');
      report('info', `Asking Crafty to ${verb} ${name}…`, onUpdate);
    }

    try {
      await runCraftyServerAction(id, { action });
    } catch (cause) {
      const text = messageOf(cause, 'Crafty rejected the action.');
      pushLine('error', text);
      return report('error', text, onUpdate);
    }

    if (action === 'restart_server') {
      restartingIds.current.add(id);
      setServers((current) => current.map((item) => item.id === id ? { ...item, status: 'restarting' } : item));
      const accepted = `Crafty accepted a restart for ${name}. Waiting until it reports offline, then online.`;
      pushLine('warning', accepted);
      report('info', accepted, onUpdate);
      const outcome = await watchRestart(
        () => readStats(id),
        () => restartingIds.current.has(id),
      );
      if (!restartingIds.current.has(id)) {
        return report('info', `Stopped waiting on ${name}.`, onUpdate);
      }
      restartingIds.current.delete(id);
      if (outcome.stats && server) {
        const confirmed = outcome.stats;
        setServers((current) => current.map((item) => item.id === id ? withConfirmedStats(item, confirmed) : item));
      } else if (!outcome.stats) {
        setServers((current) => current.map((item) => item.id === id ? { ...item, status: 'unknown', statsFresh: false } : item));
      }
      const text = outcome.outcome === 'online'
        ? `${name} is back online. Crafty reports it running.`
        : outcome.outcome === 'offline'
          ? `Crafty accepted the restart for ${name}. The server is still offline.`
          : outcome.outcome === 'still-running'
            ? `Crafty accepted the restart for ${name}, but the server never reported offline. It is still running.`
            : `Crafty accepted the restart for ${name}, then stopped reporting stats.`;
      const tone = outcome.outcome === 'online' ? 'success' : outcome.outcome === 'unreported' ? 'error' : 'info';
      pushLine(outcome.outcome === 'online' ? 'success' : 'warning', text);
      return report(tone, text, onUpdate);
    }

    if (action === 'backup_server') {
      pushLine('warning', `Crafty accepted a backup for ${name}.`);
      if (!baseline) {
        return report('info', `Crafty accepted the backup for ${name}. Existing backups could not be listed, so a new archive is not confirmed.`, onUpdate);
      }
      report('info', `Crafty accepted the backup for ${name}. Waiting for a new archive to be listed.`, onUpdate);
      const created = await watchNewBackup(async () => {
        try {
          const after = await listCraftyServerBackups(id);
          return after.backups;
        } catch {
          return null;
        }
      }, baseline);
      if (created) {
        const text = `Crafty listed a new backup for ${name}: ${created}.`;
        pushLine('success', text);
        return report('success', text, onUpdate);
      }
      return report('info', `Crafty accepted the backup for ${name}, but no new archive is listed yet.`, onUpdate);
    }

    const expected = action === 'start_server';
    const verb = expected ? 'start' : 'stop';
    report('info', `Crafty accepted the ${verb} for ${name}. Waiting for Crafty to report the server ${expected ? 'online' : 'offline'}.`, onUpdate);
    const confirmed = await watchRunning(() => readStats(id), expected);
    if (confirmed) {
      setServers((current) => current.map((item) => item.id === id ? withConfirmedStats(item, confirmed) : item));
      const text = `${name} is ${expected ? 'online' : 'offline'}. Crafty reported that state.`;
      pushLine('success', text);
      return report('success', text, onUpdate);
    }
    const text = `Crafty accepted the ${verb} for ${name}, but has not reported the server ${expected ? 'online' : 'offline'} yet.`;
    pushLine('warning', text);
    return report('info', text, onUpdate);
  }, [pushLine, report]);

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
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
            void executeCraftyAction(id, 'restart_server');
          },
        },
      ],
    );
  }, [executeCraftyAction]);

  const restartProxy = useCallback(() => {
    const proxy = findEdgeServer(serversRef.current);
    if (!proxy) {
      Alert.alert('No proxy', 'Crafty did not return a Velocity, proxy, or gateway server.');
      return;
    }
    restartServer(proxy.id);
  }, [restartServer]);

  const backupNow = useCallback(() => {
    const current = serversRef.current;
    const targets = current.filter((server) => server.tag === 'PLAY' || /mmo|hub/i.test(server.name));
    const list = targets.length ? targets : current;
    if (!list.length) {
      Alert.alert('No servers', 'Crafty did not return any servers for backup.');
      return;
    }
    Alert.alert(
      'Backup now?',
      `Crafty will be asked to back up:\n${list.map((server) => `• ${server.name}`).join('\n')}\n\nA backup counts only after Crafty lists a new archive.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Backup',
          onPress: () => {
            void (async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
              const results: ActionNotice[] = [];
              for (const server of list) {
                results.push(await executeCraftyAction(server.id, 'backup_server'));
              }
              const confirmed = results.filter((item) => item.tone === 'success').length;
              const rejected = results.filter((item) => item.tone === 'error').length;
              const tone = confirmed === list.length ? 'success' : rejected > 0 && confirmed === 0 ? 'error' : 'info';
              const text = `Backup check finished. Crafty listed a new archive for ${confirmed}/${list.length} servers.`;
              setLastAction({ tone, text });
              pushLine(confirmed === list.length ? 'success' : 'warning', text);
            })();
          },
        },
      ],
    );
  }, [executeCraftyAction, pushLine]);

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
      consoleDraft,
      setConsoleTargetId,
      stageConsoleCommand: (command: string) => setConsoleDraft(command),
      clearConsoleDraft: () => setConsoleDraft(null),
      refresh: () => refresh(),
      restartServer,
      restartProxy,
      backupNow,
      executeCraftyAction,
      runCommand,
      clearAction: () => setLastAction(null),
    }),
    [backupNow, consoleDraft, consoleTargetId, error, executeCraftyAction, isHydrated, isLoading, lastAction, lines, refresh, restartProxy, restartServer, runCommand, servers, syncedAt],
  );
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServerControl() {
  const context = useContext(ServerContext);
  if (!context) throw new Error('useServerControl must be used inside ServerProvider');
  return context;
}
