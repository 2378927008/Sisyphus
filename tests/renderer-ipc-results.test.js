import assert from "node:assert/strict";
import test from "node:test";
import { requireSuccessfulIpcResult } from "../src/renderer/ipc-results.js";

test("renderer IPC failures become a fixed local error without exposing the reason", () => {
  const unsafeReason = "stderr spawn C:\\private\\helper.exe ENOENT https://vendor.example";

  assert.throws(
    () => requireSuccessfulIpcResult({ ok: false, reason: unsafeReason }),
    (error) => {
      assert.equal(error.message, "ipc_operation_failed");
      assert.doesNotMatch(error.message, /stderr|spawn|[A-Za-z]:[\\/]|https?:|ENOENT/i);
      return true;
    }
  );
  assert.deepEqual(
    requireSuccessfulIpcResult({ ok: true, value: 1 }),
    { ok: true, value: 1 }
  );
});
