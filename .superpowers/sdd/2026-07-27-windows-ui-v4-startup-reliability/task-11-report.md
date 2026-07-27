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
