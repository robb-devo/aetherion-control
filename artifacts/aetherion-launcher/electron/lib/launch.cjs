const path = require("node:path");
const fs = require("node:fs");
const child = require("node:child_process");
const { Client } = require("minecraft-launcher-core");
const { paths, getSettings, loadManifest } = require("./paths.cjs");
const { ensureJava } = require("./java.cjs");
const { ensureFabricProfile, syncMods } = require("./pack.cjs");
const { syncInstanceServers, quickPlayAddress } = require("./serverlist.cjs");

let activeClient = null;
let activeProcess = null;

function emitProgress(send, payload) {
  send?.("launch:progress", payload);
}

/**
 * Patch MCLC's spawn: default pipes every log line through Electron IPC,
 * which back-pressures the game thread and feels like a hitch every few seconds.
 * Modrinth does not do this — movement stays smooth, world/entities hitch.
 */
function patchMclcSpawn() {
  if (Client.prototype.__aetherionPatched) return;
  Client.prototype.__aetherionPatched = true;

  Client.prototype.startMinecraft = function startMinecraftPatched(launchArguments) {
    const logFile = path.join(
      this.options.overrides.gameDirectory || this.options.root,
      "logs",
      "aetherion-launch.log",
    );
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(
        logFile,
        `Launch ${new Date().toISOString()}\n${(this.options.javaPath || "java")} ${launchArguments.join(" ")}\n\n`,
        "utf8",
      );
    } catch {
      /* ignore */
    }

    const minecraft = child.spawn(this.options.javaPath ? this.options.javaPath : "java", launchArguments, {
      cwd: this.options.overrides.cwd || this.options.root,
      detached: true,
      // Critical: do NOT pipe stdio into Electron — that causes periodic freezes.
      stdio: "ignore",
      windowsHide: false,
    });

    minecraft.unref();
    minecraft.on("close", (code) => this.emit("close", code));
    return minecraft;
  };
}

/** Lean JVM flags. Avoid AlwaysPreTouch / exotic G1 tuning that fights MCLC defaults. */
function javaArgsForClient() {
  return [
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=100",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-Dlog4j2.formatMsgNoLookups=true",
  ];
}

async function prepareAndLaunch({ authorization, send }) {
  patchMclcSpawn();

  const manifest = loadManifest();
  const settings = getSettings();
  const p = paths();

  const javaPath = await ensureJava(manifest.java?.major || 21, (evt) =>
    emitProgress(send, evt),
  );

  const versionId = await ensureFabricProfile(manifest, (evt) => emitProgress(send, evt));

  emitProgress(send, { phase: "vanilla", message: "Preparing Minecraft assets…", progress: 0 });
  await syncMods(manifest, (evt) => emitProgress(send, evt));

  const ramGb = Math.max(2, Math.min(32, Number(settings.ramGb) || 6));
  // Keep min == max so the heap never resizes mid-session.
  const minGb = ramGb;
  // Same directory MCLC passes as --gameDir / ${game_directory}.
  const gameDir = p.instance;

  emitProgress(send, { phase: "server", message: "Updating server list…", progress: 1 });
  await syncInstanceServers(gameDir, manifest, settings);
  const serverAddress = quickPlayAddress(manifest, settings);

  const client = new Client();
  activeClient = client;

  // Progress only during install — never stream game logs into the UI.
  client.on("progress", (e) => {
    const type = e.type || "download";
    const task = e.task || 0;
    const total = e.total || 1;
    emitProgress(send, {
      phase: "vanilla",
      message: `Downloading ${type}…`,
      progress: Math.min(1, task / total),
      detail: e.name || type,
    });
  });
  client.on("close", (code) => {
    activeClient = null;
    activeProcess = null;
    // Minecraft rewrites servers.dat on exit. Put AETHERION back if that save dropped it.
    void syncInstanceServers(gameDir, manifest, getSettings()).catch((err) => {
      console.warn("Could not restore server list after exit:", err);
    });
    send?.("launch:close", { code });
  });

  emitProgress(send, { phase: "launch", message: "Starting Minecraft…", progress: 1 });

  const opts = {
    authorization,
    root: p.minecraft,
    version: {
      number: manifest.minecraft,
      type: "release",
      custom: versionId,
    },
    memory: {
      max: `${ramGb}G`,
      min: `${minGb}G`,
    },
    javaPath,
    customArgs: javaArgsForClient(),
    overrides: {
      gameDirectory: gameDir,
      cwd: gameDir,
      maxSockets: 4,
      detached: true,
    },
  };

  if (settings.autoJoin !== false && serverAddress) {
    opts.quickPlay = {
      type: "multiplayer",
      identifier: serverAddress,
    };
  }

  activeProcess = await client.launch(opts);
  send?.("launch:running", { ok: true });
  return { ok: true };
}

function isLaunching() {
  return Boolean(activeClient || activeProcess);
}

module.exports = {
  prepareAndLaunch,
  isLaunching,
};
