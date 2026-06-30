const targetOutputBlockers = new Set([
  "embedded_llm_not_configured",
  "embedded_llm_paths_missing",
  "ollama_not_enabled"
]);

export function getRecordRecoveryAction(readiness = {}) {
  if (readiness.ready) return null;

  if (readiness.reason === "whisper_not_configured") {
    return {
      type: "installWhisper",
      labelKey: "setup.installWhisper",
      messageKey: "record.recovery.installWhisper"
    };
  }

  if (targetOutputBlockers.has(readiness.reason)) {
    return {
      type: "useAutoOutput",
      labelKey: "record.recovery.useAutoOutput",
      messageKey: "record.recovery.targetOutput"
    };
  }

  if (readiness.reason === "media_api_unavailable") {
    return {
      type: "checkMicrophone",
      labelKey: "action.checkMicrophone",
      messageKey: "record.recovery.checkMicrophone"
    };
  }

  return {
    type: "openSettings",
    labelKey: "action.settings",
    messageKey: "record.recovery.openSettings"
  };
}
