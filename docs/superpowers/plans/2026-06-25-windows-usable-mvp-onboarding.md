# Windows Usable MVP Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Windows first-run usable loop: visible model readiness, safe in-app setup actions, automatic path refresh, and a home-screen setup checklist.

**Architecture:** Add a main-process setup orchestrator that owns allowlisted PowerShell script execution and asset refresh. Expose setup status through IPC/preload. Keep the renderer as a stateful UI client that renders setup cards, starts setup actions, refreshes status, and saves detected paths through existing settings APIs.

**Tech Stack:** Electron main/renderer, Node.js ESM, CommonJS preload, node:test, PowerShell setup scripts, whisper.cpp, llama.cpp/Qwen3 local model.

---

## File Structure

- Create `src/main/model-setup.js`: allowlisted setup script metadata, setup command construction, process lifecycle, status snapshots, and asset refresh helpers.
- Create `tests/model-setup.test.js`: unit coverage for command construction, status transitions, duplicate setup rejection, and safe allowlisting.
- Modify `src/main/index.js`: instantiate model setup service and wire IPC handlers.
- Modify `src/preload.cjs`: expose `getModelSetupStatus`, `startModelSetup`, and `refreshModelSetupStatus`.
- Modify `src/renderer/index.html`: add home-screen setup checklist and setup actions while preserving existing IDs.
- Modify `src/renderer/app.js`: fetch setup status, render checklist, trigger setup, refresh provider/model settings, copy latest result.
- Modify `src/renderer/i18n.js`: add setup checklist labels and status text for supported interface languages.
- Modify `src/renderer/styles.css`: style setup checklist and setup controls using the existing quiet product UI language.
- Modify `scripts/electron-app-smoke.mjs`: assert checklist appears when models are missing and setup controls are wired.
- Modify `tests/electron-runtime.test.js`: verify preload exposes setup IPC safely.

---

### Task 1: Main-Process Model Setup Service

**Files:**
- Create: `src/main/model-setup.js`
- Create: `tests/model-setup.test.js`

- [ ] **Step 1: Write failing tests for setup command construction and allowlisting**

Add to `tests/model-setup.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  createModelSetupService,
  getModelSetupScript
} from "../src/main/model-setup.js";

test("getModelSetupScript returns only known local setup scripts", () => {
  const rootPath = "C:/app";

  assert.deepEqual(getModelSetupScript("whisper", rootPath), {
    type: "whisper",
    scriptPath: path.join(rootPath, "scripts", "setup-whisper.ps1"),
    args: ["-Model", "base"]
  });
  assert.deepEqual(getModelSetupScript("llm", rootPath), {
    type: "llm",
    scriptPath: path.join(rootPath, "scripts", "setup-llm.ps1"),
    args: []
  });
  assert.equal(getModelSetupScript("bad", rootPath), null);
});

test("createModelSetupService starts PowerShell with a known setup script only", async () => {
  const spawned = [];
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: (file, args, options) => {
      spawned.push({ file, args, options });
      return fakeChildProcess({ code: 0, stdout: ["ok"] });
    },
    refreshAssets: async () => ({ whisper: { ready: true }, llm: { ready: false } })
  });

  const result = await service.start("whisper");

  assert.equal(result.type, "whisper");
  assert.equal(result.status, "complete");
  assert.equal(spawned[0].file, "powershell.exe");
  assert.deepEqual(spawned[0].args, [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join("C:/app", "scripts", "setup-whisper.ps1"),
    "-Model",
    "base"
  ]);
  assert.equal(spawned[0].options.windowsHide, true);
});

test("createModelSetupService rejects duplicate setup requests for the same type", async () => {
  let closeProcess = null;
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => fakePendingChildProcess((close) => {
      closeProcess = close;
    }),
    refreshAssets: async () => ({ whisper: {}, llm: {} })
  });

  const firstRun = service.start("llm");

  await assert.rejects(
    service.start("llm"),
    /llm setup is already running/
  );

  closeProcess(0);
  await firstRun;
});

test("createModelSetupService reports failed setup with captured output", async () => {
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => fakeChildProcess({
      code: 7,
      stdout: ["download started"],
      stderr: ["network failed"]
    }),
    refreshAssets: async () => ({ whisper: {}, llm: {} })
  });

  const result = await service.start("whisper");

  assert.equal(result.status, "failed");
  assert.equal(result.error, "Setup exited with code 7.");
  assert.deepEqual(result.output, ["download started", "network failed"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
node --test tests/model-setup.test.js
```

Expected: FAIL with `Cannot find module '../src/main/model-setup.js'`.

- [ ] **Step 3: Implement setup service skeleton**

Create `src/main/model-setup.js`:

```js
import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { detectWhisperAssets } from "./whisper-assets.js";
import { detectEmbeddedLlmAssets } from "./embedded-llm-assets.js";

const setupScripts = {
  whisper: {
    script: path.join("scripts", "setup-whisper.ps1"),
    args: ["-Model", "base"]
  },
  llm: {
    script: path.join("scripts", "setup-llm.ps1"),
    args: []
  }
};

export function getModelSetupScript(type, rootPath) {
  const config = setupScripts[type];
  if (!config) return null;
  return {
    type,
    scriptPath: path.join(rootPath, config.script),
    args: [...config.args]
  };
}

export function createModelSetupService({
  rootPath,
  spawn = nodeSpawn,
  refreshAssets = () => detectModelAssets(rootPath)
}) {
  const state = new Map();

  async function start(type) {
    const script = getModelSetupScript(type, rootPath);
    if (!script) {
      throw new Error(`Unknown setup type: ${type}`);
    }
    if (state.get(type)?.status === "running") {
      throw new Error(`${type} setup is already running.`);
    }

    setState(type, {
      type,
      status: "running",
      output: [],
      error: "",
      startedAt: new Date().toISOString(),
      completedAt: ""
    });

    const result = await runSetup(script, spawn);
    const assets = await refreshAssets();
    const next = {
      ...getStatus(type),
      status: result.code === 0 ? "complete" : "failed",
      output: result.output,
      error: result.code === 0 ? "" : `Setup exited with code ${result.code}.`,
      completedAt: new Date().toISOString(),
      assets
    };
    setState(type, next);
    return next;
  }

  async function refresh() {
    const assets = await refreshAssets();
    return {
      assets,
      setups: {
        whisper: getStatus("whisper"),
        llm: getStatus("llm")
      }
    };
  }

  function getStatus(type) {
    return state.get(type) || {
      type,
      status: "idle",
      output: [],
      error: "",
      startedAt: "",
      completedAt: ""
    };
  }

  function setState(type, value) {
    state.set(type, value);
  }

  return {
    start,
    refresh,
    getStatus
  };
}

async function detectModelAssets(rootPath) {
  const [whisper, llm] = await Promise.all([
    detectWhisperAssets(rootPath),
    detectEmbeddedLlmAssets(rootPath)
  ]);
  return { whisper, llm };
}

function runSetup(script, spawn) {
  return new Promise((resolve, reject) => {
    const output = [];
    const child = spawn(
      "powershell.exe",
      ["-ExecutionPolicy", "Bypass", "-File", script.scriptPath, ...script.args],
      { windowsHide: true }
    );

    child.stdout?.on("data", (chunk) => pushOutput(output, chunk));
    child.stderr?.on("data", (chunk) => pushOutput(output, chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

function pushOutput(output, chunk) {
  const lines = String(chunk).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  output.push(...lines);
  while (output.length > 40) output.shift();
}
```

- [ ] **Step 4: Add test helper fake child process**

Append to `tests/model-setup.test.js`:

```js
function fakeChildProcess({ code = 0, stdout = [], stderr = [] }) {
  const handlers = new Map();
  const child = {
    stdout: fakeStream(stdout),
    stderr: fakeStream(stderr),
    on(event, callback) {
      handlers.set(event, callback);
      if (event === "close") {
        queueMicrotask(() => callback(code));
      }
      return child;
    }
  };
  return child;
}

function fakeStream(chunks) {
  return {
    on(event, callback) {
      if (event === "data") {
        for (const chunk of chunks) {
          queueMicrotask(() => callback(Buffer.from(chunk)));
        }
      }
      return this;
    }
  };
}

function fakePendingChildProcess(registerClose) {
  const child = {
    stdout: fakeStream([]),
    stderr: fakeStream([]),
    on(event, callback) {
      if (event === "close") {
        registerClose(callback);
      }
      return child;
    }
  };
  return child;
}
```

- [ ] **Step 5: Run tests to verify green**

Run:

```powershell
node --test tests/model-setup.test.js
```

Expected: all tests in `tests/model-setup.test.js` pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/main/model-setup.js tests/model-setup.test.js
git commit -m "feat: add local model setup service"
```

---

### Task 2: IPC, Asset Refresh, and Settings Persistence

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload.cjs`
- Modify: `tests/electron-runtime.test.js`
- Modify: `tests/model-setup.test.js`

- [ ] **Step 1: Write failing preload IPC tests**

Add to `tests/electron-runtime.test.js` after the existing preload tests:

```js
test("preload exposes model setup IPC without raw ipcRenderer access", async () => {
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const invoked = [];
  let exposedApi = null;

  const sandbox = {
    require: (moduleName) => {
      assert.equal(moduleName, "electron");
      return {
        contextBridge: {
          exposeInMainWorld: (_name, api) => {
            exposedApi = api;
          }
        },
        ipcRenderer: {
          invoke: (channel, payload) => {
            invoked.push({ channel, payload });
            return { channel, payload };
          },
          on: () => undefined
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });

  assert.equal(exposedApi.ipcRenderer, undefined);
  assert.deepEqual(await exposedApi.getModelSetupStatus(), {
    channel: "models:setup-status",
    payload: undefined
  });
  assert.deepEqual(await exposedApi.startModelSetup("whisper"), {
    channel: "models:setup-start",
    payload: "whisper"
  });
  assert.deepEqual(await exposedApi.refreshModelSetupStatus(), {
    channel: "models:setup-refresh",
    payload: undefined
  });
  assert.deepEqual(invoked.map((item) => item.channel), [
    "models:setup-status",
    "models:setup-start",
    "models:setup-refresh"
  ]);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node --test tests/electron-runtime.test.js
```

Expected: FAIL because `getModelSetupStatus` is not defined.

- [ ] **Step 3: Expose preload methods**

Modify `src/preload.cjs`:

```js
getModelSetupStatus: () => ipcRenderer.invoke("models:setup-status"),
startModelSetup: (type) => ipcRenderer.invoke("models:setup-start", type),
refreshModelSetupStatus: () => ipcRenderer.invoke("models:setup-refresh"),
```

Place them next to the existing diagnostics/model status methods.

- [ ] **Step 4: Wire main IPC handlers**

Modify `src/main/index.js`:

```js
import { createModelSetupService } from "./model-setup.js";
```

Add top-level variable:

```js
let modelSetupService;
```

In `app.whenReady()` after asset detection and `settingsStore` creation:

```js
modelSetupService = createModelSetupService({
  rootPath: process.cwd()
});
```

Add helper:

```js
async function refreshDetectedModelPaths() {
  const status = await modelSetupService.refresh();
  const next = {};
  if (status.assets.whisper.whisperCliPath) next.whisperCliPath = status.assets.whisper.whisperCliPath;
  if (status.assets.whisper.whisperModelPath) next.whisperModelPath = status.assets.whisper.whisperModelPath;
  if (status.assets.llm.cliPath) next.embeddedLlmCliPath = status.assets.llm.cliPath;
  if (status.assets.llm.modelPath) next.embeddedLlmModelPath = status.assets.llm.modelPath;
  if (Object.keys(next).length) {
    await settingsStore.saveSettings(next, { includeSecrets: true });
  }
  return status;
}
```

Add IPC handlers inside `wireIpc()`:

```js
ipcMain.handle("models:setup-status", () => modelSetupService.refresh());
ipcMain.handle("models:setup-refresh", () => refreshDetectedModelPaths());
ipcMain.handle("models:setup-start", async (_event, type) => {
  const result = await modelSetupService.start(type);
  await refreshDetectedModelPaths();
  return result;
});
```

- [ ] **Step 5: Run tests**

Run:

```powershell
node --test tests/electron-runtime.test.js tests/model-setup.test.js
```

Expected: both test files pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/main/index.js src/preload.cjs tests/electron-runtime.test.js tests/model-setup.test.js
git commit -m "feat: expose local model setup ipc"
```

---

### Task 3: Home-Screen Setup Checklist and Copy Action

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/i18n.js`
- Modify: `src/renderer/styles.css`
- Modify: `scripts/electron-app-smoke.mjs`

- [ ] **Step 1: Write failing smoke assertions**

Modify `scripts/electron-app-smoke.mjs` IPC stubs:

```js
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

ipcMain.handle("models:setup-status", () => missingSetupStatus);
ipcMain.handle("models:setup-refresh", () => missingSetupStatus);
ipcMain.handle("models:setup-start", (_event, type) => ({
  type,
  status: "complete",
  output: [`${type} setup completed`],
  error: ""
}));
```

Extend `readRendererState()` result:

```js
hasSetupChecklist: Boolean(document.querySelector('#setupChecklist')),
setupChecklistText: document.querySelector('#setupChecklist')?.textContent || '',
hasInstallWhisperButton: Boolean(document.querySelector('#installWhisper')),
hasInstallLlmButton: Boolean(document.querySelector('#installLlm')),
hasCopyResultButton: Boolean(document.querySelector('#copyResult'))
```

Extend the initial state predicate:

```js
state.hasSetupChecklist &&
state.setupChecklistText.includes("Whisper") &&
state.hasInstallWhisperButton &&
state.hasInstallLlmButton &&
state.hasCopyResultButton
```

- [ ] **Step 2: Run smoke to verify failure**

Run:

```powershell
npm.cmd run check:app
```

Expected: FAIL because setup checklist elements do not exist.

- [ ] **Step 3: Add checklist markup**

Add to `src/renderer/index.html` inside `.dictation-stage`, below `.language-strip` and above `#recordButton`:

```html
<section id="setupChecklist" class="setup-checklist" aria-live="polite">
  <div class="setup-row" data-setup-type="whisper">
    <div>
      <strong data-i18n="setup.whisper.title">Whisper speech model</strong>
      <p id="whisperSetupStatus" data-i18n="setup.whisper.missing">Required before recording.</p>
    </div>
    <button id="installWhisper" class="secondary" type="button" data-i18n="setup.installWhisper">Install Whisper</button>
  </div>
  <div class="setup-row" data-setup-type="llm">
    <div>
      <strong data-i18n="setup.llm.title">Qwen local text model</strong>
      <p id="llmSetupStatus" data-i18n="setup.llm.missing">Recommended for cleanup and translation.</p>
    </div>
    <button id="installLlm" class="secondary" type="button" data-i18n="setup.installLlm">Install Qwen</button>
  </div>
  <button id="refreshSetupStatus" class="ghost" type="button" data-i18n="setup.refresh">Refresh setup status</button>
</section>
```

Add copy button in the result section title actions:

```html
<button id="copyResult" type="button" class="ghost" data-i18n="action.copy">Copy</button>
```

- [ ] **Step 4: Add renderer wiring**

In `src/renderer/app.js`, add selectors:

```js
const setupChecklist = document.querySelector("#setupChecklist");
const whisperSetupStatus = document.querySelector("#whisperSetupStatus");
const llmSetupStatus = document.querySelector("#llmSetupStatus");
const installWhisper = document.querySelector("#installWhisper");
const installLlm = document.querySelector("#installLlm");
const refreshSetupStatus = document.querySelector("#refreshSetupStatus");
const copyResult = document.querySelector("#copyResult");
let currentSetupStatus = null;
```

In `init()` after setupLocalModel event wiring:

```js
installWhisper.addEventListener("click", () => runModelSetup("whisper"));
installLlm.addEventListener("click", () => runModelSetup("llm"));
refreshSetupStatus.addEventListener("click", refreshSetupStatusView);
copyResult.addEventListener("click", copyLatestResult);
```

Add functions:

```js
async function refreshSetupStatusView() {
  if (!window.localFlow.getModelSetupStatus) return;
  currentSetupStatus = await window.localFlow.getModelSetupStatus();
  renderSetupChecklist();
}

async function runModelSetup(type) {
  const button = type === "whisper" ? installWhisper : installLlm;
  button.disabled = true;
  setStatus(t(type === "whisper" ? "setup.whisper.installing" : "setup.llm.installing"));
  try {
    await window.localFlow.startModelSetup(type);
    currentSetupStatus = await window.localFlow.refreshModelSetupStatus();
    await saveDetectedSetupPaths();
    renderSetupChecklist();
    await refreshProviderStatus();
    await renderLocalModelStatus();
    setStatus(t(type === "whisper" ? "setup.whisper.complete" : "setup.llm.complete"));
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
}

async function saveDetectedSetupPaths() {
  const assets = currentSetupStatus?.assets || {};
  const next = {};
  if (assets.whisper?.whisperCliPath) next.whisperCliPath = assets.whisper.whisperCliPath;
  if (assets.whisper?.whisperModelPath) next.whisperModelPath = assets.whisper.whisperModelPath;
  if (assets.llm?.cliPath) next.embeddedLlmCliPath = assets.llm.cliPath;
  if (assets.llm?.modelPath) next.embeddedLlmModelPath = assets.llm.modelPath;
  if (Object.keys(next).length) {
    currentSettings = await window.localFlow.saveSettings(next);
    fillSettings(currentSettings);
  }
}

function renderSetupChecklist() {
  if (!currentSetupStatus) return;
  const whisperReady = Boolean(currentSetupStatus.assets?.whisper?.whisperCliPath && currentSetupStatus.assets?.whisper?.whisperModelPath);
  const llmReady = Boolean(currentSetupStatus.assets?.llm?.ready);
  whisperSetupStatus.textContent = t(whisperReady ? "setup.whisper.ready" : "setup.whisper.missing");
  llmSetupStatus.textContent = t(llmReady ? "setup.llm.ready" : "setup.llm.missing");
  setupChecklist.dataset.whisperReady = String(whisperReady);
  setupChecklist.dataset.llmReady = String(llmReady);
  installWhisper.hidden = whisperReady;
  installLlm.hidden = llmReady;
}

async function copyLatestResult() {
  const text = resultText.textContent.trim();
  if (!text || resultText.dataset.emptyResult === "true") return;
  await navigator.clipboard.writeText(text);
  setStatus(t("status.copied"));
}
```

Call `await refreshSetupStatusView();` during `init()` after `refreshProviderStatus()`.

- [ ] **Step 5: Add i18n keys**

Add to every locale in `src/renderer/i18n.js` with translated text:

```js
"setup.whisper.title": "Whisper speech model",
"setup.whisper.missing": "Required before recording.",
"setup.whisper.ready": "Ready for local speech recognition.",
"setup.whisper.installing": "Installing Whisper...",
"setup.whisper.complete": "Whisper setup complete.",
"setup.installWhisper": "Install Whisper",
"setup.llm.title": "Qwen local text model",
"setup.llm.missing": "Recommended for cleanup and translation.",
"setup.llm.ready": "Ready for cleanup and translation.",
"setup.llm.installing": "Installing Qwen local model...",
"setup.llm.complete": "Qwen local model setup complete.",
"setup.installLlm": "Install Qwen",
"setup.refresh": "Refresh setup status",
"action.copy": "Copy",
"status.copied": "Copied."
```

Use natural translations for Chinese, Japanese, Korean, Traditional Chinese, French, Russian, and Spanish.

- [ ] **Step 6: Add CSS**

Add to `src/renderer/styles.css`:

```css
.setup-checklist {
  display: grid;
  gap: 10px;
  width: min(720px, 100%);
  margin-bottom: 28px;
}

.setup-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-left: 4px solid var(--warning);
  border-radius: 8px;
  background: var(--surface-soft);
}

.setup-row p {
  margin-top: 4px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.4;
}

.setup-checklist[data-whisper-ready="true"] [data-setup-type="whisper"],
.setup-checklist[data-llm-ready="true"] [data-setup-type="llm"] {
  border-left-color: var(--accent);
}
```

Extend the mobile media query:

```css
.setup-row {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 7: Run smoke and tests**

Run:

```powershell
npm.cmd run check:app
node --test tests/i18n.test.js tests/electron-runtime.test.js
```

Expected: both commands pass.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/renderer/index.html src/renderer/app.js src/renderer/i18n.js src/renderer/styles.css scripts/electron-app-smoke.mjs
git commit -m "feat: add first-run model setup checklist"
```

---

### Task 4: Final Verification and Product Polish

**Files:**
- Modify only if verification exposes a specific defect.

- [ ] **Step 1: Run complete tests**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass, 0 failures.

- [ ] **Step 2: Run syntax checks**

Run:

```powershell
Get-ChildItem -Path src,tests,scripts -Include *.js,*.mjs,*.cjs -Recurse | ForEach-Object { node --check $_.FullName }
```

Expected: exit code 0 and no syntax errors.

- [ ] **Step 3: Run app smoke**

Run:

```powershell
npm.cmd run check:app
```

Expected:

- JSON output contains `"ok": true`.
- `rendererMessages` is `[]`.
- State includes `hasSetupChecklist: true`.
- State includes `hasInstallWhisperButton: true`.
- State includes `hasCopyResultButton: true`.

- [ ] **Step 4: Run microphone smoke**

Run:

```powershell
npm.cmd run check:microphone
```

Expected: JSON output contains `"ok": true` and at least one `audioinput`.

- [ ] **Step 5: Check git status and diff**

Run:

```powershell
git status --short --branch
git diff --stat master..HEAD
```

Expected: branch is `feature/windows-usable-mvp-onboarding`, status is clean after commits, and diff is scoped to setup orchestration, renderer checklist, i18n, tests, and smoke script.

- [ ] **Step 6: Request code review**

Dispatch a code reviewer for the range:

```powershell
git merge-base HEAD master
git rev-parse HEAD
```

Review focus:

- Renderer cannot execute arbitrary commands.
- Duplicate setup is rejected.
- Missing Whisper still blocks recording.
- Setup checklist does not expose raw paths on the home screen.
- Tests cover the main process and renderer smoke path.

- [ ] **Step 7: Fix review findings or prepare handoff**

If review finds Critical or Important issues, fix them with tests before finishing. If review passes, use `superpowers:finishing-a-development-branch` and present merge/PR/keep/discard options.
