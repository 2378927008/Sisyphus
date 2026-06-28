import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, session, Tray } from "electron";
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
import { buildHudWindowOptions, getHudHtmlPath, getHudPreloadPath } from "./hud-window.js";
import { getRuntimeRoot, getVendorRoot, getAppRoot } from "./runtime-root.js";
import { applyStartupSettings, shouldStartMinimized } from "./startup-settings.js";
import { createHotkeyManager } from "./hotkey-manager.js";
import { buildTrayMenuTemplate, getTrayTooltip } from "./tray-menu.js";
import { getTrayIconPath } from "./tray-icon.js";

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
let terminalAutoIdleTimeout;
let runtimeRoot;
let vendorRoot;
let appRoot;
let hotkeyManager;
let lastSettings;
let lastSystemInputState = { phase: "idle" };
let lastDictationStatus;

function createWindow({ showOnReady = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "Local Flow Dictation",
    backgroundColor: "#f6f4ef",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!showOnReady) {
      return;
    }

    mainWindow.show();
    mainWindow.focus();
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
    preloadPath: getHudPreloadPath(__dirname),
    workArea: screen.getPrimaryDisplay().workArea
  }));

  hudWindow.loadFile(getHudHtmlPath(__dirname));
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(getTrayIconPath(appRoot));
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  refreshTrayMenu();
  tray.on("click", () => showMainWindow());
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  const language = lastSettings?.interfaceLanguage;
  tray.setToolTip(getTrayTooltip({
    language,
    state: lastSystemInputState
  }));
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
    language,
    state: lastSystemInputState,
    settings: lastSettings || {},
    handlers: {
      showMainWindow,
      toggleDictation: () => systemInputController?.toggle(),
      toggleShortcutPaused: () => updateSettingsFromTray({
        globalShortcutPaused: !lastSettings?.globalShortcutPaused
      }),
      toggleLaunchAtLogin: () => updateSettingsFromTray({
        launchAtLogin: !lastSettings?.launchAtLogin
      }),
      toggleStartMinimized: () => updateSettingsFromTray({
        startMinimizedToTray: !lastSettings?.startMinimizedToTray
      }),
      openSettings: () => {
        showMainWindow();
        sendWindowMessage(mainWindow, "settings:open");
      },
      quit: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  })));
}

function showMainWindow() {
  if (!isUsableWindow(mainWindow)) {
    return;
  }

  if (typeof mainWindow.restore === "function" && mainWindow.isMinimized?.()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

async function registerHotkey(settings = lastSettings) {
  if (!settings) {
    settings = await settingsStore.getSettings();
  }

  lastSettings = settings;
  const status = await hotkeyManager.register(settings);
  refreshTrayMenu();

  if (!status.ok) {
    sendStatus({ phase: "error", message: status.message, reason: status.reason });
  }

  return status;
}

function sendRecordingStartCommand() {
  systemInputController.setPhase("starting", {
    message: "Starting recording..."
  });
  sendWindowMessage(mainWindow, "recording:start");
}

function sendRecordingStopCommand() {
  systemInputController.setPhase("stopping", {
    message: "Stopping recording..."
  });
  sendWindowMessage(mainWindow, "recording:stop");
}

function sendStatus(payload) {
  lastDictationStatus = payload;
  if (isUsableWindow(mainWindow)) {
    mainWindow.webContents.send("dictation:status", payload);
  }
  systemInputController?.handleRendererStatus(payload);
}

function sendSystemInputStatus(state) {
  lastSystemInputState = state && typeof state === "object" ? state : { phase: "idle" };
  refreshTrayMenu();
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

async function saveSettingsWithSystemEffects(settings) {
  const previousSettings = lastSettings || await settingsStore.getSettings();
  const next = await settingsStore.saveSettings(settings);
  lastSettings = next;

  try {
    applyStartupSettings(app, lastSettings);
  } catch (error) {
    const restored = await restoreStartupSettings(previousSettings);
    await registerHotkey(restored);
    reportSystemError(error, "startup_settings_failed");
    error.localFlowStatusReported = true;
    throw error;
  }

  await registerHotkey(lastSettings);
  refreshTrayMenu();
  return lastSettings;
}

async function restoreStartupSettings(previousSettings) {
  const restored = await settingsStore.saveSettings({
    launchAtLogin: previousSettings.launchAtLogin,
    startMinimizedToTray: previousSettings.startMinimizedToTray
  });
  lastSettings = restored;
  refreshTrayMenu();
  return restored;
}

function updateSettingsFromTray(settingsPatch) {
  void saveSettingsWithSystemEffects(settingsPatch).catch((error) => {
    if (!error?.localFlowStatusReported) {
      reportSystemError(error, "settings_update_failed");
    }
    refreshTrayMenu();
  });
}

function reportSystemError(error, reason) {
  sendStatus({
    phase: "error",
    message: getErrorMessage(error),
    reason
  });
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function wireIpc() {
  ipcMain.on("recording:status", (_event, payload) => {
    if (_event.sender !== mainWindow?.webContents) {
      return;
    }

    const status = sanitizeRecordingStatusPayload(payload);
    systemInputController?.handleRendererStatus(status);
  });
  ipcMain.handle("dictation:status-latest", () => lastDictationStatus || null);
  ipcMain.handle("settings:get", () => settingsStore.getSettings());
  ipcMain.handle("settings:save", async (_event, settings) => {
    return saveSettingsWithSystemEffects(settings);
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
  ipcMain.handle("llm:status", () => detectEmbeddedLlmAssets(runtimeRoot));
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
  runtimeRoot = getRuntimeRoot({ app });
  vendorRoot = getVendorRoot(runtimeRoot);
  appRoot = getAppRoot({ app });
  const whisperAssetDefaults = await detectWhisperAssets(runtimeRoot);
  const embeddedLlmDefaults = await detectEmbeddedLlmAssets(runtimeRoot);
  settingsStore = createSettingsStore(app.getPath("userData"), {
    ...whisperAssetDefaults,
    embeddedLlmCliPath: embeddedLlmDefaults.cliPath,
    embeddedLlmModelPath: embeddedLlmDefaults.modelPath
  }, createSafeStorageSecretCodec(safeStorage));
  lastSettings = await settingsStore.getSettings();
  let startupSettingsError = null;
  try {
    applyStartupSettings(app, lastSettings);
  } catch (error) {
    startupSettingsError = error;
  }
  dictationService = new DictationService({
    settingsStore,
    clipboard,
    notifyStatus: sendStatus
  });
  modelSetupService = createModelSetupService({
    rootPath: runtimeRoot,
    scriptRootPath: appRoot,
    assetRootPath: runtimeRoot,
    nodeExecutable: process.execPath,
    setupEnv: {
      ELECTRON_RUN_AS_NODE: "1"
    }
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
    isReadyToRecord: () => true,
    requestRendererReset: () => sendWindowMessage(mainWindow, "recording:reset")
  });
  hotkeyManager = createHotkeyManager({
    globalShortcut,
    onToggle: () => systemInputController?.toggle()
  });

  wireIpc();
  const startHidden = shouldStartMinimized(process.argv, lastSettings);
  createWindow({ showOnReady: !startHidden });
  createHudWindow();
  createTray();
  if (startupSettingsError) {
    reportSystemError(startupSettingsError, "startup_settings_failed");
  }
  await registerHotkey(lastSettings);
});

app.on("will-quit", () => {
  hotkeyManager?.unregister();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showMainWindow();
  }
});
