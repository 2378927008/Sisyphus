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
    if (!mainWindow || typeof mainWindow.hide !== "function" || mainWindow.isDestroyed?.()) {
      return windowUnavailableResult();
    }

    await mainWindow.hide();
  } catch {
    return windowUnavailableResult();
  }

  await wait(140);

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

function normalizePasteFailureReason(reason) {
  return reason === "clipboard_unavailable" || reason === "paste_failed"
    ? reason
    : "paste_failed";
}
