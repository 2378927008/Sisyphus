import { existsSync } from "node:fs";
import { isTargetOutputLanguage } from "../shared/languages.js";

const cloudProviders = new Set(["cloudflareWorkersAi", "groq", "customOpenAiCompatible"]);
const asrProviders = new Set(["localWhisper", "appleSpeech", ...cloudProviders]);
const freeCloudTextProviders = new Set(["mymemory"]);
const textProviders = new Set(["embedded", "ollama", ...freeCloudTextProviders, ...cloudProviders]);
const defaultTextProvider = "mymemory";

export function normalizeAsrProvider(value) {
  const provider = String(value || "").trim();
  return asrProviders.has(provider) ? provider : "localWhisper";
}

export function normalizeTextProvider(value) {
  const provider = String(value || "").trim();
  return textProviders.has(provider) ? provider : defaultTextProvider;
}

export function getProcessingProviderStatus(settings = {}) {
  const asrProvider = normalizeAsrProvider(settings.asrProvider);
  const textProvider = normalizeTextProvider(settings.llmProvider);
  const mode = getMode(asrProvider, textProvider, settings);
  const asr = getAsrStatus(asrProvider, settings);
  const text = getTextStatus(textProvider, settings);
  const textRequired = isTargetOutputLanguage(settings.outputLanguage);
  const textReady = !textRequired || Boolean(text.implemented && text.ready);
  const readyToRecord = Boolean(asr.implemented && asr.ready && textReady);

  return {
    mode,
    readyToRecord,
    recordingBlockedReason: getRecordingBlockedReason({ asr, text, textRequired, readyToRecord }),
    asr,
    text
  };
}

function getRecordingBlockedReason({ asr, text, textRequired, readyToRecord }) {
  if (readyToRecord) return "";
  if (!asr.implemented || !asr.ready) return asr.blockedReason || "provider_not_ready";
  if (textRequired && (!text.implemented || !text.ready)) return text.blockedReason || "provider_not_ready";
  return "provider_not_ready";
}

function getMode(asrProvider, textProvider, settings = {}) {
  if (asrProvider === "appleSpeech") return "system";
  if (isCloudProvider(asrProvider) || isCloudProvider(textProvider)) return "cloud";
  if (freeCloudTextProviders.has(textProvider) && isTargetOutputLanguage(settings.outputLanguage)) return "cloud";
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
    const cliPath = String(settings.embeddedLlmCliPath || "").trim();
    const modelPath = String(settings.embeddedLlmModelPath || "").trim();
    const configured = Boolean(cliPath && modelPath);
    const pathsReady = !isTargetOutputLanguage(settings.outputLanguage) || (fileExists(cliPath) && fileExists(modelPath));
    const ready = Boolean(configured && pathsReady);
    const blockedReason = getEmbeddedLlmBlockedReason({ configured, pathsReady });
    return {
      provider,
      label: "Built-in local language model",
      configured,
      implemented: true,
      ready,
      blockedReason
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

  if (provider === "mymemory") {
    return {
      provider,
      label: "MyMemory Free",
      configured: true,
      implemented: true,
      ready: true,
      blockedReason: ""
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

function fileExists(filePath) {
  try {
    return Boolean(filePath && existsSync(filePath));
  } catch {
    return false;
  }
}

function getEmbeddedLlmBlockedReason({ configured, pathsReady }) {
  if (!configured) return "embedded_llm_not_configured";
  if (!pathsReady) return "embedded_llm_paths_missing";
  return "";
}
