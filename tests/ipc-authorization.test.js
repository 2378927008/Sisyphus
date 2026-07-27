import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { isAuthorizedWindowSender } from "../src/main/ipc-authorization.js";

test("accepts only the current live window webContents", () => {
  const webContents = { isDestroyed: () => false };
  const window = { isDestroyed: () => false, webContents };

  assert.equal(isAuthorizedWindowSender({ sender: webContents }, window), true);
  assert.equal(isAuthorizedWindowSender({ sender: {} }, window), false);
});

test("rejects destroyed windows and destroyed webContents", () => {
  const sender = { isDestroyed: () => false };

  assert.equal(isAuthorizedWindowSender({ sender }, {
    isDestroyed: () => true,
    webContents: sender
  }), false);
  assert.equal(isAuthorizedWindowSender({ sender }, {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => true }
  }), false);
});

test("rejects malformed IPC events and missing windows", () => {
  const webContents = { isDestroyed: () => false };
  const window = { isDestroyed: () => false, webContents };

  assert.equal(isAuthorizedWindowSender(null, window), false);
  assert.equal(isAuthorizedWindowSender({}, window), false);
  assert.equal(isAuthorizedWindowSender({ sender: webContents }, null), false);
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
