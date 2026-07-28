import assert from "node:assert/strict";
import test from "node:test";
import { wireHistoryIpc } from "../src/main/history-ipc.js";
import { createAuthorizedIpcMain } from "../src/main/ipc-authorization.js";

function createHarness({
  updateResult = { ok: false, reason: "history_changed" },
  reprocessResult = { ok: false, reason: "processing_failed" }
} = {}) {
  const handlers = new Map();
  const calls = {
    update: [],
    reprocess: []
  };
  const approvedUrl = "file:///C:/app/src/renderer/index.html";
  const webContents = {
    isDestroyed: () => false,
    getURL: () => approvedUrl
  };
  const mainWindow = {
    isDestroyed: () => false,
    webContents
  };
  const rawIpcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  const authorizedIpcMain = createAuthorizedIpcMain({
    ipcMain: rawIpcMain,
    getWindow: () => mainWindow,
    getApprovedUrl: () => approvedUrl
  });

  wireHistoryIpc({
    ipcMain: authorizedIpcMain,
    historyActions: {
      async updateText(id, text) {
        calls.update.push({ id, text });
        return updateResult;
      },
      async reprocess(id) {
        calls.reprocess.push(id);
        return reprocessResult;
      }
    }
  });

  return {
    calls,
    handlers,
    authorizedEvent: createIpcEvent(webContents, approvedUrl),
    unauthorizedEvent: createIpcEvent({}, approvedUrl)
  };
}

test("history handlers check sender authorization before validating requests", async () => {
  const { calls, handlers, unauthorizedEvent } = createHarness();

  const updateResult = await handlers.get("history:update")(unauthorizedEvent, null);
  const reprocessResult = await handlers.get("history:reprocess")(unauthorizedEvent, null);

  assert.deepEqual(updateResult, { ok: false, reason: "unauthorized" });
  assert.deepEqual(reprocessResult, { ok: false, reason: "unauthorized" });
  assert.deepEqual(calls.update, []);
  assert.deepEqual(calls.reprocess, []);
});

test("history update rejects non-plain payloads without calling history actions", async () => {
  const { calls, handlers, authorizedEvent } = createHarness();
  const invalidPayloads = [null, [], "history-1", 42, true, new Date(0)];

  for (const payload of invalidPayloads) {
    assert.deepEqual(
      await handlers.get("history:update")(authorizedEvent, payload),
      { ok: false, reason: "invalid_request" }
    );
  }

  assert.deepEqual(calls.update, []);
});

test("history update rejects missing or invalid fields without calling history actions", async (t) => {
  const inheritedTextPayload = new Proxy(
    Object.assign(
      Object.create({ text: "inherited text" }),
      { id: "history-1" }
    ),
    {
      getPrototypeOf: () => Object.prototype
    }
  );
  const cases = [
    ["missing text", { id: "history-1" }],
    ["missing id", { text: "edited text" }],
    ["blank id", { id: "   ", text: "edited text" }],
    ["non-string id", { id: 42, text: "edited text" }],
    ["non-string text", { id: "history-1", text: 42 }],
    ["inherited text", inheritedTextPayload]
  ];

  for (const [name, payload] of cases) {
    await t.test(name, async () => {
      const { calls, handlers, authorizedEvent } = createHarness();

      assert.deepEqual(
        await handlers.get("history:update")(authorizedEvent, payload),
        { ok: false, reason: "invalid_request" }
      );
      assert.deepEqual(calls.update, []);
    });
  }
});

test("history update passes an explicit empty text value to the action", async () => {
  const { calls, handlers, authorizedEvent } = createHarness();

  const result = await handlers.get("history:update")(
    authorizedEvent,
    { id: "history-1", text: "" }
  );

  assert.deepEqual(result, { ok: false, reason: "history_changed" });
  assert.deepEqual(calls.update, [{ id: "history-1", text: "" }]);
});

test("history reprocess rejects invalid ids without calling history actions", async () => {
  const { calls, handlers, authorizedEvent } = createHarness();
  const invalidIds = [undefined, null, "", "   ", 42, [], {}, Symbol("history")];

  for (const id of invalidIds) {
    assert.deepEqual(
      await handlers.get("history:reprocess")(authorizedEvent, id),
      { ok: false, reason: "invalid_request" }
    );
  }

  assert.deepEqual(calls.reprocess, []);
});

test("history handlers preserve valid action arguments and Task 5 results", async () => {
  const { calls, handlers, authorizedEvent } = createHarness();

  const updateResult = await handlers.get("history:update")(
    authorizedEvent,
    { id: "history-1", text: "edited text" }
  );
  const reprocessResult = await handlers.get("history:reprocess")(
    authorizedEvent,
    "history-1"
  );

  assert.deepEqual(updateResult, { ok: false, reason: "history_changed" });
  assert.deepEqual(reprocessResult, { ok: false, reason: "processing_failed" });
  assert.deepEqual(calls.update, [{ id: "history-1", text: "edited text" }]);
  assert.deepEqual(calls.reprocess, ["history-1"]);
});

test("history handlers project successful entries before returning them to the renderer", async () => {
  const unsafeEntry = {
    id: "history-1",
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:01:00.000Z",
    transcript: "spoken words",
    text: "edited text",
    status: "complete",
    processingError: "provider_response",
    providerDiagnostics: "https://private.example/log",
    modelPath: "C:\\private\\model.bin"
  };
  const { handlers, authorizedEvent } = createHarness({
    updateResult: { ok: true, entry: unsafeEntry },
    reprocessResult: { ok: true, entry: unsafeEntry }
  });
  const expected = {
    ok: true,
    entry: {
      id: "history-1",
      createdAt: "2026-07-28T10:00:00.000Z",
      updatedAt: "2026-07-28T10:01:00.000Z",
      transcript: "spoken words",
      text: "edited text",
      status: "complete"
    }
  };

  assert.deepEqual(
    await handlers.get("history:update")(
      authorizedEvent,
      { id: "history-1", text: "edited text" }
    ),
    expected
  );
  assert.deepEqual(
    await handlers.get("history:reprocess")(authorizedEvent, "history-1"),
    expected
  );
});

function createIpcEvent(sender, url) {
  const senderFrame = { url };
  senderFrame.top = senderFrame;
  return { sender, senderFrame };
}
