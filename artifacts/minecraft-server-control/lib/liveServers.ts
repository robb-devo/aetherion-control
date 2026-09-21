export type ServerStatus = 'online' | 'offline' | 'restarting' | 'unknown';

export type CraftyServerLike = {
  id: string;
  name: string;
  ip: string;
  port: number;
};

export type CraftyStatsLike = {
  running: boolean;
  cpu: number;
  memoryPercent: number;
  online: number;
  maxPlayers: number;
  memory?: string;
  version?: string;
  uptime?: string;
};

export type MinecraftServer = {
  id: string;
  name: string;
  tag: string;
  status: ServerStatus;
  players: number | null;
  maxPlayers: number | null;
  cpu: number | null;
  ram: number | null;
  uptime: string | null;
  ip: string;
  version?: string;
  memoryLabel?: string;
  /** True only when Crafty returned a stats payload for this poll. */
  metricsKnown: boolean;
  /** False when the numbers were kept from an older successful poll. */
  statsFresh: boolean;
};

export type ServerSummary = {
  count: number;
  online: number;
  players: number | null;
  averageCpu: number | null;
  partial: boolean;
  stale: boolean;
};

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function displayText(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return null;
  return trimmed;
}

export function tagFor(name: string) {
  return /proxy|velocity|gateway/i.test(name) ? 'EDGE' : 'PLAY';
}

export function toMinecraftServer(server: CraftyServerLike, stats: CraftyStatsLike | null): MinecraftServer {
  const endpoint = `${server.ip}:${server.port}`;
  if (!stats) {
    return {
      id: server.id,
      name: server.name,
      tag: tagFor(server.name),
      status: 'unknown',
      players: null,
      maxPlayers: null,
      cpu: null,
      ram: null,
      uptime: null,
      ip: endpoint,
      metricsKnown: false,
      statsFresh: false,
    };
  }

  const cpu = finite(stats.cpu);
  const ram = finite(stats.memoryPercent);
  return {
    id: server.id,
    name: server.name,
    tag: tagFor(server.name),
    status: stats.running ? 'online' : 'offline',
    players: finite(stats.online),
    maxPlayers: finite(stats.maxPlayers),
    cpu: cpu == null ? null : Math.round(cpu * 10) / 10,
    ram: ram == null ? null : Math.round(ram),
    uptime: displayText(stats.uptime),
    ip: endpoint,
    version: displayText(stats.version) ?? undefined,
    memoryLabel: displayText(stats.memory) ?? undefined,
    metricsKnown: true,
    statsFresh: true,
  };
}

export function mergeLiveServers(
  previous: readonly MinecraftServer[],
  incoming: readonly MinecraftServer[],
  restartingIds: ReadonlySet<string>,
): MinecraftServer[] {
  return incoming.map((server) => {
    const prior = previous.find((item) => item.id === server.id);
    if (restartingIds.has(server.id)) {
      return prior ? { ...prior, status: 'restarting' } : { ...server, status: 'restarting' };
    }
    if (!server.metricsKnown && prior?.metricsKnown) {
      return { ...prior, statsFresh: false };
    }
    return server;
  });
}

export function findEdgeServer(servers: readonly MinecraftServer[]): MinecraftServer | undefined {
  return servers.find((server) => server.tag === 'EDGE');
}

export function withConfirmedStats(current: MinecraftServer, stats: CraftyStatsLike): MinecraftServer {
  const splitAt = current.ip.lastIndexOf(':');
  const ip = splitAt >= 0 ? current.ip.slice(0, splitAt) : current.ip;
  const port = splitAt >= 0 ? Number(current.ip.slice(splitAt + 1)) : 25565;
  return toMinecraftServer({ id: current.id, name: current.name, ip, port: Number.isFinite(port) ? port : 25565 }, stats);
}

export function summarizeServers(servers: readonly MinecraftServer[]): ServerSummary {
  const measured = servers.filter((server) => server.metricsKnown && server.players != null && server.cpu != null);
  const players = measured.reduce((sum, server) => sum + (server.players ?? 0), 0);
  const averageCpu = measured.length
    ? Math.round((measured.reduce((sum, server) => sum + (server.cpu ?? 0), 0) / measured.length) * 10) / 10
    : null;
  return {
    count: servers.length,
    online: servers.filter((server) => server.status === 'online').length,
    players: measured.length ? players : null,
    averageCpu,
    partial: measured.length !== servers.length,
    stale: servers.some((server) => server.metricsKnown && !server.statsFresh),
  };
}

export function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}
