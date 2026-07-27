import test from "node:test";
import assert from "node:assert/strict";

import { createVersionedAutosave } from "../src/renderer/versioned-autosave.js";

function createAutosaveHarness({ save } = {}) {
  const timers = [];
  const saved = [];
  const states = [];
  let activeSaves = 0;
  let maxConcurrentSaves = 0;

  const autosave = createVersionedAutosave({
    delayMs: 450,
    setTimeout(callback) {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
    async save(payload) {
      activeSaves += 1;
      maxConcurrentSaves = Math.max(maxConcurrentSaves, activeSaves);
      try {
        if (save) return await save(payload);
        saved.push(payload);
      } finally {
        activeSaves -= 1;
      }
    },
    onState(state) {
      states.push(state);
    }
  });

  return {
    autosave,
    saved,
    states,
    get maxConcurrentSaves() {
      return maxConcurrentSaves;
    },
    flushTimer() {
      const timer = timers.shift();
      assert.ok(timer, "expected a scheduled timer");
      if (!timer.cleared) timer.callback();
    },
    get activeTimers() {
      return timers.filter((timer) => !timer.cleared);
    }
  };
}

test("serializes saves and reports saved only for the latest version", async () => {
  const gates = [];
  const harness = createAutosaveHarness({
    save: (payload) => new Promise((resolve) => gates.push(() => resolve(payload)))
  });

  harness.autosave.schedule({ id: "h1", text: "first" });
  harness.flushTimer();
  await Promise.resolve();
  harness.autosave.schedule({ id: "h1", text: "second" });
  harness.flushTimer();
  assert.equal(harness.maxConcurrentSaves, 1);

  gates.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gates.length, 1);
  gates.shift()();
  await harness.autosave.flush();

  assert.equal(harness.maxConcurrentSaves, 1);
  assert.equal(harness.states.at(-1).phase, "saved");
  assert.equal(harness.states.at(-1).text, "second");
});

test("flush waits for a pending timer and the entire save chain", async () => {
  const harness = createAutosaveHarness();
  harness.autosave.schedule({ id: "h1", text: "draft" });

  await harness.autosave.flush();

  assert.deepEqual(harness.saved.map((entry) => entry.text), ["draft"]);
  assert.equal(harness.states.at(-1).phase, "saved");
});

test("cancel clears pending work without reporting a false saved state", async () => {
  const harness = createAutosaveHarness();
  harness.autosave.schedule({ id: "h1", text: "draft" });

  harness.autosave.cancel();
  await harness.autosave.flush();

  assert.equal(harness.activeTimers.length, 0);
  assert.deepEqual(harness.saved, []);
  assert.notEqual(harness.states.at(-1)?.phase, "saved");
});

test("continues saving after a rejected save", async () => {
  let attempts = 0;
  const harness = createAutosaveHarness({
    save: async (payload) => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      harness.saved.push(payload);
    }
  });

  harness.autosave.schedule({ id: "h1", text: "first" });
  harness.flushTimer();
  await harness.autosave.flush();
  harness.autosave.schedule({ id: "h1", text: "second" });
  harness.flushTimer();
  await harness.autosave.flush();

  assert.equal(harness.states.some((state) => state.phase === "error"), true);
  assert.deepEqual(harness.saved.map((entry) => entry.text), ["second"]);
  assert.equal(harness.states.at(-1).phase, "saved");
});

test("treats a resolved business failure as an error and recovers", async () => {
  const calls = [];
  const responses = [
    { ok: false, reason: "history_changed" },
    { ok: true }
  ];
  const harness = createAutosaveHarness({
    save: async (payload) => {
      calls.push(payload);
      return responses.shift();
    }
  });

  harness.autosave.schedule({ id: "h1", text: "first" });
  harness.flushTimer();
  await harness.autosave.flush();

  const firstState = harness.states.at(-1);
  assert.equal(firstState.phase, "error");
  assert.equal(firstState.version, 1);
  assert.equal(firstState.error.code, "history_save_failed");
  assert.equal(firstState.error.reason, "history_changed");
  assert.equal(harness.states.some((state) => state.phase === "saved" && state.version === 1), false);

  harness.autosave.schedule({ id: "h1", text: "second" });
  harness.flushTimer();
  await harness.autosave.flush();

  assert.deepEqual(calls.map((call) => call.text), ["first", "second"]);
  assert.equal(harness.states.at(-1).phase, "saved");
  assert.equal(harness.states.at(-1).version, 2);
});

test("does not let an older resolved business failure replace the latest pending state", async () => {
  let resolveFirst;
  const harness = createAutosaveHarness({
    save: ({ version }) => version === 1
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : Promise.resolve({ ok: true })
  });

  harness.autosave.schedule({ id: "h1", text: "first" });
  harness.flushTimer();
  await Promise.resolve();
  harness.autosave.schedule({ id: "h1", text: "second" });
  resolveFirst({ ok: false, reason: "history_changed" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.states.at(-1).phase, "pending");
  assert.equal(harness.states.at(-1).version, 2);
  assert.equal(harness.states.some((state) => state.phase === "error" && state.version === 1), false);

  await harness.autosave.flush();
  assert.equal(harness.states.at(-1).phase, "saved");
  assert.equal(harness.states.at(-1).version, 2);
});

test("replaces diagnostic business reasons with a safe fallback", async () => {
  const harness = createAutosaveHarness({
    save: async () => ({ ok: false, reason: "C:\\private\\history.json failed" })
  });

  harness.autosave.schedule({ id: "h1", text: "draft" });
  harness.flushTimer();
  await harness.autosave.flush();

  assert.equal(harness.states.at(-1).phase, "error");
  assert.equal(harness.states.at(-1).error.code, "history_save_failed");
  assert.equal(harness.states.at(-1).error.reason, "save_failed");
  assert.doesNotMatch(harness.states.at(-1).error.message, /private|history\.json/i);
});
