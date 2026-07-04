# Windows Desktop Convenience V1 Plan

## Goal

Implement the approved desktop convenience slice: hold/toggle shortcut mode, paste-last shortcut, and safe mouse-side-button mapping guidance.

## Steps

1. Add failing tests for `system-input-controller` explicit `start()` / `stop()` methods.
2. Add failing tests for `hotkey-manager` registering primary, paste-last, and hold-mode shortcuts.
3. Add failing settings and renderer source tests for the new fields.
4. Implement `system-input-controller.start()` and `system-input-controller.stop()`.
5. Extend `hotkey-manager` to manage multiple registered shortcuts and optional hold-mode adapters.
6. Wire main process callbacks for `onStart`, `onStop`, and `onPasteLast`.
7. Add settings defaults, merge normalization, renderer save payload, markup, and i18n labels.
8. Add README guidance for desktop convenience usage and mouse-side-button mapping.
9. Run focused tests, then the full product verification commands.
