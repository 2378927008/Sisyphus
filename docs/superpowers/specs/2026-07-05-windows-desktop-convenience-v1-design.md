# Windows Desktop Convenience V1 Design

## Goal

Make Local Flow easier to use as a Windows-wide voice input tool without forcing the user back into the main window. This slice adds explicit start/stop command paths, a reusable "paste last result" shortcut, and a safe mouse-side-button setup path.

## Scope

This is still not a TSF/IME implementation. Local Flow remains a tray app with a recorder renderer, HUD, global shortcuts, transcription, and paste into the active field.

Included:

- shortcut mode setting: toggle or hold;
- explicit start and stop controller methods, so shortcut adapters can call press/release semantics cleanly;
- a second global shortcut for pasting the last successful dictation result;
- settings UI and persisted defaults for the new desktop convenience controls;
- clear guidance for mapping Mouse4/Mouse5 through mouse driver software or PowerToys.

Deferred:

- native Mouse4/Mouse5 capture through a low-level Windows hook;
- full Windows IME/TSF integration;
- automatic shortcut recording UI.

## Architecture

`src/main/system-input-controller.js` owns recording lifecycle decisions. It will expose `start()`, `stop()`, and `toggle()` instead of forcing every caller through toggle. `toggle()` remains backward compatible and delegates to the explicit methods.

`src/main/hotkey-manager.js` owns shortcut registration. It registers the primary dictation shortcut and an optional paste-last shortcut. For hold mode it uses an optional `registerPressAndRelease` adapter when available; otherwise it keeps the primary shortcut usable as toggle mode and reports a warning. Electron's built-in `globalShortcut` does not expose key release events, so this adapter boundary keeps native-hook work isolated for a future slice.

`src/main/index.js` wires the shortcut callbacks to the controller and adds `pasteLastDictation()`, which reads the latest successful dictation status and calls the existing `pasteText()` helper.

The renderer settings drawer exposes the new controls. Mouse-side-button support is presented as a mapping target: map Mouse4/Mouse5 to the configured dictation shortcut in mouse software or PowerToys.

## Error Handling

- Missing primary shortcut remains an error.
- Shortcut registration conflict reports the failed shortcut.
- Duplicate primary and paste-last shortcuts are rejected before registration.
- Paste-last with no saved result reports a warning instead of changing the clipboard.
- Paste-last failures still leave the text copied when the paste helper has already written the clipboard.
- Hold mode without a press/release adapter reports a warning and falls back to toggle behavior.

## Tests

Add focused unit/source tests for:

- system input explicit `start()` and `stop()` behavior;
- hotkey manager registration of primary and paste-last shortcuts;
- hold-mode adapter behavior and fallback behavior;
- settings normalization and persistence of convenience fields;
- renderer markup, settings save payload, and localized labels.
