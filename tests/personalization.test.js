import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONALIZATION_LIMITS,
  expandExactSnippet,
  normalizeDictionary,
  normalizeSnippets
} from "../src/shared/personalization.js";

test("dictionary normalization trims, NFKC-deduplicates, and caps entries", () => {
  assert.deepEqual(
    normalizeDictionary([" Qwen ", "qwen", "", "Local   Flow", "Ｑｗｅｎ"]),
    ["Qwen", "Local Flow"]
  );
  assert.equal(
    normalizeDictionary(Array.from({ length: PERSONALIZATION_LIMITS.dictionaryEntries + 1 }, (_, index) => `term-${index}`)).length,
    PERSONALIZATION_LIMITS.dictionaryEntries
  );
});

test("snippet normalization assigns ids, preserves the first spelling, and caps fields", () => {
  const createId = () => "generated-id";
  const snippets = normalizeSnippets([
    { trigger: "  Meeting   Notes ", text: "first" },
    { id: "duplicate", trigger: "meeting notes", text: "second" },
    { trigger: "", text: "ignored" },
    { trigger: "keep", text: "" }
  ], { createId });

  assert.deepEqual(snippets, [{ id: "generated-id", trigger: "Meeting Notes", text: "first" }]);
});

test("snippet expansion requires a complete normalized match", () => {
  const snippets = [{ id: "s1", trigger: "会议总结", text: "以下是本次会议总结。" }];

  assert.deepEqual(expandExactSnippet(" 会议总结 ", snippets), {
    matched: true,
    text: "以下是本次会议总结。",
    snippetId: "s1"
  });
  assert.equal(expandExactSnippet("请写会议总结", snippets).matched, false);
});
