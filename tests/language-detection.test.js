import test from "node:test";
import assert from "node:assert/strict";
import { detectLikelyLanguage } from "../src/shared/language-detection.js";

test("detectLikelyLanguage detects common CJK scripts", () => {
  assert.equal(detectLikelyLanguage("这是一个测试"), "zh");
  assert.equal(detectLikelyLanguage("これはテストです"), "ja");
  assert.equal(detectLikelyLanguage("안녕하세요 테스트입니다"), "ko");
});

test("detectLikelyLanguage detects Cyrillic as Russian", () => {
  assert.equal(detectLikelyLanguage("привет это тест"), "ru");
});

test("detectLikelyLanguage detects Latin text with simple hints", () => {
  assert.equal(detectLikelyLanguage("hello this is a test"), "en");
  assert.equal(detectLikelyLanguage("hola este es una prueba"), "es");
  assert.equal(detectLikelyLanguage("bonjour ceci est un test"), "fr");
});

test("detectLikelyLanguage returns unknown for empty or numeric text", () => {
  assert.equal(detectLikelyLanguage(""), "unknown");
  assert.equal(detectLikelyLanguage("12345"), "unknown");
});

test("detectLikelyLanguage returns unknown for non-string inputs", () => {
  assert.equal(detectLikelyLanguage(null), "unknown");
  assert.equal(detectLikelyLanguage(undefined), "unknown");
  assert.equal(detectLikelyLanguage(true), "unknown");
  assert.equal(detectLikelyLanguage(false), "unknown");
});

test("detectLikelyLanguage does not throw for hostile object input", () => {
  const hostile = {
    toString() {
      throw new Error("coercion failed");
    }
  };
  let language;

  assert.doesNotThrow(() => {
    language = detectLikelyLanguage(hostile);
  });
  assert.equal(language, "unknown");
});
