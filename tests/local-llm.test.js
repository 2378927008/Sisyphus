import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { buildLlamaCliArgs, checkTextProvider, polishTranscript } from "../src/main/local-llm.js";

test("polishTranscript requires a target-capable text provider for target output languages", async () => {
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

test("polishTranscript uses MyMemory for selected target output languages", async () => {
  const requests = [];
  const result = await polishTranscript(
    "um hello world",
    {
      llmProvider: "mymemory",
      polishMode: "polish",
      outputLanguage: "zh-Hans",
      whisperLanguage: "en"
    },
    {
      fetch: async (url) => {
        requests.push(new URL(url));
        return {
          ok: true,
          json: async () => ({
            responseStatus: 200,
            responseData: { translatedText: "你好，世界" }
          })
        };
      }
    }
  );

  assert.equal(result, "你好，世界");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].origin, "https://api.mymemory.translated.net");
  assert.equal(requests[0].searchParams.get("q"), "hello world");
  assert.equal(requests[0].searchParams.get("langpair"), "en|zh-CN");
});

test("polishTranscript keeps automatic output local when MyMemory is selected", async () => {
  const result = await polishTranscript(
    "um hello   world",
    {
      llmProvider: "mymemory",
      polishMode: "polish",
      outputLanguage: "auto"
    },
    {
      fetch: async () => {
        throw new Error("fetch should not run for automatic same-language output");
      }
    }
  );

  assert.equal(result, "hello world");
});

test("checkTextProvider probes MyMemory with a small target-language request", async () => {
  const requests = [];
  const result = await checkTextProvider(
    {
      llmProvider: "mymemory",
      outputLanguage: "auto"
    },
    {
      fetch: async (url) => {
        requests.push(new URL(url));
        return {
          ok: true,
          json: async () => ({
            responseStatus: 200,
            responseData: { translatedText: "你好" }
          })
        };
      }
    }
  );

  assert.equal(result.ready, true);
  assert.equal(result.checks[0].status, "pass");
  assert.equal(result.checks[0].label, "MyMemory Free");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].origin, "https://api.mymemory.translated.net");
  assert.equal(requests[0].searchParams.get("q"), "hello world");
  assert.equal(requests[0].searchParams.get("langpair"), "en|zh-CN");
});

test("checkTextProvider reports MyMemory failures without throwing", async () => {
  const result = await checkTextProvider(
    {
      llmProvider: "mymemory",
      outputLanguage: "zh-Hans"
    },
    {
      fetch: async () => ({
        ok: false,
        status: 429,
        json: async () => ({
          responseStatus: 429,
          responseDetails: "Daily limit exceeded."
        })
      })
    }
  );

  assert.equal(result.ready, false);
  assert.equal(result.checks[0].status, "fail");
  assert.match(result.checks[0].message, /Daily limit exceeded/);
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
