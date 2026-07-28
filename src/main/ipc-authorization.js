import {
  MAIN_RENDERER_IPC_CHANNELS,
  validateIpcArguments
} from "./ipc-contracts.js";

const unauthorizedResult = Object.freeze({ ok: false, reason: "unauthorized" });
const invalidRequestResult = Object.freeze({ ok: false, reason: "invalid_request" });
const operationFailedResult = Object.freeze({ ok: false, reason: "operation_failed" });

export function isAuthorizedWindowSender(event, window, approvedUrl) {
  const senderFrame = event?.senderFrame;
  return Boolean(
    event?.sender &&
    senderFrame &&
    window &&
    typeof approvedUrl === "string" &&
    approvedUrl &&
    !window.isDestroyed?.() &&
    !window.webContents?.isDestroyed?.() &&
    event.sender === window.webContents &&
    senderFrame === senderFrame.top &&
    senderFrame.url === approvedUrl &&
    event.sender.getURL?.() === approvedUrl
  );
}

export function createAuthorizedIpcMain({
  ipcMain,
  getWindow = () => null,
  getApprovedUrl = () => ""
} = {}) {
  return {
    handle(channel, handler) {
      assertKnownChannel(channel);
      ipcMain.handle(channel, async (event, ...args) => {
        if (!isAuthorizedWindowSender(event, getWindow(), getApprovedUrl())) {
          return unauthorizedResult;
        }
        if (!validateIpcArguments(channel, args)) {
          return invalidRequestResult;
        }

        try {
          return await handler(event, ...args);
        } catch {
          return operationFailedResult;
        }
      });
    },
    on(channel, handler) {
      assertKnownChannel(channel);
      ipcMain.on(channel, (event, ...args) => {
        if (!isAuthorizedWindowSender(event, getWindow(), getApprovedUrl())) {
          return;
        }
        if (!validateIpcArguments(channel, args)) {
          return;
        }

        try {
          const result = handler(event, ...args);
          result?.catch?.(() => {});
        } catch {
          // Send-style IPC is best-effort and never returns diagnostics.
        }
      });
    }
  };
}

function assertKnownChannel(channel) {
  if (!MAIN_RENDERER_IPC_CHANNELS.has(channel)) {
    throw new Error(`Unknown privileged IPC channel: ${channel}`);
  }
}
