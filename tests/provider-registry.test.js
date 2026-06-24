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

test("getProcessingProviderStatus reports Apple Speech as unavailable system mode on Windows", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "appleSpeech",
    llmProvider: "embedded"
  });

  assert.equal(status.mode, "system");
  assert.equal(status.asr.ready, false);
  assert.equal(status.asr.blockedReason, "apple_speech_not_available_on_windows");
  assert.equal(status.recordingBlockedReason, "apple_speech_not_available_on_windows");
});

test("getProcessingProviderStatus allows configured custom cloud ASR", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "customOpenAiCompatible",
    cloudApiKey: "secret-key",
    llmProvider: "embedded"
  });

  assert.equal(status.mode, "cloud");
  assert.equal(status.asr.ready, true);
  assert.equal(status.readyToRecord, true);
});

test("getProcessingProviderStatus reports cloud mode for text-only cloud provider", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "localWhisper",
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin",
    llmProvider: "cloudflareWorkersAi"
  });

  assert.equal(status.mode, "cloud");
  assert.equal(status.asr.ready, true);
  assert.equal(status.text.provider, "cloudflareWorkersAi");
});

test("getProcessingProviderStatus explains missing embedded LLM setup", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "localWhisper",
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin",
    llmProvider: "embedded",
    embeddedLlmCliPath: "",
    embeddedLlmModelPath: ""
  });

  assert.equal(status.text.ready, false);
  assert.equal(status.text.blockedReason, "embedded_llm_not_configured");
});

test("getProcessingProviderStatus explains disabled Ollama setup", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "localWhisper",
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin",
    llmProvider: "ollama",
    ollamaEnabled: false
  });

  assert.equal(status.text.ready, false);
  assert.equal(status.text.blockedReason, "ollama_not_enabled");
});
