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

test("getHudViewState ignores unknown raw messages in non-terminal phases", () => {
  const view = getHudViewState({
    phase: "starting",
    message: "Text saved for review.",
    language: "en"
  });

  assert.equal(view.message, "Preparing microphone.");
});

test("getHudViewState rejects unsafe raw diagnostic status messages without known reasons", () => {
  const view = getHudViewState({
    phase: "error",
    message: "C:/Users/Administrator/vendor/qwen.gguf spawn ENOENT stack trace",
    language: "en"
  });

  assert.equal(view.message, "Open Local Flow to fix the issue.");
});

test("getHudViewState hides provider diagnostics from terminal phases without known reasons", () => {
  const view = getHudViewState({
    phase: "error",
    message: "Target language output failed. Local language model exited with code 3221225477.",
    language: "en"
  });

  assert.equal(view.message, "Open Local Flow to fix the issue.");
});

test("getHudViewState uses mapped target output reason instead of provider diagnostics", () => {
  const view = getHudViewState({
    phase: "error",
    reason: "target_output_failed",
    message: "Target language output failed. Local language model exited with code 3221225477.",
    language: "en"
  });

  assert.equal(view.message, "Target language output failed.");
});

test("getHudViewState uses raw transcript saved reason instead of provider diagnostics", () => {
  const view = getHudViewState({
    phase: "warning",
    reason: "raw_transcript_saved",
    message: "Raw transcript saved. Local language model exited with code 1.",
    language: "en"
  });

  assert.equal(view.message, "Raw transcript saved.");
});

test("getHudViewState maps raw transcript saved reason in Simplified Chinese", () => {
  const view = getHudViewState({
    phase: "warning",
    reason: "raw_transcript_saved",
    message: "Raw transcript saved. Local language model exited with code 1.",
    language: "zh-Hans"
  });

  assert.equal(view.message, "原始转写已保存");
});

test("getHudViewState rejects provider and model diagnostics from non-terminal phases", () => {
  const cases = [
    {
      phase: "starting",
      message: "Local language model exited with code 3221225477.",
      expected: "Preparing microphone."
    },
    {
      phase: "transcribing",
      message: "Qwen provider error: exit code 1",
      expected: "Turning speech into text."
    },
    {
      phase: "pasting",
      message: "llama-cli exited with code 1",
      expected: "Pasting into the active app."
    }
  ];

  for (const { phase, message, expected } of cases) {
    const view = getHudViewState({
      phase,
      message,
      language: "en"
    });

    assert.equal(view.message, expected, message);
  }
});

test("getHudViewState rejects every URL scheme and stderr from non-terminal phases", () => {
  for (const message of [
    "See https://example.invalid/private-log for details",
    "See ftp://example.invalid/private-log for details",
    "Open custom-provider://private/runtime/error",
    "mailto:private@example.invalid",
    "data:text/plain,private diagnostics",
    "stderr: microphone initialization failed"
  ]) {
    const view = getHudViewState({
      phase: "starting",
      message,
      language: "en"
    });

    assert.equal(view.message, "Preparing microphone.", message);
  }
});

test("getHudViewState ignores safe short warning messages without known reasons", () => {
  const view = getHudViewState({
    phase: "warning",
    message: "Text saved for review.",
    language: "en"
  });

  assert.equal(view.message, "Open Local Flow to review.");
});

test("getHudViewState rejects unsafe path-like status messages without known reasons", () => {
  const unsafeMessages = [
    "\\\\server\\share\\model.gguf",
    "/Users/me/vendor/qwen/model.gguf",
    "/home/me/models/qwen.gguf",
    "/var/tmp/llama-cli",
    "/tmp/whisper-cli",
    "/vendor/qwen/model.gguf",
    "vendor/qwen/model.gguf",
    "models\\qwen.gguf",
    "qwen.gguf",
    "decoder.bin",
    "whisper-cli.exe",
    "llama-cli"
  ];

  for (const message of unsafeMessages) {
    const view = getHudViewState({
      phase: "error",
      message,
      language: "en"
    });

    assert.equal(view.message, "Open Local Flow to fix the issue.", message);
  }
});

test("getHudViewState maps every known reason without showing unsafe raw messages", () => {
  const reasons = [
    "not_ready",
    "renderer_timeout",
    "recording_failed",
    "transcription_failed",
    "target_output_failed",
    "raw_transcript_saved",
    "clipboard_unavailable",
    "paste_failed"
  ];
  const rawMessage = "C:/Users/Administrator/vendor/qwen/model.gguf spawn ENOENT stack trace";

  for (const reason of reasons) {
    const view = getHudViewState({
      phase: "error",
      reason,
      message: rawMessage,
      language: "en"
    });

    assert.ok(view.message, `${reason} should have a message`);
    assert.notEqual(view.message, rawMessage);
  }
});

test("getHudViewState localizes actions for every exact interface language", () => {
  const expected = {
    en: ["Recording", "Cancel recording", "Stop recording", "Open Local Flow"],
    "zh-Hans": ["正在录音", "取消录音", "停止录音", "打开 Local Flow"],
    ja: ["録音中", "録音をキャンセル", "録音を停止", "Local Flow を開く"],
    ko: ["녹음 중", "녹음 취소", "녹음 중지", "Local Flow 열기"],
    "zh-Hant": ["正在錄音", "取消錄音", "停止錄音", "開啟 Local Flow"],
    fr: ["Enregistrement", "Annuler l'enregistrement", "Arrêter l'enregistrement", "Ouvrir Local Flow"],
    ru: ["Запись", "Отменить запись", "Остановить запись", "Открыть Local Flow"],
    es: ["Grabando", "Cancelar grabación", "Detener grabación", "Abrir Local Flow"]
  };

  for (const [language, [title, cancel, stop, open]] of Object.entries(expected)) {
    const recording = getHudViewState({ phase: "recording", language });
    const warning = getHudViewState({ phase: "warning", language });

    assert.equal(recording.title, title, language);
    assert.equal(recording.actions.cancel.label, cancel, language);
    assert.equal(recording.actions.stop.label, stop, language);
    assert.equal(warning.actions.openMainWindow.label, open, language);
  }
});

test("getHudViewState falls back to English only for an unknown language", () => {
  const view = getHudViewState({ phase: "recording", language: "unknown" });

  assert.equal(view.title, "Recording");
  assert.equal(view.message, "Press shortcut again to stop.");
});

test("getHudViewState exposes phase-safe HUD actions", () => {
  const starting = getHudViewState({ phase: "starting", language: "en" });
  const recording = getHudViewState({ phase: "recording", language: "en" });
  const polishing = getHudViewState({ phase: "polishing", language: "en" });
  const warning = getHudViewState({ phase: "warning", language: "en" });
  const error = getHudViewState({ phase: "error", language: "en" });

  assert.deepEqual(starting.actions, {
    cancel: { visible: true, disabled: false, label: "Cancel recording" },
    stop: { visible: true, disabled: true, label: "Stop recording" },
    openMainWindow: { visible: false, disabled: false, label: "Open Local Flow" }
  });
  assert.equal(recording.actions.cancel.visible, true);
  assert.equal(recording.actions.stop.disabled, false);
  assert.equal(polishing.phase, "polishing");
  assert.equal(polishing.title, "Polishing");
  assert.equal(polishing.actions.cancel.visible, false);
  assert.equal(polishing.actions.stop.visible, false);
  assert.equal(warning.actions.openMainWindow.visible, true);
  assert.equal(error.actions.openMainWindow.visible, true);
});

test("getHudViewState uses updatedAt as recording elapsed fallback", () => {
  const view = getHudViewState(
    {
      phase: "recording",
      language: "en",
      updatedAt: "2026-06-29T00:00:05.000Z"
    },
    {
      nowMs: Date.parse("2026-06-29T00:00:12.000Z")
    }
  );

  assert.equal(view.elapsed, "00:07");
});

test("getHudViewState returns zero elapsed for invalid recording dates", () => {
  const view = getHudViewState({
    phase: "recording",
    language: "en",
    recordingStartedAt: "not a date"
  });

  assert.equal(view.elapsed, "00:00");
});

test("getHudViewState ignores stale reasons outside warning and error phases", () => {
  const view = getHudViewState({
    phase: "starting",
    reason: "paste_failed",
    message: "Starting recording",
    language: "en"
  });

  assert.equal(view.message, "Preparing microphone.");
});

test("recording limits have explicit HUD messages in every supported language", () => {
  for (const language of ["en", "zh-Hans", "ja", "ko", "zh-Hant", "fr", "ru", "es"]) {
    const generic = getHudViewState({ phase: "warning", language }).message;
    for (const reason of ["recording_too_long", "recording_too_large"]) {
      const view = getHudViewState({ phase: "warning", reason, language });
      assert.notEqual(view.message, generic, `${language}:${reason}`);
      assert.ok(view.message.length > 8, `${language}:${reason}`);
    }
  }
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
    "polishing",
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
