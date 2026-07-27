import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PERSONALIZATION_LIMITS,
  expandExactSnippet,
  normalizeDictionary,
  normalizeSnippets,
  personalizationComparisonKey
} from "../src/shared/personalization.js";

test("dictionary normalization preserves the first visible spelling while NFKC-deduplicating", () => {
  assert.deepEqual(
    normalizeDictionary([" \uFF31\uFF57\uFF45\uFF4E ", "Qwen", "", "Local   Flow"]),
    ["\uFF31\uFF57\uFF45\uFF4E", "Local Flow"]
  );
});

test("dictionary normalization caps entries", () => {
  assert.equal(
    normalizeDictionary(Array.from({ length: PERSONALIZATION_LIMITS.dictionaryEntries + 1 }, (_, index) => `term-${index}`)).length,
    PERSONALIZATION_LIMITS.dictionaryEntries
  );
});

test("snippet normalization preserves the first visible trigger while NFKC-deduplicating", () => {
  const snippets = normalizeSnippets([
    { id: "first", trigger: "  \uFF2D\uFF45\uFF45\uFF54\uFF49\uFF4E\uFF47\u3000\uFF2E\uFF4F\uFF54\uFF45\uFF53  ", text: "first" },
    { id: "duplicate", trigger: "meeting notes", text: "second" },
    { trigger: "", text: "ignored" },
    { trigger: "keep", text: "" }
  ]);

  assert.deepEqual(snippets, [{
    id: "first",
    trigger: "\uFF2D\uFF45\uFF45\uFF54\uFF49\uFF4E\uFF47 \uFF2E\uFF4F\uFF54\uFF45\uFF53",
    text: "first"
  }]);
});

test("snippet normalization uses an injected stable id generator", () => {
  let calls = 0;
  const snippets = normalizeSnippets([
    { trigger: "meeting notes", text: "first" }
  ], {
    createId() {
      calls += 1;
      return "stable-id";
    }
  });

  assert.deepEqual(snippets, [{ id: "stable-id", trigger: "meeting notes", text: "first" }]);
  assert.equal(calls, 1);
});

test("snippet normalization deterministically deconflicts duplicate and colliding ids", () => {
  const legacy = [
    { id: "same", trigger: "alpha", text: "A" },
    { id: "same", trigger: "beta", text: "B" },
    { id: "same~2", trigger: "gamma", text: "C" },
    { trigger: "delta", text: "D" }
  ];
  const normalized = normalizeSnippets(legacy, {
    createId() {
      return "same";
    }
  });

  assert.deepEqual(
    normalized.map(({ id, trigger }) => ({ id, trigger })),
    [
      { id: "same", trigger: "alpha" },
      { id: "same~3", trigger: "beta" },
      { id: "same~2", trigger: "gamma" },
      { id: "same~4", trigger: "delta" }
    ]
  );
  assert.deepEqual(normalizeSnippets(normalized), normalized);
});

test("reordering normalized snippets preserves each stable unique id", () => {
  const normalized = normalizeSnippets([
    { id: "same", trigger: "alpha", text: "A" },
    { id: "same", trigger: "beta", text: "B" }
  ]);
  const reordered = normalizeSnippets([...normalized].reverse());

  assert.deepEqual(
    Object.fromEntries(reordered.map((snippet) => [snippet.trigger, snippet.id])),
    Object.fromEntries(normalized.map((snippet) => [snippet.trigger, snippet.id]))
  );
});

test("personalization comparison collapses whitespace with NFKC and case folding", () => {
  assert.equal(
    personalizationComparisonKey("  Ｌｏｃａｌ \n\t Ｆｌｏｗ  "),
    personalizationComparisonKey("local   flow")
  );
});

test("shared personalization source has no Node-only imports", async () => {
  const source = await readFile(new URL("../src/shared/personalization.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /(?:from\s+|import\s*\()\s*["']node:/);
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
