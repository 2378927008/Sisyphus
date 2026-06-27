import test from "node:test";
import assert from "node:assert/strict";
import { applyStartupSettings, getStartupLaunchArgs, shouldStartMinimized } from "../src/main/startup-settings.js";

test("getStartupLaunchArgs requests hidden startup only when start minimized is enabled", () => {
  assert.deepEqual(getStartupLaunchArgs({ startMinimizedToTray: false }), []);
  assert.deepEqual(getStartupLaunchArgs({ startMinimizedToTray: true }), ["--hidden"]);
});

test("applyStartupSettings calls Electron login item API", () => {
  const calls = [];
  const app = { setLoginItemSettings: (options) => calls.push(options) };
  applyStartupSettings(app, {
    launchAtLogin: true,
    startMinimizedToTray: true
  }, {
    execPath: "C:/Program Files/Local Flow/Local Flow.exe"
  });
  assert.deepEqual(calls, [{
    openAtLogin: true,
    path: "C:/Program Files/Local Flow/Local Flow.exe",
    args: ["--hidden"]
  }]);
});

test("shouldStartMinimized respects hidden argv and user setting", () => {
  assert.equal(shouldStartMinimized(["node", "app"], { startMinimizedToTray: false }), false);
  assert.equal(shouldStartMinimized(["node", "app", "--hidden"], { startMinimizedToTray: false }), true);
  assert.equal(shouldStartMinimized(["node", "app"], { startMinimizedToTray: true }), true);
});
