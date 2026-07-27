export function isAuthorizedWindowSender(event, window) {
  return Boolean(
    event?.sender &&
    window &&
    !window.isDestroyed?.() &&
    !window.webContents?.isDestroyed?.() &&
    event.sender === window.webContents
  );
}
