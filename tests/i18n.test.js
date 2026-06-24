import test from "node:test";
import assert from "node:assert/strict";
import { getUiText } from "../src/renderer/i18n.js";

test("getUiText returns localized record labels for supported interface languages", () => {
  assert.equal(getUiText("en", "record.start"), "Start recording");
  assert.equal(getUiText("zh-Hans", "record.start"), "开始录音");
  assert.equal(getUiText("ja", "record.start"), "録音開始");
  assert.equal(getUiText("ko", "record.start"), "녹음 시작");
  assert.equal(getUiText("zh-Hant", "record.start"), "開始錄音");
  assert.equal(getUiText("fr", "record.start"), "Démarrer l'enregistrement");
  assert.equal(getUiText("ru", "record.start"), "Начать запись");
  assert.equal(getUiText("es", "record.start"), "Iniciar grabación");
});

test("getUiText returns localized language setting labels", () => {
  assert.equal(getUiText("ja", "label.outputLanguage"), "出力言語");
  assert.equal(getUiText("ko", "label.recognitionLanguage"), "음성 인식 언어");
  assert.equal(getUiText("fr", "label.interfaceLanguage"), "Langue de l'interface");
  assert.equal(getUiText("ru", "label.outputLanguage"), "Язык вывода");
  assert.equal(getUiText("es", "label.recognitionLanguage"), "Idioma de reconocimiento de voz");
});
