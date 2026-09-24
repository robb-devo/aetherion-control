import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import {
  craftyRequest,
  listCraftyServers,
  runCraftyAction,
  saveCraftyFile,
  getCraftyFiles,
  getCraftyLogs,
  getCraftyStats,
  normalizeServerPath,
  sendCraftyCommand,
  type CraftyServer,
  type CraftyStats,
} from "./crafty";
import { nodeFor } from "./nodes";
import { findServerProcess, invalidateProbe } from "./serverProbe";
import { findOwned, omitOwner, visibleToOwner, type OwnerScope } from "./sandboxOwners.mjs";

const execFileAsync = promisify(execFile);

export type SandboxType = "vanilla" | "paper" | "fabric" | "purpur";
export type SandboxPreset = "light" | "balanced" | "performance" | "max" | "large" | "custom";
export type SandboxDifficulty = "peaceful" | "easy" | "normal" | "hard";
export type SandboxGamemode = "survival" | "creative" | "adventure" | "spectator";
export type SandboxSource = "launcher" | "web";

export type SandboxCreateInput = {
  name: string;
  serverType: SandboxType;
  version: string;
  ramGb: number;
  cpuCores: number;
  /** Exact heap in MB. When set it wins over ramGb/preset (website tiers). */
  ramMb?: number;
  displayName?: string;
  source?: SandboxSource;
  preset?: SandboxPreset;
  maxPlayers?: number;
  viewDistance?: number;
  simulationDistance?: number;
  difficulty?: SandboxDifficulty;
  gamemode?: SandboxGamemode;
  onlineMode?: boolean;
  motd?: string;
  startAfterCreate?: boolean;
};

export type SandboxRecord = {
  id: string;
  name: string;
  serverType: SandboxType;
  version: string;
  /** May be fractional (0.5) for rows created with ramMb. */
  ramGb: number;
  cpuCores: number;
  preset: SandboxPreset;
  maxPlayers: number;
  viewDistance: number;
  simulationDistance: number;
  difficulty: SandboxDifficulty;
  gamemode: SandboxGamemode;
  onlineMode: boolean;
  motd: string;
  port: number;
  createdAt: string;
  /** sha256 of the access identity. Absent only on rows created before scoping. */
  ownerId?: string;
  /** Absent on rows created before MB tiers; derive from ramGb. */
  ramMb?: number;
  /** Free-text name for the website; `name` stays the Crafty slug. */
  displayName?: string;
  /** Absent on rows created before nodes; they live on the first node. */
  nodeId?: string;
  source?: SandboxSource;
};

export class SandboxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

function storePath() {
  return process.env.SANDBOX_STORE_PATH || "/var/lib/aetherion-control/sandboxes.json";
}

const POOL_GB = Number(process.env.SANDBOX_POOL_GB || 64);
const MAX_GB = Number(process.env.SANDBOX_MAX_GB || 24);
const POOL_CORES = Number(process.env.SANDBOX_POOL_CORES || 8);
const MAX_CORES = Number(process.env.SANDBOX_MAX_CORES || 4);
const PORT_START = Number(process.env.SANDBOX_PORT_START || 25600);
const PORT_END = Number(process.env.SANDBOX_PORT_END || 25649);
const PUBLIC_IP = process.env.PUBLIC_HOST_IP?.trim() || process.env.DEDICATED_HOST_IP?.trim() || "135.181.18.162";
export const MIN_SANDBOX_RAM_MB = 512;

const allowedTypes = new Set<SandboxType>(["vanilla", "paper", "fabric", "purpur"]);
const allowedDiff = new Set<SandboxDifficulty>(["peaceful", "easy", "normal", "hard"]);
const allowedModes = new Set<SandboxGamemode>(["survival", "creative", "adventure", "spectator"]);

type JarCache = {
  mc_java_servers?: {
    types?: Record<string, { versions?: Record<string, unknown> }>;
  };
};

/**
 * `balanced` is 16 GB because the desktop launcher preselects that preset id.
 * `large` is the 24 GB choice. Core caps stay 4 per sandbox and 8 in the pool.
 * These rows are new Crafty servers in the sandbox port range only.
 */
const PRESETS: Record<Exclude<SandboxPreset, "custom">, { ramGb: number; cpuCores: number; label: string; blurb: string }> = {
  light: { ramGb: 2, cpuCores: 1, label: "Light", blurb: "Quick tests · tiny worlds" },
  performance: { ramGb: 6, cpuCores: 3, label: "Performance", blurb: "Mods & heavier worlds" },
  max: { ramGb: 8, cpuCores: 4, label: "Max", blurb: "Heavier sandbox, still under 16 GB" },
  balanced: { ramGb: 16, cpuCores: 4, label: "16 GB", blurb: "Default · friends on spare RAM" },
  large: { ramGb: 24, cpuCores: 4, label: "24 GB", blurb: "Largest sandbox preset" },
};

export const DEFAULT_SANDBOX_PRESET: Exclude<SandboxPreset, "custom"> = "balanced";

export function sandboxPresetCatalog() {
  return {
    defaultPreset: DEFAULT_SANDBOX_PRESET,
    defaultRamGb: PRESETS[DEFAULT_SANDBOX_PRESET].ramGb,
    maxRamGb: MAX_GB,
    poolGb: POOL_GB,
    maxCores: MAX_CORES,
    poolCores: POOL_CORES,
    presets: PRESETS,
  };
}

function loadStore(): SandboxRecord[] {
  try {
    const file = storePath();
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, "utf8")) as SandboxRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveStore(rows: SandboxRecord[]) {
  const file = storePath();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
}

/** Read-modify-write in one synchronous step so concurrent requests cannot drop rows. */
function mutateStore(change: (rows: SandboxRecord[]) => SandboxRecord[]) {
  saveStore(change(loadStore()));
}

function sanitizeName(value: string) {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned.length < 2 || cleaned.length > 24) {
    throw new Error("Name must be 2–24 chars (letters, numbers, hyphens).");
  }
  return cleaned.startsWith("sandbox-") ? cleaned : `sandbox-${cleaned}`;
}

export function recordRamMb(row: Pick<SandboxRecord, "ramGb" | "ramMb">) {
  return row.ramMb ?? Math.round(row.ramGb * 1024);
}

export function displayNameOf(row: Pick<SandboxRecord, "name" | "displayName">) {
  return row.displayName || row.name.replace(/^sandbox-/, "");
}

function formatGb(mb: number) {
  const gb = mb / 1024;
  return Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
}

// ---------------------------------------------------------------------------
// Live state. Pool accounting counts running servers (plus starts in flight),
// not every server that exists, so owners can keep many stopped worlds.

const CRAFTY_LIST_TTL_MS = 10_000;
const STATS_TTL_MS = 5_000;
const START_RESERVATION_MS = 120_000;

let craftyListCache: { at: number; servers: CraftyServer[] } | null = null;
const statsCache = new Map<string, { at: number; stats: CraftyStats }>();
const startReservations = new Map<string, number>();

async function craftyServers(force = false) {
  if (!force && craftyListCache && Date.now() - craftyListCache.at < CRAFTY_LIST_TTL_MS) {
    return craftyListCache.servers;
  }
  const servers = await listCraftyServers();
  craftyListCache = { at: Date.now(), servers };
  return servers;
}

export async function craftyServerFor(id: string) {
  const servers = await craftyServers();
  return servers.find((server) => server.id === id) ?? (await craftyServers(true)).find((server) => server.id === id);
}

export async function cachedStats(id: string) {
  const hit = statsCache.get(id);
  if (hit && Date.now() - hit.at < STATS_TTL_MS) return hit.stats;
  const stats = await getCraftyStats(id);
  statsCache.set(id, { at: Date.now(), stats });
  return stats;
}

function isReserved(id: string) {
  const until = startReservations.get(id);
  if (!until) return false;
  if (until < Date.now()) {
    startReservations.delete(id);
    return false;
  }
  return true;
}

function releaseReservation(id: string) {
  startReservations.delete(id);
}

/** Process table first (real time); Crafty stats only where the probe cannot answer. */
export async function sandboxProcess(row: Pick<SandboxRecord, "id">) {
  let server: CraftyServer | undefined;
  try {
    server = await craftyServerFor(row.id);
  } catch {
    server = undefined;
  }
  const found = findServerProcess(server?.path);
  if (found !== undefined) return { running: found !== null, process: found };
  try {
    return { running: (await cachedStats(row.id)).running, process: undefined };
  } catch {
    return { running: false, process: undefined };
  }
}

export async function isSandboxRunning(row: Pick<SandboxRecord, "id">) {
  return (await sandboxProcess(row)).running;
}

async function runningSandboxes(rows = loadStore()) {
  const flags = await Promise.all(rows.map(async (row) => isReserved(row.id) || (await isSandboxRunning(row))));
  return rows.filter((_, index) => flags[index]);
}

function nodeUsage(running: SandboxRecord[], nodeId: string | undefined, excludeId?: string) {
  const node = nodeFor(nodeId);
  const onNode = running.filter((row) => row.id !== excludeId && nodeFor(row.nodeId).id === node.id);
  return {
    node,
    usedMb: onNode.reduce((sum, row) => sum + recordRamMb(row), 0),
    usedCores: onNode.reduce((sum, row) => sum + (row.cpuCores || 0), 0),
  };
}

function assertPoolFits(
  running: SandboxRecord[],
  candidate: { id?: string; ramMb: number; cpuCores: number; nodeId?: string },
) {
  const { node, usedMb, usedCores } = nodeUsage(running, candidate.nodeId, candidate.id);
  if (usedMb + candidate.ramMb > node.poolMb) {
    throw new SandboxError(
      "POOL_FULL",
      `Not enough sandbox RAM left (${formatGb(Math.max(0, node.poolMb - usedMb))} GB free of ${formatGb(node.poolMb)} GB).`,
      409,
      { freeMb: Math.max(0, node.poolMb - usedMb), poolMb: node.poolMb },
    );
  }
  if (usedCores + candidate.cpuCores > node.poolCores) {
    throw new SandboxError(
      "POOL_FULL",
      `Not enough sandbox CPU left (${Math.max(0, node.poolCores - usedCores)} cores free of ${node.poolCores}).`,
      409,
    );
  }
}

export async function sandboxPoolSummary(nodeId?: string) {
  const { node, usedMb, usedCores } = nodeUsage(await runningSandboxes(), nodeId);
  return {
    nodeId: node.id,
    poolMb: node.poolMb,
    usedMb,
    freeMb: Math.max(0, node.poolMb - usedMb),
    poolCores: node.poolCores,
    usedCores,
    freeCores: Math.max(0, node.poolCores - usedCores),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const STOP_FALLBACK_MS = 12_000;
const STOP_DEADLINE_MS = 75_000;
const CRAFTY_STOP_SETTLE_MS = 8_000;
const recentStops = new Map<string, number>();

/**
 * Crafty stops servers on a single background worker. If that worker is busy or
 * wedged, the stop never happens, so Minecraft is also asked directly over stdin.
 */
async function requestStop(id: string) {
  await runCraftyAction(id, "stop_server");
  recentStops.set(id, Date.now());
  const fallback = setTimeout(() => {
    invalidateProbe();
    void isSandboxRunning({ id })
      .then((running) => (running ? sendCraftyCommand(id, "stop") : undefined))
      .catch(() => undefined);
  }, STOP_FALLBACK_MS);
  fallback.unref();
}

/**
 * Crafty notices a stopped process on its next 2 s poll and only then removes
 * the server's jobs. Deleting the server before that throws inside Crafty's
 * command worker and halts start/stop for every server until Crafty restarts.
 */
async function waitForStopToSettle(row: Pick<SandboxRecord, "id">) {
  const requested = recentStops.get(row.id);
  if (!requested || Date.now() - requested > 3 * 60_000) return;
  const deadline = requested + STOP_DEADLINE_MS;
  for (;;) {
    invalidateProbe();
    if (!(await isSandboxRunning(row))) break;
    if (Date.now() > deadline) {
      throw new SandboxError("BUSY", "The server is still shutting down. Try again in a minute.", 409);
    }
    await sleep(1500);
  }
  await sleep(CRAFTY_STOP_SETTLE_MS);
}

let startLock: Promise<unknown> = Promise.resolve();

/** Serialises the check-and-reserve step of starts so two requests cannot both pass it. */
function withStartLock<T>(task: () => Promise<T>) {
  const run = startLock.then(task, task);
  startLock = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------

async function openFirewall(port: number) {
  try {
    await execFileAsync("ufw", ["allow", `${port}/tcp`], { timeout: 15000 });
    await execFileAsync("ufw", ["allow", `${port}/udp`], { timeout: 15000 });
  } catch (error) {
    console.warn("ufw open failed", error);
  }
}

async function closeFirewall(port: number) {
  try {
    await execFileAsync("ufw", ["delete", "allow", `${port}/tcp`], { timeout: 15000 });
    await execFileAsync("ufw", ["delete", "allow", `${port}/udp`], { timeout: 15000 });
  } catch {
    // ignore
  }
}

async function usedPorts() {
  const ports = new Set<number>();
  for (const row of loadStore()) ports.add(row.port);
  try {
    const servers = await listCraftyServers();
    for (const server of servers) if (server.port) ports.add(server.port);
  } catch {
    // keep store ports only
  }
  return ports;
}

async function nextPort(nodeId?: string) {
  const node = nodeFor(nodeId);
  const used = await usedPorts();
  for (let port = node.portStart; port <= node.portEnd; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new SandboxError("NO_PORTS", `No free sandbox ports left (${node.portStart}–${node.portEnd}).`, 503);
}

function heapFlag(mb: number) {
  return mb % 1024 === 0 ? `${mb / 1024}G` : `${mb}M`;
}

export function buildJavaCommand(executable: string, ramMb: number, cpuCores: number) {
  // Keep the launch line compact — Crafty + Java 25 choke on mega Aikar strings for fresh jars.
  const xmsMb = ramMb >= 1024 ? Math.min(ramMb, Math.max(1024, Math.floor(ramMb / 2048) * 1024)) : Math.floor(ramMb / 2);
  return [
    "java",
    `-Xms${heapFlag(xmsMb)}`,
    `-Xmx${heapFlag(ramMb)}`,
    `-XX:ActiveProcessorCount=${cpuCores}`,
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-jar",
    executable || "server.jar",
    "nogui",
  ].join(" ");
}

export function patchProperties(raw: string, patch: Record<string, string>) {
  const lines = raw.length ? raw.replace(/\r\n/g, "\n").split("\n") : [];
  const seen = new Set<string>();
  const next = lines.map((line) => {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) return line;
    const key = line.split("=", 1)[0];
    if (key in patch) {
      seen.add(key);
      return `${key}=${patch[key]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(patch)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  if (!next[next.length - 1]) return `${next.join("\n")}`;
  return `${next.join("\n")}\n`;
}

const JAR_CACHE_TTL_MS = 5 * 60_000;
let jarCache: { at: number; types: Record<string, { versions?: Record<string, unknown> }> } | null = null;

export async function sandboxVersions() {
  if (!jarCache || Date.now() - jarCache.at > JAR_CACHE_TTL_MS) {
    const cache = await craftyRequest<JarCache>("/api/v2/crafty/JarCache");
    jarCache = { at: Date.now(), types: cache.mc_java_servers?.types ?? {} };
  }
  const types = jarCache.types;
  const versionsFor = (key: string) => Object.keys(types[key]?.versions ?? {}).slice(0, 50);
  return {
    vanilla: versionsFor("vanilla"),
    paper: versionsFor("paper"),
    fabric: versionsFor("fabric"),
    purpur: versionsFor("purpur"),
  } satisfies Record<SandboxType, string[]>;
}

export async function getSandboxOptions() {
  const versions = await sandboxVersions();
  const running = await runningSandboxes();
  const usedRamGb = Math.round((running.reduce((sum, row) => sum + recordRamMb(row), 0) / 1024) * 10) / 10;
  const usedCores = running.reduce((sum, row) => sum + (row.cpuCores || 0), 0);
  return {
    poolGb: POOL_GB,
    maxRamGb: MAX_GB,
    poolCores: POOL_CORES,
    maxCores: MAX_CORES,
    usedRamGb,
    remainingRamGb: Math.max(0, POOL_GB - usedRamGb),
    usedCores,
    remainingCores: Math.max(0, POOL_CORES - usedCores),
    publicIp: PUBLIC_IP,
    portRange: { start: PORT_START, end: PORT_END },
    presets: Object.entries(PRESETS).map(([value, preset]) => ({
      value,
      label: preset.label,
      blurb: preset.blurb,
      ramGb: preset.ramGb,
      cpuCores: preset.cpuCores,
    })),
    serverTypes: [
      { value: "vanilla", label: "Vanilla", blurb: "Stock Minecraft" },
      { value: "paper", label: "Paper", blurb: "Fast + plugin-ready" },
      { value: "fabric", label: "Fabric", blurb: "Modded ecosystem" },
      { value: "purpur", label: "Purpur", blurb: "Paper fork, extra knobs" },
    ],
    versions,
    ramChoices: [1, 2, 3, 4, 5, 6, 7, 8, 16, 24],
    cpuChoices: [1, 2, 3, 4],
    difficulties: ["peaceful", "easy", "normal", "hard"],
    gamemodes: ["survival", "creative", "adventure", "spectator"],
    defaults: {
      preset: DEFAULT_SANDBOX_PRESET,
      ramGb: PRESETS[DEFAULT_SANDBOX_PRESET].ramGb,
      cpuCores: PRESETS[DEFAULT_SANDBOX_PRESET].cpuCores,
      maxPlayers: 12,
      viewDistance: 8,
      simulationDistance: 6,
      difficulty: "normal",
      gamemode: "survival",
      onlineMode: true,
      motd: "AETHERION Sandbox",
    },
  };
}

function publicSandbox(row: SandboxRecord) {
  return {
    ...omitOwner(row),
    address: `${PUBLIC_IP}:${row.port}`,
  };
}

export function listSandboxes(scope: OwnerScope) {
  return visibleToOwner(loadStore(), scope).map((row) => publicSandbox(row));
}

/** Every row, for background maintenance only. Never return these to a client. */
export function allSandboxRecords() {
  return loadStore();
}

/** Raw owned rows (owner id stripped by callers that expose them). */
export function listOwnedSandboxes(scope: OwnerScope) {
  return visibleToOwner(loadStore(), scope);
}

export function getOwnedSandbox(id: string, scope: OwnerScope) {
  const row = findOwned(loadStore(), id, scope);
  if (!row) throw new SandboxError("NOT_FOUND", "Sandbox not found.", 404);
  return row;
}

/**
 * Creates a new Crafty server named `sandbox-*` on the sandbox port range.
 * Start, stop, and delete only accept ids stored for that owner. They never
 * target production network servers.
 */
export async function createSandbox(input: SandboxCreateInput, scope: OwnerScope) {
  if (!scope?.ownerId) throw new Error("Missing sandbox owner.");
  const name = sanitizeName(input.name);
  const serverType = input.serverType;
  const version = String(input.version || "").trim();
  let ramGb = Number(input.ramGb);
  let cpuCores = Number(input.cpuCores);
  let preset: SandboxPreset = input.ramMb != null ? "custom" : input.preset || DEFAULT_SANDBOX_PRESET;

  if (preset !== "custom" && PRESETS[preset]) {
    ramGb = PRESETS[preset].ramGb;
    cpuCores = PRESETS[preset].cpuCores;
  }

  let ramMb: number;
  if (input.ramMb != null) {
    ramMb = Number(input.ramMb);
    if (!Number.isInteger(ramMb) || ramMb < MIN_SANDBOX_RAM_MB || ramMb > MAX_GB * 1024) {
      throw new Error(`RAM must be between ${MIN_SANDBOX_RAM_MB} MB and ${MAX_GB} GB.`);
    }
    ramGb = ramMb / 1024;
  } else {
    if (!Number.isInteger(ramGb) || ramGb < 1 || ramGb > MAX_GB) {
      throw new Error(`RAM must be an integer from 1–${MAX_GB} GB.`);
    }
    ramMb = ramGb * 1024;
  }

  const maxPlayers = Math.max(1, Math.min(40, Number(input.maxPlayers ?? 12)));
  const viewDistance = Math.max(4, Math.min(16, Number(input.viewDistance ?? 8)));
  const simulationDistance = Math.max(3, Math.min(12, Number(input.simulationDistance ?? 6)));
  const difficulty = (input.difficulty || "normal") as SandboxDifficulty;
  const gamemode = (input.gamemode || "survival") as SandboxGamemode;
  const onlineMode = input.onlineMode !== false;
  const motd = String(input.motd || "AETHERION Sandbox").slice(0, 60);
  const startAfterCreate = input.startAfterCreate !== false;
  const node = nodeFor(undefined);

  if (!allowedTypes.has(serverType)) throw new Error("Unsupported server type.");
  if (!version) throw new Error("Version is required.");
  if (!Number.isInteger(cpuCores) || cpuCores < 1 || cpuCores > MAX_CORES) {
    throw new Error(`CPU cores must be an integer from 1–${MAX_CORES}.`);
  }
  if (!allowedDiff.has(difficulty)) throw new Error("Invalid difficulty.");
  if (!allowedModes.has(gamemode)) throw new Error("Invalid gamemode.");

  if (loadStore().some((row) => row.name === name)) throw new Error("A sandbox with this name already exists.");
  if (startAfterCreate) assertPoolFits(await runningSandboxes(), { ramMb, cpuCores, nodeId: node.id });

  const versions = await sandboxVersions();
  if (!versions[serverType]?.includes(version)) {
    throw new Error(`Version ${version} is not available for ${serverType}.`);
  }

  const port = await nextPort(node.id);
  const craftyMaxGb = Math.max(1, Math.ceil(ramMb / 1024));
  const memMin = Math.max(1, Math.min(craftyMaxGb, Math.ceil(craftyMaxGb * 0.75)));

  const payload = {
    name,
    monitoring_type: "minecraft_java",
    create_type: "minecraft_java",
    stop_command: "stop",
    log_location: "./logs/latest.log",
    crashdetection: false,
    autostart: false,
    autostart_delay: 10,
    minecraft_java_monitoring_data: {
      host: "0.0.0.0",
      port,
    },
    minecraft_java_create_data: {
      create_type: "download_jar",
      download_jar_create_data: {
        type: serverType,
        version,
        mem_min: memMin,
        mem_max: craftyMaxGb,
        server_properties_port: port,
        category: "mc_java_servers",
        agree_to_eula: true,
      },
    },
  };

  const created = await craftyRequest<{ new_server_id?: string; new_server_uuid?: string }>(
    "/api/v2/servers",
    { method: "POST", body: JSON.stringify(payload) },
  );
  const id = String(created.new_server_uuid || created.new_server_id || "");
  if (!id) throw new Error("Crafty did not return a server id.");

  let executable = "server.jar";

  // Tune JVM + world settings after Crafty finishes scaffolding.
  try {
    const createdServer = await craftyServerFor(id);
    executable = createdServer?.executable || "server.jar";
    await craftyRequest(`/api/v2/servers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        server_ip: "0.0.0.0",
        server_port: port,
        execution_command: buildJavaCommand(executable, ramMb, cpuCores),
      }),
    });
  } catch (error) {
    console.warn("sandbox jvm patch failed", error);
  }

  try {
    await saveCraftyFile(id, "eula.txt", "eula=true\n");
  } catch {
    // ignore
  }

  try {
    let existing = "";
    try {
      const file = await getCraftyFiles(id, "server.properties");
      existing = file.content || "";
    } catch {
      existing = "";
    }
    const nextProps = patchProperties(existing, {
      "server-port": String(port),
      "server-ip": "",
      "max-players": String(maxPlayers),
      "view-distance": String(viewDistance),
      "simulation-distance": String(simulationDistance),
      difficulty,
      gamemode,
      "online-mode": onlineMode ? "true" : "false",
      motd,
      "spawn-protection": "0",
      "enable-command-block": "true",
      pvp: "true",
    });
    await saveCraftyFile(id, "server.properties", nextProps);
  } catch (error) {
    console.warn("sandbox properties patch failed", error);
  }

  await openFirewall(port);

  const record: SandboxRecord = {
    id,
    name,
    serverType,
    version,
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
    port,
    createdAt: new Date().toISOString(),
    ownerId: scope.ownerId,
    ramMb,
    nodeId: node.id,
    source: input.source ?? "launcher",
    ...(input.displayName ? { displayName: input.displayName } : {}),
  };
  mutateStore((rows) => [...rows, record]);

  if (startAfterCreate) {
    try {
      const ready = await waitForSandboxJar(id, executable, 45);
      if (ready) {
        try {
          await runCraftyAction(id, "eula");
        } catch {
          // already accepted / action unavailable
        }
        await runCraftyAction(id, "start_server");
        startReservations.set(id, Date.now() + START_RESERVATION_MS);
      } else {
        console.warn("sandbox jar not ready after create — start skipped");
      }
    } catch (error) {
      console.warn("sandbox autostart failed", error);
    }
  }

  return publicSandbox(record);
}

export async function deleteSandbox(id: string, scope: OwnerScope) {
  const target = findOwned(loadStore(), id, scope);
  if (!target) throw new Error("Sandbox not found.");

  if (await isSandboxRunning(target)) {
    try {
      await requestStop(id);
    } catch {
      // the settle wait below still guards the delete
    }
  }
  await waitForStopToSettle(target);
  try {
    await craftyRequest(`/api/v2/servers/${encodeURIComponent(id)}?files=true`, { method: "DELETE" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/404|not found|invalid/i.test(message)) throw error;
  }

  await closeFirewall(target.port);
  releaseReservation(id);
  statsCache.delete(id);
  craftyListCache = null;
  mutateStore((rows) => rows.filter((row) => row.id !== id));
  return { ok: true, id };
}

/** True once Crafty has finished downloading the server jar. */
export async function waitForSandboxJar(id: string, executable: string, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const listing = await getCraftyFiles(id, ".");
      // Fabric ships a ~180 KB launcher jar that fetches the server on first start.
      const found = (listing.entries ?? []).some(
        (entry) =>
          !entry.directory &&
          ((entry.name === executable && (entry.size ?? 0) > 50_000) ||
            (entry.name.endsWith(".jar") && (entry.size ?? 0) > 1_000_000)),
      );
      if (found) return true;
    } catch {
      // keep waiting while Crafty finishes download
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

const MAX_TEXT_BYTES = 256 * 1024;
const BLOCKED_UPLOAD = /\.(jar|zip|exe|dll|png|jpg|jpeg|webp|gif|ogg|mp3|nbt|dat|gz|7z|rar|bin|class)$/i;

export async function uploadSandboxFile(id: string, scope: OwnerScope, requestedPath: string, content: string) {
  if (typeof content !== "string") throw new Error("File content must be text.");
  if (content.includes("\0")) throw new Error("Only text files can be uploaded.");
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) {
    throw new Error("File is too large (256 KB max).");
  }
  const safePath = normalizeServerPath(requestedPath, false);
  if (BLOCKED_UPLOAD.test(safePath)) throw new Error("Only text files can be uploaded.");
  if (!findOwned(loadStore(), id, scope)) throw new Error("Sandbox not found.");
  await saveCraftyFile(id, safePath, content);
  return { ok: true as const, path: safePath };
}

export type StartPolicy = {
  /** Most servers this owner may run at once. Unset = no per-owner limit. */
  maxRunning?: number;
};

export async function startSandbox(id: string, scope: OwnerScope, policy: StartPolicy = {}) {
  const target = findOwned(loadStore(), id, scope);
  if (!target) throw new Error("Sandbox not found.");

  const alreadyRunning = await withStartLock(async () => {
    if (await isSandboxRunning(target)) return true;
    const running = await runningSandboxes();
    if (policy.maxRunning != null) {
      const mine = visibleToOwner(running, scope).filter((row) => row.id !== id);
      if (mine.length >= policy.maxRunning) {
        const other = mine[0];
        throw new SandboxError(
          "RUNNING_LIMIT",
          `Only ${policy.maxRunning} server can run at a time. Stop “${displayNameOf(other)}” first.`,
          409,
          { runningId: other.id, runningName: displayNameOf(other) },
        );
      }
    }
    assertPoolFits(running, { id, ramMb: recordRamMb(target), cpuCores: target.cpuCores, nodeId: target.nodeId });
    startReservations.set(id, Date.now() + START_RESERVATION_MS);
    return false;
  });

  if (!alreadyRunning) {
    try {
      try {
        // Crafty only reads the FIRST line — comments after first Minecraft boot break starts.
        await saveCraftyFile(id, "eula.txt", "eula=true\n");
      } catch {
        // ignore
      }

      try {
        // Crafty panel EULA gate — without this, start_server is a silent no-op.
        await runCraftyAction(id, "eula");
      } catch {
        // ignore if already accepted
      }

      const createdServer = await craftyServerFor(id);
      const executable = createdServer?.executable || "server.jar";
      const ready = await waitForSandboxJar(id, executable, 10);
      if (!ready) {
        throw new SandboxError("NOT_READY", "Sandbox jar is not ready yet — wait a moment and try Start again.", 409);
      }

      await openFirewall(target.port);
      await runCraftyAction(id, "start_server");
    } catch (error) {
      releaseReservation(id);
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  invalidateProbe();
  statsCache.delete(id);
  try {
    return {
      ok: true,
      id,
      address: `${PUBLIC_IP}:${target.port}`,
      running: await isSandboxRunning(target),
    };
  } catch {
    return { ok: true, id, address: `${PUBLIC_IP}:${target.port}`, running: null as boolean | null };
  }
}

export async function stopSandbox(id: string, scope: OwnerScope) {
  const target = findOwned(loadStore(), id, scope);
  if (!target) throw new Error("Sandbox not found.");

  await requestStop(id);
  releaseReservation(id);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  invalidateProbe();
  statsCache.delete(id);
  try {
    return {
      ok: true,
      id,
      address: `${PUBLIC_IP}:${target.port}`,
      running: await isSandboxRunning(target),
    };
  } catch {
    return { ok: true, id, address: `${PUBLIC_IP}:${target.port}`, running: null as boolean | null };
  }
}

export async function restartSandbox(id: string, scope: OwnerScope) {
  const target = getOwnedSandbox(id, scope);
  if (!(await isSandboxRunning(target))) {
    throw new SandboxError("NOT_RUNNING", "The server is not running.", 409);
  }
  await runCraftyAction(id, "restart_server");
  recentStops.set(id, Date.now());
  statsCache.delete(id);
  return { ok: true, id };
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", "#x2f": "/" };

/** Crafty returns log lines HTML-escaped; clients render them as plain text. */
export function cleanLogLine(line: string) {
  return line
    .replace(ANSI, "")
    .replace(/\r$/, "")
    .replace(/&(amp|lt|gt|quot|#39|#x27|#x2f);/gi, (match, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? match);
}

export async function readSandboxLogs(id: string, scope: OwnerScope, limit = 300) {
  getOwnedSandbox(id, scope);
  const lines = await getCraftyLogs(id);
  return lines.slice(-limit).map(cleanLogLine);
}

export async function sendSandboxCommand(id: string, scope: OwnerScope, command: string) {
  const target = getOwnedSandbox(id, scope);
  const trimmed = String(command || "").trim().replace(/^\//, "");
  if (!trimmed || trimmed.length > 240 || /[\r\n\0]/.test(trimmed)) {
    throw new SandboxError("VALIDATION", "Command must be one line of 1–240 characters.", 400);
  }
  if (!(await isSandboxRunning(target))) {
    throw new SandboxError("NOT_RUNNING", "Start the server before sending commands.", 409);
  }
  await sendCraftyCommand(id, trimmed);
  return { ok: true as const };
}

export type SandboxSettingsPatch = {
  displayName?: string;
  motd?: string;
  difficulty?: SandboxDifficulty;
  gamemode?: SandboxGamemode;
  maxPlayers?: number;
  viewDistance?: number;
  simulationDistance?: number;
  ramMb?: number;
  cpuCores?: number;
};

/** World settings apply on the next start. RAM can only change while the server is stopped. */
export async function updateSandbox(id: string, scope: OwnerScope, patch: SandboxSettingsPatch) {
  const target = getOwnedSandbox(id, scope);
  const next: SandboxRecord = { ...target };
  const properties: Record<string, string> = {};

  if (patch.displayName !== undefined) next.displayName = patch.displayName;
  if (patch.motd !== undefined) {
    next.motd = String(patch.motd).replace(/[\r\n]/g, " ").slice(0, 60);
    properties.motd = next.motd;
  }
  if (patch.difficulty !== undefined) {
    if (!allowedDiff.has(patch.difficulty)) throw new SandboxError("VALIDATION", "Invalid difficulty.");
    next.difficulty = patch.difficulty;
    properties.difficulty = patch.difficulty;
  }
  if (patch.gamemode !== undefined) {
    if (!allowedModes.has(patch.gamemode)) throw new SandboxError("VALIDATION", "Invalid gamemode.");
    next.gamemode = patch.gamemode;
    properties.gamemode = patch.gamemode;
  }
  if (patch.maxPlayers !== undefined) {
    const value = Number(patch.maxPlayers);
    if (!Number.isInteger(value) || value < 1 || value > 40) {
      throw new SandboxError("VALIDATION", "Max players must be between 1 and 40.");
    }
    next.maxPlayers = value;
    properties["max-players"] = String(value);
  }
  if (patch.viewDistance !== undefined) {
    next.viewDistance = Math.max(3, Math.min(16, Math.round(Number(patch.viewDistance))));
    properties["view-distance"] = String(next.viewDistance);
  }
  if (patch.simulationDistance !== undefined) {
    next.simulationDistance = Math.max(3, Math.min(12, Math.round(Number(patch.simulationDistance))));
    properties["simulation-distance"] = String(next.simulationDistance);
  }

  const ramChanged = patch.ramMb !== undefined && patch.ramMb !== recordRamMb(target);
  if (ramChanged) {
    const ramMb = Number(patch.ramMb);
    if (!Number.isInteger(ramMb) || ramMb < MIN_SANDBOX_RAM_MB || ramMb > MAX_GB * 1024) {
      throw new SandboxError("VALIDATION", `RAM must be between ${MIN_SANDBOX_RAM_MB} MB and ${MAX_GB} GB.`);
    }
    if (await isSandboxRunning(target)) {
      throw new SandboxError("MUST_BE_OFFLINE", "Stop the server before changing its RAM.", 409);
    }
    const cpuCores = patch.cpuCores ?? target.cpuCores;
    const server = await craftyServerFor(id);
    await craftyRequest(`/api/v2/servers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ execution_command: buildJavaCommand(server?.executable || "server.jar", ramMb, cpuCores) }),
    });
    next.ramMb = ramMb;
    next.ramGb = ramMb / 1024;
    next.cpuCores = cpuCores;
    craftyListCache = null;
  }

  if (Object.keys(properties).length) {
    let existing = "";
    try {
      existing = (await getCraftyFiles(id, "server.properties")).content || "";
    } catch {
      existing = "";
    }
    await saveCraftyFile(id, "server.properties", patchProperties(existing, properties));
  }

  mutateStore((rows) => rows.map((row) => (row.id === id ? next : row)));
  return next;
}
