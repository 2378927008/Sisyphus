import { isAuthorizedWindowSender } from "./ipc-authorization.js";

const cancellablePhases = new Set(["starting", "recording"]);

export function createHudActions({
  globalShortcut,
  systemInputController,
  revealMainWindow = () => {}
} = {}) {
  let ownsEscape = false;
  let disposed = false;

  function syncPhase(phase) {
    if (disposed) {
      return;
    }

    if (cancellablePhases.has(phase)) {
      registerEscape();
      return;
    }

    unregisterEscape();
  }

  function registerEscape() {
    if (ownsEscape || typeof globalShortcut?.register !== "function") {
      return;
    }

    try {
      ownsEscape = globalShortcut.register("Escape", () => {
        void systemInputController?.cancel?.();
      }) === true;
    } catch {
      ownsEscape = false;
    }
  }

  function unregisterEscape() {
    if (!ownsEscape) {
      return;
    }

    ownsEscape = false;
    try {
      globalShortcut?.unregister?.("Escape");
    } catch {
      // Registration ownership is already released locally.
    }
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    unregisterEscape();
  }

  return {
    stop: () => systemInputController?.stop?.(),
    cancel: () => systemInputController?.cancel?.(),
    openMainWindow: () => revealMainWindow(),
    syncPhase,
    dispose
  };
}

export function wireHudIpc({
  ipcMain,
  getHudWindow = () => null,
  hudActions
} = {}) {
  const handlers = {
    "hud:stop": () => hudActions?.stop?.(),
    "hud:cancel": () => hudActions?.cancel?.(),
    "hud:open-main-window": () => hudActions?.openMainWindow?.()
  };

  for (const [channel, action] of Object.entries(handlers)) {
    ipcMain?.on?.(channel, (event) => {
      if (!isAuthorizedWindowSender(event, getHudWindow())) {
        return;
      }

      try {
        const result = action();
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      } catch {
        // HUD actions are best-effort and must not destabilize the main process.
      }
    });
  }
}
