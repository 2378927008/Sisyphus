const setupTypes = new Set(["whisper", "llm"]);
const setupStatuses = new Set(["idle", "running", "complete", "failed"]);
const setupFailureReasons = new Set([
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
