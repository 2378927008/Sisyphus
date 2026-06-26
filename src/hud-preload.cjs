const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localFlow", {
  onSystemInputStatus: (callback) => {
    ipcRenderer.on("system-input:status", (_event, payload) => callback(payload));
  }
});
