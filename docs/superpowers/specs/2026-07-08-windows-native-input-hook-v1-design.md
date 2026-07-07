# Windows Native Input Hook V1 Design

## Goal

Move Local Flow beyond Electron's `globalShortcut` limitation for hold-to-dictate. This slice adds an optional native input backend that can receive key release and mouse side-button release events.

## Scope

Included:

- add `uiohook-napi` as the optional native input runtime dependency;
- create a small native shortcut adapter with the same `registerPressAndRelease` contract already used by `hotkey-manager`;
- support keyboard combinations such as `CommandOrControl+Alt+Space`;
- support mouse side-button triggers such as `Mouse4` and `Mouse5`;
- keep the existing Electron global shortcut path as the fallback for toggle mode and native-hook failures;
- package the dependency in the Windows installer.

Deferred:

- a visual shortcut recorder UI;
- low-level suppression of the original mouse button event;
- user-selectable per-device mouse binding;
- macOS/iOS native hook work.

## Architecture

`src/main/native-input-shortcut.js` wraps `uiohook-napi`. It parses a shortcut string into modifiers plus either a keyboard key or mouse button. It starts the native hook lazily on first registration and stops it when all native registrations are removed.

`src/main/shortcut-backend.js` combines Electron `globalShortcut` and the native input shortcut adapter. Normal toggle shortcuts still call Electron. Hold-mode shortcuts call the native adapter when available. Unregister is fan-out: it removes the shortcut from both backends so mode changes stay safe.

`src/main/index.js` creates the native backend after Electron is ready and passes the combined backend to `createHotkeyManager`.

If native loading fails, the app logs a short status warning and continues with the already-shipped toggle fallback.

## Error Handling

- Native backend load failure is non-fatal.
- Unsupported shortcut strings fail registration and let `hotkey-manager` surface the existing registration error.
- Repeated keydown/mousedown events do not repeatedly start recording until the matching release event arrives.
- `will-quit` unregisters native hooks through the existing hotkey manager path.

## Tests

Add unit tests for:

- parsing keyboard and mouse shortcuts;
- press/release callbacks for keyboard and Mouse4/Mouse5;
- duplicate press suppression;
- unregister and stop lifecycle;
- combined backend fan-out behavior;
- main process wiring and dependency declaration.
