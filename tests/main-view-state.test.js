import test from "node:test";
import assert from "node:assert/strict";

import {
  createEditorState,
  replaceEditorText,
  restoreEditorText,
  projectHistory,
  normalizeViewPhase
} from "../src/renderer/main-view-state.js";
import { normalizeHistoryEntries } from "../src/renderer/history-view-state.js";

test("creates an empty editor state", () => {
  const state = createEditorState();

  assert.equal(state.currentText, "");
  assert.deepEqual(state, {
    baselineText: "",
    currentText: "",
    characterCount: 0,
    dirty: false,
    empty: true
  });
});

test("uses generated text as the baseline and tracks user edits", () => {
  const generated = replaceEditorText(createEditorState(), "第一段听写", { asBaseline: true });
  const edited = replaceEditorText(generated, "第一段已编辑");

  assert.equal(generated.baselineText, "第一段听写");
  assert.equal(generated.currentText, "第一段听写");
  assert.equal(generated.dirty, false);
  assert.equal(edited.baselineText, "第一段听写");
  assert.equal(edited.currentText, "第一段已编辑");
  assert.equal(edited.characterCount, Array.from("第一段已编辑").length);
  assert.equal(edited.dirty, true);
  assert.equal(edited.empty, false);
});

test("restores the current editor state to its baseline", () => {
  const generated = replaceEditorText(createEditorState(), "第一段听写", { asBaseline: true });
  const edited = replaceEditorText(generated, "第一段已编辑");

  assert.deepEqual(restoreEditorText(edited), generated);
});

test("loads history text as a new editor baseline", () => {
  const state = replaceEditorText(createEditorState(), "旧记录", { asBaseline: true });

  assert.deepEqual(restoreEditorText(replaceEditorText(state, "当前编辑")), state);
  assert.deepEqual(replaceEditorText(createEditorState(), "历史文本", { asBaseline: true }), {
    baselineText: "历史文本",
    currentText: "历史文本",
    characterCount: Array.from("历史文本").length,
    dirty: false,
    empty: false
  });
});

test("projects the two most recent usable history entries in input order", () => {
  const entries = [
    { createdAt: "2026-07-11T03:00:00.000Z", status: "complete", text: "三" },
    { createdAt: "2026-07-11T02:00:00.000Z", status: "failed", text: "" },
    { createdAt: "2026-07-11T01:00:00.000Z", status: "complete", text: "一" },
    { id: "saved", createdAt: "2026-07-11T00:00:00.000Z", status: "complete", text: "零" }
  ];

  const projected = projectHistory(entries, 2);

  assert.deepEqual(projected.map((entry) => entry.text), ["三", "一"]);
  assert.deepEqual(projected.map((entry) => entry.characterCount), [1, 1]);
  for (const id of projected.map((entry) => entry.id)) {
    assert.match(id, /^legacy-[a-f0-9]{8}$/);
  }
  assert.notEqual(projected[0].id, projected[1].id);
});

test("projects exactly the first three usable history entries without mutating input", () => {
  const entries = [
    { createdAt: "2026-07-11T04:00:00.000Z", status: "complete", text: "四" },
    { createdAt: "2026-07-11T03:00:00.000Z", status: "complete", text: "三" },
    { createdAt: "2026-07-11T02:00:00.000Z", status: "failed", text: "无效" },
    { createdAt: "2026-07-11T01:00:00.000Z", status: "complete", text: "二" },
    { createdAt: "2026-07-11T00:00:00.000Z", status: "complete", text: "一" }
  ];
  const originalEntries = structuredClone(entries);

  const projected = projectHistory(entries, 3);

  assert.equal(projected.length, 3);
  assert.deepEqual(projected.map((entry) => entry.text), ["四", "三", "二"]);
  assert.deepEqual(entries, originalEntries);
  for (const [projectedIndex, sourceIndex] of [0, 1, 3].entries()) {
    assert.notStrictEqual(projected[projectedIndex], entries[sourceIndex]);
  }
});

test("filters unusable history entries and preserves supplied non-empty ids", () => {
  const entries = [
    { id: "kept", createdAt: "today", status: "complete", text: "文本" },
    { id: "", createdAt: "later", status: "complete", text: "" },
    { createdAt: "failed", status: "failed", text: "失败" },
    null,
    { status: "complete", text: 42 }
  ];

  assert.deepEqual(projectHistory(entries, 10), [
    { id: "kept", createdAt: "today", status: "complete", text: "文本", characterCount: 2 }
  ]);
});

test("normalizes known view phases and falls back to idle", () => {
  for (const phase of ["idle", "starting", "recording", "stopping", "transcribing", "pasting", "done", "warning", "error"]) {
    assert.equal(normalizeViewPhase(phase), phase);
  }
  assert.equal(normalizeViewPhase("unexpected"), "idle");
  assert.equal(normalizeViewPhase(null), "idle");
});

test("maps polishing work onto the transcribing view phase", () => {
  assert.equal(normalizeViewPhase("polishing"), "transcribing");
});

test("handles invalid inputs without throwing and normalizes the limit", () => {
  assert.deepEqual(createEditorState(null), {
    baselineText: "",
    currentText: "",
    characterCount: 0,
    dirty: false,
    empty: true
  });
  assert.equal(replaceEditorText(null, null).currentText, "");
  assert.equal(restoreEditorText(null).currentText, "");
  assert.deepEqual(projectHistory("not history", -2), []);
  assert.deepEqual(projectHistory([{ status: "complete", text: "a" }], 1.9).length, 1);
});

test("keeps full history normalization in the browser-safe history view module", () => {
  const [entry] = normalizeHistoryEntries([
    { id: "partial", status: "partial", text: "draft", transcript: "draft" }
  ]);

  assert.equal(entry.id, "partial");
  assert.equal(entry.characterCount, 5);
});

test("projects the same legacy history id after input reordering", () => {
  const legacy = { createdAt: "2026-07-27T09:00:00Z", status: "complete", text: "legacy" };
  const other = { createdAt: "2026-07-26T09:00:00Z", status: "complete", text: "other" };

  const firstId = projectHistory([legacy, other], 2).find((entry) => entry.text === "legacy").id;
  const reorderedId = projectHistory([other, legacy], 2).find((entry) => entry.text === "legacy").id;

  assert.equal(reorderedId, firstId);
  assert.match(firstId, /^legacy-[a-f0-9]{8}$/);
});
