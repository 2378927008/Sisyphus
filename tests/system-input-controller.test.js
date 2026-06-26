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
