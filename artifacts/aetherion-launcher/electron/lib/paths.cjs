const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { app } = require("electron");

function dataRoot() {
  return path.join(app.getPath("appData"), "AetherionLauncher");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function paths() {
  const root = dataRoot();
  return {
    root,
    settings: path.join(root, "settings.json"),
    account: path.join(root, "account.json"),
    control: path.join(root, "control-session.json"),
    runtime: ensureDir(path.join(root, "runtime")),
    javaHome: path.join(root, "runtime", "jdk-21"),
    minecraft: ensureDir(path.join(root, "minecraft")),
    instance: ensureDir(path.join(root, "instance")),
    mods: ensureDir(path.join(root, "instance", "mods")),
    shaderpacks: ensureDir(path.join(root, "instance", "shaderpacks")),
    resourcepacks: ensureDir(path.join(root, "instance", "resourcepacks")),
    logs: ensureDir(path.join(root, "logs")),
  };
}

function packManifestPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "pack", "manifest.json");
  }
  return path.join(__dirname, "..", "pack", "manifest.json");
}

function loadManifest() {
  const file = packManifestPath();
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function defaultSettings() {
  const totalGb = Math.max(4, Math.floor(os.totalmem() / (1024 ** 3)));
  const suggested = Math.min(8, Math.max(4, Math.floor(totalGb / 2)));
  return {
    ramGb: suggested,
    autoJoin: true,
    serverAddress: null,
  };
}

function getSettings() {
  const p = paths();
  const base = defaultSettings();
  const stored = readJson(p.settings, {});
  return { ...base, ...stored };
}

function saveSettings(patch) {
  const p = paths();
  const next = { ...getSettings(), ...patch };
  writeJson(p.settings, next);
  return next;
}

module.exports = {
  paths,
  loadManifest,
  readJson,
  writeJson,
  getSettings,
  saveSettings,
  defaultSettings,
  ensureDir,
};
