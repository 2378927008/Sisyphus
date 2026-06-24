export function describeMicrophoneError(error) {
  const name = error?.name || "";
  const message = error?.message || "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Microphone permission was denied. Open Windows Settings > Privacy & security > Microphone, then allow microphone access for desktop apps and restart the app.";
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found. Connect or enable a microphone, then try the microphone check again.";
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The microphone exists but is busy or unavailable. Close other recording apps, check the device privacy indicator, then try again.";
  }

  if (name === "OverconstrainedError") {
    return "The selected microphone cannot satisfy the requested audio settings. Try another microphone or remove advanced audio constraints.";
  }

  if (name === "SecurityError") {
    return "The app runtime blocked microphone access for security reasons. Restart the app and run it through npm.cmd start.";
  }

  return `Could not start the microphone${message ? `: ${message}` : "."}`;
}
