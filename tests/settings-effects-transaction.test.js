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
      assertPublicSettings(harness.visibleSettings);
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
    rollbackFailures: new Set(["apply", "hotkey", "tray"])
  });

  const error = await getRejection(harness.save({ hotkey: "A" }));

  assert.equal(error, primaryError);
  assert.deepEqual(
    harness.reports[0].rollbackErrors.map((rollbackError) => rollbackError.message),
    [
      "rollback apply failed",
      "rollback hotkey failed",
      "rollback tray failed"
    ]
  );
  assert.equal(Object.hasOwn(primaryError, "rollbackErrors"), false);
  assert.equal(harness.reports[0].error, primaryError);
  assert.equal(harness.reports[0].reason, "settings_update_failed");
  assert.equal(harness.events.at(-1), "tray:initial");
  assertPublicSettings(harness.visibleSettings);
});

test("rollback save failure synchronizes from the actual public disk state", async () => {
  const primaryError = new Error("apply failed");
  const harness = createTransactionHarness({
    failedPhase: "apply",
    primaryError,
    rollbackFailures: new Set(["save"])
  });

  const error = await getRejection(harness.save({
    hotkey: "A",
    launchAtLogin: true,
    cloudApiKey: "new-secret"
  }));

  assert.equal(error, primaryError);
  assert.deepEqual(harness.getOptions, [
    { includeSecrets: true },
    {}
  ]);
  assert.equal(harness.currentSettings.hotkey, "A");
  assert.equal(harness.currentSettings.launchAtLogin, true);
  assert.deepEqual(
    harness.reports[0].rollbackErrors.map((rollbackError) => rollbackError.message),
    ["rollback save failed"]
  );
  assert.deepEqual(harness.events, [
    "set:A",
    "apply:A",
    "set:A",
    "apply:A",
    "hotkey:A",
    "tray:A"
  ]);
  assertPublicSettings(harness.visibleSettings);
});

test("rollback save and read failures preserve the current public state", async () => {
  const primaryError = new Error("apply failed");
  const harness = createTransactionHarness({
    failedPhase: "apply",
    primaryError,
    rollbackFailures: new Set(["save", "read"])
  });

  const error = await getRejection(harness.save({
    hotkey: "A",
    launchAtLogin: true,
    cloudApiKey: "new-secret"
  }));

  assert.equal(error, primaryError);
  assert.deepEqual(harness.getOptions, [
    { includeSecrets: true },
    {}
  ]);
  assert.equal(harness.currentSettings.hotkey, "A");
  assert.equal(harness.currentSettings.launchAtLogin, true);
  assert.deepEqual(harness.events, ["set:A", "apply:A"]);
  assert.deepEqual(
    harness.reports[0].rollbackErrors.map((rollbackError) => rollbackError.message),
    ["rollback save failed", "rollback read failed"]
  );
  assertPublicSettings(harness.visibleSettings);
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
  const visibleSettings = [];
  let persisted = { ...initialSettings };
  let currentSettings = { ...initialSettings, cloudApiKey: "" };

  const saveSettingsWithSystemEffects = createSettingsEffectsTransaction({
    settingsStore: {
      async getSettings(options = {}) {
        getOptions.push({ ...options });
        events.push(`get:${persisted.hotkey}`);
        return options.includeSecrets ? { ...persisted } : redactResult(persisted);
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
      visibleSettings.push({ phase: "set", settings: { ...settings } });
    },
    async applyStartupSettings(settings) {
      events.push(`apply:${settings.hotkey}`);
      visibleSettings.push({ phase: "apply", settings: { ...settings } });
      if (settings.hotkey === "A") {
        startupEntered.resolve();
        await releaseStartup.promise;
        throw primaryError;
      }
    },
    async registerHotkey(settings) {
      events.push(`hotkey:${settings.hotkey}`);
      visibleSettings.push({ phase: "hotkey", settings: { ...settings } });
      if (settings.hotkey === "initial" && writes.length === 2) {
        throw rollbackHotkeyError;
      }
    },
    async refreshTrayMenu() {
      events.push(`tray:${currentSettings.hotkey}`);
      visibleSettings.push({ phase: "tray", settings: { ...currentSettings } });
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
  assertPublicSettings(visibleSettings);
});

function createTransactionHarness({ failedPhase, primaryError, rollbackFailures = new Set() }) {
  const events = [];
  const writes = [];
  const getOptions = [];
  const reports = [];
  const visibleSettings = [];
  let persisted = { ...initialSettings };
  let currentSettings = { ...initialSettings, cloudApiKey: "" };
  let primaryFailureThrown = false;

  const save = createSettingsEffectsTransaction({
    settingsStore: {
      async getSettings(options = {}) {
        getOptions.push({ ...options });
        if (!options.includeSecrets && rollbackFailures.has("read")) {
          throw new Error("rollback read failed");
        }
        return options.includeSecrets ? { ...persisted } : redactResult(persisted);
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
      events.push(`set:${settings.hotkey}`);
      visibleSettings.push({ phase: "set", settings: { ...settings } });
    },
    async applyStartupSettings(settings) {
      events.push(`apply:${settings.hotkey}`);
      visibleSettings.push({ phase: "apply", settings: { ...settings } });
      if (settings.hotkey === "A" && failedPhase === "apply" && !primaryFailureThrown) {
        primaryFailureThrown = true;
        throw primaryError;
      }
      if (settings.hotkey === "initial" && rollbackFailures.has("apply")) {
        throw new Error("rollback apply failed");
      }
    },
    async registerHotkey(settings) {
      events.push(`hotkey:${settings.hotkey}`);
      visibleSettings.push({ phase: "hotkey", settings: { ...settings } });
      if (settings.hotkey === "A" && failedPhase === "hotkey" && !primaryFailureThrown) {
        primaryFailureThrown = true;
        throw primaryError;
      }
      if (settings.hotkey === "initial" && rollbackFailures.has("hotkey")) {
        throw new Error("rollback hotkey failed");
      }
    },
    async refreshTrayMenu() {
      events.push(`tray:${currentSettings.hotkey}`);
      visibleSettings.push({ phase: "tray", settings: { ...currentSettings } });
      if (currentSettings.hotkey === "A" && failedPhase === "tray" && !primaryFailureThrown) {
        primaryFailureThrown = true;
        throw primaryError;
      }
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
    visibleSettings,
    get currentSettings() {
      return currentSettings;
    },
    get persisted() {
      return persisted;
    }
  };
}

function assertPublicSettings(visibleSettings) {
  assert.ok(visibleSettings.length > 0);
  for (const { phase, settings } of visibleSettings) {
    assert.equal(settings.cloudApiKey, "", `${phase} must receive redacted settings`);
  }
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
