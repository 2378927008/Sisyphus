# Windows Shortcut Recorder V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tested shortcut recording controls for keyboard combinations and Mouse4/Mouse5 in the Windows settings drawer.

**Architecture:** A renderer-only controller converts input events to the accelerator strings already consumed by the main-process shortcut backend. The controller owns temporary listeners and UI state; the existing settings save flow persists and registers the captured value.

**Tech Stack:** Electron renderer, browser input events, JavaScript ES modules, Node test runner, CSS.

## Global Constraints

- Preserve the existing `uiohook-napi` backend and `build.npmRebuild=false` packaging configuration.
- Do not add a runtime dependency.
- Keep manual shortcut entry available.
- Keep `Esc` reserved for cancelling capture.

---

### Task 1: Shortcut normalization and capture controller

**Files:**
- Create: `src/renderer/shortcut-recorder.js`
- Test: `tests/shortcut-recorder.test.js`

**Interfaces:**
- Produces: `buildShortcutFromKeyboardEvent(event)`, `buildShortcutFromMouseEvent(event)`, and `createShortcutRecorder(options)`.
- Consumes: DOM-like event target, record buttons, field resolver, translation callback, and status callback.

- [ ] Write failing tests for keyboard, mouse, cancellation, and cleanup behavior.
- [ ] Run `node --test --test-reporter=spec tests/shortcut-recorder.test.js` and confirm failure because the module is missing.
- [ ] Implement the smallest controller that satisfies those behaviors.
- [ ] Re-run the focused test and confirm all cases pass.

### Task 2: Native Mouse Toggle Registration

**Files:**
- Modify: `src/main/native-input-shortcut.js`
- Modify: `src/main/shortcut-backend.js`
- Test: `tests/native-input-shortcut.test.js`
- Test: `tests/shortcut-backend.test.js`

**Interfaces:**
- Consumes: the existing native press/release registration map.
- Produces: a mouse-only `register(hotkey, callback)` fallback for ordinary toggle and paste-last shortcuts.

- [ ] Add failing tests showing Mouse4 cannot use ordinary registration.
- [ ] Run the focused native backend tests and confirm the missing fallback.
- [ ] Add mouse-only press registration and Electron-to-native fallback.
- [ ] Re-run the focused tests and confirm keyboard conflicts still fail instead of falling through.

### Task 3: Settings drawer integration and localization

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/i18n.js`
- Test: `tests/renderer-markup.test.js`
- Test: `tests/i18n.test.js`

**Interfaces:**
- Consumes: `createShortcutRecorder(options)` from Task 1 and native mouse registration from Task 2.
- Produces: two `data-shortcut-target` controls bound to `hotkey` and `pasteLastHotkey`.

- [ ] Add failing markup and localization assertions.
- [ ] Run the focused renderer tests and confirm the new controls and strings are missing.
- [ ] Add the controls, controller wiring, responsive styles, and localized copy.
- [ ] Run all focused tests and confirm they pass.

### Task 4: Product verification and release

**Files:**
- Regenerate: `dist/Local Flow Setup 0.1.0.exe`

**Interfaces:**
- Consumes: the completed renderer feature.
- Produces: a verified Windows installer containing the shortcut recorder.

- [ ] Run `npm.cmd test` and confirm zero failures.
- [ ] Run `npm.cmd run check:app` and `npm.cmd run check:microphone`.
- [ ] Run `npm.cmd run dist:win`, `npm.cmd run check:product`, `npm.cmd run verify:release`, and `npm.cmd run check:packaged`.
- [ ] Review `git diff`, commit the scoped files, and push `master`.
