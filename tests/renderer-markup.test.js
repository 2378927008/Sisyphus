import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
});
