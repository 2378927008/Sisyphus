const modifierKeys = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
  "OS",
  "Shift"
]);

const namedKeys = new Map([
  ["Backspace", "Backspace"],
  ["Delete", "Delete"],
  ["End", "End"],
  ["Enter", "Enter"],
  ["Escape", "Escape"],
  ["Home", "Home"],
  ["Insert", "Insert"],
  ["PageDown", "PageDown"],
  ["PageUp", "PageUp"],
  ["Space", "Space"],
  ["Spacebar", "Space"],
  ["Tab", "Tab"],
  [" ", "Space"]
]);

export function buildShortcutFromKeyboardEvent(event = {}) {
  const key = normalizeKeyboardKey(event);
  if (!key) {
    return "";
  }

  return [...getModifierTokens(event), key].join("+");
}

export function buildShortcutFromMouseEvent(event = {}) {
  const button = normalizeBrowserMouseButton(event.button);
  if (!button) {
    return "";
  }

  return [...getModifierTokens(event), button].join("+");
}

export function createShortcutRecorder({
  eventTarget = globalThis.window,
  buttons = [],
  resolveField = () => null,
  translate = (key) => key,
  onStatus = () => {},
  defer = (callback) => globalThis.setTimeout(callback, 0)
} = {}) {
  const recordButtons = [...buttons];
  let active = null;

  function start(button) {
    if (!button) {
      return false;
    }

    if (active?.button === button && !active.completed) {
      cancel();
      return false;
    }

    cleanup(active);
    const field = resolveField(button.dataset?.shortcutTarget);
    if (!field || !eventTarget?.addEventListener) {
      return false;
    }

    active = {
      button,
      completed: false,
      disabledStates: new Map(recordButtons.map((item) => [item, Boolean(item.disabled)])),
      field,
      mouseCapture: false
    };

    for (const item of recordButtons) {
      item.disabled = item !== button;
    }
    button.classList?.add("is-listening");
    button.setAttribute?.("aria-pressed", "true");
    field.setAttribute?.("aria-busy", "true");
    field.focus?.();
    addListeners();
    refreshLabels();
    onStatus(translate("status.shortcutCaptureListening"));
    return true;
  }

  function cancel({ announce = true } = {}) {
    if (!active) {
      return false;
    }

    const session = active;
    if (announce && !session.completed) {
      onStatus(translate("status.shortcutCaptureCancelled"));
    }
    cleanup(session);
    return true;
  }

  function stop() {
    return cancel({ announce: false });
  }

  function isActive() {
    return Boolean(active);
  }

  function refreshLabels() {
    for (const button of recordButtons) {
      const key = active?.button === button && !active.completed
        ? "action.listeningShortcut"
        : button.dataset?.i18n || "action.recordShortcut";
      button.textContent = translate(key);
    }
  }

  function handleKeyDown(event) {
    if (!active || active.completed) {
      return;
    }

    stopEvent(event);
    if (event.key === "Escape") {
      cancel();
      return;
    }
    if (event.repeat) {
      return;
    }

    const shortcut = buildShortcutFromKeyboardEvent(event);
    if (shortcut) {
      commit(shortcut);
    }
  }

  function handleMouseDown(event) {
    if (!active || active.completed) {
      return;
    }

    const shortcut = buildShortcutFromMouseEvent(event);
    if (!shortcut) {
      return;
    }

    stopEvent(event);
    active.mouseCapture = true;
    commit(shortcut, { deferCleanup: true });
  }

  function handleMouseContinuation(event) {
    if (!active?.mouseCapture || !normalizeBrowserMouseButton(event.button)) {
      return;
    }

    stopEvent(event);
  }

  function commit(shortcut, { deferCleanup = false } = {}) {
    if (!active || active.completed) {
      return;
    }

    const session = active;
    session.completed = true;
    session.field.value = shortcut;
    session.button.classList?.remove("is-listening");
    session.button.setAttribute?.("aria-pressed", "false");
    refreshLabels();
    onStatus(translate("status.shortcutCaptured", { hotkey: shortcut }));

    if (deferCleanup) {
      defer(() => cleanup(session));
    } else {
      cleanup(session);
    }
  }

  function addListeners() {
    eventTarget.addEventListener("keydown", handleKeyDown, true);
    eventTarget.addEventListener("mousedown", handleMouseDown, true);
    eventTarget.addEventListener("mouseup", handleMouseContinuation, true);
    eventTarget.addEventListener("auxclick", handleMouseContinuation, true);
  }

  function removeListeners() {
    eventTarget?.removeEventListener?.("keydown", handleKeyDown, true);
    eventTarget?.removeEventListener?.("mousedown", handleMouseDown, true);
    eventTarget?.removeEventListener?.("mouseup", handleMouseContinuation, true);
    eventTarget?.removeEventListener?.("auxclick", handleMouseContinuation, true);
  }

  function cleanup(session) {
    if (!session || active !== session) {
      return;
    }

    removeListeners();
    session.button.classList?.remove("is-listening");
    session.button.setAttribute?.("aria-pressed", "false");
    session.field.removeAttribute?.("aria-busy");
    for (const button of recordButtons) {
      button.disabled = session.disabledStates.get(button) || false;
    }
    active = null;
    refreshLabels();
  }

  return {
    cancel,
    isActive,
    refreshLabels,
    start,
    stop
  };
}

function normalizeKeyboardKey(event) {
  if (modifierKeys.has(event.key)) {
    return "";
  }

  const code = String(event.code || "");
  const letterMatch = /^Key([A-Z])$/.exec(code);
  if (letterMatch) {
    return letterMatch[1];
  }

  const digitMatch = /^Digit([0-9])$/.exec(code);
  if (digitMatch) {
    return digitMatch[1];
  }

  const functionKey = /^(F(?:[1-9]|1[0-9]|2[0-4]))$/.exec(code)
    || /^(F(?:[1-9]|1[0-9]|2[0-4]))$/.exec(String(event.key || ""));
  if (functionKey) {
    return functionKey[1];
  }

  const namedKey = namedKeys.get(code) || namedKeys.get(event.key);
  if (namedKey) {
    return namedKey;
  }

  const key = String(event.key || "");
  return /^[a-z0-9]$/i.test(key) ? key.toUpperCase() : "";
}

function normalizeBrowserMouseButton(button) {
  if (button === 3 || button === "3" || button === "Mouse4") {
    return "Mouse4";
  }
  if (button === 4 || button === "4" || button === "Mouse5") {
    return "Mouse5";
  }
  return "";
}

function getModifierTokens(event) {
  const modifiers = [];
  if (event.ctrlKey || event.metaKey) {
    modifiers.push("CommandOrControl");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }
  return modifiers;
}

function stopEvent(event) {
  event.preventDefault?.();
  event.stopPropagation?.();
  event.stopImmediatePropagation?.();
}
