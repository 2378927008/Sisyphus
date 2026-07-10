import test from "node:test";
import assert from "node:assert/strict";

const moduleUrl = new URL("../src/renderer/shortcut-recorder.js", import.meta.url);

test("builds stable keyboard accelerator strings", async () => {
  const { buildShortcutFromKeyboardEvent } = await import(moduleUrl);

  assert.equal(buildShortcutFromKeyboardEvent({
    key: " ",
    code: "Space",
    ctrlKey: true,
    altKey: true
  }), "CommandOrControl+Alt+Space");
  assert.equal(buildShortcutFromKeyboardEvent({
    key: "v",
    code: "KeyV",
    ctrlKey: true,
    shiftKey: true
  }), "CommandOrControl+Shift+V");
  assert.equal(buildShortcutFromKeyboardEvent({ key: "F8", code: "F8" }), "F8");
  assert.equal(buildShortcutFromKeyboardEvent({ key: "Control", code: "ControlLeft", ctrlKey: true }), "");
  assert.equal(buildShortcutFromKeyboardEvent({ key: "Dead", code: "Quote" }), "");
});

test("maps browser side-button events to native mouse shortcuts", async () => {
  const { buildShortcutFromMouseEvent } = await import(moduleUrl);

  assert.equal(buildShortcutFromMouseEvent({ button: 3 }), "Mouse4");
  assert.equal(buildShortcutFromMouseEvent({ button: 4 }), "Mouse5");
  assert.equal(buildShortcutFromMouseEvent({ button: 3, ctrlKey: true }), "CommandOrControl+Mouse4");
  assert.equal(buildShortcutFromMouseEvent({ button: 0 }), "");
});

test("captures a keyboard shortcut and restores recorder controls", async () => {
  const { createShortcutRecorder } = await import(moduleUrl);
  const harness = createHarness(createShortcutRecorder);

  assert.equal(harness.recorder.start(harness.hotkeyButton), true);
  assert.equal(harness.hotkeyButton.classList.contains("is-listening"), true);
  assert.equal(harness.pasteButton.disabled, true);

  const modifierEvent = createInputEvent({ key: "Control", code: "ControlLeft", ctrlKey: true });
  harness.eventTarget.dispatch("keydown", modifierEvent);
  assert.equal(harness.recorder.isActive(), true);
  assert.equal(harness.hotkeyField.value, "CommandOrControl+Alt+Space");

  const shortcutEvent = createInputEvent({
    key: "v",
    code: "KeyV",
    ctrlKey: true,
    altKey: true
  });
  harness.eventTarget.dispatch("keydown", shortcutEvent);

  assert.equal(shortcutEvent.defaultPrevented, true);
  assert.equal(harness.hotkeyField.value, "CommandOrControl+Alt+V");
  assert.equal(harness.recorder.isActive(), false);
  assert.equal(harness.hotkeyButton.classList.contains("is-listening"), false);
  assert.equal(harness.pasteButton.disabled, false);
  assert.match(harness.statuses.at(-1), /CommandOrControl\+Alt\+V/);
});

test("Escape cancels capture without changing the field", async () => {
  const { createShortcutRecorder } = await import(moduleUrl);
  const harness = createHarness(createShortcutRecorder);

  harness.recorder.start(harness.pasteButton);
  const escapeEvent = createInputEvent({ key: "Escape", code: "Escape" });
  harness.eventTarget.dispatch("keydown", escapeEvent);

  assert.equal(escapeEvent.defaultPrevented, true);
  assert.equal(harness.pasteField.value, "CommandOrControl+Alt+V");
  assert.equal(harness.recorder.isActive(), false);
  assert.equal(harness.statuses.at(-1), "Shortcut recording cancelled.");
});

test("mouse capture suppresses navigation until the click sequence finishes", async () => {
  const { createShortcutRecorder } = await import(moduleUrl);
  const harness = createHarness(createShortcutRecorder);

  harness.recorder.start(harness.hotkeyButton);
  const mouseDown = createInputEvent({ button: 3 });
  harness.eventTarget.dispatch("mousedown", mouseDown);

  assert.equal(mouseDown.defaultPrevented, true);
  assert.equal(harness.hotkeyField.value, "Mouse4");
  assert.equal(harness.recorder.isActive(), true);
  assert.equal(harness.deferred.length, 1);

  const auxClick = createInputEvent({ button: 3 });
  harness.eventTarget.dispatch("auxclick", auxClick);
  assert.equal(auxClick.defaultPrevented, true);

  harness.deferred.shift()();
  assert.equal(harness.recorder.isActive(), false);
});

function createHarness(createShortcutRecorder) {
  const eventTarget = createFakeEventTarget();
  const deferred = [];
  const statuses = [];
  const hotkeyField = createFakeElement({ value: "CommandOrControl+Alt+Space" });
  const pasteField = createFakeElement({ value: "CommandOrControl+Alt+V" });
  const hotkeyButton = createFakeElement({
    dataset: { shortcutTarget: "hotkey", i18n: "action.recordShortcut" },
    textContent: "Record"
  });
  const pasteButton = createFakeElement({
    dataset: { shortcutTarget: "pasteLastHotkey", i18n: "action.recordShortcut" },
    textContent: "Record"
  });
  const fields = new Map([
    ["hotkey", hotkeyField],
    ["pasteLastHotkey", pasteField]
  ]);
  const messages = {
    "action.recordShortcut": "Record",
    "action.listeningShortcut": "Listening...",
    "status.shortcutCaptureListening": "Press a shortcut. Press Esc to cancel.",
    "status.shortcutCaptured": "Shortcut captured: {hotkey}. Save settings to apply.",
    "status.shortcutCaptureCancelled": "Shortcut recording cancelled."
  };
  const translate = (key, replacements = {}) => Object.entries(replacements).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    messages[key] || key
  );
  const recorder = createShortcutRecorder({
    eventTarget,
    buttons: [hotkeyButton, pasteButton],
    resolveField: (name) => fields.get(name),
    translate,
    onStatus: (message) => statuses.push(message),
    defer: (callback) => deferred.push(callback)
  });

  return {
    deferred,
    eventTarget,
    hotkeyButton,
    hotkeyField,
    pasteButton,
    pasteField,
    recorder,
    statuses
  };
}

function createFakeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const group = listeners.get(type) || new Set();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event) {
      for (const listener of [...(listeners.get(type) || [])]) {
        listener(event);
      }
    }
  };
}

function createFakeElement({ dataset = {}, textContent = "", value = "" } = {}) {
  const classes = new Set();
  const attributes = new Map();
  return {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name))
    },
    dataset,
    disabled: false,
    focus() {},
    removeAttribute(name) {
      attributes.delete(name);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    textContent,
    value
  };
}

function createInputEvent(properties = {}) {
  return {
    altKey: false,
    button: -1,
    code: "",
    ctrlKey: false,
    defaultPrevented: false,
    key: "",
    metaKey: false,
    repeat: false,
    shiftKey: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {},
    stopPropagation() {},
    ...properties
  };
}
