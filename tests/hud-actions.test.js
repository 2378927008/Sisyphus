import test from "node:test";
import assert from "node:assert/strict";
import { createHudActions, wireHudIpc } from "../src/main/hud-actions.js";

test("HUD actions delegate stop, cancel, and main-window reveal", async () => {
  const calls = [];
  const actions = createHudActions({
    globalShortcut: createGlobalShortcutHarness().globalShortcut,
    systemInputController: {
      stop: async () => calls.push("stop"),
      cancel: async () => calls.push("cancel")
    },
    revealMainWindow: () => calls.push("open")
  });

  await actions.stop();
  await actions.cancel();
  actions.openMainWindow();

  assert.deepEqual(calls, ["stop", "cancel", "open"]);
});

test("Escape is registered only during cancellable recording phases", () => {
  const harness = createGlobalShortcutHarness();
  const cancels = [];
  const actions = createHudActions({
    globalShortcut: harness.globalShortcut,
    systemInputController: {
      cancel: () => cancels.push("cancel")
    }
  });

  actions.syncPhase("starting");
  actions.syncPhase("starting");
  assert.deepEqual(harness.registered, ["Escape"]);

  harness.callbacks.get("Escape")();
  assert.deepEqual(cancels, ["cancel"]);

  actions.syncPhase("recording");
  assert.deepEqual(harness.registered, ["Escape"]);

  actions.syncPhase("polishing");
  assert.deepEqual(harness.unregistered, ["Escape"]);
});

test("Escape registration failure can retry without claiming ownership", () => {
  const harness = createGlobalShortcutHarness({
    registrationResults: [false, true]
  });
  const actions = createHudActions({
    globalShortcut: harness.globalShortcut,
    systemInputController: { cancel: () => {} }
  });

  actions.syncPhase("recording");
  actions.syncPhase("recording");
  actions.syncPhase("transcribing");

  assert.deepEqual(harness.registered, ["Escape", "Escape"]);
  assert.deepEqual(harness.unregistered, ["Escape"]);
});

test("rapid phase changes and dispose release only the owned Escape binding", () => {
  const harness = createGlobalShortcutHarness();
  const actions = createHudActions({
    globalShortcut: harness.globalShortcut,
    systemInputController: { cancel: () => {} }
  });

  actions.syncPhase("recording");
  actions.syncPhase("transcribing");
  actions.syncPhase("starting");
  actions.dispose();
  actions.dispose();
  actions.syncPhase("recording");

  assert.deepEqual(harness.registered, ["Escape", "Escape"]);
  assert.deepEqual(harness.unregistered, ["Escape", "Escape"]);
  assert.equal(harness.unregisterAllCalls, 0);
});

test("HUD IPC accepts only the active HUD webContents sender", async () => {
  const handlers = new Map();
  const calls = [];
  const hudContents = { isDestroyed: () => false };
  const mainContents = { isDestroyed: () => false };
  let hudWindow = createWindow(hudContents);

  wireHudIpc({
    ipcMain: {
      on: (channel, handler) => handlers.set(channel, handler)
    },
    getHudWindow: () => hudWindow,
    hudActions: {
      stop: async () => calls.push("stop"),
      cancel: async () => calls.push("cancel"),
      openMainWindow: () => calls.push("open")
    }
  });

  for (const [channel, expected] of [
    ["hud:stop", "stop"],
    ["hud:cancel", "cancel"],
    ["hud:open-main-window", "open"]
  ]) {
    handlers.get(channel)({ sender: mainContents });
    handlers.get(channel)({ sender: hudContents });
    assert.equal(calls.at(-1), expected, channel);
  }

  assert.deepEqual(calls, ["stop", "cancel", "open"]);

  hudWindow = createWindow(hudContents, { destroyed: true });
  handlers.get("hud:stop")({ sender: hudContents });
  hudWindow = null;
  handlers.get("hud:cancel")({ sender: hudContents });

  assert.deepEqual(calls, ["stop", "cancel", "open"]);
});

function createGlobalShortcutHarness({ registrationResults = [] } = {}) {
  const callbacks = new Map();
  const registered = [];
  const unregistered = [];
  let unregisterAllCalls = 0;

  return {
    callbacks,
    registered,
    unregistered,
    get unregisterAllCalls() {
      return unregisterAllCalls;
    },
    globalShortcut: {
      register: (accelerator, callback) => {
        registered.push(accelerator);
        const result = registrationResults.length ? registrationResults.shift() : true;
        if (result) {
          callbacks.set(accelerator, callback);
        }
        return result;
      },
      unregister: (accelerator) => {
        unregistered.push(accelerator);
        callbacks.delete(accelerator);
      },
      unregisterAll: () => {
        unregisterAllCalls += 1;
      }
    }
  };
}

function createWindow(webContents, { destroyed = false } = {}) {
  return {
    isDestroyed: () => destroyed,
    webContents
  };
}
