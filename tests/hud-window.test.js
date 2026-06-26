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
