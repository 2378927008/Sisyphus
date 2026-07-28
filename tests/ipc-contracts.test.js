import assert from "node:assert/strict";
import test from "node:test";

async function loadContracts() {
  try {
    return await import("../src/main/ipc-contracts.js");
  } catch (error) {
    assert.fail(`IPC contracts module is unavailable: ${error?.code || error?.message}`);
  }
}

test("every privileged main-renderer channel has a bounded valid schema", async () => {
  const {
    MAIN_RENDERER_IPC_CHANNELS,
    validateIpcArguments
  } = await loadContracts();
  const wav = createWavBytes(64);
  const validArguments = new Map([
    ["recording:status", [{
      operationId: 1,
      phase: "recording",
      message: "Recording",
      reason: ""
    }]],
    ["recording:toggle-request", []],
    ["dictation:insert-text", ["hello"]],
    ["dictation:status-latest", []],
    ["settings:get", []],
    ["settings:save", [{ outputLanguage: "auto", dictionary: ["Local Flow"] }]],
    ["history:list", []],
    ["history:update", [{ id: "history-1", text: "edited text" }]],
    ["history:reprocess", ["history-1"]],
    ["data:recovery-status", []],
    ["diagnostics:whisper", []],
    ["diagnostics:text", []],
    ["providers:status", []],
    ["llm:status", []],
    ["models:setup-status", []],
    ["models:setup-refresh", []],
    ["models:setup-start", ["whisper"]],
    ["models:setup-cancel", ["llm"]],
    ["dictation:wav", [{ operationId: 1, wavBytes: wav }]]
  ]);

  assert.deepEqual(
    [...MAIN_RENDERER_IPC_CHANNELS].sort(),
    [...validArguments.keys()].sort()
  );
  for (const [channel, args] of validArguments) {
    assert.equal(validateIpcArguments(channel, args), true, channel);
  }
});

test("IPC schemas reject oversized strings, malformed objects, and unknown setup types", async () => {
  const { validateIpcArguments } = await loadContracts();
  const cyclic = {};
  cyclic.self = cyclic;

  const cases = [
    ["recording:status", [{
      operationId: 1,
      phase: "recording",
      message: "x".repeat(241),
      reason: ""
    }]],
    ["dictation:insert-text", ["x".repeat(100001)]],
    ["settings:save", [cyclic]],
    ["settings:save", [{ dictionary: ["x".repeat(100001)] }]],
    ["history:update", [{ id: "x".repeat(129), text: "ok" }]],
    ["history:update", [{ id: "history-1", text: "x".repeat(100001) }]],
    ["history:reprocess", ["x".repeat(129)]],
    ["models:setup-start", ["provider-from-payload"]],
    ["models:setup-cancel", [""]],
    ["settings:get", [{ unexpected: true }]]
  ];

  for (const [channel, args] of cases) {
    assert.equal(validateIpcArguments(channel, args), false, channel);
  }
});

test("WAV IPC accepts only RIFF/WAVE byte payloads below the independent main-process limit", async () => {
  const {
    MAX_WAV_BYTES,
    getValidatedWavBuffer,
    validateIpcArguments
  } = await loadContracts();
  const validWav = createWavBytes(64);

  assert.equal(
    validateIpcArguments("dictation:wav", [{
      operationId: 3,
      wavBytes: validWav.buffer
    }]),
    true
  );
  assert.equal(
    validateIpcArguments("dictation:wav", [{
      operationId: 3,
      wavBytes: new Uint8Array(MAX_WAV_BYTES + 1)
    }]),
    false
  );
  assert.equal(
    validateIpcArguments("dictation:wav", [{
      operationId: 3,
      wavBytes: new Uint8Array(64)
    }]),
    false
  );
  assert.equal(
    validateIpcArguments("dictation:wav", [{
      operationId: 3,
      wavBytes: { 0: 82, length: 64 }
    }]),
    false
  );

  const buffer = getValidatedWavBuffer(validWav);
  assert.equal(Buffer.isBuffer(buffer), true);
  assert.equal(buffer.length, validWav.byteLength);
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(buffer.subarray(8, 12).toString("ascii"), "WAVE");
});

function createWavBytes(length) {
  const bytes = new Uint8Array(length);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}
