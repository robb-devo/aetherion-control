import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import {
  craftyRequest,
  listCraftyServers,
  runCraftyAction,
  saveCraftyFile,
  getCraftyFiles,
  normalizeServerPath,
} from "./crafty";
import { findOwned, omitOwner, visibleToOwner, type OwnerScope } from "./sandboxOwners.mjs";

const execFileAsync = promisify(execFile);

export type SandboxType = "vanilla" | "paper" | "fabric" | "purpur";
export type SandboxPreset = "light" | "balanced" | "performance" | "max" | "large" | "custom";
export type SandboxDifficulty = "peaceful" | "easy" | "normal" | "hard";
export type SandboxGamemode = "survival" | "creative" | "adventure" | "spectator";

export type SandboxCreateInput = {
  name: string;
  serverType: SandboxType;
  version: string;
  ramGb: number;
  cpuCores: number;
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
};

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
  writeFileSync(file, JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
}

function sanitizeName(value: string) {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned.length < 2 || cleaned.length > 24) {
    throw new Error("Name must be 2–24 chars (letters, numbers, hyphens).");
  }
  return cleaned.startsWith("sandbox-") ? cleaned : `sandbox-${cleaned}`;
}

function poolUsage(rows: SandboxRecord[]) {
  return {
    usedRamGb: rows.reduce((sum, row) => sum + row.ramGb, 0),
    usedCores: rows.reduce((sum, row) => sum + (row.cpuCores || 0), 0),
  };
}

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

async function nextPort() {
  const used = await usedPorts();
  for (let port = PORT_START; port <= PORT_END; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new Error("No free sandbox ports left (25600–25649).");
}

function buildJavaCommand(executable: string, ramGb: number, cpuCores: number) {
  // Keep the launch line compact — Crafty + Java 25 choke on mega Aikar strings for fresh jars.
  const xms = Math.max(1, Math.min(ramGb, Math.max(1, Math.floor(ramGb / 2))));
  return [
    "java",
    `-Xms${xms}G`,
    `-Xmx${ramGb}G`,
    `-XX:ActiveProcessorCount=${cpuCores}`,
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-jar",
    executable || "server.jar",
    "nogui",
  ].join(" ");
}

function patchProperties(raw: string, patch: Record<string, string>) {
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

export async function getSandboxOptions() {
  const cache = await craftyRequest<JarCache>("/api/v2/crafty/JarCache");
  const types = cache.mc_java_servers?.types ?? {};
  const versionsFor = (key: string) => Object.keys(types[key]?.versions ?? {}).slice(0, 50);
  const rows = loadStore();
  const usage = poolUsage(rows);
  return {
    poolGb: POOL_GB,
    maxRamGb: MAX_GB,
    poolCores: POOL_CORES,
    maxCores: MAX_CORES,
    usedRamGb: usage.usedRamGb,
    remainingRamGb: Math.max(0, POOL_GB - usage.usedRamGb),
    usedCores: usage.usedCores,
    remainingCores: Math.max(0, POOL_CORES - usage.usedCores),
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
    versions: {
      vanilla: versionsFor("vanilla"),
      paper: versionsFor("paper"),
      fabric: versionsFor("fabric"),
      purpur: versionsFor("purpur"),
    },
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
  let preset: SandboxPreset = input.preset || DEFAULT_SANDBOX_PRESET;

  if (preset !== "custom" && PRESETS[preset]) {
    ramGb = PRESETS[preset].ramGb;
    cpuCores = PRESETS[preset].cpuCores;
  }

  const maxPlayers = Math.max(1, Math.min(40, Number(input.maxPlayers ?? 12)));
  const viewDistance = Math.max(4, Math.min(16, Number(input.viewDistance ?? 8)));
  const simulationDistance = Math.max(3, Math.min(12, Number(input.simulationDistance ?? 6)));
  const difficulty = (input.difficulty || "normal") as SandboxDifficulty;
  const gamemode = (input.gamemode || "survival") as SandboxGamemode;
  const onlineMode = input.onlineMode !== false;
  const motd = String(input.motd || "AETHERION Sandbox").slice(0, 60);
  const startAfterCreate = input.startAfterCreate !== false;

  if (!allowedTypes.has(serverType)) throw new Error("Unsupported server type.");
  if (!version) throw new Error("Version is required.");
  if (!Number.isInteger(ramGb) || ramGb < 1 || ramGb > MAX_GB) {
    throw new Error(`RAM must be an integer from 1–${MAX_GB} GB.`);
  }
  if (!Number.isInteger(cpuCores) || cpuCores < 1 || cpuCores > MAX_CORES) {
    throw new Error(`CPU cores must be an integer from 1–${MAX_CORES}.`);
  }
  if (!allowedDiff.has(difficulty)) throw new Error("Invalid difficulty.");
  if (!allowedModes.has(gamemode)) throw new Error("Invalid gamemode.");

  const rows = loadStore();
  if (rows.some((row) => row.name === name)) throw new Error("A sandbox with this name already exists.");
  const usage = poolUsage(rows);
  if (usage.usedRamGb + ramGb > POOL_GB) {
    throw new Error(`Not enough sandbox RAM left (${POOL_GB - usage.usedRamGb} GB free of ${POOL_GB} GB).`);
  }
  if (usage.usedCores + cpuCores > POOL_CORES) {
    throw new Error(`Not enough sandbox CPU left (${POOL_CORES - usage.usedCores} cores free of ${POOL_CORES}).`);
  }

  const options = await getSandboxOptions();
  if (!options.versions[serverType]?.includes(version)) {
    throw new Error(`Version ${version} is not available for ${serverType}.`);
  }

  const port = await nextPort();
  const memMin = Math.max(1, Math.min(ramGb, Math.ceil(ramGb * 0.75)));

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
        mem_max: ramGb,
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
    const servers = await listCraftyServers();
    const createdServer = servers.find((server) => server.id === id);
    executable = createdServer?.executable || "server.jar";
    await craftyRequest(`/api/v2/servers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        server_ip: "0.0.0.0",
        server_port: port,
        execution_command: buildJavaCommand(executable, ramGb, cpuCores),
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
  };
  rows.push(record);
  saveStore(rows);

  if (startAfterCreate) {
    try {
      const ready = await waitForJar(id, executable, 45);
      if (ready) {
        try {
          await runCraftyAction(id, "eula");
        } catch {
          // already accepted / action unavailable
        }
        await runCraftyAction(id, "start_server");
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
  const rows = loadStore();
  const target = findOwned(rows, id, scope);
  if (!target) throw new Error("Sandbox not found.");

  try {
    await runCraftyAction(id, "stop_server");
  } catch {
    // continue
  }
  try {
    await craftyRequest(`/api/v2/servers/${encodeURIComponent(id)}?files=true`, { method: "DELETE" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/404|not found|invalid/i.test(message)) throw error;
  }

  await closeFirewall(target.port);
  saveStore(rows.filter((row) => row.id !== id));
  return { ok: true, id };
}

async function waitForJar(id: string, executable: string, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const listing = await getCraftyFiles(id, ".");
      const found = (listing.entries ?? []).some(
        (entry) =>
          !entry.directory &&
          (entry.name === executable || entry.name.endsWith(".jar")) &&
          (entry.size ?? 0) > 1_000_000,
      );
      if (found) return true;
    } catch {
      // keep waiting while Crafty finishes download
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
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

export async function startSandbox(id: string, scope: OwnerScope) {
  const rows = loadStore();
  const target = findOwned(rows, id, scope);
  if (!target) throw new Error("Sandbox not found.");

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

  const servers = await listCraftyServers();
  const createdServer = servers.find((server) => server.id === id);
  const executable = createdServer?.executable || "server.jar";
  const ready = await waitForJar(id, executable, 10);
  if (!ready) {
    throw new Error("Sandbox jar is not ready yet — wait a moment and try Start again.");
  }

  await openFirewall(target.port);
  await runCraftyAction(id, "start_server");
  await new Promise((resolve) => setTimeout(resolve, 2500));

  try {
    const { getCraftyStats } = await import("./crafty");
    const stats = await getCraftyStats(id);
    return {
      ok: true,
      id,
      address: `${PUBLIC_IP}:${target.port}`,
      running: Boolean(stats.running),
    };
  } catch {
    return { ok: true, id, address: `${PUBLIC_IP}:${target.port}`, running: null as boolean | null };
  }
}

export async function stopSandbox(id: string, scope: OwnerScope) {
  const target = findOwned(loadStore(), id, scope);
  if (!target) throw new Error("Sandbox not found.");

  await runCraftyAction(id, "stop_server");
  await new Promise((resolve) => setTimeout(resolve, 1500));

  try {
    const { getCraftyStats } = await import("./crafty");
    const stats = await getCraftyStats(id);
    return {
      ok: true,
      id,
      address: `${PUBLIC_IP}:${target.port}`,
      running: Boolean(stats.running),
    };
  } catch {
    return { ok: true, id, address: `${PUBLIC_IP}:${target.port}`, running: null as boolean | null };
  }
}
