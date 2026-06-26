const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localFlow", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  listHistory: () => ipcRenderer.invoke("history:list"),
  checkWhisper: () => ipcRenderer.invoke("diagnostics:whisper"),
  checkTextProvider: () => ipcRenderer.invoke("diagnostics:text"),
  getProviderStatus: () => ipcRenderer.invoke("providers:status"),
  getLocalModelStatus: () => ipcRenderer.invoke("llm:status"),
  getModelSetupStatus: () => ipcRenderer.invoke("models:setup-status"),
  startModelSetup: (type) => ipcRenderer.invoke("models:setup-start", type),
  cancelModelSetup: (type) => ipcRenderer.invoke("models:setup-cancel", type),
  refreshModelSetupStatus: () => ipcRenderer.invoke("models:setup-refresh"),
  processWav: (wavBytes) => ipcRenderer.invoke("dictation:wav", wavBytes),
  onShortcutToggle: (callback) => {
    ipcRenderer.on("recording:toggle", () => callback());
  },
  onRecordingStart: (callback) => {
    ipcRenderer.on("recording:start", () => callback());
  },
  onRecordingStop: (callback) => {
    ipcRenderer.on("recording:stop", () => callback());
  },
  onStatus: (callback) => {
    ipcRenderer.on("dictation:status", (_event, payload) => callback(payload));
  },
  onSystemInputStatus: (callback) => {
    ipcRenderer.on("system-input:status", (_event, payload) => callback(payload));
  },
  reportRecordingStatus: (payload) => {
    ipcRenderer.send("recording:status", payload);
  }
});
