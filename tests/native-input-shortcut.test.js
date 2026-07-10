import test from "node:test";
import assert from "node:assert/strict";
import {
  createNativeInputShortcut,
  parseNativeShortcut,
  createNativeInputShortcutFromPackage
} from "../src/main/native-input-shortcut.js";

const keyCodes = {
  Space: 57,
  V: 47
};

test("parseNativeShortcut parses keyboard modifiers and keycodes", () => {
  assert.deepEqual(parseNativeShortcut(" CommandOrControl+Alt+Space ", { keyCodes }), {
    raw: "CommandOrControl+Alt+Space",
    kind: "keyboard",
    keyName: "Space",
    keycode: 57,
    mouseButton: "",
    modifiers: {
      alt: true,
      commandOrControl: true,
      control: false,
      meta: false,
      shift: false
    }
  });
});

test("parseNativeShortcut parses mouse side buttons", () => {
  assert.deepEqual(parseNativeShortcut("Mouse4", { keyCodes }), {
    raw: "Mouse4",
    kind: "mouse",
    keyName: "",
    keycode: null,
    mouseButton: "Mouse4",
    modifiers: {
      alt: false,
      commandOrControl: false,
      control: false,
      meta: false,
      shift: false
    }
  });
});

test("native shortcut adapter emits keyboard press and release once per hold", () => {
  const uIOhook = createFakeUiohook();
  const shortcut = createNativeInputShortcut({ uIOhook, keyCodes });
  const calls = [];

  assert.equal(shortcut.registerPressAndRelease("CommandOrControl+Alt+Space", {
    onPress: () => calls.push("press"),
    onRelease: () => calls.push("release")
  }), true);

  uIOhook.emit("keydown", { keycode: 57, ctrlKey: true, altKey: true });
  uIOhook.emit("keydown", { keycode: 57, ctrlKey: true, altKey: true });
  uIOhook.emit("keyup", { keycode: 57, ctrlKey: true, altKey: true });

  assert.deepEqual(calls, ["press", "release"]);
  assert.deepEqual(uIOhook.calls, ["on:keydown", "on:keyup", "on:mousedown", "on:mouseup", "start"]);
});

test("native shortcut adapter emits mouse side button press and release", () => {
  const uIOhook = createFakeUiohook();
  const shortcut = createNativeInputShortcut({ uIOhook, keyCodes });
  const calls = [];

  assert.equal(shortcut.registerPressAndRelease("Mouse5", {
    onPress: () => calls.push("press"),
    onRelease: () => calls.push("release")
  }), true);

  uIOhook.emit("mousedown", { button: 5 });
  uIOhook.emit("mouseup", { button: 5 });

  assert.deepEqual(calls, ["press", "release"]);
});

test("native shortcut adapter registers mouse side buttons as press-only shortcuts", () => {
  const uIOhook = createFakeUiohook();
  const shortcut = createNativeInputShortcut({ uIOhook, keyCodes });
  const calls = [];

  assert.equal(shortcut.register("Mouse4", () => calls.push("toggle")), true);

  uIOhook.emit("mousedown", { button: 4 });
  uIOhook.emit("mousedown", { button: 4 });
  uIOhook.emit("mouseup", { button: 4 });
  uIOhook.emit("mousedown", { button: 4 });

  assert.deepEqual(calls, ["toggle", "toggle"]);
});

test("native press-only registration rejects keyboard and primary mouse accelerators", () => {
  const shortcut = createNativeInputShortcut({
    uIOhook: createFakeUiohook(),
    keyCodes
  });

  assert.equal(shortcut.register("CommandOrControl+Alt+Space", () => {}), false);
  assert.equal(shortcut.register("Mouse1", () => {}), false);
  assert.equal(shortcut.register("Mouse2", () => {}), false);
  assert.equal(shortcut.register("Mouse3", () => {}), false);
});

test("native shortcut adapter unregisters and stops when idle", () => {
  const uIOhook = createFakeUiohook();
  const shortcut = createNativeInputShortcut({ uIOhook, keyCodes });
  const calls = [];

  shortcut.registerPressAndRelease("Mouse4", {
    onPress: () => calls.push("press"),
    onRelease: () => calls.push("release")
  });
  shortcut.unregister("Mouse4");
  uIOhook.emit("mousedown", { button: 4 });
  uIOhook.emit("mouseup", { button: 4 });

  assert.deepEqual(calls, []);
  assert.equal(uIOhook.calls.at(-1), "stop");
});

test("native shortcut package loader returns null on unsupported platforms", async () => {
  const shortcut = await createNativeInputShortcutFromPackage({ platform: "linux" });

  assert.equal(shortcut, null);
});

function createFakeUiohook() {
  const listeners = new Map();
  const calls = [];

  return {
    calls,
    on(event, listener) {
      calls.push(`on:${event}`);
      listeners.set(event, listener);
    },
    off(event) {
      calls.push(`off:${event}`);
      listeners.delete(event);
    },
    start() {
      calls.push("start");
    },
    stop() {
      calls.push("stop");
    },
    emit(event, payload) {
      listeners.get(event)?.({
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        ...payload
      });
    }
  };
}
