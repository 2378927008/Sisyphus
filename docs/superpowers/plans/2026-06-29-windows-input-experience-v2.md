# Windows Input Experience V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Local Flow behave like a dependable Windows voice input companion: global shortcut starts/stops dictation in the background, HUD explains state, and paste failures keep text recoverable.

**Architecture:** Keep the existing Electron companion-app model. The main process owns system input state through `createSystemInputController`, the renderer owns microphone/WAV capture and dictation processing, the HUD is display-only, and the paste pipeline remains clipboard plus Windows `Ctrl+V` with explicit recovery metadata.

**Tech Stack:** Electron 38, Node test runner, browser renderer JavaScript, Windows PowerShell SendKeys paste command, local settings/history JSON store.

---

## File Structure

- Modify: `src/main/system-input-controller.js`
  - Own command timeout, terminal auto-idle, recording start timestamp, and recoverable error reasons.
- Modify: `tests/system-input-controller.test.js`
  - Add isolated state-machine tests for rapid toggles, renderer timeout, terminal auto-idle, and recording timestamp behavior.
- Modify: `src/main/index.js`
  - Delegate timeout/auto-idle to the controller, pass interface language into HUD state, and use provider readiness for shortcut not-ready errors.
- Modify: `tests/electron-runtime.test.js`
  - Extend static main-process checks for controller-owned timeout/reset and HUD language payload wiring.
- Modify: `src/main/tray-menu.js`
  - Repair Simplified Chinese labels and add retry/settings-oriented labels for warning/error states.
- Modify: `tests/tray-menu.test.js`
  - Assert readable Simplified Chinese labels and state-aware tooltip/menu behavior.
- Modify: `src/main/paste.js`
  - Add typed paste errors for clipboard and SendKeys failures while keeping command construction allowlisted.
- Modify: `src/main/dictation-service.js`
  - Return a recoverable entry when paste fails after transcription succeeds.
- Modify: `tests/paste.test.js`
  - Cover clipboard failure and paste command failure reasons.
- Modify: `tests/dictation-service.test.js`
  - Cover paste failure history preservation and final warning notification.
- Create: `src/renderer/hud-state.js`
  - Pure HUD view model: localized titles/messages, elapsed timer formatting, safe message fallback.
- Modify: `src/renderer/hud.js`
  - Render HUD V2 from the pure view model and update timer while recording.
- Modify: `src/renderer/hud.html`
  - Replace damaged text with clean UTF-8 fallbacks and add timer/status slots.
- Modify: `src/renderer/styles.css`
  - Add compact pill HUD layout, stable dimensions, state colors, no-overflow behavior.
- Create: `tests/hud-state.test.js`
  - Test HUD labels, timer formatting, message sanitization, and Chinese/English behavior.

## Task 1: System Input Controller Reliability

**Files:**
- Modify: `src/main/system-input-controller.js`
- Modify: `tests/system-input-controller.test.js`

- [ ] **Step 1: Add failing controller tests**

Add these tests to `tests/system-input-controller.test.js`:

```js
test("system input controller resets renderer timeout to a terminal error", async () => {
  const states = [];
  const resetCalls = [];
  const timers = createManualTimers();
  const controller = createSystemInputController({
    sendToMain: (state) => states.push(state),
    requestRendererReset: () => resetCalls.push("reset"),
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    commandTimeoutMs: 10,
    startRecording: async () => controller.setPhase("starting", { message: "Starting" })
  });

  await controller.toggle();
  timers.runNext();

  assert.equal(controller.getState().phase, "error");
  assert.equal(controller.getState().reason, "renderer_timeout");
  assert.deepEqual(resetCalls, ["reset"]);
  assert.equal(states.at(-1).phase, "error");
});

test("system input controller auto-idles terminal phases", () => {
  const timers = createManualTimers();
  const controller = createSystemInputController({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    terminalAutoIdleMs: 10
  });

  controller.setPhase("done", { message: "Inserted" });
  const terminalUpdatedAt = controller.getState().updatedAt;
  timers.runNext();

  assert.equal(controller.getState().phase, "idle");
  assert.notEqual(controller.getState().updatedAt, terminalUpdatedAt);
});

test("system input controller does not auto-idle stale terminal timer after state changes", () => {
  const timers = createManualTimers();
  const controller = createSystemInputController({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    terminalAutoIdleMs: 10
  });

  controller.setPhase("warning", { message: "Needs review" });
  controller.setPhase("recording", { message: "Recording" });
  timers.runNext();

  assert.equal(controller.getState().phase, "recording");
});

test("system input controller stamps recording start time", () => {
  const controller = createSystemInputController({
    now: () => "2026-06-29T00:00:00.000Z"
  });

  controller.handleRendererStatus({ phase: "recording", message: "Recording" });

  assert.equal(controller.getState().recordingStartedAt, "2026-06-29T00:00:00.000Z");
});

function createManualTimers() {
  let id = 0;
  const timers = new Map();
  return {
    setTimeout(callback) {
      id += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
    runNext() {
      const [timerId, callback] = timers.entries().next().value || [];
      if (!timerId) return;
      timers.delete(timerId);
      callback();
    }
  };
}
```

- [ ] **Step 2: Run the focused failing test**

Run:

```powershell
npm.cmd test -- tests/system-input-controller.test.js
```

Expected before implementation: at least one failure mentioning unsupported timer options or missing timeout behavior.

- [ ] **Step 3: Implement controller timers and metadata**

Update `createSystemInputController` so the options include:

```js
requestRendererReset = () => {},
setTimeoutImpl = setTimeout,
clearTimeoutImpl = clearTimeout,
commandTimeoutMs = 8000,
terminalAutoIdleMs = 2500,
now = () => new Date().toISOString()
```

Inside the controller, keep:

```js
let commandTimeout = null;
let terminalAutoIdleTimeout = null;
```

Make `setPhase()` use `now()` for `updatedAt`, attach `recordingStartedAt` when entering `recording`, clear command timeouts on non-command phases, schedule command timeout for `starting` and `stopping`, and schedule terminal auto-idle for `done`, `warning`, and `error`.

The timeout callback must call:

```js
requestRendererReset();
setPhase("error", {
  reason: "renderer_timeout",
  message: phase === "starting" ? "Recording did not start." : "Recording did not stop."
});
```

Terminal auto-idle must only set `idle` when both the phase and `updatedAt` still match the terminal state that scheduled the timer.

- [ ] **Step 4: Run focused controller tests**

Run:

```powershell
npm.cmd test -- tests/system-input-controller.test.js
```

Expected: all system input controller tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/main/system-input-controller.js tests/system-input-controller.test.js
git commit -m "feat: harden system input controller lifecycle"
```

## Task 2: Main Process And Tray Wiring

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/main/tray-menu.js`
- Modify: `tests/electron-runtime.test.js`
- Modify: `tests/tray-menu.test.js`

- [ ] **Step 1: Add failing wiring and tray tests**

In `tests/electron-runtime.test.js`, add static assertions:

```js
test("main process delegates system input timeout reset to the controller", async () => {
  const source = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");

  assert.match(source, /requestRendererReset:\s*\(\)\s*=>\s*sendWindowMessage\(mainWindow,\s*"recording:reset"\)/);
  assert.doesNotMatch(source, /scheduleRecordingCommandTimeout\(/);
});

test("main process sends HUD language with system input state", async () => {
  const source = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");

  assert.match(source, /const hudState = \{\s*\.\.\.lastSystemInputState,\s*language/s);
  assert.match(source, /sendWindowMessage\(hudWindow,\s*"system-input:status",\s*hudState\)/);
});
```

In `tests/tray-menu.test.js`, replace the mojibake Chinese assertions with:

```js
test("buildTrayMenuTemplate returns readable Simplified Chinese labels", () => {
  const template = buildTrayMenuTemplate({ language: "zh-Hans" });

  assert.deepEqual(template.map(getVisibleMenuText), [
    "显示主窗口",
    "开始语音输入",
    "暂停全局快捷键",
    "separator",
    "开机自启",
    "启动后最小化到托盘",
    "separator",
    "设置",
    "退出"
  ]);
});

test("getTrayTooltip returns readable localized phase status", () => {
  assert.equal(getTrayTooltip({ state: { phase: "recording" } }), "Local Flow - Recording");
  assert.equal(getTrayTooltip({ state: { phase: "pasting" } }), "Local Flow - Pasting");
  assert.equal(getTrayTooltip({
    language: "zh-Hans",
    state: { phase: "error" }
  }), "Local Flow - 错误");
  assert.equal(getTrayTooltip({
    language: "zh-Hans",
    state: { phase: "pasting" }
  }), "Local Flow - 正在粘贴");
});
```

- [ ] **Step 2: Run focused failing tests**

Run:

```powershell
npm.cmd test -- tests/electron-runtime.test.js tests/tray-menu.test.js
```

Expected before implementation: failures for `scheduleRecordingCommandTimeout`, missing `hudState`, and old Chinese labels.

- [ ] **Step 3: Update main-process wiring**

In `src/main/index.js`:

- remove `recordingCommandTimeout`, `terminalAutoIdleTimeout`, `recordingCommandTimeoutMs`, `terminalAutoIdleMs`, `scheduleRecordingCommandTimeout()`, `clearRecordingCommandTimeout()`, `scheduleTerminalAutoIdle()`, and `clearTerminalAutoIdle()`;
- remove calls to `scheduleRecordingCommandTimeout()` from `sendRecordingStartCommand()` and `sendRecordingStopCommand()`;
- remove command-timeout clearing from the `recording:status` IPC handler;
- create `hudState` in `sendSystemInputStatus()`:

```js
const hudState = {
  ...lastSystemInputState,
  language: lastSettings?.interfaceLanguage || "zh-Hans"
};
sendWindowMessage(hudWindow, "system-input:status", hudState);
```

- pass controller options:

```js
requestRendererReset: () => sendWindowMessage(mainWindow, "recording:reset"),
isReadyToRecord: () => getProcessingProviderStatus(lastSettings || {}).readyToRecord
```

Keep main-window status payloads unchanged:

```js
sendWindowMessage(mainWindow, "system-input:status", state);
```

- [ ] **Step 4: Repair tray Chinese labels**

In `src/main/tray-menu.js`, replace `zh-Hans` entries with clean UTF-8 labels:

```js
"zh-Hans": {
  showMainWindow: "显示主窗口",
  startDictation: "开始语音输入",
  stopDictation: "停止语音输入",
  pauseShortcut: "暂停全局快捷键",
  resumeShortcut: "恢复全局快捷键",
  launchAtLogin: "开机自启",
  startMinimizedToTray: "启动后最小化到托盘",
  settings: "设置",
  quit: "退出"
}
```

and phase labels:

```js
"zh-Hans": {
  idle: "空闲",
  starting: "正在启动",
  recording: "正在录音",
  stopping: "正在停止",
  transcribing: "正在转写",
  pasting: "正在粘贴",
  done: "已完成",
  warning: "需要确认",
  error: "错误"
}
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/electron-runtime.test.js tests/tray-menu.test.js
```

Expected: both files pass.

- [ ] **Step 6: Commit**

```powershell
git add src/main/index.js src/main/tray-menu.js tests/electron-runtime.test.js tests/tray-menu.test.js
git commit -m "feat: wire hud language and tray state"
```

## Task 3: Paste Failure Recovery

**Files:**
- Modify: `src/main/paste.js`
- Modify: `src/main/dictation-service.js`
- Modify: `tests/paste.test.js`
- Modify: `tests/dictation-service.test.js`

- [ ] **Step 1: Add failing paste and dictation tests**

In `tests/paste.test.js`, add:

```js
import { pasteText } from "../src/main/paste.js";

test("pasteText reports unavailable clipboard distinctly", async () => {
  await assert.rejects(
    pasteText("hello", { clipboard: null }),
    (error) => error.code === "clipboard_unavailable"
  );
});

test("pasteText reports paste command failure distinctly after writing clipboard", async () => {
  const writes = [];
  await assert.rejects(
    pasteText("hello", {
      clipboard: { writeText: (text) => writes.push(text) },
      spawn: () => ({
        on(event, callback) {
          if (event === "close") callback(1);
          return this;
        }
      })
    }),
    (error) => error.code === "paste_failed"
  );

  assert.deepEqual(writes, ["hello"]);
});
```

In `tests/dictation-service.test.js`, add:

```js
test("processWav returns recoverable warning entry when paste fails", async () => {
  const history = [];
  const events = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, { pasteAfterTranscribe: true, historyLimit: 20 }),
    clipboard: {},
    transcribe: async () => "hello world",
    polish: async () => "hello world",
    paste: async () => {
      const error = new Error("Paste command exited with code 1.");
      error.code = "paste_failed";
      throw error;
    },
    notifyStatus: (event) => events.push(event)
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(entry.status, "complete");
  assert.equal(entry.pasteStatus, "failed");
  assert.equal(entry.pasteError, "Paste command exited with code 1.");
  assert.equal(history[0], entry);
  assert.equal(events.at(-1).phase, "warning");
  assert.equal(events.at(-1).reason, "paste_failed");
  assert.match(events.at(-1).message, /Text saved/);
});
```

- [ ] **Step 2: Run focused failing tests**

Run:

```powershell
npm.cmd test -- tests/paste.test.js tests/dictation-service.test.js
```

Expected before implementation: failures for missing `code`, thrown paste error, or missing `pasteStatus`.

- [ ] **Step 3: Add typed paste errors**

In `src/main/paste.js`, add:

```js
export class PasteError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PasteError";
    this.code = code;
  }
}
```

Throw `new PasteError("Clipboard integration is unavailable.", "clipboard_unavailable")` when `clipboard.writeText` is missing. Wrap `clipboard.writeText(text)` failures as `clipboard_unavailable`. Wrap child `error` and non-zero `close` as `paste_failed`.

- [ ] **Step 4: Make dictation paste failures recoverable**

In `src/main/dictation-service.js`, initialize each entry with:

```js
pasteStatus: settings.pasteAfterTranscribe ? "pending" : "skipped",
pasteError: ""
```

Move `addHistory()` after paste attempt. When text processing succeeded and `pasteAfterTranscribe` is true:

```js
try {
  this.notifyStatus({ phase: "pasting", message: "Pasting into the active app..." });
  await this.paste(text, { clipboard: this.clipboard });
  entry.pasteStatus = "complete";
} catch (error) {
  entry.pasteStatus = "failed";
  entry.pasteError = error instanceof Error ? error.message : String(error);
  pasteFailureReason = error?.code || "paste_failed";
}
```

Always call `addHistory(entry, settings.historyLimit)` after the paste block. If `pasteFailureReason` is set, notify:

```js
this.notifyStatus({
  phase: "warning",
  reason: pasteFailureReason,
  message: "Paste failed. Text saved."
});
return entry;
```

Do not throw paste failures after text creation succeeds.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/paste.test.js tests/dictation-service.test.js
```

Expected: focused tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/main/paste.js src/main/dictation-service.js tests/paste.test.js tests/dictation-service.test.js
git commit -m "feat: preserve dictation text when paste fails"
```

## Task 4: HUD V2 Rendering

**Files:**
- Create: `src/renderer/hud-state.js`
- Modify: `src/renderer/hud.js`
- Modify: `src/renderer/hud.html`
- Modify: `src/renderer/styles.css`
- Create: `tests/hud-state.test.js`

- [ ] **Step 1: Add failing HUD view-model tests**

Create `tests/hud-state.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { formatElapsed, getHudViewState } from "../src/renderer/hud-state.js";

test("getHudViewState returns readable Chinese recording state", () => {
  const view = getHudViewState({
    phase: "recording",
    language: "zh-Hans",
    recordingStartedAt: "2026-06-29T00:00:00.000Z"
  }, {
    nowMs: Date.parse("2026-06-29T00:00:07.000Z")
  });

  assert.equal(view.title, "正在录音");
  assert.equal(view.message, "再次按快捷键停止");
  assert.equal(view.elapsed, "00:07");
});

test("getHudViewState returns concise paste failure warning", () => {
  const view = getHudViewState({
    phase: "warning",
    reason: "paste_failed",
    message: "Paste command exited with code 1.",
    language: "en"
  });

  assert.equal(view.title, "Needs review");
  assert.equal(view.message, "Paste failed. Text saved.");
  assert.equal(view.elapsed, "");
});

test("getHudViewState hides raw diagnostics in HUD messages", () => {
  const view = getHudViewState({
    phase: "error",
    reason: "renderer_timeout",
    message: "C:/Users/Administrator/vendor/qwen/model.gguf spawn ENOENT stack trace",
    language: "zh-Hans"
  });

  assert.equal(view.title, "需要处理");
  assert.equal(view.message, "录音响应超时，请重试");
});

test("formatElapsed clamps invalid and long values", () => {
  assert.equal(formatElapsed(-1000), "00:00");
  assert.equal(formatElapsed(65_000), "01:05");
  assert.equal(formatElapsed(3_660_000), "61:00");
});
```

- [ ] **Step 2: Run failing HUD test**

Run:

```powershell
npm.cmd test -- tests/hud-state.test.js
```

Expected before implementation: module not found.

- [ ] **Step 3: Implement `hud-state.js`**

Create `src/renderer/hud-state.js` with exported functions:

```js
export function getHudViewState(state = {}, options = {}) {
  const phase = state.phase || "idle";
  const language = state.language === "en" ? "en" : "zh-Hans";
  const labels = hudLabels[language];
  const reasonMessage = labels.reasons[state.reason] || "";
  const title = labels.titles[phase] || labels.titles.idle;
  const message = reasonMessage || labels.messages[phase] || labels.messages.idle;
  const elapsed = phase === "recording"
    ? formatElapsed((options.nowMs ?? Date.now()) - Date.parse(state.recordingStartedAt || state.updatedAt || Date.now()))
    : "";

  return {
    phase,
    title,
    message: limitHudText(message),
    elapsed
  };
}

export function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
```

Include `hudLabels.en` and `hudLabels["zh-Hans"]` for phases `idle`, `starting`, `recording`, `stopping`, `transcribing`, `pasting`, `done`, `warning`, `error`, plus reasons `not_ready`, `renderer_timeout`, `recording_failed`, `transcription_failed`, `target_output_failed`, `clipboard_unavailable`, `paste_failed`.

- [ ] **Step 4: Wire HUD renderer**

In `src/renderer/hud.js`, import `getHudViewState`, keep the latest state, and update timer every 250ms only while `phase === "recording"`:

```js
import { getHudViewState } from "./hud-state.js";

let latestState = { phase: "idle", language: "zh-Hans" };
let timerId = null;

window.localFlow?.onSystemInputStatus?.((state) => {
  latestState = state || { phase: "idle", language: "zh-Hans" };
  renderHudState();
});
```

Render `#hudTitle`, `#hudMessage`, and `#hudTimer`; start/stop the interval in `syncTimer()`.

- [ ] **Step 5: Update HUD markup and CSS**

In `src/renderer/hud.html`, replace damaged defaults with:

```html
<main id="hudRoot" class="hud-shell" data-phase="idle">
  <span id="hudDot" class="hud-dot"></span>
  <div class="hud-copy">
    <strong id="hudTitle">Local Flow</strong>
    <p id="hudMessage">按快捷键开始或停止录音</p>
  </div>
  <time id="hudTimer" class="hud-timer" aria-live="off"></time>
</main>
```

In `src/renderer/styles.css`, keep HUD dimensions stable:

```css
.hud-shell {
  grid-template-columns: 14px minmax(0, 1fr) auto;
  min-width: 100vw;
  min-height: 100vh;
  border-radius: 999px;
}

.hud-copy {
  min-width: 0;
}

.hud-shell strong,
.hud-shell p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hud-timer {
  min-width: 48px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

Add state colors for `starting`, `stopping`, `transcribing`, `pasting`, `warning`, and `error`.

- [ ] **Step 6: Run HUD tests**

Run:

```powershell
npm.cmd test -- tests/hud-state.test.js tests/hud-window.test.js
```

Expected: HUD view-model and window tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/renderer/hud-state.js src/renderer/hud.js src/renderer/hud.html src/renderer/styles.css tests/hud-state.test.js
git commit -m "feat: add windows dictation hud v2"
```

## Task 5: Full Regression And Release Smoke

**Files:**
- Modify only if a focused test reveals a small integration gap.

- [ ] **Step 1: Run the full unit suite**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass.

- [ ] **Step 2: Run app smoke**

Run:

```powershell
npm.cmd run check:app
```

Expected: script exits `0` and reports `ok: true`.

- [ ] **Step 3: Run microphone smoke**

Run:

```powershell
npm.cmd run check:microphone
```

Expected: script exits `0`; if Windows denies microphone in the test session, record the exact permission error and do not claim microphone smoke passed.

- [ ] **Step 4: Inspect git state**

Run:

```powershell
git status --short --branch
git log --oneline --decorate -5
```

Expected: branch is `codex/windows-input-experience-v2`; only intentional commits are present; worktree is clean.

- [ ] **Step 5: Final implementation summary**

Report:

- worktree path;
- branch name;
- commits created;
- test commands and pass/fail counts;
- any manual test gaps, especially real Notepad/WeChat paste if not exercised.

## Self-Review

Spec coverage:

- Shortcut-driven dictation reliability: Task 1 and Task 2.
- Renderer command timeout and reset: Task 1 and Task 2.
- Terminal auto-idle: Task 1.
- Hidden/background main-window behavior: Task 2 keeps explicit renderer commands and HUD non-focus behavior.
- Paste failure preserves text: Task 3.
- Tray state and settings paths: Task 2.
- HUD states, timer, concise messages, and no raw diagnostics: Task 4.
- Auto language/Qwen behavior: preserved by existing provider tests and full regression in Task 5.
- Installer flow: not rebuilt in this plan; existing packaging remains untouched and full smoke verifies app behavior.

Placeholder scan:

- Placeholder scan passed; there are no deferred implementation markers.
- Every code-changing step names exact files and provides concrete code or exact behavior.

Type consistency:

- `reason` values match the V2 design: `not_ready`, `renderer_timeout`, `recording_failed`, `transcription_failed`, `target_output_failed`, `clipboard_unavailable`, `paste_failed`.
- HUD state uses `recordingStartedAt`, `updatedAt`, `phase`, `message`, `reason`, and `language`.
- Paste recovery adds `pasteStatus` and `pasteError` without changing existing `status` semantics.
