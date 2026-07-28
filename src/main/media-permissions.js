export function shouldGrantMediaPermission({
  permission,
  requestingUrl,
  webContents,
  allowedWebContents,
  allowedUrl,
  isMainFrame
}) {
  return Boolean(
    permission === "media" &&
    webContents &&
    allowedWebContents &&
    webContents === allowedWebContents &&
    isMainFrame === true &&
    typeof allowedUrl === "string" &&
    allowedUrl &&
    requestingUrl === allowedUrl &&
    webContents.getURL?.() === allowedUrl
  );
}

export function configureMediaPermissions(session, {
  getAllowedWebContents = () => null,
  getAllowedUrl = () => ""
} = {}) {
  session.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    callback(shouldGrantMediaPermission({
      permission,
      requestingUrl: details.requestingUrl || webContents?.getURL?.() || "",
      webContents,
      allowedWebContents: getAllowedWebContents(),
      allowedUrl: getAllowedUrl(),
      isMainFrame: details.isMainFrame
    }));
  });

  session.setPermissionCheckHandler((webContents, permission, requestingUrl, details = {}) => {
    return shouldGrantMediaPermission({
      permission,
      requestingUrl,
      webContents,
      allowedWebContents: getAllowedWebContents(),
      allowedUrl: getAllowedUrl(),
      isMainFrame: details.isMainFrame
    });
  });
}
