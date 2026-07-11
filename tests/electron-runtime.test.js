import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { electronRuntimeSwitches } from "../src/main/electron-runtime.js";

function removeLeadingWhitespaceAndComments(source) {
  let remainder = source;

  while (true) {
    remainder = remainder.replace(/^\s+/, "");
    const comment = remainder.match(/^(?:\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)/);
    if (!comment) {
      return remainder;
    }

    remainder = remainder.slice(comment[0].length);
  }
}

function getSmokeIpcChannelRegistry(smokeSource) {
  const declaration = "const smokeIpcChannelRegistry =";
  const declarationIndex = smokeSource.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, "smoke should declare an explicit IPC channel registry");

  const arrayStart = smokeSource.indexOf("[", declarationIndex + declaration.length);
  assert.notEqual(arrayStart, -1, "smoke IPC registry should be an array literal");
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = arrayStart; index < smokeSource.length; index += 1) {
    const character = smokeSource[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") depth -= 1;
    if (depth === 0) {
      return [...vm.runInNewContext(`(${smokeSource.slice(arrayStart, index + 1)})`)];
    }
  }

  assert.fail("smoke IPC registry array should be closed");
}

async function getActualPreloadInvokeChannels(preloadSource) {
  const invoked = [];
  const listeners = new Map();
  const sent = [];
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
            return Promise.resolve({ channel, payload });
          },
          on: (channel, callback) => {
            listeners.set(channel, callback);
          },
          send: (channel, payload) => {
            sent.push({ channel, payload });
          }
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });
  assert.deepEqual(Object.keys(exposedApi).sort(), [
    "cancelModelSetup",
    "checkTextProvider",
    "checkWhisper",
    "getLatestStatus",
    "getLocalModelStatus",
    "getModelSetupStatus",
    "getProviderStatus",
    "getSettings",
    "insertText",
    "listHistory",
    "onOpenSettings",
    "onRecordingReset",
    "onRecordingStart",
    "onRecordingStop",
    "onShortcutToggle",
    "onStatus",
    "onSystemInputStatus",
    "processWav",
    "refreshModelSetupStatus",
    "reportRecordingStatus",
    "saveSettings",
    "startModelSetup"
  ]);

  await exposedApi.getSettings();
  await exposedApi.saveSettings({ hotkey: "CommandOrControl+Alt+Space" });
  await exposedApi.listHistory();
  await exposedApi.checkWhisper();
  await exposedApi.checkTextProvider();
  await exposedApi.getProviderStatus();
  await exposedApi.getLocalModelStatus();
  await exposedApi.getModelSetupStatus();
  await exposedApi.startModelSetup("whisper");
  await exposedApi.cancelModelSetup("whisper");
  await exposedApi.refreshModelSetupStatus();
  await exposedApi.getLatestStatus();
  await exposedApi.insertText("smoke text");
  await exposedApi.processWav(new Uint8Array([1, 2, 3]));
  for (const subscribe of [
    exposedApi.onShortcutToggle,
    exposedApi.onRecordingStart,
    exposedApi.onRecordingStop,
    exposedApi.onRecordingReset,
    exposedApi.onStatus,
    exposedApi.onSystemInputStatus,
    exposedApi.onOpenSettings
  ]) {
    subscribe(() => undefined);
  }
  exposedApi.reportRecordingStatus({ phase: "idle" });

  assert.equal(listeners.size, 7, "every exposed subscription API should register a listener");
  assert.deepEqual(sent, [{ channel: "recording:status", payload: { phase: "idle" } }]);
  return [...new Set(invoked.map((item) => item.channel))].sort();
}

test("electronRuntimeSwitches disables sandbox and GPU paths for constrained Windows sessions", () => {
  assert.deepEqual(electronRuntimeSwitches, [
    "no-sandbox",
    "disable-gpu",
    "disable-gpu-compositing",
    "disable-software-rasterizer"
  ]);
});

test("npm start passes Electron runtime switches before the app path", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    pkg.scripts.start,
    "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer ."
  );
});

test("package exposes microphone smoke test script", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    pkg.scripts["check:microphone"],
    "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer scripts/electron-microphone-smoke.mjs"
  );
});

test("package exposes full app smoke test script", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    pkg.scripts["check:app"],
    "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer scripts/electron-app-smoke.mjs"
  );
});

test("Windows launcher starts from the project directory before falling back to dependency install", async () => {
  const launcher = await readFile(new URL("../Start-LocalFlow.cmd", import.meta.url), "utf8");
  const startIndex = launcher.indexOf("npm.cmd start");
  const installIndex = launcher.indexOf("npm.cmd install");

  assert.match(launcher, /cd \/d "%~dp0"/);
  assert.match(launcher, /set "ELECTRON_MIRROR=https:\/\/npmmirror\.com\/mirrors\/electron\/"/);
  assert.notEqual(startIndex, -1);
  assert.notEqual(installIndex, -1);
  assert.ok(startIndex < installIndex, "launcher should try npm start before npm install");
});

test("main window uses an Electron-compatible CommonJS preload script", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");

  assert.match(mainSource, /preload\.cjs/);
  assert.match(preloadSource, /require\("electron"\)/);
  assert.doesNotMatch(preloadSource, /^\s*import\s/m);
});

test("renderer declares a strict content security policy", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);

  assert.ok(cspMatch, "renderer must declare a Content-Security-Policy meta tag");
  assert.match(cspMatch[1], /default-src 'self'/);
  assert.match(cspMatch[1], /script-src 'self'/);
  assert.doesNotMatch(cspMatch[1], /unsafe-eval/);
  assert.doesNotMatch(cspMatch[1], /unsafe-inline/);
});

test("renderer records audio with AudioWorklet instead of ScriptProcessorNode", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const workletSource = await readFile(new URL("../src/renderer/audio-recorder-worklet.js", import.meta.url), "utf8");

  assert.match(appSource, /audioWorklet\.addModule/);
  assert.match(appSource, /AudioWorkletNode/);
  assert.doesNotMatch(appSource, /createScriptProcessor/);
  assert.match(workletSource, /registerProcessor\("wav-recorder-processor"/);
});

test("app smoke test uses the current Electron console-message event shape", async () => {
  const smokeSource = await readFile(new URL("../scripts/electron-app-smoke.mjs", import.meta.url), "utf8");

  assert.match(smokeSource, /webContents\.on\("console-message", \(_event, details\)/);
  assert.doesNotMatch(smokeSource, /console-message", \(_event, level, message, line, sourceId\)/);
});

test("app smoke rejects every focus containment warning instead of only new warnings", async () => {
  const smokeSource = await readFile(new URL("../scripts/electron-app-smoke.mjs", import.meta.url), "utf8");

  assert.match(smokeSource, /if \(focusContainmentWarnings\.length !== 0\)/);
  assert.doesNotMatch(smokeSource, /focusContainmentWarnings\.length !== focusContainmentWarningCount/);
});

test("app smoke history fixtures include complete Chinese English and emoji entries", async () => {
  const smokeSource = await readFile(new URL("../scripts/electron-app-smoke.mjs", import.meta.url), "utf8");
  const fixturesMatch = smokeSource.match(/const historyFixtures = \[(?<fixtures>[\s\S]*?)\n\];/);

  assert.ok(fixturesMatch, "history fixtures should be declared");
  const completeEntries = [...fixturesMatch.groups.fixtures.matchAll(/status:\s*"complete"[\s\S]*?text:\s*"([^"]+)"/g)]
    .map((match) => match[1]);

  assert.ok(completeEntries.length >= 3, "smoke history should include three completed entries");
  assert.ok(completeEntries.some((text) => /[\u4e00-\u9fff]/.test(text)), "a completed history entry should be Chinese");
  assert.ok(completeEntries.some((text) => /^[\x00-\x7F]+$/.test(text)), "a completed history entry should be English");
  assert.ok(completeEntries.some((text) => /\p{Extended_Pictographic}/u.test(text)), "a completed history entry should include emoji");
  assert.match(fixturesMatch.groups.fixtures, /status:\s*"failed"/);
});

test("app smoke registry matches the channels invoked by every exposed preload API", async () => {
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const smokeSource = await readFile(new URL("../scripts/electron-app-smoke.mjs", import.meta.url), "utf8");
  const preloadChannels = await getActualPreloadInvokeChannels(preloadSource);
  const smokeChannels = getSmokeIpcChannelRegistry(smokeSource).sort();

  assert.deepEqual(smokeChannels, preloadChannels);
  assert.equal([...smokeSource.matchAll(/ipcMain\.handle\(/g)].length, 1);
  assert.match(smokeSource, /function registerSmokeIpcHandler\(channel, handler\)/);
  assert.match(smokeSource, /registeredSmokeIpcChannels\.add\(channel\)/);
  assert.match(smokeSource, /assertSmokeIpcCoverage\(\);/);
});

test("app smoke verifies missing Whisper recovery and first-screen controls", async () => {
  const smokeSource = await readFile(new URL("../scripts/electron-app-smoke.mjs", import.meta.url), "utf8");

  for (const token of [
    "missingWhisperRecoveryState",
    "whisperDiagnosticsResult",
    "providerStatusOverride",
    "visibleRecordRecoveryCount",
    "recordRecoveryActionText",
    "mainSetupControlCount",
    "hasLanguageControls",
    "hasVoiceCommandBar",
    "hasResultText",
    "hasRecentHistoryList",
    "hasFooterHealthText",
    "hasRecordButton"
  ]) {
    assert.match(smokeSource, new RegExp(token), token);
  }
});

test("preload shortcut toggle callback does not receive the raw IPC event", async () => {
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const listeners = new Map();
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
          invoke: () => undefined,
          on: (channel, listener) => {
            listeners.set(channel, listener);
          }
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });

  const calls = [];
  exposedApi.onShortcutToggle((...args) => calls.push(args));
  listeners.get("recording:toggle")({ sender: "main" }, "unexpected");

  assert.deepEqual(calls, [[]]);
});

test("preload exposes explicit recording command listeners without raw IPC events", async () => {
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const listeners = new Map();
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
          invoke: () => undefined,
          on: (channel, listener) => {
            listeners.set(channel, listener);
          },
          send: () => undefined
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });

  const calls = [];
  exposedApi.onRecordingStart((...args) => calls.push(["start", args]));
  exposedApi.onRecordingStop((...args) => calls.push(["stop", args]));
  listeners.get("recording:start")({ sender: "main" }, "unexpected");
  listeners.get("recording:stop")({ sender: "main" }, "unexpected");

  assert.equal(exposedApi.ipcRenderer, undefined);
  assert.deepEqual(calls, [
    ["start", []],
    ["stop", []]
  ]);
});

test("preload exposes recording reset listener without raw IPC events", async () => {
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const listeners = new Map();
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
          invoke: () => undefined,
          on: (channel, listener) => {
            listeners.set(channel, listener);
          },
          send: () => undefined
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });

  const calls = [];
  exposedApi.onRecordingReset((...args) => calls.push(args));
  listeners.get("recording:reset")({ sender: "main" }, "unexpected");

  assert.equal(exposedApi.ipcRenderer, undefined);
  assert.deepEqual(calls, [[]]);
});

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
  assert.deepEqual(await exposedApi.cancelModelSetup("llm"), {
    channel: "models:setup-cancel",
    payload: "llm"
  });
  assert.deepEqual(await exposedApi.refreshModelSetupStatus(), {
    channel: "models:setup-refresh",
    payload: undefined
  });
  assert.deepEqual(invoked.map((item) => item.channel), [
    "models:setup-status",
    "models:setup-start",
    "models:setup-cancel",
    "models:setup-refresh"
  ]);
});

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

test("preload exposes latest dictation status safely", async () => {
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  let exposedApi = null;
  const invoked = [];

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
            return { phase: "error", message: "Shortcut conflict" };
          },
          on: () => undefined,
          send: () => undefined
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });

  assert.equal(exposedApi.ipcRenderer, undefined);
  assert.deepEqual(await exposedApi.getLatestStatus(), { phase: "error", message: "Shortcut conflict" });
  assert.deepEqual(invoked, [{ channel: "dictation:status-latest", payload: undefined }]);
});

test("preload exposes insert text IPC without raw ipcRenderer access", async () => {
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
            return { ok: true };
          },
          on: () => {},
          send: () => {}
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });

  assert.equal(exposedApi.ipcRenderer, undefined);
  assert.deepEqual(await exposedApi.insertText("edited text"), { ok: true });
  assert.deepEqual(invoked, [{ channel: "dictation:insert-text", payload: "edited text" }]);
});

test("preload exposes settings open listener without raw IPC event access", async () => {
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  let exposedApi = null;
  const channels = [];
  const listeners = new Map();

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
          invoke: () => undefined,
          on: (channel, callback) => {
            channels.push(channel);
            listeners.set(channel, callback);
          },
          send: () => undefined
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });

  const calls = [];
  exposedApi.onOpenSettings((...args) => calls.push(args));
  listeners.get("settings:open")({ sender: "main" }, "unexpected");

  assert.equal(exposedApi.ipcRenderer, undefined);
  assert.deepEqual(channels, ["settings:open"]);
  assert.deepEqual(calls, [[]]);
});

test("HUD preload exposes only system input status subscription", async () => {
  const preloadSource = await readFile(new URL("../src/hud-preload.cjs", import.meta.url), "utf8");
  let exposedApi = null;
  const channels = [];

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
          on: (channel, callback) => {
            channels.push(channel);
            callback({ sender: "main" }, { phase: "warning" });
          }
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "hud-preload.cjs" });

  const states = [];
  exposedApi.onSystemInputStatus((state) => states.push(state));

  assert.deepEqual(Object.keys(exposedApi), ["onSystemInputStatus"]);
  assert.deepEqual(channels, ["system-input:status"]);
  assert.deepEqual(states, [{ phase: "warning" }]);
});

test("HUD view model names warning lifecycle states", async () => {
  const hudSource = await readFile(new URL("../src/renderer/hud-state.js", import.meta.url), "utf8");

  assert.match(hudSource, /warning:\s*"[^"]+"/);
});

test("preload exposes safe renderer recording status reporting without raw ipcRenderer access", async () => {
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const sent = [];
  let exposedApi = null;

  const sandbox = {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name, api) => {
          exposedApi = api;
        }
      },
      ipcRenderer: {
        invoke: () => undefined,
        on: () => undefined,
        send: (channel, payload) => {
          sent.push({ channel, payload });
        }
      }
    })
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });

  exposedApi.reportRecordingStatus({ phase: "recording", message: "Recording" });

  assert.equal(exposedApi.ipcRenderer, undefined);
  assert.deepEqual(sent, [
    {
      channel: "recording:status",
      payload: { phase: "recording", message: "Recording" }
    }
  ]);
});

test("main process delegates model setup IPC wiring to the setup IPC module", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");

  assert.match(mainSource, /import \{[^}]*createModelSetupService[^}]*\} from "\.\/model-setup\.js";/);
  assert.match(mainSource, /import \{ wireModelSetupIpc \} from "\.\/model-setup-ipc\.js";/);
  assert.match(mainSource, /let modelSetupService;/);
  assert.match(mainSource, /modelSetupService = createModelSetupService\(\{/);
  assert.match(mainSource, /wireModelSetupIpc\(\{/);
  assert.match(mainSource, /modelSetupService,/);
  assert.match(mainSource, /settingsStore/);
});

test("main process imports Windows productization modules", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");

  assert.match(mainSource, /import \{ getRuntimeRoot, getVendorRoot, getAppRoot \} from "\.\/runtime-root\.js";/);
  assert.match(mainSource, /import \{ applyStartupSettings, shouldStartMinimized \} from "\.\/startup-settings\.js";/);
  assert.match(mainSource, /import \{ createHotkeyManager \} from "\.\/hotkey-manager\.js";/);
  assert.match(mainSource, /import \{ buildTrayMenuTemplate, getTrayTooltip \} from "\.\/tray-menu\.js";/);
  assert.match(mainSource, /import \{ getTrayIconPath \} from "\.\/tray-icon\.js";/);
  assert.match(mainSource, /import \{ createNativeInputShortcutFromPackage \} from "\.\/native-input-shortcut\.js";/);
  assert.match(mainSource, /import \{ createShortcutBackend \} from "\.\/shortcut-backend\.js";/);
});

test("main process stores and serves latest dictation status", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const sendStatusMatch = mainSource.match(/function sendStatus\(payload\) \{(?<body>[\s\S]*?)\n\}/);

  assert.match(mainSource, /let lastDictationStatus/);
  assert.ok(sendStatusMatch, "sendStatus should be defined");
  assert.match(sendStatusMatch.groups.body, /lastDictationStatus\s*=\s*payload/);
  assert.match(mainSource, /ipcMain\.handle\("dictation:status-latest", \(\) => lastDictationStatus \|\| null\)/);
});

test("main process uses a real tray icon helper with empty image fallback", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const createTrayMatch = mainSource.match(/function createTray\(\) \{(?<body>[\s\S]*?)\r?\n\}\r?\n\r?\nfunction refreshTrayMenu/);

  assert.match(mainSource, /import \{ getTrayIconPath \} from "\.\/tray-icon\.js";/);
  assert.ok(createTrayMatch, "createTray should be defined");
  assert.match(createTrayMatch.groups.body, /nativeImage\.createFromPath\(getTrayIconPath\(appRoot\)\)/);
  assert.match(createTrayMatch.groups.body, /\.isEmpty\(\)/);
  assert.match(createTrayMatch.groups.body, /nativeImage\.createEmpty\(\)/);
  assert.ok(
    createTrayMatch.groups.body.indexOf("nativeImage.createEmpty()") >
      createTrayMatch.groups.body.indexOf("nativeImage.createFromPath(getTrayIconPath(appRoot))"),
    "empty tray image should only be used after trying the real icon"
  );
});

test("main process wires packaged runtime roots into asset detection and setup", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const modelSetupMatch = mainSource.match(/createModelSetupService\(\{(?<body>[\s\S]*?)\n\s*\}\)/);

  assert.match(mainSource, /runtimeRoot = getRuntimeRoot\(\{ app \}\)/);
  assert.match(mainSource, /vendorRoot = getVendorRoot\(runtimeRoot\)/);
  assert.match(mainSource, /appRoot = getAppRoot\(\{ app \}\)/);
  assert.match(mainSource, /detectWhisperAssets\(runtimeRoot\)/);
  assert.match(mainSource, /detectEmbeddedLlmAssets\(runtimeRoot\)/);
  assert.match(mainSource, /ipcMain\.handle\("llm:status", \(\) => detectEmbeddedLlmAssets\(runtimeRoot\)\)/);
  assert.ok(modelSetupMatch, "createModelSetupService options should be inline and inspectable");
  assert.match(modelSetupMatch.groups.body, /rootPath: runtimeRoot/);
  assert.match(modelSetupMatch.groups.body, /scriptRootPath: appRoot/);
  assert.match(modelSetupMatch.groups.body, /assetRootPath: runtimeRoot/);
  assert.match(modelSetupMatch.groups.body, /nodeExecutable: process\.execPath/);
  assert.match(modelSetupMatch.groups.body, /setupEnv:\s*async\s*\(\)\s*=>/);
  assert.match(modelSetupMatch.groups.body, /ELECTRON_RUN_AS_NODE: "1"/);
  assert.match(modelSetupMatch.groups.body, /buildSetupDownloadEnv\(await settingsStore\.getSettings\(\)\)/);
});

test("main process delegates hotkeys startup settings and tray state to product modules", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");

  assert.match(mainSource, /let hotkeyManager;/);
  assert.match(mainSource, /let lastSettings;/);
  assert.match(mainSource, /let lastSystemInputState/);
  assert.match(mainSource, /function refreshTrayMenu\(\)/);
  assert.match(mainSource, /buildTrayMenuTemplate\(\{/);
  assert.match(mainSource, /getTrayTooltip\(\{/);
  assert.match(mainSource, /applyStartupSettings\(app, lastSettings\)/);
  assert.match(mainSource, /shouldStartMinimized\(process\.argv, lastSettings\)/);
  assert.match(mainSource, /hotkeyManager = createHotkeyManager\(\{/);
  assert.match(mainSource, /const shortcutBackend = createShortcutBackend\(\{/);
  assert.match(mainSource, /globalShortcut: shortcutBackend/);
  assert.match(mainSource, /await hotkeyManager\.register\(settings\)/);
  assert.doesNotMatch(mainSource, /globalShortcut\.unregisterAll\(\)/);
});

test("main process wires the optional native input hook backend", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");

  assert.match(mainSource, /let nativeShortcut;/);
  assert.match(mainSource, /nativeShortcut = await createNativeInputShortcutFromPackage\(\{/);
  assert.match(mainSource, /platform: process\.platform/);
  assert.match(mainSource, /Native input hook unavailable/);
  assert.match(mainSource, /createShortcutBackend\(\{\s*globalShortcut,\s*nativeShortcut\s*\}\)/);
});

test("main process wires desktop convenience shortcut callbacks", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");

  assert.match(mainSource, /import \{ pasteText \} from "\.\/paste\.js";/);
  assert.match(mainSource, /async function pasteLastDictation\(\)/);
  assert.match(mainSource, /function getLastDictationText\(status\)/);
  assert.match(mainSource, /await pasteText\(text, \{ clipboard \}\)/);
  assert.match(mainSource, /onStart:\s*\(\)\s*=>\s*systemInputController\?\.start\(\)/);
  assert.match(mainSource, /onStop:\s*\(\)\s*=>\s*systemInputController\?\.stop\(\)/);
  assert.match(mainSource, /onPasteLast:\s*\(\)\s*=>\s*pasteLastDictation\(\)/);
});

test("settings save handler preserves previous startup values if system startup apply fails", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const settingsSaveMatch = mainSource.match(/ipcMain\.handle\("settings:save", async \(_event, settings\) => \{(?<body>[\s\S]*?)\n\s*\}\);/);

  assert.ok(settingsSaveMatch, "settings:save handler should be defined inline");
  assert.match(settingsSaveMatch.groups.body, /saveSettingsWithSystemEffects|restoreStartupSettings/);
  assert.match(mainSource, /launchAtLogin/);
  assert.match(mainSource, /startMinimizedToTray/);
});

test("app smoke reads product settings controls with null-safe fallbacks", async () => {
  const smokeSource = await readFile(new URL("../scripts/electron-app-smoke.mjs", import.meta.url), "utf8");

  assert.match(smokeSource, /launchAtLogin:\s*document\.querySelector\('#launchAtLogin'\)\?\.checked \?\? null/);
  assert.match(smokeSource, /startMinimizedToTray:\s*document\.querySelector\('#startMinimizedToTray'\)\?\.checked \?\? null/);
  assert.match(smokeSource, /globalShortcutPaused:\s*document\.querySelector\('#globalShortcutPaused'\)\?\.checked \?\? null/);
  assert.match(smokeSource, /settingsDrawerOpen:\s*document\.querySelector\('#settingsDrawer'\)\?\.classList\.contains\('open'\) \|\| false/);
});

test("app smoke covers settings open IPC behavior", async () => {
  const smokeSource = await readFile(new URL("../scripts/electron-app-smoke.mjs", import.meta.url), "utf8");

  assert.match(smokeSource, /window\.webContents\.send\("settings:open"\)/);
  assert.match(smokeSource, /state\.settingsDrawerOpen === true/);
  assert.match(smokeSource, /document\.querySelector\('#closeSettings'\)\.click\(\)/);
  assert.match(smokeSource, /state\.settingsDrawerOpen === false/);
});

test("app smoke covers keyboard and mouse shortcut recording", async () => {
  const smokeSource = await readFile(new URL("../scripts/electron-app-smoke.mjs", import.meta.url), "utf8");

  assert.match(smokeSource, /document\.querySelector\('#recordHotkey'\)\.click\(\)/);
  assert.match(smokeSource, /new KeyboardEvent\('keydown'/);
  assert.match(smokeSource, /document\.querySelector\('#recordPasteLastHotkey'\)\.click\(\)/);
  assert.match(smokeSource, /new MouseEvent\('mousedown'/);
  assert.match(smokeSource, /hotkeyValue:\s*document\.querySelector\('#hotkey'\)\?\.value/);
  assert.match(smokeSource, /pasteLastHotkeyValue:\s*document\.querySelector\('#pasteLastHotkey'\)\?\.value/);
});

test("main process uses explicit renderer commands for system input start and stop", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const startRecordingMatch = mainSource.match(/startRecording:\s*async\s*\(\)\s*=>\s*\{(?<body>[\s\S]*?)\r?\n\s*\},\r?\n\s*stopRecording:/);
  const stopRecordingMatch = mainSource.match(/stopRecording:\s*async\s*\(\)\s*=>\s*\{(?<body>[\s\S]*?)\r?\n\s*\},\r?\n\s*isReadyToRecord:/);

  assert.ok(startRecordingMatch, "system input controller should use a block startRecording handler");
  assert.ok(stopRecordingMatch, "system input controller should use a block stopRecording handler");
  assert.doesNotMatch(startRecordingMatch.groups.body, /setPhase\("recording"/);
  assert.doesNotMatch(startRecordingMatch.groups.body, /toggleRecording\(\)/);
  assert.doesNotMatch(stopRecordingMatch.groups.body, /toggleRecording\(\)/);
  assert.match(startRecordingMatch.groups.body, /sendRecordingStartCommand\(\)/);
  assert.match(stopRecordingMatch.groups.body, /sendRecordingStopCommand\(\)/);
  assert.match(mainSource, /sendWindowMessage\(mainWindow, "recording:start"\)/);
  assert.match(mainSource, /sendWindowMessage\(mainWindow, "recording:stop"\)/);
  assert.match(mainSource, /ipcMain\.on\("recording:status"/);
  assert.match(mainSource, /const status = sanitizeRecordingStatusPayload\(payload\)/);
  assert.match(mainSource, /systemInputController\?\.handleRendererStatus\(status\)/);
});

test("main process injects renderer reset into the system input controller", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const controllerOptionsMatch = mainSource.match(
    /systemInputController = createSystemInputController\(\{(?<body>[\s\S]*?)\r?\n\s*\}\);\r?\n\s*hotkeyManager =/
  );

  assert.ok(controllerOptionsMatch, "system input controller options should be inline and inspectable");
  assert.match(
    controllerOptionsMatch.groups.body,
    /requestRendererReset:\s*\(\)\s*=>\s*sendWindowMessage\(mainWindow, "recording:reset"\)/
  );
});

test("main process creates HUD with dedicated least-privilege preload", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const createHudMatch = mainSource.match(/function createHudWindow\(\) \{(?<body>[\s\S]*?)\n\}/);

  assert.ok(createHudMatch, "createHudWindow should be defined");
  assert.match(mainSource, /import \{ buildHudWindowOptions, getHudHtmlPath, getHudPreloadPath \} from "\.\/hud-window\.js";/);
  assert.match(createHudMatch.groups.body, /preloadPath: getHudPreloadPath\(__dirname\)/);
  assert.doesNotMatch(createHudMatch.groups.body, /\.\.\/preload\.cjs/);
});

test("main process can suppress primary window display for hidden startup", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const createWindowMatch = mainSource.match(/function createWindow\(\{ showOnReady = true \} = \{\}\) \{(?<body>[\s\S]*?)\n\}/);

  assert.ok(createWindowMatch, "createWindow should be defined");
  assert.match(createWindowMatch.groups.body, /show: false/);
  assert.match(createWindowMatch.groups.body, /mainWindow\.once\("ready-to-show"/);
  assert.match(createWindowMatch.groups.body, /if \(!showOnReady\) \{\s*return;\s*\}/);
  assert.match(createWindowMatch.groups.body, /mainWindow\.show\(\)/);
  assert.match(createWindowMatch.groups.body, /mainWindow\.focus\(\)/);
  assert.match(mainSource, /const startHidden = shouldStartMinimized\(process\.argv, lastSettings\)/);
  assert.match(mainSource, /createWindow\(\{ showOnReady: !startHidden \}\)/);
});

test("main process only accepts recording status from the main renderer", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const recordingStatusMatch = mainSource.match(/ipcMain\.on\("recording:status", \(_event, payload\) => \{(?<body>[\s\S]*?)\n\s*\}\);/);

  assert.ok(recordingStatusMatch, "recording status IPC handler should be defined");
  assert.match(recordingStatusMatch.groups.body, /if \(_event\.sender !== mainWindow\?\.webContents\) \{\s*return;\s*\}/);
  assert.ok(
    recordingStatusMatch.groups.body.indexOf("_event.sender !== mainWindow?.webContents") <
      recordingStatusMatch.groups.body.indexOf("sanitizeRecordingStatusPayload(payload)"),
    "main should reject non-main senders before sanitizing or handling status"
  );
});

test("main process restricts insert text IPC to the main renderer", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const insertHandlerMatch = mainSource.match(
    /ipcMain\.handle\("dictation:insert-text", async \(_event, text\) => \{(?<body>[\s\S]*?)\n\s*\}\);/
  );

  assert.ok(insertHandlerMatch, "insert text IPC handler should be defined");
  const body = insertHandlerMatch.groups.body;
  assert.match(mainSource, /import \{ insertTextIntoPreviousApp \} from "\.\/insert-text\.js";/);
  const guardMatch = body.match(/if \(_event\.sender !== mainWindow\?\.webContents\) \{\s*return \{\s*ok: false,\s*reason: "unauthorized",\s*message: "Paste failed\. Text copied\."\s*\};\s*\}/);

  assert.match(removeLeadingWhitespaceAndComments(body), /^if \(_event\.sender !== mainWindow\?\.webContents\) \{/);
  assert.ok(guardMatch, "insert text handler should reject unauthorized senders");
  assert.match(body, /try \{\s*return await insertTextIntoPreviousApp\(text, \{ mainWindow, clipboard \}\);\s*\} catch \{\s*return \{\s*ok: false,\s*reason: "paste_failed",\s*message: "Paste failed\. Text copied\."\s*\};\s*\}/);
  assert.ok(
    body.search(/\btext\b/) > guardMatch.index + guardMatch[0].length,
    "main should not use text before the unauthorized sender guard has returned"
  );
});

test("main process removes the default application menu after creating the main window", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const createWindowMatch = mainSource.match(/function createWindow\(\{ showOnReady = true \} = \{\}\) \{(?<body>[\s\S]*?)\n\}/);

  assert.ok(createWindowMatch, "createWindow should be defined");
  assert.match(createWindowMatch.groups.body, /mainWindow = new BrowserWindow\([\s\S]*?\);\s*Menu\.setApplicationMenu\(null\);/);
  assert.match(mainSource, /Menu\.buildFromTemplate/);
});

test("main process delegates recording command timeouts to the system input controller", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");

  assert.match(mainSource, /systemInputController\.setPhase\("starting"/);
  assert.match(mainSource, /systemInputController\.setPhase\("stopping"/);
  assert.match(
    mainSource,
    /requestRendererReset:\s*\(\)\s*=>\s*sendWindowMessage\(mainWindow, "recording:reset"\)/
  );
  assert.doesNotMatch(mainSource, /scheduleRecordingCommandTimeout/);
  assert.doesNotMatch(mainSource, /clearRecordingCommandTimeout/);
  assert.doesNotMatch(mainSource, /recordingCommandTimeoutMs/);
  assert.doesNotMatch(mainSource, /let recordingCommandTimeout\b/);
  assert.doesNotMatch(mainSource, /function toggleRecording\(\)/);
});

test("main process hides HUD when system input returns idle", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const sendStatusMatch = mainSource.match(/function sendSystemInputStatus\(state\) \{(?<body>[\s\S]*?)\n\}/);

  assert.ok(sendStatusMatch, "sendSystemInputStatus should be defined");
  assert.match(sendStatusMatch.groups.body, /if \(state\?\.phase === "idle"\) \{\s*hideHud\(\);\s*return;\s*\}/);
  assert.match(mainSource, /function hideHud\(\) \{/);
});

test("main process sends HUD system input status with interface language", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const sendStatusMatch = mainSource.match(
    /function sendSystemInputStatus\(state\) \{(?<body>[\s\S]*?)\r?\n\}\r?\n\r?\nfunction showHud/
  );

  assert.ok(sendStatusMatch, "sendSystemInputStatus should be defined");
  const body = sendStatusMatch.groups.body;
  const normalizedStateIndex = body.indexOf("lastSystemInputState = state && typeof state === \"object\" ? state : { phase: \"idle\" }");
  const hudStateIndex = body.indexOf("const hudState = {");
  const hudSendIndex = body.indexOf("sendWindowMessage(hudWindow, \"system-input:status\", hudState)");

  assert.notEqual(normalizedStateIndex, -1, "system input state should be normalized first");
  assert.notEqual(hudStateIndex, -1, "HUD status should be built from a dedicated payload");
  assert.ok(hudStateIndex > normalizedStateIndex, "HUD status should use the normalized latest system input state");
  assert.match(body, /sendWindowMessage\(mainWindow, "system-input:status", state\)/);
  assert.match(
    body,
    /const hudState = \{\s*\.\.\.lastSystemInputState,\s*language: lastSettings\?\.interfaceLanguage \|\| "zh-Hans"\s*\}/
  );
  assert.notEqual(hudSendIndex, -1, "HUD should receive the language-aware status payload");
  assert.ok(hudSendIndex > hudStateIndex, "HUD status should be sent after the payload is created");
  assert.doesNotMatch(body, /sendWindowMessage\(hudWindow, "system-input:status", state\)/);
});

test("main process shows terminal HUD states without owning terminal auto-idle", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const sendStatusMatch = mainSource.match(
    /function sendSystemInputStatus\(state\) \{(?<body>[\s\S]*?)\r?\n\}\r?\n\r?\nfunction showHud/
  );

  assert.ok(sendStatusMatch, "sendSystemInputStatus should be defined");
  assert.match(mainSource, /const terminalSystemInputPhases = new Set\(\["done", "warning", "error"\]\)/);
  assert.match(sendStatusMatch.groups.body, /if \(terminalSystemInputPhases\.has\(state\?\.phase\)\) \{\s*showHud\(\);\s*return;\s*\}/);
  assert.doesNotMatch(mainSource, /scheduleTerminalAutoIdle/);
  assert.doesNotMatch(mainSource, /clearTerminalAutoIdle/);
  assert.doesNotMatch(mainSource, /terminalAutoIdleTimeout/);
  assert.doesNotMatch(mainSource, /terminalAutoIdleMs/);
  assert.match(mainSource, /slice\(0, maxRendererStatusTextLength\)/);
  assert.match(mainSource, /const maxRendererStatusTextLength = 240/);
  assert.match(mainSource, /"starting"/);
  assert.match(mainSource, /"stopping"/);
});

test("renderer reports recording lifecycle only after start succeeds and before stop processing", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const startRecordingMatch = appSource.match(/async function startRecording\(\) \{(?<body>[\s\S]*?)\n\}/);
  const stopRecordingMatch = appSource.match(/async function stopRecording\(\) \{(?<body>[\s\S]*?)\n\}/);
  const failRecordingStartMatch = appSource.match(/function failRecordingStart\([^)]*\) \{(?<body>[\s\S]*?)\n\}/);

  assert.ok(startRecordingMatch, "startRecording should be defined");
  assert.ok(stopRecordingMatch, "stopRecording should be defined");
  assert.ok(failRecordingStartMatch, "failRecordingStart should be defined");
  assert.match(appSource, /function reportRecordingLifecycle\(payload\) \{/);
  assert.ok(
    startRecordingMatch.groups.body.indexOf("await nextRecorder.start()") <
      startRecordingMatch.groups.body.indexOf('reportRecordingLifecycle({ phase: "recording"'),
    "renderer should report recording only after recorder.start resolves"
  );
  assert.ok(
    stopRecordingMatch.groups.body.indexOf('reportRecordingLifecycle({ phase: "transcribing"') <
      stopRecordingMatch.groups.body.indexOf("await activeRecorder.stop()"),
    "renderer should report transcribing before awaiting recorder.stop"
  );
  assert.match(startRecordingMatch.groups.body, /failRecordingStart\(operationToken/);
  assert.match(failRecordingStartMatch.groups.body, /reportRecordingLifecycle\(\{ phase: "error"/);
  assert.match(stopRecordingMatch.groups.body, /reportRecordingLifecycle\(\{ phase: "error"/);
});

test("renderer uses explicit command handlers and local lifecycle guards", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const toggleRecordingMatch = appSource.match(/async function toggleRecording\(\) \{(?<body>[\s\S]*?)\n\}/);
  const startRecordingMatch = appSource.match(/async function startRecording\(\) \{(?<body>[\s\S]*?)\n\}/);
  const stopRecordingMatch = appSource.match(/async function stopRecording\(\) \{(?<body>[\s\S]*?)\n\}/);

  assert.match(appSource, /let recordingLifecyclePhase = "idle";/);
  assert.match(appSource, /window\.localFlow\.onRecordingStart\(startRecording\)/);
  assert.match(appSource, /window\.localFlow\.onRecordingStop\(stopRecording\)/);
  assert.match(toggleRecordingMatch.groups.body, /recordingLifecyclePhase === "idle"/);
  assert.match(toggleRecordingMatch.groups.body, /recordingLifecyclePhase === "recording"/);
  assert.match(startRecordingMatch.groups.body, /if \(recordingLifecyclePhase !== "idle"\) return;/);
  assert.match(startRecordingMatch.groups.body, /beginRecordingOperation\("starting"\)/);
  assert.match(startRecordingMatch.groups.body, /if \(!ensureRecordReady\(\)\) \{/);
  assert.match(startRecordingMatch.groups.body, /reportRecordingLifecycle\(\{\s*phase: "error",[\s\S]*reason: "not_ready"/);
  assert.match(stopRecordingMatch.groups.body, /if \(recordingLifecyclePhase !== "recording"\) return;/);
  assert.match(stopRecordingMatch.groups.body, /beginRecordingOperation\("stopping"\)/);
  assert.match(stopRecordingMatch.groups.body, /reportRecordingLifecycle\(\{ phase: "stopping"/);
  assert.match(appSource, /function setRecordingLifecyclePhase\(phase\) \{/);
});

test("renderer opens the settings drawer when main process requests settings", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");

  assert.match(appSource, /window\.localFlow\.onOpenSettings\?\.\(\(\) => \{\s*setSettingsDrawer\(true\);\s*\}\)/);
});

test("renderer requests latest status after subscribing to main status", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const subscribeIndex = appSource.indexOf("window.localFlow.onStatus(handleMainStatus)");
  const latestIndex = appSource.indexOf("window.localFlow.getLatestStatus");
  const replayIndex = appSource.indexOf("handleMainStatus(latestStatus)");

  assert.notEqual(subscribeIndex, -1, "renderer should subscribe to live main status");
  assert.ok(latestIndex > subscribeIndex, "renderer should request latest status after subscribing");
  assert.ok(replayIndex > latestIndex, "renderer should replay the fetched latest status");
});

test("renderer sends Windows productization fields when settings form saves", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const saveSettingsMatch = appSource.match(
    /async function saveSettingsFromCurrentForm\(\{ updateStatus = true \} = \{\}\) \{(?<body>[\s\S]*?)\n\}/
  );

  assert.ok(saveSettingsMatch, "saveSettingsFromCurrentForm should be defined");
  assert.match(saveSettingsMatch.groups.body, /globalShortcutPaused:\s*form\.globalShortcutPaused\.checked/);
  assert.match(saveSettingsMatch.groups.body, /launchAtLogin:\s*form\.launchAtLogin\.checked/);
  assert.match(saveSettingsMatch.groups.body, /startMinimizedToTray:\s*form\.startMinimizedToTray\.checked/);
  assert.match(saveSettingsMatch.groups.body, /shortcutMode:\s*data\.get\("shortcutMode"\)/);
  assert.match(saveSettingsMatch.groups.body, /pasteLastHotkey:\s*data\.get\("pasteLastHotkey"\)/);
  assert.match(saveSettingsMatch.groups.body, /whisperRuntimeUrl:\s*data\.get\("whisperRuntimeUrl"\)/);
  assert.match(saveSettingsMatch.groups.body, /whisperModelMirrorUrls:\s*data\.get\("whisperModelMirrorUrls"\)/);
  assert.match(saveSettingsMatch.groups.body, /llamaRuntimeUrl:\s*data\.get\("llamaRuntimeUrl"\)/);
  assert.match(saveSettingsMatch.groups.body, /qwenModelMirrorUrls:\s*data\.get\("qwenModelMirrorUrls"\)/);
});

test("renderer resets stale recording operations and ignores late completions", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const startRecordingMatch = appSource.match(/async function startRecording\(\) \{(?<body>[\s\S]*?)\n\}/);
  const stopRecordingMatch = appSource.match(/async function stopRecording\(\) \{(?<body>[\s\S]*?)\n\}/);
  const resetMatch = appSource.match(/function resetRecordingLifecycle\(\) \{(?<body>[\s\S]*?)\n\}/);

  assert.match(appSource, /let recordingOperationToken = 0;/);
  assert.match(appSource, /window\.localFlow\.onRecordingReset\(resetRecordingLifecycle\)/);
  assert.match(appSource, /function beginRecordingOperation\(phase\) \{/);
  assert.match(appSource, /function isCurrentRecordingOperation\(operationToken\) \{/);
  assert.match(appSource, /function cleanupRecorder\(/);
  assert.ok(startRecordingMatch, "startRecording should be defined");
  assert.ok(stopRecordingMatch, "stopRecording should be defined");
  assert.ok(resetMatch, "resetRecordingLifecycle should be defined");
  assert.match(startRecordingMatch.groups.body, /const operationToken = beginRecordingOperation\("starting"\)/);
  assert.match(stopRecordingMatch.groups.body, /const operationToken = beginRecordingOperation\("stopping"\)/);
  assert.match(startRecordingMatch.groups.body, /if \(!isCurrentRecordingOperation\(operationToken\)\) return;/);
  assert.match(stopRecordingMatch.groups.body, /if \(!isCurrentRecordingOperation\(operationToken\)\) return;/);
  assert.match(resetMatch.groups.body, /recordingOperationToken \+= 1/);
  assert.match(resetMatch.groups.body, /cleanupRecorder\(\)/);
  assert.match(resetMatch.groups.body, /setRecordingLifecyclePhase\("idle"\)/);
  assert.match(appSource, /dispose\(\) \{/);
});
