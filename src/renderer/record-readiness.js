export function getRecordReadiness({ hasMediaDevicesApi, providerStatus } = {}) {
  if (!hasMediaDevicesApi) {
    return {
      ready: false,
      reason: "media_api_unavailable"
    };
  }

  if (!providerStatus?.readyToRecord) {
    return {
      ready: false,
      reason: providerStatus?.recordingBlockedReason || "provider_not_ready"
    };
  }

  return {
    ready: true,
    reason: ""
  };
}
