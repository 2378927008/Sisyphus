import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  detectEmbeddedLlmAssets,
  embeddedLlmRecommendation,
  buildEmbeddedLlmInstallCommand,
  selectLlamaReleaseAsset,
  validateEmbeddedLlmRuntime
} from "../src/main/embedded-llm-assets.js";

test("embeddedLlmRecommendation describes the bundled default model", () => {
  assert.equal(embeddedLlmRecommendation.modelId, "Qwen/Qwen3-4B-GGUF");
  assert.equal(embeddedLlmRecommendation.quantization, "Q4_K_M");
  assert.equal(embeddedLlmRecommendation.modelFile, "Qwen3-4B-Q4_K_M.gguf");
  assert.equal(embeddedLlmRecommendation.license, "Apache-2.0");
  assert.match(embeddedLlmRecommendation.modelUrl, /Qwen3-4B-Q4_K_M\.gguf/);
  assert.equal(embeddedLlmRecommendation.runtimeVersion, "b9049");
  assert.match(embeddedLlmRecommendation.runtimeCliSha256, /^[a-f0-9]{64}$/);
});

test("detectEmbeddedLlmAssets reports missing runtime and model", async () => {
  const result = await detectEmbeddedLlmAssets("C:/project", {
    stat: async () => {
      throw new Error("missing");
    }
  });

  assert.equal(result.ready, false);
  assert.equal(result.runtimeReady, false);
  assert.equal(result.modelReady, false);
  assert.equal(result.cliPath, "");
  assert.equal(result.modelPath, "");
});

test("detectEmbeddedLlmAssets returns detected llama runtime and model paths", async () => {
  const seen = [];
  const result = await detectEmbeddedLlmAssets("C:/project", {
    stat: async (filePath) => {
      seen.push(filePath.replaceAll("\\", "/"));
      if (filePath.includes("llama-cli.exe") || filePath.includes("Qwen3-4B-Q4_K_M.gguf")) {
        return { isFile: () => true };
      }
      throw new Error("missing");
    },
    validateRuntime: async () => ({ ready: true })
  });

  assert.equal(result.ready, true);
  assert.equal(result.runtimeReady, true);
  assert.equal(result.modelReady, true);
  assert.match(result.cliPath.replaceAll("\\", "/"), /vendor\/llm\/bin\/llama-cli\.exe$/);
  assert.match(result.modelPath.replaceAll("\\", "/"), /vendor\/llm\/models\/Qwen3-4B-Q4_K_M\.gguf$/);
  assert.ok(seen.some((item) => item.endsWith("vendor/llm/bin/llama-cli.exe")));
});

test("detectEmbeddedLlmAssets rejects installed runtime when llama-cli cannot start", async () => {
  const result = await detectEmbeddedLlmAssets("C:/project", {
    stat: async (filePath) => {
      if (filePath.includes("llama-cli.exe") || filePath.includes("Qwen3-4B-Q4_K_M.gguf")) {
        return { isFile: () => true };
      }
      throw new Error("missing");
    },
    validateRuntime: async () => ({
      ready: false,
      error: "llama-cli exited with code 3221225477."
    })
  });

  assert.equal(result.ready, false);
  assert.equal(result.runtimeReady, false);
  assert.equal(result.modelReady, true);
  assert.match(result.runtimeError, /3221225477/);
});

test("buildEmbeddedLlmInstallCommand points to the setup script", () => {
  assert.equal(
    buildEmbeddedLlmInstallCommand(),
    "powershell.exe -ExecutionPolicy Bypass -File .\\scripts\\setup-llm.ps1"
  );
});

test("selectLlamaReleaseAsset skips cudart packages and prefers Windows AVX2 runtime", () => {
  const asset = selectLlamaReleaseAsset([
    { name: "cudart-llama-bin-win-cuda-12.4-x64.zip", browser_download_url: "https://example.com/cudart.zip" },
    { name: "llama-b1234-bin-win-cuda-cu12.4-x64.zip", browser_download_url: "https://example.com/cuda.zip" },
    { name: "llama-b1234-bin-win-x64.zip", browser_download_url: "https://example.com/x64.zip" },
    { name: "llama-b1234-bin-win-avx2-x64.zip", browser_download_url: "https://example.com/avx2.zip" }
  ]);

  assert.equal(asset.name, "llama-b1234-bin-win-avx2-x64.zip");
});

test("validateEmbeddedLlmRuntime uses a bounded version probe and drains both streams", async () => {
  let spawnedArgs;
  let child;
  const resultPromise = validateEmbeddedLlmRuntime("C:/runtime/llama-cli.exe", {
    expectedSha256: "",
    spawn: (_file, args) => {
      spawnedArgs = args;
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.alloc(128 * 1024, "x"));
        child.stderr.emit("data", Buffer.from("version: test"));
        child.emit("close", 0);
      });
      return child;
    }
  });

  assert.deepEqual(spawnedArgs, ["--version"]);
  assert.equal(child.stdout.listenerCount("data"), 1);
  assert.deepEqual(await resultPromise, { ready: true, error: "" });
});

test("validateEmbeddedLlmRuntime rejects an unexpected binary before spawning it", async () => {
  let spawnCalls = 0;
  const result = await validateEmbeddedLlmRuntime("C:/runtime/llama-cli.exe", {
    expectedSha256: "a".repeat(64),
    readFile: async () => Buffer.from("unexpected runtime"),
    spawn: () => {
      spawnCalls += 1;
      throw new Error("must not spawn an unverified runtime");
    }
  });

  assert.equal(result.ready, false);
  assert.match(result.error, /does not match the bundled version/i);
  assert.equal(spawnCalls, 0);
});
