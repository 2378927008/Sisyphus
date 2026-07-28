export function describeMicrophoneError(error) {
  const reason = getMicrophoneErrorReason(error);

  if (reason === "permission_denied") {
    return "Microphone permission was denied. Open Windows Settings > Privacy & security > Microphone, then allow microphone access for desktop apps and restart the app.";
  }

  if (reason === "not_found") {
    return "No microphone was found. Connect or enable a microphone, then try the microphone check again.";
  }

  if (reason === "busy") {
    return "The microphone exists but is busy or unavailable. Close other recording apps, check the device privacy indicator, then try again.";
  }

  if (reason === "constraints") {
    return "The selected microphone cannot satisfy the requested audio settings. Try another microphone or remove advanced audio constraints.";
  }

  if (reason === "security") {
    return "Microphone access was blocked by the app security policy. Restart Local Flow and try again.";
  }

  return "Could not start the microphone. Check microphone access and try again.";
}

export function getMicrophoneErrorReason(error) {
  const name = error?.name || "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "permission_denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "not_found";
  if (name === "NotReadableError" || name === "TrackStartError") return "busy";
  if (name === "OverconstrainedError") return "constraints";
  if (name === "SecurityError") return "security";
  return "unavailable";
}
