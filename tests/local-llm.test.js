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

test("polishTranscript explains missing embedded executable without leaking raw spawn errors", async () => {
  await assert.rejects(
    polishTranscript(
      "hello world",
      {
        polishMode: "polish",
        outputLanguage: "zh-Hans",
        embeddedLlmCliPath: "C:/missing/llama-cli.exe",
        embeddedLlmModelPath: "C:/models/Qwen3-4B-Q4_K_M.gguf",
        ollamaEnabled: false
      },
      {
        spawn: () => {
          const child = new EventEmitter();
          queueMicrotask(() => {
            const error = new Error("spawn C:/missing/llama-cli.exe ENOENT");
            error.code = "ENOENT";
            child.emit("error", error);
          });
          return child;
        }
      }
    ),
    (error) => {
      assert.match(error.message, /Local language model executable was not found/);
      assert.doesNotMatch(error.message, /spawn C:\/missing/);
      return true;
    }
  );
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

  assert.deepEqual(result, { ready: true, reason: "" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].origin, "https://api.mymemory.translated.net");
  assert.equal(requests[0].searchParams.get("q"), "hello world");
  assert.equal(requests[0].searchParams.get("langpair"), "en|zh-CN");
});

test("checkTextProvider reports missing embedded model files", async () => {
  const result = await checkTextProvider({
    llmProvider: "embedded",
    embeddedLlmCliPath: "C:/missing/llama-cli.exe",
    embeddedLlmModelPath: "C:/missing/Qwen3-4B-Q4_K_M.gguf"
  });

  assert.deepEqual(result, {
    ready: false,
    reason: "text_provider_unavailable"
  });
});

test("checkTextProvider does not bypass embedded file checks when spawn is injected", async () => {
  const result = await checkTextProvider(
    {
      llmProvider: "embedded",
      embeddedLlmCliPath: "C:/missing/llama-cli.exe",
      embeddedLlmModelPath: "C:/missing/Qwen3-4B-Q4_K_M.gguf"
    },
    {
      spawn: () => {
        throw new Error("spawn should not be used by diagnostics readiness");
      }
    }
  );

  assert.deepEqual(result, {
    ready: false,
    reason: "text_provider_unavailable"
  });
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

  assert.deepEqual(result, {
    ready: false,
    reason: "text_provider_unavailable"
  });
});

test("checkTextProvider returns a stable reason without provider responses or raw exceptions", async () => {
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
          responseDetails:
            "Daily limit exceeded at https://vendor.example: stderr spawn ENOENT"
        })
      })
    }
  );

  assert.deepEqual(result, {
    ready: false,
    reason: "text_provider_unavailable"
  });
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
