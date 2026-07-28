# Task 11 Report: Actionable Recording HUD

## Scope

- Baseline: `7c26238`.
- Added a 460 x 72 actionable HUD without changing the Task 8-10 main UI,
  history, or personalization behavior.
- Kept `polishing` distinct across renderer status normalization, the main
  process, controller busy-state handling, and all HUD languages.
- Added only the approved HUD preload actions: stop, cancel, and open Local
  Flow.

## RED

- Added controller tests for distinct `polishing`, cancellable phases,
  renderer reset followed by idle, ignored invalid cancels, and stop
  idempotency.
- Added HUD action tests for delegation, duplicate phase sync, Escape
  registration failure and retry, rapid phase changes, disposal, exact sender
  authorization, destroyed windows, and missing windows.
- Updated window, view-state, markup, preload, and Electron smoke contracts
  before production implementation.
- The first focused run produced 11 expected failures: the HUD action module
  and cancel API were missing, `polishing` normalized to `transcribing`, stop
  re-entered, the old HUD dimensions remained, action/localization state was
  absent, and the new controls were not in the markup.
- The preload test separately failed because the three approved methods were
  absent.
- The first Electron smoke run failed while importing the missing production
  HUD action module.
- A later safety RED reproduced an unfiltered `stderr` message in a
  non-terminal HUD state.

## GREEN

- `createSystemInputController` now preserves `polishing`, treats it as busy,
  exposes phase-limited cancel, and prevents concurrent stop calls.
- `createHudActions` owns only its successful Escape registration. It retries
  failed registrations, unregisters only Escape outside starting/recording,
  handles duplicate sync and disposal, and never calls `unregisterAll`.
- HUD IPC uses the existing live-window authorization helper. Main-window,
  mismatched, destroyed, stale, and unavailable HUD senders do not invoke an
  action.
- Cancel sends the existing renderer reset command before returning the
  controller to idle. Stop retains the existing recording-only command path.
- The HUD uses fixed layout tracks, a fixed timer width, local Lucide X,
  Square, and ExternalLink icons, and phase-safe button visibility.
- All eight interface languages have explicit phase, message, reason,
  `aria-label`, title, and action text. Unknown language codes alone fall back
  to English.
- HUD diagnostics reject path-like values, URLs, provider/tool diagnostics,
  `spawn`, `ENOENT`, `stderr`, and stack traces. Warning/error reasons are
  selected only from the localized allowlist.

## IPC And Smoke Coverage

- Authorized HUD button clicks invoke stop, cancel, and open through the real
  HUD preload IPC bridge.
- The regression smoke emits the same three channels with the main-window
  sender and verifies that no action runs.
- The smoke uses Electron `globalShortcut.isRegistered("Escape")` to verify
  registration in recording/starting and release in polishing/warning and on
  disposal.
- The retained V4 shell smoke still verifies history selection, narrow-pane
  behavior, and Settings focus restoration.

## Verification

- Brief-focused tests: 85 passed, 0 failed.
- Expanded focused tests including preload/main runtime coverage: 138 passed,
  0 failed.
- `npm.cmd test`: 552 passed, 3 existing skips, 0 failed.
- `npm.cmd run check:app`: passed twice; both regression and V4 shell smokes
  returned `"ok": true`.
- `git diff --check`: passed with only existing CRLF conversion warnings.

## Concerns

- The smoke run still emits host `OS_crypt` and disk/GPU cache warnings plus
  deliberate diagnostic fixture errors to the process log. Product UI
  redaction assertions pass, and no diagnostic text appears in the HUD.
- Task 12 visual automation was not started, as required.

## Fix Round 1

### RED

- Added controller failures for main-owned monotonic operation IDs, missing and
  stale renderer IDs, cancel during pending start, duplicate cancel, and both
  stop/cancel race orders.
- Added renderer and runtime contract failures requiring every
  starting/recording/stopping/transcribing/error report to carry the current
  main operation ID.
- Added phase failures proving `polishing` remains distinct in main view state,
  tray copy, and all eight interface languages.
- Replaced permissive HUD message expectations with failures for unknown
  messages/reasons, every URL scheme, path-like diagnostics, provider output,
  `spawn`, `ENOENT`, and `stderr`.
- Expanded the Electron regression smoke before production changes. Its first
  runs exposed the missing generation checks and then timed out at the Escape
  injection stage until the headless input bridge was made deterministic.
- The final i18n RED exposed inherited English `status.polishing` values; the
  test now pins exact product copy for all eight languages.

### GREEN

- The controller now allocates each recording operation ID, includes it in
  start/stop/reset commands, and accepts renderer lifecycle updates only for
  the active ID. Cancel invalidates the active generation before reset and
  idle, so late same-generation and older updates cannot revive recording.
- Pending `getUserMedia` cancellation no longer blocks a new operation. The
  renderer combines the main operation ID with its local recorder token, so a
  late old promise stops only its own stream and cannot clear the new recorder.
- The main record control now requests a controller-owned toggle. Renderer
  lifecycle reports include the active operation ID on every required path.
- `polishing` stays independent through main view state, controller, tray, HUD,
  and explicit English, Simplified Chinese, Japanese, Korean, Traditional
  Chinese, French, Russian, and Spanish UI copy.
- HUD text is now strict allowlist output: known phase copy and known localized
  terminal reasons only. Raw status messages are never rendered.
- The regression smoke uses a separate BrowserWindow with the real HUD preload
  to send all three unauthorized HUD IPC actions and verifies rejection.
  Authorized HUD buttons still invoke stop, cancel, and open.
- The regression smoke also holds a real `getUserMedia` promise, cancels it,
  starts the next operation immediately, releases the old stream, and proves
  only the old tracks stop while the new recording remains active.
- Escape is delivered with Electron `sendInputEvent`. The smoke invokes only
  the callback captured from a successful real `globalShortcut.register`, then
  proves cancel/reset/idle, conflict non-ownership, release, and disposal.

### Fix Round 1 Verification

- Focused controller/actions/window/state/markup/runtime/i18n/tray suite:
  185 passed, 0 failed.
- `npm.cmd test`: 558 passed, 3 skipped, 0 failed (561 total).
- `npm.cmd run check:app`: passed twice after the final implementation; both
  regression and V4 shell smokes returned `"ok": true` on both runs.
- `git diff --check`: passed after removing one trailing blank line; only
  Windows LF-to-CRLF conversion warnings remain.

### Fix Round 1 Concerns

- Headless Electron does not activate an OS-level global hotkey from synthetic
  key events. The smoke therefore captures the callback only when the real
  `globalShortcut.register("Escape")` succeeds and drives that owned callback
  from an actual Electron Escape input event. Registration conflict and
  ownership/release still use the real Electron globalShortcut registry.
- Host `OS_crypt` and disk/GPU cache warnings remain expected in this
  environment. Deliberate unsafe diagnostic fixture errors remain visible only
  in process logs and are asserted absent from product HUD/status copy.
- No iPhone files, model/API behavior, Task 8-10 UI behavior, or Task 12 visual
  automation were changed.
