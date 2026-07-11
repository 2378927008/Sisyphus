import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsEffectsTransaction } from "../src/main/settings-effects-transaction.js";

test("settings effects transaction factory is available", () => {
  assert.equal(typeof createSettingsEffectsTransaction, "function");
});

test("settings effects transaction serializes rollback before the next save", async () => {
  const startupEntered = createDeferred();
  const releaseStartup = createDeferred();
  const startupError = new Error("injected startup failure");
  const events = [];
  const writes = [];
  let persisted = {
    launchAtLogin: false,
    startMinimizedToTray: false,
    hotkey: "initial",
    outputLanguage: "auto"
  };
  let currentSettings = { ...persisted };
  const saveSettingsWithSystemEffects = createSettingsEffectsTransaction({
    settingsStore: {
      async getSettings() {
        events.push("get");
        return { ...persisted };
      },
      async saveSettings(patch) {
        const label = patch.hotkey || "rollback";
        events.push(`save:${label}`);
        writes.push({ ...patch });
        persisted = { ...persisted, ...patch };
        return { ...persisted };
      }
    },
    getCurrentSettings: () => currentSettings,
    setCurrentSettings: (settings) => {
      currentSettings = settings;
    },
    async applyStartupSettings(settings) {
      events.push(`startup:${settings.hotkey}`);
      if (settings.hotkey === "A") {
        startupEntered.resolve();
        await releaseStartup.promise;
        throw startupError;
      }
    },
    async registerHotkey(settings) {
      events.push(`hotkey:${settings.hotkey}`);
    },
    refreshTrayMenu() {
      events.push(`tray:${currentSettings.hotkey}`);
    },
    reportSystemError(_error, reason) {
      events.push(`report:${reason}`);
    }
  });

  const first = observePromise(saveSettingsWithSystemEffects({
    hotkey: "A",
    launchAtLogin: true
  }));
  const firstMilestone = await Promise.race([
    startupEntered.promise.then(() => "startup"),
    first.completion.then(() => "settled")
  ]);
  assert.equal(firstMilestone, "startup");
  const second = observePromise(saveSettingsWithSystemEffects({
    hotkey: "B",
    outputLanguage: "fr"
  }));
  await flushMicrotasks();

  assert.equal(first.state, "pending");
  assert.equal(second.state, "pending");
  assert.equal(writes.length, 1);
  assert.equal(persisted.hotkey, "A");

  releaseStartup.resolve();
  await Promise.all([first.completion, second.completion]);

  assert.equal(first.state, "rejected");
  assert.equal(first.value, startupError);
  assert.equal(startupError.localFlowStatusReported, true);
  assert.equal(second.state, "fulfilled");
  assert.equal(second.value.hotkey, "B");
  assert.equal(second.value.outputLanguage, "fr");
  assert.deepEqual(writes, [
    { hotkey: "A", launchAtLogin: true },
    { launchAtLogin: false, startMinimizedToTray: false },
    { hotkey: "B", outputLanguage: "fr" }
  ]);
  assert.equal(persisted.hotkey, "B");
  assert.equal(persisted.outputLanguage, "fr");
  assert.equal(persisted.launchAtLogin, false);
  assert.deepEqual(events, [
    "save:A",
    "startup:A",
    "save:rollback",
    "tray:A",
    "hotkey:A",
    "report:startup_settings_failed",
    "save:B",
    "startup:B",
    "hotkey:B",
    "tray:B"
  ]);
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function observePromise(promise) {
  const observed = {
    state: "pending",
    value: undefined,
    completion: null
  };
  observed.completion = Promise.resolve(promise).then(
    (value) => {
      observed.state = "fulfilled";
      observed.value = value;
    },
    (error) => {
      observed.state = "rejected";
      observed.value = error;
    }
  );
  return observed;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
