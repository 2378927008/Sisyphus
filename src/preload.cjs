const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localFlow", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  listHistory: () => ipcRenderer.invoke("history:list"),
  checkWhisper: () => ipcRenderer.invoke("diagnostics:whisper"),
  getLocalModelStatus: () => ipcRenderer.invoke("llm:status"),
  processWav: (wavBytes) => ipcRenderer.invoke("dictation:wav", wavBytes),
  onShortcutToggle: (callback) => {
    ipcRenderer.on("recording:toggle", callback);
  },
  onStatus: (callback) => {
    ipcRenderer.on("dictation:status", (_event, payload) => callback(payload));
  }
});
