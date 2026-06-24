import test from "node:test";
import assert from "node:assert/strict";
import { parseWhisperOutput, buildWhisperArgs } from "../src/main/local-asr.js";

test("parseWhisperOutput strips timestamp prefixes and joins transcript lines", () => {
  const output = `
[00:00:00.000 --> 00:00:02.000]  Hello there
[00:00:02.000 --> 00:00:04.000]  this is a test
whisper_print_timings: total time = 123 ms
`;

  assert.equal(parseWhisperOutput(output), "Hello there this is a test");
});

test("parseWhisperOutput removes whisper timing logs appended to transcript line", () => {
  const output = " Hello World. This is a local dictation test.whisper_print_timings: total time = 1965.93 ms";

  assert.equal(parseWhisperOutput(output), "Hello World. This is a local dictation test.");
});

test("parseWhisperOutput ignores whisper.cpp backend and audio decoder logs", () => {
  const output = `
 Hello World. This is a local dictation test.
load_backend: loaded CPU backend from C:\\tools\\ggml-cpu.dll
read_audio_data: reading audio data from 'input.wav' ...
read_audio_data: trying to decode with miniaudio
`;

  assert.equal(parseWhisperOutput(output), "Hello World. This is a local dictation test.");
});

test("buildWhisperArgs builds a no-timestamp whisper.cpp invocation", () => {
  const args = buildWhisperArgs({
    modelPath: "C:/models/ggml-base.bin",
    wavPath: "C:/tmp/input.wav",
    language: "auto"
  });

  assert.deepEqual(args, ["-m", "C:/models/ggml-base.bin", "-f", "C:/tmp/input.wav", "-nt"]);
});

test("buildWhisperArgs includes explicit language when configured", () => {
  const args = buildWhisperArgs({
    modelPath: "C:/models/ggml-base.bin",
    wavPath: "C:/tmp/input.wav",
    language: "zh"
  });

  assert.deepEqual(args, ["-m", "C:/models/ggml-base.bin", "-f", "C:/tmp/input.wav", "-nt", "-l", "zh"]);
});
