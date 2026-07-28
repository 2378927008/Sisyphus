import { app, BrowserWindow, ipcMain, session } from "electron";
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyElectronRuntimeSwitches } from "../src/main/electron-runtime.js";
import { buildHudWindowOptions } from "../src/main/hud-window.js";
import { configureMediaPermissions } from "../src/main/media-permissions.js";
import { getProcessingProviderStatus } from "../src/main/provider-registry.js";
import { defaultSettings, mergeSettings } from "../src/main/settings-store.js";
import {
  appSmokeFixtureSettings,
  createAppSmokeHistoryFixtures
} from "./electron-app-smoke-fixtures.mjs";
import {
  measureFocusRingCoverage,
  validateHudVisualState
} from "./visual-regression-assertions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const htmlPath = path.join(projectRoot, "src", "renderer", "index.html");
const hudHtmlPath = path.join(projectRoot, "src", "renderer", "hud.html");
const preloadPath = path.join(projectRoot, "src", "preload.cjs");
const hudPreloadPath = path.join(projectRoot, "src", "hud-preload.cjs");
const referencePath = path.join(projectRoot, "docs", "design", "local-flow-windows-ui-v4-fusion.png");
const outputDir = path.join(projectRoot, ".tmp", "ui-v4-visual");
const visualViewports = [
  { "width": 1180, "height": 800, "state": "desktop-split" },
  { "width": 980, "height": 720, "state": "compact-split" },
  { "width": 780, "height": 600, "state": "master-detail" }
];
const expectedArtifacts = [
  "desktop-split.png",
  "compact-split.png",
  "master-detail-list.png",
  "master-detail-editor.png",
  "reference-comparison.png"
];
const expectedRecordingRegionIds = [
  "hudWaveform",
  "hudTitle",
  "hudMessage",
  "hudTimer",
  "hudCancel",
  "hudStop"
];
const expectedWarningRegionIds = [
  "hudWaveform",
  "hudTitle",
  "hudMessage",
  "hudOpenMain"
];
const smokeIpcChannels = [
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
const referenceEditorText = [
  "关于 Q3 版本迭代计划的会议纪要整理如下，包含目标、范围、资源与时间安排四个部分。",
  "目标方面，我们希望通过本次迭代提升用户关键路径的完成率，并把页面加载时间控制在合理范围。",
  "范围方面，优先推进智能推荐、数据看板配置与权限协作流程，不纳入移动端的大改动。",
  "资源方面，研发团队增加两名前端工程师，产品与设计各增加一人，测试资源保持不变。",
  "下一步行动：整理详细任务清单并分配到人，明天上午再次同步。"
].join("\n\n");

let settings = mergeSettings({
  ...defaultSettings,
  ...appSmokeFixtureSettings
});
const historyFixtures = createAppSmokeHistoryFixtures();
const historyUpdateCalls = [];
const insertTextCalls = [];
const rendererMessages = [];
const visualMeasurements = [];
const focusCaptures = [];
const hudStates = [];
const windows = new Set();

app.setPath("userData", path.join(outputDir, "electron-profile"));
applyElectronRuntimeSwitches(app);
app.commandLine.appendSwitch("force-device-scale-factor", "1");

const timeout = setTimeout(() => {
  console.error("Visual smoke test timed out.");
  closeWindowsAndExit(2);
}, 60000);

app.whenReady().then(runVisualSmoke);

async function runVisualSmoke() {
  try {
    await mkdir(outputDir, { recursive: true });
    configureMediaPermissions(session.defaultSession);
    wireIpc();

    const mainWindow = createWindow(visualViewports[0], preloadPath);
    observeRendererConsole(mainWindow, "main");
    await mainWindow.loadFile(htmlPath);
    await waitForMainReady(mainWindow);
    await installClipboardProbe(mainWindow);
    await prepareReferenceEditor(mainWindow);

    const hudImage = await captureRecordingHud();
    await setViewport(mainWindow, visualViewports[0]);
    await assertVisualState(mainWindow, {
      state: "desktop-split",
      expectedPane: "split",
      expectedWidth: 1180,
      expectedHeight: 800,
      expectedEditorActionRows: 1
    });
    const desktopImage = await captureDesktopWithHud(mainWindow, hudImage, {
      focusTarget: "#resultText",
      focusTreatment: "#resultEditor",
      focusLabel: "desktop editor"
    });
    await writeCapture("desktop-split.png", desktopImage, visualViewports[0]);

    await setViewport(mainWindow, visualViewports[1]);
    await assertVisualState(mainWindow, {
      state: "compact-split",
      expectedPane: "split",
      expectedWidth: 980,
      expectedHeight: 720
    });
    await writeCapture(
      "compact-split.png",
      await captureChecked(mainWindow, "compact split", {
        focusTarget: "#historySearch",
        focusLabel: "compact history search"
      }),
      visualViewports[1]
    );

    await setViewport(mainWindow, visualViewports[2]);
    await mainWindow.webContents.executeJavaScript("document.querySelector('#navHistory').click()");
    await waitForRenderer(
      mainWindow,
      () => readVisualState(mainWindow),
      (state) => state.workspacePane === "list" && state.historyPaneVisible && !state.editorPaneVisible
    );
    await assertVisualState(mainWindow, {
      state: "master-detail-list",
      expectedPane: "list",
      expectedWidth: 780,
      expectedHeight: 600,
      expectedMaxRecordButtonHeight: 54
    });
    await writeCapture(
      "master-detail-list.png",
      await captureChecked(mainWindow, "master detail list", {
        focusTarget: "#historySearch",
        focusLabel: "master list search"
      }),
      visualViewports[2]
    );

    await mainWindow.webContents.executeJavaScript(
      "document.querySelector('[data-history-id=\"history-zh\"]').click()"
    );
    await waitForRenderer(
      mainWindow,
      () => readVisualState(mainWindow),
      (state) => state.workspacePane === "editor" && state.editorPaneVisible && !state.historyPaneVisible
    );
    await assertVisualState(mainWindow, {
      state: "master-detail-editor",
      expectedPane: "editor",
      expectedWidth: 780,
      expectedHeight: 600,
      expectedMaxRecordButtonHeight: 54
    });
    await writeCapture(
      "master-detail-editor.png",
      await captureChecked(mainWindow, "master detail editor", {
        focusTarget: "#resultText",
        focusTreatment: "#resultEditor",
        focusLabel: "master editor"
      }),
      visualViewports[2]
    );

    await verifyTwoTimesZoomWorkflow(mainWindow);
    await createReferenceComparison();
    assertNoRendererErrors();
    await assertArtifactsExist();

    console.log(JSON.stringify({
      ok: true,
      fixture: "electron-app-smoke-fixtures.mjs",
      preload: preloadPath,
      viewports: visualViewports,
      screenshots: expectedArtifacts.map((name) => path.join(outputDir, name)),
      hudCaptured: true,
      zoomFactor: 2,
      zoomWorkflow: ["search", "select", "edit", "copy", "insert"],
      focusCaptures,
      hudStates,
      measurements: visualMeasurements
    }, null, 2));
    clearTimeout(timeout);
    closeWindowsAndExit(0);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.stack : String(error),
      rendererMessages
    }, null, 2));
    clearTimeout(timeout);
    closeWindowsAndExit(1);
  }
}

function createWindow(viewport, preload = null) {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    useContentSize: true,
    width: viewport.width,
    height: viewport.height,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: preload || undefined,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  windows.add(window);
  window.on("closed", () => windows.delete(window));
  return window;
}

function observeRendererConsole(window, source) {
  window.webContents.on("console-message", (_event, details) => {
    rendererMessages.push({
      source,
      level: details.level,
      message: details.message,
      line: details.lineNumber,
      sourceId: details.sourceId
    });
  });
}

function wireIpc() {
  const registered = new Set();
  const register = (channel, handler) => {
    assert.ok(smokeIpcChannels.includes(channel), `Unexpected visual smoke IPC channel: ${channel}`);
    assert.equal(registered.has(channel), false, `Duplicate visual smoke IPC channel: ${channel}`);
    ipcMain.handle(channel, handler);
    registered.add(channel);
  };

  register("settings:get", () => structuredClone(settings));
  register("settings:save", (_event, patch) => {
    settings = mergeSettings(patch, settings);
    return structuredClone(settings);
  });
  register("history:list", () => structuredClone(historyFixtures));
  register("history:update", (_event, payload = {}) => {
    const fixture = historyFixtures.find((entry) => entry.id === payload.id);
    if (!fixture) return { ok: false, reason: "not_found" };
    fixture.text = String(payload.text ?? "");
    fixture.status = fixture.status === "failed" ? "partial" : fixture.status;
    historyUpdateCalls.push({ id: payload.id, text: fixture.text });
    return { ok: true, entry: structuredClone(fixture) };
  });
  register("history:reprocess", (_event, id) => {
    const fixture = historyFixtures.find((entry) => entry.id === id);
    if (!fixture) return { ok: false, reason: "not_found" };
    return { ok: true, entry: structuredClone(fixture) };
  });
  register("dictation:insert-text", (_event, text) => {
    insertTextCalls.push(text);
    return { ok: true };
  });
  register("diagnostics:whisper", () => ({
    ready: true,
    checks: [{ label: "Whisper", status: "pass", message: "Whisper visual fixture ready." }]
  }));
  register("diagnostics:text", () => ({
    ready: true,
    checks: [{ label: "Local text", status: "pass", message: "Local text fixture ready." }]
  }));
  register("providers:status", () => getProcessingProviderStatus(settings));
  register("llm:status", () => ({
    ready: false,
    runtimeReady: false,
    modelReady: false,
    modelId: "Qwen/Qwen3-4B-GGUF",
    quantization: "Q4_K_M"
  }));
  register("models:setup-status", () => createSetupStatus());
  register("models:setup-refresh", () => createSetupStatus());
  register("models:setup-start", (_event, type) => ({
    type,
    status: "complete",
    output: [],
    error: "",
    assets: createSetupStatus().assets
  }));
  register("models:setup-cancel", (_event, type) => ({
    type,
    status: "cancelled",
    output: [],
    error: "",
    assets: createSetupStatus().assets
  }));
  register("dictation:status-latest", () => ({ phase: "idle", message: "" }));
  register("dictation:wav", () => ({
    id: "visual-dictation",
    createdAt: "2026-07-27T13:22:00.000Z",
    status: "complete",
    text: referenceEditorText
  }));

  assert.deepEqual([...registered], smokeIpcChannels);
}

function createSetupStatus() {
  return {
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
}

async function waitForMainReady(window) {
  await window.webContents.executeJavaScript("document.fonts.ready");
  await waitForRenderer(
    window,
    () => readVisualState(window),
    (state) => (
      state.ready &&
      state.interfaceLanguage === "zh-Hans" &&
      state.historyRows === historyFixtures.length &&
      state.remainingIconPlaceholders === 0 &&
      state.renderedIcons > 0 &&
      state.workspaceWidth > 0 &&
      state.editorPaneVisible
    ),
    10000
  );
}

async function installClipboardProbe(window) {
  await window.webContents.executeJavaScript(`
    (() => {
      window.__visualCopyAttempts = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText(text) {
            window.__visualCopyAttempts.push(text);
            return Promise.resolve();
          }
        }
      });
    })()
  `);
}

async function prepareReferenceEditor(window) {
  await window.webContents.executeJavaScript("document.querySelector('#navHistory').click()");
  await waitForRenderer(
    window,
    () => readVisualState(window),
    (state) => state.workspacePane === "list" && state.historyPaneVisible
  );
  await window.webContents.executeJavaScript(
    "document.querySelector('[data-history-id=\"history-zh\"]').click()"
  );
  await waitForRenderer(
    window,
    () => readVisualState(window),
    (state) => state.selectedHistoryId === "history-zh" && state.workspacePane === "editor"
  );
  await window.webContents.executeJavaScript(`
    (() => {
      const editor = document.querySelector('#resultText');
      editor.textContent = ${JSON.stringify(referenceEditorText)};
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText'
      }));
    })()
  `);
  await waitForRenderer(
    window,
    () => readVisualState(window),
    (state) => (
      state.selectedHistoryId === "history-zh" &&
      state.resultText === referenceEditorText &&
      state.editorSaveState === "saved" &&
      historyUpdateCalls.at(-1)?.text === referenceEditorText
    ),
    10000
  );
}

async function captureRecordingHud() {
  const hudWindow = new BrowserWindow(buildHudWindowOptions({
    preloadPath: hudPreloadPath
  }));
  windows.add(hudWindow);
  hudWindow.on("closed", () => windows.delete(hudWindow));
  observeRendererConsole(hudWindow, "hud");
  await hudWindow.loadFile(hudHtmlPath);
  await hudWindow.webContents.executeJavaScript("document.fonts.ready");
  await waitForRenderer(
    hudWindow,
    () => hudWindow.webContents.executeJavaScript(`
      ({
        remainingIconPlaceholders: document.querySelectorAll('i[data-lucide], span[data-lucide]').length,
        renderedIcons: document.querySelectorAll('svg[data-lucide]').length
      })
    `),
    (state) => state.remainingIconPlaceholders === 0 && state.renderedIcons >= 2
  );
  hudWindow.webContents.send("system-input:status", {
    phase: "recording",
    language: "zh-Hans",
    recordingStartedAt: new Date(Date.now() - 18000).toISOString(),
    updatedAt: new Date().toISOString()
  });
  await waitForRenderer(
    hudWindow,
    () => hudWindow.webContents.executeJavaScript(`
      (() => {
        const root = document.querySelector('#hudRoot');
        const stop = document.querySelector('#hudStop');
        return {
          phase: root?.dataset.phase || '',
          stopVisible: Boolean(stop && !stop.hidden && stop.getBoundingClientRect().width > 0),
          title: document.querySelector('#hudTitle')?.textContent || ''
        };
      })()
    `),
    (state) => state.phase === "recording" && state.stopVisible && state.title === "正在录音"
  );
  const recordingLayout = await readHudVisualState(hudWindow);
  assertHudVisualState(recordingLayout, expectedRecordingRegionIds, "recording");
  const image = await captureChecked(hudWindow, "recording HUD");
  assert.equal(image.getSize().width, 460);
  assert.equal(image.getSize().height, 72);

  hudWindow.webContents.send("system-input:status", {
    phase: "warning",
    language: "zh-Hans",
    reason: "paste_failed",
    updatedAt: new Date().toISOString()
  });
  await waitForRenderer(
    hudWindow,
    () => hudWindow.webContents.executeJavaScript(`
      (() => {
        const root = document.querySelector('#hudRoot');
        const openMain = document.querySelector('#hudOpenMain');
        return {
          phase: root?.dataset.phase || '',
          openMainVisible: Boolean(
            openMain &&
            !openMain.hidden &&
            openMain.getBoundingClientRect().width > 0 &&
            openMain.getBoundingClientRect().height > 0
          ),
          title: document.querySelector('#hudTitle')?.textContent || ''
        };
      })()
    `),
    (state) => state.phase === "warning" && state.openMainVisible && state.title === "需要确认"
  );
  const warningLayout = await readHudVisualState(hudWindow);
  assertHudVisualState(warningLayout, expectedWarningRegionIds, "warning");
  return image;
}

function assertHudVisualState(layout, expectedRegionIds, phase) {
  const validation = validateHudVisualState(layout, expectedRegionIds);
  assert.deepEqual(
    layout.visibleRegionIds,
    expectedRegionIds,
    `${phase} 460x72 HUD visible regions`
  );
  assert.deepEqual(
    layout.clipped,
    [],
    `${phase} 460x72 HUD content must not clip: ${JSON.stringify(layout.regionMetrics)}`
  );
  assert.deepEqual(layout.overlaps, [], `${phase} 460x72 HUD controls must not overlap`);
  assert.equal(
    validation.passed,
    true,
    `${phase} 460x72 HUD visual state: ${validation.errors.join("; ")}`
  );
  hudStates.push({
    phase,
    visibleRegionIds: layout.visibleRegionIds,
    clipped: layout.clipped,
    overlaps: layout.overlaps
  });
}

function readHudVisualState(window) {
  return window.webContents.executeJavaScript(`
    (() => {
      const root = document.querySelector('#hudRoot');
      const rootRect = root.getBoundingClientRect();
      const visible = (element) => {
        if (!element || element.hidden) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const collisionSelectors = [
        '#hudWaveform',
        '#hudTitle',
        '#hudMessage',
        '#hudTimer',
        '#hudCancel',
        '#hudStop',
        '#hudOpenMain'
      ];
      const collisionRegions = collisionSelectors
        .map((selector) => document.querySelector(selector))
        .filter(visible);
      const regionMetrics = collisionRegions.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.id,
          rect: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          },
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
          scrollWidth: element.scrollWidth,
          scrollHeight: element.scrollHeight
        };
      });
      const clipped = collisionRegions.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const outside = (
          rect.left < rootRect.left - 1 ||
          rect.top < rootRect.top - 1 ||
          rect.right > rootRect.right + 1 ||
          rect.bottom > rootRect.bottom + 1
        );
        const contentClipped = (
          element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1
        );
        return outside || contentClipped ? [element.id] : [];
      });
      const allowedOverlapPairs = new Set([]);
      const overlaps = [];
      for (let index = 0; index < collisionRegions.length; index += 1) {
        const first = collisionRegions[index].getBoundingClientRect();
        for (let other = index + 1; other < collisionRegions.length; other += 1) {
          const second = collisionRegions[other].getBoundingClientRect();
          const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
          const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
          const overlapArea = width * height;
          const pairKey = [collisionRegions[index].id, collisionRegions[other].id].sort().join('|');
          if (overlapArea > 1 && !allowedOverlapPairs.has(pairKey)) {
            overlaps.push(collisionRegions[index].id + ' overlaps ' + collisionRegions[other].id);
          }
        }
      }
      return {
        visibleRegionIds: collisionRegions.map((element) => element.id),
        regionMetrics,
        clipped,
        overlaps
      };
    })()
  `);
}

async function setViewport(window, viewport) {
  window.webContents.setZoomFactor(1);
  window.setContentSize(viewport.width, viewport.height);
  await waitForRenderer(
    window,
    () => readVisualState(window),
    (state) => state.viewportWidth === viewport.width && state.viewportHeight === viewport.height
  );
  await window.webContents.executeJavaScript("document.fonts.ready");
  await new Promise((resolve) => setTimeout(resolve, 120));
}

async function focusAndAssert(window, selector, treatmentSelector, label, options = {}) {
  if (options.keyboard) {
    window.webContents.focus();
    await window.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(selector)})?.focus()`
    );
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab", modifiers: ["shift"] });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab", modifiers: ["shift"] });
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const focusState = await readFocusState(window, selector, treatmentSelector);
  assertFocusState(focusState, label);
  return focusState;
}

function readFocusState(window, selector, treatmentSelector = selector) {
  return window.webContents.executeJavaScript(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const treatment = document.querySelector(${JSON.stringify(treatmentSelector)});
      if (!element || !treatment) {
        return {
          exists: Boolean(element),
          treatmentExists: Boolean(treatment)
        };
      }
      const style = getComputedStyle(treatment);
      const bounds = treatment.getBoundingClientRect();
      return {
        exists: true,
        treatmentExists: true,
        active: document.activeElement === element,
        focusVisible: element.matches(':focus-visible'),
        treatmentVisible: treatment === element || treatment.matches(':focus-within'),
        outlineStyle: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth) || 0,
        outlineOffset: parseFloat(style.outlineOffset) || 0,
        outlineColor: style.outlineColor,
        rect: {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      };
    })()
  `);
}

function assertFocusState(focusState, label) {
  assert.equal(focusState.exists, true, `${label} focus target should exist`);
  assert.equal(focusState.treatmentExists, true, `${label} focus treatment should exist`);
  assert.equal(focusState.active, true, `${label} should receive focus`);
  assert.equal(focusState.focusVisible, true, `${label} should expose :focus-visible`);
  assert.equal(focusState.treatmentVisible, true, `${label} focus treatment should be active`);
  assert.notEqual(focusState.outlineStyle, "none", `${label} should have an outline`);
  assert.ok(
    focusState.outlineWidth >= 2,
    `${label} rendered outline should remain visible: ${JSON.stringify(focusState)}`
  );
  const outwardOutline = Math.max(0, focusState.outlineOffset + focusState.outlineWidth);
  assert.ok(
    focusState.rect.left - outwardOutline >= -1 &&
      focusState.rect.top - outwardOutline >= -1 &&
      focusState.rect.right + outwardOutline <= focusState.viewport.width + 1 &&
      focusState.rect.bottom + outwardOutline <= focusState.viewport.height + 1,
    `${label} focus treatment must remain within the viewport: ${JSON.stringify(focusState)}`
  );
}

async function waitForNextPaint(window) {
  await window.webContents.executeJavaScript(`
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  `);
}

async function assertFinalFocusTarget(window, selector, treatmentSelector, label) {
  const focusState = await readFocusState(window, selector, treatmentSelector);
  assertFocusState(focusState, `${label} immediately before capture`);
  return focusState;
}

async function assertVisualState(window, expectation) {
  const state = await readVisualState(window);
  visualMeasurements.push({
    state: expectation.state,
    viewport: [state.viewportWidth, state.viewportHeight],
    layout: state.layout
  });
  assert.equal(state.viewportWidth, expectation.expectedWidth, `${expectation.state} viewport width`);
  assert.equal(state.viewportHeight, expectation.expectedHeight, `${expectation.state} viewport height`);
  assert.equal(state.horizontalOverflow, false, `${expectation.state} must not scroll horizontally`);
  assert.deepEqual(state.clippedControls, [], `${expectation.state} clipped controls`);
  assert.deepEqual(state.overlaps, [], `${expectation.state} overlapping boxes`);
  assert.equal(state.remainingIconPlaceholders, 0, `${expectation.state} icon placeholders`);
  assert.ok(state.renderedIcons > 0, `${expectation.state} should render Lucide icons`);
  assert.equal(state.commandStripVisible, true, `${expectation.state} command strip`);
  if (expectation.expectedEditorActionRows) {
    assert.equal(
      state.editorActionRows,
      expectation.expectedEditorActionRows,
      `${expectation.state} editor action rows`
    );
  }
  if (expectation.expectedMaxRecordButtonHeight) {
    assert.ok(
      state.layout.recordButton.height <= expectation.expectedMaxRecordButtonHeight,
      `${expectation.state} record button height: ${state.layout.recordButton.height}`
    );
  }

  if (expectation.expectedPane === "split") {
    assert.equal(state.historyPaneVisible, true, `${expectation.state} history pane`);
    assert.equal(state.editorPaneVisible, true, `${expectation.state} editor pane`);
  } else if (expectation.expectedPane === "list") {
    assert.equal(state.historyPaneVisible, true, `${expectation.state} history pane`);
    assert.equal(state.editorPaneVisible, false, `${expectation.state} editor pane`);
  } else {
    assert.equal(state.historyPaneVisible, false, `${expectation.state} history pane`);
    assert.equal(state.editorPaneVisible, true, `${expectation.state} editor pane`);
  }
}

function readVisualState(window) {
  return window.webContents.executeJavaScript(`
    (() => {
      const isVisible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const describe = (element) => element.id
        ? '#' + element.id
        : '.' + [...element.classList].join('.');
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return {
          left: value.left,
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          width: value.width,
          height: value.height
        };
      };
      const overlapArea = (a, b) => {
        const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return width * height;
      };
      const overlapGroups = [
        ['#appSidebar', '.app-main'],
        ['#appTopbar', '#commandStrip', '#workspacePage'],
        ['#commandStrip .shortcut-hint', '#commandStrip .command-select', '#languageControls', '#recordButton'],
        ['#workspacePage > #historyPane', '#workspacePage > #editorPane'],
        ['#editorPane .editor-toolbar > #editorBack', '#editorPane .editor-toolbar > .editor-meta', '#editorPane .editor-toolbar > .button-row'],
        ['#editorPane .button-row > button']
      ];
      const overlaps = [];
      for (const group of overlapGroups) {
        const elements = group.length === 1
          ? [...document.querySelectorAll(group[0])].filter(isVisible)
          : group.map((selector) => document.querySelector(selector)).filter(isVisible);
        for (let index = 0; index < elements.length; index += 1) {
          for (let other = index + 1; other < elements.length; other += 1) {
            const firstRect = rect(elements[index]);
            const secondRect = rect(elements[other]);
            if (overlapArea(firstRect, secondRect) > 1) {
              overlaps.push(describe(elements[index]) + ' overlaps ' + describe(elements[other]));
            }
          }
        }
      }
      const commandControls = [
        ...document.querySelectorAll(
          '#commandStrip .shortcut-hint, #commandStrip .command-select, #languageControls, #recordButton, #commandStrip select'
        ),
        ...document.querySelectorAll('#editorPane button')
      ].filter(isVisible);
      const textFitsSelect = (element) => {
        if (!element.matches('select')) return true;
        const style = getComputedStyle(element);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = style.font;
        const textWidth = context.measureText(element.selectedOptions[0]?.textContent || '').width;
        const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        const nativeSelectArrowSafety = 18;
        return textWidth + padding + nativeSelectArrowSafety + 2 <= element.clientWidth;
      };
      const clippedControls = commandControls.flatMap((element) => {
        const bounds = rect(element);
        const outsideViewport = (
          bounds.left < -1 ||
          bounds.top < -1 ||
          bounds.right > window.innerWidth + 1 ||
          bounds.bottom > window.innerHeight + 1
        );
        const clippedContent = (
          (
            element.matches('button') &&
            (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
          ) ||
          !textFitsSelect(element)
        );
        return outsideViewport || clippedContent ? [describe(element)] : [];
      });
      const editorActionTops = [...document.querySelectorAll('#editorPane .button-row > button')]
        .filter(isVisible)
        .map((button) => Math.round(button.getBoundingClientRect().top));
      return {
        ready: Boolean(window.localFlow && document.querySelector('#recordButton')),
        interfaceLanguage: document.querySelector('#interfaceLanguage')?.value || '',
        historyRows: document.querySelectorAll('[data-history-action="select"]').length,
        selectedHistoryId: document.querySelector('[aria-selected="true"]')?.dataset.historyId || '',
        resultText: document.querySelector('#resultText')?.textContent || '',
        editorSaveState: document.querySelector('#editorSaveState')?.dataset.state || '',
        workspacePane: document.body.dataset.workspacePane || '',
        historyPaneVisible: isVisible(document.querySelector('#historyPane')),
        editorPaneVisible: isVisible(document.querySelector('#editorPane')),
        commandStripVisible: isVisible(document.querySelector('#commandStrip')),
        remainingIconPlaceholders: document.querySelectorAll('i[data-lucide], span[data-lucide]').length,
        renderedIcons: document.querySelectorAll('svg[data-lucide]').length,
        workspaceWidth: document.querySelector('#workspacePage')?.getBoundingClientRect().width || 0,
        horizontalOverflow: (
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ||
          document.body.scrollWidth > document.body.clientWidth + 1
        ),
        clippedControls,
        overlaps,
        editorActionRows: new Set(editorActionTops).size,
        layout: {
          commandGridColumns: getComputedStyle(document.querySelector('#commandStrip')).gridTemplateColumns,
          recordButton: rect(document.querySelector('#recordButton')),
          languageControls: rect(document.querySelector('#languageControls')),
          recognitionSelect: {
            ...rect(document.querySelector('#whisperLanguage')),
            clientWidth: document.querySelector('#whisperLanguage').clientWidth,
            selectedText: document.querySelector('#whisperLanguage').selectedOptions[0]?.textContent || '',
            textFits: textFitsSelect(document.querySelector('#whisperLanguage'))
          },
          outputSelect: {
            ...rect(document.querySelector('#outputLanguage')),
            clientWidth: document.querySelector('#outputLanguage').clientWidth,
            selectedText: document.querySelector('#outputLanguage').selectedOptions[0]?.textContent || '',
            textFits: textFitsSelect(document.querySelector('#outputLanguage'))
          },
          workspaceGridColumns: getComputedStyle(document.querySelector('#workspacePage')).gridTemplateColumns,
          editorPane: rect(document.querySelector('#editorPane')),
          editorToolbar: {
            ...rect(document.querySelector('#editorPane .editor-toolbar')),
            display: getComputedStyle(document.querySelector('#editorPane .editor-toolbar')).display,
            gridTemplateColumns: getComputedStyle(document.querySelector('#editorPane .editor-toolbar')).gridTemplateColumns
          },
          editorMeta: rect(document.querySelector('#editorPane .editor-meta')),
          editorActions: rect(document.querySelector('#editorPane .button-row')),
          editorActionTops
        },
        copyAttempts: window.__visualCopyAttempts || [],
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    })()
  `);
}

async function captureChecked(
  window,
  label,
  {
    focusTarget = null,
    focusTreatment = focusTarget,
    focusLabel = label
  } = {}
) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  let finalFocusState = null;
  if (focusTarget) {
    await focusAndAssert(window, focusTarget, focusTreatment, focusLabel, { keyboard: true });
    await waitForNextPaint(window);
    finalFocusState = await assertFinalFocusTarget(window, focusTarget, focusTreatment, focusLabel);
  }
  const image = await window.webContents.capturePage();
  assertCaptureHasContent(image, label);
  if (finalFocusState) {
    const coverage = assertCapturedFocusTreatment(image, finalFocusState, focusLabel);
    focusCaptures.push({
      label: focusLabel,
      selector: focusTarget,
      treatmentSelector: focusTreatment,
      rect: finalFocusState.rect,
      outlineColor: finalFocusState.outlineColor,
      minimumEdgeCoverage: coverage.minimumEdgeCoverage,
      edges: coverage.edges
    });
  }
  return image;
}

function assertCapturedFocusTreatment(image, focusState, label) {
  const colorMatch = focusState.outlineColor.match(
    /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/
  );
  assert.ok(colorMatch, `${label} focus color must be an RGB value`);
  const expected = colorMatch.slice(1, 4).map(Number);
  const size = image.getSize();
  const scaleX = size.width / focusState.viewport.width;
  const scaleY = size.height / focusState.viewport.height;
  const rect = {
    left: Math.max(0, Math.floor(focusState.rect.left * scaleX)),
    top: Math.max(0, Math.floor(focusState.rect.top * scaleY)),
    right: Math.min(size.width - 1, Math.ceil(focusState.rect.right * scaleX)),
    bottom: Math.min(size.height - 1, Math.ceil(focusState.rect.bottom * scaleY))
  };
  const bandX = Math.max(
    4,
    Math.ceil((focusState.outlineWidth + Math.abs(focusState.outlineOffset) + 2) * scaleX)
  );
  const bandY = Math.max(
    4,
    Math.ceil((focusState.outlineWidth + Math.abs(focusState.outlineOffset) + 2) * scaleY)
  );
  const coverage = measureFocusRingCoverage({
    bitmap: image.toBitmap(),
    imageWidth: size.width,
    imageHeight: size.height,
    rect,
    bandX,
    bandY,
    expectedColor: expected,
    colorTolerance: 36,
    minimumEdgeCoverage: 0.5
  });
  assert.equal(
    coverage.passed,
    true,
    `${label} capture must contain proportional focus coverage on all edges: ${JSON.stringify(coverage)}`
  );
  return coverage;
}

function assertCaptureHasContent(image, label) {
  assert.equal(image.isEmpty(), false, `${label} capture must not be empty`);
  const size = image.getSize();
  assert.ok(size.width > 0 && size.height > 0, `${label} capture dimensions`);
  const bitmap = image.toBitmap();
  const pixelCount = size.width * size.height;
  const pixelStride = Math.max(1, Math.floor(pixelCount / 6000));
  let darkSamples = 0;
  let lightSamples = 0;
  let opaqueSamples = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += pixelStride) {
    const offset = pixel * 4;
    const blue = bitmap[offset];
    const green = bitmap[offset + 1];
    const red = bitmap[offset + 2];
    const alpha = bitmap[offset + 3];
    if (alpha > 0) opaqueSamples += 1;
    const luminance = (red + green + blue) / 3;
    if (luminance < 210) darkSamples += 1;
    if (luminance > 235) lightSamples += 1;
  }

  assert.ok(opaqueSamples > 100, `${label} must contain opaque pixels`);
  assert.ok(darkSamples > 25, `${label} must contain visible non-blank detail`);
  assert.ok(lightSamples > 25, `${label} must contain surface detail`);
}

async function writeCapture(fileName, image, expectedViewport = null) {
  if (expectedViewport) {
    const size = image.getSize();
    assert.equal(size.width, expectedViewport.width, `${fileName} width`);
    assert.equal(size.height, expectedViewport.height, `${fileName} height`);
  }
  await writeFile(path.join(outputDir, fileName), image.toPNG());
}

async function captureDesktopWithHud(window, hudImage, focusOptions = {}) {
  const hudDataUrl = hudImage.toDataURL();
  const hudSize = hudImage.getSize();
  await window.webContents.executeJavaScript(`
    (() => {
      const overlay = document.createElement('img');
      overlay.id = 'visualHudOverlay';
      overlay.alt = '';
      overlay.src = ${JSON.stringify(hudDataUrl)};
      Object.assign(overlay.style, {
        position: 'fixed',
        zIndex: '10000',
        left: '50%',
        bottom: '16px',
        width: '${hudSize.width}px',
        height: '${hudSize.height}px',
        transform: 'translateX(-50%)',
        filter: 'drop-shadow(0 10px 16px rgba(23, 33, 30, 0.22))',
        pointerEvents: 'none'
      });
      document.body.append(overlay);
    })()
  `);
  try {
    await waitForRenderer(
      window,
      () => window.webContents.executeJavaScript(`
        (() => {
          const image = document.querySelector('#visualHudOverlay');
          return {
            complete: Boolean(image?.complete && image.naturalWidth > 0),
            width: image?.getBoundingClientRect().width || 0,
            height: image?.getBoundingClientRect().height || 0
          };
        })()
      `),
      (state) => (
        state.complete &&
        state.width === hudSize.width &&
        state.height === hudSize.height
      )
    );
    return await captureChecked(window, "desktop with HUD", focusOptions);
  } finally {
    await window.webContents.executeJavaScript(
      "document.querySelector('#visualHudOverlay')?.remove()"
    );
  }
}

async function createReferenceComparison() {
  const referenceData = (await readFile(referencePath)).toString("base64");
  const actualData = (await readFile(path.join(outputDir, "desktop-split.png"))).toString("base64");
  const comparisonViewport = { width: 1900, height: 730 };
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; }
          html, body {
            width: 100%;
            height: 100%;
            margin: 0;
            overflow: hidden;
            background: #eef2f0;
            color: #17211e;
            font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
          }
          main {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 18px;
            height: 100%;
            padding: 18px;
          }
          figure {
            display: grid;
            grid-template-rows: 36px minmax(0, 1fr);
            min-width: 0;
            min-height: 0;
            margin: 0;
            overflow: hidden;
            border: 1px solid #b8c4c0;
            border-radius: 6px;
            background: #ffffff;
          }
          figcaption {
            display: flex;
            align-items: center;
            padding: 0 14px;
            border-bottom: 1px solid #dce3e0;
            font-size: 14px;
            font-weight: 700;
          }
          img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #ffffff;
          }
        </style>
      </head>
      <body>
        <main>
          <figure>
            <figcaption>批准参考图</figcaption>
            <img src="data:image/png;base64,${referenceData}" alt="">
          </figure>
          <figure>
            <figcaption>实际实现 · 1180 × 800</figcaption>
            <img src="data:image/png;base64,${actualData}" alt="">
          </figure>
        </main>
      </body>
    </html>`;
  const comparisonWindow = createWindow(comparisonViewport);
  await comparisonWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await waitForImages(comparisonWindow, 2);
  await writeCapture(
    "reference-comparison.png",
    await captureChecked(comparisonWindow, "reference comparison"),
    comparisonViewport
  );
}

async function waitForImages(window, expectedCount) {
  await waitForRenderer(
    window,
    () => window.webContents.executeJavaScript(`
      ({
        count: document.images.length,
        complete: [...document.images].every((image) => image.complete && image.naturalWidth > 0)
      })
    `),
    (state) => state.count === expectedCount && state.complete
  );
}

async function verifyTwoTimesZoomWorkflow(window) {
  const viewport = visualViewports[2];
  window.setContentSize(viewport.width, viewport.height);
  window.webContents.setZoomFactor(2);
  await waitForRenderer(
    window,
    () => readVisualState(window),
    (state) => state.viewportWidth === viewport.width / 2 && state.viewportHeight === viewport.height / 2
  );

  await window.webContents.executeJavaScript(`
    (() => {
      document.querySelector('#editorBack').click();
      const search = document.querySelector('#historySearch');
      search.value = 'Q3';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await waitForRenderer(
    window,
    () => readZoomWorkflowState(window),
    (state) => state.searchVisible && state.resultCount === 1 && state.listVisible
  );

  await window.webContents.executeJavaScript(
    "document.querySelector('[data-history-id=\"history-zh\"]').click()"
  );
  await waitForRenderer(
    window,
    () => readZoomWorkflowState(window),
    (state) => state.editorVisible && state.copyVisible && state.insertVisible
  );

  const zoomEditedText = "2x 缩放编辑检查";
  await window.webContents.executeJavaScript(`
    (() => {
      const editor = document.querySelector('#resultText');
      editor.textContent = ${JSON.stringify(zoomEditedText)};
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText'
      }));
    })()
  `);
  await waitForRenderer(
    window,
    () => readZoomWorkflowState(window),
    (state) => (
      state.editorText === zoomEditedText &&
      state.editorSaveState === "saved" &&
      historyUpdateCalls.at(-1)?.text === zoomEditedText
    ),
    10000
  );

  await window.webContents.executeJavaScript(`
    (() => {
      document.querySelector('#copyResult').click();
      document.querySelector('#insertResult').click();
    })()
  `);
  await waitForRenderer(
    window,
    () => readZoomWorkflowState(window),
    (state) => (
      state.copyAttempts.includes(zoomEditedText) &&
      insertTextCalls.at(-1) === zoomEditedText
    )
  );
  await focusAndAssert(
    window,
    "#resultText",
    "#resultEditor",
    "2x zoom editor",
    { keyboard: true }
  );
  await assertVisualState(window, {
    state: "2x-master-detail-editor",
    expectedPane: "editor",
    expectedWidth: viewport.width / 2,
    expectedHeight: viewport.height / 2
  });
  window.webContents.setZoomFactor(1);
}

function readZoomWorkflowState(window) {
  return window.webContents.executeJavaScript(`
    (() => {
      const visible = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      return {
        searchVisible: visible('#historySearch'),
        resultCount: document.querySelectorAll('[data-history-action="select"]').length,
        listVisible: visible('#historyPane'),
        editorVisible: visible('#editorPane'),
        copyVisible: visible('#copyResult') && !document.querySelector('#copyResult').disabled,
        insertVisible: visible('#insertResult') && !document.querySelector('#insertResult').disabled,
        editorText: document.querySelector('#resultText')?.textContent || '',
        editorSaveState: document.querySelector('#editorSaveState')?.dataset.state || '',
        copyAttempts: window.__visualCopyAttempts || []
      };
    })()
  `);
}

async function waitForRenderer(window, readState, predicate, timeoutMs = 7000) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readState();
    if (predicate(lastState)) return lastState;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for visual renderer state: ${JSON.stringify(lastState)}`);
}

function assertNoRendererErrors() {
  const errors = rendererMessages.filter((message) => message.level >= 3);
  assert.deepEqual(errors, [], "Visual renderer emitted console errors");
}

async function assertArtifactsExist() {
  for (const fileName of expectedArtifacts) {
    const file = await stat(path.join(outputDir, fileName));
    assert.equal(file.isFile(), true, `${fileName} should be a file`);
    assert.ok(file.size > 1000, `${fileName} should be non-empty`);
  }
}

function closeWindowsAndExit(code) {
  for (const window of windows) {
    if (!window.isDestroyed()) window.destroy();
  }
  app.exit(code);
}
