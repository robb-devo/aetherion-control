import { createHash } from "node:crypto";
import { chown, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCraftyPlugins } from "./crafty";
import { SandboxError, craftyServerFor, getOwnedSandbox, type SandboxType } from "./sandbox";
import type { OwnerScope } from "./sandboxOwners.mjs";

/**
 * Plugins and mods for website servers, installed from Modrinth only.
 * The browser searches Modrinth directly; the API re-checks the chosen build
 * (loader, Minecraft version, CDN host, sha512) before writing the jar.
 */

const MODRINTH = "https://api.modrinth.com/v2";
const USER_AGENT = "robb-devo/aetherion-control (donnernet.de)";
const MAX_ADDON_BYTES = 64 * 1024 * 1024;

type AddonSupport = { kind: "plugin" | "mod"; folder: string; loaders: string[] };

const SUPPORT: Partial<Record<SandboxType, AddonSupport>> = {
  paper: { kind: "plugin", folder: "plugins", loaders: ["paper", "spigot", "bukkit", "purpur"] },
  purpur: { kind: "plugin", folder: "plugins", loaders: ["purpur", "paper", "spigot", "bukkit"] },
  fabric: { kind: "mod", folder: "mods", loaders: ["fabric"] },
};

export function addonSupport(software: SandboxType) {
  return SUPPORT[software] ?? null;
}

type ModrinthVersion = {
  id: string;
  project_id: string;
  name: string;
  loaders: string[];
  game_versions: string[];
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha512?: string } }[];
};

async function modrinth<T>(pathname: string): Promise<T> {
  const response = await fetch(`${MODRINTH}${pathname}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) throw new SandboxError("NOT_FOUND", "That build does not exist on Modrinth.", 404);
  if (!response.ok) throw new SandboxError("UPSTREAM", "Modrinth did not answer. Try again in a moment.", 502);
  return (await response.json()) as T;
}

function supportFor(id: string, scope: OwnerScope) {
  const row = getOwnedSandbox(id, scope);
  const support = addonSupport(row.serverType);
  return { row, support };
}

export async function listAddons(id: string, scope: OwnerScope) {
  const { row, support } = supportFor(id, scope);
  if (!support) return { supported: false, kind: null, loaders: [], version: row.version, addons: [] };
  const entries = await getCraftyPlugins(id);
  return {
    supported: true,
    kind: support.kind,
    loaders: support.loaders,
    version: row.version,
    addons: entries
      .filter((entry) => entry.path.startsWith(`${support.folder}/`))
      .map((entry) => ({ file: entry.name, size: entry.size }))
      .sort((a, b) => a.file.localeCompare(b.file)),
  };
}

async function addonDir(id: string, folder: string) {
  const server = await craftyServerFor(id);
  if (!server?.path) throw new SandboxError("UPSTREAM", "The server folder could not be found.", 502);
  return { root: server.path, dir: path.join(server.path, folder) };
}

export async function installAddon(id: string, scope: OwnerScope, versionId: unknown) {
  const { row, support } = supportFor(id, scope);
  if (!support) throw new SandboxError("ADDONS_UNSUPPORTED", "Vanilla servers cannot load plugins or mods.", 400);
  const wanted = String(versionId ?? "");
  if (!/^[A-Za-z0-9]{8}$/.test(wanted)) throw new SandboxError("VALIDATION", "Invalid Modrinth version.");

  const version = await modrinth<ModrinthVersion>(`/version/${wanted}`);
  if (!version.loaders.some((loader) => support.loaders.includes(loader))) {
    throw new SandboxError("ADDON_INCOMPATIBLE", `This build is not made for ${row.serverType}.`, 400);
  }
  if (!version.game_versions.includes(row.version)) {
    throw new SandboxError("ADDON_INCOMPATIBLE", `This build does not support Minecraft ${row.version}.`, 400);
  }
  const file = version.files.find((item) => item.primary) ?? version.files[0];
  if (!file || new URL(file.url).hostname !== "cdn.modrinth.com" || !file.hashes.sha512) {
    throw new SandboxError("ADDON_INCOMPATIBLE", "This build has no downloadable jar.", 400);
  }
  const filename = path.basename(file.filename).replace(/[^A-Za-z0-9._+-]/g, "_");
  if (!filename.toLowerCase().endsWith(".jar")) {
    throw new SandboxError("ADDON_INCOMPATIBLE", "This build has no downloadable jar.", 400);
  }
  if (file.size > MAX_ADDON_BYTES) throw new SandboxError("ADDON_TOO_LARGE", "That file is too large.", 400);

  const response = await fetch(file.url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new SandboxError("UPSTREAM", "The download from Modrinth failed.", 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_ADDON_BYTES) throw new SandboxError("ADDON_TOO_LARGE", "That file is too large.", 400);
  if (createHash("sha512").update(bytes).digest("hex") !== file.hashes.sha512) {
    throw new SandboxError("UPSTREAM", "The download did not match Modrinth's checksum.", 502);
  }

  const { root, dir } = await addonDir(id, support.folder);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, filename);
  const tmp = `${target}.part`;
  await writeFile(tmp, bytes, { mode: 0o644 });
  // The API runs as root; Crafty's Java processes run as the owner of the server folder.
  const owner = await stat(root);
  await chown(tmp, owner.uid, owner.gid);
  await chown(dir, owner.uid, owner.gid);
  await rename(tmp, target);
  return { ok: true as const, file: filename, projectId: version.project_id, version: version.name };
}

export async function removeAddon(id: string, scope: OwnerScope, file: unknown) {
  const { support } = supportFor(id, scope);
  if (!support) throw new SandboxError("ADDONS_UNSUPPORTED", "Vanilla servers cannot load plugins or mods.", 400);
  const name = String(file ?? "");
  if (path.basename(name) !== name || !/\.jar(\.disabled)?$/i.test(name)) {
    throw new SandboxError("VALIDATION", "Invalid file name.");
  }
  const { dir } = await addonDir(id, support.folder);
  try {
    await unlink(path.join(dir, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new SandboxError("NOT_FOUND", "That file is not installed.", 404);
    throw error;
  }
  return { ok: true as const, file: name };
}
