import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mojibakePattern = /寮€|璇|鐨|妯|鎸|鍚|杈|闊|绠€|銉|鞚|氇|瑾|閷|鞁/;

function getElementMarkup(html, tagName, id) {
  const openingMatch = new RegExp(`<${tagName}\\b[^>]*\\bid="${id}"[^>]*>`, "i").exec(html);
  assert.ok(openingMatch, `${tagName}#${id} should exist`);

  const searchStart = openingMatch.index + openingMatch[0].length;
  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  let depth = 1;

  for (const match of html.slice(searchStart).matchAll(tagPattern)) {
    const token = match[0];
    depth += token.startsWith("</") ? -1 : 1;
    if (depth === 0) {
      const endIndex = searchStart + match.index + token.length;
      return html.slice(openingMatch.index, endIndex);
    }
  }

  assert.fail(`${tagName}#${id} should have a closing tag`);
}

test("renderer uses the exact local Lucide runtime dependency", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );

  assert.equal(packageJson.dependencies.lucide, "1.24.0");
  assert.equal(packageJson.dependencies["uiohook-napi"], "^1.5.5");
  assert.equal(packageJson.devDependencies.electron, "38.8.6");
  assert.equal(packageJson.devDependencies["electron-builder"], "^26.15.3");
  assert.equal(packageJson.build.npmRebuild, false);
});

test("main window exposes the semantic Windows UI v3 hierarchy", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  for (const id of [
    "appHeader",
    "mainTabs",
    "dictationPanel",
    "languageControls",
    "voiceCommandBar",
    "recordRecovery",
    "resultWorkspace",
    "recentHistorySection",
    "historyPanel",
    "footerHealth",
    "settingsDrawer"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }

  assert.match(html, /id="mainTabs"[^>]*role="tablist"/);
  assert.match(
    html,
    /<button[^>]*id="dictationTab"[^>]*role="tab"[^>]*aria-selected="true"[^>]*aria-controls="dictationPanel"/
  );
  assert.match(
    html,
    /<button[^>]*id="historyTab"[^>]*role="tab"[^>]*aria-selected="false"[^>]*aria-controls="historyPanel"/
  );
  assert.match(
    html,
    /id="dictationPanel"[^>]*role="tabpanel"[^>]*aria-labelledby="dictationTab"/
  );
  assert.match(
    html,
    /id="historyPanel"[^>]*role="tabpanel"[^>]*aria-labelledby="historyTab"[^>]*hidden/
  );
});

test("renderer markup uses unique element ids", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

  assert.ok(ids.length > 0);
  assert.deepEqual([...new Set(duplicates)], []);
});

test("latest result remains editable and exposes recovery and insertion actions", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  assert.match(html, /id="resultEditor"/);
  assert.match(
    html,
    /id="resultText"[^>]*contenteditable="true"[^>]*role="textbox"[^>]*aria-multiline="true"/
  );
  assert.match(html, /id="restoreResult"/);
  assert.match(html, /id="insertResult"/);
  assert.match(html, /id="copyResult"/);
});

test("main window separates recent history from the full history list", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  assert.match(html, /id="recentHistorySection"[\s\S]*id="recentHistoryList"/);
  assert.match(html, /id="historyPanel"[\s\S]*id="fullHistoryList"[\s\S]*id="historyList"/);
  assert.match(html, /id="footerHealth"/);
});

test("history refresh and view-all commands keep separate semantics", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const recentHistory = getElementMarkup(html, "section", "recentHistorySection");
  const fullHistory = getElementMarkup(html, "section", "historyPanel");
  const viewAllButton = getElementMarkup(recentHistory, "button", "viewAllHistory");
  const refreshButton = getElementMarkup(fullHistory, "button", "refreshHistory");

  assert.match(viewAllButton, /<span class="button-label">查看全部<\/span>/);
  assert.match(
    appSource,
    /viewAllHistory\.querySelector\("\.button-label"\)\.dataset\.i18n\s*=\s*"action\.viewAll"/
  );
  assert.match(refreshButton, /data-i18n="action\.refresh"/);
  assert.match(refreshButton, />[\s\S]*刷新[\s\S]*<\/button>/);
  assert.doesNotMatch(recentHistory, /id="refreshHistory"/);
  assert.doesNotMatch(fullHistory, /id="viewAllHistory"/);
});

test("settings drawer groups existing controls into four stable sections", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  for (const section of [
    "settingsGeneral",
    "settingsShortcuts",
    "settingsModels",
    "settingsAdvanced"
  ]) {
    assert.match(html, new RegExp(`<section[^>]*id="${section}"`), section);
    assert.match(html, new RegExp(`id="${section}"[\\s\\S]*?<button[^>]*type="button"`), `${section} button`);
  }

  const dictationPanel = html.match(/id="dictationPanel"[\s\S]*?<\/section>/)?.[0] ?? "";
  const settingsDrawer = html.slice(html.indexOf('id="settingsDrawer"'));
  assert.doesNotMatch(dictationPanel, /id="setupChecklist"/);
  assert.match(settingsDrawer, /id="setupChecklist"/);
  assert.match(settingsDrawer, /id="providerStatusText"/);
  assert.match(settingsDrawer, /id="installWhisper"/);
  assert.match(settingsDrawer, /id="installLlm"/);
  assert.match(settingsDrawer, /id="setupOutput"/);
});

test("raw setup output belongs only to the advanced settings section", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const models = getElementMarkup(html, "section", "settingsModels");
  const advanced = getElementMarkup(html, "section", "settingsAdvanced");

  assert.doesNotMatch(models, /id="setupOutput"/);
  assert.match(advanced, /<pre\b[^>]*id="setupOutput"[^>]*>/);
});

test("main window fallback does not claim local speech recognition is ready", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const mainEnd = html.indexOf("</main>");
  const mainMarkup = html.slice(html.indexOf("<main"), mainEnd + "</main>".length);
  const header = getElementMarkup(html, "header", "appHeader");
  const footer = getElementMarkup(html, "footer", "footerHealth");

  assert.match(header, /正在检查本地语音识别状态/);
  assert.match(footer, /正在检查本地语音识别状态/);
  assert.doesNotMatch(mainMarkup, /已就绪/);
});

test("renderer loads only local Lucide placeholders and no hand-drawn icons", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const iconsSource = await readFile(new URL("../src/renderer/icons.js", import.meta.url), "utf8").catch(() => "");

  assert.match(iconsSource, /node_modules\/lucide\/dist\/esm\/lucide\.mjs/);
  assert.match(iconsSource, /createIcons/);
  assert.match(iconsSource, /export function renderIcons\(root = document\)/);
  for (const icon of [
    "Mic",
    "Settings",
    "History",
    "Copy",
    "Undo2",
    "CornerDownLeft",
    "ChevronRight",
    "Keyboard",
    "CheckCircle2",
    "AlertTriangle",
    "X"
  ]) {
    assert.match(iconsSource, new RegExp(`\\b${icon}\\b`), icon);
    assert.match(html, new RegExp(`data-lucide="${icon}"`), icon);
  }

  assert.match(iconsSource, /width:\s*"18"/);
  assert.match(iconsSource, /height:\s*"18"/);
  assert.match(iconsSource, /"stroke-width":\s*"1\.8"/);
  assert.match(iconsSource, /"aria-hidden":\s*"true"/);
  assert.doesNotMatch(html, /https?:\/\/[^"']*(?:lucide|cdn)/i);
  assert.doesNotMatch(html, /<svg\b/i);
  assert.doesNotMatch(html, /record-orb/);

  const iconsScriptIndex = html.indexOf('src="./icons.js"');
  const appScriptIndex = html.indexOf('src="./app.js"');
  assert.ok(iconsScriptIndex >= 0, "icons module script should be present");
  assert.ok(appScriptIndex > iconsScriptIndex, "icons module should load before app.js");
});

test("pure icon buttons have static and translatable accessible Chinese names", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  for (const id of ["openSettings", "closeSettings"]) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? "";
    assert.match(button, /title="[\u4e00-\u9fff]+"/, `${id} title`);
    assert.match(button, /aria-label="[\u4e00-\u9fff]+"/, `${id} aria-label`);
    assert.match(button, /data-i18n-title="[^"]+"/, `${id} translatable title`);
    assert.match(button, /data-i18n-aria-label="[^"]+"/, `${id} translatable aria-label`);
  }
});

test("localized icon controls preserve icons by translating only child labels", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const iconButtons = [...html.matchAll(/<button\b[\s\S]*?<\/button>/g)]
    .map((match) => match[0])
    .filter((button) => button.includes("data-lucide="));

  assert.ok(iconButtons.length > 0);
  for (const button of iconButtons) {
    const openingTag = button.match(/^<button\b[^>]*>/)?.[0] ?? "";
    const id = openingTag.match(/\bid="([^"]+)"/)?.[1] ?? "unnamed icon button";
    assert.doesNotMatch(openingTag, /\sdata-i18n="/, id);
  }

  const copyButton = getElementMarkup(html, "button", "copyResult");
  assert.match(copyButton, /data-lucide="Copy"/);
  assert.match(
    copyButton,
    /<span class="button-label" data-i18n="action\.copy">复制<\/span>/
  );

  const viewAllButton = getElementMarkup(html, "button", "viewAllHistory");
  assert.match(viewAllButton, /data-lucide="ChevronRight"/);
  assert.match(viewAllButton, /<span class="button-label">查看全部<\/span>/);
  assert.doesNotMatch(viewAllButton.match(/^<button\b[^>]*>/)?.[0] ?? "", /\sdata-i18n=/);
});

test("interface translation updates text and accessible attributes before refreshing icons", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");

  assert.match(appSource, /import\s*\{\s*renderIcons\s*\}\s*from\s*"\.\/icons\.js"/);
  assert.match(appSource, /function applyTranslations\(root = document\)/);
  assert.match(appSource, /querySelectorAll\("\[data-i18n\]"\)/);
  assert.match(appSource, /querySelectorAll\("\[data-i18n-placeholder\]"\)/);
  assert.match(appSource, /querySelectorAll\("\[data-i18n-title\]"\)/);
  assert.match(appSource, /querySelectorAll\("\[data-i18n-aria-label\]"\)/);
  assert.match(appSource, /element\.placeholder\s*=\s*t\(element\.dataset\.i18nPlaceholder\)/);
  assert.match(appSource, /element\.title\s*=\s*t\(element\.dataset\.i18nTitle\)/);
  assert.match(appSource, /element\.setAttribute\("aria-label",\s*t\(element\.dataset\.i18nAriaLabel\)\)/);
  assert.match(appSource, /applyTranslations\(\);[\s\S]*?renderIcons\(\);/);
});

test("localization targets cover container names and the dynamic shortcut hint", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");

  for (const [target, key] of [
    ["mainTabsRegion", "aria.mainTabs"],
    ["voiceCommandBar", "aria.voiceCommandBar"],
    ["resultActions", "aria.resultActions"],
    ["footerHealth", "aria.localServices"],
    ["settingsSectionNav", "aria.settingsSections"]
  ]) {
    assert.match(
      appSource,
      new RegExp(`${target}\\.dataset\\.i18nAriaLabel = \\"${key.replace(".", "\\.")}\\"`),
      `${target} accessible name`
    );
  }

  assert.match(appSource, /function renderShortcutHint\(\)/);
  assert.match(appSource, /shortcutHintText\.textContent = t\("hint\.shortcut", \{/);
  assert.match(appSource, /hotkey:\s*formatHotkey\(hotkey\)/);
  assert.match(appSource, /applyTranslations\(\);[\s\S]*?renderShortcutHint\(\);[\s\S]*?renderIcons\(\);/);
});

test("localized Windows UI v3 structure preserves icon controls and dynamic content", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");

  for (const [control, key] of [
    ["dictationTab", "tab.dictation"],
    ["historyTab", "tab.history"],
    ["restoreResult", "action.restore"],
    ["copyResult", "action.copy"],
    ["insertResult", "action.insert"]
  ]) {
    assert.match(
      appSource,
      new RegExp(`attachTranslationToIconLabel\\(${control}, \\"${key.replace(".", "\\.")}\\"\\)`),
      control
    );
  }

  for (const key of [
    "settings.general",
    "settings.shortcuts",
    "settings.modelsPrivacy",
    "settings.advanced",
    "hint.autoKeepsLanguage"
  ]) {
    assert.match(appSource, new RegExp(`dataset\\.i18n = \\"${key.replace(".", "\\.")}\\"`), key);
  }

  assert.match(appSource, /const WAVEFORM_BAR_COUNT = 24/);
  assert.match(appSource, /attachTranslationToIconLabel\(viewAllHistory, "action\.viewAll"\)/);
  assert.match(appSource, /button\.dataset\.i18nTitle = key/);
  assert.match(appSource, /button\.dataset\.i18nAriaLabel = key/);
  assert.match(appSource, /recordButton\.removeAttribute\("aria-live"\)/);
  assert.match(appSource, /phaseStatus\.setAttribute\("role", "status"\)/);
  assert.match(appSource, /phaseStatus\.setAttribute\("aria-live", "polite"\)/);
  assert.match(appSource, /className = "waveform"/);
  assert.match(appSource, /Array\.from\(\{ length: WAVEFORM_BAR_COUNT \}/);
  assert.match(appSource, /t\("label\.characterCount", \{ count \}\)/);
  assert.match(appSource, /phaseStatus\.textContent = t\(`phase\.\$\{normalizedPhase\}`\)/);
});

test("Windows UI v3 styles enforce the approved visual and responsive system", async () => {
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  for (const token of [
    ["--background", "#F6F8F7"],
    ["--surface", "#FFFFFF"],
    ["--text", "#17211E"],
    ["--muted", "#66716D"],
    ["--line", "#DCE3E0"],
    ["--accent", "#078A68"],
    ["--recording", "#D64B3C"],
    ["--warning", "#A96F16"],
    ["--error", "#B83A3A"]
  ]) {
    assert.match(styles, new RegExp(`${token[0]}:\\s*${token[1]}`, "i"), token[0]);
  }

  assert.match(styles, /font-family:\s*"Segoe UI",\s*"Microsoft YaHei",\s*system-ui/);
  assert.match(styles, /letter-spacing:\s*0/);
  assert.match(styles, /body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(styles, /\.app-shell\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(styles, /#recordButton\s*\{[^}]*border-radius:\s*6px/s);
  assert.match(styles, /\.status-line\s*\{[^}]*min-height:\s*\d+px/s);
  assert.match(styles, /\.drawer-panel\s*\{[^}]*width:\s*min\(560px,\s*100vw\)/s);
  assert.match(styles, /@media\s*\(max-width:\s*919px\)/);
  assert.match(styles, /@media\s*\(max-height:\s*649px\)/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styles, /:focus-visible\s*\{[^}]*outline:\s*2px/s);
  assert.match(styles, /@media\s*\(max-width:\s*919px\)[\s\S]*?\.button-label\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /@media\s*\(max-height:\s*649px\)[\s\S]*?#recentHistoryList \.history-item:nth-child\(3\)\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(styles, /^\s*\.history-item:nth-child\(3\)\s*\{/m);
  assert.doesNotMatch(styles, /(?:linear|radial)-gradient/i);
  assert.doesNotMatch(styles, /record-orb/);
  assert.doesNotMatch(styles, /border-radius:\s*(?:50%|999\w*)[^;]*;[^}]*#recordButton/s);
});

test("explanatory copy stays at body size while only metadata and raw output are smaller", async () => {
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.drawer-hint\s*\{[^}]*font-size:\s*14px/s);
  assert.match(
    styles,
    /\.setup-row p,\s*\.model-status span,\s*\.diagnostic span\s*\{[^}]*font-size:\s*14px/s
  );

  const smallTextBlocks = [...styles.matchAll(/([^{}]+)\{[^{}]*font-size:\s*(?:12|13)px[^{}]*\}/g)];
  assert.ok(smallTextBlocks.length > 0, "metadata and raw output should retain compact text");
  for (const block of smallTextBlocks) {
    assert.match(
      block[1],
      /history-select time|data-history-character-count|setup-output|install-command|hud-timer/,
      `small text is limited to metadata or raw output: ${block[1].trim()}`
    );
  }
});

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

test("settings expose shortcut recorder controls", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");

  assert.match(html, /id="recordHotkey"/);
  assert.match(html, /data-shortcut-target="hotkey"/);
  assert.match(html, /id="recordPasteLastHotkey"/);
  assert.match(html, /data-shortcut-target="pasteLastHotkey"/);
  assert.match(html, /data-i18n="action.recordShortcut"/);
  assert.match(appSource, /createShortcutRecorder/);
  assert.match(appSource, /shortcutRecorder\.start/);
});

test("shortcut recorder layout separates its help text from the controls", async () => {
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.shortcut-setting \+ \.drawer-hint\s*\{[^}]*margin-top:\s*10px/s);
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
  assert.match(html, />还没有转写结果。<\/(?:p|div)>/);
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
