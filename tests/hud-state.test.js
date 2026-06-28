import test from "node:test";
import assert from "node:assert/strict";
import { formatElapsed, getHudViewState } from "../src/renderer/hud-state.js";

test("getHudViewState returns readable Chinese recording state", () => {
  const view = getHudViewState(
    {
      phase: "recording",
      language: "zh-Hans",
      recordingStartedAt: "2026-06-29T00:00:00.000Z"
    },
    {
      nowMs: Date.parse("2026-06-29T00:00:07.000Z")
    }
  );

  assert.equal(view.title, "正在录音");
  assert.equal(view.message, "再次按快捷键停止");
  assert.equal(view.elapsed, "00:07");
});

test("getHudViewState returns concise paste failure warning", () => {
  const view = getHudViewState({
    phase: "warning",
    reason: "paste_failed",
    message: "Paste command exited with code 1.",
    language: "en"
  });

  assert.equal(view.title, "Needs review");
  assert.equal(view.message, "Paste failed. Text saved.");
  assert.equal(view.elapsed, "");
});

test("getHudViewState hides raw diagnostics in HUD messages", () => {
  const view = getHudViewState({
    phase: "error",
    reason: "renderer_timeout",
    message: "C:/Users/Administrator/vendor/qwen/model.gguf spawn ENOENT\n    at stack trace",
    language: "zh-Hans"
  });

  assert.equal(view.title, "需要处理");
  assert.equal(view.message, "录音响应超时，请重试");
});

test("getHudViewState uses safe short status messages without known reasons", () => {
  const view = getHudViewState({
    phase: "warning",
    message: "Text saved for review.",
    language: "en"
  });

  assert.equal(view.message, "Text saved for review.");
});

test("getHudViewState rejects unsafe raw diagnostic status messages without known reasons", () => {
  const view = getHudViewState({
    phase: "error",
    message: "C:/Users/Administrator/vendor/qwen.gguf spawn ENOENT stack trace",
    language: "en"
  });

  assert.equal(view.message, "Open Local Flow to fix the issue.");
});

test("formatElapsed clamps invalid and long values", () => {
  assert.equal(formatElapsed(-1000), "00:00");
  assert.equal(formatElapsed(65_000), "01:05");
  assert.equal(formatElapsed(3_660_000), "61:00");
});

test("getHudViewState has non-empty title and message for every phase", () => {
  const phases = [
    "idle",
    "starting",
    "recording",
    "stopping",
    "transcribing",
    "pasting",
    "done",
    "warning",
    "error"
  ];

  for (const phase of phases) {
    const view = getHudViewState({ phase, language: "zh-Hans" });

    assert.ok(view.title, `${phase} should have a title`);
    assert.ok(view.message, `${phase} should have a message`);
  }
});
