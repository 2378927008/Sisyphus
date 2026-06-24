import test from "node:test";
import assert from "node:assert/strict";
import { mergeSettings, defaultSettings } from "../src/main/settings-store.js";

test("mergeSettings preserves defaults for missing values", () => {
  const settings = mergeSettings({ whisperModelPath: "C:/models/ggml-small.bin" });

  assert.equal(settings.whisperModelPath, "C:/models/ggml-small.bin");
  assert.equal(settings.hotkey, defaultSettings.hotkey);
  assert.equal(settings.ollamaBaseUrl, defaultSettings.ollamaBaseUrl);
  assert.equal(settings.interfaceLanguage, "zh-Hans");
  assert.equal(settings.whisperLanguage, "auto");
  assert.equal(settings.outputLanguage, "auto");
});

test("mergeSettings ignores unknown keys", () => {
  const settings = mergeSettings({ unknown: true, hotkey: "CommandOrControl+Alt+Space" });

  assert.equal(settings.hotkey, "CommandOrControl+Alt+Space");
  assert.equal("unknown" in settings, false);
});

test("mergeSettings accepts default overrides", () => {
  const settings = mergeSettings({}, {
    ...defaultSettings,
    whisperCliPath: "C:/project/vendor/whisper/bin/Release/whisper-cli.exe"
  });

  assert.equal(settings.whisperCliPath, "C:/project/vendor/whisper/bin/Release/whisper-cli.exe");
});

test("mergeSettings fills empty saved Whisper paths from detected defaults", () => {
  const settings = mergeSettings(
    { whisperCliPath: "", whisperModelPath: "" },
    {
      ...defaultSettings,
      whisperCliPath: "C:/project/vendor/whisper/bin/Release/whisper-cli.exe",
      whisperModelPath: "C:/project/vendor/whisper/models/ggml-base.bin"
    }
  );

  assert.equal(settings.whisperCliPath, "C:/project/vendor/whisper/bin/Release/whisper-cli.exe");
  assert.equal(settings.whisperModelPath, "C:/project/vendor/whisper/models/ggml-base.bin");
});

test("mergeSettings keeps supported language preferences", () => {
  const settings = mergeSettings({
    interfaceLanguage: "ja",
    whisperLanguage: "es",
    outputLanguage: "fr"
  });

  assert.equal(settings.interfaceLanguage, "ja");
  assert.equal(settings.whisperLanguage, "es");
  assert.equal(settings.outputLanguage, "fr");
});

test("mergeSettings rejects unsupported language preferences", () => {
  const settings = mergeSettings({
    interfaceLanguage: "pt-BR",
    whisperLanguage: "zh-Hant",
    outputLanguage: "de"
  });

  assert.equal(settings.interfaceLanguage, "zh-Hans");
  assert.equal(settings.whisperLanguage, "auto");
  assert.equal(settings.outputLanguage, "auto");
});

test("mergeSettings maps legacy original output language to automatic same-language output", () => {
  const settings = mergeSettings({ outputLanguage: "original" });

  assert.equal(settings.outputLanguage, "auto");
});
