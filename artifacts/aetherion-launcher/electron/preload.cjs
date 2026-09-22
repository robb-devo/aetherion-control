const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aetherion", {
  getState: () => ipcRenderer.invoke("app:getState"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  setPlayTarget: (target) => ipcRenderer.invoke("play:setTarget", target),
  login: () => ipcRenderer.invoke("auth:login"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  installPack: () => ipcRenderer.invoke("pack:install"),
  play: () => ipcRenderer.invoke("game:play"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  updateStatus: () => ipcRenderer.invoke("update:status"),
  startUpdate: () => ipcRenderer.invoke("update:start"),
  sandboxOptions: () => ipcRenderer.invoke("sandbox:options"),
  sandboxList: () => ipcRenderer.invoke("sandbox:list"),
  sandboxCreate: (input) => ipcRenderer.invoke("sandbox:create", input),
  sandboxStart: (id) => ipcRenderer.invoke("sandbox:start", id),
  sandboxDelete: (id) => ipcRenderer.invoke("sandbox:delete", id),
  sandboxUpload: (input) => ipcRenderer.invoke("sandbox:upload", input),
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
  onRunning: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("launch:running", listener);
    return () => ipcRenderer.removeListener("launch:running", listener);
  },
  onUpdate: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
});
