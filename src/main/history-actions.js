const PROCESSING_FIELDS = [
  "text",
  "status",
  "processingError",
  "detectedLanguage",
  "providerMode",
  "source",
  "snippetId"
];

export function createHistoryActions({ settingsStore, dictationService }) {
  return {
    async updateText(id, text) {
      const entry = await settingsStore.updateHistory(id, { text });
      return entry ? { ok: true, entry } : { ok: false, reason: "not_found" };
    },

    async reprocess(id) {
      const entry = await settingsStore.getHistoryEntry(id);
      if (!entry) {
        throw new Error("history_entry_not_found");
      }
      if (!String(entry.transcript ?? "").trim()) {
        throw new Error("history_transcript_not_found");
      }

      const processed = await dictationService.processTranscript(entry.transcript);
      if (processed?.status !== "complete") {
        return { ok: false, reason: "processing_failed" };
      }
      const patch = Object.fromEntries(
        PROCESSING_FIELDS
          .filter((field) => Object.hasOwn(processed, field))
          .map((field) => [field, processed[field]])
      );
      const updated = await settingsStore.updateHistory(id, patch, {
        expectedUpdatedAt: entry.updatedAt,
        expectedText: entry.text
      });
      if (updated?.ok === false && updated.reason === "history_changed") {
        return updated;
      }
      if (!updated) {
        throw new Error("history_entry_not_found");
      }
      return { ok: true, entry: updated };
    }
  };
}
