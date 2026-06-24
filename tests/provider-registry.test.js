import test from "node:test";
import assert from "node:assert/strict";
import {
  getProcessingProviderStatus,
  normalizeAsrProvider,
  normalizeTextProvider
} from "../src/main/provider-registry.js";

test("normalizeAsrProvider defaults to localWhisper on Windows", () => {
  assert.equal(normalizeAsrProvider(""), "localWhisper");
  assert.equal(normalizeAsrProvider("localWhisper"), "localWhisper");
  assert.equal(normalizeAsrProvider("cloudflareWorkersAi"), "cloudflareWorkersAi");
  assert.equal(normalizeAsrProvider("unknown"), "localWhisper");
});

test("normalizeTextProvider keeps embedded and ollama providers", () => {
  assert.equal(normalizeTextProvider(""), "embedded");
  assert.equal(normalizeTextProvider("embedded"), "embedded");
  assert.equal(normalizeTextProvider("ollama"), "ollama");
  assert.equal(normalizeTextProvider("groq"), "groq");
  assert.equal(normalizeTextProvider("bad"), "embedded");
});

test("getProcessingProviderStatus reports local mode when Whisper is configured", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "localWhisper",
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin",
    llmProvider: "embedded",
    embeddedLlmCliPath: "C:/tools/llama-cli.exe",
    embeddedLlmModelPath: "C:/models/qwen.gguf"
  });

  assert.equal(status.mode, "local");
  assert.equal(status.asr.ready, true);
  assert.equal(status.text.ready, true);
  assert.equal(status.readyToRecord, true);
});

test("getProcessingProviderStatus explains missing local Whisper setup", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "localWhisper",
    whisperCliPath: "",
    whisperModelPath: "",
    llmProvider: "embedded"
  });

  assert.equal(status.mode, "local");
  assert.equal(status.asr.ready, false);
  assert.equal(status.readyToRecord, false);
  assert.equal(status.recordingBlockedReason, "whisper_not_configured");
});

test("getProcessingProviderStatus reports cloud providers as not configured in Phase 1", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "groq",
    cloudApiKey: "",
    llmProvider: "groq"
  });

  assert.equal(status.mode, "cloud");
  assert.equal(status.asr.ready, false);
  assert.equal(status.text.ready, false);
  assert.equal(status.recordingBlockedReason, "cloud_provider_not_configured");
});
