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

test("system input controller exposes explicit start and stop commands", async () => {
  const calls = [];
  const controller = createSystemInputController({
    startRecording: async (command) => calls.push(["start", command]),
    stopRecording: async (command) => calls.push(["stop", command])
  });

  await controller.start();
  const operationId = controller.getState().operationId;
  controller.handleRendererStatus({ operationId, phase: "recording" });
  await controller.stop();

  assert.deepEqual(calls, [
    ["start", { operationId }],
    ["stop", { operationId }]
  ]);
});

test("system input controller keeps polishing distinct and busy", async () => {
  const calls = [];
  const controller = createSystemInputController({
    startRecording: async () => calls.push("start"),
    stopRecording: async () => calls.push("stop")
  });

  controller.handleSystemStatus({ phase: "polishing", message: "Polishing" });
  await controller.start();
  await controller.stop();

  assert.equal(controller.getState().phase, "polishing");
  assert.equal(controller.getState().message, "Polishing");
  assert.deepEqual(calls, []);
});

test("cancel resets the renderer and returns directly to idle", async () => {
  for (const phase of ["starting", "recording"]) {
    const resets = [];
    const controller = createSystemInputController({
      startRecording: async () => {},
      requestRendererReset: (command) => resets.push(command)
    });

    await controller.start();
    const operationId = controller.getState().operationId;
    if (phase === "recording") {
      controller.handleRendererStatus({ operationId, phase });
    }
    await controller.cancel();

    assert.deepEqual(resets, [{ operationId }], phase);
    assert.equal(controller.getState().phase, "idle", phase);
    assert.equal(controller.getState().operationId, undefined, phase);
  }
});

test("main owns monotonically increasing recording operation ids", async () => {
  const commands = [];
  const controller = createSystemInputController({
    startRecording: async (command) => commands.push(command)
  });

  await controller.start();
  const firstOperationId = controller.getState().operationId;
  controller.handleRendererStatus({ operationId: firstOperationId, phase: "error" });
  await controller.start();
  const secondOperationId = controller.getState().operationId;

  assert.equal(Number.isSafeInteger(firstOperationId), true);
  assert.equal(secondOperationId, firstOperationId + 1);
  assert.deepEqual(commands, [
    { operationId: firstOperationId },
    { operationId: secondOperationId }
  ]);
});

test("cancel during pending start invalidates late statuses from that operation", async () => {
  let releaseStart;
  const startCommands = [];
  const resetCommands = [];
  const pendingStart = new Promise((resolve) => {
    releaseStart = resolve;
  });
  const controller = createSystemInputController({
    startRecording: async (command) => {
      startCommands.push(command);
      if (startCommands.length === 1) {
        await pendingStart;
      }
    },
    requestRendererReset: (command) => resetCommands.push(command)
  });

  const start = controller.start();
  const operationId = controller.getState().operationId;
  assert.equal(controller.getState().phase, "starting");

  await controller.cancel();
  await controller.start();
  const nextOperationId = controller.getState().operationId;
  controller.handleRendererStatus({
    operationId,
    phase: "recording",
    message: "late recording"
  });

  assert.deepEqual(resetCommands, [{ operationId }]);
  assert.equal(nextOperationId, operationId + 1);
  assert.deepEqual(startCommands, [
    { operationId },
    { operationId: nextOperationId }
  ]);
  assert.equal(controller.getState().phase, "starting");
  releaseStart();
  await start;
  assert.equal(controller.getState().phase, "starting");
  assert.equal(controller.getState().operationId, nextOperationId);
});

test("cancel ignores repeated requests and late same-generation recording", async () => {
  const resets = [];
  const controller = createSystemInputController({
    startRecording: async () => {},
    requestRendererReset: (command) => resets.push(command)
  });

  await controller.start();
  const operationId = controller.getState().operationId;
  controller.handleRendererStatus({ operationId, phase: "recording" });

  await controller.cancel();
  await controller.cancel();
  controller.handleRendererStatus({ operationId, phase: "recording" });

  assert.deepEqual(resets, [{ operationId }]);
  assert.equal(controller.getState().phase, "idle");
});

test("stop wins a stop-then-cancel race without resetting the renderer", async () => {
  let releaseStop;
  const stopCommands = [];
  const resets = [];
  const pendingStop = new Promise((resolve) => {
    releaseStop = resolve;
  });
  const controller = createSystemInputController({
    startRecording: async () => {},
    stopRecording: async (command) => {
      stopCommands.push(command);
      await pendingStop;
    },
    requestRendererReset: (command) => resets.push(command)
  });

  await controller.start();
  const operationId = controller.getState().operationId;
  controller.handleRendererStatus({ operationId, phase: "recording" });

  const stop = controller.stop();
  await controller.cancel();

  assert.equal(controller.getState().phase, "stopping");
  assert.deepEqual(stopCommands, [{ operationId }]);
  assert.deepEqual(resets, []);
  releaseStop();
  await stop;
});

test("cancel wins a cancel-then-stop race and leaves the controller idle", async () => {
  const stopCommands = [];
  const resets = [];
  const controller = createSystemInputController({
    startRecording: async () => {},
    stopRecording: async (command) => stopCommands.push(command),
    requestRendererReset: (command) => resets.push(command)
  });

  await controller.start();
  const operationId = controller.getState().operationId;
  controller.handleRendererStatus({ operationId, phase: "recording" });

  await controller.cancel();
  await controller.stop();

  assert.deepEqual(resets, [{ operationId }]);
  assert.deepEqual(stopCommands, []);
  assert.equal(controller.getState().phase, "idle");
});

test("renderer statuses require the current main-owned operation id", async () => {
  const controller = createSystemInputController({
    startRecording: async () => {}
  });

  await controller.start();
  const firstOperationId = controller.getState().operationId;
  controller.handleRendererStatus({ phase: "recording" });
  controller.handleRendererStatus({ operationId: firstOperationId - 1, phase: "recording" });
  assert.equal(controller.getState().phase, "starting");

  controller.handleRendererStatus({ operationId: firstOperationId, phase: "recording" });
  assert.equal(controller.getState().phase, "recording");

  controller.handleRendererStatus({ operationId: firstOperationId, phase: "error" });
  await controller.start();
  const secondOperationId = controller.getState().operationId;
  controller.handleRendererStatus({ operationId: firstOperationId, phase: "recording" });

  assert.equal(controller.getState().phase, "starting");
  assert.equal(controller.getState().operationId, secondOperationId);
});

test("cancel ignores every non-cancellable phase", async () => {
  const resets = [];
  const controller = createSystemInputController({
    requestRendererReset: () => resets.push("reset")
  });

  for (const phase of [
    "idle",
    "stopping",
    "transcribing",
    "polishing",
    "pasting",
    "done",
    "warning",
    "error"
  ]) {
    controller.setPhase(phase);
    await controller.cancel();
    assert.equal(controller.getState().phase, phase);
  }

  assert.deepEqual(resets, []);
});

test("stop remains idempotent while a stop command is pending", async () => {
  let releaseStop;
  const calls = [];
  const pendingStop = new Promise((resolve) => {
    releaseStop = resolve;
  });
  const controller = createSystemInputController({
    startRecording: async () => {},
    stopRecording: async (command) => {
      calls.push(command);
      await pendingStop;
    }
  });

  await controller.start();
  const operationId = controller.getState().operationId;
  controller.handleRendererStatus({ operationId, phase: "recording" });
  const firstStop = controller.stop();
  const secondStop = controller.stop();

  assert.deepEqual(calls, [{ operationId }]);
  releaseStop();
  await Promise.all([firstStop, secondStop]);
  assert.deepEqual(calls, [{ operationId }]);
});

test("system input controller explicit commands ignore invalid lifecycle states", async () => {
  const calls = [];
  const controller = createSystemInputController({
    startRecording: async () => calls.push("start"),
    stopRecording: async () => calls.push("stop")
  });

  await controller.stop();
  controller.setPhase("recording");
  await controller.start();
  controller.setPhase("transcribing");
  await controller.start();
  await controller.stop();

  assert.deepEqual(calls, []);
});

test("system input controller exposes starting and stopping lifecycle phases", () => {
  const controller = createSystemInputController();

  controller.setPhase("starting", { message: "Starting" });
  assert.equal(controller.getState().phase, "starting");
  controller.handleSystemStatus({ phase: "stopping", message: "Stopping" });
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
  controller.setPhase("polishing");
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

  controller.handleSystemStatus({ phase: "warning", message: "Raw transcript saved" });

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
  const controller = createSystemInputController({
    now,
    startRecording: async () => {}
  });

  void controller.start();
  const operationId = controller.getState().operationId;
  controller.handleRendererStatus({ operationId, phase: "recording", message: "Recording" });
  const recordingStartedAt = controller.getState().recordingStartedAt;

  controller.handleRendererStatus({ operationId, phase: "recording", message: "Still recording" });

  assert.equal(controller.getState().phase, "recording");
  assert.equal(controller.getState().message, "Still recording");
  assert.equal(controller.getState().recordingStartedAt, recordingStartedAt);
});

test("auxiliary paste and hotkey statuses cannot replace an active recording operation", async () => {
  const stopCommands = [];
  const controller = createSystemInputController({
    startRecording: async () => {},
    stopRecording: async (command) => stopCommands.push(command)
  });

  assert.equal(typeof controller.handleAuxiliaryStatus, "function");
  assert.equal(typeof controller.hasActiveOperation, "function");

  await controller.start();
  const operationId = controller.getState().operationId;
  controller.handleRendererStatus({
    operationId,
    phase: "recording",
    message: "Recording"
  });

  for (const payload of [
    { phase: "pasting", message: "Pasting last dictation" },
    { phase: "warning", reason: "hotkey_conflict", message: "Shortcut unavailable" },
    { phase: "error", reason: "hotkey_failed", message: "Shortcut registration failed" }
  ]) {
    assert.equal(controller.handleAuxiliaryStatus(payload), false, payload.phase);
    assert.equal(controller.getState().phase, "recording", payload.phase);
    assert.equal(controller.getState().operationId, operationId, payload.phase);
    assert.equal(controller.hasActiveOperation(), true, payload.phase);
  }

  await controller.stop();

  assert.deepEqual(stopCommands, [{ operationId }]);
  assert.equal(controller.getState().phase, "stopping");
  assert.equal(controller.getState().operationId, operationId);
});

test("processing statuses require the matching active operation id", async () => {
  const controller = createSystemInputController({
    startRecording: async () => {}
  });

  await controller.start();
  const operationId = controller.getState().operationId;
  controller.handleRendererStatus({ operationId, phase: "recording" });
  controller.handleRendererStatus({ operationId, phase: "transcribing" });

  assert.equal(
    controller.handleSystemStatus({
      operationId: operationId + 1,
      phase: "polishing",
      message: "stale processing"
    }),
    false
  );
  assert.equal(controller.getState().phase, "transcribing");
  assert.equal(controller.getState().operationId, operationId);

  assert.equal(
    controller.handleSystemStatus({
      operationId,
      phase: "polishing",
      message: "current processing"
    }),
    true
  );
  assert.equal(controller.getState().phase, "polishing");
  assert.equal(controller.getState().operationId, operationId);
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
