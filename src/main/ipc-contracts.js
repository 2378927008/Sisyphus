export const MAX_IPC_TEXT_LENGTH = 100000;
export const MAX_IPC_STATUS_TEXT_LENGTH = 240;
export const MAX_IPC_ID_LENGTH = 128;
export const MAX_SETTINGS_PAYLOAD_BYTES = 256 * 1024;
export const MAX_WAV_BYTES = 12 * 1024 * 1024;

export const MAIN_RENDERER_IPC_CHANNELS = new Set([
  "recording:status",
  "recording:toggle-request",
  "dictation:insert-text",
  "dictation:status-latest",
  "settings:get",
  "settings:save",
  "history:list",
  "history:update",
  "history:reprocess",
  "data:recovery-status",
  "diagnostics:whisper",
  "diagnostics:text",
  "providers:status",
  "llm:status",
  "models:setup-status",
  "models:setup-refresh",
  "models:setup-start",
  "models:setup-cancel",
  "dictation:wav"
]);

const noPayloadChannels = new Set([
  "recording:toggle-request",
  "dictation:status-latest",
  "settings:get",
  "history:list",
  "data:recovery-status",
  "diagnostics:whisper",
  "diagnostics:text",
  "providers:status",
  "llm:status",
  "models:setup-status",
  "models:setup-refresh"
]);

const recordingPhases = new Set([
  "idle",
  "starting",
  "recording",
  "stopping",
  "transcribing",
  "polishing",
  "pasting",
  "done",
  "error",
  "warning"
]);

export function validateIpcArguments(channel, args) {
  if (!MAIN_RENDERER_IPC_CHANNELS.has(channel) || !Array.isArray(args)) {
    return false;
  }
  if (noPayloadChannels.has(channel)) {
    return args.length === 0;
  }
  if (args.length !== 1) {
    return false;
  }

  const [payload] = args;
  if (channel === "recording:status") {
    return isRecordingStatus(payload);
  }
  if (channel === "dictation:insert-text") {
    return isBoundedString(payload, MAX_IPC_TEXT_LENGTH, { allowBlank: false });
  }
  if (channel === "settings:save") {
    return isBoundedSettingsPayload(payload);
  }
  if (channel === "history:update") {
    return isPlainObject(payload) &&
      isBoundedString(payload.id, MAX_IPC_ID_LENGTH, { allowBlank: false }) &&
      isBoundedString(payload.text, MAX_IPC_TEXT_LENGTH);
  }
  if (channel === "history:reprocess") {
    return isBoundedString(payload, MAX_IPC_ID_LENGTH, { allowBlank: false });
  }
  if (channel === "models:setup-start" || channel === "models:setup-cancel") {
    return payload === "whisper" || payload === "llm";
  }
  if (channel === "dictation:wav") {
    return isPlainObject(payload) &&
      isOperationId(payload.operationId) &&
      Boolean(getWavByteView(payload.wavBytes));
  }

  return false;
}

export function getValidatedWavBuffer(value) {
  const view = getWavByteView(value);
  if (!view) {
    throw new Error("invalid_wav");
  }
  return Buffer.from(view);
}

function isRecordingStatus(payload) {
  return isPlainObject(payload) &&
    isOperationId(payload.operationId) &&
    recordingPhases.has(payload.phase) &&
    isBoundedString(payload.message ?? "", MAX_IPC_STATUS_TEXT_LENGTH) &&
    isBoundedString(payload.reason ?? "", MAX_IPC_STATUS_TEXT_LENGTH);
}

function isBoundedSettingsPayload(payload) {
  if (!isPlainObject(payload)) {
    return false;
  }

  try {
    const serialized = JSON.stringify(payload);
    if (
      typeof serialized !== "string" ||
      Buffer.byteLength(serialized, "utf8") > MAX_SETTINGS_PAYLOAD_BYTES
    ) {
      return false;
    }
  } catch {
    return false;
  }

  return isBoundedStructuredValue(payload);
}

function isBoundedStructuredValue(root) {
  const pending = [{ value: root, depth: 0 }];
  const seen = new Set();
  let visited = 0;

  while (pending.length) {
    const { value, depth } = pending.pop();
    visited += 1;
    if (visited > 5000 || depth > 6) {
      return false;
    }

    if (typeof value === "string") {
      if (value.length > MAX_IPC_TEXT_LENGTH) return false;
      continue;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" && Number.isFinite(value)
    ) {
      continue;
    }
    if (typeof value !== "object" || seen.has(value)) {
      return false;
    }

    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 500) return false;
      for (const item of value) {
        pending.push({ value: item, depth: depth + 1 });
      }
      continue;
    }
    if (!isPlainObject(value)) {
      return false;
    }

    const entries = Object.entries(value);
    if (entries.length > 200) return false;
    for (const [key, item] of entries) {
      if (key.length > MAX_IPC_ID_LENGTH) return false;
      pending.push({ value: item, depth: depth + 1 });
    }
  }

  return true;
}

function getWavByteView(value) {
  let view;
  if (value instanceof ArrayBuffer) {
    view = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1) {
    view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    return null;
  }

  if (view.byteLength < 44 || view.byteLength > MAX_WAV_BYTES) {
    return null;
  }
  if (
    readAscii(view, 0, 4) !== "RIFF" ||
    readAscii(view, 8, 12) !== "WAVE"
  ) {
    return null;
  }
  return view;
}

function readAscii(view, start, end) {
  return String.fromCharCode(...view.subarray(start, end));
}

function isBoundedString(value, maxLength, { allowBlank = true } = {}) {
  return typeof value === "string" &&
    value.length <= maxLength &&
    (allowBlank || Boolean(value.trim()));
}

function isOperationId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}
