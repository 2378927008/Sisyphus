const modifierTokens = new Map([
  ["alt", "alt"],
  ["option", "alt"],
  ["shift", "shift"],
  ["ctrl", "control"],
  ["control", "control"],
  ["cmd", "meta"],
  ["command", "meta"],
  ["meta", "meta"],
  ["win", "meta"],
  ["windows", "meta"],
  ["commandorcontrol", "commandOrControl"],
  ["cmdorctrl", "commandOrControl"]
]);

const keyAliases = new Map([
  ["esc", "Escape"],
  ["escape", "Escape"],
  ["space", "Space"],
  ["spacebar", "Space"],
  ["return", "Enter"],
  ["enter", "Enter"],
  ["delete", "Delete"],
  ["backspace", "Backspace"],
  ["tab", "Tab"]
]);

export function createNativeInputShortcut({
  uIOhook,
  keyCodes = {},
  onError = () => {}
} = {}) {
  const registrations = new Map();
  const activeHolds = new Set();
  let started = false;
  let attached = false;

  const listeners = {
    keydown: (event) => handlePress("keyboard", event),
    keyup: (event) => handleRelease("keyboard", event),
    mousedown: (event) => handlePress("mouse", event),
    mouseup: (event) => handleRelease("mouse", event)
  };

  function register(hotkey, callback) {
    const parsed = parseNativeShortcut(hotkey, { keyCodes });
    if (
      !["Mouse4", "Mouse5"].includes(parsed?.mouseButton)
      || typeof callback !== "function"
    ) {
      return false;
    }

    return registerPressAndRelease(hotkey, {
      onPress: callback,
      onRelease: () => {}
    });
  }

  function registerPressAndRelease(hotkey, handlers = {}) {
    const parsed = parseNativeShortcut(hotkey, { keyCodes });
    if (!parsed) {
      return false;
    }

    const registration = {
      parsed,
      onPress: typeof handlers.onPress === "function" ? handlers.onPress : () => {},
      onRelease: typeof handlers.onRelease === "function" ? handlers.onRelease : () => {}
    };

    registrations.set(parsed.raw, registration);
    try {
      ensureStarted();
    } catch (error) {
      registrations.delete(parsed.raw);
      onError(error);
      return false;
    }
    return true;
  }

  function unregister(hotkey) {
    const parsed = parseNativeShortcut(hotkey, { keyCodes });
    registrations.delete(parsed?.raw || String(hotkey || "").trim());
    activeHolds.delete(parsed?.raw || String(hotkey || "").trim());
    stopIfIdle();
  }

  function unregisterAll() {
    registrations.clear();
    activeHolds.clear();
    stopIfIdle();
  }

  function getRegisteredHotkeys() {
    return [...registrations.keys()];
  }

  function ensureStarted() {
    if (!uIOhook) {
      throw new Error("Native input hook is unavailable.");
    }

    if (!attached) {
      for (const [eventName, listener] of Object.entries(listeners)) {
        uIOhook.on(eventName, listener);
      }
      attached = true;
    }

    if (!started) {
      uIOhook.start();
      started = true;
    }
  }

  function stopIfIdle() {
    if (registrations.size || !started) {
      return;
    }

    uIOhook?.stop?.();
    started = false;
  }

  function handlePress(kind, event) {
    for (const registration of registrations.values()) {
      if (!matchesShortcut(registration.parsed, kind, event)) {
        continue;
      }

      if (activeHolds.has(registration.parsed.raw)) {
        continue;
      }

      activeHolds.add(registration.parsed.raw);
      registration.onPress(event);
    }
  }

  function handleRelease(kind, event) {
    for (const registration of registrations.values()) {
      if (!matchesShortcut(registration.parsed, kind, event) || !activeHolds.has(registration.parsed.raw)) {
        continue;
      }

      activeHolds.delete(registration.parsed.raw);
      registration.onRelease(event);
    }
  }

  return {
    register,
    registerPressAndRelease,
    unregister,
    unregisterAll,
    getRegisteredHotkeys
  };
}

export async function createNativeInputShortcutFromPackage({
  platform = process.platform,
  importHook = () => import("uiohook-napi"),
  onError = () => {}
} = {}) {
  if (platform !== "win32") {
    return null;
  }

  try {
    const module = await importHook();
    const uIOhook = module.uIOhook || module.default?.uIOhook;
    const keyCodes = module.UiohookKey || module.default?.UiohookKey || {};
    return createNativeInputShortcut({ uIOhook, keyCodes, onError });
  } catch (error) {
    onError(error);
    return null;
  }
}

export function parseNativeShortcut(hotkey, { keyCodes = {} } = {}) {
  const raw = String(hotkey || "").trim().replace(/\s*\+\s*/g, "+");
  if (!raw) {
    return null;
  }

  const modifiers = {
    alt: false,
    commandOrControl: false,
    control: false,
    meta: false,
    shift: false
  };
  let triggerToken = "";

  for (const token of raw.split("+")) {
    const normalizedToken = token.toLowerCase().replace(/[^a-z0-9]/g, "");
    const modifier = modifierTokens.get(normalizedToken);
    if (modifier) {
      modifiers[modifier] = true;
      continue;
    }

    if (triggerToken) {
      return null;
    }
    triggerToken = token;
  }

  const mouseButton = normalizeMouseButtonToken(triggerToken);
  if (mouseButton) {
    return {
      raw,
      kind: "mouse",
      keyName: "",
      keycode: null,
      mouseButton,
      modifiers
    };
  }

  const keyName = normalizeKeyName(triggerToken, keyCodes);
  const keycode = keyCodes[keyName];
  if (!keyName || typeof keycode !== "number") {
    return null;
  }

  return {
    raw,
    kind: "keyboard",
    keyName,
    keycode,
    mouseButton: "",
    modifiers
  };
}

function matchesShortcut(shortcut, kind, event = {}) {
  if (shortcut.kind !== kind || !matchesModifiers(shortcut.modifiers, event)) {
    return false;
  }

  if (kind === "keyboard") {
    return event.keycode === shortcut.keycode;
  }

  return normalizeMouseButtonEvent(event.button) === shortcut.mouseButton;
}

function matchesModifiers(modifiers, event) {
  if (modifiers.commandOrControl) {
    if (!event.ctrlKey && !event.metaKey) {
      return false;
    }
  } else if (Boolean(event.ctrlKey) !== modifiers.control || Boolean(event.metaKey) !== modifiers.meta) {
    return false;
  }

  return Boolean(event.altKey) === modifiers.alt && Boolean(event.shiftKey) === modifiers.shift;
}

function normalizeKeyName(token, keyCodes) {
  const compact = String(token || "").trim();
  if (!compact) {
    return "";
  }

  const alias = keyAliases.get(compact.toLowerCase());
  if (alias) {
    return alias;
  }

  if (compact.length === 1) {
    return compact.toUpperCase();
  }

  const lower = compact.toLowerCase();
  return Object.keys(keyCodes).find((name) => name.toLowerCase() === lower) || "";
}

function normalizeMouseButtonToken(token) {
  const normalized = String(token || "").trim().toLowerCase();
  if (/^mouse[1-5]$/.test(normalized)) {
    return `Mouse${normalized.at(-1)}`;
  }

  if (normalized === "xbutton1") return "Mouse4";
  if (normalized === "xbutton2") return "Mouse5";
  return "";
}

function normalizeMouseButtonEvent(button) {
  if (button === 4 || button === "4") return "Mouse4";
  if (button === 5 || button === "5") return "Mouse5";

  const normalized = String(button || "").trim().toLowerCase();
  if (normalized === "mouse4" || normalized === "button4" || normalized === "xbutton1") return "Mouse4";
  if (normalized === "mouse5" || normalized === "button5" || normalized === "xbutton2") return "Mouse5";
  return "";
}
