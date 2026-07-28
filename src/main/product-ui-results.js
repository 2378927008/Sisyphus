import {
  normalizeDictionary,
  normalizeSnippets
} from "../shared/personalization.js";

const setupTypes = new Set(["whisper", "llm"]);
const setupStatuses = new Set(["idle", "running", "complete", "failed"]);
const rendererStatusPhases = new Set([
  "idle",
  "starting",
  "recording",
  "stopping",
  "transcribing",
  "polishing",
  "pasting",
  "done",
  "warning",
  "error"
]);
const rendererSettingKeys = [
  "hotkey",
  "shortcutMode",
  "pasteLastHotkey",
  "globalShortcutPaused",
  "launchAtLogin",
  "startMinimizedToTray",
  "pasteAfterTranscribe",
  "interfaceLanguage",
  "whisperLanguage",
  "outputLanguage",
  "polishMode",
  "ollamaEnabled",
  "llmProvider"
];
const historyStatuses = new Set(["complete", "partial", "failed"]);
const historyActionReasons = new Set([
  "history_changed",
  "invalid_request",
  "not_found",
  "operation_failed",
  "processing_failed",
  "unauthorized"
]);
const dictationFailureReasons = new Set([
  "invalid_request",
  "operation_failed",
  "stale_operation",
  "unauthorized"
]);
const setupFailureReasons = new Set([
  "whisper_runtime_manifest",
  "whisper_runtime_hash",
  "whisper_cli_hash",
  "whisper_runtime_locked",
  "whisper_model_hash",
  "whisper_model_locked",
  "whisper_release_metadata",
  "whisper_release_asset_missing",
  "whisper_runtime_download",
  "whisper_extract_failed",
  "whisper_runtime_missing",
  "whisper_model_download",
  "whisper_assets_missing",
  "llm_release_metadata",
  "llm_release_asset_missing",
  "llm_runtime_manifest",
  "llm_runtime_download",
  "llm_extract_failed",
  "llm_runtime_missing",
  "llm_runtime_invalid",
  "llm_runtime_locked",
  "llm_model_manifest",
  "llm_model_locked",
  "llm_model_download",
  "llm_assets_missing",
  "setup_timeout",
  "setup_spawn_failed",
  "setup_assets_missing",
  "setup_cancelled",
  "setup_failed",
  "download_failed"
]);

export function toWhisperDiagnosticResult(result = {}) {
  return {
    ready: Boolean(result.ready),
    reason: result.ready ? "" : "whisper_unavailable"
  };
}

export function toTextDiagnosticResult(result = {}) {
  return {
    ready: Boolean(result.ready),
    reason: result.ready ? "" : "text_provider_unavailable"
  };
}

export function toLocalModelUiStatus(status = {}) {
  return {
    ready: Boolean(status.ready),
    runtimeReady: Boolean(status.runtimeReady),
    modelReady: Boolean(status.modelReady),
    modelId: safeMetadata(status.modelId),
    quantization: safeMetadata(status.quantization),
    approximateSize: safeMetadata(status.approximateSize),
    license: safeMetadata(status.license)
  };
}

export function toModelSetupUiStatus(status = {}) {
  const setups = {};

  for (const type of setupTypes) {
    const setup = status.setups?.[type];
    if (!setup || typeof setup !== "object") continue;

    const setupStatus = setupStatuses.has(setup.status) ? setup.status : "failed";
    const result = {
      type,
      status: setupStatus
    };
    if (setupStatus === "failed") {
      result.failureReason = setupFailureReasons.has(setup.failureReason)
        ? setup.failureReason
        : "setup_failed";
    }
    setups[type] = result;
  }

  return {
    assets: {
      whisper: {
        ready: Boolean(
          status.assets?.whisper?.ready ||
          (
            status.assets?.whisper?.whisperCliPath &&
            status.assets?.whisper?.whisperModelPath
          )
        )
      },
      llm: {
        ready: Boolean(status.assets?.llm?.ready)
      }
    },
    setups
  };
}

export function toRendererSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const result = {};

  for (const key of rendererSettingKeys) {
    if (Object.hasOwn(source, key)) {
      result[key] = source[key];
    }
  }

  result.dictionary = normalizeDictionary(source.dictionary);
  result.snippets = normalizeSnippets(source.snippets);
  return result;
}

export function toRendererStatusPayload(status = {}) {
  const source = status && typeof status === "object" ? status : {};
  const result = {
    operationId: Number.isSafeInteger(source.operationId) && source.operationId > 0
      ? source.operationId
      : null,
    phase: rendererStatusPhases.has(source.phase) ? source.phase : "idle",
    reason: isStableReason(source.reason) ? source.reason : ""
  };

  for (const key of ["updatedAt", "recordingStartedAt"]) {
    if (isSafeTimestamp(source[key])) {
      result[key] = source[key];
    }
  }

  return result;
}

export function toRendererHistoryEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const result = {
    id: safeHistoryText(entry.id, 128),
    createdAt: safeHistoryTimestamp(entry.createdAt),
    transcript: safeHistoryText(entry.transcript, 100_000),
    text: safeHistoryText(entry.text, 100_000),
    status: historyStatuses.has(entry.status) ? entry.status : "failed"
  };
  const updatedAt = safeHistoryTimestamp(entry.updatedAt);
  if (updatedAt) {
    result.updatedAt = updatedAt;
  }
  return result;
}

export function toRendererHistoryList(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(toRendererHistoryEntry)
    .filter(Boolean);
}

export function toRendererHistoryActionResult(result = {}) {
  if (result?.ok === true) {
    const entry = toRendererHistoryEntry(result.entry);
    return entry
      ? { ok: true, entry }
      : { ok: false, reason: "operation_failed" };
  }
  return {
    ok: false,
    reason: historyActionReasons.has(result?.reason)
      ? result.reason
      : "operation_failed"
  };
}

export function toRendererDictationResult(result = {}) {
  if (result?.ok === false) {
    return {
      ok: false,
      reason: dictationFailureReasons.has(result.reason)
        ? result.reason
        : "operation_failed"
    };
  }
  return toRendererHistoryEntry(result) || {
    ok: false,
    reason: "operation_failed"
  };
}

function safeMetadata(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= 120 && !looksTechnical(text) ? text : "";
}

function looksTechnical(value) {
  return (
    /[A-Za-z]:[\\/]|\\\\|\/home\/|https?:|file:|\bspawn\b|ENOENT|stderr|exit(?:ed)?\s+(?:code\s+)?\d/i
      .test(value)
  );
}

function isStableReason(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(value);
}

function isSafeTimestamp(value) {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

function safeHistoryText(value, maxLength) {
  return typeof value === "string"
    ? value.slice(0, maxLength)
    : "";
}

function safeHistoryTimestamp(value) {
  return isSafeTimestamp(value) ? value : "";
}
