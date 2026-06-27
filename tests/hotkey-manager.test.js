import test from "node:test";
import assert from "node:assert/strict";
import { createHotkeyManager } from "../src/main/hotkey-manager.js";

test("registers and triggers active shortcut", () => {
  const globalShortcut = createFakeGlobalShortcut();
  const statuses = [];
  const toggles = [];
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => toggles.push("toggle"),
    onStatus: (status) => statuses.push(status)
  });

  const status = manager.register({ hotkey: " Ctrl+Alt+Space " });

  assert.equal(status.ok, true);
  assert.equal(status.phase, "ready");
  assert.equal(manager.getRegisteredHotkey(), "Ctrl+Alt+Space");

  globalShortcut.trigger("Ctrl+Alt+Space");

  assert.deepEqual(toggles, ["toggle"]);
  assert.equal(statuses.at(-1).phase, "ready");
});

test("reports registration conflicts", () => {
  const globalShortcut = createFakeGlobalShortcut({ registerResult: false });
  const statuses = [];
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => {},
    onStatus: (status) => statuses.push(status)
  });

  const status = manager.register({ hotkey: "Ctrl+Alt+Space" });

  assert.equal(status.ok, false);
  assert.equal(status.reason, "registration_failed");
  assert.match(status.message, /Could not register hotkey/);
  assert.equal(status.phase, "error");
  assert.equal(statuses.at(-1).phase, "error");
});

test("pause unregisters and resume registers again", () => {
  const globalShortcut = createFakeGlobalShortcut();
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => {}
  });

  manager.register({ hotkey: "Ctrl+Alt+Space" });
  manager.pause();
  manager.resume({ hotkey: "Ctrl+Alt+Space" });

  assert.deepEqual(globalShortcut.calls.map((call) => call.type), ["register", "unregister", "register"]);
  assert.equal(manager.isPaused(), false);
});

test("does not register while settings pause shortcuts", () => {
  const globalShortcut = createFakeGlobalShortcut();
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => {}
  });

  const status = manager.register({
    hotkey: "Ctrl+Alt+Space",
    globalShortcutPaused: true
  });

  assert.equal(status.ok, true);
  assert.equal(status.paused, true);
  assert.equal(manager.isPaused(), true);
  assert.deepEqual(globalShortcut.calls, []);
});

function createFakeGlobalShortcut({ registerResult = true } = {}) {
  const callbacks = new Map();
  const calls = [];

  return {
    calls,
    register(hotkey, callback) {
      calls.push({ type: "register", hotkey });
      if (!registerResult) {
        return false;
      }
      callbacks.set(hotkey, callback);
      return true;
    },
    unregister(hotkey) {
      calls.push({ type: "unregister", hotkey });
      callbacks.delete(hotkey);
    },
    trigger(hotkey) {
      callbacks.get(hotkey)?.();
    }
  };
}
