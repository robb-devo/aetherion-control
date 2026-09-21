import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { runCraftyServerAction, sendCraftyServerCommand, listCraftyServers, getCraftyServerStats, type CraftyActionRequestAction, type CraftyServer, type CraftyStats } from '@workspace/api-client-react';
import { useControlAuth } from '@/context/ControlAuth';

export type ServerStatus = 'online' | 'degraded' | 'offline' | 'restarting';

export type MinecraftServer = {
  id: string;
  name: string;
  tag: string;
  status: ServerStatus;
  players: number;
  maxPlayers: number;
  cpu: number;
  ram: number;
  disk: number;
  uptime: string;
  ip: string;
  version?: string;
  memoryLabel?: string;
};

export type ConsoleLine = {
  id: string;
  time: string;
  tone: 'normal' | 'success' | 'warning' | 'error';
  text: string;
};

const STORAGE_KEY = 'minecraft-server-control-state';

const initialLines: ConsoleLine[] = [
  { id: '1', time: '—', tone: 'normal', text: 'Connect to Crafty to load live console output.' },
];

type ServerContextValue = {
  servers: MinecraftServer[];
  lines: ConsoleLine[];
  lastAction: string | null;
  isHydrated: boolean;
  isLoading: boolean;
  error: string | null;
  consoleTargetId: string | null;
  setConsoleTargetId: (id: string) => void;
  refresh: () => Promise<void>;
  restartServer: (id: string) => void;
  runCommand: (command: string) => void;
  clearAction: () => void;
};

const ServerContext = createContext<ServerContextValue | null>(null);

function nowLabel() {
  return new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function asPercent(value: number) {
  // Crafty already returns percentages (cpu ~1.3, mem_percent ~6). Never multiply.
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function tagFor(server: CraftyServer) {
  return /proxy|velocity|gateway/i.test(server.name) ? 'EDGE' : 'PLAY';
}

function toMinecraftServer(server: CraftyServer, stats: CraftyStats | null): MinecraftServer {
  const running = stats?.running ?? false;
  const cpu = asPercent(stats?.cpu ?? 0);
  return {
    id: server.id,
    name: server.name,
    tag: tagFor(server),
    status: running ? (cpu > 82 ? 'degraded' : 'online') : 'offline',
    players: stats?.online ?? 0,
    maxPlayers: stats?.maxPlayers ?? 0,
    cpu,
    ram: asPercent(stats?.memoryPercent ?? 0),
    disk: 0,
    uptime: stats?.uptime ?? (running ? 'Live' : 'Offline'),
    ip: `${server.ip}:${server.port}`,
    version: stats?.version,
    memoryLabel: stats?.memory,
  };
}

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const { isUnlocked } = useControlAuth();
  const [servers, setServers] = useState<MinecraftServer[]>([]);
  const [lines, setLines] = useState<ConsoleLine[]>(initialLines);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consoleTargetId, setConsoleTargetId] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!value) return;
        const saved = JSON.parse(value) as { lines?: ConsoleLine[] };
        // Do not restore server metrics from cache — they go stale and look like placeholders.
        if (saved.lines?.length) setLines(saved.lines);
      })
      .catch(() => undefined)
      .finally(() => setIsHydrated(true));
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await listCraftyServers();
      const liveServers = await Promise.all(response.servers.map(async (server) => {
        try {
          return toMinecraftServer(server, await getCraftyServerStats(server.id));
        } catch {
          return toMinecraftServer(server, null);
        }
      }));
      setServers(liveServers);
      setConsoleTargetId((current) => {
        if (current && liveServers.some((server) => server.id === current)) return current;
        const preferred =
          liveServers.find((server) => /mmo-r/i.test(server.name)) ??
          liveServers.find((server) => server.tag === 'PLAY') ??
          liveServers[0];
        return preferred?.id ?? null;
      });
      setLines((current) => current[0]?.text === initialLines[0].text ? [{ id: `${Date.now()}-connected`, time: nowLabel(), tone: 'success', text: `Connected to Crafty · ${liveServers.length} servers loaded` }] : current);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Crafty could not be reached.';
      setError(message);
      setLastAction('Crafty-Verbindung konnte nicht geladen werden');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isHydrated && isUnlocked) {
      void refresh();
      const timer = setInterval(() => void refresh(), 10000);
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

  const restartServer = (id: string) => {
    const server = servers.find((item) => item.id === id);
    if (!server || server.status === 'restarting') return;
    Alert.alert(
      `Restart ${server.name}?`,
      'Crafty will stop and start this server. Players may be disconnected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restart',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
              setServers((current) => current.map((item) => item.id === id ? { ...item, status: 'restarting' } : item));
              setLastAction(`${server.name} wird neu gestartet`);
              setLines((current) => [{ id: `${Date.now()}-restart`, time: nowLabel(), tone: 'warning' as const, text: `Restart requested for ${server.name}` }, ...current].slice(0, 20));
              try {
                await runCraftyServerAction(id, { action: 'restart_server' satisfies CraftyActionRequestAction });
                setTimeout(() => void refresh(), 2200);
              } catch (cause) {
                setServers((current) => current.map((item) => item.id === id ? { ...item, status: 'offline' } : item));
                setLastAction(cause instanceof Error ? cause.message : 'Restart failed');
              }
            })();
          },
        },
      ],
    );
  };

  const runCommand = (command: string) => {
    const trimmed = command.trim();
    const target = servers.find((server) => server.id === consoleTargetId) ?? servers[0];
    if (!trimmed || !target) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setLines((current) => [{ id: `${Date.now()}-command`, time: nowLabel(), tone: 'normal' as const, text: `> [${target.name}] ${trimmed}` }, ...current].slice(0, 40));
    void sendCraftyServerCommand(target.id, { command: trimmed })
      .then(() => setLastAction(`Befehl an ${target.name} gesendet`))
      .catch((cause) => setLastAction(cause instanceof Error ? cause.message : 'Command failed'));
  };

  const value = useMemo(
    () => ({
      servers,
      lines,
      lastAction,
      isHydrated,
      isLoading,
      error,
      consoleTargetId,
      setConsoleTargetId,
      refresh,
      restartServer,
      runCommand,
      clearAction: () => setLastAction(null),
    }),
    [consoleTargetId, error, isHydrated, isLoading, lastAction, lines, refresh, servers],
  );
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServerControl() {
  const context = useContext(ServerContext);
  if (!context) throw new Error('useServerControl must be used inside ServerProvider');
  return context;
}
