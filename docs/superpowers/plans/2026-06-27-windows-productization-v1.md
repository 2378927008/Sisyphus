# Windows Productization V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-installable Local Flow desktop app with installer scripts, launch-at-login, start-minimized behavior, a product-grade tray menu, and recoverable global shortcut control.

**Architecture:** Keep Electron as the Windows shell. Move Windows product responsibilities into focused main-process modules: packaging/runtime root helpers, startup settings, hotkey manager, and tray menu builder. The renderer remains the settings surface and talks through existing settings IPC.

**Tech Stack:** Electron 38, electron-builder, Node.js ESM/CommonJS preload, node:test, PowerShell/cmd Windows validation scripts.

---

## File Structure

- Modify `package.json`: add `electron-builder`, `package:win`, `dist:win`, and `build` config.
- Modify `.gitignore`: confirm `dist/` and `out/` stay ignored; add `release/` only if electron-builder output needs it.
- Create `tests/packaging-config.test.js`: verifies packaging scripts/config and ignored output paths.
- Create `src/main/runtime-root.js`: returns `process.resourcesPath` for packaged runtime and `process.cwd()` for source runtime.
- Test `tests/runtime-root.test.js`: verifies runtime root and vendor root behavior.
- Modify `src/main/settings-store.js`: add product settings booleans.
- Modify `tests/settings-store.test.js`: default and normalization coverage.
- Create `src/main/startup-settings.js`: apply login item settings and detect hidden startup.
- Create `tests/startup-settings.test.js`: verifies `app.setLoginItemSettings()` calls.
- Create `src/main/hotkey-manager.js`: register/unregister/pause/resume global shortcut.
- Create `tests/hotkey-manager.test.js`: hotkey lifecycle and failure tests.
- Create `src/main/tray-menu.js`: builds tray menu template and tooltip from state/settings.
- Create `tests/tray-menu.test.js`: required tray actions and bilingual labels.
- Modify `src/main/index.js`: wire runtime root, startup settings, hotkey manager, tray refresh, and startup window behavior.
- Modify `tests/electron-runtime.test.js`: source-level wiring tests.
- Modify `src/renderer/index.html`: add productization settings controls.
- Modify `src/renderer/app.js`: save/load the new settings.
- Modify `src/renderer/i18n.js`: labels and status copy.
- Modify `tests/i18n.test.js` and `tests/renderer-markup.test.js`: new labels and controls.
- Modify `scripts/electron-app-smoke.mjs`: assert new settings and packaging-safe default behavior.
- Modify `README.md`: installer, tray, startup, and shortcut recovery docs.

---

### Task 1: Packaging Config And Runtime Root

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `tests/packaging-config.test.js`
- Create: `src/main/runtime-root.js`
- Create: `tests/runtime-root.test.js`

- [ ] **Step 1: Write failing packaging config tests**

Create `tests/packaging-config.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package exposes Windows packaging scripts and electron-builder config", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.scripts["package:win"], "electron-builder --win --dir");
  assert.equal(pkg.scripts["dist:win"], "electron-builder --win nsis");
  assert.ok(pkg.devDependencies["electron-builder"], "electron-builder should be a dev dependency");
  assert.equal(pkg.build.appId, "com.localflow.dictation");
  assert.equal(pkg.build.productName, "Local Flow");
  assert.equal(pkg.build.asar, false);
  assert.equal(pkg.build.directories.output, "dist");
  assert.deepEqual(pkg.build.win.target, ["nsis"]);
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.ok(pkg.build.files.includes("src/**/*"));
  assert.ok(pkg.build.files.includes("scripts/**/*"));
  assert.ok(pkg.build.extraResources.some((item) => item.from === "vendor" && item.to === "vendor"));
});

test("installer output directories are ignored", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

  assert.match(gitignore, /^dist\/$/m);
  assert.match(gitignore, /^out\/$/m);
});
```

- [ ] **Step 2: Run packaging tests and verify red**

Run:

```powershell
node --test --test-reporter=spec tests/packaging-config.test.js
```

Expected: fail because `package:win`, `dist:win`, and `electron-builder` config are missing.

- [ ] **Step 3: Install electron-builder**

Run:

```powershell
npm.cmd install --save-dev electron-builder
```

Expected: `package.json` and `package-lock.json` update with `electron-builder`.

- [ ] **Step 4: Add package scripts and build config**

Modify `package.json` to include these script entries:

```json
{
  "scripts": {
    "start": "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer .",
    "check:microphone": "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer scripts/electron-microphone-smoke.mjs",
    "check:app": "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer scripts/electron-app-smoke.mjs",
    "test": "node --test tests/*.test.js",
    "package:win": "electron-builder --win --dir",
    "dist:win": "electron-builder --win nsis"
  }
}
```

Add this top-level `build` config in `package.json`:

```json
{
  "build": {
    "appId": "com.localflow.dictation",
    "productName": "Local Flow",
    "asar": false,
    "directories": {
      "output": "dist"
    },
    "files": [
      "package.json",
      "src/**/*",
      "scripts/**/*",
      "Start-LocalFlow.cmd",
      "!docs/**/*",
      "!tests/**/*",
      "!dist/**/*",
      "!out/**/*",
      "!.git/**/*",
      "!.worktrees/**/*"
    ],
    "extraResources": [
      {
        "from": "vendor",
        "to": "vendor",
        "filter": [
          "**/*"
        ]
      }
    ],
    "win": {
      "target": [
        "nsis"
      ]
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "Local Flow"
    }
  }
}
```

Do not remove existing fields.

- [ ] **Step 5: Write failing runtime root tests**

Create `tests/runtime-root.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getRuntimeRoot, getVendorRoot } from "../src/main/runtime-root.js";

test("getRuntimeRoot uses cwd while running from source", () => {
  const root = getRuntimeRoot({
    app: { isPackaged: false },
    cwd: () => "C:/project/local-flow",
    resourcesPath: "C:/project/local-flow/resources"
  });

  assert.equal(root, "C:/project/local-flow");
});

test("getRuntimeRoot uses Electron resources path after packaging", () => {
  const root = getRuntimeRoot({
    app: { isPackaged: true },
    cwd: () => "C:/Users/Alice",
    resourcesPath: "C:/Program Files/Local Flow/resources"
  });

  assert.equal(root, "C:/Program Files/Local Flow/resources");
});

test("getVendorRoot points at packaged extraResources vendor folder", () => {
  const vendorRoot = getVendorRoot("C:/Program Files/Local Flow/resources");

  assert.equal(vendorRoot, path.join("C:/Program Files/Local Flow/resources", "vendor"));
});
```

- [ ] **Step 6: Run runtime root tests and verify red**

Run:

```powershell
node --test --test-reporter=spec tests/runtime-root.test.js
```

Expected: fail because `src/main/runtime-root.js` does not exist.

- [ ] **Step 7: Implement runtime root helper**

Create `src/main/runtime-root.js`:

```js
import path from "node:path";

export function getRuntimeRoot({
  app,
  cwd = process.cwd,
  resourcesPath = process.resourcesPath
} = {}) {
  if (app?.isPackaged && resourcesPath) {
    return resourcesPath;
  }
  return cwd();
}

export function getVendorRoot(runtimeRoot) {
  return path.join(runtimeRoot, "vendor");
}
```

- [ ] **Step 8: Verify packaging task green**

Run:

```powershell
node --test --test-reporter=spec tests/packaging-config.test.js tests/runtime-root.test.js
```

Expected: all tests pass.

- [ ] **Step 9: Commit packaging task**

Run:

```powershell
git add package.json package-lock.json .gitignore src/main/runtime-root.js tests/packaging-config.test.js tests/runtime-root.test.js
git commit -m "feat: add windows packaging config"
```

---

### Task 2: Product Settings And Startup Adapter

**Files:**
- Modify: `src/main/settings-store.js`
- Modify: `tests/settings-store.test.js`
- Create: `src/main/startup-settings.js`
- Create: `tests/startup-settings.test.js`

- [ ] **Step 1: Write failing settings tests**

Add to `tests/settings-store.test.js`:

```js
test("mergeSettings includes Windows productization defaults", () => {
  const settings = mergeSettings();

  assert.equal(settings.launchAtLogin, false);
  assert.equal(settings.startMinimizedToTray, false);
  assert.equal(settings.globalShortcutPaused, false);
});

test("mergeSettings normalizes Windows productization booleans", () => {
  const settings = mergeSettings({
    launchAtLogin: 1,
    startMinimizedToTray: "yes",
    globalShortcutPaused: ""
  });

  assert.equal(settings.launchAtLogin, true);
  assert.equal(settings.startMinimizedToTray, true);
  assert.equal(settings.globalShortcutPaused, false);
});
```

- [ ] **Step 2: Run settings tests and verify red**

Run:

```powershell
node --test --test-reporter=spec tests/settings-store.test.js
```

Expected: fail because the new settings fields are missing.

- [ ] **Step 3: Implement settings defaults and normalization**

In `src/main/settings-store.js`, extend `defaultSettings`:

```js
  launchAtLogin: false,
  startMinimizedToTray: false,
  globalShortcutPaused: false,
```

Add boolean normalization inside `mergeSettings` after `merged.ollamaEnabled`:

```js
  merged.launchAtLogin = Boolean(merged.launchAtLogin);
  merged.startMinimizedToTray = Boolean(merged.startMinimizedToTray);
  merged.globalShortcutPaused = Boolean(merged.globalShortcutPaused);
```

- [ ] **Step 4: Write failing startup adapter tests**

Create `tests/startup-settings.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { applyStartupSettings, getStartupLaunchArgs, shouldStartMinimized } from "../src/main/startup-settings.js";

test("getStartupLaunchArgs requests hidden startup only when start minimized is enabled", () => {
  assert.deepEqual(getStartupLaunchArgs({ startMinimizedToTray: false }), []);
  assert.deepEqual(getStartupLaunchArgs({ startMinimizedToTray: true }), ["--hidden"]);
});

test("applyStartupSettings calls Electron login item API", () => {
  const calls = [];
  const app = {
    setLoginItemSettings: (options) => calls.push(options)
  };

  applyStartupSettings(app, {
    launchAtLogin: true,
    startMinimizedToTray: true
  }, {
    execPath: "C:/Program Files/Local Flow/Local Flow.exe"
  });

  assert.deepEqual(calls, [
    {
      openAtLogin: true,
      path: "C:/Program Files/Local Flow/Local Flow.exe",
      args: ["--hidden"]
    }
  ]);
});

test("shouldStartMinimized respects hidden argv and user setting", () => {
  assert.equal(shouldStartMinimized(["node", "app"], { startMinimizedToTray: false }), false);
  assert.equal(shouldStartMinimized(["node", "app", "--hidden"], { startMinimizedToTray: false }), true);
  assert.equal(shouldStartMinimized(["node", "app"], { startMinimizedToTray: true }), true);
});
```

- [ ] **Step 5: Run startup adapter tests and verify red**

Run:

```powershell
node --test --test-reporter=spec tests/startup-settings.test.js
```

Expected: fail because `startup-settings.js` does not exist.

- [ ] **Step 6: Implement startup settings adapter**

Create `src/main/startup-settings.js`:

```js
export function getStartupLaunchArgs(settings = {}) {
  return settings.startMinimizedToTray ? ["--hidden"] : [];
}

export function applyStartupSettings(app, settings = {}, deps = {}) {
  const execPath = deps.execPath || process.execPath;
  const options = {
    openAtLogin: Boolean(settings.launchAtLogin),
    path: execPath,
    args: getStartupLaunchArgs(settings)
  };

  app.setLoginItemSettings(options);
  return options;
}

export function shouldStartMinimized(argv = process.argv, settings = {}) {
  return argv.includes("--hidden") || Boolean(settings.startMinimizedToTray);
}
```

- [ ] **Step 7: Verify task green**

Run:

```powershell
node --test --test-reporter=spec tests/settings-store.test.js tests/startup-settings.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit settings task**

Run:

```powershell
git add src/main/settings-store.js src/main/startup-settings.js tests/settings-store.test.js tests/startup-settings.test.js
git commit -m "feat: add windows startup settings"
```

---

### Task 3: Hotkey Manager

**Files:**
- Create: `src/main/hotkey-manager.js`
- Create: `tests/hotkey-manager.test.js`

- [ ] **Step 1: Write failing hotkey manager tests**

Create `tests/hotkey-manager.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createHotkeyManager } from "../src/main/hotkey-manager.js";

function fakeGlobalShortcut({ registerResult = true } = {}) {
  const calls = [];
  return {
    calls,
    register(hotkey, callback) {
      calls.push({ type: "register", hotkey, callback });
      return registerResult;
    },
    unregister(hotkey) {
      calls.push({ type: "unregister", hotkey });
    },
    unregisterAll() {
      calls.push({ type: "unregisterAll" });
    }
  };
}

test("hotkey manager registers and triggers the active shortcut", async () => {
  const globalShortcut = fakeGlobalShortcut();
  const toggles = [];
  const statuses = [];
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => toggles.push("toggle"),
    onStatus: (status) => statuses.push(status)
  });

  const status = await manager.register({ hotkey: "CommandOrControl+Alt+Space" });
  globalShortcut.calls[0].callback();

  assert.equal(status.ok, true);
  assert.deepEqual(toggles, ["toggle"]);
  assert.equal(statuses.at(-1).phase, "ready");
});

test("hotkey manager reports registration conflicts", async () => {
  const globalShortcut = fakeGlobalShortcut({ registerResult: false });
  const statuses = [];
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => {},
    onStatus: (status) => statuses.push(status)
  });

  const status = await manager.register({ hotkey: "CommandOrControl+Alt+Space" });

  assert.equal(status.ok, false);
  assert.equal(status.reason, "registration_failed");
  assert.match(status.message, /Could not register hotkey/);
  assert.equal(statuses.at(-1).phase, "error");
});

test("hotkey manager pause unregisters and resume registers again", async () => {
  const globalShortcut = fakeGlobalShortcut();
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => {},
    onStatus: () => {}
  });

  await manager.register({ hotkey: "CommandOrControl+Alt+Space" });
  manager.pause();
  await manager.resume({ hotkey: "CommandOrControl+Alt+Space" });

  assert.deepEqual(globalShortcut.calls.map((call) => call.type), [
    "register",
    "unregister",
    "register"
  ]);
  assert.equal(manager.isPaused(), false);
});

test("hotkey manager does not register while settings pause shortcuts", async () => {
  const globalShortcut = fakeGlobalShortcut();
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => {},
    onStatus: () => {}
  });

  const status = await manager.register({
    hotkey: "CommandOrControl+Alt+Space",
    globalShortcutPaused: true
  });

  assert.equal(status.ok, true);
  assert.equal(status.paused, true);
  assert.deepEqual(globalShortcut.calls, []);
});
```

- [ ] **Step 2: Run hotkey tests and verify red**

Run:

```powershell
node --test --test-reporter=spec tests/hotkey-manager.test.js
```

Expected: fail because `src/main/hotkey-manager.js` does not exist.

- [ ] **Step 3: Implement hotkey manager**

Create `src/main/hotkey-manager.js`:

```js
export function createHotkeyManager({
  globalShortcut,
  onToggle,
  onStatus = () => {}
}) {
  let registeredHotkey = "";
  let paused = false;

  async function register(settings = {}) {
    unregister();
    const hotkey = String(settings.hotkey || "").trim();
    paused = Boolean(settings.globalShortcutPaused);

    if (paused) {
      const status = {
        ok: true,
        paused: true,
        phase: "warning",
        message: "Global shortcut is paused."
      };
      onStatus(status);
      return status;
    }

    if (!hotkey) {
      const status = {
        ok: false,
        reason: "missing_hotkey",
        phase: "error",
        message: "Set a global shortcut before recording."
      };
      onStatus(status);
      return status;
    }

    const ok = globalShortcut.register(hotkey, onToggle);
    if (!ok) {
      const status = {
        ok: false,
        reason: "registration_failed",
        phase: "error",
        message: `Could not register hotkey: ${hotkey}`
      };
      onStatus(status);
      return status;
    }

    registeredHotkey = hotkey;
    const status = {
      ok: true,
      paused: false,
      phase: "ready",
      message: `Global shortcut ready: ${hotkey}`
    };
    onStatus(status);
    return status;
  }

  function unregister() {
    if (registeredHotkey) {
      globalShortcut.unregister(registeredHotkey);
      registeredHotkey = "";
    }
  }

  function pause() {
    paused = true;
    unregister();
    const status = {
      ok: true,
      paused: true,
      phase: "warning",
      message: "Global shortcut is paused."
    };
    onStatus(status);
    return status;
  }

  async function resume(settings = {}) {
    paused = false;
    return register({
      ...settings,
      globalShortcutPaused: false
    });
  }

  return {
    register,
    unregister,
    pause,
    resume,
    isPaused: () => paused,
    getRegisteredHotkey: () => registeredHotkey
  };
}
```

- [ ] **Step 4: Verify task green**

Run:

```powershell
node --test --test-reporter=spec tests/hotkey-manager.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit hotkey manager**

Run:

```powershell
git add src/main/hotkey-manager.js tests/hotkey-manager.test.js
git commit -m "feat: add hotkey manager"
```

---

### Task 4: Product Tray Menu

**Files:**
- Create: `src/main/tray-menu.js`
- Create: `tests/tray-menu.test.js`

- [ ] **Step 1: Write failing tray menu tests**

Create `tests/tray-menu.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildTrayMenuTemplate, getTrayTooltip } from "../src/main/tray-menu.js";

const handlers = {
  showMainWindow: () => {},
  toggleDictation: () => {},
  toggleShortcutPaused: () => {},
  toggleLaunchAtLogin: () => {},
  toggleStartMinimized: () => {},
  openSettings: () => {},
  quit: () => {}
};

test("buildTrayMenuTemplate includes product control actions", () => {
  const template = buildTrayMenuTemplate({
    language: "en",
    state: { phase: "idle" },
    settings: {
      launchAtLogin: false,
      startMinimizedToTray: false,
      globalShortcutPaused: false
    },
    handlers
  });

  const labels = template.filter((item) => item.type !== "separator").map((item) => item.label);

  assert.deepEqual(labels, [
    "Show Local Flow",
    "Start dictation",
    "Pause global shortcut",
    "Launch at login",
    "Start minimized to tray",
    "Settings",
    "Quit"
  ]);
});

test("buildTrayMenuTemplate reflects recording and paused shortcut state", () => {
  const template = buildTrayMenuTemplate({
    language: "en",
    state: { phase: "recording" },
    settings: {
      launchAtLogin: true,
      startMinimizedToTray: true,
      globalShortcutPaused: true
    },
    handlers
  });

  assert.equal(template[1].label, "Stop dictation");
  assert.equal(template[2].label, "Resume global shortcut");
  assert.equal(template[3].checked, true);
  assert.equal(template[4].checked, true);
});

test("buildTrayMenuTemplate supports Simplified Chinese labels", () => {
  const template = buildTrayMenuTemplate({
    language: "zh-Hans",
    state: { phase: "idle" },
    settings: {
      launchAtLogin: false,
      startMinimizedToTray: false,
      globalShortcutPaused: false
    },
    handlers
  });

  assert.equal(template[0].label, "显示 Local Flow");
  assert.equal(template[1].label, "开始语音输入");
  assert.equal(template[2].label, "暂停全局快捷键");
  assert.equal(template.at(-1).label, "退出");
});

test("getTrayTooltip includes current phase", () => {
  assert.equal(getTrayTooltip({ language: "en", state: { phase: "recording" } }), "Local Flow - Recording");
  assert.equal(getTrayTooltip({ language: "zh-Hans", state: { phase: "error" } }), "Local Flow - 错误");
});
```

- [ ] **Step 2: Run tray tests and verify red**

Run:

```powershell
node --test --test-reporter=spec tests/tray-menu.test.js
```

Expected: fail because `src/main/tray-menu.js` does not exist.

- [ ] **Step 3: Implement tray menu builder**

Create `src/main/tray-menu.js`:

```js
const labels = {
  en: {
    show: "Show Local Flow",
    start: "Start dictation",
    stop: "Stop dictation",
    pauseShortcut: "Pause global shortcut",
    resumeShortcut: "Resume global shortcut",
    launchAtLogin: "Launch at login",
    startMinimized: "Start minimized to tray",
    settings: "Settings",
    quit: "Quit",
    phases: {
      idle: "Idle",
      starting: "Starting",
      recording: "Recording",
      stopping: "Stopping",
      transcribing: "Transcribing",
      done: "Done",
      warning: "Warning",
      error: "Error"
    }
  },
  "zh-Hans": {
    show: "显示 Local Flow",
    start: "开始语音输入",
    stop: "停止语音输入",
    pauseShortcut: "暂停全局快捷键",
    resumeShortcut: "恢复全局快捷键",
    launchAtLogin: "开机自动启动",
    startMinimized: "启动时最小化到托盘",
    settings: "设置",
    quit: "退出",
    phases: {
      idle: "空闲",
      starting: "正在启动",
      recording: "正在录音",
      stopping: "正在停止",
      transcribing: "正在转写",
      done: "完成",
      warning: "警告",
      error: "错误"
    }
  }
};

export function buildTrayMenuTemplate({
  language = "en",
  state = {},
  settings = {},
  handlers = {}
} = {}) {
  const t = getLabels(language);
  const isRecording = state.phase === "recording" || state.phase === "starting";
  const shortcutPaused = Boolean(settings.globalShortcutPaused);

  return [
    { label: t.show, click: handlers.showMainWindow },
    { label: isRecording ? t.stop : t.start, click: handlers.toggleDictation },
    {
      label: shortcutPaused ? t.resumeShortcut : t.pauseShortcut,
      click: handlers.toggleShortcutPaused
    },
    { type: "separator" },
    {
      label: t.launchAtLogin,
      type: "checkbox",
      checked: Boolean(settings.launchAtLogin),
      click: handlers.toggleLaunchAtLogin
    },
    {
      label: t.startMinimized,
      type: "checkbox",
      checked: Boolean(settings.startMinimizedToTray),
      click: handlers.toggleStartMinimized
    },
    { type: "separator" },
    { label: t.settings, click: handlers.openSettings },
    { label: t.quit, click: handlers.quit }
  ];
}

export function getTrayTooltip({ language = "en", state = {} } = {}) {
  const t = getLabels(language);
  const phase = state.phase || "idle";
  return `Local Flow - ${t.phases[phase] || t.phases.idle}`;
}

function getLabels(language) {
  return labels[language] || labels.en;
}
```

- [ ] **Step 4: Verify task green**

Run:

```powershell
node --test --test-reporter=spec tests/tray-menu.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit tray menu**

Run:

```powershell
git add src/main/tray-menu.js tests/tray-menu.test.js
git commit -m "feat: add product tray menu"
```

---

### Task 5: Main Process Productization Wiring

**Files:**
- Modify: `src/main/index.js`
- Modify: `tests/electron-runtime.test.js`
- Modify: `scripts/electron-app-smoke.mjs`

- [ ] **Step 1: Add failing main-process wiring tests**

Add to `tests/electron-runtime.test.js`:

```js
test("main process wires productized runtime root, startup settings, hotkey manager, and tray menu", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");

  assert.match(mainSource, /import \{ getRuntimeRoot, getVendorRoot \} from "\.\/runtime-root\.js";/);
  assert.match(mainSource, /import \{ applyStartupSettings, shouldStartMinimized \} from "\.\/startup-settings\.js";/);
  assert.match(mainSource, /import \{ createHotkeyManager \} from "\.\/hotkey-manager\.js";/);
  assert.match(mainSource, /import \{ buildTrayMenuTemplate, getTrayTooltip \} from "\.\/tray-menu\.js";/);
  assert.match(mainSource, /let hotkeyManager;/);
  assert.match(mainSource, /let lastSettings;/);
  assert.match(mainSource, /function refreshTrayMenu\(\)/);
  assert.match(mainSource, /buildTrayMenuTemplate\(\{/);
  assert.match(mainSource, /getTrayTooltip\(\{/);
  assert.match(mainSource, /applyStartupSettings\(app, next\)/);
  assert.match(mainSource, /shouldStartMinimized\(process\.argv, lastSettings\)/);
  assert.match(mainSource, /hotkeyManager = createHotkeyManager\(\{/);
  assert.match(mainSource, /await hotkeyManager\.register\(settings\)/);
});
```

- [ ] **Step 2: Run main-process wiring test and verify red**

Run:

```powershell
node --test --test-reporter=spec tests/electron-runtime.test.js
```

Expected: fail because the new modules are not imported or wired.

- [ ] **Step 3: Wire runtime root in main process**

In `src/main/index.js`, add imports:

```js
import { getRuntimeRoot, getVendorRoot } from "./runtime-root.js";
import { applyStartupSettings, shouldStartMinimized } from "./startup-settings.js";
import { createHotkeyManager } from "./hotkey-manager.js";
import { buildTrayMenuTemplate, getTrayTooltip } from "./tray-menu.js";
```

Add module state:

```js
let hotkeyManager;
let lastSettings;
let lastSystemInputState = { phase: "idle" };
let runtimeRoot;
let vendorRoot;
```

In `app.whenReady().then(...)`, compute runtime roots before asset detection:

```js
  runtimeRoot = getRuntimeRoot({ app });
  vendorRoot = getVendorRoot(runtimeRoot);
  const whisperAssetDefaults = await detectWhisperAssets(runtimeRoot);
  const embeddedLlmDefaults = await detectEmbeddedLlmAssets(runtimeRoot);
```

Use `runtimeRoot` when creating the model setup service:

```js
  modelSetupService = createModelSetupService({
    rootPath: runtimeRoot
  });
```

- [ ] **Step 4: Wire hotkey manager**

Replace the current `registerHotkey` implementation with:

```js
async function registerHotkey() {
  const settings = await settingsStore.getSettings();
  lastSettings = settings;
  const status = await hotkeyManager.register(settings);

  if (!status.ok) {
    sendStatus({ phase: "error", message: status.message, reason: status.reason });
  }

  refreshTrayMenu();
  return status;
}
```

Create the manager inside `app.whenReady()` before `wireIpc()`:

```js
  hotkeyManager = createHotkeyManager({
    globalShortcut,
    onToggle: () => systemInputController?.toggle(),
    onStatus: (status) => {
      if (status.phase === "error") {
        systemInputController?.setPhase("error", {
          reason: status.reason,
          message: status.message
        });
      }
    }
  });
```

Update `app.on("will-quit")`:

```js
app.on("will-quit", () => {
  hotkeyManager?.unregister();
  globalShortcut.unregisterAll();
});
```

- [ ] **Step 5: Wire startup settings and hidden startup**

After loading `lastSettings` in `app.whenReady()`:

```js
  lastSettings = await settingsStore.getSettings();
  applyStartupSettings(app, lastSettings);
```

After `createWindow()` and `createTray()`, hide the main window if startup should be minimized:

```js
  if (shouldStartMinimized(process.argv, lastSettings)) {
    mainWindow.hide();
  }
```

Keep first-run default visible because `startMinimizedToTray` defaults to false.

- [ ] **Step 6: Replace tray creation with refreshable menu**

Modify `createTray()`:

```js
function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  refreshTrayMenu();
  tray.on("click", () => showMainWindow());
}
```

Add helpers:

```js
function showMainWindow() {
  if (!isUsableWindow(mainWindow)) return;
  mainWindow.show();
  mainWindow.focus();
}

function openSettingsWindow() {
  showMainWindow();
  sendWindowMessage(mainWindow, "settings:open");
}

function refreshTrayMenu() {
  if (!tray) return;
  const settings = lastSettings || {};
  const state = lastSystemInputState || { phase: "idle" };
  tray.setToolTip(getTrayTooltip({
    language: settings.interfaceLanguage,
    state
  }));
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
    language: settings.interfaceLanguage,
    state,
    settings,
    handlers: {
      showMainWindow,
      toggleDictation: () => systemInputController?.toggle(),
      toggleShortcutPaused,
      toggleLaunchAtLogin,
      toggleStartMinimized,
      openSettings: openSettingsWindow,
      quit: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  })));
}
```

Add tray action handlers:

```js
async function saveMainProcessSettings(patch) {
  const next = await settingsStore.saveSettings(patch);
  lastSettings = next;
  applyStartupSettings(app, next);
  await registerHotkey();
  refreshTrayMenu();
  return next;
}

async function toggleShortcutPaused() {
  const current = lastSettings || await settingsStore.getSettings();
  await saveMainProcessSettings({
    globalShortcutPaused: !current.globalShortcutPaused
  });
}

async function toggleLaunchAtLogin() {
  const current = lastSettings || await settingsStore.getSettings();
  await saveMainProcessSettings({
    launchAtLogin: !current.launchAtLogin
  });
}

async function toggleStartMinimized() {
  const current = lastSettings || await settingsStore.getSettings();
  await saveMainProcessSettings({
    startMinimizedToTray: !current.startMinimizedToTray
  });
}
```

Update `sendSystemInputStatus(state)` to store the state and refresh tray:

```js
  lastSystemInputState = state || { phase: "idle" };
  refreshTrayMenu();
```

- [ ] **Step 7: Update settings save IPC**

In `ipcMain.handle("settings:save", ...)`, replace the body with:

```js
  ipcMain.handle("settings:save", async (_event, settings) => {
    const next = await settingsStore.saveSettings(settings);
    lastSettings = next;
    applyStartupSettings(app, next);
    await registerHotkey();
    refreshTrayMenu();
    return next;
  });
```

- [ ] **Step 8: Add preload listener for settings drawer open**

In `src/preload.cjs`, add:

```js
  onOpenSettings: (callback) => {
    ipcRenderer.on("settings:open", () => callback());
  },
```

Add a test in `tests/electron-runtime.test.js` or extend an existing preload test to assert `onOpenSettings` subscribes only to `settings:open`.

- [ ] **Step 9: Update app smoke for product settings**

In `scripts/electron-app-smoke.mjs`, extend collected state with:

```js
launchAtLogin: document.querySelector("#launchAtLogin")?.checked ?? null,
startMinimizedToTray: document.querySelector("#startMinimizedToTray")?.checked ?? null,
globalShortcutPaused: document.querySelector("#globalShortcutPaused")?.checked ?? null,
```

Assert initial values are `false` after the controls are added in Task 6.

- [ ] **Step 10: Verify main wiring task**

Run:

```powershell
node --test --test-reporter=spec tests/electron-runtime.test.js tests/hotkey-manager.test.js tests/tray-menu.test.js tests/runtime-root.test.js
npm.cmd run check:app
```

Expected: all tests pass and app smoke emits `"ok": true`.

- [ ] **Step 11: Commit main wiring**

Run:

```powershell
git add src/main/index.js src/preload.cjs tests/electron-runtime.test.js scripts/electron-app-smoke.mjs
git commit -m "feat: wire windows product shell"
```

---

### Task 6: Renderer Settings UI

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/i18n.js`
- Modify: `tests/i18n.test.js`
- Modify: `tests/renderer-markup.test.js`
- Modify: `scripts/electron-app-smoke.mjs`

- [ ] **Step 1: Write failing renderer markup tests**

Add to `tests/renderer-markup.test.js`:

```js
test("settings expose Windows productization controls", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  assert.match(html, /id="launchAtLogin"/);
  assert.match(html, /name="launchAtLogin"/);
  assert.match(html, /id="startMinimizedToTray"/);
  assert.match(html, /name="startMinimizedToTray"/);
  assert.match(html, /id="globalShortcutPaused"/);
  assert.match(html, /name="globalShortcutPaused"/);
  assert.match(html, /data-i18n="label.launchAtLogin"/);
  assert.match(html, /data-i18n="label.startMinimizedToTray"/);
  assert.match(html, /data-i18n="label.globalShortcutPaused"/);
});
```

- [ ] **Step 2: Write failing i18n tests**

Add to `tests/i18n.test.js`:

```js
test("getUiText returns Windows productization labels", () => {
  assert.equal(getUiText("en", "label.launchAtLogin"), "Launch Local Flow at login");
  assert.equal(getUiText("en", "label.startMinimizedToTray"), "Start minimized to tray");
  assert.equal(getUiText("en", "label.globalShortcutPaused"), "Pause global shortcut");
  assert.equal(getUiText("zh-Hans", "label.launchAtLogin"), "开机自动启动 Local Flow");
  assert.equal(getUiText("zh-Hans", "label.startMinimizedToTray"), "启动时最小化到托盘");
  assert.equal(getUiText("zh-Hans", "label.globalShortcutPaused"), "暂停全局快捷键");
});
```

- [ ] **Step 3: Run renderer tests and verify red**

Run:

```powershell
node --test --test-reporter=spec tests/renderer-markup.test.js tests/i18n.test.js
```

Expected: fail because the controls and labels are missing.

- [ ] **Step 4: Add settings controls**

In `src/renderer/index.html`, inside the shortcuts drawer section after the hotkey input, add:

```html
            <label class="checkbox-label">
              <input id="globalShortcutPaused" name="globalShortcutPaused" type="checkbox" />
              <span data-i18n="label.globalShortcutPaused">暂停全局快捷键</span>
            </label>
            <label class="checkbox-label">
              <input id="launchAtLogin" name="launchAtLogin" type="checkbox" />
              <span data-i18n="label.launchAtLogin">开机自动启动 Local Flow</span>
            </label>
            <label class="checkbox-label">
              <input id="startMinimizedToTray" name="startMinimizedToTray" type="checkbox" />
              <span data-i18n="label.startMinimizedToTray">启动时最小化到托盘</span>
            </label>
```

- [ ] **Step 5: Save settings from renderer**

In `src/renderer/app.js`, extend `saveSettingsFromCurrentForm` `next`:

```js
    globalShortcutPaused: form.globalShortcutPaused.checked,
    launchAtLogin: form.launchAtLogin.checked,
    startMinimizedToTray: form.startMinimizedToTray.checked,
```

Add settings-open listener during startup near other `window.localFlow` listeners:

```js
window.localFlow.onOpenSettings?.(() => {
  openSettingsDrawer();
});
```

Use the existing settings drawer open helper name. If the function is named differently in current code, call the existing function that the Settings button uses.

- [ ] **Step 6: Add i18n labels**

In `src/renderer/i18n.js`, add English keys:

```js
  "label.launchAtLogin": "Launch Local Flow at login",
  "label.startMinimizedToTray": "Start minimized to tray",
  "label.globalShortcutPaused": "Pause global shortcut",
```

Add Simplified Chinese keys:

```js
  "label.launchAtLogin": "开机自动启动 Local Flow",
  "label.startMinimizedToTray": "启动时最小化到托盘",
  "label.globalShortcutPaused": "暂停全局快捷键",
```

For other locales, use clear fallbacks in the target language where practical. If a translation is uncertain, use English rather than broken text.

- [ ] **Step 7: Update app smoke assertions**

In `scripts/electron-app-smoke.mjs`, after collecting initial state, assert:

```js
assert.equal(initialState.launchAtLogin, false);
assert.equal(initialState.startMinimizedToTray, false);
assert.equal(initialState.globalShortcutPaused, false);
```

If the script uses custom assertion helpers instead of `assert`, follow the existing style.

- [ ] **Step 8: Verify renderer task**

Run:

```powershell
node --test --test-reporter=spec tests/renderer-markup.test.js tests/i18n.test.js
npm.cmd run check:app
```

Expected: tests pass and app smoke emits `"ok": true`.

- [ ] **Step 9: Commit renderer settings**

Run:

```powershell
git add src/renderer/index.html src/renderer/app.js src/renderer/i18n.js tests/i18n.test.js tests/renderer-markup.test.js scripts/electron-app-smoke.mjs
git commit -m "feat: add windows product settings ui"
```

---

### Task 7: Documentation, Packaging Verification, And Final Checks

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-27-windows-productization-v1-design.md` only if implementation reveals a necessary clarification.

- [ ] **Step 1: Update README Windows product section**

Add this section to `README.md`:

````markdown
## Windows installable build

Local Flow can be packaged as a Windows installer with electron-builder.

```powershell
npm.cmd install
npm.cmd run dist:win
```

Installer output is written to `dist/`. The generated installer is a build artifact and is not committed to git.

For a faster local packaging smoke test, run:

```powershell
npm.cmd run package:win
```

## Startup and tray behavior

The installed app keeps running from the tray when the main window is closed. Use the tray menu to show Local Flow, start or stop dictation, pause or resume the global shortcut, toggle launch at login, toggle start minimized to tray, open settings, or quit.

Launch at login is off by default. Enable it from Settings or the tray menu. Start minimized to tray is also off by default so first-run setup remains visible.

If the global shortcut conflicts with another app, Local Flow shows a hotkey error in the main status/HUD. Use the tray menu or Settings to pause the shortcut, change the shortcut, then resume.
````

Keep existing source-run instructions, including `Start-LocalFlow.cmd`.

- [ ] **Step 2: Run full automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run check:app
npm.cmd run check:microphone
git diff --check
```

Expected:

- all node tests pass;
- app smoke emits `"ok": true`;
- microphone smoke emits `"ok": true`;
- `git diff --check` returns exit code 0, allowing Windows CRLF warnings.

- [ ] **Step 3: Run Windows packaging verification**

Run:

```powershell
npm.cmd run package:win
```

Expected:

- exit code 0;
- `dist/win-unpacked/Local Flow.exe` or the electron-builder equivalent unpacked app exists.

Then run:

```powershell
npm.cmd run dist:win
```

Expected:

- exit code 0;
- `dist/` contains an NSIS installer file for Local Flow.

If `electron-builder` cannot download Electron or builder binaries due to network restrictions, stop and report the exact failing URL/error. Do not hand-edit downloaded artifacts into the repo.

- [ ] **Step 4: Confirm build artifacts remain untracked**

Run:

```powershell
git status --short
```

Expected: no `dist/` or `out/` files appear. Only source/docs files from this task should be modified.

- [ ] **Step 5: Commit docs and final verification updates**

Run:

```powershell
git add README.md docs/superpowers/specs/2026-06-27-windows-productization-v1-design.md
git commit -m "docs: document windows product build"
```

If the spec did not need changes, commit only `README.md`.

---

## Final Verification

- [ ] Run:

```powershell
npm.cmd test
npm.cmd run check:app
npm.cmd run check:microphone
npm.cmd run package:win
npm.cmd run dist:win
git status --short --branch
```

- [ ] Expected:

  - all tests pass;
  - app smoke emits `"ok": true`;
  - microphone smoke emits `"ok": true`;
  - unpacked Windows app is generated under `dist/`;
  - NSIS installer is generated under `dist/`;
  - build artifacts remain ignored;
  - working tree is clean except intentional committed changes.

## Spec Coverage Self-Review

- Installer: Task 1 and Task 7 cover dependency, scripts, config, ignored output, and package verification.
- Startup behavior: Task 2, Task 5, and Task 6 cover settings, Electron login item API, hidden startup, and UI controls.
- Background mode: Task 5 wires start-minimized behavior and preserves hide-to-tray close behavior.
- Tray menu: Task 4 and Task 5 cover menu structure, localization, state, toggles, and quit.
- Global shortcut stability: Task 3 and Task 5 cover register, pause, resume, failure reporting, and re-registration on settings save.
- Documentation: Task 7 covers installer, tray, startup, and shortcut conflict recovery.
- Out-of-scope boundaries remain unchanged: no native TSF/IME, updater, signing, store packaging, or Qwen runtime fix.
