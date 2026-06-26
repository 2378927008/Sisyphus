import test from "node:test";
import assert from "node:assert/strict";
import { parseWhisperOutput, buildWhisperArgs, transcribeWithWhisper } from "../src/main/local-asr.js";

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

test("transcribeWithWhisper retries Chinese recognition when auto returns Latin text for Chinese settings", async () => {
  const calls = [];
  const transcript = await transcribeWithWhisper(Buffer.from("wav"), {
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin",
    whisperLanguage: "auto",
    interfaceLanguage: "zh-Hans",
    outputLanguage: "auto"
  }, {
    spawn: (_file, args) => {
      calls.push(args);
      return fakeWhisperProcess(calls.length === 1 ? " Hello world" : " 这是一个测试");
    },
    timeoutMs: 1000
  });

  assert.equal(transcript, "这是一个测试");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].includes("-l"), false);
  assert.deepEqual(calls[1].slice(-2), ["-l", "zh"]);
});

test("transcribeWithWhisper replaces Latin-dominant mixed Chinese output with a better Chinese retry", async () => {
  const calls = [];
  const transcript = await transcribeWithWhisper(Buffer.from("wav"), {
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin",
    whisperLanguage: "auto",
    interfaceLanguage: "zh-Hans",
    outputLanguage: "auto"
  }, {
    spawn: (_file, args) => {
      calls.push(args);
      return fakeWhisperProcess(calls.length === 1 ? " This is a本地语音输入测试" : " 这是一个本地语音输入测试");
    },
    timeoutMs: 1000
  });

  assert.equal(transcript, "这是一个本地语音输入测试");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].slice(-2), ["-l", "zh"]);
});

test("transcribeWithWhisper keeps English dictation when Chinese retry is not more Chinese", async () => {
  const calls = [];
  const transcript = await transcribeWithWhisper(Buffer.from("wav"), {
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin",
    whisperLanguage: "auto",
    interfaceLanguage: "zh-Hans",
    outputLanguage: "auto"
  }, {
    spawn: (_file, args) => {
      calls.push(args);
      return fakeWhisperProcess(calls.length === 1
        ? " Hello world this is a test"
        : " Hello world this is a test");
    },
    timeoutMs: 1000
  });

  assert.equal(transcript, "Hello world this is a test");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].slice(-2), ["-l", "zh"]);
});

function fakeWhisperProcess(stdoutText) {
  const child = {
    stdout: fakeStream([stdoutText]),
    stderr: fakeStream([]),
    kill() {},
    on(event, callback) {
      if (event === "close") {
        queueMicrotask(() => callback(0));
      }
      return child;
    }
  };
  return child;
}

function fakeStream(chunks) {
  return {
    on(event, callback) {
      if (event === "data") {
        for (const chunk of chunks) {
          queueMicrotask(() => callback(Buffer.from(chunk)));
        }
      }
      return this;
    }
  };
}
