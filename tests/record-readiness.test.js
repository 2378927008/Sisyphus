import test from "node:test";
import assert from "node:assert/strict";
import { getRecordReadiness } from "../src/renderer/record-readiness.js";

test("getRecordReadiness blocks recording when media devices API is unavailable", () => {
  const readiness = getRecordReadiness({
    hasMediaDevicesApi: false,
    providerStatus: { readyToRecord: true }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "media_api_unavailable");
});

test("getRecordReadiness blocks recording when provider is not ready", () => {
  const readiness = getRecordReadiness({
    hasMediaDevicesApi: true,
    providerStatus: {
      readyToRecord: false,
      recordingBlockedReason: "whisper_not_configured"
    }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "whisper_not_configured");
});

test("getRecordReadiness allows recording when media and provider are ready", () => {
  const readiness = getRecordReadiness({
    hasMediaDevicesApi: true,
    providerStatus: { readyToRecord: true }
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, "");
});
