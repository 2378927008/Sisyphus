import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryActions } from "../src/main/history-actions.js";

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

test("reprocess returns stable reasons for missing entry or transcript", async () => {
  const missingActions = createHistoryActions(createHarness({ entries: [] }));
  await assert.rejects(missingActions.reprocess("missing"), /history_entry_not_found/);

  const transcriptMissingActions = createHistoryActions(createHarness({ transcript: "" }));
  await assert.rejects(transcriptMissingActions.reprocess("h1"), /history_transcript_not_found/);
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
        return {
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
