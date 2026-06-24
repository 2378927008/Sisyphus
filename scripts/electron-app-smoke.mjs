import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyElectronRuntimeSwitches } from "../src/main/electron-runtime.js";
import { configureMediaPermissions } from "../src/main/media-permissions.js";
import { defaultSettings, mergeSettings } from "../src/main/settings-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const htmlPath = path.join(projectRoot, "src", "renderer", "index.html");
const preloadPath = path.join(projectRoot, "src", "preload.cjs");

applyElectronRuntimeSwitches(app);

const timeout = setTimeout(() => {
  console.error("App smoke test timed out.");
  app.exit(2);
}, 30000);

let settings = mergeSettings({
  ...defaultSettings,
  hotkey: "CommandOrControl+Alt+Space",
  pasteAfterTranscribe: false
});
let settingsAtDictation = null;

function wireIpc() {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:save", (_event, next) => {
    settings = mergeSettings(next, settings);
    return settings;
  });
  ipcMain.handle("history:list", () => []);
  ipcMain.handle("diagnostics:whisper", () => ({
    ready: true,
    checks: [
      { label: "Smoke", status: "pass", message: "Whisper diagnostics stubbed." }
    ]
  }));
  ipcMain.handle("llm:status", () => ({
    ready: false,
    runtimeReady: false,
    modelReady: false,
    modelId: "Qwen/Qwen3-4B-GGUF",
    quantization: "Q4_K_M",
    modelFile: "Qwen3-4B-Q4_K_M.gguf",
    approximateSize: "2.5 GB",
    license: "Apache-2.0",
    setupCommand: "powershell.exe -ExecutionPolicy Bypass -File .\\scripts\\setup-llm.ps1",
    cliPath: "",
    modelPath: ""
  }));
  ipcMain.handle("dictation:wav", () => {
    settingsAtDictation = { ...settings };
    return {
      createdAt: new Date().toISOString(),
      text: "smoke transcript"
    };
  });
}

app.whenReady().then(async () => {
  configureMediaPermissions(session.defaultSession);
  wireIpc();

  const rendererMessages = [];
  const window = new BrowserWindow({
    show: false,
    width: 980,
    height: 720,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    rendererMessages.push({ level, message, line, sourceId });
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    rendererMessages.push({
      level: 3,
      message: `did-fail-load ${errorCode}: ${errorDescription}`,
      sourceId: validatedURL
    });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    rendererMessages.push({
      level: 3,
      message: `render-process-gone: ${details.reason}`,
      sourceId: ""
    });
  });

  try {
    await window.loadFile(htmlPath);

    const initialState = await waitForState(
      window,
      (state) => (
        state.ready &&
        state.recordLabel === "开始录音" &&
        state.interfaceLanguage === "zh-Hans" &&
        state.whisperLanguage === "auto" &&
        state.outputLanguage === "auto" &&
        state.hasSettingsDrawer &&
        state.hasLocalModelStatus
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const outputLanguage = document.querySelector('#outputLanguage');
        outputLanguage.value = 'zh-Hans';
        outputLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await window.webContents.executeJavaScript("document.querySelector('#recordButton').click()");
    const recordingState = await waitForState(
      window,
      (state) => state.isRecording && state.recordLabel === "停止并转写",
      10000
    );

    await window.webContents.executeJavaScript("document.querySelector('#recordButton').click()");
    const completedState = await waitForState(
      window,
      (state) => (
        !state.isRecording &&
        state.recordLabel === "开始录音" &&
        state.resultText === "smoke transcript"
      ),
      10000
    );

    if (settingsAtDictation?.outputLanguage !== "zh-Hans") {
      throw new Error(`Output language was not applied before dictation. Saw ${settingsAtDictation?.outputLanguage || "unset"}.`);
    }

    console.log(JSON.stringify({
      ok: true,
      initialState,
      recordingState,
      completedState,
      settingsAtDictation,
      rendererMessages: rendererMessages.filter((item) => item.level >= 2)
    }, null, 2));
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    const state = await readRendererState(window).catch((stateError) => ({
      error: stateError.message
    }));
    console.error(JSON.stringify({
      ok: false,
      name: error.name,
      message: error.message,
      state,
      rendererMessages
    }, null, 2));
    clearTimeout(timeout);
    app.exit(1);
  }
});

async function waitForState(window, predicate, timeoutMs) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readRendererState(window);
    if (predicate(lastState)) {
      return lastState;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for renderer state. Last state: ${JSON.stringify(lastState)}`);
}

function readRendererState(window) {
  return window.webContents.executeJavaScript(`
    (() => ({
      ready: Boolean(window.localFlow && document.querySelector('#recordButton')),
      isRecording: document.body.classList.contains('recording'),
      recordLabel: document.querySelector('#recordLabel')?.textContent || '',
      statusText: document.querySelector('#statusText')?.textContent || '',
      resultText: document.querySelector('#resultText')?.textContent || '',
      interfaceLanguage: document.querySelector('#interfaceLanguage')?.value || '',
      whisperLanguage: document.querySelector('#whisperLanguage')?.value || '',
      outputLanguage: document.querySelector('#outputLanguage')?.value || '',
      hasSettingsDrawer: Boolean(document.querySelector('#settingsDrawer')),
      hasLocalModelStatus: Boolean(document.querySelector('#localModelStatus')?.textContent?.trim()),
      hasRecordButton: Boolean(document.querySelector('#recordButton')),
      hasLocalFlow: Boolean(window.localFlow)
    }))()
  `);
}
