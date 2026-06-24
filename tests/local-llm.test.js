import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { buildLlamaCliArgs, polishTranscript } from "../src/main/local-llm.js";

test("polishTranscript requires Ollama for target output languages", async () => {
  await assert.rejects(
    polishTranscript("hello world", {
      polishMode: "polish",
      outputLanguage: "zh-Hans",
      ollamaEnabled: false
    }),
    /Install the built-in local language model/
  );
});

test("polishTranscript keeps local cleanup available for original output language", async () => {
  const result = await polishTranscript("um hello   world", {
    polishMode: "polish",
    outputLanguage: "auto",
    ollamaEnabled: false
  });

  assert.equal(result, "hello world");
});

test("buildLlamaCliArgs builds a local llama.cpp invocation", () => {
  const args = buildLlamaCliArgs({
    modelPath: "C:/models/Qwen3-4B-Q4_K_M.gguf",
    prompt: "Translate hello",
    maxTokens: 256
  });

  assert.deepEqual(args, [
    "-m",
    "C:/models/Qwen3-4B-Q4_K_M.gguf",
    "-p",
    "Translate hello",
    "-n",
    "256",
    "--temp",
    "0.2",
    "--top-p",
    "0.8",
    "--no-display-prompt"
  ]);
});

test("polishTranscript uses embedded llama.cpp when configured", async () => {
  const calls = [];
  const result = await polishTranscript(
    "hello world",
    {
      polishMode: "polish",
      outputLanguage: "zh-Hans",
      embeddedLlmCliPath: "C:/llama/llama-cli.exe",
      embeddedLlmModelPath: "C:/models/Qwen3-4B-Q4_K_M.gguf",
      ollamaEnabled: false
    },
    {
      spawn: (file, args) => {
        calls.push({ file, args });
        return createFakeChild({ stdout: "你好，世界" });
      }
    }
  );

  assert.equal(result, "你好，世界");
  assert.equal(calls[0].file, "C:/llama/llama-cli.exe");
  assert.ok(calls[0].args.includes("C:/models/Qwen3-4B-Q4_K_M.gguf"));
});

function createFakeChild({ stdout = "", stderr = "", code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};

  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  });

  return child;
}
