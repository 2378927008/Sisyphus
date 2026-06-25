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
  assert.equal(normalizeTextProvider("mymemory"), "mymemory");
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

test("getProcessingProviderStatus keeps configured custom cloud ASR disabled until implemented", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "customOpenAiCompatible",
    cloudApiBaseUrl: "https://api.example.test/v1",
    cloudApiKey: "secret-key",
    llmProvider: "embedded"
  });

  assert.equal(status.mode, "cloud");
  assert.equal(status.asr.configured, true);
  assert.equal(status.asr.implemented, false);
  assert.equal(status.asr.ready, false);
  assert.equal(status.asr.blockedReason, "cloud_asr_not_implemented");
  assert.equal(status.readyToRecord, false);
  assert.equal(status.recordingBlockedReason, "cloud_asr_not_implemented");
});

test("getProcessingProviderStatus requires base URL and key for custom cloud ASR", () => {
  for (const settings of [
    { cloudApiKey: "secret-key" },
    { cloudApiBaseUrl: "https://api.example.test/v1" }
  ]) {
    const status = getProcessingProviderStatus({
      asrProvider: "customOpenAiCompatible",
      llmProvider: "embedded",
      ...settings
    });

    assert.equal(status.mode, "cloud");
    assert.equal(status.asr.configured, false);
    assert.equal(status.asr.implemented, false);
    assert.equal(status.asr.ready, false);
    assert.equal(status.asr.blockedReason, "cloud_provider_not_configured");
    assert.equal(status.readyToRecord, false);
    assert.equal(status.recordingBlockedReason, "cloud_provider_not_configured");
  }
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

const asrProviderCases = [
  {
    provider: "localWhisper",
    settings: {
      whisperCliPath: "C:/tools/whisper-cli.exe",
      whisperModelPath: "C:/models/ggml-base.bin"
    },
    mode: "local",
    configured: true,
    implemented: true,
    ready: true,
    blockedReason: "",
    readyToRecord: true
  },
  {
    provider: "appleSpeech",
    settings: {},
    mode: "system",
    configured: false,
    implemented: false,
    ready: false,
    blockedReason: "apple_speech_not_available_on_windows",
    readyToRecord: false
  },
  {
    provider: "cloudflareWorkersAi",
    settings: { cloudApiKey: "secret-key" },
    mode: "cloud",
    configured: true,
    implemented: false,
    ready: false,
    blockedReason: "cloud_asr_not_implemented",
    readyToRecord: false
  },
  {
    provider: "groq",
    settings: { cloudApiKey: "secret-key" },
    mode: "cloud",
    configured: true,
    implemented: false,
    ready: false,
    blockedReason: "cloud_asr_not_implemented",
    readyToRecord: false
  },
  {
    provider: "customOpenAiCompatible",
    settings: {
      cloudApiBaseUrl: "https://api.example.test/v1",
      cloudApiKey: "secret-key"
    },
    mode: "cloud",
    configured: true,
    implemented: false,
    ready: false,
    blockedReason: "cloud_asr_not_implemented",
    readyToRecord: false
  }
];

for (const expected of asrProviderCases) {
  test(`getProcessingProviderStatus reports ASR provider state for ${expected.provider}`, () => {
    const status = getProcessingProviderStatus({
      asrProvider: expected.provider,
      llmProvider: "embedded",
      ...expected.settings
    });

    assert.equal(status.mode, expected.mode);
    assert.equal(status.asr.provider, expected.provider);
    assert.equal(status.asr.configured, expected.configured);
    assert.equal(status.asr.implemented, expected.implemented);
    assert.equal(status.asr.ready, expected.ready);
    assert.equal(status.asr.blockedReason, expected.blockedReason);
    assert.equal(status.readyToRecord, expected.readyToRecord);
  });
}

const textProviderCases = [
  {
    provider: "embedded",
    settings: {
      embeddedLlmCliPath: "C:/tools/llama-cli.exe",
      embeddedLlmModelPath: "C:/models/qwen.gguf"
    },
    mode: "local",
    configured: true,
    implemented: true,
    ready: true,
    blockedReason: ""
  },
  {
    provider: "ollama",
    settings: { ollamaEnabled: true },
    mode: "local",
    configured: true,
    implemented: true,
    ready: true,
    blockedReason: ""
  },
  {
    provider: "mymemory",
    settings: {},
    mode: "cloud",
    configured: true,
    implemented: true,
    ready: true,
    blockedReason: ""
  },
  {
    provider: "cloudflareWorkersAi",
    settings: { cloudApiKey: "secret-key" },
    mode: "cloud",
    configured: true,
    implemented: false,
    ready: false,
    blockedReason: "cloud_text_not_implemented"
  },
  {
    provider: "groq",
    settings: { cloudApiKey: "secret-key" },
    mode: "cloud",
    configured: true,
    implemented: false,
    ready: false,
    blockedReason: "cloud_text_not_implemented"
  },
  {
    provider: "customOpenAiCompatible",
    settings: {
      cloudApiBaseUrl: "https://api.example.test/v1",
      cloudApiKey: "secret-key"
    },
    mode: "cloud",
    configured: true,
    implemented: false,
    ready: false,
    blockedReason: "cloud_text_not_implemented"
  }
];

for (const expected of textProviderCases) {
  test(`getProcessingProviderStatus reports text provider state for ${expected.provider}`, () => {
    const status = getProcessingProviderStatus({
      asrProvider: "localWhisper",
      whisperCliPath: "C:/tools/whisper-cli.exe",
      whisperModelPath: "C:/models/ggml-base.bin",
      llmProvider: expected.provider,
      ...expected.settings
    });

    assert.equal(status.mode, expected.mode);
    assert.equal(status.text.provider, expected.provider);
    assert.equal(status.text.configured, expected.configured);
    assert.equal(status.text.implemented, expected.implemented);
    assert.equal(status.text.ready, expected.ready);
    assert.equal(status.text.blockedReason, expected.blockedReason);
    assert.equal(status.readyToRecord, true);
  });
}

test("getProcessingProviderStatus reports configured cloud text as not implemented", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "localWhisper",
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin",
    llmProvider: "groq",
    cloudApiKey: "secret-key"
  });

  assert.equal(status.mode, "cloud");
  assert.equal(status.text.configured, true);
  assert.equal(status.text.implemented, false);
  assert.equal(status.text.ready, false);
  assert.equal(status.text.blockedReason, "cloud_text_not_implemented");
});

test("getProcessingProviderStatus requires base URL and key for custom cloud text", () => {
  for (const settings of [
    { cloudApiKey: "secret-key" },
    { cloudApiBaseUrl: "https://api.example.test/v1" }
  ]) {
    const status = getProcessingProviderStatus({
      asrProvider: "localWhisper",
      whisperCliPath: "C:/tools/whisper-cli.exe",
      whisperModelPath: "C:/models/ggml-base.bin",
      llmProvider: "customOpenAiCompatible",
      ...settings
    });

    assert.equal(status.mode, "cloud");
    assert.equal(status.text.configured, false);
    assert.equal(status.text.implemented, false);
    assert.equal(status.text.ready, false);
    assert.equal(status.text.blockedReason, "cloud_provider_not_configured");
    assert.equal(status.readyToRecord, true);
  }
});

test("getProcessingProviderStatus reports configured custom cloud text as not implemented", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "localWhisper",
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin",
    llmProvider: "customOpenAiCompatible",
    cloudApiBaseUrl: "https://api.example.test/v1",
    cloudApiKey: "secret-key"
  });

  assert.equal(status.mode, "cloud");
  assert.equal(status.text.configured, true);
  assert.equal(status.text.implemented, false);
  assert.equal(status.text.ready, false);
  assert.equal(status.text.blockedReason, "cloud_text_not_implemented");
});
