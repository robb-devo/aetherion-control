const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aetherionUpdater", {
  onStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("updater:status", listener);
    return () => ipcRenderer.removeListener("updater:status", listener);
  },
  cancel: () => ipcRenderer.invoke("updater:cancel"),
});
