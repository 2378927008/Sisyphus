import { toRendererHistoryActionResult } from "./product-ui-results.js";

const invalidRequestResult = { ok: false, reason: "invalid_request" };
const maxHistoryIdLength = 128;
const maxHistoryTextLength = 100000;

export function wireHistoryIpc({
  ipcMain,
  historyActions
}) {
  ipcMain.handle("history:update", async (event, payload) => {
    if (!isValidHistoryUpdatePayload(payload)) {
      return invalidRequestResult;
    }
    return toRendererHistoryActionResult(
      await historyActions.updateText(payload.id, payload.text)
    );
  });

  ipcMain.handle("history:reprocess", async (event, id) => {
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > maxHistoryIdLength
    ) {
      return invalidRequestResult;
    }
    return toRendererHistoryActionResult(await historyActions.reprocess(id));
  });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  try {
    return Object.getPrototypeOf(value) === Object.prototype;
  } catch {
    return false;
  }
}

function isValidHistoryUpdatePayload(payload) {
  return Boolean(
    isPlainObject(payload) &&
    Object.hasOwn(payload, "id") &&
    typeof payload.id === "string" &&
    payload.id.trim() &&
    payload.id.length <= maxHistoryIdLength &&
    Object.hasOwn(payload, "text") &&
    typeof payload.text === "string" &&
    payload.text.length <= maxHistoryTextLength
  );
}
