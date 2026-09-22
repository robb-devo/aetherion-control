const fs = require("node:fs");
const path = require("node:path");
const { paths, loadManifest, ensureDir } = require("./paths.cjs");
const { downloadFile, request } = require("./java.cjs");

function readBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => resolve(Buffer.concat(chunks)));
    res.on("error", reject);
  });
}

async function fetchJson(url) {
  const res = await request(url);
  const buf = await readBody(res);
  return JSON.parse(buf.toString("utf8"));
}

async function ensureFabricProfile(manifest, emit) {
  const p = paths();
  const mc = manifest.minecraft;
  const loader = manifest.loader.version;
  const versionId = `fabric-loader-${loader}-${mc}`;
  const versionDir = ensureDir(path.join(p.minecraft, "versions", versionId));
  const jsonPath = path.join(versionDir, `${versionId}.json`);

  if (fs.existsSync(jsonPath)) {
    emit?.({ phase: "fabric", message: "Fabric profile ready", progress: 1 });
    return versionId;
  }

  emit?.({ phase: "fabric", message: "Fetching Fabric loader…", progress: 0.2 });
  const url = `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/profile/json`;
  const profile = await fetchJson(url);
  fs.writeFileSync(jsonPath, JSON.stringify(profile, null, 2), "utf8");
  emit?.({ phase: "fabric", message: "Fabric profile ready", progress: 1 });
  return versionId;
}

async function syncFileList(list, dir, phase, emit, label) {
  ensureDir(dir);
  const items = Array.isArray(list) ? list : [];
  const wanted = new Set(items.map((m) => m.filename));

  for (const entry of fs.readdirSync(dir)) {
    if (!wanted.has(entry) && (entry.endsWith(".jar") || entry.endsWith(".zip"))) {
      // Only prune managed pack files we know about from previous packs:
      // leave user-dropped extras alone unless they collide with old Aetherion names.
      // For mods we always prune; for packs we prune known Complementary/FurfSky leftovers.
      if (phase === "mods") {
        fs.unlinkSync(path.join(dir, entry));
      }
    }
  }

  // For mods: always remove jars not in the pack
  if (phase === "mods") {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".jar")) continue;
      if (!wanted.has(entry)) fs.unlinkSync(path.join(dir, entry));
    }
  }

  const missing = items.filter((item) => !fs.existsSync(path.join(dir, item.filename)));
  const total = Math.max(1, missing.length);

  if (missing.length === 0) {
    emit?.({ phase, message: `${label} ready · ${items.length}`, progress: 1 });
    return { downloaded: 0, total: items.length };
  }

  let done = 0;
  for (const item of missing) {
    const dest = path.join(dir, item.filename);
    emit?.({
      phase,
      message: `Downloading ${item.slug}…`,
      progress: done / total,
      detail: item.filename,
    });
    await downloadFile(item.url, dest, (ratio) => {
      emit?.({
        phase,
        message: `Downloading ${item.slug}…`,
        progress: (done + ratio) / total,
        detail: item.filename,
      });
    });
    done += 1;
  }

  emit?.({ phase, message: `${label} ready · ${items.length}`, progress: 1 });
  return { downloaded: missing.length, total: items.length };
}

function upsertOptionsKey(content, key, value) {
  const line = `${key}:${value}`;
  const re = new RegExp(`^${key}:.*$`, "m");
  if (re.test(content)) return content.replace(re, line);
  return `${content.trimEnd()}\n${line}\n`;
}

function applyClientDefaults(manifest) {
  const p = paths();
  const optionsPath = path.join(p.instance, "options.txt");
  let options = fs.existsSync(optionsPath) ? fs.readFileSync(optionsPath, "utf8") : "";

  if (!options.trim()) {
    options = [
      "lang:en_us",
      "fov:0.0",
      "maxFps:120",
      "enableVsync:true",
      "graphicsMode:1",
      "renderDistance:12",
      "simulationDistance:8",
    ].join("\n") + "\n";
  }

  const enabledPacks = (manifest.resourcepacks || [])
    .filter((pack) => pack.enable !== false)
    .map((pack) => `file/${pack.filename}`);

  // Only managed packs — leave server-prompted packs alone at runtime.
  // Always reset our known FurfSky entry out of the enabled list.
  const cleaned = enabledPacks.length
    ? JSON.stringify(["vanilla", ...enabledPacks])
    : JSON.stringify(["vanilla"]);
  options = upsertOptionsKey(options, "resourcePacks", cleaned);
  // Strip leftover FurfSky from any previous install
  options = options.replace(/,? ?"file\/FurfSky-Reborn-FULL\.zip"/g, "");
  options = options.replace(/resourcePacks:\[.*\]/, (line) => {
    try {
      const raw = line.slice("resourcePacks:".length);
      const list = JSON.parse(raw).filter(
        (entry) => typeof entry === "string" && !/furfsky/i.test(entry),
      );
      if (!list.includes("vanilla")) list.unshift("vanilla");
      return `resourcePacks:${JSON.stringify(list)}`;
    } catch {
      return 'resourcePacks:["vanilla"]';
    }
  });
  options = upsertOptionsKey(options, "enableVsync", "true");
  options = upsertOptionsKey(options, "entityDistanceScaling", "0.75");
  options = upsertOptionsKey(options, "entityShadows", "false");

  fs.writeFileSync(optionsPath, options.endsWith("\n") ? options : `${options}\n`, "utf8");

  // Remove downloaded FurfSky file if present
  const legacyFurf = path.join(p.resourcepacks, "FurfSky-Reborn-FULL.zip");
  if (fs.existsSync(legacyFurf)) {
    try {
      fs.unlinkSync(legacyFurf);
    } catch {
      /* ignore */
    }
  }

  const enabledShader = (manifest.shaderpacks || []).find((s) => s.enable !== false);
  if (enabledShader) {
    const irisDir = ensureDir(path.join(p.instance, "config"));
    const irisPath = path.join(irisDir, "iris.properties");
    let iris = fs.existsSync(irisPath) ? fs.readFileSync(irisPath, "utf8") : "";
    const shaderLine = `shaderPack=${enabledShader.filename}`;
    if (/^shaderPack=.*/m.test(iris)) {
      iris = iris.replace(/^shaderPack=.*/m, shaderLine);
    } else {
      iris = `${iris.trimEnd()}\n${shaderLine}\n`.replace(/^\n+/, "");
    }
    if (!/enableShaders=/m.test(iris)) iris += "enableShaders=true\n";
    if (/^maxShadowRenderDistance=.*/m.test(iris)) {
      iris = iris.replace(/^maxShadowRenderDistance=.*/m, "maxShadowRenderDistance=12");
    } else {
      iris += "maxShadowRenderDistance=12\n";
    }
    fs.writeFileSync(irisPath, iris.endsWith("\n") ? iris : `${iris}\n`, "utf8");
  }
}

async function syncPack(manifest, emit) {
  await syncFileList(manifest.mods, paths().mods, "mods", emit, "Mods");
  await syncFileList(
    manifest.shaderpacks || [],
    paths().shaderpacks,
    "shaders",
    emit,
    "Shaders",
  );
  await syncFileList(
    manifest.resourcepacks || [],
    paths().resourcepacks,
    "resourcepacks",
    emit,
    "Resource packs",
  );
  applyClientDefaults(manifest);
}

async function syncMods(manifest, emit) {
  return syncPack(manifest, emit);
}

function packStatus() {
  const manifest = loadManifest();
  const p = paths();
  const present = manifest.mods.filter((m) => fs.existsSync(path.join(p.mods, m.filename))).length;
  const shadersPresent = (manifest.shaderpacks || []).filter((s) =>
    fs.existsSync(path.join(p.shaderpacks, s.filename)),
  ).length;
  const packsPresent = (manifest.resourcepacks || []).filter((r) =>
    fs.existsSync(path.join(p.resourcepacks, r.filename)),
  ).length;
  const complete =
    present === manifest.mods.length &&
    shadersPresent === (manifest.shaderpacks || []).length &&
    packsPresent === (manifest.resourcepacks || []).length;
  return {
    complete,
    present,
    total: manifest.mods.length,
    shadersPresent,
    shadersTotal: (manifest.shaderpacks || []).length,
    packsPresent,
    packsTotal: (manifest.resourcepacks || []).length,
    minecraft: manifest.minecraft,
    loader: manifest.loader.version,
    packVersion: manifest.version,
    server: manifest.server,
  };
}

module.exports = {
  ensureFabricProfile,
  syncMods,
  syncPack,
  packStatus,
  loadManifest,
  applyClientDefaults,
};
