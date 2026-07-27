export function buildMainWindowOptions({ preloadPath } = {}) {
  return {
    width: 1180,
    height: 800,
    minWidth: 780,
    minHeight: 600,
    title: "Local Flow",
    backgroundColor: "#F5F7F6",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  };
}

export function revealMainWindow(window) {
  if (!window || window.isDestroyed?.() || window.webContents?.isDestroyed?.()) {
    return false;
  }

  if (window.isMinimized?.()) {
    window.restore();
  }
  window.show();
  window.focus();
  return true;
}

export function bindMainWindowLifecycle({
  window,
  showOnReady = true,
  isQuitting = () => false,
  onFirstHide = () => {},
  onLoadFailure = () => {}
} = {}) {
  let hasInitiallyRevealed = false;
  let hasNotifiedFirstHide = false;

  const revealInitially = () => {
    if (!showOnReady || hasInitiallyRevealed) {
      return false;
    }

    hasInitiallyRevealed = revealMainWindow(window);
    return hasInitiallyRevealed;
  };

  window?.once?.("ready-to-show", revealInitially);
  window?.webContents?.once?.("did-finish-load", revealInitially);
  window?.on?.("close", (event) => {
    if (isQuitting()) {
      return;
    }

    event.preventDefault();
    window.hide();
    if (!hasNotifiedFirstHide) {
      hasNotifiedFirstHide = true;
      onFirstHide();
    }
  });
  window?.webContents?.on?.("did-fail-load", (
    _event,
    errorCode,
    errorDescription,
    validatedURL,
    isMainFrame
  ) => {
    if (!isMainFrame) {
      return;
    }

    onLoadFailure({ errorCode, errorDescription, validatedURL });
  });
}
