import test from "node:test";
import assert from "node:assert/strict";
import { DictationService } from "../src/main/dictation-service.js";

test("processTranscript expands an exact snippet without polishing", async () => {
  const history = [];
  const polishCalls = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, {
      snippets: [{ id: "s1", trigger: "meeting notes", text: "Meeting notes template" }]
    }),
    clipboard: {},
    transcribe: async () => "meeting notes",
    polish: async (...args) => {
      polishCalls.push(args);
      return "should not be used";
    },
    notifyStatus: () => {}
  });

  const result = await service.processTranscript("  meeting notes  ");

  assert.equal(result.transcript, "  meeting notes  ");
  assert.equal(result.text, "Meeting notes template");
  assert.equal(result.source, "snippet");
  assert.equal(result.snippetId, "s1");
  assert.equal(result.status, "complete");
  assert.equal(polishCalls.length, 0);
  assert.equal(history.length, 0);
});

test("processTranscript only expands complete normalized snippet matches", async () => {
  const history = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, {
      snippets: [{ id: "s1", trigger: "meeting notes", text: "Meeting notes template" }]
    }),
    clipboard: {},
    polish: async (transcript) => `cleaned: ${transcript}`,
    notifyStatus: () => {}
  });

  const result = await service.processTranscript("please create meeting notes");

  assert.equal(result.text, "cleaned: please create meeting notes");
  assert.equal(result.source, "dictation");
  assert.equal(result.snippetId, "");
});

test("processWav transcribes once and writes one snippet history entry", async () => {
  const history = [];
  let transcribeCalls = 0;
  let pasteCalls = 0;
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, {
      pasteAfterTranscribe: true,
      snippets: [{ id: "s1", trigger: "meeting notes", text: "Meeting notes template" }]
    }),
    clipboard: {},
    transcribe: async () => {
      transcribeCalls += 1;
      return "meeting notes";
    },
    polish: async () => {
      throw new Error("snippet should bypass polishing");
    },
    paste: async () => {
      pasteCalls += 1;
    },
    notifyStatus: () => {}
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(transcribeCalls, 1);
  assert.equal(history.length, 1);
  assert.equal(history[0], entry);
  assert.equal(entry.text, "Meeting notes template");
  assert.equal(entry.source, "snippet");
  assert.equal(entry.snippetId, "s1");
  assert.equal(pasteCalls, 1);
});

test("processWav saves polished result and pastes when enabled", async () => {
  const history = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, { pasteAfterTranscribe: true, historyLimit: 20 }),
    clipboard: {},
    transcribe: async () => "um hello world",
    polish: async () => "hello world",
    paste: async (text) => history.push({ pasted: text }),
    notifyStatus: () => {}
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(entry.text, "hello world");
  assert.equal(entry.transcript, "um hello world");
  assert.equal(entry.status, "complete");
  assert.equal(entry.pasteStatus, "complete");
  assert.equal(entry.pasteError, "");
  assert.equal(entry.detectedLanguage, "en");
  assert.equal(history[0], entry);
  assert.equal(history.at(-1).pasted, "hello world");
});

test("processWav saves complete text and warns when paste fails", async () => {
  const history = [];
  const events = [];
  const pasteError = new Error("Paste command exited with code 1.");
  pasteError.code = "paste_failed";
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, { pasteAfterTranscribe: true, historyLimit: 20 }),
    clipboard: {},
    transcribe: async () => "um hello world",
    polish: async () => "hello world",
    paste: async () => {
      throw pasteError;
    },
    notifyStatus: (event) => events.push(event)
  });

  const entry = await service.processWav(Buffer.from("wav"));
  const finalEvent = events.at(-1);

  assert.equal(entry.status, "complete");
  assert.equal(entry.text, "hello world");
  assert.equal(entry.pasteStatus, "failed");
  assert.match(entry.pasteError, /Paste command exited with code 1/);
  assert.equal(history[0], entry);
  assert.equal(finalEvent.phase, "warning");
  assert.equal(finalEvent.reason, "paste_failed");
  assert.match(finalEvent.message, /Text saved/);
});

test("processWav preserves raw transcript when text processing fails", async () => {
  const history = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, { pasteAfterTranscribe: true, historyLimit: 20 }),
    clipboard: {},
    transcribe: async () => "hello world",
    polish: async () => {
      throw new Error("Install a language model");
    },
    paste: async () => {
      throw new Error("paste should not run after partial processing");
    },
    notifyStatus: () => {}
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(entry.status, "partial");
  assert.equal(entry.text, "hello world");
  assert.equal(entry.processingError, "Install a language model");
  assert.equal(history[0].text, "hello world");
});

test("processWav keeps partial failure reason in final warning status", async () => {
  const history = [];
  const events = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, { pasteAfterTranscribe: true, historyLimit: 20 }),
    clipboard: {},
    transcribe: async () => "hello world",
    polish: async () => {
      throw "Install a language model";
    },
    paste: async () => {
      throw new Error("paste should not run after partial processing");
    },
    notifyStatus: (event) => events.push(event)
  });

  const entry = await service.processWav(Buffer.from("wav"));
  const finalEvent = events.at(-1);
  const warningEvents = events.filter((event) => event.phase === "warning");

  assert.equal(warningEvents.length, 1);
  assert.equal(finalEvent.phase, "warning");
  assert.equal(finalEvent.reason, "raw_transcript_saved");
  assert.match(finalEvent.message, /Install a language model/);
  assert.equal(history[0], entry);
  assert.equal(history[0].outputLanguage, "auto");
  assert.equal(history[0].detectedLanguage, "en");
  assert.equal(history[0].providerMode, "local");
  assert.equal(history[0].status, "partial");
  assert.equal(history[0].processingError, "Install a language model");
});

test("processWav does not expose raw transcript as output when target language processing fails", async () => {
  const history = [];
  const events = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, {
      outputLanguage: "zh-Hans",
      pasteAfterTranscribe: true,
      historyLimit: 20
    }),
    clipboard: {},
    transcribe: async () => "hello world",
    polish: async () => {
      throw new Error("Local language model exited with code 3221225477.");
    },
    paste: async () => {
      throw new Error("paste should not run when target output fails");
    },
    notifyStatus: (event) => events.push(event)
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(entry.status, "failed");
  assert.equal(entry.text, "");
  assert.equal(entry.transcript, "hello world");
  assert.equal(entry.outputLanguage, "zh-Hans");
  assert.equal(entry.processingError, "Local language model exited with code 3221225477.");
  assert.equal(history[0], entry);
  assert.equal(events.at(-1).phase, "error");
  assert.equal(events.at(-1).reason, "target_output_failed");
});

test("processWav stores detected language metadata for automatic output", async () => {
  const history = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, { outputLanguage: "auto" }),
    clipboard: {},
    transcribe: async () => "这是一个测试",
    polish: async (text) => text,
    notifyStatus: () => {}
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(entry.detectedLanguage, "zh");
  assert.equal(entry.outputLanguage, "auto");
  assert.equal(entry.pasteStatus, "skipped");
  assert.equal(entry.pasteError, "");
});

test("processWav blocks transcription when the selected ASR provider is not ready", async () => {
  const history = [];
  const events = [];
  let transcribeCalls = 0;
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, {
      asrProvider: "groq",
      cloudApiKey: "secret-key",
      pasteAfterTranscribe: true
    }),
    clipboard: {},
    transcribe: async () => {
      transcribeCalls += 1;
      return "this should not run";
    },
    polish: async (text) => text,
    paste: async () => {
      throw new Error("paste should not run when ASR is blocked");
    },
    notifyStatus: (event) => events.push(event)
  });

  await assert.rejects(
    service.processWav(Buffer.from("wav")),
    /cloud_asr_not_implemented/
  );

  assert.equal(transcribeCalls, 0);
  assert.equal(history.length, 0);
  assert.equal(events.at(-1).phase, "error");
});

test("processWav completes automatic same-language output when the selected text provider is not implemented", async () => {
  const history = [];
  const pasted = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, {
      whisperCliPath: "C:/tools/whisper-cli.exe",
      whisperModelPath: "C:/models/ggml-base.bin",
      llmProvider: "groq",
      cloudApiKey: "secret-key",
      pasteAfterTranscribe: true
    }),
    clipboard: {},
    transcribe: async () => "hello world",
    polish: async () => "hello world cleaned",
    paste: async (text) => pasted.push(text),
    notifyStatus: () => {}
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(entry.status, "complete");
  assert.equal(entry.text, "hello world cleaned");
  assert.equal(entry.processingError, "");
  assert.deepEqual(pasted, ["hello world cleaned"]);
  assert.equal(history[0], entry);
});

test("processWav completes automatic same-language output when the embedded text provider is not configured", async () => {
  const history = [];
  const pasted = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, {
      embeddedLlmCliPath: "",
      embeddedLlmModelPath: "",
      llmProvider: "embedded",
      pasteAfterTranscribe: true
    }),
    clipboard: {},
    transcribe: async () => "hello world",
    polish: async () => "hello world cleaned",
    paste: async (text) => pasted.push(text),
    notifyStatus: () => {}
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(entry.status, "complete");
  assert.equal(entry.text, "hello world cleaned");
  assert.equal(entry.processingError, "");
  assert.deepEqual(pasted, ["hello world cleaned"]);
  assert.equal(history[0], entry);
});

test("processWav blocks transcription when target output text provider is not ready", async () => {
  const history = [];
  const events = [];
  let transcribeCalls = 0;
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, {
      outputLanguage: "zh-Hans",
      embeddedLlmCliPath: "",
      embeddedLlmModelPath: "",
      llmProvider: "embedded",
      pasteAfterTranscribe: true
    }),
    clipboard: {},
    transcribe: async () => {
      transcribeCalls += 1;
      return "this should not run";
    },
    polish: async () => "this should not run",
    paste: async () => {
      throw new Error("paste should not run when target text provider is blocked");
    },
    notifyStatus: (event) => events.push(event)
  });

  await assert.rejects(
    service.processWav(Buffer.from("wav")),
    /embedded_llm_not_configured/
  );

  assert.equal(transcribeCalls, 0);
  assert.equal(history.length, 0);
  assert.equal(events.at(-1).phase, "error");
});

function fakeSettingsStore(history, overrides = {}) {
  return {
    async getSettings() {
      return {
        polishMode: "polish",
        whisperCliPath: "C:/tools/whisper-cli.exe",
        whisperModelPath: "C:/models/ggml-base.bin",
        embeddedLlmCliPath: "C:/tools/llama-cli.exe",
        embeddedLlmModelPath: "C:/models/qwen.gguf",
        outputLanguage: "auto",
        pasteAfterTranscribe: false,
        historyLimit: 20,
        ...overrides
      };
    },
    async addHistory(entry) {
      history.unshift(entry);
      return history;
    }
  };
}
