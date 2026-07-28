import { app, BrowserWindow, globalShortcut, ipcMain, session } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { applyElectronRuntimeSwitches } from "../src/main/electron-runtime.js";
import { createHudActions, wireHudIpc } from "../src/main/hud-actions.js";
import { configureMediaPermissions } from "../src/main/media-permissions.js";
import { getProcessingProviderStatus } from "../src/main/provider-registry.js";
import { defaultSettings, mergeSettings } from "../src/main/settings-store.js";
import { createSystemInputController } from "../src/main/system-input-controller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const htmlPath = path.join(projectRoot, "src", "renderer", "index.html");
const hudHtmlPath = path.join(projectRoot, "src", "renderer", "hud.html");
const preloadPath = path.join(projectRoot, "src", "preload.cjs");
const hudPreloadPath = path.join(projectRoot, "src", "hud-preload.cjs");
const unsafeDiagnostic = "3221225477 spawn C:\\private\\provider-helper.exe ENOENT stderr";
const execFileAsync = promisify(execFile);
const powershellPath = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);
const windowsEscapeInjectionScript = `
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

public static class SmokeKeyboardInput {
  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT {
    public uint type;
    public InputUnion input;
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct InputUnion {
    [FieldOffset(0)]
    public MOUSEINPUT mouse;
    [FieldOffset(0)]
    public KEYBDINPUT keyboard;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);

  public static void SendEscape() {
    SendKeyboardInput(0);
    Thread.Sleep(40);
    SendKeyboardInput(0x0002);
  }

  private static void SendKeyboardInput(uint flags) {
    INPUT[] inputs = {
      new INPUT {
        type = 1,
        input = new InputUnion {
          keyboard = new KEYBDINPUT {
            virtualKey = 0x1B,
            scanCode = 0x01,
            flags = flags,
            time = 0,
            extraInfo = UIntPtr.Zero
          }
        }
      }
    };
    uint sent = SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != 1) {
      throw new Win32Exception(Marshal.GetLastWin32Error(), "SendInput did not inject Escape.");
    }
  }
}
"@
[SmokeKeyboardInput]::SendEscape()
"SENT=2 SESSION=$([System.Diagnostics.Process]::GetCurrentProcess().SessionId)"
`;
let smokeStage = "startup";
let lastOsInputEvidence = "";

applyElectronRuntimeSwitches(app);

const timeout = setTimeout(() => {
  console.error(`App smoke test timed out during stage: ${smokeStage}`);
  app.exit(2);
}, 45000);

const expectedInterfaceLanguageCodes = ["en", "zh-Hans", "ja", "ko", "zh-Hant", "fr", "ru", "es"];
const smokeIpcChannelRegistry = [
  "settings:get",
  "settings:save",
  "history:list",
  "history:update",
  "history:reprocess",
  "dictation:insert-text",
  "diagnostics:whisper",
  "diagnostics:text",
  "providers:status",
  "llm:status",
  "models:setup-status",
  "models:setup-refresh",
  "models:setup-start",
  "models:setup-cancel",
  "dictation:status-latest",
  "dictation:wav"
];
const registeredSmokeIpcChannels = new Set();
const hudActionCalls = [];
let smokeHudWindow = null;
let smokeMainWindow = null;
let smokeSystemInputController = null;
let hudActions = null;
let driveRendererRecordingCommands = false;
const rendererResetCommands = [];

function registerSmokeIpcHandler(channel, handler) {
  if (!smokeIpcChannelRegistry.includes(channel)) {
    throw new Error(`Unregistered smoke IPC channel: ${channel}`);
  }
  if (registeredSmokeIpcChannels.has(channel)) {
    throw new Error(`Duplicate smoke IPC channel: ${channel}`);
  }
  ipcMain.handle(channel, handler);
  registeredSmokeIpcChannels.add(channel);
}

function assertSmokeIpcCoverage() {
  const missing = smokeIpcChannelRegistry.filter((channel) => !registeredSmokeIpcChannels.has(channel));
  const unexpected = [...registeredSmokeIpcChannels].filter((channel) => !smokeIpcChannelRegistry.includes(channel));
  if (missing.length || unexpected.length) {
    throw new Error(`Smoke IPC coverage mismatch. Missing: ${missing.join(", ")}; unexpected: ${unexpected.join(", ")}`);
  }
}

let settings = mergeSettings({
  ...defaultSettings,
  hotkey: "CommandOrControl+Alt+Space",
  pasteAfterTranscribe: false,
  whisperCliPath: "C:\\smoke\\whisper-cli.exe",
  whisperModelPath: "C:\\smoke\\ggml-base.bin"
});
let settingsAtDictation = null;
let dictationResult = {
  createdAt: new Date().toISOString(),
  status: "complete",
  text: "smoke transcript"
};
const settingsSaveCalls = [];
let settingsSaveError = "";
let deferNextFullSettingsSave = false;
let deferredFullSettingsSaveReached = false;
let releaseDeferredFullSettingsSave = null;
let deferProcessingLanguageSaves = false;
let activeSettingsSaveCalls = 0;
let maxConcurrentSettingsSaveCalls = 0;
const deferredSettingsSaveResolvers = [];
const historyFixtures = [
  {
    createdAt: "2026-07-11T04:00:00.000Z",
    transcript: "Legacy history source",
    status: "complete",
    text: "Legacy history entry"
  },
  {
    id: "history-zh",
    createdAt: "2026-07-11T03:00:00.000Z",
    status: "complete",
    text: "中文历史记录"
  },
  {
    id: "history-en",
    createdAt: "2026-07-11T02:00:00.000Z",
    status: "complete",
    text: "English history entry"
  },
  {
    id: "history-failed",
    createdAt: "2026-07-11T01:00:00.000Z",
    status: "failed",
    text: "",
    processingError: "spawn C:\\private\\history-helper.exe ENOENT"
  },
  {
    id: "history-emoji",
    createdAt: "2026-07-11T00:00:00.000Z",
    status: "complete",
    text: "Emoji history entry 🎤"
  }
];
const insertTextCalls = [];
let insertTextResult = { ok: true };
let historyListCalls = 0;
let whisperDiagnosticsResult = {
  ready: true,
  checks: [
    { label: "Smoke", status: "pass", message: "Whisper diagnostics stubbed." }
  ]
};
let whisperDiagnosticsError = "";
let textDiagnosticsError = "";
let providerStatusOverride = null;
let setupRefreshError = "";
let setupStartError = "";
let setupCancelError = "";
let dictationWavError = "";
const recordingStatusReports = [];

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
let setupRefreshResult = missingSetupStatus;
const setupIpcCalls = {
  status: 0,
  refresh: 0,
  start: [],
  cancel: []
};
const setupCompletionResults = [];
let successfulSetupCancels = 0;
const setupStartResolvers = new Map();

function wireIpc() {
  registerSmokeIpcHandler("settings:get", () => settings);
  registerSmokeIpcHandler("settings:save", async (_event, next) => {
    settingsSaveCalls.push(next);
    activeSettingsSaveCalls += 1;
    maxConcurrentSettingsSaveCalls = Math.max(maxConcurrentSettingsSaveCalls, activeSettingsSaveCalls);
    try {
      if (settingsSaveError) {
        throw new Error(settingsSaveError);
      }
      const settingKeys = Object.keys(next);
      const isPartialProcessingLanguageSave = (
        settingKeys.length === 1 &&
        (settingKeys[0] === "whisperLanguage" || settingKeys[0] === "outputLanguage")
      );
      if (deferNextFullSettingsSave && !isPartialProcessingLanguageSave) {
        deferNextFullSettingsSave = false;
        deferredFullSettingsSaveReached = true;
        await new Promise((resolve) => {
          releaseDeferredFullSettingsSave = resolve;
        });
        deferredFullSettingsSaveReached = false;
        releaseDeferredFullSettingsSave = null;
      }
      if (deferProcessingLanguageSaves && isPartialProcessingLanguageSave) {
        const deferredError = await new Promise((resolve) => deferredSettingsSaveResolvers.push(resolve));
        if (deferredError) {
          throw new Error(deferredError);
        }
      }
      settings = mergeSettings(next, settings);
      return settings;
    } finally {
      activeSettingsSaveCalls -= 1;
    }
  });
  registerSmokeIpcHandler("history:list", () => {
    historyListCalls += 1;
    return historyFixtures;
  });
  registerSmokeIpcHandler("history:update", (_event, payload = {}) => ({
    ok: true,
    entry: {
      id: payload.id,
      text: payload.text,
      status: "complete"
    }
  }));
  registerSmokeIpcHandler("history:reprocess", (_event, id) => ({
    ok: true,
    entry: {
      id,
      text: "reprocessed smoke transcript",
      status: "complete"
    }
  }));
  registerSmokeIpcHandler("dictation:insert-text", (_event, text) => {
    insertTextCalls.push(text);
    return insertTextResult;
  });
  registerSmokeIpcHandler("diagnostics:whisper", () => {
    if (whisperDiagnosticsError) throw new Error(whisperDiagnosticsError);
    return whisperDiagnosticsResult;
  });
  registerSmokeIpcHandler("diagnostics:text", () => {
    if (textDiagnosticsError) throw new Error(textDiagnosticsError);
    return {
      ready: true,
      checks: [
        { label: "MyMemory Free", status: "pass", message: "Text provider diagnostics stubbed." }
      ]
    };
  });
  registerSmokeIpcHandler("providers:status", () => providerStatusOverride || getProcessingProviderStatus(settings));
  registerSmokeIpcHandler("llm:status", () => ({
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
  registerSmokeIpcHandler("models:setup-status", () => {
    setupIpcCalls.status += 1;
    if (setupIpcCalls.status === 1) {
      throw new Error(unsafeDiagnostic);
    }
    return missingSetupStatus;
  });
  registerSmokeIpcHandler("models:setup-refresh", () => {
    setupIpcCalls.refresh += 1;
    if (setupRefreshError) throw new Error(setupRefreshError);
    return setupRefreshResult;
  });
  registerSmokeIpcHandler("models:setup-start", (_event, type) => {
    setupIpcCalls.start.push(type);
    if (setupStartError) throw new Error(setupStartError);
    return new Promise((resolve) => {
      setupStartResolvers.set(type, (result) => {
        const completion = result || {
          type,
          status: "complete",
          output: [`${type} setup completed`],
          error: "",
          assets: missingSetupStatus.assets
        };
        setupCompletionResults.push({ type, status: completion.status });
        resolve(completion);
      });
    });
  });
  registerSmokeIpcHandler("models:setup-cancel", (_event, type) => {
    setupIpcCalls.cancel.push(type);
    if (setupCancelError) throw new Error(setupCancelError);
    successfulSetupCancels += 1;
    return {
      type,
      status: "cancelled",
      output: [],
      error: "",
      assets: missingSetupStatus.assets
    };
  });
  registerSmokeIpcHandler("dictation:status-latest", () => null);
  registerSmokeIpcHandler("dictation:wav", () => {
    if (dictationWavError) throw new Error(dictationWavError);
    settingsAtDictation = { ...settings };
    smokeSystemInputController?.handleSystemStatus({
      phase: dictationResult.status === "failed" ? "warning" : "done"
    });
    return dictationResult;
  });
  ipcMain.on("recording:status", (_event, payload) => {
    if (_event.sender !== smokeMainWindow?.webContents) {
      return;
    }
    recordingStatusReports.push(payload);
    smokeSystemInputController?.handleRendererStatus(payload);
  });
  ipcMain.on("recording:toggle-request", (_event) => {
    if (_event.sender !== smokeMainWindow?.webContents) {
      return;
    }
    void smokeSystemInputController?.toggle();
  });
  wireHudIpc({
    ipcMain,
    getHudWindow: () => smokeHudWindow,
    hudActions
  });
}

app.whenReady().then(async () => {
  configureMediaPermissions(session.defaultSession);
  smokeSystemInputController = createSystemInputController({
    sendToMain: (state) => {
      hudActions?.syncPhase(state.phase);
      smokeHudWindow?.webContents.send("system-input:status", {
        ...state,
        language: "en"
      });
    },
    startRecording: async (command) => {
      if (driveRendererRecordingCommands) {
        smokeMainWindow?.webContents.send("recording:start", command);
      }
    },
    stopRecording: async (command) => {
      hudActionCalls.push("stop");
      if (driveRendererRecordingCommands) {
        smokeMainWindow?.webContents.send("recording:stop", command);
      }
    },
    requestRendererReset: (command) => {
      hudActionCalls.push("cancel");
      rendererResetCommands.push(command);
      if (driveRendererRecordingCommands) {
        smokeMainWindow?.webContents.send("recording:reset", command);
      }
    }
  });
  hudActions = createHudActions({
    globalShortcut,
    systemInputController: smokeSystemInputController,
    revealMainWindow: () => hudActionCalls.push("open")
  });
  wireIpc();
  assertSmokeIpcCoverage();

  const rendererMessages = [];
  const hudMessages = [];
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
  smokeMainWindow = window;
  const hudWindow = new BrowserWindow({
    show: false,
    width: 460,
    height: 72,
    webPreferences: {
      preload: hudPreloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const unauthorizedHudWindow = new BrowserWindow({
    show: false,
    width: 460,
    height: 72,
    webPreferences: {
      preload: hudPreloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  smokeHudWindow = hudWindow;

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
  hudWindow.webContents.on("console-message", (_event, details) => {
    hudMessages.push({
      level: details.level,
      message: details.message,
      line: details.lineNumber,
      sourceId: details.sourceId
    });
  });
  hudWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    hudMessages.push({
      level: 3,
      message: `did-fail-load ${errorCode}: ${errorDescription}`,
      sourceId: validatedURL
    });
  });
  hudWindow.webContents.on("render-process-gone", (_event, details) => {
    hudMessages.push({
      level: 3,
      message: `render-process-gone: ${details.reason}`,
      sourceId: ""
    });
  });

  try {
    await hudWindow.loadFile(hudHtmlPath);
    const hudState = await waitForHudState(
      hudWindow,
      (state) => (
        state.ready &&
        state.hasSystemInputStatusListener &&
        state.hasStopAction &&
        state.hasCancelAction &&
        state.hasOpenMainWindowAction &&
        state.hasHudRoot
      ),
      5000
    );
    const hudErrors = hudMessages.filter((item) => item.level >= 3);
    if (hudErrors.length) {
      throw new Error(`HUD emitted console errors: ${hudErrors.map((item) => item.message).join(" | ")}`);
    }

    await Promise.all([
      window.loadFile(htmlPath),
      unauthorizedHudWindow.loadFile(hudHtmlPath)
    ]);

    smokeStage = "unauthorized-hud-ipc";
    const unauthorizedActionCount = hudActionCalls.length;
    await unauthorizedHudWindow.webContents.executeJavaScript(`
      (() => {
        window.localFlow.stop();
        window.localFlow.cancel();
        window.localFlow.openMainWindow();
      })()
    `);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (hudActionCalls.length !== unauthorizedActionCount) {
      throw new Error("Unauthorized renderer was allowed to invoke a HUD action.");
    }

    smokeStage = "escape-conflict-register";
    const conflictEscapeCount = hudActionCalls.filter((action) => action === "conflict-escape").length;
    const conflictRegistered = globalShortcut.register(
      "Escape",
      () => hudActionCalls.push("conflict-escape")
    );
    if (!conflictRegistered) {
      throw new Error("Could not register the external Escape conflict owner.");
    }
    await smokeSystemInputController.start();
    smokeStage = "escape-conflict-os-injection";
    await sendOsEscapeKey();
    await waitForHudActionCount("conflict-escape", conflictEscapeCount + 1, 5000);
    if (smokeSystemInputController.getState().phase !== "starting") {
      throw new Error("Conflicting Escape owner should not invoke HUD cancel.");
    }
    await smokeSystemInputController.cancel();
    if (!globalShortcut.isRegistered("Escape")) {
      throw new Error("HUD cleanup removed an Escape binding it did not own.");
    }
    globalShortcut.unregister("Escape");

    smokeStage = "escape-owned-register";
    const resetsBeforeEscape = rendererResetCommands.length;
    await smokeSystemInputController.start();
    if (!globalShortcut.isRegistered("Escape")) {
      throw new Error("Escape should be registered while starting.");
    }
    smokeStage = "escape-owned-os-injection";
    await sendOsEscapeKey();
    smokeStage = "escape-owned-cancel-idle";
    await waitForControllerPhase("idle", 5000);
    if (rendererResetCommands.length !== resetsBeforeEscape + 1) {
      throw new Error("Owned Escape did not reset the active recording operation.");
    }
    if (globalShortcut.isRegistered("Escape")) {
      throw new Error("Escape should be released after it cancels recording.");
    }

    await smokeSystemInputController.start();
    const stopOperationId = smokeSystemInputController.getState().operationId;
    smokeSystemInputController.handleRendererStatus({
      operationId: stopOperationId,
      phase: "recording"
    });
    await waitForHudState(
      hudWindow,
      (state) => state.phase === "recording" && !state.cancelHidden && !state.stopHidden && !state.stopDisabled,
      5000
    );
    const stopsBeforeClick = hudActionCalls.filter((action) => action === "stop").length;
    await hudWindow.webContents.executeJavaScript("document.querySelector('#hudStop').click()");
    await waitForHudActionCount("stop", stopsBeforeClick + 1, 5000);

    smokeSystemInputController.handleSystemStatus({ phase: "polishing" });
    if (globalShortcut.isRegistered("Escape")) {
      throw new Error("Escape should be released while polishing.");
    }
    smokeSystemInputController.handleSystemStatus({ phase: "idle" });

    await smokeSystemInputController.start();
    if (!globalShortcut.isRegistered("Escape")) {
      throw new Error("Escape should be registered while starting.");
    }
    await waitForHudState(
      hudWindow,
      (state) => state.phase === "starting" && !state.cancelHidden && !state.stopHidden && state.stopDisabled,
      5000
    );
    const cancelsBeforeClick = hudActionCalls.filter((action) => action === "cancel").length;
    await hudWindow.webContents.executeJavaScript("document.querySelector('#hudCancel').click()");
    await waitForHudActionCount("cancel", cancelsBeforeClick + 1, 5000);
    await waitForControllerPhase("idle", 5000);

    smokeSystemInputController.handleSystemStatus({
      phase: "warning",
      reason: "paste_failed",
      message: unsafeDiagnostic
    });
    if (globalShortcut.isRegistered("Escape")) {
      throw new Error("Escape should be released for warning.");
    }
    const warningHudState = await waitForHudState(
      hudWindow,
      (state) => state.phase === "warning" && !state.openMainHidden,
      5000
    );
    assertNoDiagnosticLeak(warningHudState.visibleText, "HUD warning");
    await hudWindow.webContents.executeJavaScript("document.querySelector('#hudOpenMain').click()");
    await waitForHudAction("open", 5000);

    const initialState = await waitForState(
      window,
      (state) => (
        state.ready &&
        state.interfaceLanguage === "zh-Hans" &&
        state.interfaceLanguageOptions.join(",") === expectedInterfaceLanguageCodes.join(",") &&
        state.whisperLanguage === "auto" &&
        state.outputLanguage === "auto" &&
        !state.recordButtonDisabled &&
        state.hasLanguageControls &&
        state.hasVoiceCommandBar &&
        state.hasResultText &&
        state.hasRecentHistoryList &&
        state.hasFooterHealthText &&
        state.headerHealthText === state.footerHealthText &&
        state.headerHealthText.includes("Whisper") &&
        state.footerHealthReady &&
        state.recordReadinessReady &&
        state.hasRecordButton &&
        state.hasSettingsDrawer &&
        state.hasShortcutRecorder &&
        state.hasLocalModelStatus &&
        state.hasSetupChecklist &&
        state.setupChecklistText.includes("Whisper") &&
        state.llmSetupTitle === "MyMemory Free（云端）" &&
        state.llmSetupStatusText.includes("自动输出会保持说话语言") &&
        state.hasInstallWhisperButton &&
        state.hasInstallLlmButton &&
        state.installLlmHidden &&
        state.hasRefreshSetupButton &&
        state.hasCancelSetupButton &&
        state.cancelSetupHidden &&
        state.hasCopyResultButton &&
        state.hasInsertResultButton &&
        state.hasRestoreResultButton &&
        state.restoreResultDisabled &&
        state.resultText === "Legacy history entry" &&
        !state.resultEmpty &&
        state.editorCharacterCount === Array.from("Legacy history entry").length &&
        state.fullHistoryCount === historyFixtures.length &&
        state.failedHistoryEntriesSelectable &&
        state.dictationTabSelected &&
        !state.historyTabSelected &&
        state.dictationPanelHidden === false &&
        state.bodyPhase === "idle" &&
        state.voiceCommandPhase === "idle" &&
        state.settingsDrawerInert &&
        state.hasCheckTextProviderButton &&
        state.providerStatusText.includes("Local whisper.cpp") &&
        state.providerStatusText.includes("MyMemory Free")
      ),
      5000
    );
    if (
      initialState.launchAtLogin !== false ||
      initialState.startMinimizedToTray !== false ||
      initialState.globalShortcutPaused !== false
    ) {
      throw new Error("Windows productization controls should default to unchecked.");
    }
    const recordRect = initialState.recordButtonRect;
    if (
      recordRect.left < 0 ||
      recordRect.top < 0 ||
      recordRect.right > initialState.viewportWidth ||
      recordRect.bottom > initialState.viewportHeight ||
      recordRect.width <= 0 ||
      recordRect.height <= 0
    ) {
      throw new Error(`Record button is outside the 980x720 viewport: ${JSON.stringify(recordRect)}.`);
    }
    const visibleMainTextLeak = /C:\\|\.exe\b|\.gguf\b|https?:\/\/|\bspawn\b|PowerShell|setup output/i.exec(
      initialState.visibleMainText
    );
    if (visibleMainTextLeak) {
      throw new Error(`Main page leaked implementation text: ${visibleMainTextLeak[0]}`);
    }
    assertNoDiagnosticLeak(initialState.headerHealthText, "Initial header health");
    assertNoDiagnosticLeak(initialState.footerHealthText, "Initial footer health");
    assertNoDiagnosticLeak(initialState.setupChecklistText, "Initial setup checklist");
    whisperDiagnosticsResult = {
      ready: false,
      checks: [
        { label: "Whisper", status: "fail", message: "Whisper runtime and model are missing." }
      ]
    };
    providerStatusOverride = {
      mode: "local",
      readyToRecord: false,
      recordingBlockedReason: "whisper_not_configured",
      asr: {
        provider: "localWhisper",
        label: "Local whisper.cpp",
        configured: false,
        implemented: true,
        ready: false,
        blockedReason: "whisper_not_configured"
      },
      text: {
        provider: "mymemory",
        label: "MyMemory Free",
        configured: true,
        implemented: true,
        ready: true,
        blockedReason: ""
      }
    };
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#checkWhisper').click();
        document.querySelector('#refreshSetupStatus').click();
      })()
    `);
    const missingWhisperRecoveryState = await waitForState(
      window,
      (state) => (
        state.recordButtonDisabled &&
        state.visibleRecordRecoveryCount === 1 &&
        state.recordRecoveryActionText.includes("Whisper") &&
        state.whisperDiagnosticsText.includes("Whisper runtime and model are missing.") &&
        state.headerHealthText === state.footerHealthText &&
        state.headerHealthText.includes("Whisper") &&
        !state.footerHealthReady &&
        !state.recordReadinessReady &&
        state.mainSetupControlCount === 0
      ),
      5000
    );
    assertNoDiagnosticLeak(missingWhisperRecoveryState.headerHealthText, "Missing Whisper header health");
    assertNoDiagnosticLeak(missingWhisperRecoveryState.footerHealthText, "Missing Whisper footer health");
    const recoveryWhisperStarts = setupIpcCalls.start.filter((type) => type === "whisper").length;
    await window.webContents.executeJavaScript("document.querySelector('#recordRecoveryAction').click()");
    await waitForState(
      window,
      () => setupIpcCalls.start.filter((type) => type === "whisper").length === recoveryWhisperStarts + 1,
      5000
    );
    setupStartResolvers.get("whisper")?.({
      type: "whisper",
      status: "failed",
      output: [],
      error: "Whisper assets are unavailable.",
      assets: missingSetupStatus.assets
    });
    await waitForState(window, (state) => state.cancelSetupHidden, 5000);
    whisperDiagnosticsResult = {
      ready: true,
      checks: [
        { label: "Smoke", status: "pass", message: "Whisper diagnostics stubbed." }
      ]
    };
    providerStatusOverride = null;
    await window.webContents.executeJavaScript("document.querySelector('#refreshSetupStatus').click()");
    await waitForState(
      window,
      (state) => !state.recordButtonDisabled && state.visibleRecordRecoveryCount === 0,
      5000
    );
    const historyCallsBeforeResize = historyListCalls;
    await window.webContents.executeJavaScript(`
      window.dispatchEvent(new Event('resize'));
    `);
    await waitForState(window, (state) => state.fullHistoryCount === historyFixtures.length, 5000);
    if (historyListCalls !== historyCallsBeforeResize) {
      throw new Error("Responsive history should redraw from cached history.");
    }
    window.webContents.send("dictation:status", {
      phase: "error",
      message: "spawn C:\\private\\phase-helper.exe ENOENT"
    });
    const safePhaseState = await waitForState(
      window,
      (state) => state.bodyPhase === "error" && state.voiceCommandPhase === "error",
      5000
    );
    if (
      safePhaseState.statusText.includes("spawn") ||
      safePhaseState.statusText.includes("private") ||
      safePhaseState.statusText.includes("ENOENT")
    ) {
      throw new Error(`Phase status leaked diagnostics: ${safePhaseState.statusText}`);
    }
    await window.webContents.executeJavaScript(`
      (() => {
        const trigger = document.querySelector('#navSettings');
        trigger.focus();
        trigger.click();
      })()
    `);
    const drawerGeneralState = await waitForState(
      window,
      (state) => (
        state.settingsDrawerOpen === true &&
        !state.settingsDrawerAriaHidden &&
        !state.settingsDrawerInert &&
        state.settingsSectionCount === 4 &&
        state.activeSettingsSection === "general" &&
        !state.settingsGeneralHidden &&
        state.settingsShortcutsHidden &&
        state.settingsModelsHidden &&
        state.settingsAdvancedHidden &&
        state.activeElementId === "closeSettings"
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-settings-section="general"]').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true
      }))
    `);
    const drawerShortcutsState = await waitForState(
      window,
      (state) => (
        state.activeSettingsSection === "shortcuts" &&
        !state.settingsShortcutsHidden &&
        state.activeElementId === "settingsSectionShortcuts"
      ),
      5000
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-settings-section=\"models\"]').click()"
    );
    const drawerModelsState = await waitForState(
      window,
      (state) => state.activeSettingsSection === "models" && !state.settingsModelsHidden,
      5000
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-settings-section=\"advanced\"]').click()"
    );
    const drawerAdvancedState = await waitForState(
      window,
      (state) => state.activeSettingsSection === "advanced" && !state.settingsAdvancedHidden,
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('[data-settings-section="general"]').click();
        const last = document.querySelector('#saveSettings');
        last.focus();
        const event = new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true
        });
        window.__drawerTabPrevented = !last.dispatchEvent(event);
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.activeSettingsSection === "general" &&
        state.drawerTabPrevented &&
        state.activeElementId === "closeSettings"
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('#closeSettings').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
      }))
    `);
    await waitForState(
      window,
      (state) => (
        !state.settingsDrawerOpen &&
        state.settingsDrawerAriaHidden &&
        state.settingsDrawerInert &&
        state.activeElementId === "navSettings"
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#navSettings').click();
        document.querySelector('.drawer-backdrop').click();
      })()
    `);
    await waitForState(
      window,
      (state) => !state.settingsDrawerOpen && state.activeElementId === "navSettings",
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#navSettings').click();
        document.querySelector('#closeSettings').click();
      })()
    `);
    await waitForState(
      window,
      (state) => !state.settingsDrawerOpen && state.activeElementId === "navSettings",
      5000
    );
    for (const invalidReturnFocus of ["detached", "disabled", "hidden"]) {
      const triggerId = `smokeReturnFocus-${invalidReturnFocus}`;
      const focusedTriggerId = await window.webContents.executeJavaScript(`
        (() => {
          const trigger = document.createElement('button');
          trigger.id = '${triggerId}';
          trigger.type = 'button';
          document.body.append(trigger);
          trigger.focus();
          return document.activeElement?.id || '';
        })()
      `);
      if (focusedTriggerId !== triggerId) {
        throw new Error(`Could not focus ${invalidReturnFocus} settings trigger.`);
      }

      window.webContents.send("settings:open");
      await waitForState(
        window,
        (state) => state.settingsDrawerOpen && state.activeElementId === "closeSettings",
        5000
      );
      await window.webContents.executeJavaScript(`
        (() => {
          const trigger = document.querySelector('#${triggerId}');
          if ('${invalidReturnFocus}' === 'detached') trigger.remove();
          if ('${invalidReturnFocus}' === 'disabled') trigger.disabled = true;
          if ('${invalidReturnFocus}' === 'hidden') trigger.hidden = true;
          document.querySelector('#closeSettings').click();
          trigger.remove();
        })()
      `);
      await waitForState(
        window,
        (state) => (
          !state.settingsDrawerOpen &&
          state.settingsDrawerAriaHidden &&
          state.settingsDrawerInert &&
          state.activeElementId === "navSettings"
        ),
        5000
      );
    }
    const focusContainmentWarnings = rendererMessages.filter((item) => (
      item.level >= 2 && isFocusContainmentWarning(item.message)
    ));
    if (focusContainmentWarnings.length !== 0) {
      throw new Error(
        `Settings lifecycle emitted focus containment warnings: ${focusContainmentWarnings.map((item) => item.message).join(" | ")}`
      );
    }
    window.webContents.send("settings:open");
    await waitForState(
      window,
      (state) => state.settingsDrawerOpen && state.activeSettingsSection === "general",
      5000
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-settings-section=\"shortcuts\"]').click()"
    );
    await waitForState(
      window,
      (state) => state.activeSettingsSection === "shortcuts" && !state.settingsShortcutsHidden,
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#recordHotkey').click();
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'k',
          code: 'KeyK',
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true
        }));
      })()
    `);
    const keyboardShortcutRecorderState = await waitForState(
      window,
      (state) => (
        state.hotkeyValue === "CommandOrControl+Alt+K" &&
        state.recordHotkeyPressed === false
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#recordPasteLastHotkey').click();
        window.dispatchEvent(new MouseEvent('mousedown', {
          button: 3,
          bubbles: true,
          cancelable: true
        }));
      })()
    `);
    const mouseShortcutRecorderState = await waitForState(
      window,
      (state) => (
        state.pasteLastHotkeyValue === "Mouse4" &&
        state.recordPasteLastHotkeyPressed === false &&
        state.recordHotkeyDisabled === false
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#hotkey').value = 'CommandOrControl+Alt+Space';
        document.querySelector('#pasteLastHotkey').value = 'CommandOrControl+Alt+V';
      })()
    `);
    await window.webContents.executeJavaScript("document.querySelector('#closeSettings').click()");
    await waitForState(window, (state) => state.settingsDrawerOpen === false, 5000);
    await window.webContents.executeJavaScript(`
      (() => {
        for (const id of ['launchAtLogin', 'startMinimizedToTray', 'globalShortcutPaused']) {
          const input = document.querySelector(\`#\${id}\`);
          if (!input) throw new Error(\`\${id} missing\`);
          input.checked = true;
        }
        document.querySelector('#settingsForm').requestSubmit();
      })()
    `);
    await waitForState(
      window,
      () => settingsSaveCalls.some((call) => (
        call.launchAtLogin === true &&
        call.startMinimizedToTray === true &&
        call.globalShortcutPaused === true
      )),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        for (const id of ['launchAtLogin', 'startMinimizedToTray', 'globalShortcutPaused']) {
          document.querySelector(\`#\${id}\`).checked = false;
        }
        document.querySelector('#settingsForm').requestSubmit();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.launchAtLogin === false &&
        state.startMinimizedToTray === false &&
        state.globalShortcutPaused === false &&
        settingsSaveCalls.some((call) => (
          call.launchAtLogin === false &&
          call.startMinimizedToTray === false &&
          call.globalShortcutPaused === false
        ))
      ),
      5000
    );
    await window.webContents.executeJavaScript("document.querySelector('#checkTextProvider').click()");
    await waitForState(
      window,
      (state) => (
        state.statusText === "文本输出服务已就绪。" &&
        state.textDiagnosticsText.includes("MyMemory Free") &&
        state.textDiagnosticsText.includes("Text provider diagnostics stubbed.")
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
    await waitForState(
      window,
      (state) => state.copyAttemptTexts.includes("Legacy history entry"),
      5000
    );

    await window.webContents.executeJavaScript(`
      document.querySelector('#navHistory').click()
    `);
    await waitForState(window, (state) => state.historyTabSelected, 5000);
    const insertCallsBeforeFailedHistory = insertTextCalls.length;
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-history-action="select"][data-history-id="history-failed"]').click()
    `);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (insertTextCalls.length !== insertCallsBeforeFailedHistory) {
      throw new Error("Failed history entry should not invoke insert text IPC.");
    }
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-history-action="select"][data-history-id="history-en"]').click()
    `);
    await waitForState(window, (state) => state.resultText === "English history entry", 5000);
    await window.webContents.executeJavaScript("document.querySelector('#copyResult').click()");
    await waitForState(
      window,
      (state) => state.copyAttemptTexts.includes("English history entry"),
      5000
    );
    await window.webContents.executeJavaScript("document.querySelector('#insertResult').click()");
    await waitForState(
      window,
      () => insertTextCalls.at(-1) === "English history entry",
      5000
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-history-action="select"][data-history-id="history-zh"]').click()
    `);
    await waitForState(
      window,
      (state) => (
        state.resultText === "中文历史记录" &&
        state.editorCharacterCount === Array.from("中文历史记录").length &&
        state.restoreResultDisabled
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const editor = document.querySelector('#resultText');
        editor.textContent = '中文历史已编辑';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.resultText === "中文历史已编辑" &&
        state.editorCharacterCount === Array.from("中文历史已编辑").length &&
        !state.restoreResultDisabled
      ),
      5000
    );
    await window.webContents.executeJavaScript("document.querySelector('#restoreResult').click()");
    await waitForState(
      window,
      (state) => state.resultText === "中文历史记录" && state.restoreResultDisabled,
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const editor = document.querySelector('#resultText');
        editor.textContent = '编辑后复制和插入';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
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
    await waitForState(
      window,
      (state) => state.copyAttemptTexts.includes("编辑后复制和插入"),
      5000
    );
    await window.webContents.executeJavaScript("document.querySelector('#insertResult').click()");
    await waitForState(
      window,
      (state) => (
        insertTextCalls.at(-1) === "编辑后复制和插入" &&
        state.resultText === "编辑后复制和插入" &&
        state.statusText === "已插入到光标处"
      ),
      5000
    );
    const insertCallsBeforeFailure = insertTextCalls.length;
    insertTextResult = {
      ok: false,
      message: "spawn C:\\private\\insert-helper.exe ENOENT"
    };
    await window.webContents.executeJavaScript("document.querySelector('#insertResult').click()");
    const failedInsertState = await waitForState(
      window,
      (state) => (
        insertTextCalls.length > insertCallsBeforeFailure &&
        state.resultText === "编辑后复制和插入" &&
        state.statusText === "插入失败，文本已保留在剪贴板"
      ),
      5000
    );
    if (
      failedInsertState.statusText.includes("spawn") ||
      failedInsertState.statusText.includes("private") ||
      failedInsertState.statusText.includes("ENOENT")
    ) {
      throw new Error(`Insert failure leaked diagnostics: ${failedInsertState.statusText}`);
    }
    insertTextResult = { ok: true };
    const failedSetupRefreshCalls = setupIpcCalls.refresh;
    const failedSetupSaveCalls = settingsSaveCalls.length;
    await window.webContents.executeJavaScript("document.querySelector('#installLlm').click()");
    await waitForState(window, () => setupIpcCalls.start.includes("llm"), 5000);
    setupStartResolvers.get("llm")?.({
      type: "llm",
      status: "failed",
      output: [
        "Downloading Qwen runtime...",
        "Primary Hugging Face download failed. Trying mirror...",
        "Model: C:\\partial\\Qwen3-4B-Q4_K_M.gguf"
      ],
      error: unsafeDiagnostic,
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
    const failedSetupResultState = await waitForState(
      window,
      (state) => (
        state.statusText === "Qwen 安装失败，请检查设置后重试。" &&
        state.setupOutputText.includes("Downloading Qwen runtime...") &&
        state.setupOutputText.includes("Primary Hugging Face download failed. Trying mirror...") &&
        !state.setupOutputText.includes("C:\\partial")
      ),
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

    setupRefreshResult = {
      ...missingSetupStatus,
      assets: {
        ...missingSetupStatus.assets,
        whisper: {
          whisperCliPath: "C:\\smoke\\setup-whisper-cli.exe",
          whisperModelPath: "C:\\smoke\\setup-whisper-model.bin"
        }
      }
    };
    deferNextFullSettingsSave = true;
    deferProcessingLanguageSaves = true;
    const detectedPathSaveIndex = settingsSaveCalls.length;
    await window.webContents.executeJavaScript("document.querySelector('#installWhisper').click()");
    await waitForState(window, () => setupIpcCalls.start.includes("whisper"), 5000);
    await waitForState(
      window,
      (state) => (
        state.installWhisperDisabled &&
        state.installLlmDisabled &&
        state.refreshSetupDisabled &&
        !state.cancelSetupHidden
      ),
      5000
    );
    setupStartResolvers.get("whisper")?.();
    await waitForState(
      window,
      () => (
        deferredFullSettingsSaveReached &&
        settingsSaveCalls.length === detectedPathSaveIndex + 1 &&
        activeSettingsSaveCalls === 1
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const outputLanguage = document.querySelector('#outputLanguage');
        outputLanguage.value = 'fr';
        outputLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    releaseDeferredFullSettingsSave?.();
    await waitForState(
      window,
      () => (
        settingsSaveCalls.length === detectedPathSaveIndex + 2 &&
        activeSettingsSaveCalls === 1 &&
        deferredSettingsSaveResolvers.length === 1
      ),
      5000
    );
    const detectedPathSaveReturnState = await readRendererState(window);
    if (detectedPathSaveReturnState.outputLanguage !== "fr") {
      throw new Error(
        `Detected path save overwrote a newer language with ${detectedPathSaveReturnState.outputLanguage}.`
      );
    }
    deferredSettingsSaveResolvers.shift()?.();
    deferProcessingLanguageSaves = false;
    await waitForState(
      window,
      (state) => (
        state.statusText === "Whisper 安装完成。" &&
        activeSettingsSaveCalls === 0 &&
        settings.outputLanguage === "fr"
      ),
      5000
    );
    setupRefreshResult = missingSetupStatus;
    const resetOutputLanguageSaveIndex = settingsSaveCalls.length;
    await window.webContents.executeJavaScript(`
      (() => {
        const outputLanguage = document.querySelector('#outputLanguage');
        outputLanguage.value = 'auto';
        outputLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      () => (
        settingsSaveCalls.length === resetOutputLanguageSaveIndex + 1 &&
        activeSettingsSaveCalls === 0 &&
        settings.outputLanguage === "auto"
      ),
      5000
    );
    const qwenReadyStatus = {
      ...missingSetupStatus,
      assets: {
        ...missingSetupStatus.assets,
        llm: {
          ready: true,
          runtimeReady: true,
          modelReady: true,
          cliPath: "C:\\smoke\\llama-cli.exe",
          modelPath: "C:\\smoke\\Qwen3-4B-Q4_K_M.gguf"
        }
      }
    };
    setupRefreshResult = qwenReadyStatus;
    const qwenSuccessStartIndex = setupIpcCalls.start.length;
    await window.webContents.executeJavaScript("document.querySelector('#installLlm').click()");
    await waitForState(
      window,
      () => setupIpcCalls.start.length === qwenSuccessStartIndex + 1,
      5000
    );
    setupStartResolvers.get("llm")?.({
      type: "llm",
      status: "complete",
      output: ["Qwen setup completed"],
      error: "",
      assets: qwenReadyStatus.assets
    });
    await waitForState(
      window,
      () => (
        setupCompletionResults.some((result) => result.type === "llm" && result.status === "complete") &&
        settings.embeddedLlmCliPath === qwenReadyStatus.assets.llm.cliPath &&
        settings.embeddedLlmModelPath === qwenReadyStatus.assets.llm.modelPath
      ),
      5000
    );
    setupRefreshResult = missingSetupStatus;
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
        state.mainTabsAriaLabel === "Main views" &&
        state.voiceCommandAriaLabel === "Dictation controls" &&
        state.resultActionsAriaLabel === "Result actions" &&
        state.settingsSectionsAriaLabel === "Settings sections" &&
        state.shortcutHintText === "Shortcut: Ctrl + Alt + Space" &&
        state.headerHealthText === "Local Whisper ready" &&
        state.footerHealthText === "Local Whisper ready" &&
        state.footerHealthReady &&
        state.recordReadinessReady &&
        state.visibleCharacterCount === "6 characters" &&
        state.llmSetupTitle === "MyMemory Free (cloud)" &&
        state.installLlmHidden &&
        state.providerStatusText === "Local mode · Local whisper.cpp + MyMemory Free"
      ),
      5000
    );
    assertNoDiagnosticLeak(failedSetupResultState.statusText, "Failed setup status");
    assertNoDiagnosticLeak(englishLanguageState.headerHealthText, "English header health");
    assertNoDiagnosticLeak(englishLanguageState.footerHealthText, "English footer health");
    setupRefreshError = unsafeDiagnostic;
    await window.webContents.executeJavaScript("document.querySelector('#refreshSetupStatus').click()");
    const failedSetupRefreshState = await waitForState(
      window,
      (state) => state.statusText === "Setup status could not be refreshed.",
      5000
    );
    assertNoDiagnosticLeak(failedSetupRefreshState.statusText, "Setup refresh failure status");
    setupRefreshError = "";

    setupStartError = unsafeDiagnostic;
    await window.webContents.executeJavaScript("document.querySelector('#installLlm').click()");
    const failedSetupStartState = await waitForState(
      window,
      (state) => state.statusText === "Model setup could not be started." && !state.installLlmDisabled,
      5000
    );
    assertNoDiagnosticLeak(failedSetupStartState.statusText, "Setup start failure status");
    setupStartError = "";

    const setupStartsBeforeCancelSuccess = setupIpcCalls.start.length;
    const successfulCancelsBefore = successfulSetupCancels;
    await window.webContents.executeJavaScript("document.querySelector('#installLlm').click()");
    await waitForState(
      window,
      (state) => (
        setupIpcCalls.start.length === setupStartsBeforeCancelSuccess + 1 &&
        !state.cancelSetupHidden
      ),
      5000
    );
    await window.webContents.executeJavaScript("document.querySelector('#cancelSetup').click()");
    await waitForState(
      window,
      () => successfulSetupCancels === successfulCancelsBefore + 1,
      5000
    );
    setupStartResolvers.get("llm")?.({
      type: "llm",
      status: "cancelled",
      output: [],
      error: "",
      assets: missingSetupStatus.assets
    });
    await waitForState(window, (state) => state.cancelSetupHidden, 5000);

    const setupStartsBeforeCancelFailure = setupIpcCalls.start.length;
    await window.webContents.executeJavaScript("document.querySelector('#installLlm').click()");
    await waitForState(
      window,
      (state) => setupIpcCalls.start.length === setupStartsBeforeCancelFailure + 1 && !state.cancelSetupHidden,
      5000
    );
    setupCancelError = unsafeDiagnostic;
    await window.webContents.executeJavaScript("document.querySelector('#cancelSetup').click()");
    const failedSetupCancelState = await waitForState(
      window,
      (state) => state.statusText === "Model setup could not be cancelled.",
      5000
    );
    assertNoDiagnosticLeak(failedSetupCancelState.statusText, "Setup cancel failure status");
    setupCancelError = "";
    setupStartResolvers.get("llm")?.({
      type: "llm",
      status: "failed",
      output: [],
      error: unsafeDiagnostic,
      assets: missingSetupStatus.assets
    });
    await waitForState(window, (state) => state.cancelSetupHidden, 5000);

    whisperDiagnosticsError = unsafeDiagnostic;
    await window.webContents.executeJavaScript("document.querySelector('#checkWhisper').click()");
    const failedWhisperDiagnosticState = await waitForState(
      window,
      (state) => state.statusText === "Whisper check failed.",
      5000
    );
    assertNoDiagnosticLeak(failedWhisperDiagnosticState.statusText, "Whisper failure status");
    whisperDiagnosticsError = "";
    textDiagnosticsError = unsafeDiagnostic;
    await window.webContents.executeJavaScript("document.querySelector('#checkTextProvider').click()");
    const failedTextDiagnosticState = await waitForState(
      window,
      (state) => state.statusText === "Text output check failed.",
      5000
    );
    assertNoDiagnosticLeak(failedTextDiagnosticState.statusText, "Text provider failure status");
    textDiagnosticsError = "";
    settingsSaveError = unsafeDiagnostic;
    await window.webContents.executeJavaScript(`
      (() => {
        const provider = document.querySelector('#llmProvider');
        provider.value = 'embedded';
        provider.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    const failedProviderPreviewState = await waitForState(
      window,
      (state) => state.statusText === "Settings could not be saved.",
      5000
    );
    assertNoDiagnosticLeak(failedProviderPreviewState.statusText, "Provider preview failure status");
    settingsSaveError = "";
    const providerRecoverySaveIndex = settingsSaveCalls.length;
    await window.webContents.executeJavaScript(`
      (() => {
        const provider = document.querySelector('#llmProvider');
        provider.value = 'mymemory';
        provider.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      () => settingsSaveCalls.length > providerRecoverySaveIndex && activeSettingsSaveCalls === 0,
      5000
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('#interfaceLanguage').dispatchEvent(new Event('change', { bubbles: true }))
    `);
    const languageQueueStart = settingsSaveCalls.length;
    maxConcurrentSettingsSaveCalls = 0;
    deferProcessingLanguageSaves = true;
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#hotkey').value = 'CommandOrControl+Shift+U';
        const outputLanguage = document.querySelector('#outputLanguage');
        outputLanguage.value = 'zh-Hans';
        outputLanguage.dispatchEvent(new Event('change', { bubbles: true }));
        outputLanguage.value = 'es';
        outputLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        settingsSaveCalls.length === languageQueueStart + 1 &&
        activeSettingsSaveCalls === 1 &&
        deferredSettingsSaveResolvers.length === 1 &&
        state.outputLanguage === "es" &&
        state.interfaceLanguage === "en" &&
        state.hotkeyValue === "CommandOrControl+Shift+U"
      ),
      5000
    );
    if (settingsSaveCalls.length !== languageQueueStart + 1 || activeSettingsSaveCalls !== 1) {
      throw new Error("Processing language saves were not serialized.");
    }
    assertPartialSettingsSave(settingsSaveCalls[languageQueueStart], {
      outputLanguage: "zh-Hans"
    });
    deferredSettingsSaveResolvers.shift()?.("spawn C:\\private\\stale-language-save.exe ENOENT");
    await waitForState(
      window,
      (state) => (
        settingsSaveCalls.length === languageQueueStart + 2 &&
        activeSettingsSaveCalls === 1 &&
        state.outputLanguage === "es" &&
        state.interfaceLanguage === "en" &&
        state.hotkeyValue === "CommandOrControl+Shift+U"
      ),
      5000
    );
    assertPartialSettingsSave(settingsSaveCalls[languageQueueStart + 1], {
      outputLanguage: "es"
    });
    if (maxConcurrentSettingsSaveCalls !== 1) {
      throw new Error(`Expected one active settings save, saw ${maxConcurrentSettingsSaveCalls}.`);
    }
    deferredSettingsSaveResolvers.shift()?.();
    const myMemoryTargetPreviewState = await waitForState(
      window,
      (state) => (
        activeSettingsSaveCalls === 0 &&
        settings.outputLanguage === "es" &&
        state.outputLanguage === "es" &&
        state.interfaceLanguage === "en" &&
        state.hotkeyValue === "CommandOrControl+Shift+U" &&
        state.statusText === "Ready. Shortcut: Ctrl + Alt + Space" &&
        state.providerStatusText === "Cloud mode · Local whisper.cpp + MyMemory Free"
      ),
      5000
    );
    deferProcessingLanguageSaves = false;
    settingsSaveError = "spawn C:\\private\\settings-helper.exe ENOENT";
    await window.webContents.executeJavaScript(`
      (() => {
        const outputLanguage = document.querySelector('#outputLanguage');
        outputLanguage.value = 'zh-Hans';
        outputLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    const failedLanguageSaveState = await waitForState(
      window,
      (state) => (
        activeSettingsSaveCalls === 0 &&
        settings.outputLanguage === "es" &&
        state.outputLanguage === "es" &&
        state.statusText === "Settings could not be saved."
      ),
      5000
    );
    if (
      failedLanguageSaveState.statusText.includes("spawn") ||
      failedLanguageSaveState.statusText.includes("private") ||
      failedLanguageSaveState.statusText.includes("ENOENT")
    ) {
      throw new Error(`Settings failure leaked diagnostics: ${failedLanguageSaveState.statusText}`);
    }
    settingsSaveError = "";
    await window.webContents.executeJavaScript(`
      document.querySelector('#hotkey').value = 'CommandOrControl+Alt+Space'
    `);
    const whisperEnglishSaveIndex = settingsSaveCalls.length;
    await window.webContents.executeJavaScript(`
      (() => {
        const whisperLanguage = document.querySelector('#whisperLanguage');
        whisperLanguage.value = 'en';
        whisperLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        activeSettingsSaveCalls === 0 &&
        settings.whisperLanguage === "en" &&
        state.whisperLanguage === "en" &&
        state.statusText === "Settings could not be saved."
      ),
      5000
    );
    assertPartialSettingsSave(settingsSaveCalls[whisperEnglishSaveIndex], {
      whisperLanguage: "en"
    });
    const differentFieldSuccessState = await readRendererState(window);
    if (differentFieldSuccessState.statusText !== "Settings could not be saved.") {
      throw new Error(`Different language field cleared owned failure: ${differentFieldSuccessState.statusText}`);
    }
    const whisperAutoSaveIndex = settingsSaveCalls.length;
    await window.webContents.executeJavaScript(`
      (() => {
        const whisperLanguage = document.querySelector('#whisperLanguage');
        whisperLanguage.value = 'auto';
        whisperLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.whisperLanguage === "auto" &&
        settingsSaveCalls.length > whisperAutoSaveIndex
      ),
      5000
    );
    assertPartialSettingsSave(settingsSaveCalls[whisperAutoSaveIndex], {
      whisperLanguage: "auto"
    });
    await window.webContents.executeJavaScript(`
      (() => {
        const outputLanguage = document.querySelector('#outputLanguage');
        outputLanguage.value = 'auto';
        outputLanguage.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#settingsForm').requestSubmit();
      })()
    `);
    await window.webContents.executeJavaScript(`
      (() => {
        const provider = document.querySelector('#llmProvider');
        provider.value = 'mymemory';
        provider.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#settingsForm').requestSubmit();
      })()
    `);
    const myMemoryProviderState = await waitForState(
      window,
      (state) => (
        state.llmProvider === "mymemory" &&
        state.providerStatusText === "Local mode · Local whisper.cpp + MyMemory Free"
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const provider = document.querySelector('#llmProvider');
        provider.value = 'embedded';
        provider.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#settingsForm').requestSubmit();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.llmProvider === "embedded" &&
        state.llmSetupTitle === "Built-in Qwen3" &&
        !state.installLlmHidden &&
        state.providerStatusText.includes("Built-in local language model")
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
        state.mainTabsAriaLabel === "主视图" &&
        state.voiceCommandAriaLabel === "录音控制" &&
        state.resultActionsAriaLabel === "结果操作" &&
        state.settingsSectionsAriaLabel === "设置分区" &&
        state.shortcutHintText === "快捷键：Ctrl + Alt + Space" &&
        state.providerStatusText.includes("Local whisper.cpp")
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const provider = document.querySelector('#llmProvider');
        provider.value = 'mymemory';
        provider.dispatchEvent(new Event('change', { bubbles: true }));
        const outputLanguage = document.querySelector('#outputLanguage');
        outputLanguage.value = 'zh-Hans';
        outputLanguage.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#settingsForm').requestSubmit();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        activeSettingsSaveCalls === 0 &&
        state.outputLanguage === "zh-Hans" &&
        state.llmProvider === "mymemory" &&
        !state.recordButtonDisabled &&
        state.providerStatusText.includes("MyMemory Free")
      ),
      5000
    );

    const settingsQueueBarrierIndex = settingsSaveCalls.length;
    await window.webContents.executeJavaScript("document.querySelector('#settingsForm').requestSubmit()");
    await waitForState(
      window,
      () => settingsSaveCalls.length === settingsQueueBarrierIndex + 1 && activeSettingsSaveCalls === 0,
      5000
    );

    const staleFullSaveIndex = settingsSaveCalls.length;
    deferNextFullSettingsSave = true;
    deferProcessingLanguageSaves = true;
    await window.webContents.executeJavaScript("document.querySelector('#settingsForm').requestSubmit()");
    await waitForState(
      window,
      () => (
        deferredFullSettingsSaveReached &&
        settingsSaveCalls.length === staleFullSaveIndex + 1 &&
        activeSettingsSaveCalls === 1
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const outputLanguage = document.querySelector('#outputLanguage');
        outputLanguage.value = 'fr';
        outputLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    const editedDuringFullSaveState = await readRendererState(window);
    if (editedDuringFullSaveState.outputLanguage !== "fr") {
      throw new Error(`Language edit was not applied while full save was pending: ${editedDuringFullSaveState.outputLanguage}.`);
    }

    releaseDeferredFullSettingsSave?.();
    await waitForState(
      window,
      () => (
        settingsSaveCalls.length === staleFullSaveIndex + 2 &&
        activeSettingsSaveCalls === 1 &&
        deferredSettingsSaveResolvers.length === 1
      ),
      5000
    );
    if (settingsSaveCalls[staleFullSaveIndex].outputLanguage !== "zh-Hans") {
      throw new Error("Delayed full save did not capture language A.");
    }
    assertPartialSettingsSave(settingsSaveCalls[staleFullSaveIndex + 1], {
      outputLanguage: "fr"
    });
    const staleFullSaveReturnState = await readRendererState(window);
    if (staleFullSaveReturnState.outputLanguage !== "fr") {
      throw new Error(`Delayed full save overwrote language B with ${staleFullSaveReturnState.outputLanguage}.`);
    }

    deferredSettingsSaveResolvers.shift()?.();
    await window.webContents.executeJavaScript(`
      (() => {
        const originalClose = AudioContext.prototype.close;
        AudioContext.prototype.close = function closeForSmoke() {
          originalClose.call(this).catch(() => {});
          return Promise.resolve();
        };
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        let releasePendingGetUserMedia;
        const pendingGetUserMedia = new Promise((resolve) => {
          releasePendingGetUserMedia = resolve;
        });
        window.__pendingGetUserMediaReady = false;
        window.__pendingOldStream = null;
        window.__releasePendingGetUserMedia = () => releasePendingGetUserMedia();
        window.__restoreGetUserMedia = () => {
          Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            configurable: true,
            value: originalGetUserMedia
          });
        };
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
          configurable: true,
          value: async (...args) => {
            const stream = await originalGetUserMedia(...args);
            window.__pendingOldStream = stream;
            window.__pendingGetUserMediaReady = true;
            await pendingGetUserMedia;
            return stream;
          }
        });
      })()
    `);
    driveRendererRecordingCommands = true;
    await smokeSystemInputController.start();
    const cancelledPendingOperationId = smokeSystemInputController.getState().operationId;
    await waitForState(
      window,
      (state) => (
        state.pendingGetUserMediaReady &&
        state.bodyPhase === "starting" &&
        recordingStatusReports.some((report) => (
          report.operationId === cancelledPendingOperationId &&
          report.phase === "starting"
        ))
      ),
      10000
    );
    await smokeSystemInputController.cancel();
    if (smokeSystemInputController.getState().phase !== "idle") {
      throw new Error("Pending getUserMedia cancellation did not return the controller to idle.");
    }
    await window.webContents.executeJavaScript("window.__restoreGetUserMedia()");

    await smokeSystemInputController.start();
    await smokeSystemInputController.start();
    const activeRecordingOperationId = smokeSystemInputController.getState().operationId;
    if (activeRecordingOperationId !== cancelledPendingOperationId + 1) {
      throw new Error("A new recording operation did not start immediately after pending cancellation.");
    }
    await waitForState(
      window,
      (state) => (
        state.isRecording &&
        state.recordLabel === "停止并转写" &&
        state.bodyPhase === "recording" &&
        state.voiceCommandPhase === "recording"
      ),
      10000
    );
    await window.webContents.executeJavaScript("window.__releasePendingGetUserMedia()");
    await waitForState(
      window,
      (state) => state.isRecording && state.pendingOldTracksEnded,
      10000
    );
    if (recordingStatusReports.some((report) => (
      report.operationId === cancelledPendingOperationId &&
      report.phase === "recording"
    ))) {
      throw new Error("Cancelled pending operation reported a late recording state.");
    }
    await waitForState(
      window,
      (state) => (
        activeSettingsSaveCalls === 0 &&
        settings.outputLanguage === "fr" &&
        state.isRecording
      ),
      5000
    );
    const recordingState = await readRendererState(window);
    if (
      recordingState.statusText !== "正在录音。再次点击或按快捷键停止。" ||
      recordingState.bodyPhase !== "recording" ||
      recordingState.voiceCommandPhase !== "recording"
    ) {
      throw new Error(`Language save overwrote recording status: ${recordingState.statusText}`);
    }
    deferProcessingLanguageSaves = false;

    await smokeSystemInputController.stop();
    const completedState = await waitForState(
      window,
      (state) => (
        !state.isRecording &&
        state.recordLabel === "开始录音" &&
        state.resultText === "smoke transcript" &&
        state.visibleCharacterCount === "16 个字符" &&
        state.bodyPhase === "done" &&
        state.voiceCommandPhase === "done"
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

    dictationResult = {
      createdAt: new Date().toISOString(),
      status: "failed",
      text: "",
      transcript: "hello world",
      processingError: "3221225477 spawn C:\\private\\target-helper.exe ENOENT stderr"
    };
    await window.webContents.executeJavaScript(`
      (() => {
        const interfaceLanguage = document.querySelector('#interfaceLanguage');
        interfaceLanguage.value = 'en';
        interfaceLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(window, (state) => state.interfaceLanguage === "en", 5000);

    const reportsBeforeSettingsStartFailure = recordingStatusReports.length;
    settingsSaveError = unsafeDiagnostic;
    await window.webContents.executeJavaScript("document.querySelector('#recordButton').click()");
    const failedRecordingSettingsState = await waitForState(
      window,
      (state) => (
        !state.isRecording &&
        state.bodyPhase === "error" &&
        state.statusText === "Settings could not be saved." &&
        recordingStatusReports.length > reportsBeforeSettingsStartFailure &&
        recordingStatusReports.at(-1)?.phase === "error"
      ),
      5000
    );
    assertNoDiagnosticLeak(failedRecordingSettingsState.statusText, "Recording settings failure status");
    assertNoDiagnosticLeak(recordingStatusReports.at(-1)?.message, "Recording settings lifecycle message");
    settingsSaveError = "";

    const reportsBeforeProcessFailure = recordingStatusReports.length;
    dictationWavError = unsafeDiagnostic;
    await window.webContents.executeJavaScript("document.querySelector('#recordButton').click()");
    await waitForState(window, (state) => state.isRecording, 10000);
    await window.webContents.executeJavaScript("document.querySelector('#recordButton').click()");
    const failedProcessState = await waitForState(
      window,
      (state) => (
        !state.isRecording &&
        state.bodyPhase === "error" &&
        state.statusText === "Dictation processing failed." &&
        recordingStatusReports.length > reportsBeforeProcessFailure &&
        recordingStatusReports.at(-1)?.phase === "error"
      ),
      10000
    );
    assertNoDiagnosticLeak(failedProcessState.statusText, "Dictation processing failure status");
    assertNoDiagnosticLeak(recordingStatusReports.at(-1)?.message, "Dictation processing lifecycle message");
    dictationWavError = "";

    await window.webContents.executeJavaScript("document.querySelector('#recordButton').click()");
    await waitForState(window, (state) => state.isRecording, 10000);
    await window.webContents.executeJavaScript("document.querySelector('#recordButton').click()");
    const failedTargetOutputState = await waitForState(
      window,
      (state) => (
        !state.isRecording &&
        state.resultText === "" &&
        state.resultEmpty &&
        state.resultAriaPlaceholder.includes("Target language output failed") &&
        state.statusText === "Target language output failed."
      ),
      10000
    );
    assertNoDiagnosticLeak(failedTargetOutputState.statusText, "Target output failure status");
    await window.webContents.executeJavaScript(`
      (() => {
        window.__copyAttempts = [];
        document.querySelector('#copyResult').click();
      })()
    `);
    await waitForState(window, (state) => state.copyAttempts === 0, 5000);

    if (settingsAtDictation?.outputLanguage !== "fr") {
      throw new Error(`Output language was not applied before dictation. Saw ${settingsAtDictation?.outputLanguage || "unset"}.`);
    }
    if (settingsAtDictation?.llmProvider !== "mymemory") {
      throw new Error(`Text provider was not applied before dictation. Saw ${settingsAtDictation?.llmProvider || "unset"}.`);
    }
    if (!setupCompletionResults.some((result) => result.type === "llm" && result.status === "complete")) {
      throw new Error("Qwen setup success was not exercised.");
    }
    if (successfulSetupCancels < 1) {
      throw new Error("Successful model setup cancellation was not exercised.");
    }
    for (const phase of ["starting", "recording", "stopping", "transcribing", "error"]) {
      const reports = recordingStatusReports.filter((report) => report.phase === phase);
      if (!reports.length) {
        throw new Error(`Recording lifecycle did not report ${phase}.`);
      }
      if (reports.some((report) => !Number.isSafeInteger(report.operationId) || report.operationId <= 0)) {
        throw new Error(`Recording lifecycle ${phase} report omitted its operation id.`);
      }
    }

    const blockedWarnings = rendererMessages.filter((item) => isBlockedRendererWarning(item.message));
    if (blockedWarnings.length) {
      throw new Error(`Renderer emitted blocked warnings: ${blockedWarnings.map((item) => item.message).join(" | ")}`);
    }
    if (rendererMessages.length !== 0) {
      throw new Error(`Renderer emitted console messages: ${rendererMessages.map((item) => item.message).join(" | ")}`);
    }

    smokeStage = "success-output";
    console.log(JSON.stringify({
      ok: true,
      initialState,
      keyboardShortcutRecorderState,
      mouseShortcutRecorderState,
      englishLanguageState,
      myMemoryTargetPreviewState,
      myMemoryProviderState,
      recordingState,
      completedState,
      failedTargetOutputState,
      hudState,
      warningHudState,
      hudActionCalls,
      osInputEvidence: lastOsInputEvidence,
      settingsAtDictation,
      rendererMessages: rendererMessages.filter((item) => item.level >= 2)
    }, null, 2));
    clearTimeout(timeout);
    smokeStage = "dispose";
    hudActions.dispose();
    if (globalShortcut.isRegistered("Escape")) {
      throw new Error("Escape should be released after HUD actions dispose.");
    }
    app.exit(0);
  } catch (error) {
    const state = await readRendererState(window).catch((stateError) => ({
      error: stateError.message
    }));
    console.error(JSON.stringify({
      ok: false,
      stage: smokeStage,
      osInputEvidence: lastOsInputEvidence,
      name: error.name,
      message: error.message,
      state,
      rendererMessages,
      hudMessages
    }, null, 2));
    clearTimeout(timeout);
    hudActions?.dispose();
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

async function waitForHudState(window, predicate, timeoutMs) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readHudState(window);
    if (predicate(lastState)) {
      return lastState;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for HUD state. Last state: ${JSON.stringify(lastState)}`);
}

async function waitForHudAction(action, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (hudActionCalls.includes(action)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for HUD action: ${action}`);
}

async function waitForHudActionCount(action, expectedCount, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const count = hudActionCalls.filter((item) => item === action).length;
    if (count >= expectedCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for HUD action count: ${action} x ${expectedCount}`);
}

async function waitForControllerPhase(phase, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (smokeSystemInputController?.getState().phase === phase) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for controller phase: ${phase}`);
}

async function sendOsEscapeKey() {
  const { stdout } = await execFileAsync(
    powershellPath,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      windowsEscapeInjectionScript
    ],
    {
      timeout: 5000,
      windowsHide: true
    }
  );
  lastOsInputEvidence = stdout.trim();
}

function readRendererState(window) {
  return window.webContents.executeJavaScript(`
    (() => ({
      ready: Boolean(window.localFlow && document.querySelector('#recordButton')),
      hasLanguageControls: Boolean(document.querySelector('#languageControls')),
      hasVoiceCommandBar: Boolean(document.querySelector('#commandStrip')),
      hasResultText: Boolean(document.querySelector('#resultText')),
      hasRecentHistoryList: Boolean(document.querySelector('#historyList')),
      hasFooterHealthText: Boolean(document.querySelector('#headerHealthText')),
      isRecording: document.body.classList.contains('recording'),
      pendingGetUserMediaReady: Boolean(window.__pendingGetUserMediaReady),
      pendingOldTracksEnded: Boolean(
        window.__pendingOldStream?.getTracks().length &&
        window.__pendingOldStream.getTracks().every((track) => track.readyState === 'ended')
      ),
      recordLabel: document.querySelector('#recordLabel')?.textContent || '',
      statusText: document.querySelector('#statusText')?.textContent || '',
      headerHealthText: document.querySelector('#headerHealthText')?.textContent || '',
      footerHealthText: document.querySelector('#headerHealthText')?.textContent || '',
      footerHealthReady: !document.querySelector('#recordButton')?.disabled,
      recordReadinessReady: !document.querySelector('#recordButton')?.disabled,
      resultText: document.querySelector('#resultText')?.textContent || '',
      resultEmpty: document.querySelector('#resultText')?.dataset.emptyResult === 'true',
      resultAriaPlaceholder: document.querySelector('#resultText')?.getAttribute('aria-placeholder') || '',
      editorCharacterCount: Number(document.querySelector('#resultText')?.dataset.characterCount || 0),
      visibleCharacterCount: document.querySelector('#resultCharacterCount')?.textContent || '',
      interfaceLanguage: document.querySelector('#interfaceLanguage')?.value || '',
      interfaceLanguageOptions: [...(document.querySelector('#interfaceLanguage')?.options || [])]
        .map((option) => option.value),
      whisperLanguage: document.querySelector('#whisperLanguage')?.value || '',
      outputLanguage: document.querySelector('#outputLanguage')?.value || '',
      hotkeyValue: document.querySelector('#hotkey')?.value || '',
      pasteLastHotkeyValue: document.querySelector('#pasteLastHotkey')?.value || '',
      hasShortcutRecorder: Boolean(
        document.querySelector('#recordHotkey') && document.querySelector('#recordPasteLastHotkey')
      ),
      recordHotkeyPressed: document.querySelector('#recordHotkey')?.getAttribute('aria-pressed') === 'true',
      recordPasteLastHotkeyPressed: document.querySelector('#recordPasteLastHotkey')?.getAttribute('aria-pressed') === 'true',
      recordHotkeyDisabled: Boolean(document.querySelector('#recordHotkey')?.disabled),
      launchAtLogin: document.querySelector('#launchAtLogin')?.checked ?? null,
      startMinimizedToTray: document.querySelector('#startMinimizedToTray')?.checked ?? null,
      globalShortcutPaused: document.querySelector('#globalShortcutPaused')?.checked ?? null,
      llmProvider: document.querySelector('#llmProvider')?.value || '',
      llmSetupTitle: document.querySelector('[data-setup-type="llm"] strong')?.textContent || '',
      llmSetupStatusText: document.querySelector('#llmSetupStatus')?.textContent || '',
      providerStatusText: document.querySelector('#providerStatusText')?.textContent || '',
      mainTabsAriaLabel: document.querySelector('#primaryNavigation')?.getAttribute('aria-label') || '',
      voiceCommandAriaLabel: document.querySelector('#commandStrip')?.getAttribute('aria-label') || '',
      resultActionsAriaLabel: document.querySelector('#editorPane .button-row')?.getAttribute('aria-label') || '',
      footerHealthAriaLabel: document.querySelector('#appTopbar')?.getAttribute('aria-label') || '',
      settingsSectionsAriaLabel: document.querySelector('.settings-section-tabs')?.getAttribute('aria-label') || '',
      shortcutHintText: document.querySelector('.shortcut-hint span:last-child')?.textContent || '',
      hasSettingsDrawer: Boolean(document.querySelector('#settingsDrawer')),
      settingsDrawerOpen: document.querySelector('#settingsDrawer')?.classList.contains('open') || false,
      settingsDrawerAriaHidden: document.querySelector('#settingsDrawer')?.getAttribute('aria-hidden') === 'true',
      settingsDrawerInert: Boolean(document.querySelector('#settingsDrawer')?.inert),
      settingsSectionCount: document.querySelectorAll('[data-settings-section]').length,
      activeSettingsSection: document.querySelector('[data-settings-section][aria-selected="true"]')?.dataset.settingsSection || '',
      settingsGeneralHidden: Boolean(document.querySelector('#settingsGeneral')?.hidden),
      settingsShortcutsHidden: Boolean(document.querySelector('#settingsShortcuts')?.hidden),
      settingsModelsHidden: Boolean(document.querySelector('#settingsModels')?.hidden),
      settingsAdvancedHidden: Boolean(document.querySelector('#settingsAdvanced')?.hidden),
      drawerTabPrevented: Boolean(window.__drawerTabPrevented),
      hasLocalModelStatus: Boolean(document.querySelector('#localModelStatus')?.textContent?.trim()),
      hasSetupChecklist: Boolean(document.querySelector('#setupChecklist')),
      setupChecklistText: document.querySelector('#setupChecklist')?.textContent || '',
      setupOutputText: document.querySelector('#setupOutput')?.textContent || '',
      whisperDiagnosticsText: document.querySelector('#diagnosticsList')?.textContent || '',
      textDiagnosticsText: document.querySelector('#textDiagnosticsList')?.textContent || '',
      hasInstallWhisperButton: Boolean(document.querySelector('#installWhisper')),
      hasInstallLlmButton: Boolean(document.querySelector('#installLlm')),
      hasRefreshSetupButton: Boolean(document.querySelector('#refreshSetupStatus')),
      hasCancelSetupButton: Boolean(document.querySelector('#cancelSetup')),
      cancelSetupHidden: Boolean(document.querySelector('#cancelSetup')?.hidden),
      hasCopyResultButton: Boolean(document.querySelector('#copyResult')),
      hasInsertResultButton: Boolean(document.querySelector('#insertResult')),
      hasRestoreResultButton: Boolean(document.querySelector('#restoreResult')),
      restoreResultDisabled: Boolean(document.querySelector('#restoreResult')?.disabled),
      recentHistoryCount: document.querySelectorAll('#historyList [data-history-item]').length,
      fullHistoryCount: document.querySelectorAll('#historyList [data-history-item]').length,
      failedHistoryEntriesSelectable: (() => {
        const actions = [...document.querySelectorAll(
          '#historyList [data-history-status="failed"] [data-history-action]'
        )];
        return actions.length > 0 && actions.every((action) => !action.disabled);
      })(),
      dictationTabSelected: document.querySelector('#navHome')?.getAttribute('aria-current') === 'page',
      historyTabSelected: document.querySelector('#navHistory')?.getAttribute('aria-current') === 'page',
      dictationPanelHidden: document.body.dataset.primaryView !== 'home',
      historyPanelHidden: document.body.dataset.primaryView !== 'history',
      activeElementId: document.activeElement?.id || '',
      bodyPhase: document.body.dataset.phase || '',
      voiceCommandPhase: document.querySelector('#commandStrip')?.dataset.phase || '',
      hasCheckTextProviderButton: Boolean(document.querySelector('#checkTextProvider')),
      installWhisperDisabled: Boolean(document.querySelector('#installWhisper')?.disabled),
      installLlmDisabled: Boolean(document.querySelector('#installLlm')?.disabled),
      installLlmHidden: Boolean(document.querySelector('#installLlm')?.hidden),
      refreshSetupDisabled: Boolean(document.querySelector('#refreshSetupStatus')?.disabled),
      copyAttempts: window.__copyAttempts?.length || 0,
      copyAttemptTexts: window.__copyAttempts || [],
      execCommands: window.__execCommands || [],
      hasRecordButton: Boolean(document.querySelector('#recordButton')),
      visibleRecordRecoveryCount: document.querySelectorAll('#recordRecovery:not([hidden])').length,
      recordRecoveryActionText: document.querySelector('#recordRecoveryAction')?.textContent?.trim() || '',
      mainSetupControlCount: document.querySelector('main')?.querySelectorAll(
        '#setupChecklist, #installWhisper, #installLlm, #refreshSetupStatus, #cancelSetup, #setupOutput, #whisperCliPath, #whisperModelPath, #embeddedLlmCliPath, #embeddedLlmModelPath'
      ).length || 0,
      recordButtonDisabled: Boolean(document.querySelector('#recordButton')?.disabled),
      recordButtonRect: (() => {
        const rect = document.querySelector('#recordButton')?.getBoundingClientRect();
        return rect ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        } : null;
      })(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      visibleMainText: document.querySelector('main')?.innerText || '',
      hasLocalFlow: Boolean(window.localFlow)
    }))()
  `);
}

function readHudState(window) {
  return window.webContents.executeJavaScript(`
    (() => ({
      ready: Boolean(window.localFlow),
      hasSystemInputStatusListener: typeof window.localFlow?.onSystemInputStatus === 'function',
      hasStopAction: typeof window.localFlow?.stop === 'function',
      hasCancelAction: typeof window.localFlow?.cancel === 'function',
      hasOpenMainWindowAction: typeof window.localFlow?.openMainWindow === 'function',
      hasHudRoot: Boolean(document.querySelector('#hudRoot')),
      phase: document.querySelector('#hudRoot')?.dataset.phase || '',
      cancelHidden: Boolean(document.querySelector('#hudCancel')?.hidden),
      stopHidden: Boolean(document.querySelector('#hudStop')?.hidden),
      stopDisabled: Boolean(document.querySelector('#hudStop')?.disabled),
      openMainHidden: Boolean(document.querySelector('#hudOpenMain')?.hidden),
      visibleText: document.querySelector('#hudRoot')?.innerText || ''
    }))()
  `);
}

function isBlockedRendererWarning(message) {
  const text = String(message || "");
  return text.includes("Electron Security Warning") || text.includes("ScriptProcessorNode is deprecated");
}

function isFocusContainmentWarning(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("blocked aria-hidden") ||
    text.includes("aria-hidden") && text.includes("retained focus") ||
    text.includes("inert") && text.includes("focus")
  );
}

function assertPartialSettingsSave(actual, expected) {
  const actualKeys = Object.keys(actual || {});
  const expectedKeys = Object.keys(expected);
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => actual[key] !== expected[key])
  ) {
    throw new Error(`Expected partial settings save ${JSON.stringify(expected)}, saw ${JSON.stringify(actual)}.`);
  }
}

function assertNoDiagnosticLeak(value, label) {
  const leak = /3221225477|spawn|ENOENT|stderr|[A-Za-z]:[\\/]/i.exec(String(value || ""));
  if (leak) {
    throw new Error(`${label} leaked diagnostics: ${leak[0]}`);
  }
}
