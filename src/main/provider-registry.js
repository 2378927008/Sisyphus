const cloudProviders = new Set(["cloudflareWorkersAi", "groq", "customOpenAiCompatible"]);
const asrProviders = new Set(["localWhisper", "appleSpeech", ...cloudProviders]);
const textProviders = new Set(["embedded", "ollama", ...cloudProviders]);

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
  const readyToRecord = Boolean(asr.implemented && asr.ready);

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
    const configured = Boolean(String(settings.whisperCliPath || "").trim() && String(settings.whisperModelPath || "").trim());
    return {
      provider,
      label: "Local whisper.cpp",
      configured,
      implemented: true,
      ready: configured,
      blockedReason: configured ? "" : "whisper_not_configured"
    };
  }

  if (provider === "appleSpeech") {
    return {
      provider,
      label: "Apple Speech",
      configured: false,
      implemented: false,
      ready: false,
      blockedReason: "apple_speech_not_available_on_windows"
    };
  }

  return getCloudStatus(provider, settings, "asr");
}

function getTextStatus(provider, settings) {
  if (provider === "embedded") {
    const configured = Boolean(String(settings.embeddedLlmCliPath || "").trim() && String(settings.embeddedLlmModelPath || "").trim());
    return {
      provider,
      label: "Built-in local language model",
      configured,
      implemented: true,
      ready: configured,
      blockedReason: configured ? "" : "embedded_llm_not_configured"
    };
  }

  if (provider === "ollama") {
    const configured = Boolean(settings.ollamaEnabled);
    return {
      provider,
      label: "Ollama",
      configured,
      implemented: true,
      ready: configured,
      blockedReason: configured ? "" : "ollama_not_enabled"
    };
  }

  return getCloudStatus(provider, settings, "text");
}

function getCloudStatus(provider, settings, type) {
  const configured = hasCloudProviderConfig(provider, settings);
  const blockedReason = configured
    ? type === "asr"
      ? "cloud_asr_not_implemented"
      : "cloud_text_not_implemented"
    : "cloud_provider_not_configured";

  return {
    provider,
    label: provider,
    configured,
    implemented: false,
    ready: false,
    blockedReason
  };
}

function hasCloudProviderConfig(provider, settings) {
  if (provider === "customOpenAiCompatible") {
    return hasValue(settings.cloudApiBaseUrl) && hasValue(settings.cloudApiKey);
  }

  return hasValue(settings.cloudApiKey);
}

function isCloudProvider(provider) {
  return cloudProviders.has(provider);
}

function hasValue(value) {
  return Boolean(String(value || "").trim());
}
