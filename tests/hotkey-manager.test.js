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

test("registers dictation and paste-last shortcuts independently", () => {
  const globalShortcut = createFakeGlobalShortcut();
  const toggles = [];
  const pastes = [];
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => toggles.push("toggle"),
    onPasteLast: () => pastes.push("paste")
  });

  const status = manager.register({
    hotkey: "Ctrl+Alt+Space",
    pasteLastHotkey: " Ctrl+Alt+V "
  });

  assert.equal(status.ok, true);
  assert.deepEqual(manager.getRegisteredHotkeys(), ["Ctrl+Alt+Space", "Ctrl+Alt+V"]);

  globalShortcut.trigger("Ctrl+Alt+Space");
  globalShortcut.trigger("Ctrl+Alt+V");

  assert.deepEqual(toggles, ["toggle"]);
  assert.deepEqual(pastes, ["paste"]);

  manager.unregister();

  assert.deepEqual(globalShortcut.calls, [
    { type: "register", hotkey: "Ctrl+Alt+Space" },
    { type: "register", hotkey: "Ctrl+Alt+V" },
    { type: "unregister", hotkey: "Ctrl+Alt+Space" },
    { type: "unregister", hotkey: "Ctrl+Alt+V" }
  ]);
});

test("rejects duplicate dictation and paste-last shortcuts", () => {
  const globalShortcut = createFakeGlobalShortcut();
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => {},
    onPasteLast: () => {}
  });

  const status = manager.register({
    hotkey: "Ctrl+Alt+Space",
    pasteLastHotkey: " Ctrl+Alt+Space "
  });

  assert.equal(status.ok, false);
  assert.equal(status.reason, "duplicate_hotkey");
  assert.equal(status.phase, "error");
  assert.deepEqual(globalShortcut.calls, []);
});

test("hold shortcut mode uses a press and release adapter when available", () => {
  const globalShortcut = createFakeGlobalShortcut({ pressAndRelease: true });
  const starts = [];
  const stops = [];
  const toggles = [];
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => toggles.push("toggle"),
    onStart: () => starts.push("start"),
    onStop: () => stops.push("stop")
  });

  const status = manager.register({
    hotkey: "Ctrl+Alt+Space",
    shortcutMode: "hold"
  });

  assert.equal(status.ok, true);
  assert.equal(status.mode, "hold");
  assert.deepEqual(globalShortcut.calls, [
    { type: "registerPressAndRelease", hotkey: "Ctrl+Alt+Space" }
  ]);

  globalShortcut.press("Ctrl+Alt+Space");
  globalShortcut.release("Ctrl+Alt+Space");

  assert.deepEqual(starts, ["start"]);
  assert.deepEqual(stops, ["stop"]);
  assert.deepEqual(toggles, []);
});

test("hold shortcut mode falls back to toggle when release events are unavailable", () => {
  const globalShortcut = createFakeGlobalShortcut();
  const statuses = [];
  const toggles = [];
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => toggles.push("toggle"),
    onStatus: (status) => statuses.push(status)
  });

  const status = manager.register({
    hotkey: "Ctrl+Alt+Space",
    shortcutMode: "hold"
  });

  assert.equal(status.ok, true);
  assert.equal(status.reason, "hold_shortcut_unsupported");
  assert.equal(status.mode, "toggle");
  assert.equal(status.phase, "warning");
  assert.equal(statuses.at(-1), status);

  globalShortcut.trigger("Ctrl+Alt+Space");

  assert.deepEqual(toggles, ["toggle"]);
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

test("register clears paused state when unpaused registration fails", () => {
  const globalShortcut = createFakeGlobalShortcut({ registerResult: false });
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => {}
  });

  manager.register({
    hotkey: "CommandOrControl+Alt+Space",
    globalShortcutPaused: true
  });
  const status = manager.register({
    hotkey: "CommandOrControl+Alt+Space",
    globalShortcutPaused: false
  });

  assert.equal(status.ok, false);
  assert.equal(status.reason, "registration_failed");
  assert.equal(manager.isPaused(), false);
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

test("registering a new hotkey unregisters only the previous hotkey", () => {
  const globalShortcut = createFakeGlobalShortcut();
  const toggles = [];
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => toggles.push("toggle")
  });

  manager.register({ hotkey: "Ctrl+Alt+Space" });
  manager.register({ hotkey: "CommandOrControl+Alt+Space" });

  assert.deepEqual(globalShortcut.calls, [
    { type: "register", hotkey: "Ctrl+Alt+Space" },
    { type: "unregister", hotkey: "Ctrl+Alt+Space" },
    { type: "register", hotkey: "CommandOrControl+Alt+Space" }
  ]);

  globalShortcut.trigger("Ctrl+Alt+Space");
  globalShortcut.trigger("CommandOrControl+Alt+Space");

  assert.deepEqual(toggles, ["toggle"]);
  assert.equal(manager.getRegisteredHotkey(), "CommandOrControl+Alt+Space");
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

test("missing hotkey reports an error and clears any previous registration", () => {
  const globalShortcut = createFakeGlobalShortcut();
  const toggles = [];
  const manager = createHotkeyManager({
    globalShortcut,
    onToggle: () => toggles.push("toggle")
  });

  manager.register({ hotkey: "Ctrl+Alt+Space" });
  const status = manager.register({
    hotkey: "   ",
    globalShortcutPaused: false
  });

  assert.equal(status.ok, false);
  assert.equal(status.reason, "missing_hotkey");
  assert.equal(status.phase, "error");
  assert.equal(status.message, "Set a global shortcut before recording.");
  assert.equal(manager.getRegisteredHotkey(), "");
  assert.equal(manager.isPaused(), false);
  assert.deepEqual(globalShortcut.calls, [
    { type: "register", hotkey: "Ctrl+Alt+Space" },
    { type: "unregister", hotkey: "Ctrl+Alt+Space" }
  ]);

  globalShortcut.trigger("Ctrl+Alt+Space");

  assert.deepEqual(toggles, []);
});

function createFakeGlobalShortcut({ registerResult = true, pressAndRelease = false } = {}) {
  const callbacks = new Map();
  const pressCallbacks = new Map();
  const releaseCallbacks = new Map();
  const calls = [];

  const fake = {
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
    },
    press(hotkey) {
      pressCallbacks.get(hotkey)?.();
    },
    release(hotkey) {
      releaseCallbacks.get(hotkey)?.();
    }
  };

  if (pressAndRelease) {
    fake.registerPressAndRelease = (hotkey, handlers) => {
      calls.push({ type: "registerPressAndRelease", hotkey });
      if (!registerResult) {
        return false;
      }
      pressCallbacks.set(hotkey, handlers.onPress);
      releaseCallbacks.set(hotkey, handlers.onRelease);
      return true;
    };
    const originalUnregister = fake.unregister;
    fake.unregister = (hotkey) => {
      originalUnregister(hotkey);
      pressCallbacks.delete(hotkey);
      releaseCallbacks.delete(hotkey);
    };
  }

  return fake;
}
