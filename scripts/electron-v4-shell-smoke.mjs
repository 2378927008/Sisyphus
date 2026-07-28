import { app, BrowserWindow, ipcMain, session } from "electron";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyElectronRuntimeSwitches } from "../src/main/electron-runtime.js";
import { configureMediaPermissions } from "../src/main/media-permissions.js";
import { getProcessingProviderStatus } from "../src/main/provider-registry.js";
import { defaultSettings, mergeSettings } from "../src/main/settings-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const htmlPath = path.join(projectRoot, "src", "renderer", "index.html");
const preloadPath = path.join(projectRoot, "src", "preload.cjs");
const unsafeDiagnostic = "3221225477 spawn C:\\private\\provider-helper.exe ENOENT stderr";
const smokeKind = "v4-shell";
const expectedInterfaceLanguageCodes = ["en", "zh-Hans", "ja", "ko", "zh-Hant", "fr", "ru", "es"];
const smokeIpcChannelRegistry = [
  "settings:get",
  "settings:save",
  "data:recovery-status",
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
  whisperModelPath: "C:\\smoke\\ggml-base.bin",
  dictionary: ["Qwen", "Local Flow"],
  snippets: [
    {
      id: "snippet-existing",
      trigger: "meeting notes",
      text: "Summarize the meeting notes."
    },
    {
      id: "snippet-duplicate",
      trigger: "alpha shortcut",
      text: "Alpha expansion."
    },
    {
      id: "snippet-duplicate",
      trigger: "beta shortcut",
      text: "Beta expansion."
    }
  ]
});
const settingsSaveCalls = [];
let settingsSaveError = "";
const settingsSavePlans = [];
let historyListCalls = 0;
const historyUpdateCalls = [];
const historyReprocessCalls = [];
const insertTextCalls = [];
const interactionOrder = [];
let historyUpdateResult = null;
let historyReprocessResult = null;
let insertTextResult = { ok: true };
const historyListPlans = [];
const historyUpdatePlans = [];
const historyReprocessPlans = [];
let whisperDiagnosticsResult = {
  ready: true,
  checks: [{ label: "Whisper", status: "pass", message: "Whisper diagnostics stubbed." }]
};
let providerStatusOverride = null;

function localFixtureDate(dayOffset, hour) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString();
}

function createDeferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function delayNextSettingsSave() {
  const started = createDeferred();
  const release = createDeferred();
  settingsSavePlans.push({ started, release });
  return { started: started.promise, release: release.resolve };
}

function failNextSettingsSave(error) {
  settingsSavePlans.push({ error });
}

function delayNextHistoryList(snapshot = structuredClone(historyFixtures)) {
  const started = createDeferred();
  const release = createDeferred();
  historyListPlans.push({ snapshot, started, release });
  return { started: started.promise, release: release.resolve };
}

function delayNextHistoryUpdate(result) {
  const started = createDeferred();
  const release = createDeferred();
  const plan = { started, release };
  if (arguments.length > 0) plan.result = result;
  historyUpdatePlans.push(plan);
  return { started: started.promise, release: release.resolve };
}

function queueHistoryUpdateResult(result) {
  historyUpdatePlans.push({ result });
}

function delayNextHistoryReprocess(result) {
  const started = createDeferred();
  const release = createDeferred();
  historyReprocessPlans.push({ result, started, release });
  return { started: started.promise, release: release.resolve };
}

const historyFixtures = [
  {
    id: "history-today-newest",
    createdAt: localFixtureDate(0, 13),
    transcript: "Q3 version planning notes",
    status: "complete",
    text: "关于 Q3 版本迭代计划的会议纪要整理如下，包含目标、范围、资源与时间安排。"
  },
  {
    id: "history-today-whitespace",
    createdAt: localFixtureDate(0, 12),
    transcript: "Transcript-only content must not be displayed or selected.",
    status: "partial",
    text: " \n\t "
  },
  {
    id: "history-today-older",
    createdAt: localFixtureDate(0, 10),
    transcript: "Design sync",
    status: "partial",
    text: "与设计团队同步登录流程改进方案，重点讨论错误提示和加载状态。"
  },
  {
    id: "history-yesterday",
    createdAt: localFixtureDate(-1, 16),
    transcript: "Weekly feedback",
    status: "complete",
    text: "统计本周的用户反馈，按优先级整理到表格中。"
  },
  {
    id: "history-older",
    createdAt: localFixtureDate(-6, 9),
    transcript: "Comparison list",
    status: "complete",
    text: "比较三款笔记软件的优缺点，做成列表。"
  },
  {
    id: "history-english",
    createdAt: localFixtureDate(-6, 8),
    transcript: "English source",
    status: "complete",
    text: "English history entry"
  },
  {
    id: "history-emoji",
    createdAt: localFixtureDate(-6, 7),
    transcript: "Emoji source",
    status: "complete",
    text: "Emoji history entry 🎤"
  },
  {
    id: "history-failed",
    createdAt: localFixtureDate(-6, 6),
    transcript: "",
    status: "failed",
    text: "",
    processingError: unsafeDiagnostic
  },
  {
    id: "history-failed-recoverable",
    createdAt: localFixtureDate(-6, 5),
    transcript: "Recoverable original transcript",
    status: "failed",
    text: "",
    processingError: unsafeDiagnostic
  }
];

const setupStatus = {
  assets: {
    whisper: {
      ready: true
    },
    llm: {
      ready: false,
      runtimeReady: false,
      modelReady: false
    }
  },
  setups: {
    whisper: { type: "whisper", status: "idle" },
    llm: { type: "llm", status: "idle" }
  }
};

function registerSmokeIpcHandler(channel, handler) {
  if (!smokeIpcChannelRegistry.includes(channel)) {
    throw new Error(`Unregistered smoke IPC channel: ${channel}`);
  }
  ipcMain.handle(channel, handler);
  registeredSmokeIpcChannels.add(channel);
}

function assertSmokeIpcCoverage() {
  const missing = smokeIpcChannelRegistry.filter((channel) => !registeredSmokeIpcChannels.has(channel));
  if (missing.length) {
    throw new Error(`Smoke IPC coverage mismatch. Missing: ${missing.join(", ")}`);
  }
}

function wireIpc() {
  registerSmokeIpcHandler("settings:get", () => settings);
  registerSmokeIpcHandler("data:recovery-status", () => []);
  registerSmokeIpcHandler("settings:save", async (_event, next) => {
    settingsSaveCalls.push(structuredClone(next));
    const plan = settingsSavePlans.shift();
    plan?.started?.resolve();
    if (plan?.release) {
      await plan.release.promise;
    }
    if (plan?.error) {
      throw new Error(plan.error);
    }
    if (settingsSaveError) {
      throw new Error(settingsSaveError);
    }
    settings = mergeSettings(next, settings);
    return settings;
  });
  registerSmokeIpcHandler("history:list", async () => {
    historyListCalls += 1;
    const plan = historyListPlans.shift();
    if (plan) {
      plan.started.resolve();
      await plan.release.promise;
      return plan.snapshot;
    }
    return structuredClone(historyFixtures);
  });
  registerSmokeIpcHandler("history:update", async (_event, payload = {}) => {
    historyUpdateCalls.push({ id: payload.id, text: payload.text });
    interactionOrder.push(`update:${payload.id}:${payload.text}`);
    const plan = historyUpdatePlans.shift();
    if (plan?.started) {
      plan.started.resolve();
      await plan.release.promise;
    }
    if (plan && Object.hasOwn(plan, "result")) {
      if (plan.result?.ok === true && plan.result.entry) {
        const fixture = historyFixtures.find((entry) => entry.id === payload.id);
        if (fixture) Object.assign(fixture, plan.result.entry, { id: payload.id });
      }
      return plan.result;
    }
    if (historyUpdateResult) {
      const result = historyUpdateResult;
      historyUpdateResult = null;
      return result;
    }
    const fixture = historyFixtures.find((entry) => entry.id === payload.id);
    if (!fixture) return { ok: false, reason: "not_found" };
    fixture.text = payload.text;
    fixture.status = fixture.status === "failed" ? "partial" : fixture.status;
    return { ok: true, entry: { ...fixture } };
  });
  registerSmokeIpcHandler("history:reprocess", async (_event, id) => {
    historyReprocessCalls.push(id);
    interactionOrder.push(`reprocess:${id}`);
    const plan = historyReprocessPlans.shift();
    if (plan?.started) {
      plan.started.resolve();
      await plan.release.promise;
    }
    if (plan && Object.hasOwn(plan, "result")) {
      if (plan.result?.ok === true && plan.result.entry) {
        const fixture = historyFixtures.find((entry) => entry.id === id);
        if (fixture) Object.assign(fixture, plan.result.entry, { id });
      }
      return plan.result;
    }
    if (historyReprocessResult) {
      const result = historyReprocessResult;
      historyReprocessResult = null;
      return result;
    }
    const fixture = historyFixtures.find((entry) => entry.id === id);
    const result = {
      ok: true,
      entry: {
        ...fixture,
        id,
        text: "重新处理后的文本",
        status: "complete",
        processingError: ""
      }
    };
    Object.assign(fixture, result.entry, { id });
    return result;
  });
  registerSmokeIpcHandler("dictation:insert-text", (_event, text) => {
    insertTextCalls.push(text);
    return insertTextResult;
  });
  registerSmokeIpcHandler("diagnostics:whisper", () => whisperDiagnosticsResult);
  registerSmokeIpcHandler("diagnostics:text", () => ({
    ready: true,
    checks: [{ label: "MyMemory Free", status: "pass", message: "Text provider diagnostics stubbed." }]
  }));
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
  registerSmokeIpcHandler("models:setup-status", () => setupStatus);
  registerSmokeIpcHandler("models:setup-refresh", () => setupStatus);
  registerSmokeIpcHandler("models:setup-start", (_event, type) => ({
    assets: setupStatus.assets,
    setups: {
      ...setupStatus.setups,
      [type]: { type, status: "complete" }
    }
  }));
  registerSmokeIpcHandler("models:setup-cancel", (_event, type) => ({
    assets: setupStatus.assets,
    setups: {
      ...setupStatus.setups,
      [type]: { type, status: "failed", failureReason: "setup_cancelled" }
    }
  }));
  registerSmokeIpcHandler("dictation:status-latest", () => ({
    phase: "idle",
    message: unsafeDiagnostic
  }));
  registerSmokeIpcHandler("dictation:wav", () => ({
    id: "smoke-dictation",
    createdAt: new Date().toISOString(),
    status: "complete",
    text: "smoke transcript"
  }));
}

app.whenReady().then(async () => {
  wireIpc();
  assertSmokeIpcCoverage();

  const rendererMessages = [];
  const window = new BrowserWindow({
    show: false,
    width: 1180,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  configureMediaPermissions(session.defaultSession, {
    getAllowedWebContents: () => window.webContents,
    getAllowedUrl: () => pathToFileURL(htmlPath).href
  });

  window.webContents.on("console-message", (_event, details) => {
    rendererMessages.push({
      level: details.level,
      message: details.message,
      line: details.lineNumber,
      sourceId: details.sourceId
    });
  });

  try {
    await window.loadFile(htmlPath);

    const initial = await waitForState(
      window,
      (state) => (
        state.ready &&
        state.interfaceLanguage === "zh-Hans" &&
        state.interfaceLanguageOptions.join(",") === expectedInterfaceLanguageCodes.join(",") &&
        state.homeCurrent &&
        !state.historyCurrent &&
        !state.dictionaryCurrent &&
        !state.snippetsCurrent &&
        state.primaryNavigationCount === 5 &&
        state.enabledPrimaryNavigationCount === 5 &&
        state.commandStripVisible &&
        state.recordButtonVisible &&
        state.hasLanguageControls &&
        state.hasVoiceCommandBar &&
        state.hasResultText &&
        state.hasRecentHistoryList &&
        state.hasFooterHealthText &&
        state.hasRecordButton &&
        state.historyGroupCount === 3 &&
        state.historyRowCount === historyFixtures.length &&
        state.selectedHistoryId === "history-today-newest" &&
        state.whitespaceHistoryDisabled &&
        !state.whitespaceHistorySelected &&
        state.whitespaceHistoryTabIndex === -1 &&
        state.resultText.includes("Q3 版本迭代计划") &&
        !state.visibleMainText.includes("Transcript-only content") &&
        state.settingsDrawerInert
      ),
      7000
    );

    assertRectInsideViewport(initial.commandStripRect, initial, "Command strip");
    assertRectInsideViewport(initial.recordButtonRect, initial, "Record button");
    assertNoUnsafeDiagnostic(initial.visibleMainText, "Initial main text");

    whisperDiagnosticsResult = {
      ready: false,
      checks: [{ label: "Whisper", status: "fail", message: "Whisper runtime and model are missing." }]
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
    await window.webContents.executeJavaScript("document.querySelector('#checkWhisper').click()");
    const missingWhisperRecoveryState = await waitForState(
      window,
      (state) => (
        state.visibleRecordRecoveryCount === 1 &&
        state.recordRecoveryActionText.includes("Whisper") &&
        state.mainSetupControlCount === 0
      ),
      5000
    );
    assertNoUnsafeDiagnostic(missingWhisperRecoveryState.visibleMainText, "Missing Whisper main text");
    whisperDiagnosticsResult = {
      ready: true,
      checks: [{ label: "Whisper", status: "pass", message: "Whisper diagnostics stubbed." }]
    };
    providerStatusOverride = null;
    await window.webContents.executeJavaScript("document.querySelector('#checkWhisper').click()");
    await waitForState(window, (state) => state.visibleRecordRecoveryCount === 0, 5000);

    const callsBeforeGlobalSearch = historyListCalls;
    await window.webContents.executeJavaScript(`
      (() => {
        const search = document.querySelector('#globalSearch');
        search.value = '设计团队';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    const globalSearchState = await waitForState(
      window,
      (state) => (
        state.globalSearchValue === "设计团队" &&
        state.historySearchValue === "设计团队" &&
        state.historyRowCount === 1
      ),
      5000
    );
    if (historyListCalls !== callsBeforeGlobalSearch) {
      throw new Error("Global search requested history instead of filtering the cached projection.");
    }

    const selectionBeforePersonalization = globalSearchState.selectedHistoryId;
    await window.webContents.executeJavaScript("document.querySelector('#navDictionary').click()");
    const dictionaryView = await waitForState(
      window,
      (state) => (
        state.dictionaryCurrent &&
        state.dictionaryPageVisible &&
        !state.workspacePageVisible &&
        state.dictionaryRowCount === 2
      ),
      5000
    );
    assertNoUnsafeDiagnostic(dictionaryView.visibleMainText, "Dictionary page");

    await window.webContents.executeJavaScript(`
      (() => {
        const search = document.querySelector('#dictionarySearch');
        search.value = 'Local   Flow';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      (state) => state.dictionarySearchValue === "Local   Flow" && state.dictionaryRowCount === 1,
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const search = document.querySelector('#dictionarySearch');
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await waitForState(window, (state) => state.dictionaryRowCount === 2, 5000);

    const dictionarySaveStart = settingsSaveCalls.length;
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#dictionaryAdd').click();
        const input = document.querySelector('[data-personalization-form="dictionary"] input');
        input.value = '  Ｑｗｅｎ  ';
        input.closest('form').requestSubmit();
      })()
    `);
    await waitForState(window, (state) => state.dictionaryStatus.length > 0, 5000);
    assert.equal(settingsSaveCalls.length, dictionarySaveStart);

    await window.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector('[data-personalization-form="dictionary"] input');
        input.value = '  Codex   Desktop  ';
        input.closest('form').requestSubmit();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        settings.dictionary.includes("Codex Desktop") &&
        state.dictionaryRowCount === 3 &&
        state.activePersonalizationAction === "edit" &&
        state.activeDictionaryRowIndex === "2"
      ),
      5000
    );
    assert.deepEqual(settingsSaveCalls.at(-1), {
      dictionary: ["Qwen", "Local Flow", "Codex Desktop"]
    });

    await window.webContents.executeJavaScript(`
      (() => {
        const row = [...document.querySelectorAll('[data-dictionary-row]')]
          .find((item) => item.textContent.includes('Codex Desktop'));
        row.querySelector('[data-personalization-action="edit"]').click();
        const input = document.querySelector('[data-personalization-form="dictionary"] input');
        input.value = 'Codex Windows';
        input.closest('form').requestSubmit();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        settings.dictionary.includes("Codex Windows") &&
        !settings.dictionary.includes("Codex Desktop") &&
        state.activePersonalizationAction === "edit" &&
        state.activeDictionaryRowIndex === "2"
      ),
      5000
    );

    settingsSaveError = unsafeDiagnostic;
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#dictionaryAdd').click();
        const input = document.querySelector('[data-personalization-form="dictionary"] input');
        input.value = 'Recoverable local term';
        input.closest('form').requestSubmit();
      })()
    `);
    const failedDictionarySave = await waitForState(
      window,
      (state) => (
        state.dictionaryStatus.length > 0 &&
        state.visibleMainText.includes("Recoverable local term")
      ),
      5000
    );
    assertNoUnsafeDiagnostic(failedDictionarySave.visibleMainText, "Dictionary save failure");
    settingsSaveError = "";

    await window.webContents.executeJavaScript(`
      (() => {
        const row = [...document.querySelectorAll('[data-dictionary-row]')]
          .find((item) => item.textContent.includes('Recoverable local term'));
        row.querySelector('[data-personalization-action="delete"]').click();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        !state.visibleMainText.includes("Recoverable local term") &&
        state.activeElementId === "dictionaryAdd"
      ),
      5000
    );

    const dictionaryDraftSave = delayNextSettingsSave();
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#dictionaryAdd').click();
        const input = document.querySelector('[data-personalization-form="dictionary"] input');
        input.value = 'Response anchor';
        input.closest('form').requestSubmit();
      })()
    `);
    await dictionaryDraftSave.started;
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#dictionaryAdd').click();
        const input = document.querySelector('[data-personalization-form="dictionary"] input');
        input.value = 'Second unsaved draft';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange(7, 14);
        const search = document.querySelector('#dictionarySearch');
        search.value = 'Local   Flow';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.dictionaryDraftValue === "Second unsaved draft" &&
        state.activeSelectionStart === 7 &&
        state.activeSelectionEnd === 14
      ),
      5000
    );
    dictionaryDraftSave.release();
    await waitForState(
      window,
      (state) => (
        settings.dictionary.includes("Response anchor") &&
        state.dictionaryDraftValue === "Second unsaved draft" &&
        state.activeSelectionStart === 7 &&
        state.activeSelectionEnd === 14
      ),
      5000
    );
    await window.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
    await window.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
    await waitForState(
      window,
      (state) => state.activePersonalizationAction === "save",
      5000
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-personalization-form="dictionary"] [data-personalization-action="cancel"]').click()
    `);
    await waitForState(window, (state) => state.activeElementId === "dictionaryAdd", 5000);
    await window.webContents.executeJavaScript(`
      (() => {
        const search = document.querySelector('#dictionarySearch');
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    await window.webContents.executeJavaScript("document.querySelector('#navSettings').click()");
    await waitForState(window, (state) => state.settingsDrawerOpen, 5000);
    const staleFullSaveStart = settingsSaveCalls.length;
    const staleFullSave = delayNextSettingsSave();
    await window.webContents.executeJavaScript("document.querySelector('#settingsForm').requestSubmit()");
    await staleFullSave.started;
    await window.webContents.executeJavaScript("document.querySelector('#manageDictionary').click()");
    failNextSettingsSave(unsafeDiagnostic);
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#dictionaryAdd').click();
        const input = document.querySelector('[data-personalization-form="dictionary"] input');
        input.value = 'Stale-safe D1';
        input.closest('form').requestSubmit();
      })()
    `);
    staleFullSave.release();
    const staleFailureState = await waitForState(
      window,
      (state) => (
        settingsSaveCalls.length >= staleFullSaveStart + 2 &&
        state.dictionaryStatus.length > 0 &&
        state.visibleMainText.includes("Stale-safe D1")
      ),
      5000
    );
    assertNoUnsafeDiagnostic(staleFailureState.visibleMainText, "Stale full settings response");

    const languageSaveStart = settingsSaveCalls.length;
    await window.webContents.executeJavaScript(`
      (() => {
        const field = document.querySelector('#outputLanguage');
        field.value = field.value === 'en' ? 'zh-Hans' : 'en';
        field.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(window, () => settingsSaveCalls.length > languageSaveStart, 5000);
    await window.webContents.executeJavaScript("document.querySelector('#navSettings').click()");
    await waitForState(window, (state) => state.settingsDrawerOpen, 5000);
    const retryFullSaveStart = settingsSaveCalls.length;
    await window.webContents.executeJavaScript("document.querySelector('#settingsForm').requestSubmit()");
    await waitForState(window, () => settingsSaveCalls.length > retryFullSaveStart, 5000);
    assert.ok(
      settingsSaveCalls.at(-1).dictionary.includes("Stale-safe D1"),
      "A later full save dropped the failed optimistic dictionary value."
    );
    await window.webContents.executeJavaScript("document.querySelector('#manageDictionary').click()");
    await waitForState(
      window,
      (state) => state.dictionaryCurrent && state.visibleMainText.includes("Stale-safe D1"),
      5000
    );

    await window.webContents.executeJavaScript("document.querySelector('#navSnippets').click()");
    const snippetsView = await waitForState(
      window,
      (state) => (
        state.snippetsCurrent &&
        state.snippetsPageVisible &&
        !state.workspacePageVisible &&
        state.snippetRowCount === 3 &&
        state.snippetExactMatchHintVisible &&
        state.snippetExactMatchHintText.length > 0
      ),
      5000
    );
    assertNoUnsafeDiagnostic(snippetsView.visibleMainText, "Quick snippets page");

    await window.webContents.executeJavaScript(`
      (() => {
        const search = document.querySelector('#snippetSearch');
        search.value = 'meeting   notes';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      (state) => state.snippetSearchValue === "meeting   notes" && state.snippetRowCount === 1,
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const search = document.querySelector('#snippetSearch');
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    const duplicateSnippetIds = await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('[data-snippet-row]')].map((row) => ({
        id: row.dataset.snippetId,
        text: row.textContent
      }))
    `);
    assert.equal(new Set(duplicateSnippetIds.map(({ id }) => id)).size, 3);
    const alphaSnippetId = duplicateSnippetIds.find(({ text }) => text.includes("alpha shortcut"))?.id;
    const betaSnippetId = duplicateSnippetIds.find(({ text }) => text.includes("beta shortcut"))?.id;
    assert.ok(alphaSnippetId && betaSnippetId && alphaSnippetId !== betaSnippetId);

    await window.webContents.executeJavaScript(`
      (() => {
        const row = [...document.querySelectorAll('[data-snippet-row]')]
          .find((item) => item.textContent.includes('alpha shortcut'));
        row.querySelector('[data-personalization-action="edit"]').click();
      })()
    `);
    await window.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
    await window.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
    await window.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
    await window.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
    await waitForState(window, (state) => state.activePersonalizationAction === "save", 5000);
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-personalization-form="snippet"] [data-personalization-action="cancel"]').click()
    `);
    await waitForState(
      window,
      (state) => (
        state.activePersonalizationAction === "edit" &&
        state.activeSnippetRowId === alphaSnippetId
      ),
      5000
    );

    await window.webContents.executeJavaScript(`
      (() => {
        const row = [...document.querySelectorAll('[data-snippet-row]')]
          .find((item) => item.textContent.includes('beta shortcut'));
        row.querySelector('[data-personalization-action="edit"]').click();
        const form = document.querySelector('[data-personalization-form="snippet"]');
        form.querySelector('[name="trigger"]').value = 'beta shortcut revised';
        form.querySelector('[name="text"]').value = 'Beta expansion revised.';
        form.requestSubmit();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        settings.snippets.some((item) => item.id === alphaSnippetId && item.trigger === "alpha shortcut") &&
        settings.snippets.some((item) => item.id === betaSnippetId && item.trigger === "beta shortcut revised") &&
        state.activePersonalizationAction === "edit" &&
        state.activeSnippetRowId === betaSnippetId
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        const row = [...document.querySelectorAll('[data-snippet-row]')]
          .find((item) => item.dataset.snippetId === ${JSON.stringify(betaSnippetId)});
        row.querySelector('[data-personalization-action="delete"]').click();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        settings.snippets.some((item) => item.id === alphaSnippetId) &&
        !settings.snippets.some((item) => item.id === betaSnippetId) &&
        state.activeElementId === "snippetAdd"
      ),
      5000
    );

    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#snippetAdd').click();
        const form = document.querySelector('[data-personalization-form="snippet"]');
        form.querySelector('[name="trigger"]').value = 'daily brief';
        form.querySelector('[name="text"]').value = 'Prepare the daily brief.';
        form.requestSubmit();
      })()
    `);
    await waitForState(
      window,
      (state) => settings.snippets.some((item) => item.trigger === "daily brief") && state.snippetRowCount === 3,
      5000
    );
    const addedSnippet = settings.snippets.find((item) => item.trigger === "daily brief");
    assert.ok(addedSnippet?.id);

    await window.webContents.executeJavaScript(`
      (() => {
        const row = [...document.querySelectorAll('[data-snippet-row]')]
          .find((item) => item.textContent.includes('daily brief'));
        row.querySelector('[data-personalization-action="edit"]').click();
        const form = document.querySelector('[data-personalization-form="snippet"]');
        form.querySelector('[name="trigger"]').value = 'daily summary';
        form.querySelector('[name="text"]').value = 'Prepare the daily summary.';
        form.requestSubmit();
      })()
    `);
    await waitForState(
      window,
      () => settings.snippets.some((item) => item.trigger === "daily summary"),
      5000
    );
    assert.equal(
      settings.snippets.find((item) => item.trigger === "daily summary")?.id,
      addedSnippet.id
    );

    await window.webContents.executeJavaScript(`
      (() => {
        window.__copyAttempts = [];
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText(text) {
              window.__copyAttempts.push(text);
              return Promise.resolve();
            }
          }
        });
        const row = [...document.querySelectorAll('[data-snippet-row]')]
          .find((item) => item.textContent.includes('daily summary'));
        row.querySelector('[data-personalization-action="copy"]').click();
      })()
    `);
    await waitForState(
      window,
      (state) => state.copyAttemptTexts.includes("Prepare the daily summary."),
      5000
    );

    await window.webContents.executeJavaScript(`
      (() => {
        const row = [...document.querySelectorAll('[data-snippet-row]')]
          .find((item) => item.textContent.includes('daily summary'));
        row.querySelector('[data-personalization-action="delete"]').click();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        !settings.snippets.some((item) => item.id === addedSnippet.id) &&
        state.activeElementId === "snippetAdd"
      ),
      5000
    );

    failNextSettingsSave(unsafeDiagnostic);
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#snippetAdd').click();
        const form = document.querySelector('[data-personalization-form="snippet"]');
        form.querySelector('[name="trigger"]').value = 'recoverable snippet';
        form.querySelector('[name="text"]').value = 'Recoverable local expansion.';
        form.requestSubmit();
      })()
    `);
    const failedSnippetSave = await waitForState(
      window,
      (state) => (
        state.snippetStatus.length > 0 &&
        state.visibleMainText.includes("recoverable snippet")
      ),
      5000
    );
    assertNoUnsafeDiagnostic(failedSnippetSave.visibleMainText, "Snippet save failure");
    await window.webContents.executeJavaScript(`
      (() => {
        const row = [...document.querySelectorAll('[data-snippet-row]')]
          .find((item) => item.textContent.includes('recoverable snippet'));
        row.querySelector('[data-personalization-action="delete"]').click();
      })()
    `);
    await waitForState(
      window,
      (state) => !state.visibleMainText.includes("recoverable snippet"),
      5000
    );

    const snippetDraftSave = delayNextSettingsSave();
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#snippetAdd').click();
        const form = document.querySelector('[data-personalization-form="snippet"]');
        form.querySelector('[name="trigger"]').value = 'response anchor snippet';
        form.querySelector('[name="text"]').value = 'Response anchor expansion.';
        form.requestSubmit();
      })()
    `);
    await snippetDraftSave.started;
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#snippetAdd').click();
        const form = document.querySelector('[data-personalization-form="snippet"]');
        const trigger = form.querySelector('[name="trigger"]');
        const text = form.querySelector('[name="text"]');
        trigger.value = 'second snippet draft';
        trigger.dispatchEvent(new Event('input', { bubbles: true }));
        text.value = 'Second unsaved expansion.';
        text.dispatchEvent(new Event('input', { bubbles: true }));
        text.focus();
        text.setSelectionRange(7, 14);
        const search = document.querySelector('#snippetSearch');
        search.value = 'meeting   notes';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.snippetDraftTrigger === "second snippet draft" &&
        state.snippetDraftText === "Second unsaved expansion." &&
        state.activeSelectionStart === 7 &&
        state.activeSelectionEnd === 14
      ),
      5000
    );
    snippetDraftSave.release();
    await waitForState(
      window,
      (state) => (
        settings.snippets.some((item) => item.trigger === "response anchor snippet") &&
        state.snippetDraftTrigger === "second snippet draft" &&
        state.snippetDraftText === "Second unsaved expansion." &&
        state.activeSelectionStart === 7 &&
        state.activeSelectionEnd === 14
      ),
      5000
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-personalization-form="snippet"] [data-personalization-action="cancel"]').click()
    `);
    await waitForState(window, (state) => state.activeElementId === "snippetAdd", 5000);
    await window.webContents.executeJavaScript(`
      (() => {
        const search = document.querySelector('#snippetSearch');
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    const olderSnippetSave = delayNextSettingsSave();
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#snippetAdd').click();
        const form = document.querySelector('[data-personalization-form="snippet"]');
        form.querySelector('[name="trigger"]').value = 'queued first';
        form.querySelector('[name="text"]').value = 'Queued first expansion.';
        form.requestSubmit();
      })()
    `);
    await olderSnippetSave.started;
    const newerSnippetSave = delayNextSettingsSave();
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#snippetAdd').click();
        const form = document.querySelector('[data-personalization-form="snippet"]');
        form.querySelector('[name="trigger"]').value = 'queued second';
        form.querySelector('[name="text"]').value = 'Queued second expansion.';
        form.requestSubmit();
      })()
    `);
    olderSnippetSave.release();
    await newerSnippetSave.started;
    await waitForState(
      window,
      (state) => (
        state.visibleMainText.includes("queued first") &&
        state.visibleMainText.includes("queued second")
      ),
      5000
    );
    newerSnippetSave.release();
    await waitForState(
      window,
      () => (
        settings.snippets.some((item) => item.trigger === "queued first") &&
        settings.snippets.some((item) => item.trigger === "queued second")
      ),
      5000
    );

    await window.webContents.executeJavaScript("document.querySelector('#navSettings').click()");
    await waitForState(window, (state) => state.settingsDrawerOpen, 5000);
    const fullSaveStart = settingsSaveCalls.length;
    await window.webContents.executeJavaScript("document.querySelector('#settingsForm').requestSubmit()");
    await waitForState(window, () => settingsSaveCalls.length > fullSaveStart, 5000);
    const fullSave = settingsSaveCalls.at(-1);
    assert.deepEqual(fullSave.dictionary, settings.dictionary);
    assert.deepEqual(fullSave.snippets, settings.snippets);
    await window.webContents.executeJavaScript("document.querySelector('#manageDictionary').click()");
    await waitForState(
      window,
      (state) => state.dictionaryCurrent && !state.settingsDrawerOpen,
      5000
    );

    await window.webContents.executeJavaScript("document.querySelector('#navHistory').click()");
    await waitForState(
      window,
      (state) => (
        state.historyCurrent &&
        state.globalSearchValue === "设计团队" &&
        state.historySearchValue === "设计团队" &&
        state.selectedHistoryId === selectionBeforePersonalization
      ),
      5000
    );

    await window.webContents.executeJavaScript(`
      (() => {
        const search = document.querySelector('#historySearch');
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#navHistory').click();
      })()
    `);
    const historyView = await waitForState(
      window,
      (state) => (
        state.historyCurrent &&
        !state.homeCurrent &&
        state.activeElementId === "historySearch" &&
        state.historyRowCount === historyFixtures.length
      ),
      5000
    );
    if (historyListCalls !== callsBeforeGlobalSearch) {
      throw new Error("History search requested history instead of reusing the cached projection.");
    }

    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-today-whitespace\"]').click()"
    );
    const whitespaceClickState = await readRendererState(window);
    if (
      whitespaceClickState.selectedHistoryId !== "history-today-newest" ||
      whitespaceClickState.selectedHistoryCount !== 1 ||
      !whitespaceClickState.resultText.includes("Q3 版本迭代计划")
    ) {
      throw new Error("A whitespace-only history row remained clickable.");
    }

    await window.webContents.executeJavaScript(`
      (() => {
        const rows = [...document.querySelectorAll('#historyList [data-history-action="select"]')];
        rows[0].focus();
        rows[0].dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true
        }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.activeHistoryId === "history-today-older" &&
        state.selectedHistoryId === "history-today-older" &&
        state.selectedHistoryCount === 1 &&
        state.selectedHistoryTabIndex === 0 &&
        state.resultText.includes("与设计团队同步登录流程")
      ),
      5000
    );

    const selectedFixture = historyFixtures.find((entry) => entry.id === "history-today-older");
    const selectedFixtureText = selectedFixture.text;
    selectedFixture.text = " \n\t ";
    await window.webContents.executeJavaScript(`
      (() => {
        const language = document.querySelector('#interfaceLanguage');
        language.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-today-newest" &&
        state.selectedHistoryCount === 1 &&
        state.olderHistoryDisabled &&
        state.resultText.includes("Q3 版本迭代计划") &&
        !state.resultText.includes("Design sync")
      ),
      5000
    );

    selectedFixture.text = selectedFixtureText;
    await window.webContents.executeJavaScript(`
      (() => {
        const language = document.querySelector('#interfaceLanguage');
        language.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-today-newest" &&
        !state.olderHistoryDisabled
      ),
      5000
    );

    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-yesterday\"]').click()"
    );
    await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-yesterday" &&
        state.selectedHistoryCount === 1 &&
        state.resultText.includes("本周的用户反馈")
      ),
      5000
    );

    window.setContentSize(780, 600);
    const narrowEditor = await waitForState(
      window,
      (state) => (
        state.viewportWidth <= 780 &&
        state.workspacePane === "editor" &&
        state.editorVisible &&
        !state.historyPaneVisible &&
        state.editorBackVisible
      ),
      5000
    );

    await window.webContents.executeJavaScript("document.querySelector('#editorBack').click()");
    await waitForState(
      window,
      (state) => (
        state.workspacePane === "list" &&
        state.historyPaneVisible &&
        !state.editorVisible
      ),
      5000
    );

    await window.webContents.executeJavaScript(`
      (() => {
        const row = document.querySelector('[data-history-id="history-today-newest"]');
        row.focus();
        row.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true
        }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.workspacePane === "editor" &&
        state.editorVisible &&
        !state.historyPaneVisible &&
        state.activeHistoryId === "history-today-older" &&
        state.selectedHistoryId === "history-today-older" &&
        state.selectedHistoryCount === 1 &&
        state.selectedHistoryTabIndex === 0 &&
        state.resultText.includes("与设计团队同步登录流程")
      ),
      5000
    );
    await window.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
    await window.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
    await waitForState(
      window,
      (state) => (
        state.activeElementId === "editorBack" &&
        state.editorBackVisible &&
        state.editorBackTabIndex === 0
      ),
      5000
    );

    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-today-newest\"]').click()"
    );
    await editSelectedHistory(window, "用户编辑后的文本");
    await waitForState(window, (state) => state.editorSaveState === "saved", 5000);
    assert.deepEqual(historyUpdateCalls.at(-1), {
      id: "history-today-newest",
      text: "用户编辑后的文本"
    });

    await window.webContents.executeJavaScript(`
      (() => {
        window.__copyAttempts = [];
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText(text) {
              window.__copyAttempts.push(text);
              return Promise.resolve();
            }
          }
        });
        document.querySelector('#copyResult').click();
        document.querySelector('#insertResult').click();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.copyAttemptTexts.includes("用户编辑后的文本") &&
        insertTextCalls.at(-1) === "用户编辑后的文本"
      ),
      5000
    );

    const updatesBeforeRestore = historyUpdateCalls.length;
    await editSelectedHistory(window, "尚未保存且应恢复的草稿");
    await window.webContents.executeJavaScript("document.querySelector('#restoreResult').click()");
    await waitForState(
      window,
      (state) => state.resultText === "用户编辑后的文本" && state.editorSaveState === "saved",
      5000
    );
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(historyUpdateCalls.length, updatesBeforeRestore + 1);
    assert.deepEqual(historyUpdateCalls.at(-1), {
      id: "history-today-newest",
      text: "用户编辑后的文本"
    });

    historyUpdateResult = {
      ok: false,
      reason: "save_failed",
      message: unsafeDiagnostic
    };
    await editSelectedHistory(window, "保存失败仍保留的文本");
    const saveFailureState = await waitForState(
      window,
      (state) => state.editorSaveState === "error" && state.resultText === "保存失败仍保留的文本",
      5000
    );
    assertNoUnsafeDiagnostic(saveFailureState.visibleMainText, "History save failure");

    const historyCallsBeforeFailedSaveRefresh = historyListCalls;
    await window.webContents.executeJavaScript(`
      (() => {
        const language = document.querySelector('#interfaceLanguage');
        language.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await waitForState(
      window,
      () => historyListCalls > historyCallsBeforeFailedSaveRefresh,
      5000
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const failedSaveRefreshState = await readRendererState(window);
    assert.equal(failedSaveRefreshState.editorSaveState, "error");
    assert.equal(failedSaveRefreshState.resultText, "保存失败仍保留的文本");

    await editSelectedHistory(window, "保存重试后的文本");
    await waitForState(window, (state) => state.editorSaveState === "saved", 5000);

    const updatesBeforeSelectionFlush = historyUpdateCalls.length;
    await editSelectedHistory(window, "切换前刷新的文本");
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-yesterday\"]').click()"
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(historyUpdateCalls.length, updatesBeforeSelectionFlush + 1);
    assert.deepEqual(historyUpdateCalls.at(-1), {
      id: "history-today-newest",
      text: "切换前刷新的文本"
    });
    await waitForState(
      window,
      (state) => state.selectedHistoryId === "history-yesterday",
      5000
    );

    insertTextResult = {
      ok: false,
      reason: "paste_failed",
      message: unsafeDiagnostic
    };
    const textBeforeFailedInsert = (await readRendererState(window)).resultText;
    await window.webContents.executeJavaScript("document.querySelector('#insertResult').click()");
    const failedInsertState = await waitForState(
      window,
      (state) => insertTextCalls.at(-1) === textBeforeFailedInsert && state.resultText === textBeforeFailedInsert,
      5000
    );
    assertNoUnsafeDiagnostic(failedInsertState.visibleMainText, "History insert failure");
    insertTextResult = { ok: true };

    const orderBeforeReprocess = interactionOrder.length;
    await editSelectedHistory(window, "重新处理前必须保存的文本");
    await window.webContents.executeJavaScript("document.querySelector('#reprocessResult').click()");
    const reprocessedState = await waitForState(
      window,
      (state) => (
        state.resultText === "重新处理后的文本" &&
        state.editorSaveState === "saved" &&
        state.reprocessState === "idle"
      ),
      5000
    );
    const reprocessOrder = interactionOrder.slice(orderBeforeReprocess);
    assert.deepEqual(reprocessOrder.slice(0, 2), [
      "update:history-yesterday:重新处理前必须保存的文本",
      "reprocess:history-yesterday"
    ]);
    assert.equal(historyReprocessCalls.at(-1), "history-yesterday");
    assertNoUnsafeDiagnostic(reprocessedState.visibleMainText, "Successful history reprocess");

    historyReprocessResult = {
      ok: false,
      reason: "processing_failed",
      message: unsafeDiagnostic
    };
    await editSelectedHistory(window, "重新处理失败时保留的文本");
    await waitForState(window, (state) => state.editorSaveState === "saved", 5000);
    await window.webContents.executeJavaScript("document.querySelector('#reprocessResult').click()");
    const failedReprocessState = await waitForState(
      window,
      (state) => (
        state.reprocessState === "error" &&
        state.resultText === "重新处理失败时保留的文本"
      ),
      5000
    );
    assertNoUnsafeDiagnostic(failedReprocessState.visibleMainText, "Failed history reprocess");

    const delayedReprocessText = "A 延迟重处理结果";
    const delayedReprocess = delayNextHistoryReprocess({
      ok: true,
      entry: {
        ...historyFixtures.find((entry) => entry.id === "history-yesterday"),
        id: "history-yesterday",
        text: delayedReprocessText,
        status: "complete",
        processingError: ""
      }
    });
    await window.webContents.executeJavaScript("document.querySelector('#reprocessResult').click()");
    await delayedReprocess.started;
    const historyOlderText = historyFixtures.find((entry) => entry.id === "history-older").text;
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-older\"]').click()"
    );
    await waitForState(
      window,
      (state) => state.selectedHistoryId === "history-older" && state.resultText === historyOlderText,
      5000
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-yesterday\"]').click()"
    );
    await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-yesterday" &&
        state.reprocessState === "running"
      ),
      5000
    );
    delayedReprocess.release();
    await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-yesterday" &&
        state.resultText === delayedReprocessText &&
        state.reprocessState === "idle"
      ),
      5000
    );
    assert.equal(historyFixtures.find((entry) => entry.id === "history-older").text, historyOlderText);

    const delayedReprocessFailure = delayNextHistoryReprocess({
      ok: false,
      reason: "processing_failed",
      message: unsafeDiagnostic
    });
    await window.webContents.executeJavaScript("document.querySelector('#reprocessResult').click()");
    await delayedReprocessFailure.started;
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-older\"]').click()"
    );
    await waitForState(window, (state) => state.selectedHistoryId === "history-older", 5000);
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-yesterday\"]').click()"
    );
    await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-yesterday" &&
        state.reprocessState === "running"
      ),
      5000
    );
    delayedReprocessFailure.release();
    await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-yesterday" &&
        state.resultText === delayedReprocessText &&
        state.reprocessState === "error"
      ),
      5000
    );

    const localEditDuringReprocess = "切回 A 后输入的本地草稿";
    const delayedEditedReprocess = delayNextHistoryReprocess({
      ok: true,
      entry: {
        ...historyFixtures.find((entry) => entry.id === "history-yesterday"),
        id: "history-yesterday",
        text: "不应覆盖本地草稿的重处理结果",
        status: "complete",
        processingError: ""
      }
    });
    await window.webContents.executeJavaScript("document.querySelector('#reprocessResult').click()");
    await delayedEditedReprocess.started;
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-older\"]').click()"
    );
    await waitForState(window, (state) => state.selectedHistoryId === "history-older", 5000);
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-yesterday\"]').click()"
    );
    await waitForState(window, (state) => state.reprocessState === "running", 5000);
    await editSelectedHistory(window, localEditDuringReprocess);
    delayedEditedReprocess.release();
    await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-yesterday" &&
        state.resultText === localEditDuringReprocess &&
        state.reprocessState !== "running" &&
        state.editorSaveState === "saved"
      ),
      5000
    );
    await waitForState(
      window,
      () => historyFixtures.find((entry) => entry.id === "history-yesterday").text === localEditDuringReprocess,
      5000
    );
    assert.deepEqual(historyUpdateCalls.at(-1), {
      id: "history-yesterday",
      text: localEditDuringReprocess
    });

    const localEditDuringFailedReprocess = "失败返回前切回 A 输入的本地草稿";
    const delayedEditedReprocessFailure = delayNextHistoryReprocess({
      ok: false,
      reason: "processing_failed",
      message: unsafeDiagnostic
    });
    await window.webContents.executeJavaScript("document.querySelector('#reprocessResult').click()");
    await delayedEditedReprocessFailure.started;
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-older\"]').click()"
    );
    await waitForState(window, (state) => state.selectedHistoryId === "history-older", 5000);
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-yesterday\"]').click()"
    );
    await waitForState(window, (state) => state.reprocessState === "running", 5000);
    await editSelectedHistory(window, localEditDuringFailedReprocess);
    delayedEditedReprocessFailure.release();
    const editedFailedReprocessState = await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-yesterday" &&
        state.resultText === localEditDuringFailedReprocess &&
        state.reprocessState === "error" &&
        state.editorSaveState === "saved"
      ),
      5000
    );
    await waitForState(
      window,
      () => (
        historyFixtures.find((entry) => entry.id === "history-yesterday").text
          === localEditDuringFailedReprocess
      ),
      5000
    );
    assertNoUnsafeDiagnostic(editedFailedReprocessState.visibleMainText, "Edited failed reprocess");

    const restoreBaseline = delayedReprocessText;
    await editSelectedHistory(window, restoreBaseline);
    await waitForState(window, (state) => state.editorSaveState === "saved", 5000);
    const updatesBeforeInFlightRestore = historyUpdateCalls.length;
    const inFlightRestoreSave = delayNextHistoryUpdate();
    await editSelectedHistory(window, "恢复前已开始写入的旧草稿");
    await inFlightRestoreSave.started;
    queueHistoryUpdateResult({ ok: false, reason: "save_failed", message: unsafeDiagnostic });
    await window.webContents.executeJavaScript("document.querySelector('#restoreResult').click()");
    inFlightRestoreSave.release();
    await waitForState(
      window,
      () => historyUpdateCalls.length >= updatesBeforeInFlightRestore + 2,
      5000
    );
    const firstFailedRestoreState = await waitForState(
      window,
      (state) => state.resultText === restoreBaseline && state.editorSaveState === "error",
      5000
    );
    assert.equal(
      historyFixtures.find((entry) => entry.id === "history-yesterday").text,
      "恢复前已开始写入的旧草稿"
    );
    assert.deepEqual(
      historyUpdateCalls.slice(updatesBeforeInFlightRestore).map((call) => call.text),
      ["恢复前已开始写入的旧草稿", restoreBaseline]
    );
    assertNoUnsafeDiagnostic(firstFailedRestoreState.visibleMainText, "Failed in-flight restore");

    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-older\"]').click()"
    );
    await waitForState(window, (state) => state.selectedHistoryId === "history-older", 5000);
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-yesterday\"]').click()"
    );
    await waitForState(
      window,
      (state) => (
        state.resultText === restoreBaseline &&
        state.editorSaveState === "error"
      ),
      5000
    );

    queueHistoryUpdateResult({ ok: false, reason: "save_failed", message: unsafeDiagnostic });
    await window.webContents.executeJavaScript("document.querySelector('#restoreResult').click()");
    const secondFailedRestoreState = await waitForState(
      window,
      (state) => (
        historyUpdateCalls.length >= updatesBeforeInFlightRestore + 3 &&
        state.resultText === restoreBaseline &&
        state.editorSaveState === "error"
      ),
      5000
    );
    assert.equal(
      historyFixtures.find((entry) => entry.id === "history-yesterday").text,
      "恢复前已开始写入的旧草稿"
    );
    assert.equal(historyUpdateCalls.at(-1).text, restoreBaseline);
    assertNoUnsafeDiagnostic(secondFailedRestoreState.visibleMainText, "Retried failed restore");

    await window.webContents.executeJavaScript("document.querySelector('#restoreResult').click()");
    const recoveredRestoreState = await waitForState(
      window,
      (state) => (
        historyUpdateCalls.length >= updatesBeforeInFlightRestore + 4 &&
        state.resultText === restoreBaseline &&
        state.editorSaveState === "saved"
      ),
      5000
    );
    assert.equal(historyFixtures.find((entry) => entry.id === "history-yesterday").text, restoreBaseline);
    assert.deepEqual(
      historyUpdateCalls.slice(updatesBeforeInFlightRestore).map((call) => call.text),
      ["恢复前已开始写入的旧草稿", restoreBaseline, restoreBaseline, restoreBaseline]
    );
    assertNoUnsafeDiagnostic(recoveredRestoreState.visibleMainText, "Recovered restore");

    const saveBGate = delayNextHistoryUpdate();
    await editSelectedHistory(window, "最近成功保存 B");
    await saveBGate.started;
    queueHistoryUpdateResult({ ok: false, reason: "save_failed", message: unsafeDiagnostic });
    await editSelectedHistory(window, "较新但保存失败 C");
    saveBGate.release();
    await waitForState(
      window,
      (state) => state.resultText === "较新但保存失败 C" && state.editorSaveState === "error",
      5000
    );
    await window.webContents.executeJavaScript("document.querySelector('#restoreResult').click()");
    const restoredToLatestCommit = await waitForState(
      window,
      (state) => state.resultText === "最近成功保存 B" && state.editorSaveState === "saved",
      5000
    );
    await waitForState(
      window,
      () => historyFixtures.find((entry) => entry.id === "history-yesterday").text === "最近成功保存 B",
      5000
    );
    assertNoUnsafeDiagnostic(restoredToLatestCommit.visibleMainText, "Latest successful baseline restore");

    const refreshOne = delayNextHistoryList();
    await window.webContents.executeJavaScript(
      "document.querySelector('#interfaceLanguage').dispatchEvent(new Event('change', { bubbles: true }))"
    );
    await refreshOne.started;
    const refreshTwo = delayNextHistoryList();
    await window.webContents.executeJavaScript(
      "document.querySelector('#interfaceLanguage').dispatchEvent(new Event('change', { bubbles: true }))"
    );
    await refreshTwo.started;
    queueHistoryUpdateResult({ ok: false, reason: "save_failed", message: unsafeDiagnostic });
    await editSelectedHistory(window, "刷新等待期间失败并保留的草稿");
    await waitForState(
      window,
      (state) => state.resultText === "刷新等待期间失败并保留的草稿" && state.editorSaveState === "error",
      5000
    );
    refreshTwo.release();
    refreshOne.release();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const refreshRaceState = await readRendererState(window);
    assert.equal(refreshRaceState.resultText, "刷新等待期间失败并保留的草稿");
    assert.equal(refreshRaceState.editorSaveState, "error");
    assertNoUnsafeDiagnostic(refreshRaceState.visibleMainText, "Refresh race");

    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-older\"]').click()"
    );
    await waitForState(window, (state) => state.selectedHistoryId === "history-older", 5000);
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-yesterday\"]').click()"
    );
    const failedDraftAfterSelection = await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-yesterday" &&
        state.resultText === "刷新等待期间失败并保留的草稿" &&
        state.editorSaveState === "error"
      ),
      5000
    );
    assertNoUnsafeDiagnostic(failedDraftAfterSelection.visibleMainText, "Failed draft after selection");

    await window.webContents.executeJavaScript("document.querySelector('#navHome').click()");
    await waitForState(window, (state) => state.homeCurrent, 5000);
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#navHistory').click();
        document.querySelector('[data-history-id="history-yesterday"]').click();
      })()
    `);
    const failedDraftAfterHome = await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-yesterday" &&
        state.resultText === "刷新等待期间失败并保留的草稿" &&
        state.editorSaveState === "error"
      ),
      5000
    );
    assertNoUnsafeDiagnostic(failedDraftAfterHome.visibleMainText, "Failed draft after Home");

    const multilineText = "  alpha\nβ😀\ngamma\ndelta  ";
    await editSelectedHistoryWithBlocks(window);
    await waitForState(
      window,
      () => historyUpdateCalls.at(-1)?.text === multilineText,
      5000
    );
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('#copyResult').click();
        document.querySelector('#insertResult').click();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.copyAttemptTexts.at(-1) === multilineText &&
        insertTextCalls.at(-1) === multilineText
      ),
      5000
    );

    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-english\"]').click()"
    );
    await waitForState(window, (state) => state.selectedHistoryId === "history-english", 5000);
    await editSelectedHistory(window, "\u00a0\u3000\n\t");
    const blankSaveState = await waitForState(
      window,
      (state) => (
        state.englishHistoryDisabled &&
        !state.englishHistorySelected &&
        state.englishHistoryTabIndex === -1 &&
        state.selectedHistoryCount <= 1 &&
        state.selectedHistoryId !== "history-english"
      ),
      5000
    );
    assertNoUnsafeDiagnostic(blankSaveState.visibleMainText, "Unicode blank save");

    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-failed-recoverable\"]').click()"
    );
    const recoverableFailureState = await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-failed-recoverable" &&
        state.resultText === "Recoverable original transcript" &&
        !state.reprocessDisabled &&
        state.editorContextText.length > 0
      ),
      5000
    );
    assertNoUnsafeDiagnostic(recoverableFailureState.visibleMainText, "Recoverable failed history");

    await window.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-failed\"]').click()"
    );
    const unrecoverableFailureState = await waitForState(
      window,
      (state) => (
        state.selectedHistoryId === "history-failed" &&
        state.resultText === "" &&
        state.reprocessDisabled &&
        state.editorContextText.length > 0
      ),
      5000
    );
    assertNoUnsafeDiagnostic(unrecoverableFailureState.visibleMainText, "Unrecoverable failed history");

    await window.webContents.executeJavaScript(`
      (() => {
        const trigger = document.querySelector('#navSettings');
        trigger.focus();
        trigger.click();
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.settingsDrawerOpen === true &&
        !state.settingsDrawerAriaHidden &&
        !state.settingsDrawerInert &&
        state.activeElementId === "closeSettings"
      ),
      5000
    );
    await window.webContents.executeJavaScript("document.querySelector('#closeSettings').click()");
    const restoredFocus = await waitForState(
      window,
      (state) => (
        state.settingsDrawerOpen === false &&
        state.settingsDrawerAriaHidden &&
        state.settingsDrawerInert &&
        state.activeElementId === "navSettings"
      ),
      5000
    );

    window.webContents.send("settings:open");
    await waitForState(window, (state) => state.settingsDrawerOpen === true, 5000);
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector('[data-settings-section="shortcuts"]').click();
        document.querySelector('#recordHotkey').click();
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'k',
          code: 'KeyK',
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true
        }));
        document.querySelector('#recordPasteLastHotkey').click();
        window.dispatchEvent(new MouseEvent('mousedown', {
          button: 3,
          bubbles: true,
          cancelable: true
        }));
      })()
    `);
    await waitForState(
      window,
      (state) => (
        state.hotkeyValue === "CommandOrControl+Alt+K" &&
        state.pasteLastHotkeyValue === "Mouse4"
      ),
      5000
    );
    await window.webContents.executeJavaScript("document.querySelector('#closeSettings').click()");
    await waitForState(window, (state) => state.settingsDrawerOpen === false, 5000);

    assertNoUnsafeDiagnostic(restoredFocus.visibleMainText, "Final main text");
    const focusContainmentWarnings = rendererMessages.filter((item) => (
      item.level >= 2 && isFocusContainmentWarning(item.message)
    ));
    if (focusContainmentWarnings.length !== 0) {
      throw new Error(`Settings lifecycle emitted focus containment warnings.`);
    }
    const errors = rendererMessages.filter((item) => item.level >= 3);
    if (errors.length) {
      throw new Error(`Renderer emitted console errors: ${errors.map((item) => item.message).join(" | ")}`);
    }

    console.log(JSON.stringify({
      ok: true,
      smokeKind,
      defaultLanguage: initial.interfaceLanguage,
      historyGroups: initial.historyGroupCount,
      cachedHistoryCalls: historyListCalls,
      narrowPane: narrowEditor.workspacePane,
      selectedHistoryId: restoredFocus.selectedHistoryId,
      focusRestoredTo: restoredFocus.activeElementId
    }, null, 2));
    clearTimeout(timeout);
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.stack : String(error),
      state: await readRendererState(window).catch(() => null),
      rendererMessages
    }, null, 2));
    clearTimeout(timeout);
    window.destroy();
    app.exit(1);
  }
});

async function waitForState(window, predicate, timeoutMs) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readRendererState(window);
    if (predicate(lastState)) return lastState;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for renderer state. Last state: ${JSON.stringify(lastState)}`);
}

function readRendererState(window) {
  return window.webContents.executeJavaScript(`
    (() => {
      const isVisible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const rect = (selector) => {
        const value = document.querySelector(selector)?.getBoundingClientRect();
        return value ? {
          left: value.left,
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          width: value.width,
          height: value.height
        } : null;
      };
      return {
        ready: Boolean(window.localFlow && document.querySelector('#recordButton')),
        hasLanguageControls: Boolean(document.querySelector('#languageControls')),
        hasVoiceCommandBar: Boolean(document.querySelector('#commandStrip')),
        hasResultText: Boolean(document.querySelector('#resultText')),
        hasRecentHistoryList: Boolean(document.querySelector('#historyList')),
        hasFooterHealthText: Boolean(document.querySelector('#headerHealthText')),
        hasRecordButton: Boolean(document.querySelector('#recordButton')),
        visibleRecordRecoveryCount: document.querySelectorAll('#recordRecovery:not([hidden])').length,
        recordRecoveryActionText: document.querySelector('#recordRecoveryAction')?.textContent?.trim() || '',
        mainSetupControlCount: document.querySelector('main')?.querySelectorAll(
          '#setupChecklist, #installWhisper, #installLlm, #setupOutput'
        ).length || 0,
        interfaceLanguage: document.querySelector('#interfaceLanguage')?.value || '',
        interfaceLanguageOptions: [...(document.querySelector('#interfaceLanguage')?.options || [])]
          .map((option) => option.value),
        homeCurrent: document.querySelector('#navHome')?.getAttribute('aria-current') === 'page',
        historyCurrent: document.querySelector('#navHistory')?.getAttribute('aria-current') === 'page',
        dictionaryCurrent: document.querySelector('#navDictionary')?.getAttribute('aria-current') === 'page',
        snippetsCurrent: document.querySelector('#navSnippets')?.getAttribute('aria-current') === 'page',
        primaryNavigationCount: document.querySelectorAll('#appSidebar .nav-item').length,
        enabledPrimaryNavigationCount: document.querySelectorAll('#appSidebar .nav-item:not(:disabled)').length,
        commandStripVisible: isVisible(document.querySelector('#commandStrip')),
        recordButtonVisible: isVisible(document.querySelector('#recordButton')),
        commandStripRect: rect('#commandStrip'),
        recordButtonRect: rect('#recordButton'),
        globalSearchValue: document.querySelector('#globalSearch')?.value || '',
        historySearchValue: document.querySelector('#historySearch')?.value || '',
        historyGroupCount: document.querySelectorAll('#historyList [data-history-group]').length,
        historyRowCount: document.querySelectorAll('#historyList [data-history-action="select"]').length,
        selectedHistoryCount: document.querySelectorAll('#historyList [aria-selected="true"]').length,
        selectedHistoryId: document.querySelector('#historyList [aria-selected="true"]')?.dataset.historyId || '',
        selectedHistoryTabIndex: document.querySelector('#historyList [aria-selected="true"]')?.tabIndex ?? -1,
        whitespaceHistoryDisabled:
          document.querySelector('[data-history-id="history-today-whitespace"]')?.disabled ?? false,
        whitespaceHistorySelected:
          document.querySelector('[data-history-id="history-today-whitespace"]')?.getAttribute('aria-selected') === 'true',
        whitespaceHistoryTabIndex:
          document.querySelector('[data-history-id="history-today-whitespace"]')?.tabIndex ?? -1,
        olderHistoryDisabled:
          document.querySelector('[data-history-id="history-today-older"]')?.disabled ?? false,
        englishHistoryDisabled:
          document.querySelector('[data-history-id="history-english"]')?.disabled ?? false,
        englishHistorySelected:
          document.querySelector('[data-history-id="history-english"]')?.getAttribute('aria-selected') === 'true',
        englishHistoryTabIndex:
          document.querySelector('[data-history-id="history-english"]')?.tabIndex ?? -1,
        activeHistoryId: document.activeElement?.dataset?.historyId || '',
        resultText: document.querySelector('#resultText')?.textContent || '',
        editorSaveState: document.querySelector('#editorSaveState')?.dataset?.state || '',
        reprocessState: document.querySelector('#reprocessResult')?.dataset?.state || '',
        reprocessDisabled: document.querySelector('#reprocessResult')?.disabled ?? true,
        editorContextText: document.querySelector('#editorContextText')?.textContent?.trim() || '',
        statusText: document.querySelector('#statusText')?.textContent || '',
        copyAttemptTexts: window.__copyAttempts || [],
        workspacePane: document.body.dataset.workspacePane || '',
        historyPaneVisible: isVisible(document.querySelector('#historyPane')),
        editorVisible: isVisible(document.querySelector('#editorPane')),
        editorBackVisible: isVisible(document.querySelector('#editorBack')),
        editorBackTabIndex: document.querySelector('#editorBack')?.tabIndex ?? -1,
        workspacePageVisible: isVisible(document.querySelector('#workspacePage')),
        dictionaryPageVisible: isVisible(document.querySelector('#dictionaryPage')),
        snippetsPageVisible: isVisible(document.querySelector('#snippetsPage')),
        dictionaryRowCount: document.querySelectorAll('[data-dictionary-row]').length,
        snippetRowCount: document.querySelectorAll('[data-snippet-row]').length,
        snippetRowIds: [...document.querySelectorAll('[data-snippet-row]')]
          .map((row) => row.dataset.snippetId),
        dictionarySearchValue: document.querySelector('#dictionarySearch')?.value || '',
        snippetSearchValue: document.querySelector('#snippetSearch')?.value || '',
        snippetExactMatchHintVisible: isVisible(document.querySelector('#snippetExactMatchHint')),
        snippetExactMatchHintText: document.querySelector('#snippetExactMatchHint')?.textContent?.trim() || '',
        dictionaryDraftValue:
          document.querySelector('[data-personalization-form="dictionary"] [name="term"]')?.value || '',
        snippetDraftTrigger:
          document.querySelector('[data-personalization-form="snippet"] [name="trigger"]')?.value || '',
        snippetDraftText:
          document.querySelector('[data-personalization-form="snippet"] [name="text"]')?.value || '',
        activePersonalizationAction: document.activeElement?.dataset?.personalizationAction || '',
        activePersonalizationValue: document.activeElement?.dataset?.personalizationValue || '',
        activeSnippetRowId: document.activeElement?.closest?.('[data-snippet-row]')?.dataset.snippetId || '',
        activeDictionaryRowIndex:
          document.activeElement?.closest?.('[data-dictionary-row]')?.dataset.index || '',
        activeSelectionStart: Number.isInteger(document.activeElement?.selectionStart)
          ? document.activeElement.selectionStart
          : -1,
        activeSelectionEnd: Number.isInteger(document.activeElement?.selectionEnd)
          ? document.activeElement.selectionEnd
          : -1,
        dictionaryStatus: document.querySelector('#dictionaryStatus')?.textContent?.trim() || '',
        snippetStatus: document.querySelector('#snippetStatus')?.textContent?.trim() || '',
        settingsDrawerOpen: document.querySelector('#settingsDrawer')?.classList.contains('open') || false,
        settingsDrawerAriaHidden: document.querySelector('#settingsDrawer')?.getAttribute('aria-hidden') === 'true',
        settingsDrawerInert: Boolean(document.querySelector('#settingsDrawer')?.inert),
        launchAtLogin: document.querySelector('#launchAtLogin')?.checked ?? null,
        startMinimizedToTray: document.querySelector('#startMinimizedToTray')?.checked ?? null,
        globalShortcutPaused: document.querySelector('#globalShortcutPaused')?.checked ?? null,
        hotkeyValue: document.querySelector('#hotkey')?.value || '',
        pasteLastHotkeyValue: document.querySelector('#pasteLastHotkey')?.value || '',
        activeElementId: document.activeElement?.id || '',
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        visibleMainText: document.querySelector('main')?.innerText || ''
      };
    })()
  `);
}

function editSelectedHistory(window, text) {
  return window.webContents.executeJavaScript(`
    (() => {
      const editor = document.querySelector('#resultText');
      editor.textContent = ${JSON.stringify(text)};
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText'
      }));
    })()
  `);
}

function editSelectedHistoryWithBlocks(window) {
  return window.webContents.executeJavaScript(`
    (() => {
      const editor = document.querySelector('#resultText');
      const first = document.createTextNode('  alpha');
      const second = document.createElement('div');
      second.append(document.createTextNode('β😀'));
      const third = document.createElement('div');
      third.append(
        document.createTextNode('gamma'),
        document.createElement('br'),
        document.createTextNode('delta  ')
      );
      editor.replaceChildren(first, second, third);
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertFromPaste'
      }));
    })()
  `);
}

function assertRectInsideViewport(rect, state, label) {
  const roundingTolerance = 1;
  if (
    !rect ||
    rect.left < -roundingTolerance ||
    rect.top < -roundingTolerance ||
    rect.right > state.viewportWidth + roundingTolerance ||
    rect.bottom > state.viewportHeight + roundingTolerance ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new Error(`${label} is outside the ${state.viewportWidth}x${state.viewportHeight} viewport.`);
  }
}

function assertNoUnsafeDiagnostic(text, label) {
  const leak = /3221225477|[A-Za-z]:[\\/]|https?:\/\/|\bspawn\b|\bENOENT\b|\bstderr\b|\.exe\b|\.gguf\b/i.exec(
    String(text || "")
  );
  if (leak) {
    throw new Error(`${label} leaked unsafe diagnostics: ${leak[0]}`);
  }
}

function isFocusContainmentWarning(message) {
  return /Blocked aria-hidden|focused element must not be hidden|inert.*focus/i.test(String(message || ""));
}
