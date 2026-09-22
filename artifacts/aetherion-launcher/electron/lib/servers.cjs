const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const nbt = require("prismarine-nbt");
const { ensureDir } = require("./paths.cjs");

function normalizeIp(address, port) {
  const raw = String(address || "").trim();
  if (!raw) return "play.donnernet.de";
  if (raw.includes(":")) return raw;
  if (port && Number(port) !== 25565) return `${raw}:${port}`;
  return raw;
}

/**
 * Ensure AETHERION is present in the Minecraft multiplayer server list
 * (instance/servers.dat). Updates IP if an entry with the same name exists.
 */
async function ensureServerEntry(instanceDir, server) {
  ensureDir(instanceDir);
  const file = path.join(instanceDir, "servers.dat");
  const name = server?.name || "AETHERION";
  const ip = normalizeIp(server?.address, server?.port);

  /** @type {{ name: string, ip: string, hidden: boolean }[]} */
  let list = [];

  if (fs.existsSync(file)) {
    try {
      const buf = fs.readFileSync(file);
      const { parsed } = await nbt.parse(buf);
      const simple = nbt.simplify(parsed);
      if (Array.isArray(simple.servers)) {
        list = simple.servers.map((entry) => ({
          name: String(entry.name || "Minecraft Server"),
          ip: String(entry.ip || ""),
          hidden: Boolean(entry.hidden),
        }));
      }
    } catch (err) {
      console.warn("Could not read servers.dat, recreating:", err);
      list = [];
    }
  }

  const nameKey = name.toLowerCase();
  const ipKey = ip.toLowerCase();
  const existingIdx = list.findIndex(
    (s) => s.name.toLowerCase() === nameKey || s.ip.toLowerCase() === ipKey,
  );

  if (existingIdx >= 0) {
    list[existingIdx] = { name, ip, hidden: false };
    // Keep AETHERION at the top
    if (existingIdx !== 0) {
      const [entry] = list.splice(existingIdx, 1);
      list.unshift(entry);
    }
  } else {
    list.unshift({ name, ip, hidden: false });
  }

  const nbtData = {
    type: "compound",
    name: "",
    value: {
      servers: {
        type: "list",
        value: {
          type: "compound",
          value: list.map((entry) => ({
            name: { type: "string", value: entry.name },
            ip: { type: "string", value: entry.ip },
            hidden: { type: "byte", value: entry.hidden ? 1 : 0 },
          })),
        },
      },
    },
  };

  const uncompressed = nbt.writeUncompressed(nbtData);
  fs.writeFileSync(file, zlib.gzipSync(uncompressed));
  return { name, ip, count: list.length };
}

module.exports = {
  ensureServerEntry,
  normalizeIp,
};
