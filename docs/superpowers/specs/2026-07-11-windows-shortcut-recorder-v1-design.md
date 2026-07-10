# Windows Shortcut Recorder V1 Design

## Goal

Let Windows users configure dictation and paste-last shortcuts by pressing the desired keyboard combination or mouse side button instead of typing accelerator text manually.

## Scope

Included:

- add a Record control beside both shortcut fields;
- capture common keyboard combinations in a stable `CommandOrControl+Alt+Space` form;
- capture browser side-button events as `Mouse4` and `Mouse5`;
- register Mouse4/Mouse5 through the native press-only fallback when Electron rejects them as ordinary accelerators;
- keep listening when only a modifier is pressed;
- cancel with `Esc` without changing the previous value;
- suppress browser navigation while a side button is being captured;
- tell the user to save settings before the new shortcut is applied;
- localize the recorder controls and status messages for all supported interface languages.

Deferred:

- per-device mouse bindings;
- suppressing mouse side-button behavior after the shortcut has been saved;
- recording media keys and uncommon punctuation accelerators.

## Architecture

`src/renderer/shortcut-recorder.js` owns shortcut normalization and the capture state machine. It receives the event target, fields, buttons, translation callback, and status callback as dependencies so keyboard, cancellation, and side-button behavior can be unit tested without Electron.

`src/renderer/app.js` creates one recorder for the two settings fields. The existing settings form remains the source of truth: capture updates the field, and the user applies it with the existing Save settings button.

`src/main/native-input-shortcut.js` exposes a press-only registration path for mouse shortcuts. `src/main/shortcut-backend.js` tries Electron first and then this mouse-only native path, so keyboard registration conflicts are not bypassed.

## Error Handling

- unsupported keys leave the recorder listening;
- clicking the active Record button again cancels capture;
- the inactive recorder is disabled until capture finishes;
- closing the settings drawer cancels capture;
- missing target fields fail safely without adding global listeners.

## Tests

Add focused tests for keyboard normalization, mouse-button normalization, modifier-only input, `Esc` cancellation, deferred mouse cleanup, browser-navigation suppression, native press-only registration, renderer markup, and localized copy. Run the complete test suite and Windows release verification after implementation.
