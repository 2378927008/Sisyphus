import { pasteText } from "./paste.js";

const defaultMaxLength = 100000;
const pasteFailureMessage = "Paste failed. Text copied.";

export function normalizeInsertText(value, maxLength = defaultMaxLength) {
  if (typeof value !== "string") {
    throw new TypeError("Insert text must be a string.");
  }

  if (/^\s*$/u.test(value)) {
    throw new Error("Insert text must contain non-whitespace characters.");
  }

  if (Array.from(value).length > maxLength) {
    throw new RangeError(`Insert text exceeds the maximum of ${maxLength} code points.`);
  }

  return value;
}

export async function insertTextIntoPreviousApp(text, dependencies = {}) {
  const normalizedText = normalizeInsertText(text);
  const {
    mainWindow,
    clipboard,
    paste = pasteText,
    wait = waitForTimeout
  } = dependencies;

  try {
    if (!isUsableMainWindow(mainWindow)) {
      return windowUnavailableResult();
    }

    await mainWindow.hide();
  } catch {
    return windowUnavailableResult();
  }

  try {
    await wait(140);
  } catch {
    return pasteFailureResult();
  }

  try {
    if (!isUsableMainWindow(mainWindow) || !isMainWindowStillHidden(mainWindow)) {
      return windowUnavailableResult();
    }
  } catch {
    return windowUnavailableResult();
  }

  try {
    await paste(normalizedText, { clipboard });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: normalizePasteFailureReason(error?.code),
      message: pasteFailureMessage
    };
  }
}

function waitForTimeout(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function windowUnavailableResult() {
  return {
    ok: false,
    reason: "window_unavailable",
    message: pasteFailureMessage
  };
}

function pasteFailureResult() {
  return {
    ok: false,
    reason: "paste_failed",
    message: pasteFailureMessage
  };
}

function isUsableMainWindow(mainWindow) {
  return Boolean(mainWindow && typeof mainWindow.hide === "function" && !mainWindow.isDestroyed?.());
}

function isMainWindowStillHidden(mainWindow) {
  return mainWindow.isVisible?.() !== true && mainWindow.isFocused?.() !== true;
}

function normalizePasteFailureReason(reason) {
  return reason === "clipboard_unavailable" || reason === "paste_failed"
    ? reason
    : "paste_failed";
}
