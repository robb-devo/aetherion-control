import { randomBytes } from "node:crypto";
import { nodeFor } from "./nodes";
import { pingMinecraft, type ServerPing } from "./serverProbe";
import type { OwnerScope } from "./sandboxOwners.mjs";
import {
  SandboxError,
  allSandboxRecords,
  cachedStats,
  craftyServerFor,
  createSandbox,
  deleteSandbox,
  displayNameOf,
  getOwnedSandbox,
  isSandboxRunning,
  listOwnedSandboxes,
  readSandboxLogs,
  recordRamMb,
  restartSandbox,
  sandboxPoolSummary,
  sandboxProcess,
  sandboxVersions,
  sendSandboxCommand,
  startSandbox,
  stopSandbox,
  updateSandbox,
  waitForSandboxJar,
  type SandboxDifficulty,
  type SandboxGamemode,
  type SandboxRecord,
  type SandboxSettingsPatch,
  type SandboxType,
} from "./sandbox";

/**
 * Website-facing server management. Lifecycle, pool accounting and Crafty
 * access stay in `sandbox.ts`, shared with the desktop launcher; this module
 * adds the website's product rules and a view model the UI can render as-is.
 */

export const MAX_RUNNING_PER_USER = 1;

export function idleStopMinutes() {
  const value = Number(process.env.WEB_IDLE_STOP_MINUTES ?? 20);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Playground tiers. 512 MB is the floor: current Minecraft cannot generate a
 * spawn area in less, so smaller tiers would only produce crashes. View and
 * simulation distance scale with the tier so small servers stay playable.
 */
export const RAM_TIERS = [
  { ramMb: 512, cpuCores: 1, rarity: "common", viewDistance: 5, simulationDistance: 4, maxPlayers: 4 },
  { ramMb: 768, cpuCores: 1, rarity: "uncommon", viewDistance: 6, simulationDistance: 4, maxPlayers: 6 },
  { ramMb: 1024, cpuCores: 1, rarity: "rare", viewDistance: 7, simulationDistance: 5, maxPlayers: 8 },
  { ramMb: 1536, cpuCores: 2, rarity: "epic", viewDistance: 8, simulationDistance: 6, maxPlayers: 10 },
  { ramMb: 2048, cpuCores: 2, rarity: "legendary", viewDistance: 10, simulationDistance: 6, maxPlayers: 12 },
] as const;

export const DEFAULT_RAM_MB = 1024;
export const WEB_SOFTWARE: SandboxType[] = ["paper", "vanilla", "purpur", "fabric"];

export function tierFor(ramMb: number) {
  return RAM_TIERS.find((tier) => tier.ramMb === ramMb);
}

/** Release builds the host's Java can run: 1.21.x and the 26.x line. No snapshots or release candidates. */
export function playableVersions(versions: string[]) {
  return versions
    .filter((version) => /^\d+\.\d+(\.\d+)?$/.test(version))
    .filter((version) => {
      const [major, minor] = version.split(".").map(Number);
      return major >= 26 || (major === 1 && minor >= 21);
    })
    .slice(0, 15);
}

export function cleanServerName(raw: unknown) {
  const name = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > 32) {
    throw new SandboxError("INVALID_NAME", "Server names need 2–32 characters.");
  }
  return name;
}

/** Crafty needs a unique slug; the display name can repeat across users. */
export function craftySlugFor(displayName: string) {
  const base = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 10)
    .replace(/-+$/, "");
  return `web-${base || "server"}-${randomBytes(2).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// In-memory lifecycle bookkeeping. It only smooths the UI between polls; the
// source of truth for "running" is always the process table.

type Job = { phase: "preparing" | "failed"; startedAt: number; autoStart: boolean; error?: string };
type Pending = { action: "start" | "stop" | "restart"; at: number; seenRunning?: boolean };
type Notice = { code: string; message: string; at: number };

const jobs = new Map<string, Job>();
const pending = new Map<string, Pending>();
const notices = new Map<string, Notice>();
const idleSince = new Map<string, number>();
const PENDING_TIMEOUT_MS = { start: 180_000, stop: 90_000, restart: 180_000 } as const;
/** Crafty launches within seconds; no Java process by then means the launch failed. */
const START_NO_PROCESS_MS = 45_000;

export type WebStatus = "preparing" | "failed" | "offline" | "starting" | "online" | "stopping" | "restarting";

export function deriveStatus(input: {
  job?: Pick<Job, "phase">;
  running: boolean;
  pingable: boolean;
  pending?: Pick<Pending, "action">;
}): WebStatus {
  if (input.job?.phase === "preparing") return "preparing";
  if (input.job?.phase === "failed") return "failed";
  const action = input.pending?.action;
  if (input.running) {
    if (action === "stop") return "stopping";
    if (action === "restart") return "restarting";
    return input.pingable ? "online" : "starting";
  }
  if (action === "start") return "starting";
  if (action === "restart") return "restarting";
  return "offline";
}

function setNotice(id: string, code: string, message: string) {
  notices.set(id, { code, message, at: Date.now() });
}

/** Moves pending actions forward from what the probe sees right now. */
function observe(id: string, running: boolean, pingable: boolean) {
  const entry = pending.get(id);
  if (!entry) return;
  const age = Date.now() - entry.at;
  if (age > PENDING_TIMEOUT_MS[entry.action]) {
    pending.delete(id);
    return;
  }
  if (entry.action === "start") {
    if (pingable) pending.delete(id);
    else if (running) entry.seenRunning = true;
    else if (entry.seenRunning || age > START_NO_PROCESS_MS) {
      pending.delete(id);
      setNotice(id, "START_FAILED", "The server stopped while starting. Check the console for the reason.");
    }
  } else if (entry.action === "stop") {
    if (!running) pending.delete(id);
  } else if (entry.action === "restart") {
    if (running && pingable && age > 8_000) pending.delete(id);
  }
}

async function pingSandbox(row: SandboxRecord): Promise<ServerPing | null> {
  return pingMinecraft("127.0.0.1", row.port, 1200);
}

export type WebServerView = Awaited<ReturnType<typeof toView>>;

async function toView(row: SandboxRecord, detail = false) {
  const node = nodeFor(row.nodeId);
  const job = jobs.get(row.id);
  const probe = job?.phase === "preparing" ? { running: false, process: undefined } : await sandboxProcess(row);
  const ping = probe.running ? await pingSandbox(row) : null;
  observe(row.id, probe.running, Boolean(ping));
  const status = deriveStatus({ job, running: probe.running, pingable: Boolean(ping), pending: pending.get(row.id) });

  let cpuPercent: number | null = null;
  if (detail && probe.running) {
    try {
      cpuPercent = (await cachedStats(row.id)).cpu;
    } catch {
      cpuPercent = null;
    }
  }

  const idleMinutes = idleStopMinutes();
  const idleStart = idleSince.get(row.id);
  const notice = notices.get(row.id) ?? null;
  const ramMb = recordRamMb(row);

  return {
    id: row.id,
    name: displayNameOf(row),
    software: row.serverType,
    version: row.version,
    ramMb,
    cpuCores: row.cpuCores,
    tier: tierFor(ramMb)?.rarity ?? null,
    address: `${node.publicHost}:${row.port}`,
    port: row.port,
    nodeId: node.id,
    createdAt: row.createdAt,
    settings: {
      motd: row.motd,
      difficulty: row.difficulty,
      gamemode: row.gamemode,
      maxPlayers: row.maxPlayers,
    },
    status,
    players: ping ? { online: ping.online, max: ping.max, names: ping.players } : null,
    startedAt: probe.running ? (probe.process?.startedAt ?? null) : null,
    usage: detail && probe.running ? { memoryMb: probe.process?.rssMb ?? null, cpuPercent } : null,
    idleStopAt:
      status === "online" && idleMinutes && idleStart ? new Date(idleStart + idleMinutes * 60_000).toISOString() : null,
    notice,
    job: job ? { phase: job.phase, startedAt: new Date(job.startedAt).toISOString(), error: job.error ?? null } : null,
  };
}

export async function webOptions() {
  const [versions, pool] = await Promise.all([sandboxVersions(), sandboxPoolSummary()]);
  return {
    tiers: RAM_TIERS.map((tier) => ({ ...tier, recommended: tier.ramMb === DEFAULT_RAM_MB })),
    defaultRamMb: DEFAULT_RAM_MB,
    software: WEB_SOFTWARE.map((id) => ({ id, versions: playableVersions(versions[id] ?? []) })).filter(
      (entry) => entry.versions.length > 0,
    ),
    defaultSoftware: "paper" as SandboxType,
    maxRunning: MAX_RUNNING_PER_USER,
    idleStopMinutes: idleStopMinutes(),
    pool: { freeMb: pool.freeMb, poolMb: pool.poolMb },
  };
}

export async function listWebServers(scope: OwnerScope) {
  const rows = listOwnedSandboxes(scope).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const servers = await Promise.all(rows.map((row) => toView(row)));
  const active = servers.find((server) => !["offline", "preparing", "failed"].includes(server.status));
  return {
    servers,
    runningId: active?.id ?? null,
    maxRunning: MAX_RUNNING_PER_USER,
    idleStopMinutes: idleStopMinutes(),
  };
}

export async function getWebServer(id: string, scope: OwnerScope) {
  return toView(getOwnedSandbox(id, scope), true);
}

export type CreateWebServerInput = {
  name?: unknown;
  ramMb?: unknown;
  software?: unknown;
  version?: unknown;
  startNow?: unknown;
};

export async function createWebServer(input: CreateWebServerInput, scope: OwnerScope) {
  const displayName = cleanServerName(input.name);
  const tier = tierFor(Number(input.ramMb));
  if (!tier) throw new SandboxError("INVALID_TIER", "Pick one of the RAM tiers.");
  const software = String(input.software ?? "") as SandboxType;
  if (!WEB_SOFTWARE.includes(software)) throw new SandboxError("INVALID_SOFTWARE", "Pick a server software.");
  const version = String(input.version ?? "");
  const versions = playableVersions((await sandboxVersions())[software] ?? []);
  if (!versions.includes(version)) throw new SandboxError("INVALID_VERSION", "That Minecraft version is not available.");

  const created = await createSandbox(
    {
      name: craftySlugFor(displayName),
      displayName,
      source: "web",
      serverType: software,
      version,
      ramGb: 0,
      ramMb: tier.ramMb,
      cpuCores: tier.cpuCores,
      maxPlayers: tier.maxPlayers,
      viewDistance: tier.viewDistance,
      simulationDistance: tier.simulationDistance,
      motd: `${displayName} · Aetherion`.slice(0, 60),
      startAfterCreate: false,
    },
    scope,
  );

  const autoStart = input.startNow !== false;
  jobs.set(created.id, { phase: "preparing", startedAt: Date.now(), autoStart });
  void provision(created.id, scope, autoStart);
  return getWebServer(created.id, scope);
}

async function provision(id: string, scope: OwnerScope, autoStart: boolean) {
  try {
    const server = await craftyServerFor(id);
    const ready = await waitForSandboxJar(id, server?.executable || "server.jar", 120);
    if (!ready) {
      jobs.set(id, {
        phase: "failed",
        startedAt: Date.now(),
        autoStart,
        error: "The server files could not be downloaded. Delete this server and try again.",
      });
      return;
    }
    jobs.delete(id);
    if (!autoStart) return;
    try {
      await startWebServer(id, scope);
    } catch (error) {
      const code = error instanceof SandboxError ? error.code : "START_SKIPPED";
      setNotice(id, code, error instanceof Error ? error.message : "The server is ready but could not start.");
    }
  } catch (error) {
    jobs.set(id, {
      phase: "failed",
      startedAt: Date.now(),
      autoStart,
      error: error instanceof Error ? error.message : "Setup failed.",
    });
  }
}

function assertReady(id: string) {
  const job = jobs.get(id);
  if (job?.phase === "preparing") {
    throw new SandboxError("PREPARING", "The server files are still downloading. It starts in a moment.", 409);
  }
  if (job?.phase === "failed") throw new SandboxError("SETUP_FAILED", job.error ?? "Setup failed.", 409);
}

export async function startWebServer(id: string, scope: OwnerScope) {
  getOwnedSandbox(id, scope);
  assertReady(id);
  pending.set(id, { action: "start", at: Date.now() });
  try {
    await startSandbox(id, scope, { maxRunning: MAX_RUNNING_PER_USER });
  } catch (error) {
    pending.delete(id);
    throw error;
  }
  notices.delete(id);
  idleSince.delete(id);
  return getWebServer(id, scope);
}

export async function stopWebServer(id: string, scope: OwnerScope) {
  getOwnedSandbox(id, scope);
  pending.set(id, { action: "stop", at: Date.now() });
  try {
    await stopSandbox(id, scope);
  } catch (error) {
    pending.delete(id);
    throw error;
  }
  notices.delete(id);
  idleSince.delete(id);
  return getWebServer(id, scope);
}

export async function restartWebServer(id: string, scope: OwnerScope) {
  getOwnedSandbox(id, scope);
  assertReady(id);
  pending.set(id, { action: "restart", at: Date.now() });
  try {
    await restartSandbox(id, scope);
  } catch (error) {
    pending.delete(id);
    throw error;
  }
  notices.delete(id);
  idleSince.delete(id);
  return getWebServer(id, scope);
}

export async function deleteWebServer(id: string, scope: OwnerScope) {
  getOwnedSandbox(id, scope);
  if (jobs.get(id)?.phase === "preparing") {
    throw new SandboxError("PREPARING", "Wait until the server files finished downloading, then delete it.", 409);
  }
  pending.set(id, { action: "stop", at: Date.now() });
  try {
    await deleteSandbox(id, scope);
  } catch (error) {
    pending.delete(id);
    throw error;
  }
  for (const map of [jobs, pending, notices, idleSince]) map.delete(id);
  return { ok: true as const, id };
}

export type UpdateWebServerInput = {
  name?: unknown;
  motd?: unknown;
  difficulty?: unknown;
  gamemode?: unknown;
  maxPlayers?: unknown;
  ramMb?: unknown;
};

export async function updateWebServer(id: string, scope: OwnerScope, input: UpdateWebServerInput) {
  const patch: SandboxSettingsPatch = {};
  if (input.name !== undefined) patch.displayName = cleanServerName(input.name);
  if (input.motd !== undefined) patch.motd = String(input.motd ?? "");
  if (input.difficulty !== undefined) patch.difficulty = String(input.difficulty) as SandboxDifficulty;
  if (input.gamemode !== undefined) patch.gamemode = String(input.gamemode) as SandboxGamemode;
  if (input.maxPlayers !== undefined) patch.maxPlayers = Number(input.maxPlayers);
  if (input.ramMb !== undefined) {
    const tier = tierFor(Number(input.ramMb));
    if (!tier) throw new SandboxError("INVALID_TIER", "Pick one of the RAM tiers.");
    const current = getOwnedSandbox(id, scope);
    if (tier.ramMb !== recordRamMb(current)) {
      patch.ramMb = tier.ramMb;
      patch.cpuCores = tier.cpuCores;
      patch.viewDistance = tier.viewDistance;
      patch.simulationDistance = tier.simulationDistance;
    }
  }
  assertReady(id);
  await updateSandbox(id, scope, patch);
  return getWebServer(id, scope);
}

export async function webServerConsole(id: string, scope: OwnerScope, limit: number) {
  return { lines: await readSandboxLogs(id, scope, Math.max(20, Math.min(500, limit || 250))) };
}

export async function webServerCommand(id: string, scope: OwnerScope, command: unknown) {
  return sendSandboxCommand(id, scope, String(command ?? ""));
}

// ---------------------------------------------------------------------------
// Network status for the homepage and idle auto-stop.

const NETWORK_TTL_MS = 15_000;
let networkCache: { at: number; value: { online: boolean; players: number; maxPlayers: number } } | null = null;

export async function networkStatus() {
  if (networkCache && Date.now() - networkCache.at < NETWORK_TTL_MS) return networkCache.value;
  const host = process.env.NETWORK_PING_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.NETWORK_PING_PORT || 25565);
  const ping = await pingMinecraft(host, port, 2000);
  const value = { online: Boolean(ping), players: ping?.online ?? 0, maxPlayers: ping?.max ?? 0 };
  networkCache = { at: Date.now(), value };
  return value;
}

let maintenanceTimer: NodeJS.Timeout | null = null;

/**
 * Stops website servers nobody has played on for `WEB_IDLE_STOP_MINUTES`
 * (default 20) so a forgotten server does not hold the shared pool.
 */
export function startWebMaintenance() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    void sweepIdle().catch((error) => console.warn("idle sweep failed", error));
  }, 60_000);
  maintenanceTimer.unref();
}

async function sweepIdle() {
  const minutes = idleStopMinutes();
  if (!minutes) return;
  const now = Date.now();
  for (const row of allSandboxRecords()) {
    if (row.source !== "web" || !row.ownerId) continue;
    if (!(await isSandboxRunning(row))) {
      idleSince.delete(row.id);
      continue;
    }
    const ping = await pingSandbox(row);
    if (!ping || ping.online > 0 || pending.has(row.id)) {
      idleSince.delete(row.id);
      continue;
    }
    const since = idleSince.get(row.id) ?? now;
    idleSince.set(row.id, since);
    if (now - since < minutes * 60_000) continue;
    try {
      await stopWebServer(row.id, { ownerId: row.ownerId, includeUnowned: false });
      setNotice(row.id, "IDLE_STOPPED", `Stopped after ${minutes} minutes without players.`);
    } catch (error) {
      console.warn("idle stop failed", row.id, error);
    }
  }
}
