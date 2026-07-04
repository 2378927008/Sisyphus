import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mojibakePattern = /寮€|璇|鐨|妯|鎸|鍚|杈|闊|绠€|銉|鞚|氇|瑾|閷|鞁/;

test("settings expose dictation modes without a legacy translation mode", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  assert.match(html, /<option value="polish"/);
  assert.match(html, /<option value="raw"/);
  assert.match(html, /<option value="command"/);
  assert.doesNotMatch(html, /<option value="translate"/);
});

test("settings expose Windows productization controls", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  assert.match(html, /id="launchAtLogin"/);
  assert.match(html, /name="launchAtLogin"/);
  assert.match(html, /id="startMinimizedToTray"/);
  assert.match(html, /name="startMinimizedToTray"/);
  assert.match(html, /id="globalShortcutPaused"/);
  assert.match(html, /name="globalShortcutPaused"/);
  assert.match(html, /data-i18n="label.launchAtLogin"/);
  assert.match(html, /data-i18n="label.startMinimizedToTray"/);
  assert.match(html, /data-i18n="label.globalShortcutPaused"/);
  assert.match(html, /id="shortcutMode"/);
  assert.match(html, /name="shortcutMode"/);
  assert.match(html, /<option value="toggle"/);
  assert.match(html, /<option value="hold"/);
  assert.match(html, /id="pasteLastHotkey"/);
  assert.match(html, /name="pasteLastHotkey"/);
  assert.match(html, /data-i18n="label.shortcutMode"/);
  assert.match(html, /data-i18n="label.pasteLastHotkey"/);
  assert.match(html, /data-i18n="hint.mouseShortcut"/);
});

test("home screen exposes a contextual recovery action when recording is blocked", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");

  assert.match(html, /id="recordRecovery"/);
  assert.match(html, /id="recordRecoveryText"/);
  assert.match(html, /id="recordRecoveryAction"/);
  assert.match(appSource, /getRecordRecoveryAction/);
  assert.match(appSource, /applyRecordRecoveryAction/);
});

test("renderer fallback markup uses readable Chinese copy", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  assert.match(html, /<title>Local Flow 本地语音输入<\/title>/);
  assert.match(html, />开始录音<\/span>/);
  assert.match(html, />安装 Whisper<\/button>/);
  assert.match(html, />还没有转写结果。<\/p>/);
  assert.doesNotMatch(html, mojibakePattern);
});

test("settings drawer exposes configurable model download sources", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  for (const field of [
    "whisperRuntimeUrl",
    "whisperRuntimeMirrorUrls",
    "whisperModelUrl",
    "whisperModelMirrorUrls",
    "llamaRuntimeUrl",
    "llamaRuntimeMirrorUrls",
    "qwenModelUrl",
    "qwenModelMirrorUrls"
  ]) {
    assert.match(html, new RegExp(`name="${field}"`), field);
  }

  assert.match(html, /data-i18n="section.downloadSources"/);
  assert.match(html, /data-i18n="hint.downloadSources"/);
});

test("HUD fallback markup uses readable Chinese copy", async () => {
  const html = await readFile(new URL("../src/renderer/hud.html", import.meta.url), "utf8");

  assert.match(html, /<p id="hudMessage">按快捷键开始或停止录音<\/p>/);
  assert.doesNotMatch(html, mojibakePattern);
});

test("setup failures render localized failure reasons instead of raw diagnostics", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");

  assert.match(appSource, /getSetupFailureMessage/);
  assert.match(appSource, /failureReason/);
  assert.match(appSource, /setup\.failure\.\$\{setup\.failureReason\}/);
  assert.match(appSource, /getSetupStatusText/);
});
