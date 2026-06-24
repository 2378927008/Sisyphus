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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

applyElectronRuntimeSwitches(app);

let mainWindow;
let tray;
let settingsStore;
let dictationService;

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

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Local Flow Dictation");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show", click: () => mainWindow.show() },
    { label: "Start/stop dictation", click: () => toggleRecording() },
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
  const ok = globalShortcut.register(settings.hotkey, () => toggleRecording());

  if (!ok) {
    sendStatus({ phase: "error", message: `Could not register hotkey: ${settings.hotkey}` });
  }
}

function toggleRecording() {
  if (mainWindow) {
    mainWindow.webContents.send("recording:toggle");
  }
}

function sendStatus(payload) {
  if (mainWindow) {
    mainWindow.webContents.send("dictation:status", payload);
  }
}

function wireIpc() {
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
  ipcMain.handle("providers:status", async () => {
    const settings = await settingsStore.getSettings({ includeSecrets: true });
    return getProcessingProviderStatus(settings);
  });
  ipcMain.handle("llm:status", () => detectEmbeddedLlmAssets(process.cwd()));
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
    ...whisperAssetDefaults
    ,
    embeddedLlmCliPath: embeddedLlmDefaults.cliPath,
    embeddedLlmModelPath: embeddedLlmDefaults.modelPath
  }, createSafeStorageSecretCodec(safeStorage));
  dictationService = new DictationService({
    settingsStore,
    clipboard,
    notifyStatus: sendStatus
  });

  wireIpc();
  createWindow();
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
