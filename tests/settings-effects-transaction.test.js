import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsEffectsTransaction } from "../src/main/settings-effects-transaction.js";

const initialSettings = Object.freeze({
  launchAtLogin: false,
  startMinimizedToTray: false,
  hotkey: "initial",
  outputLanguage: "auto",
  cloudApiKey: "old-secret"
});

test("settings effects transaction factory is available", () => {
  assert.equal(typeof createSettingsEffectsTransaction, "function");
});

test("settings effects transaction compensates save, apply, hotkey, and tray failures", async (t) => {
  for (const failedPhase of ["save", "apply", "hotkey", "tray"]) {
    await t.test(failedPhase, async () => {
      const primaryError = new Error(`${failedPhase} failed`);
      const harness = createTransactionHarness({ failedPhase, primaryError });

      const error = await getRejection(harness.save({
        hotkey: "A",
        launchAtLogin: true,
        cloudApiKey: "new-secret"
      }));

      assert.equal(error, primaryError);
      assert.deepEqual(harness.getOptions, [{ includeSecrets: true }]);
      assert.deepEqual(harness.persisted, initialSettings);
      assert.deepEqual(harness.writes, [
        { hotkey: "A", launchAtLogin: true, cloudApiKey: "new-secret" },
        { ...initialSettings }
      ]);
      assert.ok(harness.events.includes("apply:initial"));
      assert.ok(harness.events.includes("hotkey:initial"));
      assert.ok(harness.events.includes("tray:initial"));
      assert.equal(harness.reports.length, 1);
      assert.equal(harness.reports[0].error, primaryError);
      assert.equal(harness.reports[0].reason, "settings_update_failed");
      assert.deepEqual(harness.reports[0].rollbackErrors, []);
    });
  }
});

test("rollback errors do not replace or mutate a frozen primary error", async () => {
  const primaryError = Object.freeze(new Error("frozen apply failure"));
  const harness = createTransactionHarness({
    failedPhase: "apply",
    primaryError,
    rollbackFailures: new Set(["save", "apply", "hotkey", "tray"])
  });

  const error = await getRejection(harness.save({ hotkey: "A" }));

  assert.equal(error, primaryError);
  assert.deepEqual(
    harness.reports[0].rollbackErrors.map((rollbackError) => rollbackError.message),
    [
      "rollback save failed",
      "rollback apply failed",
      "rollback hotkey failed",
      "rollback tray failed"
    ]
  );
  assert.equal(Object.hasOwn(primaryError, "rollbackErrors"), false);
  assert.equal(harness.reports[0].error, primaryError);
  assert.equal(harness.reports[0].reason, "settings_update_failed");
  assert.equal(harness.events.at(-1), "tray:initial");
});

test("settings effects FIFO waits for every compensation before the next transaction", async () => {
  const startupEntered = createDeferred();
  const releaseStartup = createDeferred();
  const rollbackTrayEntered = createDeferred();
  const releaseRollbackTray = createDeferred();
  const primaryError = new Error("A startup failure");
  const rollbackHotkeyError = new Error("rollback hotkey failure");
  const rollbackTrayError = new Error("rollback tray failure");
  const events = [];
  const writes = [];
  const getOptions = [];
  const reports = [];
  let persisted = { ...initialSettings };
  let currentSettings = { ...initialSettings, cloudApiKey: "" };

  const saveSettingsWithSystemEffects = createSettingsEffectsTransaction({
    settingsStore: {
      async getSettings(options = {}) {
        getOptions.push({ ...options });
        events.push(`get:${persisted.hotkey}`);
        return { ...persisted };
      },
      async saveSettings(patch, options = {}) {
        events.push(`save:${patch.hotkey}`);
        writes.push({ ...patch });
        persisted = { ...persisted, ...patch };
        return redactResult(persisted, options);
      }
    },
    getCurrentSettings: () => currentSettings,
    setCurrentSettings(settings) {
      currentSettings = { ...settings };
    },
    async applyStartupSettings(settings) {
      events.push(`apply:${settings.hotkey}`);
      if (settings.hotkey === "A") {
        startupEntered.resolve();
        await releaseStartup.promise;
        throw primaryError;
      }
    },
    async registerHotkey(settings) {
      events.push(`hotkey:${settings.hotkey}`);
      if (settings.hotkey === "initial" && writes.length === 2) {
        throw rollbackHotkeyError;
      }
    },
    async refreshTrayMenu() {
      events.push(`tray:${currentSettings.hotkey}`);
      if (currentSettings.hotkey === "initial" && writes.length === 2) {
        rollbackTrayEntered.resolve();
        await releaseRollbackTray.promise;
        throw rollbackTrayError;
      }
    },
    reportSystemError(error, reason, rollbackErrors) {
      events.push(`report:${reason}`);
      reports.push({ error, reason, rollbackErrors: [...rollbackErrors] });
    }
  });

  const first = observePromise(saveSettingsWithSystemEffects({
    hotkey: "A",
    launchAtLogin: true,
    cloudApiKey: "new-secret"
  }));
  assert.equal(await Promise.race([
    startupEntered.promise.then(() => "startup"),
    first.completion.then(() => "settled")
  ]), "startup");

  const second = observePromise(saveSettingsWithSystemEffects({
    hotkey: "B",
    outputLanguage: "fr"
  }));
  await flushMicrotasks();

  assert.equal(first.state, "pending");
  assert.equal(second.state, "pending");
  assert.equal(writes.length, 1);
  assert.deepEqual(getOptions, [{ includeSecrets: true }]);

  releaseStartup.resolve();
  assert.equal(await Promise.race([
    rollbackTrayEntered.promise.then(() => "rollback-tray"),
    first.completion.then(() => "settled")
  ]), "rollback-tray");

  assert.equal(first.state, "pending");
  assert.equal(second.state, "pending");
  assert.equal(writes.length, 2);
  assert.equal(writes[1].cloudApiKey, "old-secret");
  assert.deepEqual(getOptions, [{ includeSecrets: true }]);

  releaseRollbackTray.resolve();
  await Promise.all([first.completion, second.completion]);

  assert.equal(first.state, "rejected");
  assert.equal(first.value, primaryError);
  assert.deepEqual(
    reports[0].rollbackErrors.map((error) => error.message),
    [rollbackHotkeyError.message, rollbackTrayError.message]
  );
  assert.equal(second.state, "fulfilled");
  assert.equal(second.value.hotkey, "B");
  assert.equal(second.value.outputLanguage, "fr");
  assert.deepEqual(getOptions, [
    { includeSecrets: true },
    { includeSecrets: true }
  ]);
  assert.equal(persisted.hotkey, "B");
  assert.equal(persisted.outputLanguage, "fr");
  assert.equal(persisted.launchAtLogin, false);
  assert.equal(persisted.cloudApiKey, "old-secret");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].error, primaryError);
  assert.ok(events.indexOf("report:settings_update_failed") < events.lastIndexOf("get:initial"));
  assert.ok(events.indexOf("tray:initial") < events.indexOf("save:B"));
});

function createTransactionHarness({ failedPhase, primaryError, rollbackFailures = new Set() }) {
  const events = [];
  const writes = [];
  const getOptions = [];
  const reports = [];
  let persisted = { ...initialSettings };
  let currentSettings = { ...initialSettings, cloudApiKey: "" };

  const save = createSettingsEffectsTransaction({
    settingsStore: {
      async getSettings(options = {}) {
        getOptions.push({ ...options });
        return { ...persisted };
      },
      async saveSettings(patch, options = {}) {
        writes.push({ ...patch });
        if (patch.hotkey === "A" && failedPhase === "save") throw primaryError;
        if (patch.hotkey === "initial" && rollbackFailures.has("save")) {
          throw new Error("rollback save failed");
        }
        persisted = { ...persisted, ...patch };
        return redactResult(persisted, options);
      }
    },
    getCurrentSettings: () => currentSettings,
    setCurrentSettings(settings) {
      currentSettings = { ...settings };
    },
    async applyStartupSettings(settings) {
      events.push(`apply:${settings.hotkey}`);
      if (settings.hotkey === "A" && failedPhase === "apply") throw primaryError;
      if (settings.hotkey === "initial" && rollbackFailures.has("apply")) {
        throw new Error("rollback apply failed");
      }
    },
    async registerHotkey(settings) {
      events.push(`hotkey:${settings.hotkey}`);
      if (settings.hotkey === "A" && failedPhase === "hotkey") throw primaryError;
      if (settings.hotkey === "initial" && rollbackFailures.has("hotkey")) {
        throw new Error("rollback hotkey failed");
      }
    },
    async refreshTrayMenu() {
      events.push(`tray:${currentSettings.hotkey}`);
      if (currentSettings.hotkey === "A" && failedPhase === "tray") throw primaryError;
      if (currentSettings.hotkey === "initial" && rollbackFailures.has("tray")) {
        throw new Error("rollback tray failed");
      }
    },
    reportSystemError(error, reason, rollbackErrors) {
      reports.push({ error, reason, rollbackErrors: [...rollbackErrors] });
    }
  });

  return {
    save,
    events,
    writes,
    getOptions,
    reports,
    get persisted() {
      return persisted;
    }
  };
}

function redactResult(settings, options = {}) {
  const result = { ...settings };
  if (!options.includeSecrets) result.cloudApiKey = "";
  return result;
}

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

async function getRejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected transaction to reject");
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
