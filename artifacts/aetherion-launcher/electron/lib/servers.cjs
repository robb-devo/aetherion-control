const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const nbt = require("prismarine-nbt");

function normalizeIp(address, port) {
  const raw = String(address || "").trim();
  if (!raw) return "play.donnernet.de";
  if (raw.includes(":")) return raw;
  const parsed = Number(port);
  if (Number.isInteger(parsed) && parsed !== 25565) return `${raw}:${parsed}`;
  return raw;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function serverTag(entry) {
  const value = {
    name: { type: "string", value: entry.name },
    ip: { type: "string", value: entry.ip },
    hidden: { type: "byte", value: entry.hidden ? 1 : 0 },
  };
  if (typeof entry.acceptTextures === "number") {
    value.acceptTextures = { type: "byte", value: entry.acceptTextures ? 1 : 0 };
  }
  if (typeof entry.icon === "string" && entry.icon.length > 0) {
    value.icon = { type: "string", value: entry.icon };
  }
  return value;
}

async function readServers(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const buf = fs.readFileSync(file);
    const { parsed } = await nbt.parse(buf);
    const simple = nbt.simplify(parsed);
    if (!Array.isArray(simple.servers)) return [];
    return simple.servers.map((entry) => ({
      name: String(entry?.name || "Minecraft Server"),
      ip: String(entry?.ip || ""),
      hidden: Boolean(entry?.hidden),
      acceptTextures: typeof entry?.acceptTextures === "number" ? (entry.acceptTextures ? 1 : 0) : undefined,
      icon: typeof entry?.icon === "string" ? entry.icon : undefined,
    }));
  } catch (err) {
    console.warn("Could not read servers.dat, recreating:", err);
    return [];
  }
}

/**
 * Upsert servers into `<gameDir>/servers.dat`.
 * Minecraft reads this file from the directory passed as `--gameDir`
 * (`overrides.gameDirectory` in minecraft-launcher-core). Callers must pass
 * that same directory.
 *
 * Entries are matched by name only, so the AETHERION network address is never
 * replaced by a sandbox that happens to be selected, and a sandbox is never
 * renamed to AETHERION.
 */
async function ensureServerEntries(instanceDir, servers) {
  const gameDir = path.resolve(instanceDir);
  ensureDir(gameDir);
  const file = path.join(gameDir, "servers.dat");
  const wanted = (Array.isArray(servers) ? servers : [])
    .map((server) => ({
      name: String(server?.name || "AETHERION").trim() || "AETHERION",
      ip: normalizeIp(server?.address, server?.port),
    }))
    .filter((server) => server.ip);

  let list = await readServers(file);
  const ensured = [];

  for (const server of wanted) {
    const nameKey = server.name.toLowerCase();
    const existing = list.find((entry) => entry.name.toLowerCase() === nameKey);
    if (existing) {
      list = list.filter((entry) => entry.name.toLowerCase() !== nameKey);
    }
    ensured.push({
      name: server.name,
      ip: server.ip,
      hidden: false,
      acceptTextures: existing?.acceptTextures,
      icon: existing?.icon,
    });
  }

  list = [...ensured, ...list];

  const nbtData = {
    type: "compound",
    name: "",
    value: {
      servers: {
        type: "list",
        value: {
          type: "compound",
          value: list.map(serverTag),
        },
      },
    },
  };

  const uncompressed = await Promise.resolve(nbt.writeUncompressed(nbtData, "big"));
  if (!Buffer.isBuffer(uncompressed)) {
    throw new Error("Server list NBT writer did not return a buffer.");
  }
  fs.writeFileSync(file, zlib.gzipSync(uncompressed));

  const written = await readServers(file);
  for (const server of ensured) {
    const found = written.find((entry) => entry.name === server.name && entry.ip === server.ip && !entry.hidden);
    if (!found) {
      throw new Error(`Server list was not saved at ${file}`);
    }
  }

  return { file, gameDir, servers: written, count: written.length };
}

async function ensureServerEntry(instanceDir, server) {
  const result = await ensureServerEntries(instanceDir, [server]);
  const name = server?.name || "AETHERION";
  const ip = normalizeIp(server?.address, server?.port);
  return { name, ip, count: result.count, file: result.file, gameDir: result.gameDir };
}

module.exports = {
  ensureServerEntry,
  ensureServerEntries,
  normalizeIp,
};
