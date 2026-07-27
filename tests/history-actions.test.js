import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHistoryActions } from "../src/main/history-actions.js";
import { createSettingsStore } from "../src/main/settings-store.js";

test("updateText updates an existing history entry", async () => {
  const harness = createHarness();
  const actions = createHistoryActions(harness);

  const result = await actions.updateText("h1", "User edited text");

  assert.equal(result.ok, true);
  assert.equal(result.entry.text, "User edited text");
  assert.equal(harness.entries[0].text, "User edited text");
});

test("updateText returns not_found for an absent history entry", async () => {
  const actions = createHistoryActions(createHarness());

  assert.deepEqual(await actions.updateText("missing", "text"), { ok: false, reason: "not_found" });
});

test("reprocess uses the immutable transcript and does not paste", async () => {
  const harness = createHarness();
  const actions = createHistoryActions(harness);

  const result = await actions.reprocess("h1");

  assert.equal(harness.processCalls.length, 1);
  assert.equal(harness.processCalls[0], "original transcript");
  assert.equal(harness.pasteCalls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.entry.text, "reprocessed text");
  assert.equal(result.entry.transcript, "original transcript");
  assert.equal(result.entry.pasteStatus, "complete");
});

test("reprocess preserves current text when processing fails", async () => {
  const harness = createHarness({ processError: new Error("model unavailable") });
  const actions = createHistoryActions(harness);

  await assert.rejects(actions.reprocess("h1"), /model unavailable/);

  assert.equal(harness.entries[0].transcript, "original transcript");
  assert.equal(harness.entries[0].text, "User edited text");
  assert.equal(harness.entries[0].pasteStatus, "complete");
});

test("reprocess preserves current text when target processing returns failed", async () => {
  const harness = createHarness({
    processResult: {
      transcript: "original transcript",
      text: "",
      status: "failed",
      processingError: "target output unavailable",
      detectedLanguage: "en",
      providerMode: "local",
      source: "dictation",
      snippetId: ""
    }
  });
  const actions = createHistoryActions(harness);

  const result = await actions.reprocess("h1");

  assert.deepEqual(result, { ok: false, reason: "processing_failed" });
  assert.equal(harness.entries[0].text, "User edited text");
  assert.equal(harness.entries[0].status, "complete");
  assert.equal(harness.entries[0].processingError, "");
});

test("reprocess preserves current text when automatic processing returns partial", async () => {
  const harness = createHarness({
    processResult: {
      transcript: "original transcript",
      text: "original transcript",
      status: "partial",
      processingError: "text provider unavailable",
      detectedLanguage: "en",
      providerMode: "local",
      source: "dictation",
      snippetId: ""
    }
  });
  const actions = createHistoryActions(harness);

  const result = await actions.reprocess("h1");

  assert.deepEqual(result, { ok: false, reason: "processing_failed" });
  assert.equal(harness.entries[0].text, "User edited text");
  assert.equal(harness.entries[0].status, "complete");
  assert.equal(harness.entries[0].processingError, "");
});

test("reprocess returns stable reasons for missing entry or transcript", async () => {
  const missingActions = createHistoryActions(createHarness({ entries: [] }));
  await assert.rejects(missingActions.reprocess("missing"), /history_entry_not_found/);

  const transcriptMissingActions = createHistoryActions(createHarness({ transcript: "" }));
  await assert.rejects(transcriptMissingActions.reprocess("h1"), /history_transcript_not_found/);
});

test("reprocess does not overwrite text edited while processing is pending", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-history-race-"));
  let releaseProcessing;
  let markProcessingStarted;
  const processingStarted = new Promise((resolve) => {
    markProcessingStarted = resolve;
  });
  const processingRelease = new Promise((resolve) => {
    releaseProcessing = resolve;
  });

  try {
    const settingsStore = createSettingsStore(userDataPath);
    await settingsStore.addHistory({
      id: "h1",
      transcript: "original transcript",
      text: "initial text",
      status: "complete",
      processingError: ""
    });
    const actions = createHistoryActions({
      settingsStore,
      dictationService: {
        async processTranscript(transcript) {
          markProcessingStarted();
          await processingRelease;
          return {
            transcript,
            text: "background result",
            status: "complete",
            processingError: "",
            detectedLanguage: "en",
            providerMode: "local",
            source: "dictation",
            snippetId: ""
          };
        }
      }
    });

    const pendingReprocess = actions.reprocess("h1");
    await processingStarted;
    await actions.updateText("h1", "edited while processing");
    releaseProcessing();

    const result = await pendingReprocess;
    const persisted = await settingsStore.getHistoryEntry("h1");

    assert.deepEqual(result, { ok: false, reason: "history_changed" });
    assert.equal(persisted.text, "edited while processing");
    assert.equal(persisted.transcript, "original transcript");
  } finally {
    releaseProcessing?.();
    await rm(userDataPath, { recursive: true, force: true });
  }
});

function createHarness(options = {}) {
  const entries = options.entries || [{
    id: "h1",
    transcript: options.transcript ?? "original transcript",
    text: "User edited text",
    status: "complete",
    pasteStatus: "complete",
    processingError: ""
  }];
  const processCalls = [];
  const harness = {
    entries,
    processCalls,
    pasteCalls: 0,
    settingsStore: {
      async getHistoryEntry(id) {
        return entries.find((entry) => entry.id === id) || null;
      },
      async updateHistory(id, patch) {
        const index = entries.findIndex((entry) => entry.id === id);
        if (index < 0) return null;
        entries[index] = { ...entries[index], ...patch };
        return entries[index];
      }
    },
    dictationService: {
      async processTranscript(transcript) {
        processCalls.push(transcript);
        if (options.processError) throw options.processError;
        return options.processResult || {
          transcript,
          text: "reprocessed text",
          status: "complete",
          processingError: "",
          detectedLanguage: "en",
          providerMode: "local",
          source: "dictation",
          snippetId: ""
        };
      }
    }
  };
  return harness;
}
