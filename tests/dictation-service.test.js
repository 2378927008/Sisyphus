import test from "node:test";
import assert from "node:assert/strict";
import { DictationService } from "../src/main/dictation-service.js";

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
  assert.equal(entry.detectedLanguage, "en");
  assert.equal(history.at(-1).pasted, "hello world");
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
  assert.match(finalEvent.message, /Install a language model/);
  assert.equal(history[0], entry);
  assert.equal(history[0].outputLanguage, "auto");
  assert.equal(history[0].detectedLanguage, "en");
  assert.equal(history[0].providerMode, "local");
  assert.equal(history[0].status, "partial");
  assert.equal(history[0].processingError, "Install a language model");
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
});

function fakeSettingsStore(history, overrides = {}) {
  return {
    async getSettings() {
      return {
        polishMode: "polish",
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
