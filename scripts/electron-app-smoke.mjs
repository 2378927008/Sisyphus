import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyElectronRuntimeSwitches } from "../src/main/electron-runtime.js";
import { configureMediaPermissions } from "../src/main/media-permissions.js";
import { getProcessingProviderStatus } from "../src/main/provider-registry.js";
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
  pasteAfterTranscribe: false,
  whisperCliPath: "C:\\smoke\\whisper-cli.exe",
  whisperModelPath: "C:\\smoke\\ggml-base.bin"
});
let settingsAtDictation = null;
const settingsSaveCalls = [];

const missingSetupStatus = {
  assets: {
    whisper: {},
    llm: {
      ready: false,
      runtimeReady: false,
      modelReady: false,
      setupCommand: "powershell.exe -ExecutionPolicy Bypass -File .\\scripts\\setup-llm.ps1"
    }
  },
  setups: {
    whisper: { type: "whisper", status: "idle", output: [], error: "" },
    llm: { type: "llm", status: "idle", output: [], error: "" }
  }
};
const setupIpcCalls = {
  status: 0,
  refresh: 0,
  start: []
};
const setupStartResolvers = new Map();

function wireIpc() {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:save", (_event, next) => {
    settingsSaveCalls.push(next);
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
  ipcMain.handle("providers:status", () => getProcessingProviderStatus(settings));
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
  ipcMain.handle("models:setup-status", () => {
    setupIpcCalls.status += 1;
    if (setupIpcCalls.status === 1) {
      throw new Error("setup status unavailable");
    }
    return missingSetupStatus;
  });
  ipcMain.handle("models:setup-refresh", () => {
    setupIpcCalls.refresh += 1;
    return missingSetupStatus;
  });
  ipcMain.handle("models:setup-start", (_event, type) => {
    setupIpcCalls.start.push(type);
    return new Promise((resolve) => {
      setupStartResolvers.set(type, (result) => resolve(result || {
        type,
        status: "complete",
        output: [`${type} setup completed`],
        error: "",
        assets: missingSetupStatus.assets
      }));
    });
  });
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

  window.webContents.on("console-message", (_event, details) => {
    rendererMessages.push({
      level: details.level,
      message: details.message,
      line: details.lineNumber,
      sourceId: details.sourceId
    });
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
        state.hasLocalModelStatus &&
        state.hasSetupChecklist &&
        state.setupChecklistText.includes("Whisper") &&
        state.hasInstallWhisperButton &&
        state.hasInstallLlmButton &&
        state.hasRefreshSetupButton &&
        state.hasCopyResultButton &&
        state.providerStatusText.includes("Local whisper.cpp")
      ),
      5000
    );
    await window.webContents.executeJavaScript("document.querySelector('#refreshSetupStatus').click()");
    await waitForState(window, () => setupIpcCalls.refresh >= 1, 5000);
    await window.webContents.executeJavaScript(`
      (() => {
        window.__copyAttempts = [];
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: (text) => {
              window.__copyAttempts.push(text);
              return Promise.resolve();
            }
          }
        });
        document.querySelector('#copyResult').click();
      })()
    `);
    await waitForState(window, (state) => state.copyAttempts === 0, 5000);
    const failedSetupRefreshCalls = setupIpcCalls.refresh;
    const failedSetupSaveCalls = settingsSaveCalls.length;
    await window.webContents.executeJavaScript("document.querySelector('#installLlm').click()");
    await waitForState(window, () => setupIpcCalls.start.includes("llm"), 5000);
    setupStartResolvers.get("llm")?.({
      type: "llm",
      status: "failed",
      output: ["model downloaded"],
      error: "Qwen setup finished but required assets were not found.",
      assets: {
        whisper: {},
        llm: {
          ready: false,
          runtimeReady: false,
          modelReady: true,
          modelPath: "C:\\partial\\Qwen3-4B-Q4_K_M.gguf"
        }
      }
    });
    await waitForState(
      window,
      (state) => state.statusText.includes("Qwen setup finished but required assets were not found."),
      5000
    );
    if (setupIpcCalls.refresh !== failedSetupRefreshCalls) {
      throw new Error("Failed setup should not call persistent setup refresh.");
    }
    if (settingsSaveCalls.length !== failedSetupSaveCalls) {
      throw new Error("Failed setup should not save detected setup paths.");
    }
    if (settings.embeddedLlmModelPath) {
      throw new Error(`Failed setup persisted partial LLM model path: ${settings.embeddedLlmModelPath}`);
    }

    await window.webContents.executeJavaScript("document.querySelector('#installWhisper').click()");
    await waitForState(window, () => setupIpcCalls.start.includes("whisper"), 5000);
    await waitForState(
      window,
      (state) => state.installWhisperDisabled && state.installLlmDisabled && state.refreshSetupDisabled,
      5000
    );
    setupStartResolvers.get("whisper")?.();
    await waitForState(window, (state) => state.statusText === "Whisper 安装完成。", 5000);
    await window.webContents.executeJavaScript(`
      (() => {
        const interfaceLanguage = document.querySelector('#interfaceLanguage');
        interfaceLanguage.value = 'en';
        interfaceLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    const englishLanguageState = await waitForState(
      window,
      (state) => (
        state.interfaceLanguage === "en" &&
        state.recordLabel === "Start recording" &&
        state.providerStatusText === "Local mode · Local whisper.cpp"
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const interfaceLanguage = document.querySelector('#interfaceLanguage');
        interfaceLanguage.value = 'zh-Hans';
        interfaceLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.interfaceLanguage === "zh-Hans" &&
        state.recordLabel === "开始录音" &&
        state.providerStatusText.includes("Local whisper.cpp")
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
    await window.webContents.executeJavaScript(`
      (() => {
        window.__copyAttempts = [];
        window.__execCommands = [];
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: (text) => {
              window.__copyAttempts.push(text);
              return Promise.reject(new Error('clipboard denied'));
            }
          }
        });
        document.execCommand = (command) => {
          window.__execCommands.push(command);
          return true;
        };
        document.querySelector('#copyResult').click();
      })()
    `);
    await waitForState(
      window,
      (state) => state.statusText === "已复制。" && state.execCommands.includes("copy"),
      5000
    );

    if (settingsAtDictation?.outputLanguage !== "zh-Hans") {
      throw new Error(`Output language was not applied before dictation. Saw ${settingsAtDictation?.outputLanguage || "unset"}.`);
    }

    const blockedWarnings = rendererMessages.filter((item) => isBlockedRendererWarning(item.message));
    if (blockedWarnings.length) {
      throw new Error(`Renderer emitted blocked warnings: ${blockedWarnings.map((item) => item.message).join(" | ")}`);
    }

    console.log(JSON.stringify({
      ok: true,
      initialState,
      englishLanguageState,
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
      providerStatusText: document.querySelector('#providerStatusText')?.textContent || '',
      hasSettingsDrawer: Boolean(document.querySelector('#settingsDrawer')),
      hasLocalModelStatus: Boolean(document.querySelector('#localModelStatus')?.textContent?.trim()),
      hasSetupChecklist: Boolean(document.querySelector('#setupChecklist')),
      setupChecklistText: document.querySelector('#setupChecklist')?.textContent || '',
      hasInstallWhisperButton: Boolean(document.querySelector('#installWhisper')),
      hasInstallLlmButton: Boolean(document.querySelector('#installLlm')),
      hasRefreshSetupButton: Boolean(document.querySelector('#refreshSetupStatus')),
      hasCopyResultButton: Boolean(document.querySelector('#copyResult')),
      installWhisperDisabled: Boolean(document.querySelector('#installWhisper')?.disabled),
      installLlmDisabled: Boolean(document.querySelector('#installLlm')?.disabled),
      refreshSetupDisabled: Boolean(document.querySelector('#refreshSetupStatus')?.disabled),
      copyAttempts: window.__copyAttempts?.length || 0,
      execCommands: window.__execCommands || [],
      hasRecordButton: Boolean(document.querySelector('#recordButton')),
      hasLocalFlow: Boolean(window.localFlow)
    }))()
  `);
}

function isBlockedRendererWarning(message) {
  const text = String(message || "");
  return text.includes("Electron Security Warning") || text.includes("ScriptProcessorNode is deprecated");
}
