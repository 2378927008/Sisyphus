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

export async function showMainWindowLoadFailure({
  app,
  dialog,
  language = "en"
} = {}) {
  const chinese = language === "zh-Hans";
  const message = chinese
    ? "Local Flow \u4e3b\u7a97\u53e3\u52a0\u8f7d\u5931\u8d25\u3002\u53ef\u4ee5\u9000\u51fa\u5e94\u7528\uff0c\u6216\u7ee7\u7eed\u5728\u540e\u53f0\u8fd0\u884c\u5e76\u7a0d\u540e\u91cd\u65b0\u6253\u5f00\u3002"
    : "Local Flow could not load its main window. You can exit, or keep it running in the background and reopen it later.";
  const buttons = chinese
    ? ["\u9000\u51fa", "\u7ee7\u7eed\u5728\u540e\u53f0"]
    : ["Exit", "Keep running in background"];

  try {
    const result = await dialog?.showMessageBox?.({
      type: "error",
      title: "Local Flow",
      message,
      buttons,
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });

    if (result?.response === 0) {
      app.isQuitting = true;
      app.quit?.();
      return true;
    }
  } catch {
    // The recovery dialog is best-effort; the tray remains available.
  }

  return false;
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
