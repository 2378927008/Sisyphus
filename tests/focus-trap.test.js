import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createFocusTrap, getFocusableElements } from "../src/renderer/focus-trap.js";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[tabindex]:not([tabindex="-1"])'
].join(", ");

function createElement({
  id,
  disabled = false,
  disabledByFieldset = false,
  hidden = false,
  ariaHidden = false,
  hiddenAncestor = false,
  inertAncestor = false,
  display = "block",
  visibility = "visible",
  visible = true
} = {}) {
  return {
    id,
    disabled,
    hidden,
    offsetParent: null,
    computedStyle: { display, visibility },
    focusCalls: 0,
    matches(selector) {
      return selector === ":disabled" && (disabled || disabledByFieldset);
    },
    getAttribute(name) {
      return name === "aria-hidden" && ariaHidden ? "true" : null;
    },
    closest(selector) {
      if (selector === '[aria-hidden="true"]' && (ariaHidden || hiddenAncestor)) return {};
      if (selector === "[hidden]" && (hidden || hiddenAncestor)) return {};
      if (selector === "[inert]" && inertAncestor) return {};
      return null;
    },
    getClientRects() {
      return visible ? [{}] : [];
    },
    focus() {
      this.focusCalls += 1;
      this.ownerDocument.activeElement = this;
    }
  };
}

function createContainer(elements, activeElement = null) {
  const listeners = new Map();
  const ownerDocument = {
    activeElement,
    defaultView: {
      getComputedStyle(element) {
        return element.computedStyle;
      }
    }
  };
  for (const element of elements) {
    element.ownerDocument = ownerDocument;
  }

  const container = {
    ownerDocument,
    listeners,
    addCalls: 0,
    removeCalls: 0,
    focusCalls: 0,
    querySelectorAll(selector) {
      assert.equal(selector, FOCUSABLE_SELECTOR);
      return elements;
    },
    addEventListener(type, listener) {
      this.addCalls += 1;
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      this.removeCalls += 1;
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    focus() {
      this.focusCalls += 1;
      ownerDocument.activeElement = this;
    }
  };
  return container;
}

function dispatchKey(container, key, { shiftKey = false, defaultPrevented = false } = {}) {
  const event = {
    key,
    shiftKey,
    defaultPrevented,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
  container.listeners.get("keydown")?.(event);
  return event;
}

test("getFocusableElements excludes disabled, hidden, inert, and computed-invisible controls", () => {
  const enabled = createElement({ id: "enabled" });
  const disabled = createElement({ id: "disabled", disabled: true });
  const disabledByFieldset = createElement({ id: "disabled-fieldset", disabledByFieldset: true });
  const hidden = createElement({ id: "hidden", hidden: true });
  const ariaHidden = createElement({ id: "aria-hidden", ariaHidden: true });
  const hiddenAncestor = createElement({ id: "hidden-ancestor", hiddenAncestor: true });
  const inertAncestor = createElement({ id: "inert-ancestor", inertAncestor: true });
  const displayNone = createElement({ id: "display-none", display: "none" });
  const visibilityHidden = createElement({ id: "visibility-hidden", visibility: "hidden" });
  const invisible = createElement({ id: "invisible", visible: false });
  const container = createContainer([
    enabled,
    disabled,
    disabledByFieldset,
    hidden,
    ariaHidden,
    hiddenAncestor,
    inertAncestor,
    displayNone,
    visibilityHidden,
    invisible
  ]);

  assert.deepEqual(getFocusableElements(container), [enabled]);
});

test("getFocusableElements keeps fixed-like controls with visible client rects", () => {
  const fixedLike = createElement({ id: "fixed-like" });
  fixedLike.offsetParent = null;
  const container = createContainer([fixedLike]);

  assert.deepEqual(getFocusableElements(container), [fixedLike]);
});

test("activate stores return focus, focuses the first control, and listens once", () => {
  const trigger = createElement({ id: "trigger" });
  const first = createElement({ id: "first" });
  const second = createElement({ id: "second" });
  const container = createContainer([first, second], trigger);
  trigger.ownerDocument = container.ownerDocument;
  const trap = createFocusTrap({ container });

  trap.activate();
  trap.activate();

  assert.equal(trap.getReturnFocus(), trigger);
  assert.equal(first.focusCalls, 1);
  assert.equal(container.addCalls, 1);
  assert.equal(container.listeners.has("keydown"), true);
});

test("activate prefers a caller-provided return focus element", () => {
  const active = createElement({ id: "active" });
  const explicit = createElement({ id: "explicit" });
  const first = createElement({ id: "first" });
  const container = createContainer([first], active);
  const trap = createFocusTrap({ container, returnFocus: explicit });

  trap.activate();

  assert.equal(trap.getReturnFocus(), explicit);
});

test("activate focuses the container and captures Tab and Escape when no controls exist", () => {
  const container = createContainer([]);
  let escapeCalls = 0;
  const trap = createFocusTrap({
    container,
    onEscape() {
      escapeCalls += 1;
    }
  });

  trap.activate();
  const tabEvent = dispatchKey(container, "Tab");
  const escapeEvent = dispatchKey(container, "Escape");

  assert.equal(container.focusCalls, 1);
  assert.equal(container.ownerDocument.activeElement, container);
  assert.equal(tabEvent.defaultPrevented, true);
  assert.equal(escapeEvent.defaultPrevented, true);
  assert.equal(escapeCalls, 1);
});

test("Tab wraps from the last control to the first control", () => {
  const first = createElement({ id: "first" });
  const last = createElement({ id: "last" });
  const container = createContainer([first, last]);
  const trap = createFocusTrap({ container });
  trap.activate();
  container.ownerDocument.activeElement = last;

  const event = dispatchKey(container, "Tab");

  assert.equal(event.defaultPrevented, true);
  assert.equal(container.ownerDocument.activeElement, first);
});

test("Shift+Tab wraps from the first control to the last control", () => {
  const first = createElement({ id: "first" });
  const last = createElement({ id: "last" });
  const container = createContainer([first, last]);
  const trap = createFocusTrap({ container });
  trap.activate();

  const event = dispatchKey(container, "Tab", { shiftKey: true });

  assert.equal(event.defaultPrevented, true);
  assert.equal(container.ownerDocument.activeElement, last);
});

test("Tab within the focusable range keeps native keyboard movement", () => {
  const first = createElement({ id: "first" });
  const middle = createElement({ id: "middle" });
  const last = createElement({ id: "last" });
  const container = createContainer([first, middle, last]);
  const trap = createFocusTrap({ container });
  trap.activate();
  container.ownerDocument.activeElement = middle;

  const event = dispatchKey(container, "Tab");

  assert.equal(event.defaultPrevented, false);
});

test("Escape is prevented and delegates closing without restoring focus", () => {
  const trigger = createElement({ id: "trigger" });
  const first = createElement({ id: "first" });
  const container = createContainer([first], trigger);
  trigger.ownerDocument = container.ownerDocument;
  let escapeCalls = 0;
  const trap = createFocusTrap({
    container,
    onEscape() {
      escapeCalls += 1;
    }
  });
  trap.activate();

  const event = dispatchKey(container, "Escape");

  assert.equal(event.defaultPrevented, true);
  assert.equal(escapeCalls, 1);
  assert.equal(trigger.focusCalls, 0);
});

test("unhandled keys are not prevented", () => {
  const first = createElement({ id: "first" });
  const container = createContainer([first]);
  const trap = createFocusTrap({ container });
  trap.activate();

  const event = dispatchKey(container, "Enter");

  assert.equal(event.defaultPrevented, false);
});

test("default-prevented events are ignored for nested focus traps", () => {
  const first = createElement({ id: "first" });
  const last = createElement({ id: "last" });
  const container = createContainer([first, last]);
  let escapeCalls = 0;
  const trap = createFocusTrap({
    container,
    onEscape() {
      escapeCalls += 1;
    }
  });
  trap.activate();
  container.ownerDocument.activeElement = last;

  dispatchKey(container, "Tab", { defaultPrevented: true });
  dispatchKey(container, "Escape", { defaultPrevented: true });

  assert.equal(first.focusCalls, 1);
  assert.equal(container.ownerDocument.activeElement, last);
  assert.equal(escapeCalls, 0);
});

test("deactivate is idempotent and removes the keydown listener", () => {
  const first = createElement({ id: "first" });
  const container = createContainer([first]);
  const trap = createFocusTrap({ container });
  trap.activate();

  trap.deactivate();
  trap.deactivate();

  assert.equal(container.removeCalls, 1);
  assert.equal(container.listeners.has("keydown"), false);
});

function getSettingsPanel(html, id, nextId) {
  const start = html.indexOf(`id="${id}"`);
  const end = nextId ? html.indexOf(`id="${nextId}"`, start) : html.indexOf('<footer class="drawer-footer"', start);
  assert.ok(start >= 0, `${id} should exist`);
  assert.ok(end > start, `${id} should end before ${nextId || "the drawer footer"}`);
  return html.slice(start, end);
}

test("settings drawer markup defines an accessible four-panel navigation", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const drawerTag = html.match(/<aside\b[^>]*id="settingsDrawer"[^>]*>/)?.[0] ?? "";
  const drawerPanelTag = html.match(/<section\b[^>]*class="drawer-panel"[^>]*>/)?.[0] ?? "";

  assert.match(drawerTag, /role="dialog"/);
  assert.match(drawerTag, /aria-modal="true"/);
  assert.match(drawerPanelTag, /tabindex="-1"/);
  assert.match(html, /class="settings-section-tabs"[^>]*role="tablist"/);

  const sections = [
    ["general", "settingsGeneral", "true", false],
    ["shortcuts", "settingsShortcuts", "false", true],
    ["models", "settingsModels", "false", true],
    ["advanced", "settingsAdvanced", "false", true]
  ];

  for (const [section, panelId, selected, hidden] of sections) {
    const button = html.match(new RegExp(`<button(?=[^>]*data-settings-section="${section}")[^>]*>`))?.[0] ?? "";
    const panel = html.match(new RegExp(`<section(?=[^>]*id="${panelId}")(?=[^>]*data-settings-panel="${section}")[^>]*>`))?.[0] ?? "";
    assert.match(button, /role="tab"/);
    assert.match(button, new RegExp(`aria-controls="${panelId}"`));
    assert.match(button, new RegExp(`aria-selected="${selected}"`));
    assert.match(panel, /role="tabpanel"/);
    if (hidden) assert.match(panel, /\shidden(?:\s|>)/);
    else assert.doesNotMatch(panel, /\shidden(?:\s|>)/);
  }
});

test("settings panels own the required existing fields", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const general = getSettingsPanel(html, "settingsGeneral", "settingsShortcuts");
  const shortcuts = getSettingsPanel(html, "settingsShortcuts", "settingsModels");
  const models = getSettingsPanel(html, "settingsModels", "settingsAdvanced");
  const advanced = getSettingsPanel(html, "settingsAdvanced");

  for (const id of [
    "interfaceLanguage",
    "polishMode",
    "pasteAfterTranscribe",
    "manageDictionary",
    "launchAtLogin",
    "startMinimizedToTray"
  ]) assert.match(general, new RegExp(`id="${id}"`), `General: ${id}`);

  for (const id of [
    "hotkey",
    "recordHotkey",
    "shortcutMode",
    "pasteLastHotkey",
    "recordPasteLastHotkey",
    "globalShortcutPaused",
    "shortcutCaptureHint"
  ]) assert.match(shortcuts, new RegExp(`id="${id}"`), `Shortcuts: ${id}`);

  for (const id of [
    "localModelStatus",
    "providerStatusText",
    "llmProvider",
    "ollamaEnabled",
    "installWhisper",
    "installLlm",
    "refreshSetupStatus",
    "cancelSetup",
    "checkMicrophone",
    "checkWhisper",
    "checkTextProvider"
  ]) assert.match(models, new RegExp(`id="${id}"`), `Models: ${id}`);

  for (const id of [
    "setupOutput",
    "microphoneDiagnosticsList",
    "diagnosticsList",
    "textDiagnosticsList"
  ]) assert.match(advanced, new RegExp(`id="${id}"`), `Advanced: ${id}`);

  for (const privateId of [
    "setupOutput",
    "embeddedLlmCliPath",
    "embeddedLlmModelPath",
    "whisperCliPath",
    "whisperModelPath",
    "whisperRuntimeUrl",
    "ollamaBaseUrl"
  ]) assert.doesNotMatch(models, new RegExp(`id="${privateId}"`), `Models excludes ${privateId}`);

  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>") + 7);
  assert.doesNotMatch(main, /id="(?:setupOutput|embeddedLlmCliPath|whisperCliPath|whisperRuntimeUrl|ollamaBaseUrl)"/);
  assert.doesNotMatch(
    html,
    /id="(?:embeddedLlmCliPath|embeddedLlmModelPath|localModelInstallCommand|whisperCliPath|whisperModelPath|whisperRuntimeUrl|whisperRuntimeMirrorUrls|whisperModelUrl|whisperModelMirrorUrls|llamaRuntimeUrl|llamaRuntimeMirrorUrls|qwenModelUrl|qwenModelMirrorUrls|ollamaBaseUrl)"/
  );
});

test("settings drawer keeps one fixed save footer and an independently scrolling body", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const form = html.slice(html.indexOf('<form id="settingsForm"'), html.indexOf("</form>") + 7);

  assert.match(form, /class="drawer-scroll-region"/);
  assert.match(form, /<footer class="drawer-footer">[\s\S]*<button[^>]*type="submit"/);
  assert.equal((form.match(/type="submit"/g) || []).length, 1);
  assert.match(styles, /\.drawer-panel\s*\{[^}]*width:\s*min\(560px,\s*100vw\)/s);
  assert.match(styles, /\.drawer-scroll-region\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.drawer-footer\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
});
