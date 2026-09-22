const path = require("node:path");
const { ensureServerEntries, normalizeIp } = require("./servers.cjs");
const { DEFAULT_API_BASE, normalizeBase } = require("./control.cjs");

function networkServer(manifest, settings) {
  const server = manifest?.server || {};
  return {
    kind: "network",
    name: server.name || "AETHERION",
    address: settings?.serverAddress || server.address || "play.donnernet.de",
    port: Number(server.port) || 25565,
  };
}

function sandboxTarget(settings) {
  const target = settings?.playTarget;
  if (!target || target.kind !== "sandbox") return null;
  const address = String(target.address || "").trim();
  const port = Number(target.port);
  if (!address || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const name = String(target.name || "Sandbox").trim() || "Sandbox";
  if (name.toLowerCase() === "aetherion") return null;
  return { kind: "sandbox", name, address, port };
}

function activeTarget(manifest, settings) {
  return sandboxTarget(settings) || networkServer(manifest, settings);
}

function presentSettings(settings, manifest) {
  const network = networkServer(manifest, settings);
  const play = activeTarget(manifest, settings);
  const override = settings?.controlApiBase ? String(settings.controlApiBase).trim() : "";
  let apiBase = DEFAULT_API_BASE;
  if (override) {
    try {
      apiBase = normalizeBase(override);
    } catch {
      apiBase = override;
    }
  }
  return {
    ramGb: settings.ramGb,
    autoJoin: settings.autoJoin !== false,
    serverAddress: normalizeIp(network.address, network.port),
    playTarget: {
      kind: play.kind,
      name: play.name,
      address: play.address,
      port: play.port,
      label: normalizeIp(play.address, play.port),
    },
    controlApiBase: override,
    controlKeySet: Boolean(settings?.controlKey && String(settings.controlKey).trim()),
    apiBase,
  };
}

/**
 * Write the multiplayer list into the instance directory Minecraft is launched with.
 * AETHERION always keeps the network address. A selected sandbox is an extra entry.
 */
async function syncInstanceServers(instanceDir, manifest, settings) {
  const gameDir = path.resolve(instanceDir);
  const network = networkServer(manifest, settings);
  const entries = [
    { name: network.name, address: network.address, port: network.port },
  ];
  const extra = sandboxTarget(settings);
  if (extra) {
    entries.push({ name: extra.name, address: extra.address, port: extra.port });
  }
  const result = await ensureServerEntries(gameDir, entries);
  console.log(
    `[AETHERION] servers.dat ${result.file} ← ${entries.map((entry) => `${entry.name} ${normalizeIp(entry.address, entry.port)}`).join(", ")}`,
  );
  return result;
}

function quickPlayAddress(manifest, settings) {
  const play = activeTarget(manifest, settings);
  return normalizeIp(play.address, play.port);
}

function parseSandboxTarget(input) {
  if (!input || input.kind === "network") return null;
  let address = String(input.address || "").trim();
  let port = Number(input.port);
  const embedded = address.match(/^([^:]+):(\d{1,5})$/);
  if (embedded) {
    address = embedded[1];
    if (!Number.isInteger(port) || port < 1) port = Number(embedded[2]);
  }
  if (!/^[A-Za-z0-9.-]+$/.test(address)) {
    throw new Error("Sandbox address is invalid.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Sandbox address is invalid.");
  }
  const name = String(input.name || "Sandbox").trim().slice(0, 32);
  if (!name || name.toLowerCase() === "aetherion") {
    throw new Error("Choose a sandbox name other than AETHERION.");
  }
  return { kind: "sandbox", name, address, port };
}

module.exports = {
  networkServer,
  activeTarget,
  presentSettings,
  syncInstanceServers,
  quickPlayAddress,
  parseSandboxTarget,
};
