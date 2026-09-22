const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { getSettings, saveSettings, loadManifest, paths } = require("./lib/paths.cjs");
const { packStatus, syncMods, ensureFabricProfile, loadManifest: loadPack } = require("./lib/pack.cjs");
const { loginMicrosoft, restoreSession, logout, peekAccount } = require("./lib/auth.cjs");
const { prepareAndLaunch } = require("./lib/launch.cjs");
const { ensureJava } = require("./lib/java.cjs");

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
    width: 1080,
    height: 680,
    minWidth: 920,
    minHeight: 600,
    backgroundColor: "#121018",
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

app.whenReady().then(async () => {
  // Ensure data dirs exist early
  paths();
  createWindow();

  try {
    const session = await restoreSession();
    if (session) cachedAuth = session;
  } catch (err) {
    console.warn(err);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("app:getState", async () => {
  const manifest = loadManifest();
  const settings = getSettings();
  const status = packStatus();
  const account = cachedAuth?.account || peekAccount();
  return {
    account,
    settings: {
      ramGb: settings.ramGb,
      autoJoin: settings.autoJoin !== false,
      serverAddress: settings.serverAddress || manifest.server.address,
    },
    pack: status,
    appVersion: app.getVersion(),
  };
});

ipcMain.handle("settings:update", async (_e, patch) => {
  const next = saveSettings(patch || {});
  const manifest = loadManifest();
  return {
    ramGb: next.ramGb,
    autoJoin: next.autoJoin !== false,
    serverAddress: next.serverAddress || manifest.server.address,
  };
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
  const { ensureServerEntry } = require("./lib/servers.cjs");
  const { getSettings, paths: getPaths } = require("./lib/paths.cjs");
  const settings = getSettings();
  await ensureServerEntry(getPaths().instance, {
    name: manifest.server.name,
    address: settings.serverAddress || manifest.server.address,
    port: manifest.server.port,
  });
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

ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:close", () => mainWindow?.close());
