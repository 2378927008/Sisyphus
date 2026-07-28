import assert from "node:assert/strict";
import test from "node:test";

async function loadPasteLastAction() {
  try {
    return await import("../src/main/paste-last-action.js");
  } catch (error) {
    assert.fail(`paste-last action module is unavailable: ${error?.code || error?.message}`);
  }
}

test("paste-last is rejected without notifications while a recording operation is active", async () => {
  const { createPasteLastAction } = await loadPasteLastAction();
  const calls = [];
  const action = createPasteLastAction({
    hasActiveOperation: () => true,
    getText: () => "previous dictation",
    paste: async () => calls.push("paste"),
    notify: (payload) => calls.push(payload)
  });

  const result = await action();

  assert.deepEqual(result, { ok: false, reason: "recording_active" });
  assert.deepEqual(calls, []);
});

test("paste-last uses only auxiliary notifications outside recording operations", async () => {
  const { createPasteLastAction } = await loadPasteLastAction();
  const calls = [];
  const action = createPasteLastAction({
    hasActiveOperation: () => false,
    getText: () => "previous dictation",
    paste: async (text) => calls.push({ type: "paste", text }),
    notify: (payload) => calls.push({ type: "notify", payload })
  });

  const result = await action();

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    {
      type: "notify",
      payload: {
        phase: "pasting",
        message: "Pasting last dictation..."
      }
    },
    { type: "paste", text: "previous dictation" },
    {
      type: "notify",
      payload: {
        phase: "done",
        message: "Last dictation pasted."
      }
    }
  ]);
});
