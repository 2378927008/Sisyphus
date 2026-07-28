import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as ipcAuthorization from "../src/main/ipc-authorization.js";

test("accepts only the current live window webContents", () => {
  const approvedUrl = "file:///C:/app/src/renderer/index.html";
  const webContents = {
    isDestroyed: () => false,
    getURL: () => approvedUrl
  };
  const window = { isDestroyed: () => false, webContents };
  const event = createIpcEvent(webContents, approvedUrl);

  assert.equal(
    ipcAuthorization.isAuthorizedWindowSender(event, window, approvedUrl),
    true
  );
  assert.equal(
    ipcAuthorization.isAuthorizedWindowSender(
      createIpcEvent({ getURL: () => approvedUrl }, approvedUrl),
      window,
      approvedUrl
    ),
    false
  );
});

test("rejects destroyed windows and destroyed webContents", () => {
  const approvedUrl = "file:///C:/app/src/renderer/index.html";
  const sender = {
    isDestroyed: () => false,
    getURL: () => approvedUrl
  };
  const event = createIpcEvent(sender, approvedUrl);

  assert.equal(ipcAuthorization.isAuthorizedWindowSender(event, {
    isDestroyed: () => true,
    webContents: sender
  }, approvedUrl), false);
  assert.equal(ipcAuthorization.isAuthorizedWindowSender(event, {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => true }
  }, approvedUrl), false);
});

test("rejects malformed IPC events and missing windows", () => {
  const approvedUrl = "file:///C:/app/src/renderer/index.html";
  const webContents = {
    isDestroyed: () => false,
    getURL: () => approvedUrl
  };
  const window = { isDestroyed: () => false, webContents };

  assert.equal(ipcAuthorization.isAuthorizedWindowSender(null, window, approvedUrl), false);
  assert.equal(ipcAuthorization.isAuthorizedWindowSender({}, window, approvedUrl), false);
  assert.equal(
    ipcAuthorization.isAuthorizedWindowSender(
      createIpcEvent(webContents, approvedUrl),
      null,
      approvedUrl
    ),
    false
  );
});

test("rejects subframes and any URL other than the exact approved app page", () => {
  const approvedUrl = "file:///C:/app/src/renderer/index.html";
  const webContents = {
    isDestroyed: () => false,
    getURL: () => approvedUrl
  };
  const window = { isDestroyed: () => false, webContents };

  assert.equal(
    ipcAuthorization.isAuthorizedWindowSender(
      createIpcEvent(webContents, approvedUrl, { isMainFrame: false }),
      window,
      approvedUrl
    ),
    false
  );
  assert.equal(
    ipcAuthorization.isAuthorizedWindowSender(
      createIpcEvent(webContents, "file:///C:/app/src/renderer/other.html"),
      window,
      approvedUrl
    ),
    false
  );
  assert.equal(
    ipcAuthorization.isAuthorizedWindowSender(
      createIpcEvent({
        ...webContents,
        getURL: () => "file:///C:/app/src/renderer/other.html"
      }, approvedUrl),
      {
        ...window,
        webContents: {
          ...webContents,
          getURL: () => "file:///C:/app/src/renderer/other.html"
        }
      },
      approvedUrl
    ),
    false
  );
});

test("authorized IPC wrapper rejects bad senders and payloads before invoking handlers", async () => {
  assert.equal(typeof ipcAuthorization.createAuthorizedIpcMain, "function");
  const approvedUrl = "file:///C:/app/src/renderer/index.html";
  const rawHandlers = new Map();
  const webContents = {
    isDestroyed: () => false,
    getURL: () => approvedUrl
  };
  const window = { isDestroyed: () => false, webContents };
  const authorizedIpc = ipcAuthorization.createAuthorizedIpcMain({
    ipcMain: {
      handle: (channel, handler) => rawHandlers.set(channel, handler)
    },
    getWindow: () => window,
    getApprovedUrl: () => approvedUrl
  });
  let calls = 0;
  authorizedIpc.handle("dictation:insert-text", async (_event, text) => {
    calls += 1;
    return { ok: true, text };
  });
  const handler = rawHandlers.get("dictation:insert-text");

  assert.deepEqual(
    await handler(createIpcEvent({}, approvedUrl), "hello"),
    { ok: false, reason: "unauthorized" }
  );
  assert.deepEqual(
    await handler(
      createIpcEvent(webContents, approvedUrl, { isMainFrame: false }),
      "hello"
    ),
    { ok: false, reason: "unauthorized" }
  );
  assert.deepEqual(
    await handler(createIpcEvent(webContents, approvedUrl), "x".repeat(100001)),
    { ok: false, reason: "invalid_request" }
  );
  assert.deepEqual(
    await handler(createIpcEvent(webContents, approvedUrl), "hello"),
    { ok: true, text: "hello" }
  );
  assert.equal(calls, 1);
});

test("authorized IPC wrapper converts handler exceptions to a stable result", async () => {
  assert.equal(typeof ipcAuthorization.createAuthorizedIpcMain, "function");
  const approvedUrl = "file:///C:/app/src/renderer/index.html";
  const rawHandlers = new Map();
  const webContents = {
    isDestroyed: () => false,
    getURL: () => approvedUrl
  };
  const authorizedIpc = ipcAuthorization.createAuthorizedIpcMain({
    ipcMain: {
      handle: (channel, handler) => rawHandlers.set(channel, handler)
    },
    getWindow: () => ({ isDestroyed: () => false, webContents }),
    getApprovedUrl: () => approvedUrl
  });
  authorizedIpc.handle("settings:get", async () => {
    throw new Error("spawn C:\\private\\helper.exe ENOENT stderr https://secret.example");
  });

  const result = await rawHandlers.get("settings:get")(
    createIpcEvent(webContents, approvedUrl)
  );

  assert.deepEqual(result, { ok: false, reason: "operation_failed" });
});

test("preload exposes only narrow history mutation contracts", async () => {
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  const invoked = [];
  let exposedApi = null;
  const sandbox = {
    require: (moduleName) => {
      assert.equal(moduleName, "electron");
      return {
        contextBridge: {
          exposeInMainWorld: (_name, api) => {
            exposedApi = api;
          }
        },
        ipcRenderer: {
          invoke: (channel, payload) => {
            invoked.push({ channel, payload });
            return { channel, payload };
          },
          on: () => undefined,
          send: () => undefined
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: "preload.cjs" });

  assert.deepEqual(JSON.parse(JSON.stringify(await exposedApi.updateHistory("history-1", "edited text"))), {
    channel: "history:update",
    payload: { id: "history-1", text: "edited text" }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await exposedApi.reprocessHistory("history-1"))), {
    channel: "history:reprocess",
    payload: "history-1"
  });
  assert.equal(exposedApi.ipcRenderer, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(invoked)), [
    { channel: "history:update", payload: { id: "history-1", text: "edited text" } },
    { channel: "history:reprocess", payload: "history-1" }
  ]);
});

function createIpcEvent(sender, url, { isMainFrame = true } = {}) {
  const frame = { url };
  frame.top = isMainFrame ? frame : { url };
  return {
    sender,
    senderFrame: frame
  };
}
