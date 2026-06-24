export function shouldGrantMediaPermission({ permission, requestingUrl }) {
  if (permission !== "media") {
    return false;
  }

  try {
    const url = new URL(requestingUrl || "");
    return url.protocol === "file:";
  } catch {
    return false;
  }
}

export function configureMediaPermissions(session) {
  session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(shouldGrantMediaPermission({
      permission,
      requestingUrl: webContents?.getURL?.() || ""
    }));
  });

  session.setPermissionCheckHandler((_webContents, permission, requestingUrl) => {
    return shouldGrantMediaPermission({
      permission,
      requestingUrl
    });
  });
}
