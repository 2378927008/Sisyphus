import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, session, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSafeStorageSecretCodec, createSettingsStore } from "./settings-store.js";
import { DictationService } from "./dictation-service.js";
import { applyElectronRuntimeSwitches } from "./electron-runtime.js";
import { validateWhisperSetup } from "./whisper-diagnostics.js";
import { detectWhisperAssets } from "./whisper-assets.js";
import { configureMediaPermissions } from "./media-permissions.js";
import { detectEmbeddedLlmAssets } from "./embedded-llm-assets.js";
import { getProcessingProviderStatus } from "./provider-registry.js";
import { createModelSetupService } from "./model-setup.js";
import { wireModelSetupIpc } from "./model-setup-ipc.js";
import { checkTextProvider } from "./local-llm.js";
import { createSystemInputController } from "./system-input-controller.js";
import { buildHudWindowOptions, getHudHtmlPath } from "./hud-window.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererRecordingPhases = new Set([
  "idle",
  "starting",
  "recording",
  "stopping",
  "transcribing",
  "pasting",
  "done",
  "error",
  "warning"
]);
const terminalSystemInputPhases = new Set(["done", "warning", "error"]);
const recordingCommandTimeoutMs = 8000;
const terminalAutoIdleMs = 2500;
const maxRendererStatusTextLength = 240;

applyElectronRuntimeSwitches(app);

let mainWindow;
let tray;
let settingsStore;
let dictationService;
let modelSetupService;
let hudWindow;
let systemInputController;
let recordingCommandTimeout;
let terminalAutoIdleTimeout;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "Local Flow Dictation",
    backgroundColor: "#f6f4ef",
    webPreferences: {
      preload: path.join(__dirname, "../preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createHudWindow() {
  hudWindow = new BrowserWindow(buildHudWindowOptions({
    preloadPath: path.join(__dirname, "../preload.cjs")
  }));

  hudWindow.loadFile(getHudHtmlPath(__dirname));
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Local Flow Dictation");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show", click: () => mainWindow.show() },
    { label: "Start/stop dictation", click: () => systemInputController?.toggle() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on("click", () => mainWindow.show());
}

async function registerHotkey() {
  globalShortcut.unregisterAll();
  const settings = await settingsStore.getSettings();
  const ok = globalShortcut.register(settings.hotkey, () => systemInputController?.toggle());

  if (!ok) {
    sendStatus({ phase: "error", message: `Could not register hotkey: ${settings.hotkey}` });
  }
}

function sendRecordingStartCommand() {
  systemInputController.setPhase("starting", {
    message: "Starting recording..."
  });
  scheduleRecordingCommandTimeout("starting", "Recording did not start.");
  sendWindowMessage(mainWindow, "recording:start");
}

function sendRecordingStopCommand() {
  systemInputController.setPhase("stopping", {
    message: "Stopping recording..."
  });
  scheduleRecordingCommandTimeout("stopping", "Recording did not stop.");
  sendWindowMessage(mainWindow, "recording:stop");
}

function sendStatus(payload) {
  if (isUsableWindow(mainWindow)) {
    mainWindow.webContents.send("dictation:status", payload);
  }
  systemInputController?.handleRendererStatus(payload);
}

function sendSystemInputStatus(state) {
  sendWindowMessage(mainWindow, "system-input:status", state);
  sendWindowMessage(hudWindow, "system-input:status", state);

  if (state?.phase === "idle") {
    clearTerminalAutoIdle();
    hideHud();
    return;
  }

  if (terminalSystemInputPhases.has(state?.phase)) {
    showHud();
    scheduleTerminalAutoIdle(state);
    return;
  }

  clearTerminalAutoIdle();
  if (isActiveSystemInputPhase(state?.phase)) {
    showHud();
  }
}

function showHud() {
  if (!isUsableWindow(hudWindow)) {
    return;
  }

  if (typeof hudWindow.showInactive === "function") {
    hudWindow.showInactive();
  } else {
    hudWindow.show();
  }
}

function hideHud() {
  if (isUsableWindow(hudWindow)) {
    hudWindow.hide();
  }
}

function sendWindowMessage(window, channel, payload) {
  if (isUsableWindow(window)) {
    window.webContents.send(channel, payload);
  }
}

function isUsableWindow(window) {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
}

function isActiveSystemInputPhase(phase) {
  return Boolean(phase && phase !== "idle");
}

function scheduleRecordingCommandTimeout(expectedPhase, message) {
  clearRecordingCommandTimeout();
  recordingCommandTimeout = setTimeout(() => {
    if (systemInputController?.getState().phase === expectedPhase) {
      sendWindowMessage(mainWindow, "recording:reset");
      systemInputController.setPhase("error", {
        reason: "renderer_timeout",
        message
      });
    }
  }, recordingCommandTimeoutMs);
}

function clearRecordingCommandTimeout() {
  if (recordingCommandTimeout) {
    clearTimeout(recordingCommandTimeout);
    recordingCommandTimeout = null;
  }
}

function scheduleTerminalAutoIdle(state) {
  clearTerminalAutoIdle();
  const terminalPhase = state?.phase;
  const terminalUpdatedAt = state?.updatedAt;
  terminalAutoIdleTimeout = setTimeout(() => {
    const currentState = systemInputController?.getState();
    if (currentState?.phase === terminalPhase && currentState?.updatedAt === terminalUpdatedAt) {
      systemInputController?.setPhase("idle");
    }
  }, terminalAutoIdleMs);
}

function clearTerminalAutoIdle() {
  if (terminalAutoIdleTimeout) {
    clearTimeout(terminalAutoIdleTimeout);
    terminalAutoIdleTimeout = null;
  }
}

function sanitizeRecordingStatusPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const phase = rendererRecordingPhases.has(source.phase) ? source.phase : "idle";
  return {
    phase,
    message: sanitizeRendererStatusText(source.message),
    reason: sanitizeRendererStatusText(source.reason)
  };
}

function sanitizeRendererStatusText(value) {
  return typeof value === "string" ? value.slice(0, maxRendererStatusTextLength) : "";
}

function wireIpc() {
  ipcMain.on("recording:status", (_event, payload) => {
    if (_event.sender !== mainWindow?.webContents) {
      return;
    }

    const status = sanitizeRecordingStatusPayload(payload);
    if (!["starting", "stopping"].includes(status.phase)) {
      clearRecordingCommandTimeout();
    }
    systemInputController?.handleRendererStatus(status);
  });
  ipcMain.handle("settings:get", () => settingsStore.getSettings());
  ipcMain.handle("settings:save", async (_event, settings) => {
    const next = await settingsStore.saveSettings(settings);
    await registerHotkey();
    return next;
  });
  ipcMain.handle("history:list", () => settingsStore.getHistory());
  ipcMain.handle("diagnostics:whisper", async () => {
    const settings = await settingsStore.getSettings();
    return validateWhisperSetup(settings);
  });
  ipcMain.handle("diagnostics:text", async () => {
    const settings = await settingsStore.getSettings({ includeSecrets: true });
    return checkTextProvider(settings);
  });
  ipcMain.handle("providers:status", async () => {
    const settings = await settingsStore.getSettings({ includeSecrets: true });
    return getProcessingProviderStatus(settings);
  });
  ipcMain.handle("llm:status", () => detectEmbeddedLlmAssets(process.cwd()));
  wireModelSetupIpc({
    ipcMain,
    modelSetupService,
    settingsStore
  });
  ipcMain.handle("dictation:wav", async (_event, wavBytes) => {
    const buffer = Buffer.from(wavBytes);
    return dictationService.processWav(buffer);
  });
}

app.whenReady().then(async () => {
  configureMediaPermissions(session.defaultSession);
  const whisperAssetDefaults = await detectWhisperAssets(process.cwd());
  const embeddedLlmDefaults = await detectEmbeddedLlmAssets(process.cwd());
  settingsStore = createSettingsStore(app.getPath("userData"), {
    ...whisperAssetDefaults,
    embeddedLlmCliPath: embeddedLlmDefaults.cliPath,
    embeddedLlmModelPath: embeddedLlmDefaults.modelPath
  }, createSafeStorageSecretCodec(safeStorage));
  dictationService = new DictationService({
    settingsStore,
    clipboard,
    notifyStatus: sendStatus
  });
  modelSetupService = createModelSetupService({
    rootPath: process.cwd()
  });
  systemInputController = createSystemInputController({
    sendToMain: sendSystemInputStatus,
    sendToHud: () => {},
    startRecording: async () => {
      sendRecordingStartCommand();
    },
    stopRecording: async () => {
      sendRecordingStopCommand();
    },
    isReadyToRecord: () => true
  });

  wireIpc();
  createWindow();
  createHudWindow();
  createTray();
  await registerHotkey();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
