const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localFlow", {
  onSystemInputStatus: (callback) => {
    ipcRenderer.on("system-input:status", (_event, payload) => callback(payload));
  },
  stop: () => ipcRenderer.send("hud:stop"),
  cancel: () => ipcRenderer.send("hud:cancel"),
  openMainWindow: () => ipcRenderer.send("hud:open-main-window")
});
