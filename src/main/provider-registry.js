const asrProviders = new Set(["localWhisper", "appleSpeech", "cloudflareWorkersAi", "groq", "customOpenAiCompatible"]);
const textProviders = new Set(["embedded", "ollama", "cloudflareWorkersAi", "groq", "customOpenAiCompatible"]);

export function normalizeAsrProvider(value) {
  const provider = String(value || "").trim();
  return asrProviders.has(provider) ? provider : "localWhisper";
}

export function normalizeTextProvider(value) {
  const provider = String(value || "").trim();
  return textProviders.has(provider) ? provider : "embedded";
}

export function getProcessingProviderStatus(settings = {}) {
  const asrProvider = normalizeAsrProvider(settings.asrProvider);
  const textProvider = normalizeTextProvider(settings.llmProvider);
  const mode = getMode(asrProvider, textProvider);
  const asr = getAsrStatus(asrProvider, settings);
  const text = getTextStatus(textProvider, settings);
  const readyToRecord = Boolean(asr.ready);

  return {
    mode,
    readyToRecord,
    recordingBlockedReason: readyToRecord ? "" : asr.blockedReason,
    asr,
    text
  };
}

function getMode(asrProvider, textProvider) {
  if (asrProvider === "appleSpeech") return "system";
  if (isCloudProvider(asrProvider) || isCloudProvider(textProvider)) return "cloud";
  return "local";
}

function getAsrStatus(provider, settings) {
  if (provider === "localWhisper") {
    const ready = Boolean(String(settings.whisperCliPath || "").trim() && String(settings.whisperModelPath || "").trim());
    return {
      provider,
      label: "Local whisper.cpp",
      ready,
      blockedReason: ready ? "" : "whisper_not_configured"
    };
  }

  if (provider === "appleSpeech") {
    return {
      provider,
      label: "Apple Speech",
      ready: false,
      blockedReason: "apple_speech_not_available_on_windows"
    };
  }

  return getCloudStatus(provider, settings);
}

function getTextStatus(provider, settings) {
  if (provider === "embedded") {
    const ready = Boolean(String(settings.embeddedLlmCliPath || "").trim() && String(settings.embeddedLlmModelPath || "").trim());
    return {
      provider,
      label: "Built-in local language model",
      ready,
      blockedReason: ready ? "" : "embedded_llm_not_configured"
    };
  }

  if (provider === "ollama") {
    const ready = Boolean(settings.ollamaEnabled);
    return {
      provider,
      label: "Ollama",
      ready,
      blockedReason: ready ? "" : "ollama_not_enabled"
    };
  }

  return getCloudStatus(provider, settings);
}

function getCloudStatus(provider, settings) {
  const ready = Boolean(String(settings.cloudApiKey || "").trim());
  return {
    provider,
    label: provider,
    ready,
    blockedReason: ready ? "" : "cloud_provider_not_configured"
  };
}

function isCloudProvider(provider) {
  return ["cloudflareWorkersAi", "groq", "customOpenAiCompatible"].includes(provider);
}
