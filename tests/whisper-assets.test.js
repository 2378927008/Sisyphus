import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { detectWhisperAssets } from "../src/main/whisper-assets.js";

test("detectWhisperAssets returns downloaded vendor paths when files exist", async () => {
  const root = "C:/project";
  const seen = [];
  const result = await detectWhisperAssets(root, {
    stat: async (filePath) => {
      seen.push(filePath.replaceAll("\\", "/"));
      return { isFile: () => true };
    }
  });

  assert.equal(result.whisperCliPath, path.join(root, "vendor", "whisper", "bin", "Release", "whisper-cli.exe"));
  assert.equal(result.whisperModelPath, path.join(root, "vendor", "whisper", "models", "ggml-base.bin"));
  assert.deepEqual(seen, [
    "C:/project/vendor/whisper/bin/Release/whisper-cli.exe",
    "C:/project/vendor/whisper/models/ggml-base.bin"
  ]);
});

test("detectWhisperAssets does not return paths for missing files", async () => {
  const result = await detectWhisperAssets("C:/project", {
    stat: async () => {
      throw new Error("missing");
    }
  });

  assert.deepEqual(result, {});
});
