import test from "node:test";
import assert from "node:assert/strict";
import {
  bindHudDisplayChanges,
  buildHudWindowOptions,
  getHudPreloadPath,
  getHudWindowPosition,
  showHudWindow
} from "../src/main/hud-window.js";

test("buildHudWindowOptions creates a compact non-disruptive HUD", () => {
  const options = buildHudWindowOptions({
    preloadPath: "C:/app/src/hud-preload.cjs",
    workArea: { x: 0, y: 0, width: 1920, height: 1080 }
  });

  assert.equal(options.width, 460);
  assert.equal(options.height, 72);
  assert.equal(options.x, 730);
  assert.equal(options.y, 960);
  assert.equal(options.frame, false);
  assert.equal(options.resizable, false);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.focusable, false);
  assert.equal(options.webPreferences.preload, "C:/app/src/hud-preload.cjs");
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
});

test("getHudPreloadPath points to the least-privilege HUD preload", () => {
  assert.match(getHudPreloadPath("C:/app/src/main"), /hud-preload\.cjs$/);
});

test("getHudWindowPosition preserves negative display coordinates", () => {
  assert.deepEqual(
    getHudWindowPosition({ x: -1920, y: -120, width: 1920, height: 1080 }),
    { x: -1190, y: 840 }
  );
});

test("showHudWindow repositions on the cursor display every time", () => {
  const calls = [];
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    { workArea: { x: -1280, y: 0, width: 1280, height: 1024 } }
  ];
  const window = {
    isDestroyed: () => false,
    setPosition: (...args) => calls.push(["position", ...args]),
    showInactive: () => calls.push(["show"])
  };
  const screen = {
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getDisplayNearestPoint: () => displays.shift()
  };

  showHudWindow({ window, screen });
  showHudWindow({ window, screen });

  assert.deepEqual(calls, [
    ["position", 730, 960, false],
    ["show"],
    ["position", -870, 904, false],
    ["show"]
  ]);
});

test("display topology changes reposition the existing HUD and can be disposed", () => {
  const listeners = new Map();
  const positions = [];
  const screen = {
    on: (event, listener) => listeners.set(event, listener),
    removeListener: (event, listener) => {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({
      workArea: { x: 100, y: 50, width: 1600, height: 900 }
    })
  };
  const window = {
    isDestroyed: () => false,
    setPosition: (...args) => positions.push(args)
  };

  const dispose = bindHudDisplayChanges({ window, screen });
  listeners.get("display-added")();
  listeners.get("display-removed")();
  listeners.get("display-metrics-changed")();
  dispose();

  assert.equal(positions.length, 3);
  assert.deepEqual(positions[0], [670, 830, false]);
  assert.equal(listeners.size, 0);
});
