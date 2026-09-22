const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { getSettings, saveSettings, loadManifest, paths } = require("./lib/paths.cjs");
const { packStatus, syncMods, ensureFabricProfile, loadManifest: loadPack } = require("./lib/pack.cjs");
const { loginMicrosoft, restoreSession, logout, peekAccount } = require("./lib/auth.cjs");
const { prepareAndLaunch } = require("./lib/launch.cjs");
const { ensureJava } = require("./lib/java.cjs");
const { presentSettings, syncInstanceServers, parseSandboxTarget } = require("./lib/serverlist.cjs");
const control = require("./lib/control.cjs");
const updates = require("./lib/updates.cjs");

/** @type {BrowserWindow | null} */
let mainWindow = null;
let cachedAuth = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#100e16",
    title: "AETHERION",
    show: false,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, "..", "assets", "icon.png"),
  });

  updates.rememberMainWindow(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (!app.isPackaged) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function statePayload(update) {
  const manifest = loadManifest();
  const settings = getSettings();
  return {
    account: cachedAuth?.account || peekAccount(),
    settings: presentSettings(settings, manifest),
    pack: packStatus(),
    appVersion: app.getVersion(),
    control: control.currentPublic(),
    update: update || updates.snapshot(),
  };
}

app.whenReady().then(async () => {
  paths();
  createWindow();
  updates.attachUpdater({ getMainWindow: () => mainWindow });

  try {
    const session = await restoreSession();
    if (session) cachedAuth = session;
  } catch (err) {
    console.warn(err);
  }

  try {
    const update = await updates.checkForUpdate();
    send("update:status", update);
  } catch (err) {
    console.warn(err);
  }
});

app.on("window-all-closed", () => {
  if (updates.isUpdating()) return;
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("app:getState", async () => statePayload());

ipcMain.handle("settings:update", async (_e, patch) => {
  const nextPatch = {};
  if (patch && Object.prototype.hasOwnProperty.call(patch, "ramGb")) {
    const ram = Number(patch.ramGb);
    if (Number.isInteger(ram)) nextPatch.ramGb = Math.max(2, Math.min(16, ram));
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, "autoJoin")) {
    nextPatch.autoJoin = Boolean(patch.autoJoin);
  }
  const next = saveSettings(nextPatch);
  return presentSettings(next, loadManifest());
});

ipcMain.handle("play:setTarget", async (_e, target) => {
  const playTarget = parseSandboxTarget(target);
  const next = saveSettings({ playTarget });
  return presentSettings(next, loadManifest());
});

ipcMain.handle("auth:login", async () => {
  const session = await loginMicrosoft();
  cachedAuth = session;
  return session.account;
});

ipcMain.handle("auth:logout", async () => {
  logout();
  cachedAuth = null;
  return null;
});

ipcMain.handle("pack:install", async () => {
  const manifest = loadPack();
  const sendProgress = (evt) => send("launch:progress", evt);
  await ensureJava(manifest.java?.major || 21, sendProgress);
  await ensureFabricProfile(manifest, sendProgress);
  await syncMods(manifest, sendProgress);
  await syncInstanceServers(paths().instance, manifest, getSettings());
  return packStatus();
});

ipcMain.handle("game:play", async () => {
  if (!cachedAuth?.mclc) {
    const session = await restoreSession();
    if (!session) throw new Error("Sign in with Microsoft first.");
    cachedAuth = session;
  }

  await prepareAndLaunch({
    authorization: cachedAuth.mclc,
    send,
  });
  return { ok: true };
});

ipcMain.handle("control:unlock", async (_e, input) => control.unlockControl(input || {}));
ipcMain.handle("control:lock", async () => control.lockControl());
ipcMain.handle("sandbox:options", async () => control.sandboxOptions());
ipcMain.handle("sandbox:list", async () => control.sandboxList());
ipcMain.handle("sandbox:create", async (_e, input) => control.sandboxCreate(input));
ipcMain.handle("sandbox:start", async (_e, id) => control.sandboxStart(id));
ipcMain.handle("sandbox:delete", async (_e, id) => control.sandboxDelete(id));
ipcMain.handle("sandbox:upload", async (_e, input) => control.sandboxUpload(input || {}));

ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:close", () => mainWindow?.close());
