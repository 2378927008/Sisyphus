import test from "node:test";
import assert from "node:assert/strict";
import { validateWhisperSetup } from "../src/main/whisper-diagnostics.js";

test("validateWhisperSetup reports missing configuration", async () => {
  const result = await validateWhisperSetup({});

  assert.equal(result.ready, false);
  assert.deepEqual(result.checks.map((check) => [check.id, check.status]), [
    ["whisperCliPath", "fail"],
    ["whisperModelPath", "fail"],
    ["whisperRunnable", "skip"]
  ]);
});

test("validateWhisperSetup passes when executable, model, and help command work", async () => {
  const result = await validateWhisperSetup(
    {
      whisperCliPath: "C:/tools/whisper-cli.exe",
      whisperModelPath: "C:/models/ggml-base.bin"
    },
    {
      stat: async () => ({ isFile: () => true }),
      run: async () => ({ code: 0, stdout: "usage: whisper-cli", stderr: "" })
    }
  );

  assert.equal(result.ready, true);
  assert.deepEqual(result.checks.map((check) => [check.id, check.status]), [
    ["whisperCliPath", "pass"],
    ["whisperModelPath", "pass"],
    ["whisperRunnable", "pass"]
  ]);
});

test("validateWhisperSetup reports missing model before running the executable", async () => {
  const seen = [];
  const result = await validateWhisperSetup(
    {
      whisperCliPath: "C:/tools/whisper-cli.exe",
      whisperModelPath: "C:/models/ggml-base.bin"
    },
    {
      stat: async (filePath) => {
        seen.push(filePath);
        if (filePath.endsWith("ggml-base.bin")) {
          throw new Error("missing");
        }
        return { isFile: () => true };
      },
      run: async () => {
        throw new Error("should not run");
      }
    }
  );

  assert.equal(result.ready, false);
  assert.equal(result.checks.find((check) => check.id === "whisperModelPath").status, "fail");
  assert.equal(result.checks.find((check) => check.id === "whisperRunnable").status, "skip");
  assert.deepEqual(seen, ["C:/tools/whisper-cli.exe", "C:/models/ggml-base.bin"]);
});
