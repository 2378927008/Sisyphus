import test from "node:test";
import assert from "node:assert/strict";
import { detectEmbeddedLlmAssets, embeddedLlmRecommendation, buildEmbeddedLlmInstallCommand } from "../src/main/embedded-llm-assets.js";

test("embeddedLlmRecommendation describes the bundled default model", () => {
  assert.equal(embeddedLlmRecommendation.modelId, "Qwen/Qwen3-4B-GGUF");
  assert.equal(embeddedLlmRecommendation.quantization, "Q4_K_M");
  assert.equal(embeddedLlmRecommendation.modelFile, "Qwen3-4B-Q4_K_M.gguf");
  assert.equal(embeddedLlmRecommendation.license, "Apache-2.0");
  assert.match(embeddedLlmRecommendation.modelUrl, /Qwen3-4B-Q4_K_M\.gguf/);
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
    }
  });

  assert.equal(result.ready, true);
  assert.equal(result.runtimeReady, true);
  assert.equal(result.modelReady, true);
  assert.match(result.cliPath.replaceAll("\\", "/"), /vendor\/llm\/bin\/llama-cli\.exe$/);
  assert.match(result.modelPath.replaceAll("\\", "/"), /vendor\/llm\/models\/Qwen3-4B-Q4_K_M\.gguf$/);
  assert.ok(seen.some((item) => item.endsWith("vendor/llm/bin/llama-cli.exe")));
});

test("buildEmbeddedLlmInstallCommand points to the setup script", () => {
  assert.equal(
    buildEmbeddedLlmInstallCommand(),
    "powershell.exe -ExecutionPolicy Bypass -File .\\scripts\\setup-llm.ps1"
  );
});
