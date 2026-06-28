import test from "node:test";
import assert from "node:assert/strict";
import { createSystemInputController } from "../src/main/system-input-controller.js";

test("system input controller starts idle and broadcasts state changes", () => {
  const states = [];
  const controller = createSystemInputController({
    sendToMain: (state) => states.push({ target: "main", state }),
    sendToHud: (state) => states.push({ target: "hud", state })
  });

  assert.equal(controller.getState().phase, "idle");

  controller.setPhase("recording", { message: "Recording" });

  assert.equal(controller.getState().phase, "recording");
  assert.deepEqual(states.map((item) => item.target), ["main", "hud"]);
  assert.equal(states[0].state.message, "Recording");
});

test("system input controller toggles recording through injected callbacks", async () => {
  const calls = [];
  const controller = createSystemInputController({
    startRecording: async () => calls.push("start"),
    stopRecording: async () => calls.push("stop")
  });

  await controller.toggle();
  controller.setPhase("recording");
  await controller.toggle();

  assert.deepEqual(calls, ["start", "stop"]);
});

test("system input controller exposes starting and stopping lifecycle phases", () => {
  const controller = createSystemInputController();

  controller.setPhase("starting", { message: "Starting" });
  assert.equal(controller.getState().phase, "starting");
  controller.handleRendererStatus({ phase: "stopping", message: "Stopping" });
  assert.equal(controller.getState().phase, "stopping");
});

test("system input controller ignores concurrent recording starts while pending", async () => {
  let resolveStart;
  const calls = [];
  const startPending = new Promise((resolve) => {
    resolveStart = resolve;
  });
  const controller = createSystemInputController({
    startRecording: async () => {
      calls.push("start");
      await startPending;
    }
  });

  const firstToggle = controller.toggle();
  const secondToggle = controller.toggle();

  assert.deepEqual(calls, ["start"]);
  resolveStart();
  await Promise.all([firstToggle, secondToggle]);
  assert.deepEqual(calls, ["start"]);
});

test("system input controller ignores toggles while renderer is processing audio", async () => {
  const calls = [];
  const controller = createSystemInputController({
    startRecording: async () => calls.push("start"),
    stopRecording: async () => calls.push("stop")
  });

  controller.setPhase("transcribing");
  await controller.toggle();
  controller.setPhase("pasting");
  await controller.toggle();

  assert.deepEqual(calls, []);
});

test("system input controller ignores toggles while start or stop command is pending", async () => {
  const calls = [];
  const controller = createSystemInputController({
    startRecording: async () => calls.push("start"),
    stopRecording: async () => calls.push("stop")
  });

  controller.setPhase("starting");
  await controller.toggle();
  controller.setPhase("stopping");
  await controller.toggle();

  assert.deepEqual(calls, []);
});

test("system input controller terminal phases allow a new start", async () => {
  const calls = [];
  const controller = createSystemInputController({
    startRecording: async () => calls.push("start")
  });

  controller.setPhase("done");
  await controller.toggle();
  controller.setPhase("warning");
  await controller.toggle();
  controller.setPhase("error");
  await controller.toggle();

  assert.deepEqual(calls, ["start", "start", "start"]);
});

test("system input controller does not start when setup is not ready", async () => {
  const controller = createSystemInputController({
    isReadyToRecord: () => false,
    startRecording: async () => {
      throw new Error("should not start");
    }
  });

  await controller.toggle();

  assert.equal(controller.getState().phase, "error");
  assert.equal(controller.getState().reason, "not_ready");
});

test("system input controller preserves warning renderer status", () => {
  const controller = createSystemInputController();

  controller.handleRendererStatus({ phase: "warning", message: "Raw transcript saved" });

  assert.equal(controller.getState().phase, "warning");
  assert.equal(controller.getState().message, "Raw transcript saved");
});

test("system input controller clears stale messages and reasons between phases", () => {
  const controller = createSystemInputController();

  controller.setPhase("warning", { reason: "paste_failed", message: "Paste failed" });
  controller.setPhase("starting", { message: "Starting" });

  assert.equal(controller.getState().phase, "starting");
  assert.equal(controller.getState().reason, "");
  assert.equal(controller.getState().message, "Starting");

  controller.setPhase("idle");

  assert.equal(controller.getState().phase, "idle");
  assert.equal(controller.getState().reason, "");
  assert.equal(controller.getState().message, "");
});

test("system input controller times out renderer start and stop commands", () => {
  const startingTimers = createManualTimers();
  const startingResets = [];
  const startingController = createSystemInputController({
    requestRendererReset: () => startingResets.push("reset"),
    setTimeoutImpl: startingTimers.setTimeoutImpl,
    clearTimeoutImpl: startingTimers.clearTimeoutImpl,
    commandTimeoutMs: 125
  });

  startingController.setPhase("starting");
  const startTimeout = startingTimers.runNextPending();

  assert.equal(startTimeout.delay, 125);
  assert.deepEqual(startingResets, ["reset"]);
  assert.equal(startingController.getState().phase, "error");
  assert.equal(startingController.getState().reason, "renderer_timeout");
  assert.equal(startingController.getState().message, "Recording did not start.");

  const stoppingTimers = createManualTimers();
  const stoppingResets = [];
  const stoppingController = createSystemInputController({
    requestRendererReset: () => stoppingResets.push("reset"),
    setTimeoutImpl: stoppingTimers.setTimeoutImpl,
    clearTimeoutImpl: stoppingTimers.clearTimeoutImpl,
    commandTimeoutMs: 250
  });

  stoppingController.setPhase("stopping");
  const stopTimeout = stoppingTimers.runNextPending();

  assert.equal(stopTimeout.delay, 250);
  assert.deepEqual(stoppingResets, ["reset"]);
  assert.equal(stoppingController.getState().phase, "error");
  assert.equal(stoppingController.getState().reason, "renderer_timeout");
  assert.equal(stoppingController.getState().message, "Recording did not stop.");
});

test("system input controller ignores stale command timeout after starting refreshes", () => {
  const timers = createManualTimers();
  const now = createManualClock();
  const resets = [];
  const controller = createSystemInputController({
    requestRendererReset: () => resets.push("reset"),
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    commandTimeoutMs: 125,
    now
  });

  controller.setPhase("starting", { message: "Starting" });
  const staleTimerId = timers.lastPendingId();
  const staleUpdatedAt = controller.getState().updatedAt;

  controller.setPhase("starting", { message: "Starting again" });
  assert.notEqual(controller.getState().updatedAt, staleUpdatedAt);

  timers.runTimer(staleTimerId);

  assert.deepEqual(resets, []);
  assert.equal(controller.getState().phase, "starting");
  assert.equal(controller.getState().message, "Starting again");
});

test("system input controller ignores stale command timeout after phase changes", () => {
  const timers = createManualTimers();
  const resets = [];
  const controller = createSystemInputController({
    requestRendererReset: () => resets.push("reset"),
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    commandTimeoutMs: 125
  });

  controller.setPhase("starting", { message: "Starting" });
  const staleTimerId = timers.lastPendingId();

  controller.setPhase("recording", { message: "Recording" });
  timers.runTimer(staleTimerId);

  assert.deepEqual(resets, []);
  assert.equal(controller.getState().phase, "recording");
  assert.equal(controller.getState().message, "Recording");
});

test("system input controller returns terminal phases to idle after the terminal delay", () => {
  for (const phase of ["done", "warning", "error"]) {
    const timers = createManualTimers();
    const controller = createSystemInputController({
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
      terminalAutoIdleMs: 75
    });

    controller.setPhase(phase, { message: phase });
    const timeout = timers.runNextPending();

    assert.equal(timeout.delay, 75);
    assert.equal(controller.getState().phase, "idle");
  }
});

test("system input controller ignores stale terminal auto-idle timers", () => {
  const timers = createManualTimers();
  const now = createManualClock();
  const controller = createSystemInputController({
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    terminalAutoIdleMs: 75,
    now
  });

  controller.setPhase("warning", { message: "first warning" });
  const staleTimerId = timers.lastPendingId();
  const staleUpdatedAt = controller.getState().updatedAt;

  controller.setPhase("warning", { message: "second warning" });
  assert.notEqual(controller.getState().updatedAt, staleUpdatedAt);

  timers.runTimer(staleTimerId);

  assert.equal(controller.getState().phase, "warning");
  assert.equal(controller.getState().message, "second warning");
});

test("system input controller stamps and clears recording start time", () => {
  const now = createManualClock();
  const controller = createSystemInputController({ now });

  controller.setPhase("recording", { message: "Recording" });
  const recordingStartedAt = controller.getState().recordingStartedAt;

  assert.equal(recordingStartedAt, "2026-06-29T00:00:01.000Z");

  controller.setPhase("done");

  assert.equal(controller.getState().recordingStartedAt, undefined);
});

test("system input controller preserves recording start time during recording status refreshes", () => {
  const now = createManualClock();
  const controller = createSystemInputController({ now });

  controller.setPhase("recording", { message: "Recording" });
  const recordingStartedAt = controller.getState().recordingStartedAt;

  controller.handleRendererStatus({ phase: "recording", message: "Still recording" });

  assert.equal(controller.getState().phase, "recording");
  assert.equal(controller.getState().message, "Still recording");
  assert.equal(controller.getState().recordingStartedAt, recordingStartedAt);
});

function createManualTimers() {
  let nextId = 1;
  const timers = new Map();

  function setTimeoutImpl(callback, delay) {
    const id = nextId;
    nextId += 1;
    timers.set(id, { callback, delay, cleared: false });
    return id;
  }

  function clearTimeoutImpl(id) {
    const timer = timers.get(id);
    if (timer) {
      timer.cleared = true;
    }
  }

  function runNextPending() {
    for (const [id, timer] of timers.entries()) {
      if (!timer.cleared) {
        timer.cleared = true;
        timer.callback();
        return { id, delay: timer.delay };
      }
    }
    throw new Error("No pending timer to run.");
  }

  function runTimer(id) {
    const timer = timers.get(id);
    if (!timer) {
      throw new Error(`Unknown timer: ${id}`);
    }
    timer.callback();
    return { id, delay: timer.delay };
  }

  function lastPendingId() {
    let lastId;
    for (const [id, timer] of timers.entries()) {
      if (!timer.cleared) {
        lastId = id;
      }
    }
    if (!lastId) {
      throw new Error("No pending timer.");
    }
    return lastId;
  }

  return {
    setTimeoutImpl,
    clearTimeoutImpl,
    runNextPending,
    runTimer,
    lastPendingId
  };
}

function createManualClock() {
  let tick = 0;
  return () => {
    const stamp = `2026-06-29T00:00:${String(tick).padStart(2, "0")}.000Z`;
    tick += 1;
    return stamp;
  };
}
