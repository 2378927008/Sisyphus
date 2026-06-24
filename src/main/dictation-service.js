import { detectLikelyLanguage } from "../shared/language-detection.js";
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
    const settings = await this.settingsStore.getSettings();
    const providers = this.providerStatus(settings);

    this.notifyStatus({ phase: "transcribing", message: "Transcribing speech..." });
    const transcript = await this.transcribe(wavBuffer, settings);
    const detectedLanguage = detectLikelyLanguage(transcript);

    let text = transcript.trim();
    let status = "complete";
    let processingError = "";

    try {
      this.notifyStatus({ phase: "polishing", message: "Cleaning up dictation..." });
      text = await this.polish(transcript, settings);
    } catch (error) {
      status = "partial";
      processingError = error instanceof Error ? error.message : String(error);
    }

    const entry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      transcript,
      text,
      mode: settings.polishMode,
      outputLanguage: settings.outputLanguage,
      detectedLanguage,
      providerMode: providers.mode,
      status,
      processingError
    };

    await this.settingsStore.addHistory(entry, settings.historyLimit);

    if (settings.pasteAfterTranscribe && status === "complete") {
      this.notifyStatus({ phase: "pasting", message: "Pasting into the active app..." });
      await this.paste(text, { clipboard: this.clipboard });
    }

    this.notifyStatus({
      phase: status === "complete" ? "done" : "warning",
      message: status === "complete" ? "Dictation complete." : `Raw transcript saved. ${processingError}`
    });
    return entry;
  }
}
