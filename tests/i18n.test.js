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

test("getUiText returns MyMemory provider labels", () => {
  assert.equal(getUiText("en", "model.provider.mymemory"), "MyMemory Free (cloud)");
  assert.equal(getUiText("fr", "model.provider.mymemory"), "MyMemory Free (cloud)");
});

test("legacy translate mode is not framed as English-only translation", () => {
  assert.equal(getUiText("en", "mode.translate"), "Target language output");
  assert.equal(getUiText("zh-Hans", "mode.translate"), "目标语言输出");
  assert.equal(getUiText("ja", "mode.translate"), "出力言語に変換");
  assert.equal(getUiText("ko", "mode.translate"), "출력 언어로 변환");
});

test("local model setup copy frames dictation as target-language output", () => {
  assert.match(getUiText("en", "setup.llm.missing"), /target-language output/);
  assert.doesNotMatch(getUiText("en", "setup.llm.missing"), /translation/i);
  assert.match(getUiText("zh-Hans", "setup.llm.missing"), /目标语言输出/);
  assert.doesNotMatch(getUiText("zh-Hans", "setup.llm.missing"), /翻译/);
});

test("getUiText returns Windows productization labels", () => {
  assert.equal(getUiText("en", "label.launchAtLogin"), "Launch Local Flow at login");
  assert.equal(getUiText("en", "label.startMinimizedToTray"), "Start minimized to tray");
  assert.equal(getUiText("en", "label.globalShortcutPaused"), "Pause global shortcut");
  const englishMissingPaths = getUiText("en", "record.disabled.embedded_llm_paths_missing");
  const chineseMissingPaths = getUiText("zh-Hans", "record.disabled.embedded_llm_paths_missing");
  assert.match(englishMissingPaths, /Auto \(same as speech\)/);
  assert.match(englishMissingPaths, /MyMemory Free/);
  assert.match(chineseMissingPaths, /自动/);
  assert.match(chineseMissingPaths, /MyMemory Free/);
  assert.notEqual(chineseMissingPaths, englishMissingPaths);
  assert.equal(getUiText("zh-Hans", "label.launchAtLogin"), "开机自动启动 Local Flow");
  assert.equal(getUiText("zh-Hans", "label.startMinimizedToTray"), "启动后最小化到托盘");
  assert.equal(getUiText("zh-Hans", "label.globalShortcutPaused"), "暂停全局快捷键");
});
