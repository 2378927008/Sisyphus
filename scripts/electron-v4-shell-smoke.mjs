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
const unsafeDiagnostic = "3221225477 spawn C:\\private\\provider-helper.exe ENOENT stderr";
const smokeKind = "v4-shell";
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
let historyListCalls = 0;
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
    text: ""
  }
];

const setupStatus = {
  assets: {
    whisper: {
      ready: true,
      whisperCliPath: settings.whisperCliPath,
      whisperModelPath: settings.whisperModelPath
    },
    llm: {
      ready: false,
      runtimeReady: false,
      modelReady: false
    }
  },
  setups: {
    whisper: { type: "whisper", status: "idle", output: [], error: "" },
    llm: { type: "llm", status: "idle", output: [], error: "" }
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
  registerSmokeIpcHandler("settings:save", (_event, next) => {
    settings = mergeSettings(next, settings);
    return settings;
  });
  registerSmokeIpcHandler("history:list", () => {
    historyListCalls += 1;
    return historyFixtures;
  });
  registerSmokeIpcHandler("history:update", (_event, payload = {}) => ({
    ok: true,
    entry: { id: payload.id, text: payload.text, status: "complete" }
  }));
  registerSmokeIpcHandler("history:reprocess", (_event, id) => ({
    ok: true,
    entry: { id, text: "reprocessed smoke transcript", status: "complete" }
  }));
  registerSmokeIpcHandler("dictation:insert-text", () => ({ ok: true }));
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
    type,
    status: "complete",
    output: [],
    error: "",
    assets: setupStatus.assets
  }));
  registerSmokeIpcHandler("models:setup-cancel", (_event, type) => ({
    type,
    status: "cancelled",
    output: [],
    error: "",
    assets: setupStatus.assets
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
  configureMediaPermissions(session.defaultSession);
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
        activeHistoryId: document.activeElement?.dataset?.historyId || '',
        resultText: document.querySelector('#resultText')?.textContent || '',
        workspacePane: document.body.dataset.workspacePane || '',
        historyPaneVisible: isVisible(document.querySelector('#historyPane')),
        editorVisible: isVisible(document.querySelector('#editorPane')),
        editorBackVisible: isVisible(document.querySelector('#editorBack')),
        editorBackTabIndex: document.querySelector('#editorBack')?.tabIndex ?? -1,
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
