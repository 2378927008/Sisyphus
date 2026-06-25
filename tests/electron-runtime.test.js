import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { electronRuntimeSwitches } from "../src/main/electron-runtime.js";

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

test("main process wires model setup IPC and persists detected local paths", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");

  assert.match(mainSource, /import \{ createModelSetupService \} from "\.\/model-setup\.js";/);
  assert.match(mainSource, /let modelSetupService;/);
  assert.match(mainSource, /modelSetupService = createModelSetupService\(\{/);
  assert.match(mainSource, /ipcMain\.handle\("models:setup-status"/);
  assert.match(mainSource, /ipcMain\.handle\("models:setup-refresh"/);
  assert.match(mainSource, /ipcMain\.handle\("models:setup-start"/);
  assert.match(mainSource, /modelSetupService\.start\(type\)/);
  assert.match(mainSource, /refreshDetectedModelPaths\(\)/);
  assert.match(mainSource, /whisperCliPath/);
  assert.match(mainSource, /whisperModelPath/);
  assert.match(mainSource, /embeddedLlmCliPath/);
  assert.match(mainSource, /embeddedLlmModelPath/);
  assert.match(mainSource, /saveSettings\(next, \{ includeSecrets: true \}\)/);
});
