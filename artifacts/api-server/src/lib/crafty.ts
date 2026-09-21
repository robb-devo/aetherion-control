import { Agent, fetch as undiciFetch, Headers, type RequestInit, type Response } from "undici";
import { CRAFTY_CA_CERT } from "./craftyCa";
import path from "node:path";

type CraftyEnvelope<T> = {
  status?: string;
  data?: T;
  error?: string;
  error_data?: string;
};

type CraftyServerRecord = {
  server_id?: string;
  server_uuid?: string;
  server_name?: string;
  server_ip?: string;
  server_port?: number;
  type?: string;
  executable?: string;
  execution_command?: string;
  created?: string;
  path?: string;
  auto_start?: boolean;
};

export type CraftyServer = {
  id: string;
  name: string;
  ip: string;
  port: number;
  type: string;
  executable: string;
  command: string;
  createdAt: string | null;
  path: string;
  autoStart: boolean;
};

export type CraftyStats = {
  running: boolean;
  cpu: number;
  memory: string;
  memoryPercent: number;
  online: number;
  maxPlayers: number;
  players: string[];
  version: string;
  port: number;
  updatedAt: string;
};

export type CraftyFileEntry = {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modifiedAt: string | null;
};

let cachedToken: { value: string; expiresAt: number } | null = null;
const craftyTlsAgent = new Agent({
  connect: {
    ca: CRAFTY_CA_CERT,
    // The controller is reached by IP, while its pinned certificate is issued
    // to the local Crafty hostname. Keep hostname verification enabled against
    // that certificate identity instead of disabling TLS validation.
    servername: process.env.CRAFTY_TLS_SERVER_NAME ?? "aetherion",
  },
});

function fetchCrafty(path: string, init: RequestInit = {}) {
  return undiciFetch(`${baseUrl()}${path}`, { ...init, dispatcher: craftyTlsAgent });
}

function baseUrl() {
  const value = process.env.CRAFTY_BASE_URL?.replace(/\/+$/, "");
  if (!value) throw new Error("CRAFTY_BASE_URL is not configured.");
  return value;
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as CraftyEnvelope<T>;
  if (!response.ok || body.status === "error") {
    throw new Error(body.error_data ?? body.error ?? `Crafty request failed with ${response.status}`);
  }
  return (body.data ?? body) as T;
}

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const username = process.env.CRAFTY_USERNAME;
  const password = process.env.CRAFTY_PASSWORD;
  if (!username || !password) throw new Error("Crafty credentials are not configured.");

  const response = await fetchCrafty("/api/v2/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await parse<{ token: string }>(response);
  cachedToken = { value: data.token, expiresAt: Date.now() + 8 * 60 * 1000 };
  return data.token;
}

export async function craftyRequest<T>(path: string, init: RequestInit = {}) {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  let response = await fetchCrafty(path, { ...init, headers });
  if (response.status === 401 || response.status === 403) {
    cachedToken = null;
    const retryToken = await getToken();
    headers.set("authorization", `Bearer ${retryToken}`);
    response = await fetchCrafty(path, { ...init, headers });
  }
  return parse<T>(response);
}

function normalize(record: CraftyServerRecord): CraftyServer {
  return {
    id: record.server_id ?? record.server_uuid ?? "",
    name: record.server_name ?? "Unnamed server",
    ip: record.server_ip ?? "127.0.0.1",
    port: record.server_port ?? 25565,
    type: record.type ?? "minecraft-java",
    executable: record.executable ?? "",
    command: record.execution_command ?? "",
    createdAt: record.created ?? null,
    path: record.path ?? "",
    autoStart: record.auto_start ?? false,
  };
}

export function normalizeServerPath(value: string, allowRoot = true) {
  if (typeof value !== "string" || value.includes("\0") || value.includes("\\")) {
    throw new Error("Invalid server path");
  }
  const trimmed = value.replace(/^\/+/, "");
  const normalized = path.posix.normalize(trimmed);
  if (normalized === "." && allowRoot) return "";
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error("Path must stay inside the server root");
  }
  return normalized;
}

function recordValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (record[key] != null) return record[key];
  return undefined;
}

export function parseCraftySize(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value !== "string") return 0;
  const match = value.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
  if (!match) return 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  return Math.max(0, Math.round(Number(match[1]) * 1024 ** Math.max(0, units.indexOf((match[2] ?? "B").toUpperCase()))));
}

export function normalizeCraftyFileEntries(value: unknown, parent: string): CraftyFileEntry[] {
  let source: unknown[] = [];
  if (Array.isArray(value)) {
    source = value;
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.content === "string" && record.attributes && typeof record.attributes === "object") {
      return [];
    }
    const nested = recordValue(record, ["files", "entries", "data"]);
    if (Array.isArray(nested)) {
      source = nested;
    } else {
      const keyed = nested && typeof nested === "object" ? nested as Record<string, unknown> : record;
      source = Object.entries(keyed)
        .filter(([name]) => name !== "root_path")
        .map(([name, item]) => item && typeof item === "object" ? { name, ...(item as Record<string, unknown>) } : item);
    }
  }
  return source.flatMap((item) => {
    if (typeof item === "string") {
      const name = path.posix.basename(item);
      return [{ name, path: parent ? `${parent}/${name}` : name, directory: false, size: 0, modifiedAt: null }];
    }
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = String(recordValue(record, ["name", "filename", "file_name", "title"]) ?? "");
    if (!name) return [];
    const rawPath = String(recordValue(record, ["path", "relative_path"]) ?? (parent ? `${parent}/${name}` : name));
    const type = String(recordValue(record, ["type", "file_type"]) ?? "");
    return [{
      name,
      path: normalizeServerPath(rawPath),
      directory: Boolean(recordValue(record, ["dir", "directory", "is_dir", "is_directory"]) ?? /dir|folder/i.test(type)),
      size: parseCraftySize(recordValue(record, ["size", "file_size"])),
      modifiedAt: String(recordValue(record, ["modified", "modified_at", "mtime", "date"]) ?? "") || null,
    }];
  });
}

export async function listCraftyServers() {
  const records = await craftyRequest<CraftyServerRecord[]>("/api/v2/servers");
  return records.map(normalize).filter((server) => server.id);
}

export async function getCraftyHealth() {
  const response = await fetchCrafty("/api/v2/crafty/check", { headers: { accept: "application/json" } });
  return parse<{ status: string }>(response);
}

export async function getCraftyStats(id: string) {
  const data = await craftyRequest<{
    running?: boolean;
    cpu?: number;
    mem?: string;
    mem_percent?: number | string;
    online?: number;
    max?: number;
    players?: string | string[];
    version?: string;
    server_port?: number;
  }>(`/api/v2/servers/${encodeURIComponent(id)}/stats`);
  let players: string[] = [];
  if (Array.isArray(data.players)) players = data.players.filter((player): player is string => typeof player === "string");
  else if (typeof data.players === "string") {
    try {
      const parsed = JSON.parse(data.players) as unknown;
      if (Array.isArray(parsed)) players = parsed.filter((player): player is string => typeof player === "string");
    } catch {
      players = data.players.split(",").map((player) => player.trim()).filter(Boolean);
    }
  }
  return {
    running: Boolean(data.running),
    cpu: Number(data.cpu ?? 0),
    memory: data.mem ?? "—",
    memoryPercent: Number(data.mem_percent ?? 0),
    online: Number(data.online ?? 0),
    maxPlayers: Number(data.max ?? 0),
    players,
    version: data.version ?? "Unknown",
    port: Number(data.server_port ?? 25565),
    updatedAt: new Date().toISOString(),
  } satisfies CraftyStats;
}

export async function getCraftyLogs(id: string) {
  const lines = await craftyRequest<unknown[]>(`/api/v2/servers/${encodeURIComponent(id)}/logs`);
  return lines.filter((line): line is string => typeof line === "string").slice(-400);
}

export async function runCraftyAction(id: string, action: string) {
  return craftyRequest(`/api/v2/servers/${encodeURIComponent(id)}/action/${encodeURIComponent(action)}`, { method: "POST" });
}

export async function sendCraftyCommand(id: string, command: string) {
  return craftyRequest(`/api/v2/servers/${encodeURIComponent(id)}/stdin`, {
    method: "POST",
    body: JSON.stringify({ command }),
  });
}

export async function getCraftyFiles(id: string, requestedPath: string) {
  const safePath = normalizeServerPath(requestedPath);
  const data = await craftyRequest<unknown>(`/api/v2/servers/${encodeURIComponent(id)}/files`, {
    method: "POST",
    body: JSON.stringify({ path: safePath }),
  });
  if (typeof data === "string") {
    return { path: safePath, directory: false, entries: [], content: data };
  }
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const content = recordValue(record, ["content", "contents", "text"]);
  const entries = normalizeCraftyFileEntries(data, safePath);
  return {
    path: safePath,
    directory: entries.length > 0 || typeof content !== "string",
    entries,
    content: typeof content === "string" ? content : null,
  };
}

export async function saveCraftyFile(id: string, requestedPath: string, content: string) {
  const safePath = normalizeServerPath(requestedPath, false);
  await craftyRequest(`/api/v2/servers/${encodeURIComponent(id)}/files`, {
    method: "PATCH",
    body: JSON.stringify({ path: safePath, contents: content, overwrite: true }),
  });
}

export async function deleteCraftyFile(id: string, requestedPath: string) {
  const safePath = normalizeServerPath(requestedPath, false);
  await craftyRequest(`/api/v2/servers/${encodeURIComponent(id)}/files`, {
    method: "DELETE",
    body: JSON.stringify({ file_system_objects: [{ filename: safePath }] }),
  });
}

export async function getCraftyPlugins(id: string) {
  const results = await Promise.all(["plugins", "mods"].map(async (folder) => {
    try {
      const response = await getCraftyFiles(id, folder);
      return normalizeCraftyPlugins(folder, response.entries);
    } catch {
      return [];
    }
  }));
  return results.flat();
}

export function normalizeCraftyPlugins(folder: string, entries: CraftyFileEntry[]) {
  return entries
    .filter((entry) => !entry.directory && /\.(jar|zip|disabled)$/i.test(entry.name))
    .map((entry) => ({ name: entry.name, path: entry.path, kind: folder === "plugins" ? "plugin" as const : "mod" as const, size: entry.size }));
}

export async function getCraftyBackups(id: string) {
  const configurations = await craftyRequest<unknown>(`/api/v2/servers/${encodeURIComponent(id)}/backups`);
  const configs = normalizeCraftyBackupConfigs(configurations);
  const archives = await Promise.all(configs.map(async (config) => {
    const data = await craftyRequest<unknown>(`/api/v2/servers/${encodeURIComponent(id)}/backups/backup/${encodeURIComponent(config.id)}/files`);
    return normalizeCraftyBackupFiles(config.id, data);
  }));
  return archives.flat();
}

export function normalizeCraftyBackupConfigs(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const source = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value as Record<string, unknown>);
  return source.flatMap(([key, item]) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return [{ id: String(recordValue(record, ["backup_id", "id", "uuid"]) ?? key), name: String(recordValue(record, ["backup_name", "name"]) ?? key) }];
  });
}

export function normalizeCraftyBackupFiles(configId: string, value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const source = Array.isArray(value) ? value : Array.isArray(record.backups) ? record.backups : [];
  return source.flatMap((item) => {
    if (typeof item === "string") {
      const name = path.posix.basename(item.replaceAll("\\", "/"));
      return [{ id: `${configId}:${name}`, name, size: 0, createdAt: null }];
    }
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const name = String(recordValue(entry, ["filename", "name", "path"]) ?? "");
    if (!name) return [];
    return [{
      id: `${configId}:${String(recordValue(entry, ["id", "uuid"]) ?? name)}`,
      name: path.posix.basename(name.replaceAll("\\", "/")),
      size: parseCraftySize(recordValue(entry, ["size", "file_size"])),
      createdAt: String(recordValue(entry, ["created", "created_at", "date", "timestamp"]) ?? "") || null,
    }];
  });
}
