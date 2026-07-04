import test from "node:test";
import assert from "node:assert/strict";
import { getUiText, uiTranslations } from "../src/renderer/i18n.js";

const mojibakePattern = /寮€|璇|鐨|妯|鎸|鍚|杈|闊|绠€|Fran莽ais|D茅|Arr锚|袧邪|褋|携蟹|贸|谩|Espa帽ol|銉|鞚|氇|瑾|閷|鞁/;

test("getUiText returns localized record labels for supported interface languages", () => {
  assert.equal(getUiText("en", "record.start"), "Start recording");
  assert.equal(getUiText("zh-Hans", "record.start"), "开始录音");
  assert.equal(getUiText("ja", "record.start"), "録音を開始");
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

test("getUiText returns native names for interface language options", () => {
  assert.equal(getUiText("en", "language.interface.zh-Hans"), "简体中文");
  assert.equal(getUiText("en", "language.interface.ja"), "日本語");
  assert.equal(getUiText("en", "language.interface.ko"), "한국어");
  assert.equal(getUiText("en", "language.interface.fr"), "Français");
  assert.equal(getUiText("en", "language.interface.ru"), "Русский");
  assert.equal(getUiText("en", "language.interface.es"), "Español");
});

test("getUiText returns MyMemory provider labels", () => {
  assert.equal(getUiText("en", "model.provider.mymemory"), "MyMemory Free (cloud)");
  assert.equal(getUiText("fr", "model.provider.mymemory"), "MyMemory Free (cloud)");
});

test("legacy translate mode is not framed as English-only translation", () => {
  assert.equal(getUiText("en", "mode.translate"), "Target language output");
  assert.equal(getUiText("zh-Hans", "mode.translate"), "目标语言输出");
  assert.equal(getUiText("ja", "mode.translate"), "目標言語で出力");
  assert.equal(getUiText("ko", "mode.translate"), "대상 언어로 출력");
});

test("local model setup copy frames dictation as target-language output", () => {
  assert.match(getUiText("en", "setup.llm.missing"), /target-language output/);
  assert.doesNotMatch(getUiText("en", "setup.llm.missing"), /translation/i);
  assert.match(getUiText("zh-Hans", "setup.llm.missing"), /目标语言输出/);
  assert.doesNotMatch(getUiText("zh-Hans", "setup.llm.missing"), /翻译/);
});

test("getUiText returns localized setup failure reasons", () => {
  assert.match(getUiText("en", "setup.failure.whisper_model_download"), /Whisper model download failed/);
  assert.match(getUiText("zh-Hans", "setup.failure.whisper_model_download"), /Whisper 模型下载失败/);
  assert.match(getUiText("en", "setup.failure.setup_spawn_failed"), /could not start PowerShell/);
  assert.match(getUiText("zh-Hans", "setup.failure.setup_spawn_failed"), /无法启动 PowerShell/);
  assert.notEqual(
    getUiText("zh-Hans", "setup.failure.whisper_model_download"),
    getUiText("en", "setup.failure.whisper_model_download")
  );
});

test("getUiText returns Windows productization labels", () => {
  assert.equal(getUiText("en", "label.launchAtLogin"), "Launch Local Flow at login");
  assert.equal(getUiText("en", "label.startMinimizedToTray"), "Start minimized to tray");
  assert.equal(getUiText("en", "label.globalShortcutPaused"), "Pause global shortcut");
  assert.equal(getUiText("en", "label.shortcutMode"), "Dictation shortcut behavior");
  assert.equal(getUiText("en", "shortcut.mode.toggle"), "Press to start or stop");
  assert.equal(getUiText("en", "shortcut.mode.hold"), "Hold to dictate");
  assert.equal(getUiText("en", "label.pasteLastHotkey"), "Paste last result shortcut");
  assert.match(getUiText("en", "hint.mouseShortcut"), /Mouse4/);
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
  assert.equal(getUiText("zh-Hans", "label.shortcutMode"), "语音输入快捷键行为");
  assert.equal(getUiText("zh-Hans", "shortcut.mode.toggle"), "按一次开始或停止");
  assert.equal(getUiText("zh-Hans", "shortcut.mode.hold"), "按住说话");
  assert.equal(getUiText("zh-Hans", "label.pasteLastHotkey"), "粘贴上一段结果快捷键");
  assert.match(getUiText("zh-Hans", "hint.mouseShortcut"), /Mouse4/);
});

test("getUiText returns localized record recovery actions", () => {
  assert.equal(getUiText("en", "record.recovery.useAutoOutput"), "Use Auto output");
  assert.equal(getUiText("zh-Hans", "record.recovery.useAutoOutput"), "使用自动输出");
  assert.match(getUiText("zh-Hans", "record.recovery.targetOutput"), /保留你说话的语言/);
  assert.notEqual(
    getUiText("zh-Hans", "record.recovery.targetOutput"),
    getUiText("en", "record.recovery.targetOutput")
  );
});

test("getUiText returns model download source labels", () => {
  assert.equal(getUiText("en", "section.downloadSources"), "Model download sources");
  assert.equal(getUiText("zh-Hans", "section.downloadSources"), "模型下载源");
  assert.match(getUiText("en", "hint.downloadSources"), /Leave blank/);
  assert.match(getUiText("zh-Hans", "hint.downloadSources"), /留空/);
  assert.equal(getUiText("zh-Hans", "label.qwenModelMirrorUrls"), "Qwen 模型备用镜像地址");
});

test("localized UI resources do not contain common mojibake artifacts", () => {
  for (const [language, dictionary] of Object.entries(uiTranslations)) {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.doesNotMatch(String(value), mojibakePattern, `${language}.${key}`);
    }
  }
});
