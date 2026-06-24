import { transcribeWithWhisper } from "./local-asr.js";
import { polishTranscript } from "./local-llm.js";
import { pasteText } from "./paste.js";

export class DictationService {
  constructor({ settingsStore, clipboard, notifyStatus }) {
    this.settingsStore = settingsStore;
    this.clipboard = clipboard;
    this.notifyStatus = notifyStatus || (() => {});
  }

  async processWav(wavBuffer) {
    const settings = await this.settingsStore.getSettings();

    this.notifyStatus({ phase: "transcribing", message: "Transcribing locally with Whisper..." });
    const transcript = await transcribeWithWhisper(wavBuffer, settings);

    this.notifyStatus({ phase: "polishing", message: "Cleaning up dictation..." });
    const polished = await polishTranscript(transcript, settings);

    const entry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      transcript,
      text: polished,
      mode: settings.polishMode
    };

    await this.settingsStore.addHistory(entry, settings.historyLimit);

    if (settings.pasteAfterTranscribe) {
      this.notifyStatus({ phase: "pasting", message: "Pasting into the active app..." });
      await pasteText(polished, { clipboard: this.clipboard });
    }

    this.notifyStatus({ phase: "done", message: "Dictation complete." });
    return entry;
  }
}
