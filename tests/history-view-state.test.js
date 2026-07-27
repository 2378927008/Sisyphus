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

test("skips a newer complete entry without displayable text", () => {
  const selectionEntries = [
    {
      id: "complete-empty",
      text: "",
      transcript: "A transcript is retained for reprocessing but is not displayed as output.",
      createdAt: "2026-07-27T10:00:00+08:00",
      status: "complete"
    },
    {
      id: "complete-visible",
      text: "Visible output",
      transcript: "Visible output",
      createdAt: "2026-07-27T09:00:00+08:00",
      status: "complete"
    }
  ];

  assert.equal(resolveHistorySelection(selectionEntries, "missing"), "complete-visible");
});

test("skips a newer partial entry without displayable text", () => {
  const selectionEntries = [
    {
      id: "partial-empty",
      text: "   ",
      transcript: "The raw transcript is not the selected editor output.",
      createdAt: "2026-07-27T10:00:00+08:00",
      status: "partial"
    },
    {
      id: "partial-visible",
      text: "Partial visible output",
      transcript: "Partial visible output",
      createdAt: "2026-07-27T09:00:00+08:00",
      status: "partial"
    }
  ];

  assert.equal(resolveHistorySelection(selectionEntries, "missing"), "partial-visible");
});

test("sorts unordered groups and entries deterministically without mutating input", () => {
  const unordered = [
    { id: "unknown", text: "unknown", transcript: "", createdAt: "not-a-date", status: "failed" },
    { id: "older", text: "older", transcript: "", createdAt: "2026-07-20T12:00:00+08:00", status: "complete" },
    { id: "today-z", text: "early", transcript: "", createdAt: "2026-07-27T08:00:00+08:00", status: "complete" },
    { id: "yesterday", text: "yesterday", transcript: "", createdAt: "2026-07-26T12:00:00+08:00", status: "partial" },
    { id: "today-b", text: "tie b", transcript: "", createdAt: "2026-07-27T10:00:00+08:00", status: "complete" },
    { id: "newer-old", text: "newer old", transcript: "", createdAt: "2026-07-24T12:00:00+08:00", status: "complete" },
    { id: "today-a", text: "tie a", transcript: "", createdAt: "2026-07-27T10:00:00+08:00", status: "complete" }
  ];
  const snapshot = structuredClone(unordered);

  const groups = groupHistoryByDate(unordered, {
    now: new Date("2026-07-27T12:00:00+08:00")
  });

  assert.deepEqual(groups.map((group) => group.key), [
    "today",
    "yesterday",
    "2026-07-24",
    "2026-07-20",
    "unknown"
  ]);
  assert.deepEqual(groups[0].entries.map((entry) => entry.id), ["today-a", "today-b", "today-z"]);
  assert.deepEqual(unordered, snapshot);
});

test("uses caller-local midnight boundaries", () => {
  const now = new Date(2026, 6, 27, 0, 5, 0);
  const localToday = new Date(2026, 6, 27, 0, 1, 0).toISOString();
  const localYesterday = new Date(2026, 6, 26, 23, 59, 0).toISOString();

  const groups = groupHistoryByDate([
    { id: "before", createdAt: localYesterday, status: "complete", text: "before" },
    { id: "after", createdAt: localToday, status: "complete", text: "after" }
  ], { now });

  assert.deepEqual(groups.map((group) => group.key), ["today", "yesterday"]);
  assert.deepEqual(groups.map((group) => group.entries[0].id), ["after", "before"]);
});

test("keeps deterministic legacy ids when records are reordered", () => {
  const legacy = {
    createdAt: "2026-07-27T09:00:00+08:00",
    transcript: "original speech",
    text: "edited output",
    status: "partial"
  };
  const other = {
    createdAt: "2026-07-26T09:00:00+08:00",
    transcript: "another speech",
    text: "another output",
    status: "complete"
  };

  const firstId = normalizeHistoryEntries([legacy, other]).find((entry) => entry.text === "edited output").id;
  const reorderedId = normalizeHistoryEntries([other, legacy]).find((entry) => entry.text === "edited output").id;
  const duplicateIds = normalizeHistoryEntries([legacy, structuredClone(legacy)]).map((entry) => entry.id);
  const editedId = normalizeHistoryEntries([{
    ...legacy,
    text: "edited again",
    status: "complete"
  }])[0].id;

  assert.match(firstId, /^legacy-[a-f0-9]{8}$/);
  assert.equal(reorderedId, firstId);
  assert.equal(editedId, firstId);
  assert.equal(new Set(duplicateIds).size, 2);
  assert.deepEqual(duplicateIds, [firstId, `${firstId}-2`]);
});
