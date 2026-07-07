export function createHotkeyManager({
  globalShortcut,
  onToggle,
  onStart = onToggle,
  onStop = onToggle,
  onPasteLast = () => {},
  onStatus = () => {}
}) {
  let registeredHotkeys = [];
  let primaryHotkey = "";
  let paused = false;

  function emitStatus(status) {
    onStatus(status);
    return status;
  }

  function unregister() {
    for (const hotkey of registeredHotkeys) {
      globalShortcut.unregister(hotkey);
    }

    registeredHotkeys = [];
    primaryHotkey = "";
  }

  function register(settings = {}) {
    unregister();
    paused = Boolean(settings.globalShortcutPaused);

    const hotkey = String(settings.hotkey ?? "").trim();
    const pasteLastHotkey = String(settings.pasteLastHotkey ?? "").trim();
    const shortcutMode = settings.shortcutMode === "hold" ? "hold" : "toggle";

    if (settings.globalShortcutPaused) {
      return emitStatus({
        ok: true,
        paused: true,
        phase: "warning",
        message: "Global shortcut is paused."
      });
    }

    if (!hotkey) {
      return emitStatus({
        ok: false,
        reason: "missing_hotkey",
        phase: "error",
        message: "Set a global shortcut before recording."
      });
    }

    if (pasteLastHotkey && pasteLastHotkey === hotkey) {
      return emitStatus({
        ok: false,
        reason: "duplicate_hotkey",
        phase: "error",
        message: "Dictation and paste-last shortcuts must be different."
      });
    }

    const primaryStatus = registerPrimaryHotkey(hotkey, shortcutMode);
    if (!primaryStatus.ok) {
      return emitStatus(primaryStatus);
    }

    if (pasteLastHotkey) {
      const pasteLastStatus = registerPlainHotkey(pasteLastHotkey, onPasteLast);
      if (!pasteLastStatus.ok) {
        unregister();
        return emitStatus(pasteLastStatus);
      }
    }

    paused = false;
    return emitStatus(primaryStatus);
  }

  function registerPrimaryHotkey(hotkey, shortcutMode) {
    if (shortcutMode === "hold" && typeof globalShortcut.registerPressAndRelease === "function") {
      const ok = globalShortcut.registerPressAndRelease(hotkey, {
        onPress: onStart,
        onRelease: onStop
      });
      if (ok) {
        registeredHotkeys.push(hotkey);
        primaryHotkey = hotkey;
        return {
          ok: true,
          paused: false,
          phase: "ready",
          mode: "hold",
          message: `Hold shortcut ready: ${hotkey}`
        };
      }

      return registerHoldFallback(hotkey, "hold_shortcut_unavailable");
    }

    if (shortcutMode === "hold") {
      return registerHoldFallback(hotkey, "hold_shortcut_unsupported");
    }

    const status = registerPlainHotkey(hotkey, onToggle);
    if (!status.ok) {
      return status;
    }

    primaryHotkey = hotkey;
    return {
      ok: true,
      paused: false,
      phase: "ready",
      mode: "toggle",
      message: `Global shortcut ready: ${hotkey}`
    };
  }

  function registerHoldFallback(hotkey, reason) {
    const status = registerPlainHotkey(hotkey, onToggle);
    if (!status.ok) {
      return status;
    }

    primaryHotkey = hotkey;
    return {
      ok: true,
      paused: false,
      phase: "warning",
      reason,
      mode: "toggle",
      message: `Hold shortcut needs native release events. Using toggle shortcut: ${hotkey}`
    };
  }

  function registerPlainHotkey(hotkey, callback) {
    if (!globalShortcut.register(hotkey, callback)) {
      return createRegistrationFailure(hotkey);
    }

    registeredHotkeys.push(hotkey);
    return {
      ok: true,
      paused: false,
      phase: "ready",
      message: `Global shortcut ready: ${hotkey}`
    };
  }

  function createRegistrationFailure(hotkey) {
    return {
      ok: false,
      reason: "registration_failed",
      phase: "error",
      message: `Could not register hotkey: ${hotkey}`
    };
  }

  function pause() {
    paused = true;
    unregister();
    return emitStatus({
      ok: true,
      paused: true,
      phase: "warning",
      message: "Global shortcut is paused."
    });
  }

  function resume(settings = {}) {
    paused = false;
    return register({
      ...settings,
      globalShortcutPaused: false
    });
  }

  function isPaused() {
    return paused;
  }

  function getRegisteredHotkey() {
    return primaryHotkey;
  }

  function getRegisteredHotkeys() {
    return [...registeredHotkeys];
  }

  return {
    register,
    unregister,
    pause,
    resume,
    isPaused,
    getRegisteredHotkey,
    getRegisteredHotkeys
  };
}
