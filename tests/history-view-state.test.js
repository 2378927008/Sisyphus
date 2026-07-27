import test from "node:test";
import assert from "node:assert/strict";

import {
  filterHistory,
  groupHistoryByDate,
  normalizeHistoryEntries,
  resolveHistorySelection
} from "../src/renderer/history-view-state.js";

const entries = [
  {
    id: "h1",
    text: "Today's note",
    transcript: "Today's note",
    createdAt: "2026-07-27T09:30:00+08:00",
    status: "complete"
  },
  {
    id: "h2",
    text: "Ready",
    transcript: "Use QWEN for this task",
    createdAt: "2026-07-26T18:30:00+08:00",
    status: "partial"
  },
  {
    id: "h3",
    text: "",
    transcript: "",
    createdAt: "2026-07-20T08:00:00+08:00",
    status: "failed"
  }
];

test("groups today, yesterday, and older records without dropping failures", () => {
  const groups = groupHistoryByDate(entries, {
    now: new Date("2026-07-27T12:00:00+08:00")
  });

  assert.deepEqual(groups.map((group) => group.key), ["today", "yesterday", "2026-07-20"]);
  assert.equal(groups.flatMap((group) => group.entries).some((entry) => entry.status === "failed"), true);
});

test("search is case-insensitive and reads transcript plus displayed text", () => {
  assert.deepEqual(filterHistory(entries, "  qWeN ").map((entry) => entry.id), ["h2"]);
});

test("normalizes entries without mutating their display text or dropping partial rows", () => {
  const rawEntries = [
    { id: "full", text: "Ｆｕｌｌ", transcript: "Source", createdAt: "2026-07-27T09:00:00+08:00", status: "complete" },
    { id: "partial", text: "", transcript: "Still available", createdAt: "2026-07-27T08:00:00+08:00", status: "partial" }
  ];

  const normalized = normalizeHistoryEntries(rawEntries);

  assert.equal(normalized[0].text, "Ｆｕｌｌ");
  assert.equal(normalized[0].characterCount, 4);
  assert.match(normalized[0].searchableText, /full/);
  assert.equal(normalized[1].status, "partial");
  assert.deepEqual(rawEntries[1], { id: "partial", text: "", transcript: "Still available", createdAt: "2026-07-27T08:00:00+08:00", status: "partial" });
});

test("keeps a valid selection and otherwise chooses the newest usable result", () => {
  const selectionEntries = [
    { id: "failed", text: "", transcript: "", createdAt: "2026-07-27T10:00:00+08:00", status: "failed" },
    { id: "old", text: "old", transcript: "old", createdAt: "2026-07-26T10:00:00+08:00", status: "complete" },
    { id: "new", text: "new", transcript: "new", createdAt: "2026-07-27T09:00:00+08:00", status: "partial" }
  ];

  assert.equal(resolveHistorySelection(selectionEntries, "old"), "old");
  assert.equal(resolveHistorySelection(selectionEntries, "missing"), "new");
  assert.equal(resolveHistorySelection([{ id: "failed", status: "failed" }], "missing"), "failed");
  assert.equal(resolveHistorySelection([], "missing"), "");
});
