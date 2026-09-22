const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aetherion", {
  getState: () => ipcRenderer.invoke("app:getState"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  login: () => ipcRenderer.invoke("auth:login"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  installPack: () => ipcRenderer.invoke("pack:install"),
  play: () => ipcRenderer.invoke("game:play"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  onProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("launch:progress", listener);
    return () => ipcRenderer.removeListener("launch:progress", listener);
  },
  onLog: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("launch:log", listener);
    return () => ipcRenderer.removeListener("launch:log", listener);
  },
  onClose: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("launch:close", listener);
    return () => ipcRenderer.removeListener("launch:close", listener);
  },
});
