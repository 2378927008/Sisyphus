import { isAuthorizedWindowSender } from "./ipc-authorization.js";

const unauthorizedResult = { ok: false, reason: "unauthorized" };
const invalidRequestResult = { ok: false, reason: "invalid_request" };

export function wireHistoryIpc({
  ipcMain,
  getMainWindow,
  historyActions
}) {
  ipcMain.handle("history:update", async (event, payload) => {
    if (!isAuthorizedWindowSender(event, getMainWindow())) {
      return unauthorizedResult;
    }
    if (!isPlainObject(payload)) {
      return invalidRequestResult;
    }
    return historyActions.updateText(payload.id, payload.text);
  });

  ipcMain.handle("history:reprocess", async (event, id) => {
    if (!isAuthorizedWindowSender(event, getMainWindow())) {
      return unauthorizedResult;
    }
    if (typeof id !== "string" || !id.trim()) {
      return invalidRequestResult;
    }
    return historyActions.reprocess(id);
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
