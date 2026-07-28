import { detectLikelyLanguage } from "../shared/language-detection.js";
import { isTargetOutputLanguage } from "../shared/languages.js";
import { expandExactSnippet } from "../shared/personalization.js";
import { transcribeWithWhisper } from "./local-asr.js";
import { polishTranscript } from "./local-llm.js";
import { pasteText } from "./paste.js";
import { getProcessingProviderStatus } from "./provider-registry.js";

export class DictationService {
  constructor({
    settingsStore,
    clipboard,
    notifyStatus,
    transcribe = transcribeWithWhisper,
    polish = polishTranscript,
    paste = pasteText,
    providerStatus = getProcessingProviderStatus
  }) {
    this.settingsStore = settingsStore;
    this.clipboard = clipboard;
    this.notifyStatus = notifyStatus || (() => {});
    this.transcribe = transcribe;
    this.polish = polish;
    this.paste = paste;
    this.providerStatus = providerStatus;
  }

  async processWav(wavBuffer) {
    const settings = await this.settingsStore.getSettings({ includeSecrets: true });
    const providers = this.providerStatus(settings);

    if (!providers.readyToRecord) {
      const reason = providers.recordingBlockedReason || "provider_not_ready";
      this.notifyStatus({ phase: "error", message: reason });
      throw new Error(reason);
    }

    this.notifyStatus({ phase: "transcribing", message: "Transcribing speech..." });
    const transcript = await this.transcribe(wavBuffer, settings);
    const processing = await this.processTranscript(transcript, {
      settings,
      providers,
      onPolishing: () => this.notifyStatus({ phase: "polishing", message: "Cleaning up dictation..." })
    });

    const entry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...processing,
      mode: settings.polishMode,
      outputLanguage: settings.outputLanguage,
      pasteStatus: settings.pasteAfterTranscribe ? "pending" : "skipped",
      pasteError: ""
    };

    if (settings.pasteAfterTranscribe && entry.status === "complete") {
      this.notifyStatus({ phase: "pasting", message: "Pasting into the active app..." });
      try {
        await this.paste(entry.text, { clipboard: this.clipboard });
        entry.pasteStatus = "complete";
      } catch (error) {
        entry.pasteStatus = "failed";
        entry.pasteError = getStableReason(error, "paste_failed");
        await this.settingsStore.addHistory(entry, settings.historyLimit);
        this.notifyStatus({
          phase: "warning",
          reason: entry.pasteError,
          message: "Paste failed. Text saved."
        });
        return entry;
      }
    } else if (settings.pasteAfterTranscribe) {
      entry.pasteStatus = "skipped";
    }

    await this.settingsStore.addHistory(entry, settings.historyLimit);

    const finalReason = getFinalReason(entry.status);
    this.notifyStatus({
      phase: getFinalPhase(entry.status),
      ...(finalReason ? { reason: finalReason } : {}),
      message: getFinalMessage(entry.status)
    });
    return entry;
  }

  async processTranscript(transcript, { settings, providers, onPolishing } = {}) {
    const effectiveSettings = settings || await this.settingsStore.getSettings({ includeSecrets: true });
    const effectiveProviders = providers || this.providerStatus(effectiveSettings);
    const snippet = expandExactSnippet(transcript, effectiveSettings.snippets);
    const detectedLanguage = detectLikelyLanguage(transcript);

    if (snippet.matched) {
      return {
        transcript,
        text: snippet.text,
        status: "complete",
        processingError: "",
        detectedLanguage,
        providerMode: effectiveProviders.mode,
        source: "snippet",
        snippetId: snippet.snippetId
      };
    }

    let text = String(transcript ?? "").trim();
    let status = "complete";
    let processingError = "";

    onPolishing?.();
    try {
      if (isTargetOutputLanguage(effectiveSettings.outputLanguage)) {
        assertTextProviderCanProcess(effectiveProviders);
      }
      text = await this.polish(transcript, effectiveSettings);
    } catch (error) {
      status = isTargetOutputLanguage(effectiveSettings.outputLanguage) ? "failed" : "partial";
      if (status === "failed") {
        text = "";
      }
      processingError = getStableReason(error, "text_processing_failed");
    }

    return {
      transcript,
      text,
      status,
      processingError,
      detectedLanguage,
      providerMode: effectiveProviders.mode,
      source: "dictation",
      snippetId: ""
    };
  }
}

function getFinalPhase(status) {
  if (status === "complete") return "done";
  if (status === "failed") return "error";
  return "warning";
}

function getFinalMessage(status) {
  if (status === "complete") return "Dictation complete.";
  if (status === "failed") return "Target language output failed.";
  return "Raw transcript saved.";
}

function getFinalReason(status) {
  if (status === "failed") return "target_output_failed";
  if (status === "partial") return "raw_transcript_saved";
  return "";
}

function getStableReason(error, fallback) {
  for (const candidate of [error?.code, error?.message, error]) {
    const reason = typeof candidate === "string" ? candidate.trim() : "";
    if (/^[a-z][a-z0-9_]{2,63}$/.test(reason)) {
      return reason;
    }
  }
  return fallback;
}

function assertTextProviderCanProcess(providers = {}) {
  const textProvider = providers.text;
  if (!textProvider) return;

  if (!textProvider.implemented || !textProvider.ready) {
    throw new Error(textProvider.blockedReason || "text_provider_not_ready");
  }
}
