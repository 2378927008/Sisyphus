import test from "node:test";
import assert from "node:assert/strict";
import { createShortcutBackend } from "../src/main/shortcut-backend.js";

test("shortcut backend delegates toggle shortcuts to Electron globalShortcut", () => {
  const calls = [];
  const backend = createShortcutBackend({
    globalShortcut: {
      register: (hotkey, callback) => {
        calls.push(["register", hotkey, callback]);
        return true;
      },
      unregister: (hotkey) => calls.push(["unregister", hotkey])
    }
  });

  const callback = () => {};

  assert.equal(backend.register("Ctrl+Alt+Space", callback), true);
  backend.unregister("Ctrl+Alt+Space");

  assert.deepEqual(calls, [
    ["register", "Ctrl+Alt+Space", callback],
    ["unregister", "Ctrl+Alt+Space"]
  ]);
});

test("shortcut backend delegates press and release shortcuts to native backend", () => {
  const calls = [];
  const backend = createShortcutBackend({
    globalShortcut: {
      register: () => false,
      unregister: (hotkey) => calls.push(["electron-unregister", hotkey])
    },
    nativeShortcut: {
      registerPressAndRelease: (hotkey, handlers) => {
        calls.push(["native-register", hotkey, handlers]);
        return true;
      },
      unregister: (hotkey) => calls.push(["native-unregister", hotkey])
    }
  });

  const handlers = {
    onPress: () => {},
    onRelease: () => {}
  };

  assert.equal(backend.registerPressAndRelease("Mouse4", handlers), true);
  backend.unregister("Mouse4");

  assert.deepEqual(calls, [
    ["native-register", "Mouse4", handlers],
    ["electron-unregister", "Mouse4"],
    ["native-unregister", "Mouse4"]
  ]);
});

test("shortcut backend reports unavailable native press and release backend", () => {
  const backend = createShortcutBackend({
    globalShortcut: {
      register: () => true,
      unregister: () => {}
    }
  });

  assert.equal(backend.registerPressAndRelease("Mouse4", {
    onPress: () => {},
    onRelease: () => {}
  }), false);
});

test("shortcut backend keeps native cleanup when Electron rejects a native-only accelerator", () => {
  const calls = [];
  const backend = createShortcutBackend({
    globalShortcut: {
      register: () => true,
      unregister: (hotkey) => {
        calls.push(["electron-unregister", hotkey]);
        throw new TypeError("Invalid accelerator");
      }
    },
    nativeShortcut: {
      unregister: (hotkey) => calls.push(["native-unregister", hotkey])
    }
  });

  assert.doesNotThrow(() => backend.unregister("Mouse4"));
  assert.deepEqual(calls, [
    ["electron-unregister", "Mouse4"],
    ["native-unregister", "Mouse4"]
  ]);
});
