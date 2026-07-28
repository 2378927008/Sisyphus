const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localFlow", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  listHistory: () => ipcRenderer.invoke("history:list"),
  updateHistory: (id, text) => ipcRenderer.invoke("history:update", { id, text }),
  reprocessHistory: (id) => ipcRenderer.invoke("history:reprocess", id),
  checkWhisper: () => ipcRenderer.invoke("diagnostics:whisper"),
  checkTextProvider: () => ipcRenderer.invoke("diagnostics:text"),
  getProviderStatus: () => ipcRenderer.invoke("providers:status"),
  getLocalModelStatus: () => ipcRenderer.invoke("llm:status"),
  getModelSetupStatus: () => ipcRenderer.invoke("models:setup-status"),
  startModelSetup: (type) => ipcRenderer.invoke("models:setup-start", type),
  cancelModelSetup: (type) => ipcRenderer.invoke("models:setup-cancel", type),
  refreshModelSetupStatus: () => ipcRenderer.invoke("models:setup-refresh"),
  getLatestStatus: () => ipcRenderer.invoke("dictation:status-latest"),
  insertText: (text) => ipcRenderer.invoke("dictation:insert-text", text),
  processWav: (wavBytes) => ipcRenderer.invoke("dictation:wav", wavBytes),
  requestRecordingToggle: () => ipcRenderer.send("recording:toggle-request"),
  onShortcutToggle: (callback) => {
    ipcRenderer.on("recording:toggle", () => callback());
  },
  onRecordingStart: (callback) => {
    ipcRenderer.on("recording:start", (_event, command) => callback(command));
  },
  onRecordingStop: (callback) => {
    ipcRenderer.on("recording:stop", (_event, command) => callback(command));
  },
  onRecordingReset: (callback) => {
    ipcRenderer.on("recording:reset", (_event, command) => callback(command));
  },
  onStatus: (callback) => {
    ipcRenderer.on("dictation:status", (_event, payload) => callback(payload));
  },
  onSystemInputStatus: (callback) => {
    ipcRenderer.on("system-input:status", (_event, payload) => callback(payload));
  },
  onOpenSettings: (callback) => {
    ipcRenderer.on("settings:open", () => callback());
  },
  reportRecordingStatus: (payload) => {
    ipcRenderer.send("recording:status", payload);
  }
});
