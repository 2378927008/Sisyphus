import test from "node:test";
import assert from "node:assert/strict";
import { polishLocally, buildPolishPrompt, buildOutputPrompt } from "../src/shared/text-cleanup.js";

test("polishLocally removes common Chinese and English filler words", () => {
  const result = polishLocally("嗯 我们 uh 今天 就是 需要 need to update the roadmap");

  assert.equal(result, "我们今天需要 need to update the roadmap");
});

test("polishLocally collapses repeated punctuation and whitespace", () => {
  const result = polishLocally("hello,,,   world。。   next");

  assert.equal(result, "hello, world。 next");
});

test("buildPolishPrompt keeps dictation mode explicit", () => {
  const prompt = buildPolishPrompt({
    mode: "polish",
    transcript: "um write a better email",
    dictionary: ["Qwen", "Caltrain"]
  });

  assert.match(prompt, /polished text/);
  assert.match(prompt, /same language as the transcript/);
  assert.match(prompt, /Qwen, Caltrain/);
  assert.match(prompt, /um write a better email/);
});

test("buildOutputPrompt keeps source language when output language is automatic", () => {
  const prompt = buildOutputPrompt({
    mode: "polish",
    outputLanguage: "auto",
    transcript: "um write a better email",
    dictionary: ["Qwen"]
  });

  assert.match(prompt, /Rewrite the transcript as polished text/);
  assert.match(prompt, /same language as the transcript/);
  assert.doesNotMatch(prompt, /Translate/);
});

test("buildOutputPrompt targets Simplified Chinese output", () => {
  const prompt = buildOutputPrompt({
    mode: "polish",
    outputLanguage: "zh-Hans",
    transcript: "schedule a meeting tomorrow",
    dictionary: ["Local Flow"]
  });

  assert.match(prompt, /Simplified Chinese/);
  assert.match(prompt, /Return only the final text/);
  assert.match(prompt, /schedule a meeting tomorrow/);
});

test("buildOutputPrompt targets Spanish output", () => {
  const prompt = buildOutputPrompt({
    mode: "raw",
    outputLanguage: "es",
    transcript: "book the ticket",
    dictionary: []
  });

  assert.match(prompt, /Spanish/);
  assert.match(prompt, /Translate/);
});
