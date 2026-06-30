import test from "node:test";
import assert from "node:assert/strict";
import { getRecordRecoveryAction } from "../src/renderer/record-recovery-action.js";

test("getRecordRecoveryAction offers Whisper install when recording lacks local ASR", () => {
  assert.deepEqual(
    getRecordRecoveryAction({ ready: false, reason: "whisper_not_configured" }),
    {
      type: "installWhisper",
      labelKey: "setup.installWhisper",
      messageKey: "record.recovery.installWhisper"
    }
  );
});

test("getRecordRecoveryAction switches target-output blockers back to automatic dictation", () => {
  for (const reason of ["embedded_llm_not_configured", "embedded_llm_paths_missing", "ollama_not_enabled"]) {
    assert.deepEqual(
      getRecordRecoveryAction({ ready: false, reason }),
      {
        type: "useAutoOutput",
        labelKey: "record.recovery.useAutoOutput",
        messageKey: "record.recovery.targetOutput"
      }
    );
  }
});

test("getRecordRecoveryAction routes microphone and unknown blockers to safe checks", () => {
  assert.deepEqual(
    getRecordRecoveryAction({ ready: false, reason: "media_api_unavailable" }),
    {
      type: "checkMicrophone",
      labelKey: "action.checkMicrophone",
      messageKey: "record.recovery.checkMicrophone"
    }
  );

  assert.deepEqual(
    getRecordRecoveryAction({ ready: false, reason: "provider_not_ready" }),
    {
      type: "openSettings",
      labelKey: "action.settings",
      messageKey: "record.recovery.openSettings"
    }
  );
});

test("getRecordRecoveryAction hides recovery when recording is ready", () => {
  assert.equal(getRecordRecoveryAction({ ready: true, reason: "" }), null);
});
