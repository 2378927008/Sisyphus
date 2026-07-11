import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, session, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSafeStorageSecretCodec, createSettingsStore } from "./settings-store.js";
import { createSettingsEffectsTransaction } from "./settings-effects-transaction.js";
import { DictationService } from "./dictation-service.js";
import { applyElectronRuntimeSwitches } from "./electron-runtime.js";
import { validateWhisperSetup } from "./whisper-diagnostics.js";
import { detectWhisperAssets } from "./whisper-assets.js";
import { configureMediaPermissions } from "./media-permissions.js";
import { detectEmbeddedLlmAssets } from "./embedded-llm-assets.js";
import { getProcessingProviderStatus } from "./provider-registry.js";
import { buildSetupDownloadEnv, createModelSetupService } from "./model-setup.js";
import { wireModelSetupIpc } from "./model-setup-ipc.js";
import { checkTextProvider } from "./local-llm.js";
import { createSystemInputController } from "./system-input-controller.js";
import { buildHudWindowOptions, getHudHtmlPath, getHudPreloadPath } from "./hud-window.js";
import { getRuntimeRoot, getVendorRoot, getAppRoot } from "./runtime-root.js";
import { applyStartupSettings, shouldStartMinimized } from "./startup-settings.js";
import { createHotkeyManager } from "./hotkey-manager.js";
import { buildTrayMenuTemplate, getTrayTooltip } from "./tray-menu.js";
import { getTrayIconPath } from "./tray-icon.js";
import { pasteText } from "./paste.js";
import { insertTextIntoPreviousApp } from "./insert-text.js";
import { createNativeInputShortcutFromPackage } from "./native-input-shortcut.js";
import { createShortcutBackend } from "./shortcut-backend.js";

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
const maxRendererStatusTextLength = 240;

applyElectronRuntimeSwitches(app);

let mainWindow;
let tray;
let settingsStore;
let dictationService;
let modelSetupService;
let hudWindow;
let systemInputController;
let runtimeRoot;
let vendorRoot;
let appRoot;
let hotkeyManager;
let nativeShortcut;
let lastSettings;
let saveSettingsWithSystemEffects;
let lastSystemInputState = { phase: "idle" };
let lastDictationStatus;
let lastDictationEntry;

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
  Menu.setApplicationMenu(null);

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
    sendTransientStatus({ phase: "error", message: status.message, reason: status.reason });
  } else if (status.phase === "warning") {
    sendTransientStatus({ phase: "warning", message: status.message, reason: status.reason });
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

function sendTransientStatus(payload) {
  if (isUsableWindow(mainWindow)) {
    mainWindow.webContents.send("dictation:status", payload);
  }
  systemInputController?.handleRendererStatus(payload);
}

async function pasteLastDictation() {
  const text = getLastDictationText(lastDictationStatus);
  if (!text) {
    sendTransientStatus({
      phase: "warning",
      reason: "no_last_dictation",
      message: "No previous dictation result to paste."
    });
    return;
  }

  sendTransientStatus({
    phase: "pasting",
    message: "Pasting last dictation..."
  });

  try {
    await pasteText(text, { clipboard });
    sendTransientStatus({
      phase: "done",
      message: "Last dictation pasted."
    });
  } catch (error) {
    sendTransientStatus({
      phase: "warning",
      reason: error?.code || "paste_failed",
      message: "Paste failed. Text copied."
    });
  }
}

function getLastDictationText(status) {
  if (isPasteableDictationEntry(lastDictationEntry)) {
    return lastDictationEntry.text.trim();
  }

  if (isPasteableDictationEntry(status?.entry)) {
    return status.entry.text.trim();
  }

  if (typeof status?.text === "string" && status.text.trim()) {
    return status.text.trim();
  }

  return "";
}

function isPasteableDictationEntry(entry) {
  return Boolean(entry && entry.status === "complete" && typeof entry.text === "string" && entry.text.trim());
}

function sendSystemInputStatus(state) {
  lastSystemInputState = state && typeof state === "object" ? state : { phase: "idle" };
  const hudState = {
    ...lastSystemInputState,
    language: lastSettings?.interfaceLanguage || "zh-Hans"
  };
  refreshTrayMenu();
  sendWindowMessage(mainWindow, "system-input:status", state);
  sendWindowMessage(hudWindow, "system-input:status", hudState);

  if (state?.phase === "idle") {
    hideHud();
    return;
  }

  if (terminalSystemInputPhases.has(state?.phase)) {
    showHud();
    return;
  }

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
  ipcMain.handle("dictation:insert-text", async (_event, text) => {
    if (_event.sender !== mainWindow?.webContents) {
      return {
        ok: false,
        reason: "unauthorized",
        message: "Paste failed. Text copied."
      };
    }

    try {
      return await insertTextIntoPreviousApp(text, { mainWindow, clipboard });
    } catch {
      return {
        ok: false,
        reason: "paste_failed",
        message: "Paste failed. Text copied."
      };
    }
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
    const entry = await dictationService.processWav(buffer);
    if (isPasteableDictationEntry(entry)) {
      lastDictationEntry = entry;
    }
    return entry;
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
    setupEnv: async () => ({
      ELECTRON_RUN_AS_NODE: "1",
      ...buildSetupDownloadEnv(await settingsStore.getSettings())
    })
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
  nativeShortcut = await createNativeInputShortcutFromPackage({
    platform: process.platform,
    onError: (error) => {
      console.warn(`Native input hook unavailable: ${getErrorMessage(error)}`);
    }
  });
  const shortcutBackend = createShortcutBackend({
    globalShortcut,
    nativeShortcut
  });
  hotkeyManager = createHotkeyManager({
    globalShortcut: shortcutBackend,
    onToggle: () => systemInputController?.toggle(),
    onStart: () => systemInputController?.start(),
    onStop: () => systemInputController?.stop(),
    onPasteLast: () => pasteLastDictation()
  });
  saveSettingsWithSystemEffects = createSettingsEffectsTransaction({
    settingsStore,
    getCurrentSettings: () => lastSettings,
    setCurrentSettings: (settings) => {
      lastSettings = settings;
    },
    applyStartupSettings: (settings) => applyStartupSettings(app, settings),
    registerHotkey,
    refreshTrayMenu,
    reportSystemError
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
