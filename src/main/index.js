import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, session, Tray } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSafeStorageSecretCodec, createSettingsStore } from "./settings-store.js";
import { createSettingsEffectsTransaction } from "./settings-effects-transaction.js";
import { DictationService } from "./dictation-service.js";
import { createHistoryActions } from "./history-actions.js";
import { wireHistoryIpc } from "./history-ipc.js";
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
import { createHudActions, wireHudIpc } from "./hud-actions.js";
import {
  bindHudDisplayChanges,
  buildHudWindowOptions,
  getHudHtmlPath,
  getHudPreloadPath,
  showHudWindow
} from "./hud-window.js";
import { getRuntimeRoot, getVendorRoot, getAppRoot } from "./runtime-root.js";
import { applyStartupSettings, shouldStartMinimized } from "./startup-settings.js";
import { createDeferredReveal, registerSingleInstance } from "./single-instance.js";
import { createHotkeyManager } from "./hotkey-manager.js";
import { buildTrayMenuTemplate, getBackgroundNotice, getTrayTooltip } from "./tray-menu.js";
import { getTrayIconPath } from "./tray-icon.js";
import {
  bindTrustedWindowNavigation,
  bindMainWindowLifecycle,
  buildMainWindowOptions,
  revealMainWindow,
  showMainWindowLoadFailure
} from "./main-window.js";
import { pasteText } from "./paste.js";
import { insertTextIntoPreviousApp } from "./insert-text.js";
import { createNativeInputShortcutFromPackage } from "./native-input-shortcut.js";
import { createShortcutBackend } from "./shortcut-backend.js";
import { createPasteLastAction } from "./paste-last-action.js";
import { createAuthorizedIpcMain } from "./ipc-authorization.js";
import { getValidatedWavBuffer } from "./ipc-contracts.js";
import { handleStartupFailure } from "./startup-failure.js";
import {
  toLocalModelUiStatus,
  toTextDiagnosticResult,
  toWhisperDiagnosticResult
} from "./product-ui-results.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainRendererPath = path.join(__dirname, "../renderer/index.html");
const hudRendererPath = getHudHtmlPath(__dirname);
const approvedMainRendererUrl = pathToFileURL(mainRendererPath).href;
const approvedHudRendererUrl = pathToFileURL(hudRendererPath).href;
const rendererRecordingPhases = new Set([
  "idle",
  "starting",
  "recording",
  "stopping",
  "transcribing",
  "polishing",
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
let historyActions;
let modelSetupService;
let hudWindow;
let systemInputController;
let hudActions;
let runtimeRoot;
let vendorRoot;
let appRoot;
let hotkeyManager;
let nativeShortcut;
let lastSettings;
let saveSettingsWithSystemEffects;
let disposeHudDisplayChanges;
let lastSystemInputState = { phase: "idle" };
let lastDictationStatus;
let lastDictationEntry;
let activeDictationOperationId = null;
const mainWindowReveal = createDeferredReveal(showMainWindow);

function createWindow({ showOnReady = true } = {}) {
  mainWindow = new BrowserWindow(buildMainWindowOptions({
    preloadPath: path.join(__dirname, "../preload.cjs")
  }));
  Menu.setApplicationMenu(null);
  bindTrustedWindowNavigation({
    window: mainWindow,
    approvedUrl: approvedMainRendererUrl
  });
  bindMainWindowLifecycle({
    window: mainWindow,
    showOnReady,
    isQuitting: () => Boolean(app.isQuitting),
    onFirstHide: showBackgroundNotice,
    onLoadFailure: () => {
      void showMainWindowLoadFailure({
        app,
        dialog,
        language: lastSettings?.interfaceLanguage
      });
    }
  });
  mainWindow.loadFile(mainRendererPath);
  mainWindowReveal.flush();
}

function createHudWindow() {
  hudWindow = new BrowserWindow(buildHudWindowOptions({
    preloadPath: getHudPreloadPath(__dirname),
    workArea: screen.getPrimaryDisplay().workArea
  }));

  bindTrustedWindowNavigation({
    window: hudWindow,
    approvedUrl: approvedHudRendererUrl
  });
  disposeHudDisplayChanges?.();
  disposeHudDisplayChanges = bindHudDisplayChanges({
    window: hudWindow,
    screen
  });
  hudWindow.loadFile(hudRendererPath);
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(getTrayIconPath(appRoot));
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  refreshTrayMenu();
  tray.on("click", () => mainWindowReveal.request());
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
      showMainWindow: () => mainWindowReveal.request(),
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
        mainWindowReveal.request();
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
  return revealMainWindow(mainWindow);
}

function showBackgroundNotice() {
  const content = getBackgroundNotice(lastSettings?.interfaceLanguage);
  tray?.displayBalloon?.({
    title: "Local Flow",
    content
  });
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

function sendRecordingStartCommand(command) {
  sendWindowMessage(mainWindow, "recording:start", command);
}

function sendRecordingStopCommand(command) {
  sendWindowMessage(mainWindow, "recording:stop", command);
}

function sendStatus(payload) {
  const status = activeDictationOperationId === null
    ? payload
    : { ...payload, operationId: activeDictationOperationId };
  lastDictationStatus = status;
  if (isUsableWindow(mainWindow)) {
    mainWindow.webContents.send("dictation:status", status);
  }
  systemInputController?.handleSystemStatus(status);
}

function sendTransientStatus(payload) {
  if (systemInputController && !systemInputController.handleAuxiliaryStatus(payload)) {
    return false;
  }
  if (isUsableWindow(mainWindow)) {
    mainWindow.webContents.send("dictation:status", payload);
  }
  return true;
}

async function pasteLastDictation() {
  return createPasteLastAction({
    hasActiveOperation: () => Boolean(systemInputController?.hasActiveOperation()),
    getText: () => getLastDictationText(lastDictationStatus),
    paste: (text) => pasteText(text, { clipboard }),
    notify: sendTransientStatus
  })();
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
  hudActions?.syncPhase(lastSystemInputState.phase);
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
  showHudWindow({ window: hudWindow, screen });
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
    operationId: Number.isSafeInteger(source.operationId) && source.operationId > 0
      ? source.operationId
      : null,
    phase,
    message: sanitizeRendererStatusText(source.message),
    reason: sanitizeRendererStatusText(source.reason)
  };
}

function sanitizeRendererStatusText(value) {
  return typeof value === "string" ? value.slice(0, maxRendererStatusTextLength) : "";
}

function updateSettingsFromTray(settingsPatch) {
  void saveSettingsWithSystemEffects(settingsPatch).catch(() => {});
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
  wireHudIpc({
    ipcMain,
    getHudWindow: () => hudWindow,
    getApprovedUrl: () => approvedHudRendererUrl,
    hudActions
  });
  const mainRendererIpc = createAuthorizedIpcMain({
    ipcMain,
    getWindow: () => mainWindow,
    getApprovedUrl: () => approvedMainRendererUrl
  });
  mainRendererIpc.on("recording:status", (_event, payload) => {
    const status = sanitizeRecordingStatusPayload(payload);
    systemInputController?.handleRendererStatus(status);
  });
  mainRendererIpc.on("recording:toggle-request", () => {
    void systemInputController?.toggle();
  });
  mainRendererIpc.handle("dictation:insert-text", async (_event, text) => {
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
  mainRendererIpc.handle("dictation:status-latest", () => lastDictationStatus || null);
  mainRendererIpc.handle("settings:get", () => settingsStore.getSettings());
  mainRendererIpc.handle("settings:save", async (_event, settings) => {
    return saveSettingsWithSystemEffects(settings);
  });
  mainRendererIpc.handle("history:list", () => settingsStore.getHistory());
  mainRendererIpc.handle(
    "data:recovery-status",
    () => settingsStore.getRecoveryState?.() || []
  );
  wireHistoryIpc({
    ipcMain: mainRendererIpc,
    historyActions
  });
  mainRendererIpc.handle("diagnostics:whisper", async () => {
    const settings = await settingsStore.getSettings();
    return toWhisperDiagnosticResult(await validateWhisperSetup(settings));
  });
  mainRendererIpc.handle("diagnostics:text", async () => {
    const settings = await settingsStore.getSettings({ includeSecrets: true });
    return toTextDiagnosticResult(await checkTextProvider(settings));
  });
  mainRendererIpc.handle("providers:status", async () => {
    const settings = await settingsStore.getSettings({ includeSecrets: true });
    return getProcessingProviderStatus(settings);
  });
  mainRendererIpc.handle("llm:status", async () => (
    toLocalModelUiStatus(await detectEmbeddedLlmAssets(runtimeRoot))
  ));
  wireModelSetupIpc({
    ipcMain: mainRendererIpc,
    modelSetupService,
    settingsStore
  });
  mainRendererIpc.handle("dictation:wav", async (_event, payload) => {
    const operationId = payload.operationId;
    if (systemInputController?.getState().operationId !== operationId) {
      return { ok: false, reason: "stale_operation" };
    }
    const buffer = getValidatedWavBuffer(payload.wavBytes);
    activeDictationOperationId = operationId;
    try {
      const entry = await dictationService.processWav(buffer);
      if (isPasteableDictationEntry(entry)) {
        lastDictationEntry = entry;
      }
      return entry;
    } finally {
      if (activeDictationOperationId === operationId) {
        activeDictationOperationId = null;
      }
    }
  });
}

const ownsSingleInstance = registerSingleInstance(app, {
  onSecondInstance: () => mainWindowReveal.request()
});

if (ownsSingleInstance) {
  app.whenReady().then(async () => {
  configureMediaPermissions(session.defaultSession, {
    getAllowedWebContents: () => mainWindow?.webContents || null,
    getAllowedUrl: () => approvedMainRendererUrl
  }).catch(() => handleStartupFailure({
    app,
    dialog,
    language: lastSettings?.interfaceLanguage
  }));
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
  historyActions = createHistoryActions({
    settingsStore,
    dictationService
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
    startRecording: async (command) => {
      sendRecordingStartCommand(command);
    },
    stopRecording: async (command) => {
      sendRecordingStopCommand(command);
    },
    isReadyToRecord: () => true,
    requestRendererReset: (command) => sendWindowMessage(mainWindow, "recording:reset", command)
  });
  hudActions = createHudActions({
    globalShortcut,
    systemInputController,
    revealMainWindow: () => mainWindowReveal.request()
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
    setCurrentSettings: (settings) => {
      lastSettings = settings;
    },
    applyStartupSettings: (settings) => applyStartupSettings(app, settings),
    registerHotkey,
    refreshTrayMenu,
    reportSystemError
  });

  wireIpc();
  const startHidden = shouldStartMinimized(process.argv);
  createWindow({ showOnReady: !startHidden });
  createHudWindow();
  createTray();
  if (startupSettingsError) {
    reportSystemError(startupSettingsError, "startup_settings_failed");
  }
  await registerHotkey(lastSettings);
  });

  app.on("will-quit", () => {
    disposeHudDisplayChanges?.();
    disposeHudDisplayChanges = null;
    hudActions?.dispose();
    hotkeyManager?.unregister();
    globalShortcut.unregisterAll?.();
    nativeShortcut?.unregisterAll?.();
    if (isUsableWindow(hudWindow)) {
      hudWindow.destroy();
    }
    tray?.destroy?.();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ showOnReady: false });
    }
    mainWindowReveal.request();
  });
}
