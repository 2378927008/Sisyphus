export function createShortcutBackend({
  globalShortcut,
  nativeShortcut = null
} = {}) {
  return {
    register(hotkey, callback) {
      try {
        return Boolean(globalShortcut?.register?.(hotkey, callback));
      } catch {
        return false;
      }
    },
    unregister(hotkey) {
      try {
        globalShortcut?.unregister?.(hotkey);
      } catch {
        // Native-only accelerators such as Mouse4 may not be valid Electron shortcuts.
      }
      nativeShortcut?.unregister?.(hotkey);
    },
    registerPressAndRelease(hotkey, handlers) {
      if (!nativeShortcut?.registerPressAndRelease) {
        return false;
      }
      try {
        return nativeShortcut.registerPressAndRelease(hotkey, handlers);
      } catch {
        return false;
      }
    }
  };
}
