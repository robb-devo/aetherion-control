const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const RELEASES_URL = "https://api.github.com/repos/robb-devo/aetherion-control/releases?per_page=30";
const EXE_NAME = /^AETHERION-Launcher-(\d+\.\d+\.\d+)\.exe$/i;

let status = {
  available: false,
  version: null,
  currentVersion: null,
};
let feedUrl = null;
let updating = false;
let allowInstall = false;
/** @type {BrowserWindow | null} */
let updaterWindow = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

function currentVersion() {
  return app.getVersion();
}

function snapshot() {
  return {
    available: Boolean(status.available),
    version: status.version,
    currentVersion: currentVersion(),
  };
}

function compareVersions(left, right) {
  const a = String(left || "0.0.0").split(".").map((part) => Number(part) || 0);
  const b = String(right || "0.0.0").split(".").map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length, 3);
  for (let i = 0; i < length; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

async function findLauncherRelease() {
  const response = await fetch(RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "AETHERION-Launcher",
    },
  });
  if (!response.ok) {
    console.warn(`[AETHERION] update check failed: HTTP ${response.status}`);
    return null;
  }
  const releases = await response.json();
  if (!Array.isArray(releases)) return null;

  let best = null;
  for (const release of releases) {
    if (!release || release.draft || release.prerelease || !release.tag_name) continue;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const exe = assets.find((asset) => EXE_NAME.test(String(asset?.name || "")));
    const yml = assets.find((asset) => asset?.name === "latest.yml");
    if (!exe || !yml) continue;
    const version = String(exe.name).match(EXE_NAME)?.[1];
    if (!version) continue;
    if (!best || compareVersions(version, best.version) > 0) {
      best = {
        version,
        tag: release.tag_name,
        feed: `https://github.com/robb-devo/aetherion-control/releases/download/${release.tag_name}/`,
      };
    }
  }
  return best;
}

async function checkForUpdate() {
  status = { ...status, currentVersion: currentVersion() };
  if (!app.isPackaged) return snapshot();
  try {
    const release = await findLauncherRelease();
    if (release && compareVersions(release.version, currentVersion()) > 0) {
      status = { available: true, version: release.version, currentVersion: currentVersion() };
      feedUrl = release.feed;
    } else {
      status = { available: false, version: release?.version || null, currentVersion: currentVersion() };
      feedUrl = null;
    }
  } catch (err) {
    console.warn("[AETHERION] update check error:", err);
  }
  return snapshot();
}

function sendUpdater(payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send("updater:status", payload);
  }
}

function createUpdaterWindow() {
  updaterWindow = new BrowserWindow({
    width: 440,
    height: 232,
    resizable: false,
    maximizable: false,
    minimizable: false,
    frame: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: "#100e16",
    title: "Updating AETHERION",
    webPreferences: {
      preload: path.join(__dirname, "..", "updater-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  updaterWindow.setMenuBarVisibility(false);
  return updaterWindow.loadFile(path.join(__dirname, "..", "updater.html"));
}

function restoreMain() {
  allowInstall = false;
  updating = false;
  if (updaterWindow && !updaterWindow.isDestroyed()) updaterWindow.close();
  updaterWindow = null;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
}

async function startUpdate() {
  if (updating) return snapshot();
  if (!app.isPackaged) {
    throw new Error("Updates run from the installed Windows app.");
  }
  const release = await findLauncherRelease();
  if (!release || compareVersions(release.version, currentVersion()) <= 0) {
    status = { available: false, version: release?.version || null, currentVersion: currentVersion() };
    feedUrl = null;
    throw new Error("AETHERION is already up to date.");
  }
  status = { available: true, version: release.version, currentVersion: currentVersion() };
  feedUrl = release.feed;
  updating = true;
  allowInstall = true;

  try {
    await createUpdaterWindow();
  } catch (err) {
    updating = false;
    allowInstall = false;
    throw err;
  }
  updaterWindow?.show();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  sendUpdater({ message: `Downloading ${release.version}`, percent: 0 });

  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });

  const onProgress = (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress?.percent || 0)));
    sendUpdater({ message: `Downloading ${release.version}`, percent });
  };
  const onError = (err) => {
    const message = err instanceof Error ? err.message : String(err);
    sendUpdater({ message, percent: 0, error: true });
    updating = false;
  };

  autoUpdater.removeAllListeners("download-progress");
  autoUpdater.removeAllListeners("error");
  autoUpdater.removeAllListeners("update-downloaded");
  autoUpdater.on("download-progress", onProgress);
  autoUpdater.on("error", onError);

  try {
    const checked = await autoUpdater.checkForUpdates();
    const next = checked?.updateInfo?.version;
    if (!next || compareVersions(next, currentVersion()) <= 0) {
      throw new Error("No newer build was published.");
    }
    await new Promise((resolve, reject) => {
      autoUpdater.once("update-downloaded", () => resolve());
      autoUpdater.once("error", (err) => reject(err));
      void autoUpdater.downloadUpdate().catch(reject);
    });
    if (!allowInstall) return snapshot();
    sendUpdater({ message: "Installing and relaunching…", percent: 100 });
    setTimeout(() => {
      if (!allowInstall) return;
      autoUpdater.quitAndInstall(true, true);
    }, 400);
  } catch (err) {
    onError(err);
    throw err instanceof Error ? err : new Error(String(err));
  }

  return snapshot();
}

function isUpdating() {
  return updating;
}

function attachUpdater({ getMainWindow }) {
  mainWindow = getMainWindow();
  ipcMain.handle("update:status", () => checkForUpdate());
  ipcMain.handle("update:start", () => startUpdate());
  ipcMain.handle("updater:cancel", () => {
    restoreMain();
    return snapshot();
  });
}

function rememberMainWindow(win) {
  mainWindow = win;
}

module.exports = {
  attachUpdater,
  checkForUpdate,
  rememberMainWindow,
  isUpdating,
  snapshot,
  compareVersions,
  findLauncherRelease,
};
