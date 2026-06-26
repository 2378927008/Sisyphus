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
