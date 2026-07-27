# Local Flow Windows UI V4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reliable, single-instance Windows dictation product with the approved Local Flow V4 hub, editable history, personalization pages, actionable recording HUD, and a verified Windows installer.

**Architecture:** Keep Electron, local Whisper, optional Qwen/Ollama/MyMemory, the existing recorder, and the existing settings effects transaction. Move launch policy, window lifecycle, history actions, personalization normalization, and renderer view state into focused modules; keep `src/main/index.js` and `src/renderer/app.js` as orchestration layers.

**Tech Stack:** Electron 38, Node.js ES modules, plain localized HTML/CSS/JavaScript, Lucide icons, `node:test`, electron-builder NSIS, whisper.cpp, optional llama.cpp/Qwen3.

## Global Constraints

- Use `npm.cmd`, not `npm`, on this Windows workstation.
- Do not add a paid API dependency or require an OpenAI API key.
- Automatic output language must preserve the detected source language; conversion runs only when the user selects a target language.
- Local Whisper remains the default ASR path. Qwen3 remains optional and must not block same-language dictation.
- Preserve all eight UI languages: English, Simplified Chinese, Japanese, Korean, Traditional Chinese, French, Russian, and Spanish.
- Manual launch must show the main window. Only an explicit `--hidden` argument may start hidden.
- The app must hold one Electron instance; a later manual launch reveals the existing window.
- Main window dimensions are `1180 x 800`, minimum `780 x 600`.
- Use the native Windows frame. Do not draw duplicate minimize, maximize, or close controls.
- Use the approved visual reference at `docs/design/local-flow-windows-ui-v4-fusion.png`.
- Do not expose executable paths, URLs, `spawn`, `ENOENT`, stderr, or model setup logs on the home/history surfaces or HUD.
- Do not copy Typeless, Wispr Flow, or Willow branding or assets.
- Do not modify the iPhone implementation in this release.
- Preserve current uncommitted Qwen setup work until Task 1 verifies and commits it separately.

## File Structure

### New focused modules

- `src/main/single-instance.js`: hidden-launch classification and Electron single-instance registration.
- `src/main/main-window.js`: main-window options, reveal behavior, load fallback, and close-to-tray lifecycle.
- `src/main/ipc-authorization.js`: renderer/HUD sender validation.
- `src/main/history-actions.js`: editable-history and reprocessing application service.
- `src/main/hud-actions.js`: HUD stop/cancel/open actions and temporary global Escape handling.
- `src/shared/personalization.js`: dictionary/snippet normalization and exact snippet expansion.
- `src/renderer/history-view-state.js`: history normalization, filtering, grouping, and selection.
- `src/renderer/versioned-autosave.js`: serialized debounced history saves.

### Existing orchestration and UI files

- `src/main/index.js`: compose services, windows, IPC, tray, shortcuts, and lifecycle modules.
- `src/main/startup-settings.js`: login-item arguments and explicit hidden-start policy.
- `src/main/settings-store.js`: normalized settings, atomic writes, serialized history mutations.
- `src/main/dictation-service.js`: reusable transcript processing, exact snippets, and normal dictation.
- `src/main/system-input-controller.js`: explicit polishing and cancel phases.
- `src/main/hud-window.js`: approved HUD dimensions and behavior.
- `src/preload.cjs`: narrow main-window IPC API.
- `src/hud-preload.cjs`: narrow HUD action API.
- `src/renderer/index.html`: V4 semantic shell, workspaces, personalization pages, and settings drawer.
- `src/renderer/styles.css`: V4 tokens, desktop split layout, narrow master-detail layout, and HUD.
- `src/renderer/app.js`: DOM orchestration while retaining the recorder and settings/model flows.
- `src/renderer/hud.html`, `src/renderer/hud.js`, `src/renderer/hud-state.js`: actionable localized HUD.
- `src/renderer/i18n.js`: complete V4 strings for all eight languages.

### Verification files

- Add focused unit tests next to the existing flat `tests/*.test.js` suite.
- Update `tests/renderer-markup.test.js`, `scripts/electron-app-smoke.mjs`, and `scripts/packaged-start-smoke.mjs`.
- Add `scripts/electron-visual-smoke.mjs` for three viewport captures and a side-by-side reference comparison.
- Update `package.json` with `check:visual`.

---

### Task 1: Preserve And Verify The Existing Qwen Baseline

**Files:**
- Verify and commit: `.github/workflows/windows-installer.yml`
- Verify and commit: `README.md`
- Verify and commit: `scripts/check-llama-runtime.mjs`
- Verify and commit: `scripts/invoke-node-process.ps1`
- Verify and commit: `scripts/llama-runtime-manifest.json`
- Verify and commit: `scripts/qwen-model-manifest.json`
- Verify and commit: `scripts/setup-llm.ps1`
- Verify and commit: `scripts/setup-whisper.ps1`
- Verify and commit: `scripts/verify-release-build.mjs`
- Verify and commit: `src/main/embedded-llm-assets.js`
- Verify and commit: `src/main/model-setup.js`
- Verify and commit: `src/renderer/i18n.js`
- Verify and commit: `tests/embedded-llm-assets.test.js`
- Verify and commit: `tests/github-actions.test.js`
- Verify and commit: `tests/model-setup.test.js`
- Verify and commit: `tests/release-polish.test.js`

**Interfaces:**
- Consumes: the current dirty worktree exactly as listed above.
- Produces: one reviewed Qwen hardening commit and a clean baseline for V4 files.

- [ ] **Step 1: Confirm the dirty-file boundary**

Run:

```powershell
git status --short
git diff --name-status
```

Expected: only the 16 paths listed in this task are part of the pre-existing Qwen change. Stop if an additional unrelated path appears.

- [ ] **Step 2: Run the focused Qwen tests**

Run:

```powershell
node --test tests/embedded-llm-assets.test.js tests/github-actions.test.js tests/model-setup.test.js tests/release-polish.test.js
```

Expected: all focused tests pass.

- [ ] **Step 3: Run the full regression and Electron smoke suites**

Run:

```powershell
npm.cmd test
npm.cmd run check:app
```

Expected: both commands exit `0`; `check:app` prints JSON with `"ok": true`.

- [ ] **Step 4: Stage only the verified Qwen baseline**

Run:

```powershell
git add -- .github/workflows/windows-installer.yml README.md scripts/check-llama-runtime.mjs scripts/invoke-node-process.ps1 scripts/llama-runtime-manifest.json scripts/qwen-model-manifest.json scripts/setup-llm.ps1 scripts/setup-whisper.ps1 scripts/verify-release-build.mjs src/main/embedded-llm-assets.js src/main/model-setup.js src/renderer/i18n.js tests/embedded-llm-assets.test.js tests/github-actions.test.js tests/model-setup.test.js tests/release-polish.test.js
git diff --cached --name-status
git diff --cached --check
```

Expected: the staged list contains exactly those 16 paths and no whitespace errors.

- [ ] **Step 5: Commit the baseline**

Run:

```powershell
git commit -m "fix: harden packaged qwen setup"
```

Expected: one commit is created and `git status --short` is empty before V4 implementation begins.

---

### Task 2: Add Explicit Launch Intent And Single-Instance Ownership

**Files:**
- Create: `src/main/single-instance.js`
- Create: `tests/single-instance.test.js`
- Modify: `src/main/startup-settings.js:1-25`
- Modify: `tests/startup-settings.test.js:1-53`
- Modify: `src/main/index.js:1-508`

**Interfaces:**
- Consumes: Electron `app.requestSingleInstanceLock()`, `app.on("second-instance")`, and `process.argv`.
- Produces: `isHiddenLaunch(argv): boolean`, `registerSingleInstance(app, options): boolean`, `createDeferredReveal(reveal)`, and `shouldStartMinimized(argv): boolean`.

- [ ] **Step 1: Write failing launch-policy tests**

Add tests that establish the exact contract:

```js
test("only an explicit hidden flag creates a hidden launch", () => {
  assert.equal(isHiddenLaunch(["Local Flow.exe"]), false);
  assert.equal(isHiddenLaunch(["Local Flow.exe", "--hidden"]), true);
  assert.equal(shouldStartMinimized(["Local Flow.exe"], { startMinimizedToTray: true }), false);
});

test("a second manual launch reveals while a login launch stays quiet", () => {
  const harness = createFakeApp({ lock: true });
  const reveals = [];
  assert.equal(registerSingleInstance(harness.app, {
    onSecondInstance: (argv) => reveals.push(argv)
  }), true);
  harness.emitSecond(["Local Flow.exe"]);
  harness.emitSecond(["Local Flow.exe", "--hidden"]);
  assert.equal(reveals.length, 1);
});

test("a reveal requested before window creation is flushed after creation", () => {
  let available = false;
  const reveals = [];
  const deferred = createDeferredReveal(() => {
    if (!available) return false;
    reveals.push("shown");
    return true;
  });
  assert.equal(deferred.request(), false);
  available = true;
  assert.equal(deferred.flush(), true);
  assert.deepEqual(reveals, ["shown"]);
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
node --test tests/single-instance.test.js tests/startup-settings.test.js
```

Expected: failure because `single-instance.js` does not exist and the old minimized policy still reads the setting.

- [ ] **Step 3: Implement the launch module**

Create the module with this public behavior:

```js
export function isHiddenLaunch(argv = []) {
  return Array.isArray(argv) && argv.some((argument) => argument === "--hidden");
}

export function registerSingleInstance(app, { onSecondInstance = () => {} } = {}) {
  const ownsLock = app.requestSingleInstanceLock();
  if (!ownsLock) {
    app.quit();
    return false;
  }

  app.on("second-instance", (_event, argv = []) => {
    if (!isHiddenLaunch(argv)) {
      onSecondInstance(argv);
    }
  });
  return true;
}

export function createDeferredReveal(reveal) {
  let pending = false;
  return {
    request() {
      pending = !reveal();
      return !pending;
    },
    flush() {
      if (!pending) return true;
      pending = !reveal();
      return !pending;
    },
    hasPending() {
      return pending;
    }
  };
}
```

Change `shouldStartMinimized` to ignore persisted settings:

```js
export function shouldStartMinimized(argv = process.argv) {
  return isHiddenLaunch(argv);
}
```

Guard all `app.whenReady()`, `will-quit`, and `activate` registration in `src/main/index.js` behind the returned ownership flag. Route second-instance, tray, and activate reveal requests through one `createDeferredReveal` instance; flush it after `createWindow()` so a second manual launch during first-instance boot is not lost.

- [ ] **Step 4: Verify launch-policy tests pass**

Run:

```powershell
node --test tests/single-instance.test.js tests/startup-settings.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Run startup-adjacent regressions**

Run:

```powershell
node --test tests/electron-runtime.test.js tests/startup-settings.test.js tests/tray-menu.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/main/single-instance.js src/main/startup-settings.js src/main/index.js tests/single-instance.test.js tests/startup-settings.test.js
git commit -m "fix: enforce visible single-instance startup"
```

---

### Task 3: Make Main-Window Reveal And Tray Lifecycle Reliable

**Files:**
- Create: `src/main/main-window.js`
- Create: `tests/main-window.test.js`
- Modify: `src/main/index.js:1-508`
- Modify: `src/main/tray-menu.js:1-118`
- Modify: `tests/tray-menu.test.js:1-116`
- Modify: `tests/release-polish.test.js`

**Interfaces:**
- Consumes: a BrowserWindow-compatible object and callbacks owned by `src/main/index.js`.
- Produces: `buildMainWindowOptions({ preloadPath })`, `revealMainWindow(window)`, and `bindMainWindowLifecycle(options)`.

- [ ] **Step 1: Write failing window-lifecycle tests**

Cover dimensions, idempotent initial reveal, fallback reveal, minimized restore, close-to-tray, and main-frame load failure:

```js
test("main window uses V4 dimensions and native frame", () => {
  const options = buildMainWindowOptions({ preloadPath: "C:/app/preload.cjs" });
  assert.equal(options.width, 1180);
  assert.equal(options.height, 800);
  assert.equal(options.minWidth, 780);
  assert.equal(options.minHeight, 600);
  assert.equal(options.frame, undefined);
  assert.equal(options.show, false);
});

test("ready and load fallback reveal only once", () => {
  const harness = createWindowHarness();
  bindMainWindowLifecycle({ window: harness.window, showOnReady: true });
  harness.emitWindow("ready-to-show");
  harness.emitContents("did-finish-load");
  assert.equal(harness.calls.show, 1);
  assert.equal(harness.calls.focus, 1);
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
node --test tests/main-window.test.js
```

Expected: failure because `main-window.js` does not exist.

- [ ] **Step 3: Implement the focused lifecycle module**

Use the following interface:

```js
export function buildMainWindowOptions({ preloadPath }) {
  return {
    width: 1180,
    height: 800,
    minWidth: 780,
    minHeight: 600,
    title: "Local Flow",
    backgroundColor: "#F5F7F6",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  };
}

export function revealMainWindow(window) {
  if (!window || window.isDestroyed?.() || window.webContents?.isDestroyed?.()) return false;
  if (window.isMinimized?.()) window.restore();
  window.show();
  window.focus();
  return true;
}
```

`bindMainWindowLifecycle` must:

- bind both `ready-to-show` and `webContents.did-finish-load` to one guarded initial reveal;
- skip initial reveal when `showOnReady` is false;
- prevent close and hide when `isQuitting()` is false;
- call `onFirstHide()` once per process session;
- call `onLoadFailure({ errorCode, errorDescription, validatedURL })` only for the main frame.

- [ ] **Step 4: Wire lifecycle recovery into the main process**

Replace the inline window options and handlers in `createWindow()`. Import Electron `dialog` and show a Chinese/English-safe local message with buttons `退出` and `继续在后台`; choosing exit sets `app.isQuitting = true` and calls `app.quit()`.

Add `getBackgroundNotice(language)` to `tray-menu.js` with English and Simplified Chinese copy, then use `tray.displayBalloon()` once after the first close:

```js
const notice = getBackgroundNotice(lastSettings?.interfaceLanguage);
tray?.displayBalloon?.({
  title: "Local Flow",
  content: notice
});
```

On `will-quit`, unregister the hotkey and dispose/destroy the native shortcut, HUD, and tray when those methods exist.

- [ ] **Step 5: Verify lifecycle and release-polish tests**

Run:

```powershell
node --test tests/main-window.test.js tests/release-polish.test.js tests/tray-menu.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/main/main-window.js src/main/index.js src/main/tray-menu.js tests/main-window.test.js tests/tray-menu.test.js tests/release-polish.test.js
git commit -m "fix: make main window reveal and tray lifecycle reliable"
```

---

### Task 4: Add Atomic History Storage And Personalization Schemas

**Files:**
- Create: `src/shared/personalization.js`
- Create: `tests/personalization.test.js`
- Modify: `src/main/settings-store.js:1-349`
- Modify: `tests/settings-store.test.js:1-694`

**Interfaces:**
- Consumes: persisted `settings.json`, `history.json`, existing dictionary values, and optional snippet values.
- Produces: `normalizeDictionary(value)`, `normalizeSnippets(value, options)`, `expandExactSnippet(transcript, snippets)`, `settingsStore.getHistoryEntry(id)`, and `settingsStore.updateHistory(id, patch)`.

- [ ] **Step 1: Write failing normalization and history-mutation tests**

Use explicit limits and duplicate behavior:

```js
test("dictionary normalization trims, deduplicates, and caps entries", () => {
  assert.deepEqual(normalizeDictionary([" Qwen ", "qwen", "", "Local Flow"]), ["Qwen", "Local Flow"]);
});

test("snippet expansion requires a complete normalized match", () => {
  const snippets = [{ id: "s1", trigger: "会议总结", text: "以下是本次会议总结：" }];
  assert.deepEqual(expandExactSnippet(" 会议总结 ", snippets), {
    matched: true,
    text: "以下是本次会议总结：",
    snippetId: "s1"
  });
  assert.equal(expandExactSnippet("请写会议总结", snippets).matched, false);
});

test("history updates preserve transcript and serialize writes", async () => {
  const store = createSettingsStore(tempDir);
  await store.addHistory({ id: "h1", transcript: "原文", text: "旧文本", status: "complete" });
  const updated = await store.updateHistory("h1", { text: "新文本" });
  assert.equal(updated.transcript, "原文");
  assert.equal(updated.text, "新文本");
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
node --test tests/personalization.test.js tests/settings-store.test.js
```

Expected: failures for missing snippet schema and history mutation methods.

- [ ] **Step 3: Implement shared personalization rules**

Export and enforce these constants:

```js
export const PERSONALIZATION_LIMITS = Object.freeze({
  dictionaryEntries: 500,
  dictionaryTermLength: 120,
  snippets: 200,
  snippetTriggerLength: 120,
  snippetTextLength: 10000
});
```

Dictionary comparison and snippet trigger comparison use `NFKC`, collapsed whitespace, and `toLocaleLowerCase()`. Preserve the first user-visible spelling. A snippet is `{ id, trigger, text }`; drop entries without a trigger or expansion text; assign a missing ID with the injected `createId`.

- [ ] **Step 4: Serialize history and write JSON through replacement files**

Add a separate `historyOperationQueue`. `addHistory`, `getHistoryEntry`, and `updateHistory` must all run through that queue without recursively calling a queued public method.

Use replacement writes:

```js
async function writeJson(filePath, value, io) {
  await io.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${io.randomUUID()}.tmp`;
  try {
    await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await io.rename(temporaryPath, filePath);
  } finally {
    await io.rm(temporaryPath, { force: true }).catch(() => {});
  }
}
```

Extend `resolveFileIo` with `rename`, `rm`, and `randomUUID`. Update fake IO in tests so no fake write falls through to the real filesystem.

`updateHistory` may change only `text`, `status`, `processingError`, `pasteStatus`, `pasteError`, `source`, `snippetId`, and `updatedAt`; cap text at 100,000 characters and error strings at 240 characters.

- [ ] **Step 5: Add snippets to settings normalization**

Add `snippets: []` to `defaultSettings`, call `normalizeDictionary` and `normalizeSnippets` from `mergeSettings`, and keep old settings files valid without migration prompts.

- [ ] **Step 6: Verify persistence tests**

Run:

```powershell
node --test tests/personalization.test.js tests/settings-store.test.js tests/settings-effects-transaction.test.js
```

Expected: all tests pass, including concurrent history updates and atomic-write cleanup.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/shared/personalization.js src/main/settings-store.js tests/personalization.test.js tests/settings-store.test.js
git commit -m "feat: add durable history and personalization schemas"
```

---

### Task 5: Reuse Transcript Processing For Snippets And History Reprocessing

**Files:**
- Create: `src/main/history-actions.js`
- Create: `tests/history-actions.test.js`
- Modify: `src/main/dictation-service.js:1-135`
- Modify: `tests/dictation-service.test.js:1-301`

**Interfaces:**
- Consumes: `settingsStore.getHistoryEntry`, `settingsStore.updateHistory`, `DictationService.processTranscript`, and exact snippet expansion.
- Produces: `createHistoryActions({ settingsStore, dictationService })` with `updateText(id, text)` and `reprocess(id)`.

- [ ] **Step 1: Write failing transcript and history-action tests**

Cover exact snippets, no substring replacement, original transcript reuse, no paste on reprocess, and failure preservation:

```js
test("an exact snippet bypasses text polishing and is saved", async () => {
  const service = createService({
    snippets: [{ id: "s1", trigger: "地址", text: "上海市浦东新区" }]
  });
  const entry = await service.processWav(wav);
  assert.equal(entry.text, "上海市浦东新区");
  assert.equal(entry.source, "snippet");
  assert.equal(entry.snippetId, "s1");
  assert.equal(service.polishCalls.length, 0);
});

test("reprocess uses the immutable transcript and preserves current text on failure", async () => {
  const actions = createHistoryActions(harness);
  await assert.rejects(actions.reprocess("h1"));
  const current = await harness.settingsStore.getHistoryEntry("h1");
  assert.equal(current.transcript, "原始转写");
  assert.equal(current.text, "用户已编辑文本");
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
node --test tests/dictation-service.test.js tests/history-actions.test.js
```

Expected: failures for missing `processTranscript`, snippet metadata, and history actions.

- [ ] **Step 3: Extract reusable transcript processing**

Add this public method:

```js
async processTranscript(transcript, { settings, providers } = {}) {
  const effectiveSettings = settings || await this.settingsStore.getSettings({ includeSecrets: true });
  const effectiveProviders = providers || this.providerStatus(effectiveSettings);
  // Return processing fields only. Do not paste and do not write history here.
}
```

The returned object is:

```js
{
  transcript,
  text,
  status,
  processingError,
  detectedLanguage,
  providerMode,
  source: "dictation" | "snippet",
  snippetId: ""
}
```

`processWav` obtains settings/providers once, transcribes once, calls `processTranscript`, creates the new ID/timestamps/paste fields, performs optional paste, and writes one history entry.

For target-language output, keep the current provider readiness check. For automatic output, provider failure returns the raw transcript as `partial`; it must not erase same-language text.

- [ ] **Step 4: Implement history actions**

`updateText(id, text)` returns `{ ok: true, entry }` or `{ ok: false, reason: "not_found" }`.

`reprocess(id)`:

1. loads the current entry;
2. rejects missing entries or missing original transcript with stable reasons;
3. calls `dictationService.processTranscript(entry.transcript)`;
4. updates only processing fields on success;
5. leaves persisted text unchanged when processing throws.

- [ ] **Step 5: Verify dictation and history tests**

Run:

```powershell
node --test tests/dictation-service.test.js tests/history-actions.test.js tests/text-cleanup.test.js tests/language-detection.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/main/history-actions.js src/main/dictation-service.js tests/history-actions.test.js tests/dictation-service.test.js
git commit -m "feat: add snippets and history reprocessing"
```

---

### Task 6: Expose Narrow, Authorized History IPC

**Files:**
- Create: `src/main/ipc-authorization.js`
- Create: `tests/ipc-authorization.test.js`
- Modify: `src/main/index.js:351-446`
- Modify: `src/preload.cjs:1-42`
- Modify: `scripts/electron-app-smoke.mjs`

**Interfaces:**
- Consumes: the current `mainWindow.webContents`, `historyActions.updateText`, and `historyActions.reprocess`.
- Produces: renderer APIs `updateHistory(id, text)` and `reprocessHistory(id)`.

- [ ] **Step 1: Write failing sender-authorization tests**

```js
test("accepts only the current live window webContents", () => {
  const webContents = { isDestroyed: () => false };
  const window = { isDestroyed: () => false, webContents };
  assert.equal(isAuthorizedWindowSender({ sender: webContents }, window), true);
  assert.equal(isAuthorizedWindowSender({ sender: {} }, window), false);
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
node --test tests/ipc-authorization.test.js
```

Expected: failure because the authorization module does not exist.

- [ ] **Step 3: Implement and wire authorized IPC**

Create:

```js
export function isAuthorizedWindowSender(event, window) {
  return Boolean(
    event?.sender &&
    window &&
    !window.isDestroyed?.() &&
    !window.webContents?.isDestroyed?.() &&
    event.sender === window.webContents
  );
}
```

Register:

```js
ipcMain.handle("history:update", async (event, payload = {}) => {
  if (!isAuthorizedWindowSender(event, mainWindow)) {
    return { ok: false, reason: "unauthorized" };
  }
  return historyActions.updateText(payload.id, payload.text);
});

ipcMain.handle("history:reprocess", async (event, id) => {
  if (!isAuthorizedWindowSender(event, mainWindow)) {
    return { ok: false, reason: "unauthorized" };
  }
  return historyActions.reprocess(id);
});
```

Instantiate `historyActions` after `dictationService`. Add both channel names and deterministic handlers to the Electron smoke registry.

- [ ] **Step 4: Add the preload contract**

Expose only:

```js
updateHistory: (id, text) => ipcRenderer.invoke("history:update", { id, text }),
reprocessHistory: (id) => ipcRenderer.invoke("history:reprocess", id),
```

Do not expose raw `ipcRenderer`.

- [ ] **Step 5: Verify authorization and app smoke**

Run:

```powershell
node --test tests/ipc-authorization.test.js tests/renderer-markup.test.js
npm.cmd run check:app
```

Expected: unit tests pass and smoke output contains `"ok": true`.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/main/ipc-authorization.js src/main/index.js src/preload.cjs tests/ipc-authorization.test.js scripts/electron-app-smoke.mjs
git commit -m "feat: expose authorized history actions"
```

---

### Task 7: Add Pure History Projection And Versioned Autosave

**Files:**
- Create: `src/renderer/history-view-state.js`
- Create: `src/renderer/versioned-autosave.js`
- Create: `tests/history-view-state.test.js`
- Create: `tests/versioned-autosave.test.js`
- Modify: `src/renderer/main-view-state.js:1-87`
- Modify: `tests/main-view-state.test.js:1-135`

**Interfaces:**
- Consumes: raw history entries, a search query, local `Date`, and `save({ id, text, version })`.
- Produces: `normalizeHistoryEntries`, `filterHistory`, `groupHistoryByDate`, `resolveHistorySelection`, and `createVersionedAutosave`.

- [ ] **Step 1: Write failing history-view tests**

```js
test("groups today, yesterday, and older records without dropping failures", () => {
  const groups = groupHistoryByDate(entries, {
    now: new Date("2026-07-27T12:00:00+08:00")
  });
  assert.deepEqual(groups.map((group) => group.key), ["today", "yesterday", "2026-07-20"]);
  assert.equal(groups.flatMap((group) => group.entries).some((entry) => entry.status === "failed"), true);
});

test("search is case-insensitive and reads transcript plus displayed text", () => {
  assert.deepEqual(filterHistory(entries, "qwen").map((entry) => entry.id), ["h2"]);
});
```

- [ ] **Step 2: Write failing autosave concurrency tests**

```js
test("serializes saves and reports saved only for the latest version", async () => {
  const harness = createAutosaveHarness();
  harness.autosave.schedule({ id: "h1", text: "first" });
  harness.flushTimer();
  harness.autosave.schedule({ id: "h1", text: "second" });
  harness.flushTimer();
  assert.equal(harness.maxConcurrentSaves, 1);
  await harness.autosave.flush();
  assert.equal(harness.saved.at(-1).text, "second");
  assert.equal(harness.states.at(-1).phase, "saved");
});
```

- [ ] **Step 3: Verify both test files fail**

Run:

```powershell
node --test tests/history-view-state.test.js tests/versioned-autosave.test.js
```

Expected: failures because both modules are missing.

- [ ] **Step 4: Implement the pure history view model**

Normalized entries preserve failed/partial rows and add:

```js
{
  id,
  text,
  transcript,
  createdAt,
  status,
  characterCount,
  searchableText
}
```

`filterHistory` trims and normalizes the query. `groupHistoryByDate` returns:

```js
[
  { key: "today", labelKey: "history.group.today", entries: [] },
  { key: "yesterday", labelKey: "history.group.yesterday", entries: [] },
  { key: "2026-07-20", label: "2026-07-20", entries: [] }
]
```

`resolveHistorySelection(entries, selectedId)` keeps a still-valid selection, otherwise selects the newest complete/partial entry, otherwise the first entry, otherwise returns `""`.

- [ ] **Step 5: Implement serialized autosave**

Use this API:

```js
const autosave = createVersionedAutosave({
  delayMs: 450,
  save: ({ id, text, version }) => api.updateHistory(id, text),
  onState: ({ phase, id, version, error }) => renderSaveState(...)
});

autosave.schedule({ id, text });
await autosave.flush();
autosave.cancel();
```

The queue may execute an older save first, but it must never report that version as current after a newer version is scheduled. `flush()` waits for the timer and the entire serial promise chain.

- [ ] **Step 6: Verify view-state tests**

Run:

```powershell
node --test tests/history-view-state.test.js tests/versioned-autosave.test.js tests/main-view-state.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/renderer/history-view-state.js src/renderer/versioned-autosave.js src/renderer/main-view-state.js tests/history-view-state.test.js tests/versioned-autosave.test.js tests/main-view-state.test.js
git commit -m "feat: add history view state and autosave queue"
```

---

### Task 8: Replace The V3 Dashboard With The V4 Product Shell

**Files:**
- Modify: `src/renderer/index.html:1-396`
- Modify: `src/renderer/styles.css:1-1123`
- Modify: `src/renderer/app.js:1-1782`
- Modify: `src/renderer/i18n.js:1-1262`
- Modify: `tests/renderer-markup.test.js:1-617`
- Modify: `tests/i18n.test.js:1-246`
- Modify: `scripts/electron-app-smoke.mjs`

**Interfaces:**
- Consumes: existing recording/settings/model APIs and Task 7 history projections.
- Produces: a functional native-frame shell with top status, command strip, Home/History navigation, searchable list, selected editor, and settings drawer.

- [ ] **Step 1: Replace V3 markup expectations with failing V4 structure tests**

Require these exact landmarks:

```js
for (const id of [
  "appSidebar",
  "navHome",
  "navHistory",
  "navSettings",
  "appTopbar",
  "globalSearch",
  "commandStrip",
  "recordButton",
  "historyPane",
  "historySearch",
  "historyList",
  "editorPane",
  "editorBack",
  "resultText",
  "settingsDrawer"
]) {
  assert.match(html, new RegExp(`id="${id}"`));
}
```

Assert the old tablist, recent-history card, footer health strip, and duplicated window controls are absent.

- [ ] **Step 2: Verify markup tests fail**

Run:

```powershell
node --test tests/renderer-markup.test.js tests/i18n.test.js
```

Expected: failures because V3 markup still exists.

- [ ] **Step 3: Build the semantic V4 shell**

The final hierarchy is:

```html
<main class="app-layout">
  <aside id="appSidebar" class="app-sidebar">
    <nav aria-label="主要导航">...</nav>
  </aside>
  <section class="app-main">
    <header id="appTopbar" class="app-topbar">...</header>
    <section id="commandStrip" class="command-strip">...</section>
    <section id="workspacePage" class="workspace-page">
      <section id="historyPane" class="history-pane">...</section>
      <section id="editorPane" class="editor-pane">...</section>
    </section>
  </section>
</main>
```

Retain IDs needed by the proven recorder and settings/model flows. Do not render model paths, install output, or provider diagnostics outside the settings drawer.

- [ ] **Step 4: Apply the approved visual tokens and responsive contract**

Define CSS custom properties:

```css
:root {
  --page: #f5f7f6;
  --surface: #ffffff;
  --sidebar: #f0f3f2;
  --text: #17211e;
  --muted: #66716d;
  --line: #dce3e0;
  --accent: #078a68;
  --recording: #e2554f;
  --warning: #a96f16;
  --error: #b83a3a;
  --focus: #1769e0;
}
```

At `min-width: 1000px`, use an expanded sidebar and `44% 56%` history/editor columns. From `900px` through `999px`, use a 64px icon sidebar and keep the history pane at least 280px. Below `900px`, show one workspace pane at a time using `body[data-workspace-pane="list"|"editor"]`.

Do not add gradients, decorative blobs, nested cards, or radii above 8px outside the HUD.

- [ ] **Step 5: Replace tab orchestration with navigation orchestration**

Use:

```js
function activatePrimaryView(view, { focus = false } = {}) {
  if (view === "settings") {
    openSettingsDrawer();
    return;
  }
  activePrimaryView = view === "history" ? "history" : "home";
  document.body.dataset.primaryView = activePrimaryView;
  syncPrimaryNavigation({ focus });
  if (activePrimaryView === "history") historySearch.focus();
}
```

Home selects the newest usable history result. History preserves the current query and selection. Settings opens the existing drawer without clearing the current page.

Wire `historySearch` and `globalSearch` to the same cached projection; neither input may call `listHistory()` on every keystroke.

- [ ] **Step 6: Add complete shell translations**

Add V4 keys to all eight dictionaries, including:

```js
"nav.home",
"nav.history",
"nav.dictionary",
"nav.snippets",
"nav.settings",
"history.search",
"history.group.today",
"history.group.yesterday",
"history.back",
"editor.saved",
"editor.saving",
"editor.saveFailed"
```

Every dictionary must contain a non-empty value for every new key.

- [ ] **Step 7: Update Electron smoke assertions**

The smoke test must verify:

- Chinese is the default interface language;
- Home is selected;
- command strip and start button are visible inside `1180 x 800`;
- fixtures spanning today, yesterday, and an older date render as three cached history groups;
- selecting a history row opens the editor;
- resizing to `780 x 600` changes to list/editor master-detail behavior;
- arrow-key and Tab navigation expose `aria-current`, selected-row state, and a reachable “返回历史” action;
- settings opens and restores focus;
- no unsafe diagnostic appears in main visible text.

- [ ] **Step 8: Verify shell behavior**

Run:

```powershell
node --test tests/renderer-markup.test.js tests/i18n.test.js tests/history-view-state.test.js
npm.cmd run check:app
```

Expected: all tests pass and smoke output contains `"ok": true`.

- [ ] **Step 9: Commit**

Run:

```powershell
git add src/renderer/index.html src/renderer/styles.css src/renderer/app.js src/renderer/i18n.js tests/renderer-markup.test.js tests/i18n.test.js scripts/electron-app-smoke.mjs
git commit -m "feat: replace dashboard with Windows UI v4 shell"
```

---

### Task 9: Connect Editable History, Autosave, Insert, And Reprocess

**Files:**
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/i18n.js`
- Modify: `tests/renderer-markup.test.js`
- Modify: `scripts/electron-app-smoke.mjs`

**Interfaces:**
- Consumes: `window.localFlow.updateHistory`, `window.localFlow.reprocessHistory`, Task 7 autosave, and the selected normalized history entry.
- Produces: real editor actions and safe save/reprocess states.

- [ ] **Step 1: Add failing smoke coverage for real history operations**

Extend smoke fixtures with `transcript`, mutable text, and captured API calls. Assert:

```js
await editSelectedHistory("用户编辑后的文本");
await waitForState(window, (state) => state.editorSaveState === "saved", 5000);
assert.deepEqual(historyUpdateCalls.at(-1), {
  id: "history-zh",
  text: "用户编辑后的文本"
});
```

Also assert copy, insert, restore-to-last-saved, successful reprocess, and failed reprocess preserving existing editor text.

- [ ] **Step 2: Verify the extended smoke fails**

Run:

```powershell
npm.cmd run check:app
```

Expected: failure because history autosave/reprocess controls are not wired.

- [ ] **Step 3: Wire selection and editor metadata**

Selecting an entry must set:

```js
selectedHistoryId = entry.id;
editorState = createEditorState(entry.text || entry.transcript || "");
editorMetadata.textContent = formatEditorMetadata(entry);
document.body.dataset.workspacePane = "editor";
```

Failed entries remain selectable. They show a safe recovery explanation and enable reprocess only when `transcript` is non-empty.

- [ ] **Step 4: Wire versioned autosave**

On editor input:

```js
editorState = replaceEditorText(editorState, resultText.textContent || "");
historyAutosave.schedule({
  id: selectedHistoryId,
  text: editorState.currentText
});
renderEditorState({ syncText: false });
```

On successful latest save, replace the baseline and update the cached history entry. On failure, keep the editor content and show the localized retry state. Flush autosave before selection changes and before reprocess.

- [ ] **Step 5: Wire editor commands**

- Restore returns to the latest successfully saved baseline.
- Copy uses the current editor text.
- Insert sends the current editor text through `insertText` and retains it after any paste failure.
- Reprocess calls `reprocessHistory(selectedHistoryId)`, replaces the editor only on `{ ok: true, entry }`, and retains current text for every error result.

- [ ] **Step 6: Verify history workflow**

Run:

```powershell
node --test tests/versioned-autosave.test.js tests/renderer-markup.test.js
npm.cmd run check:app
```

Expected: all tests pass; unsafe path/error strings remain absent from visible history and editor text.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/renderer/app.js src/renderer/index.html src/renderer/styles.css src/renderer/i18n.js tests/renderer-markup.test.js scripts/electron-app-smoke.mjs
git commit -m "feat: add editable reusable dictation history"
```

---

### Task 10: Add Functional Dictionary And Quick-Snippet Pages

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/i18n.js`
- Modify: `src/main/tray-menu.js`
- Modify: `tests/renderer-markup.test.js`
- Modify: `tests/i18n.test.js`
- Modify: `tests/tray-menu.test.js`
- Modify: `scripts/electron-app-smoke.mjs`

**Interfaces:**
- Consumes: normalized `settings.dictionary`, normalized `settings.snippets`, and serialized `saveSettings`.
- Produces: five working sidebar destinations and immediate personalization persistence.

- [ ] **Step 1: Add failing markup and translation tests**

Require:

```js
for (const id of [
  "navDictionary",
  "navSnippets",
  "dictionaryPage",
  "dictionarySearch",
  "dictionaryList",
  "dictionaryAdd",
  "snippetsPage",
  "snippetSearch",
  "snippetList",
  "snippetAdd",
  "manageDictionary"
]) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.doesNotMatch(html, /<textarea[^>]*id="dictionary"/);
```

Require non-empty CRUD/search strings in all eight language dictionaries.

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
node --test tests/renderer-markup.test.js tests/i18n.test.js
```

Expected: failure because personalization pages are absent and the settings textarea remains.

- [ ] **Step 3: Add the two unframed management pages**

Each page has one page header, search, add command, separator list, inline add/edit row, and icon actions. Do not wrap the page in a decorative card.

Dictionary rows contain one term. Snippet rows contain trigger, expansion preview, edit, copy, and delete.

- [ ] **Step 4: Implement dictionary CRUD**

Use `normalizeDictionary` before every render/save. Add/edit/delete update the in-memory settings snapshot and enqueue:

```js
await enqueueSettingsOperation(() => window.localFlow.saveSettings({
  dictionary: nextDictionary
}));
```

Empty, whitespace-only, duplicate, and over-limit terms must never be persisted.

- [ ] **Step 5: Implement snippet CRUD**

Create new records with:

```js
{
  id: crypto.randomUUID(),
  trigger: triggerInput.value,
  text: expansionInput.value
}
```

Normalize before saving. Use exact-match copy in the UI: never imply that snippets trigger inside longer sentences.

- [ ] **Step 6: Simplify settings**

Remove the dictionary textarea. `manageDictionary` closes the settings drawer and activates the dictionary page. Keep the four settings groups; Advanced remains hidden until explicitly selected.

- [ ] **Step 7: Complete system-surface localization**

Extend tray labels, phase labels, settings actions, and the close-to-tray background notice for all eight interface languages. `getTrayTooltip`, `buildTrayMenuTemplate`, and the background notice must select the exact normalized interface language and fall back to English only for an unknown code.

- [ ] **Step 8: Extend Electron smoke**

Test:

- all five navigation controls work;
- dictionary add/edit/delete persists normalized arrays;
- duplicate dictionary terms are rejected;
- snippet add/edit/copy/delete persists stable IDs;
- settings “管理个人词典” navigates correctly;
- no model setup details leak onto personalization pages.

- [ ] **Step 9: Verify personalization flows**

Run:

```powershell
node --test tests/personalization.test.js tests/renderer-markup.test.js tests/i18n.test.js tests/tray-menu.test.js
npm.cmd run check:app
```

Expected: all tests and smoke pass.

- [ ] **Step 10: Commit**

Run:

```powershell
git add src/renderer/index.html src/renderer/styles.css src/renderer/app.js src/renderer/i18n.js src/main/tray-menu.js tests/renderer-markup.test.js tests/i18n.test.js tests/tray-menu.test.js scripts/electron-app-smoke.mjs
git commit -m "feat: add dictionary and quick snippets"
```

---

### Task 11: Make The Recording HUD Actionable

**Files:**
- Create: `src/main/hud-actions.js`
- Create: `tests/hud-actions.test.js`
- Modify: `src/main/system-input-controller.js:1-211`
- Modify: `tests/system-input-controller.test.js:1-403`
- Modify: `src/main/hud-window.js:1-53`
- Modify: `tests/hud-window.test.js:1-27`
- Modify: `src/main/index.js`
- Modify: `src/hud-preload.cjs:1-7`
- Modify: `src/renderer/hud.html:1-24`
- Modify: `src/renderer/hud.js:1-41`
- Modify: `src/renderer/hud-state.js:1-165`
- Modify: `tests/hud-state.test.js:1-274`
- Modify: `tests/renderer-markup.test.js`
- Modify: `scripts/electron-app-smoke.mjs`

**Interfaces:**
- Consumes: `systemInputController.stop()`, new `systemInputController.cancel()`, `showMainWindow()`, Electron `globalShortcut`, and HUD sender authorization.
- Produces: HUD preload methods `stop()`, `cancel()`, `openMainWindow()` and a temporary global Escape binding while recording.

- [ ] **Step 1: Write failing controller and HUD-action tests**

```js
test("cancel resets the renderer and returns directly to idle", async () => {
  const resets = [];
  const controller = createSystemInputController({
    requestRendererReset: () => resets.push("reset")
  });
  controller.setPhase("recording");
  await controller.cancel();
  assert.deepEqual(resets, ["reset"]);
  assert.equal(controller.getState().phase, "idle");
});

test("Escape is registered only during cancellable recording phases", () => {
  const harness = createHudActionsHarness();
  harness.actions.syncPhase("recording");
  assert.deepEqual(harness.registered, ["Escape"]);
  harness.actions.syncPhase("transcribing");
  assert.deepEqual(harness.unregistered, ["Escape"]);
});
```

- [ ] **Step 2: Verify HUD tests fail**

Run:

```powershell
node --test tests/system-input-controller.test.js tests/hud-actions.test.js tests/hud-window.test.js tests/hud-state.test.js
```

Expected: failures for cancel, polishing, actions, and new dimensions.

- [ ] **Step 3: Add explicit polishing and cancel behavior**

Keep `polishing` distinct in `validPhases`, `normalizeRendererPhase`, `isBusyPhase`, main-process phase sets, and HUD labels.

Add:

```js
async function cancel() {
  if (state.phase !== "starting" && state.phase !== "recording") return;
  requestRendererReset();
  setPhase("idle");
}
```

Return `cancel` from the controller.

- [ ] **Step 4: Implement HUD action controller**

`createHudActions` returns:

```js
{
  stop: () => systemInputController.stop(),
  cancel: () => systemInputController.cancel(),
  openMainWindow: () => revealMainWindow(),
  syncPhase(phase),
  dispose()
}
```

`syncPhase` registers global `Escape` during `starting`/`recording`, unregisters it for every other phase, and never unregisters unrelated shortcuts.

- [ ] **Step 5: Authorize HUD IPC**

Expose from `hud-preload.cjs`:

```js
stop: () => ipcRenderer.send("hud:stop"),
cancel: () => ipcRenderer.send("hud:cancel"),
openMainWindow: () => ipcRenderer.send("hud:open-main-window"),
```

In `src/main/index.js`, ignore each channel unless `event.sender === hudWindow.webContents`.

- [ ] **Step 6: Build the interactive HUD**

Set the BrowserWindow to `460 x 72`, bottom-center, frameless, skipped from taskbar, always on top, and `focusable: false`.

Add:

- waveform/status region;
- elapsed timer;
- cancel icon button and stop icon button during `starting`/`recording`;
- “打开 Local Flow” action during warning/error;
- localized `aria-label` and title text;
- no paths or raw provider errors.

Expand `hudLabels` and reason text to all eight interface languages. `getHudViewState` must honor every normalized interface code and fall back to English only for an unknown code.

- [ ] **Step 7: Verify HUD and Electron smoke**

Run:

```powershell
node --test tests/system-input-controller.test.js tests/hud-actions.test.js tests/hud-window.test.js tests/hud-state.test.js tests/renderer-markup.test.js
npm.cmd run check:app
```

Expected: all tests pass; the smoke test invokes stop/cancel/open through authorized HUD IPC and confirms unauthorized main-window senders are ignored.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/main/hud-actions.js src/main/system-input-controller.js src/main/hud-window.js src/main/index.js src/hud-preload.cjs src/renderer/hud.html src/renderer/hud.js src/renderer/hud-state.js tests/hud-actions.test.js tests/system-input-controller.test.js tests/hud-window.test.js tests/hud-state.test.js tests/renderer-markup.test.js scripts/electron-app-smoke.mjs
git commit -m "feat: add actionable recording hud"
```

---

### Task 12: Add Visual Regression And Complete Application Verification

**Files:**
- Create: `scripts/electron-visual-smoke.mjs`
- Modify: `package.json`
- Modify: `scripts/electron-app-smoke.mjs`
- Modify: `tests/packaging-config.test.js`
- Modify: `tests/renderer-markup.test.js`

**Interfaces:**
- Consumes: the approved reference image and a deterministic Electron smoke data set.
- Produces: `npm.cmd run check:visual`, three viewport screenshots, and one side-by-side comparison image.

- [ ] **Step 1: Add failing package and script-contract tests**

Require:

```js
assert.equal(pkg.scripts["check:visual"], "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer scripts/electron-visual-smoke.mjs");
```

Assert the visual script references exactly:

```js
[
  { width: 1180, height: 800, state: "desktop-split" },
  { width: 980, height: 720, state: "compact-split" },
  { width: 780, height: 600, state: "master-detail" }
]
```

- [ ] **Step 2: Verify contract tests fail**

Run:

```powershell
node --test tests/packaging-config.test.js tests/renderer-markup.test.js
```

Expected: failure because `check:visual` and its script do not exist.

- [ ] **Step 3: Implement deterministic visual capture**

The script must:

1. use the same fixture settings/history as app smoke;
2. load `src/renderer/index.html` with the real preload;
3. wait for fonts, history, icons, and layout;
4. capture PNGs to `.tmp/ui-v4-visual/`;
5. show the editor in both wide captures;
6. capture both list and editor state at `780 x 600`;
7. render a comparison page containing the approved reference and `1180 x 800` capture side by side;
8. capture `.tmp/ui-v4-visual/reference-comparison.png`;
9. set zoom factor to `2` and verify the `780 x 600` master-detail workflow still exposes search, select, edit, copy, and insert;
10. fail on console errors, blank captures, horizontal overflow, clipped command controls, missing focus indicators, or overlapping bounding boxes.

Use Electron `webContents.capturePage()`; do not add Playwright or a browser dependency.

- [ ] **Step 4: Run the complete automated suite**

Run:

```powershell
npm.cmd test
npm.cmd run check:app
npm.cmd run check:microphone
npm.cmd run check:visual
```

Expected: all commands exit `0`. The microphone check must report permission/device state clearly; an OS denial is a real failure to resolve, not a skipped pass.

- [ ] **Step 5: Inspect the combined visual input**

Open and inspect:

```text
.tmp/ui-v4-visual/reference-comparison.png
.tmp/ui-v4-visual/desktop-split.png
.tmp/ui-v4-visual/compact-split.png
.tmp/ui-v4-visual/master-detail-list.png
.tmp/ui-v4-visual/master-detail-editor.png
```

Compare hierarchy, density, spacing, button fit, focus states, text clipping, and the bottom HUD. Apply bounded HTML/CSS fixes and rerun Steps 4-5 until no visible mismatch blocks use.

- [ ] **Step 6: Commit**

Run:

```powershell
git add scripts/electron-visual-smoke.mjs scripts/electron-app-smoke.mjs package.json tests/packaging-config.test.js tests/renderer-markup.test.js src/renderer/index.html src/renderer/styles.css src/renderer/app.js
git commit -m "test: add Windows UI v4 visual regression"
```

---

### Task 13: Verify Packaged Single-Instance Startup And Produce The Installer

**Files:**
- Modify: `scripts/packaged-start-smoke.mjs`
- Modify: `scripts/product-readiness-report.mjs`
- Modify: `scripts/verify-release-build.mjs`
- Modify: `tests/release-polish.test.js`
- Modify: `tests/packaging-config.test.js`
- Modify: `docs/release/product-trial-guide.md`

**Interfaces:**
- Consumes: `dist/win-unpacked/Local Flow.exe`, single-instance behavior, visual/app/microphone checks, and release manifests.
- Produces: a verified unpacked app, NSIS installer, startup smoke JSON, and updated Chinese trial instructions.

- [ ] **Step 1: Add failing packaged-start expectations**

The packaged smoke must verify:

```js
{
  ok: true,
  hiddenLaunchStayedAlive: true,
  secondLaunchExited: true,
  secondLaunchRevealedExistingWindow: true,
  duplicateMainInstances: 0
}
```

Use one isolated `--user-data-dir`. Start the first instance with `--hidden`, start a second instance without `--hidden`, require the second process to exit promptly, require the first process to remain alive, and poll Windows process window handles to confirm a Local Flow window becomes visible.

- [ ] **Step 2: Verify release tests fail before script changes**

Run:

```powershell
node --test tests/release-polish.test.js tests/packaging-config.test.js
```

Expected: failure because packaged single-instance fields and V4 release evidence are absent.

- [ ] **Step 3: Implement packaged startup verification**

Use `powershell.exe -NoProfile -Command` from Node to inspect Local Flow processes whose executable path equals the tested `exePath`. A visible window requires at least one non-zero `MainWindowHandle`. Count only top-level app launches, not Electron renderer/helper child processes, when reporting duplicate main instances.

Always terminate the isolated smoke instance in `finally` and delete only the known `.tmp/packaged-start-smoke-user-data` directory.

- [ ] **Step 4: Update readiness and trial documentation**

Require the V4 design spec and reference image in product readiness. Update the Chinese trial guide with:

- desktop/start-menu launch;
- global shortcut dictation;
- stop/cancel HUD;
- close-to-tray explanation;
- history edit/reprocess;
- dictionary/snippets;
- automatic language behavior;
- Qwen as optional;
- uninstall path.

- [ ] **Step 5: Run pre-package verification**

Run:

```powershell
npm.cmd test
npm.cmd run check:app
npm.cmd run check:microphone
npm.cmd run check:visual
```

Expected: all pass.

- [ ] **Step 6: Build and verify the unpacked app**

Run:

```powershell
npm.cmd run package:win
npm.cmd run check:packaged
```

Expected: package succeeds and packaged smoke prints every Task 13 boolean as `true`.

- [ ] **Step 7: Build and verify the installer**

Run:

```powershell
npm.cmd run dist:win
npm.cmd run check:product
npm.cmd run verify:release
```

Expected: all commands exit `0`, the installer exists under `dist`, and release verification confirms the bundled Whisper/Qwen manifests and runtime checks.

- [ ] **Step 8: Final clean-install trial**

Install into a user-selected non-system directory. Verify:

1. desktop and Start-menu shortcuts open the visible main window;
2. a second shortcut launch reveals the same instance;
3. closing hides to tray and shows the one-time explanation;
4. the global shortcut records, stops, transcribes, and inserts into Notepad;
5. Escape cancels an active recording without history;
6. automatic language preserves Chinese, English, Japanese, and one additional available language sample;
7. target-language conversion changes language only when explicitly selected;
8. dictionary and exact snippet behavior work;
9. the app still works when Qwen is absent;
10. uninstall removes the installed app without deleting unrelated user files.

- [ ] **Step 9: Commit**

Run:

```powershell
git add scripts/packaged-start-smoke.mjs scripts/product-readiness-report.mjs scripts/verify-release-build.mjs tests/release-polish.test.js tests/packaging-config.test.js docs/release/product-trial-guide.md
git commit -m "release: verify Windows UI v4 installer"
```

---

## Final Verification Gate

Run from the repository root:

```powershell
git status --short
npm.cmd test
npm.cmd run check:app
npm.cmd run check:microphone
npm.cmd run check:visual
npm.cmd run package:win
npm.cmd run check:packaged
npm.cmd run dist:win
npm.cmd run check:product
npm.cmd run verify:release
```

Expected:

- `git status --short` is clean before release artifacts are generated;
- all automated commands exit `0`;
- main launch is visible and hidden launch is explicit;
- only one Local Flow app instance owns tray/hotkeys/hooks;
- the approved V4 hierarchy is visibly matched at all three viewport sizes;
- every visible navigation and action is functional;
- automatic output preserves source language;
- Qwen absence does not block local Whisper dictation;
- the final NSIS installer is ready for user trial.
