# Windows System Input V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Windows-wide Local Flow dictation loop: tray-first app, global shortcut, non-disruptive HUD, hidden main window recording, and paste into the active application.

**Architecture:** Keep the current Electron main window as the setup and recorder owner. Add a separate HUD window and a main-process dictation controller that broadcasts state to the main renderer, HUD renderer, and tray. Do not implement TSF/IME in this phase.

**Tech Stack:** Electron 38, Node.js ESM/CommonJS preload, renderer AudioWorklet recording, Windows clipboard plus SendKeys paste, node:test, Electron smoke scripts.

---

## File Structure

- Create `src/main/system-input-controller.js`: state machine for shortcut/tray/HUD coordination.
- Create `src/main/hud-window.js`: HUD BrowserWindow option construction and lifecycle helpers.
- Create `src/renderer/hud.html`: compact HUD surface.
- Create `src/renderer/hud.js`: HUD state rendering.
- Create `tests/system-input-controller.test.js`: controller transition tests.
- Create `tests/hud-window.test.js`: HUD option tests.
- Modify `src/main/index.js`: create HUD, wire controller, keep main window hidden during shortcut dictation.
- Modify `src/preload.cjs`: expose HUD status subscription without raw IPC access.
- Modify `src/renderer/app.js`: keep existing recording implementation but emit state-friendly status.
- Modify `src/renderer/styles.css`: add HUD styles or shared HUD-safe styles.
- Modify `scripts/electron-app-smoke.mjs`: assert HUD exists and global shortcut path does not require showing the settings window.
- Modify `README.md`: document system input mode and Qwen optional boundary.

---

### Task 1: Controller State Machine

**Files:**
- Create: `src/main/system-input-controller.js`
- Create: `tests/system-input-controller.test.js`

- [ ] **Step 1: Write failing controller tests**

Create `tests/system-input-controller.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createSystemInputController } from "../src/main/system-input-controller.js";

test("system input controller starts idle and broadcasts state changes", () => {
  const states = [];
  const controller = createSystemInputController({
    sendToMain: (state) => states.push({ target: "main", state }),
    sendToHud: (state) => states.push({ target: "hud", state })
  });

  assert.equal(controller.getState().phase, "idle");

  controller.setPhase("recording", { message: "Recording" });

  assert.equal(controller.getState().phase, "recording");
  assert.deepEqual(states.map((item) => item.target), ["main", "hud"]);
  assert.equal(states[0].state.message, "Recording");
});

test("system input controller toggles recording through injected callbacks", async () => {
  const calls = [];
  const controller = createSystemInputController({
    startRecording: async () => calls.push("start"),
    stopRecording: async () => calls.push("stop")
  });

  await controller.toggle();
  controller.setPhase("recording");
  await controller.toggle();

  assert.deepEqual(calls, ["start", "stop"]);
});

test("system input controller does not start when setup is not ready", async () => {
  const controller = createSystemInputController({
    isReadyToRecord: () => false,
    startRecording: async () => {
      throw new Error("should not start");
    }
  });

  await controller.toggle();

  assert.equal(controller.getState().phase, "error");
  assert.equal(controller.getState().reason, "not_ready");
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
node --test tests\system-input-controller.test.js
```

Expected: fail with module not found.

- [ ] **Step 3: Implement the controller**

Create `src/main/system-input-controller.js`:

```js
const validPhases = new Set(["idle", "recording", "transcribing", "pasting", "done", "error"]);

export function createSystemInputController({
  sendToMain = () => {},
  sendToHud = () => {},
  startRecording = async () => {},
  stopRecording = async () => {},
  isReadyToRecord = () => true
} = {}) {
  let state = {
    phase: "idle",
    message: "",
    reason: "",
    updatedAt: new Date().toISOString()
  };

  function getState() {
    return { ...state };
  }

  function setPhase(phase, patch = {}) {
    if (!validPhases.has(phase)) {
      throw new Error(`Unknown system input phase: ${phase}`);
    }
    state = {
      ...state,
      ...patch,
      phase,
      updatedAt: new Date().toISOString()
    };
    broadcast();
    return getState();
  }

  async function toggle() {
    if (state.phase === "recording") {
      await stopRecording();
      return;
    }

    if (!isReadyToRecord()) {
      setPhase("error", {
        reason: "not_ready",
        message: "Local Flow is not ready to record."
      });
      return;
    }

    await startRecording();
  }

  function handleRendererStatus(payload = {}) {
    const phase = normalizeRendererPhase(payload.phase);
    setPhase(phase, {
      message: payload.message || "",
      reason: payload.reason || ""
    });
  }

  function broadcast() {
    const snapshot = getState();
    sendToMain(snapshot);
    sendToHud(snapshot);
  }

  return {
    getState,
    setPhase,
    toggle,
    handleRendererStatus
  };
}

function normalizeRendererPhase(phase) {
  if (phase === "done") return "done";
  if (phase === "error") return "error";
  if (phase === "pasting") return "pasting";
  if (phase === "transcribing" || phase === "polishing") return "transcribing";
  return "idle";
}
```

- [ ] **Step 4: Verify green**

Run:

```powershell
node --test tests\system-input-controller.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/main/system-input-controller.js tests/system-input-controller.test.js
git commit -m "feat: add system input controller"
```

---

### Task 2: HUD Window

**Files:**
- Create: `src/main/hud-window.js`
- Create: `tests/hud-window.test.js`
- Create: `src/renderer/hud.html`
- Create: `src/renderer/hud.js`

- [ ] **Step 1: Write failing HUD option tests**

Create `tests/hud-window.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildHudWindowOptions } from "../src/main/hud-window.js";

test("buildHudWindowOptions creates a compact non-disruptive HUD", () => {
  const options = buildHudWindowOptions({ preloadPath: "C:/app/src/preload.cjs" });

  assert.equal(options.width, 360);
  assert.equal(options.height, 112);
  assert.equal(options.frame, false);
  assert.equal(options.resizable, false);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.focusable, false);
  assert.equal(options.webPreferences.preload, "C:/app/src/preload.cjs");
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
node --test tests\hud-window.test.js
```

Expected: fail with module not found.

- [ ] **Step 3: Implement HUD option helper**

Create `src/main/hud-window.js`:

```js
import path from "node:path";

export function buildHudWindowOptions({ preloadPath }) {
  return {
    width: 360,
    height: 112,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    transparent: false,
    backgroundColor: "#171717",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  };
}

export function getHudHtmlPath(rootDir) {
  return path.join(rootDir, "../renderer/hud.html");
}
```

- [ ] **Step 4: Add HUD renderer files**

Create `src/renderer/hud.html`:

```html
<!doctype html>
<html lang="zh-Hans">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'"
    />
    <title>Local Flow HUD</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body class="hud-body">
    <main id="hudRoot" class="hud-shell" data-phase="idle">
      <span id="hudDot" class="hud-dot"></span>
      <div>
        <strong id="hudTitle">Local Flow</strong>
        <p id="hudMessage">按快捷键开始或停止录音</p>
      </div>
    </main>
    <script type="module" src="./hud.js"></script>
  </body>
</html>
```

Create `src/renderer/hud.js`:

```js
const hudRoot = document.querySelector("#hudRoot");
const hudTitle = document.querySelector("#hudTitle");
const hudMessage = document.querySelector("#hudMessage");

const titleByPhase = {
  idle: "Local Flow",
  recording: "正在录音",
  transcribing: "正在转写",
  pasting: "正在粘贴",
  done: "已输入",
  error: "需要处理"
};

window.localFlow?.onSystemInputStatus?.((state) => {
  renderHudState(state);
});

function renderHudState(state = {}) {
  const phase = state.phase || "idle";
  hudRoot.dataset.phase = phase;
  hudTitle.textContent = titleByPhase[phase] || "Local Flow";
  hudMessage.textContent = state.message || "按快捷键开始或停止录音";
}
```

- [ ] **Step 5: Add HUD CSS**

Append to `src/renderer/styles.css`:

```css
.hud-body {
  margin: 0;
  overflow: hidden;
  background: transparent;
}

.hud-shell {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  width: 100vw;
  height: 100vh;
  padding: 18px 20px;
  color: #f7f3ea;
  background: #171717;
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.hud-shell strong {
  display: block;
  font-size: 15px;
  line-height: 1.2;
}

.hud-shell p {
  margin: 4px 0 0;
  color: rgba(247, 243, 234, 0.72);
  font-size: 13px;
  line-height: 1.35;
}

.hud-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #9ca3af;
}

.hud-shell[data-phase="recording"] .hud-dot {
  background: #ef4444;
}

.hud-shell[data-phase="done"] .hud-dot {
  background: #22c55e;
}

.hud-shell[data-phase="error"] .hud-dot {
  background: #f59e0b;
}
```

- [ ] **Step 6: Verify**

Run:

```powershell
node --test tests\hud-window.test.js
```

Expected: tests pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/main/hud-window.js tests/hud-window.test.js src/renderer/hud.html src/renderer/hud.js src/renderer/styles.css
git commit -m "feat: add system input hud"
```

---

### Task 3: Main Process Integration

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload.cjs`
- Modify: `tests/electron-runtime.test.js`
- Modify: `scripts/electron-app-smoke.mjs`

- [ ] **Step 1: Add failing preload test**

Add to `tests/electron-runtime.test.js`:

```js
test("preload exposes system input status listener without raw ipcRenderer access", async () => {
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  let exposedApi = null;
  const channels = [];

  const sandbox = {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name, api) => {
          exposedApi = api;
        }
      },
      ipcRenderer: {
        invoke: () => undefined,
        on: (channel, callback) => {
          channels.push(channel);
          callback({}, { phase: "recording" });
        }
      }
    })
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });

  const states = [];
  exposedApi.onSystemInputStatus((state) => states.push(state));

  assert.equal(exposedApi.ipcRenderer, undefined);
  assert.deepEqual(channels, ["system-input:status"]);
  assert.deepEqual(states, [{ phase: "recording" }]);
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
node --test tests\electron-runtime.test.js
```

Expected: fail because `onSystemInputStatus` is missing.

- [ ] **Step 3: Expose preload listener**

Modify `src/preload.cjs` to include:

```js
onSystemInputStatus: (callback) => {
  ipcRenderer.on("system-input:status", (_event, payload) => callback(payload));
}
```

- [ ] **Step 4: Wire main process**

Modify `src/main/index.js`:

- Import `createSystemInputController`, `buildHudWindowOptions`, and `getHudHtmlPath`.
- Add `let hudWindow; let systemInputController;`.
- Create `createHudWindow()` after `createWindow()`.
- Change global shortcut and tray "Start/stop dictation" to call `systemInputController.toggle()`.
- Keep `toggleRecording()` as the function that sends `recording:toggle` to the main renderer.
- Broadcast renderer status through `systemInputController.handleRendererStatus(payload)`.

Implementation shape:

```js
function createHudWindow() {
  hudWindow = new BrowserWindow(buildHudWindowOptions({
    preloadPath: path.join(__dirname, "../preload.cjs")
  }));
  hudWindow.loadFile(getHudHtmlPath(__dirname));
}

function sendSystemInputStatus(state) {
  mainWindow?.webContents.send("system-input:status", state);
  hudWindow?.webContents.send("system-input:status", state);
  if (state.phase === "recording" || state.phase === "transcribing" || state.phase === "pasting") {
    showHud();
  }
}

function showHud() {
  if (!hudWindow) return;
  hudWindow.showInactive ? hudWindow.showInactive() : hudWindow.show();
}
```

- [ ] **Step 5: Update smoke script**

Modify `scripts/electron-app-smoke.mjs` to assert:

- `src/renderer/hud.html` loads without console errors.
- `window.localFlow.onSystemInputStatus` exists.
- HUD DOM contains `#hudRoot`.

- [ ] **Step 6: Verify**

Run:

```powershell
node --test tests\electron-runtime.test.js tests\system-input-controller.test.js tests\hud-window.test.js
npm.cmd run check:app
```

Expected: tests and app smoke pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/main/index.js src/preload.cjs tests/electron-runtime.test.js scripts/electron-app-smoke.mjs
git commit -m "feat: wire system input hud"
```

---

### Task 4: Startup And Documentation Polish

**Files:**
- Modify: `README.md`
- Modify: `src/renderer/i18n.js`
- Modify: `scripts/electron-app-smoke.mjs`

- [ ] **Step 1: Document system input mode**

Add to `README.md`:

```markdown
## Windows System Input Mode

After Whisper is configured, Local Flow can be used from another app:

1. Focus a text field.
2. Press `Ctrl + Alt + Space`.
3. Speak.
4. Press `Ctrl + Alt + Space` again.
5. Local Flow transcribes and pastes the result into the focused field.

The small HUD is the normal repeated-use surface. The full window remains the setup, history, and recovery surface.
```

- [ ] **Step 2: Clarify Qwen boundary**

Add to `README.md`:

```markdown
Qwen3 is optional. If the built-in Qwen path fails, keep `文本模型提供方` set to `MyMemory Free` and `输出语言` set to `自动` for normal same-language dictation.
```

- [ ] **Step 3: Add localized HUD strings if HUD text moves into i18n**

If `hud.js` uses `data-i18n`, add keys for:

- `hud.idle`
- `hud.recording`
- `hud.transcribing`
- `hud.pasting`
- `hud.done`
- `hud.error`

- [ ] **Step 4: Run verification**

Run:

```powershell
npm.cmd test
npm.cmd run check:app
npm.cmd run check:microphone
```

Expected: all pass; app smoke emits `"ok": true`; microphone smoke emits `"ok": true`.

- [ ] **Step 5: Commit**

Run:

```powershell
git add README.md src/renderer/i18n.js scripts/electron-app-smoke.mjs
git commit -m "docs: document system input mode"
```

---

### Task 5: Qwen Stability Spike Plan

**Files:**
- Create: `docs/superpowers/specs/2026-06-27-qwen-runtime-stability-design.md`

- [ ] **Step 1: Create Qwen spike design**

Create the design doc with this scope:

```markdown
# Qwen Runtime Stability Design

Goal: determine whether bundled llama.cpp plus Qwen3-4B-GGUF can be a reliable optional local text provider on this Windows machine.

Known issue: llama-cli can exit with Windows code 3221225477.

Investigation:
- Record CPU model and supported instruction sets where available.
- Record exact llama.cpp release asset selected.
- Run `llama-cli.exe --help`.
- Run `llama-cli.exe --version` if supported.
- Run a one-token or short prompt against the configured GGUF.
- Try a more portable llama.cpp Windows binary if the AVX2 build crashes.
- If Qwen3-4B remains unstable, test a smaller GGUF model or recommend Ollama/MyMemory as the product default.

Acceptance:
- Qwen is marked ready only after runtime validation and a tiny prompt pass.
- If validation fails, UI clearly says Qwen is optional and not required for normal dictation.
```

- [ ] **Step 2: Commit**

Run:

```powershell
git add docs/superpowers/specs/2026-06-27-qwen-runtime-stability-design.md
git commit -m "docs: define qwen runtime stability spike"
```

---

### Final Verification

- [ ] Run:

```powershell
npm.cmd test
npm.cmd run check:app
npm.cmd run check:microphone
git status --short --branch
```

- [ ] Expected:

  - 148+ tests pass.
  - UI smoke returns `"ok": true`.
  - Microphone smoke returns `"ok": true`.
  - Worktree is clean on `codex/windows-system-input-v1`.

