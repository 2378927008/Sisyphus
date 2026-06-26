import test from "node:test";
import assert from "node:assert/strict";
import { buildHudWindowOptions, getHudPreloadPath } from "../src/main/hud-window.js";

test("buildHudWindowOptions creates a compact non-disruptive HUD", () => {
  const options = buildHudWindowOptions({
    preloadPath: "C:/app/src/hud-preload.cjs",
    workArea: { x: 0, y: 0, width: 1920, height: 1080 }
  });

  assert.equal(options.width, 360);
  assert.equal(options.height, 112);
  assert.equal(options.x, 780);
  assert.equal(options.y, 920);
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
