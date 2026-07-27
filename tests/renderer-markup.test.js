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

test("main window exposes the semantic Windows UI v4 product shell", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  for (const id of [
    "appSidebar",
    "navHome",
    "navHistory",
    "navSettings",
    "appTopbar",
    "globalSearch",
    "commandStrip",
    "recordButton",
    "historyPane",
    "historySearch",
    "historyList",
    "editorPane",
    "editorBack",
    "resultText",
    "settingsDrawer"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }

  assert.match(html, /<main class="app-layout">[\s\S]*id="appSidebar"[\s\S]*id="appTopbar"[\s\S]*id="commandStrip"[\s\S]*id="workspacePage"/);
  assert.match(html, /<nav[^>]*aria-label="主要导航"/);
  assert.match(html, /id="workspacePage"[\s\S]*id="historyPane"[\s\S]*id="editorPane"/);
  assert.doesNotMatch(html, /id="mainTabs"|id="dictationTab"|id="historyTab"|id="recentHistorySection"|id="footerHealth"/);
  assert.doesNotMatch(html, /id="(?:windowMinimize|windowMaximize|windowClose)"/);
});

test("sidebar renders the existing Local Flow icon as decorative brand artwork", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  assert.match(
    html,
    /<img\b(?=[^>]*class="app-brand-icon")(?=[^>]*src="\.\.\/\.\.\/assets\/local-flow-icon\.svg")(?=[^>]*alt="")(?=[^>]*aria-hidden="true")[^>]*>/
  );
  assert.match(html, /<h1>Local Flow<\/h1>/);
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

test("latest result exposes a visible localized character count", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  assert.match(html, /id="resultCharacterCount"[^>]*class="result-character-count"[^>]*>0 个字符<\/span>/);
  assert.match(appSource, /const resultCharacterCount = document\.querySelector\("#resultCharacterCount"\)/);
  assert.match(
    appSource,
    /resultCharacterCount\.textContent = t\("label\.characterCount", \{\s*count: editorState\.characterCount\s*\}\)/s
  );
  assert.match(
    styles,
    /\.editor-status,\s*\.result-character-count\s*\{[^}]*color:\s*var\(--muted\)[^}]*font-size:\s*12px[^}]*white-space:\s*nowrap/s
  );
});

test("history workspace uses one searchable cached list beside the selected editor", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const historySource = await readFile(
    new URL("../src/renderer/history-view-state.js", import.meta.url),
    "utf8"
  );

  assert.match(html, /id="historyPane"[\s\S]*id="historySearch"[\s\S]*id="historyList"/);
  assert.match(html, /id="editorPane"[\s\S]*id="editorBack"[\s\S]*id="resultText"/);
  assert.match(appSource, /normalizeHistoryEntries/);
  assert.match(appSource, /filterHistory/);
  assert.match(appSource, /groupHistoryByDate/);
  assert.match(appSource, /resolveHistorySelection/);
  assert.match(historySource, /export function hasDisplayableHistoryText\(/);
  assert.match(appSource, /hasDisplayableHistoryText\(item\)/);
  assert.match(appSource, /historySearch\.addEventListener\("input"/);
  assert.match(appSource, /globalSearch\.addEventListener\("input"/);
  assert.doesNotMatch(appSource, /(?:historySearch|globalSearch)\.addEventListener\("input",[\s\S]{0,240}listHistory\(/);
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
  }

  const mainMarkup = getElementMarkup(html, "section", "workspacePage");
  const settingsDrawer = html.slice(html.indexOf('id="settingsDrawer"'));
  assert.doesNotMatch(mainMarkup, /id="setupChecklist"/);
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

test("advanced setup controls stay isolated and history mutations remain narrowly scoped", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const smokeSource = await readFile(new URL("../scripts/electron-app-smoke.mjs", import.meta.url), "utf8");
  const advanced = getElementMarkup(html, "section", "settingsAdvanced");
  const mainMarkup = html.slice(html.indexOf("<main"), html.indexOf("</main>") + 7);

  for (const field of [
    "whisperCliPath",
    "whisperModelPath",
    "embeddedLlmCliPath",
    "embeddedLlmModelPath"
  ]) {
    assert.match(advanced, new RegExp(`name="${field}"`), `${field} should remain in Advanced`);
    assert.doesNotMatch(mainMarkup, new RegExp(`name="${field}"`), `${field} should not be on the main page`);
  }

  for (const [name, source] of [
    ["renderer", appSource],
    ["preload", preloadSource],
    ["main", mainSource],
    ["smoke", smokeSource]
  ]) {
    for (const channel of ["history:delete", "history:write", "history:clear"]) {
      assert.equal(source.includes(channel), false, `${name} must not use ${channel}`);
    }
  }

  assert.match(preloadSource, /history:list/);
  assert.match(preloadSource, /history:update/);
  assert.match(preloadSource, /history:reprocess/);
  assert.match(smokeSource, /history:list/);
  assert.match(smokeSource, /history:update/);
  assert.match(smokeSource, /history:reprocess/);
});

test("main window fallback uses one short safe local setup status", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const mainEnd = html.indexOf("</main>");
  const mainMarkup = html.slice(html.indexOf("<main"), mainEnd + "</main>".length);
  const header = getElementMarkup(html, "header", "appTopbar");

  assert.match(header, /本地 Whisper 待配置/);
  assert.doesNotMatch(mainMarkup, /已就绪/);
  assert.doesNotMatch(mainMarkup, /C:\\|https?:\/\/|\bspawn\b|ENOENT|stderr/i);
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
    "House",
    "Search",
    "BookOpen",
    "MessageSquareText",
    "ArrowLeft",
    "Globe2",
    "Copy",
    "Undo2",
    "CornerDownLeft",
    "ChevronDown",
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

  for (const id of ["closeSettings"]) {
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

  const recordButton = getElementMarkup(html, "button", "recordButton");
  assert.match(recordButton, /data-lucide="Mic"/);
  assert.match(recordButton, /<span[^>]*id="recordLabel"[^>]*data-i18n="record\.start"/);
  assert.doesNotMatch(recordButton.match(/^<button\b[^>]*>/)?.[0] ?? "", /\sdata-i18n=/);
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
    ["primaryNavigation", "aria.mainTabs"],
    ["commandStrip", "aria.voiceCommandBar"],
    ["resultActions", "aria.resultActions"],
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

test("localized Windows UI v4 structure preserves icon controls and dynamic content", async () => {
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");

  for (const [control, key] of [
    ["navHome", "nav.home"],
    ["navHistory", "nav.history"],
    ["navSettings", "nav.settings"],
    ["editorBack", "history.back"],
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
    "settings.advanced"
  ]) {
    assert.match(appSource, new RegExp(`dataset\\.i18n = \\"${key.replace(".", "\\.")}\\"`), key);
  }

  assert.match(appSource, /const WAVEFORM_BAR_COUNT = 24/);
  assert.match(appSource, /button\.dataset\.i18nTitle = key/);
  assert.match(appSource, /button\.dataset\.i18nAriaLabel = key/);
  assert.match(appSource, /recordButton\.removeAttribute\("aria-live"\)/);
  assert.match(appSource, /phaseStatus\.setAttribute\("role", "status"\)/);
  assert.match(appSource, /phaseStatus\.setAttribute\("aria-live", "polite"\)/);
  assert.match(appSource, /className = "waveform"/);
  assert.match(appSource, /Array\.from\(\{ length: WAVEFORM_BAR_COUNT \}/);
  assert.match(appSource, /phaseStatus\.textContent = t\(`phase\.\$\{normalizedPhase\}`\)/);
  assert.match(appSource, /const headerHealthText = document\.querySelector\("#headerHealthText"\)/);
  assert.match(
    appSource,
    /const healthMessage = readiness\.ready\s*\? t\("status\.localReady"\)\s*:\s*t\("status\.localNeedsSetup"\)/s
  );
  assert.match(appSource, /headerHealthText\.textContent = healthMessage/);
  assert.doesNotMatch(appSource, /footerHealth/);
});

test("history editor exposes autosave, recovery, and reusable result actions", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");

  assert.match(html, /id="editorSaveState"[^>]*role="status"/);
  assert.match(html, /id="reprocessResult"/);
  assert.match(html, /id="editorContextText"/);
  assert.match(html, /data-i18n="action\.reprocess"/);
  assert.match(appSource, /createVersionedAutosave/);
  assert.match(appSource, /window\.localFlow\.updateHistory/);
  assert.match(appSource, /window\.localFlow\.reprocessHistory/);
  assert.match(appSource, /historyAutosave\.schedule/);
  assert.match(appSource, /historyAutosave\.flush/);
});

test("Windows UI v4 styles enforce the approved visual and responsive system", async () => {
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  for (const token of [
    ["--page", "#f5f7f6"],
    ["--surface", "#ffffff"],
    ["--sidebar", "#f0f3f2"],
    ["--text", "#17211e"],
    ["--muted", "#66716d"],
    ["--line", "#dce3e0"],
    ["--accent", "#078a68"],
    ["--recording", "#e2554f"],
    ["--warning", "#a96f16"],
    ["--error", "#b83a3a"],
    ["--focus", "#1769e0"]
  ]) {
    assert.match(styles, new RegExp(`${token[0]}:\\s*${token[1]}`, "i"), token[0]);
  }

  assert.match(styles, /font-family:\s*"Segoe UI",\s*"Microsoft YaHei",\s*system-ui/);
  assert.match(styles, /letter-spacing:\s*0/);
  assert.match(styles, /body\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.app-layout\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(styles, /#recordButton\s*\{[^}]*border-radius:\s*6px/s);
  assert.match(styles, /\.drawer-panel\s*\{[^}]*width:\s*min\(560px,\s*100vw\)/s);
  assert.match(styles, /@media\s*\(min-width:\s*1000px\)[\s\S]*grid-template-columns:\s*44% 56%/);
  assert.match(styles, /@media\s*\(min-width:\s*900px\)\s*and\s*\(max-width:\s*999px\)[\s\S]*64px/);
  assert.match(styles, /@media\s*\(max-width:\s*899px\)[\s\S]*body\[data-workspace-pane="list"\][\s\S]*body\[data-workspace-pane="editor"\]/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styles, /:focus-visible\s*\{[^}]*outline:\s*2px/s);
  assert.doesNotMatch(styles, /(?:linear|radial)-gradient/i);
  assert.doesNotMatch(styles, /border-radius:\s*(?:9|[1-9]\d+)px/);
  assert.doesNotMatch(styles, /record-orb/);
});

test("minimum window switches between list and editor without hiding the back action", async () => {
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const narrowStart = styles.indexOf("@media (max-width: 899px)");
  const reducedMotionStart = styles.indexOf("@media (prefers-reduced-motion: reduce)");
  const narrowStyles = styles.slice(narrowStart, reducedMotionStart);

  assert.ok(narrowStart >= 0 && reducedMotionStart > narrowStart);
  assert.match(narrowStyles, /body\[data-workspace-pane="list"\] #editorPane\s*\{[^}]*display:\s*none/s);
  assert.match(narrowStyles, /body\[data-workspace-pane="editor"\] #historyPane\s*\{[^}]*display:\s*none/s);
  assert.match(narrowStyles, /#editorBack\s*\{[^}]*display:\s*inline-flex/s);
});

test("history rows expose deterministic selected and keyboard-focus states", async () => {
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.history-select\[aria-selected="true"\]\s*\{/);
  assert.match(styles, /\.history-select:hover:not\(:disabled\),\s*\.history-select:focus-visible\s*\{/);
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
      /history-select time|history-group-heading|data-history-character-count|result-character-count|editor-status|setup-output|install-command|hud-timer/,
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
