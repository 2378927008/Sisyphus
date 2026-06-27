export function createHotkeyManager({
  globalShortcut,
  onToggle,
  onStatus = () => {}
}) {
  let registeredHotkey = "";
  let paused = false;

  function emitStatus(status) {
    onStatus(status);
    return status;
  }

  function unregister() {
    if (!registeredHotkey) {
      return;
    }

    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = "";
  }

  function register(settings = {}) {
    unregister();

    const hotkey = String(settings.hotkey ?? "").trim();

    if (settings.globalShortcutPaused) {
      paused = true;
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

    if (!globalShortcut.register(hotkey, onToggle)) {
      return emitStatus({
        ok: false,
        reason: "registration_failed",
        phase: "error",
        message: `Could not register hotkey: ${hotkey}`
      });
    }

    registeredHotkey = hotkey;
    paused = false;
    return emitStatus({
      ok: true,
      paused: false,
      phase: "ready",
      message: `Global shortcut ready: ${hotkey}`
    });
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
    return registeredHotkey;
  }

  return {
    register,
    unregister,
    pause,
    resume,
    isPaused,
    getRegisteredHotkey
  };
}
