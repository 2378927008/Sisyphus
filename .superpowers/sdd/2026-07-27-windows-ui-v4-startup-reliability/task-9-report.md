# Task 9 Report: Editable Reusable Dictation History

## Status

Complete. The Task 8 editor is connected to persisted history editing, reusable
copy/insert actions, restore-to-last-save, and transcript-backed reprocessing.
The approved V4 information architecture, navigation, breakpoints, and dual
Electron smoke gate remain in place.

## RED

Tests and smoke interactions were added before production changes.

- `node --test tests/renderer-markup.test.js tests/i18n.test.js`
  - Result: 46 tests, 43 passed, 3 failed.
  - The failures identified the missing editor operation markup, autosave
    wiring, and explicit Task 9 strings in all eight dictionaries.
- `npm.cmd run check:app`
  - The retained regression smoke passed.
  - The V4 shell smoke failed after a real contenteditable input because no
    `history:update` call or saved editor state occurred.
- V4 save-failure refresh regression
  - A follow-up RED failed with `saved !== error` after an interface-language
    refresh replaced the retained failed-save text with the backend baseline.

## GREEN

- Selection creates a fresh editor baseline from text or recoverable transcript,
  updates localized metadata, and opens the editor pane.
- Task 7 versioned autosave delays and serializes writes. Only the latest
  version controls the visible save state, while every real successful commit
  advances that record's persisted baseline.
- Save failures retain current text and show fixed localized retry copy.
  Refreshing history after a failed save also preserves the local editor state.
- Selection changes and reprocessing flush pending saves first.
- Restore cancels pending timers, waits for any started write, and then
  serially persists the latest successful baseline.
- Copy and insert use current editor text. Insert failures retain that text.
- Reprocessing replaces cache, editor text, and baseline only for
  `{ ok: true, entry }`; resolved failures and exceptions retain current text.
- Failed rows remain selectable with safe recovery guidance. Reprocess is
  enabled only when the immutable transcript is non-empty.
- History previews still do not present transcript-only content as a normal
  result, and backend paths, URLs, process diagnostics, `ENOENT`, and `stderr`
  are not rendered by Task 9 states.

## Changed Files

- `src/renderer/app.js`
- `src/renderer/index.html`
- `src/renderer/styles.css`
- `src/renderer/i18n.js`
- `tests/renderer-markup.test.js`
- `tests/i18n.test.js`
- `scripts/electron-app-smoke.mjs`
- `scripts/electron-v4-shell-smoke.mjs`
- `src/renderer/main-view-state.js`
- `src/renderer/versioned-autosave.js`
- `tests/main-view-state.test.js`
- `tests/versioned-autosave.test.js`
- `.superpowers/sdd/2026-07-27-windows-ui-v4-startup-reliability/task-9-report.md`

## Verification

- `node --test tests/versioned-autosave.test.js tests/renderer-markup.test.js`
  - 38 passed, 0 failed.
- `npm.cmd test`
  - 529 tests, 526 passed, 0 failed, 3 skipped.
- `npm.cmd run check:app`
  - Retained regression smoke: `ok: true`.
  - V4 shell smoke: `ok: true`.
  - Real interactions cover update, save retry, restore, copy, successful and
    failed insert, selection flush, successful and failed reprocess, recoverable
    and unrecoverable failed records, and unsafe diagnostic redaction.
- `git diff --check`
  - Passed.

## Concerns

No functional blocker remains. Electron still emits host-profile OS crypt and
disk/GPU cache warnings during smoke runs. Deliberate regression fixtures also
emit raw process errors to the test console, but smoke assertions confirm those
diagnostics do not enter visible product text.

## Fix Round 1

### Review Verification And Root Causes

All findings in `task-9-review.md` were reproduced or traced before changing
production code.

- Reprocess read mutable `selectedHistoryId` after awaiting IPC, so an A result
  could be rebound to B.
- Autosave suppressed stale UI notifications correctly but did not separately
  expose real successful persistence. `cancel()` only removed pending work and
  could not stop an already-started write.
- History refresh had no request generation or editor/selection version check.
- One global editor state discarded failed drafts when selection or Home
  changed.
- Chromium block elements and `br` do not preserve visual newlines through
  `textContent`.
- A successful whitespace save updated the row before reconciling selection,
  producing selected + disabled + `tabindex="0"`.

### RED

- Autosave focused tests: 7 passed, 2 failed.
  - No commit was reported for older B when newer C failed.
  - `replace()` did not exist for ordered restore persistence.
- Main view state focused tests: 13 passed, 2 failed.
  - Baseline-only advancement was missing.
  - Tested block/`br` plain-text extraction was missing.
- Delayed V4 reprocess smoke:
  - A was reprocessed, B was selected while IPC waited, and A's returned text
    appeared in B's editor.
- Delayed stale-failure smoke:
  - Returning to A after a delayed failed operation left reprocess permanently
    in `running`.

### GREEN And Closure

- Reprocess captures an immutable record ID plus per-record operation version
  and UI interaction token. Cache updates remain bound to the original ID;
  stale UI success/failure cannot replace the current editor.
- Autosave now reports actual successful commits separately from latest UI
  state. Restore uses ordered `replace()` after any in-flight write, and an
  older B success remains the restore baseline when newer C fails.
- Refresh uses a request generation and validates selection/editor versions.
  Local pending, saving, failed, or unconfirmed committed state is merged
  without overwriting the active editor; stale concurrent refreshes are
  discarded.
- Editor sessions are retained per history ID, including failed drafts and
  localized save/reprocess state, across selection and Home navigation.
- Autosave, copy, and insert all use one DOM-tree plain-text reader. Electron
  coverage creates real text nodes, block elements, and `br`, preserving
  newlines, Unicode, and leading/trailing whitespace without reading HTML.
- Successful blank and Unicode-whitespace saves reconcile selection before
  projection. The saved row is disabled, unselected, and `tabindex="-1"`.
- The V4 smoke now controls list/update/reprocess delays and failures and checks
  request order, renderer/cache behavior, fixture persistence, restored
  baselines, navigation retention, multiline reuse, accessibility state, and
  safe visible text. The complete legacy smoke remains unchanged in the dual
  gate.

### Fix Round Changed Files

- `scripts/electron-v4-shell-smoke.mjs`
- `src/renderer/app.js`
- `src/renderer/main-view-state.js`
- `src/renderer/versioned-autosave.js`
- `tests/main-view-state.test.js`
- `tests/versioned-autosave.test.js`
- `.superpowers/sdd/2026-07-27-windows-ui-v4-startup-reliability/task-9-report.md`

### Fix Round Verification

- Focused Task 9 tests:
  - 81 passed, 0 failed.
  - Includes autosave, main view state, markup, eight-language i18n, and
    history display/selection rules.
- `npm.cmd test`:
  - 533 tests, 530 passed, 0 failed, 3 skipped.
- Two consecutive `npm.cmd run check:app` runs:
  - Run 1: retained regression smoke `ok: true`; V4 shell smoke `ok: true`.
  - Run 2: retained regression smoke `ok: true`; V4 shell smoke `ok: true`.
- `git diff --check`:
  - Passed.

### Fix Round Concerns

No known functional blocker. Electron host-profile OS crypt and disk/GPU cache
warnings remain expected test-environment noise. Deliberate unsafe diagnostics
remain confined to process/test output and are asserted absent from visible UI.

## Fix Round 2

### Independent Re-review Verification

The final `Fix Round 1 Independent Re-review` findings were traced against the
current renderer before production changes.

- Reprocess result acceptance still depended on the global interaction version.
  A -> B -> A therefore rejected an otherwise current A operation and left A's
  visible operation state in `running`.
- Restore had no durable operation intent. An in-flight D commit could advance
  the successful baseline before the compensating A write failed, so the next
  restore captured D instead of retrying A.
- `onCommit` ran inside the persistence `try/catch`, allowing an observer
  exception to turn a successful backend write into an error outcome.
- Renderer session and reprocess-version maps were never pruned after history
  snapshots dropped clean records.

### RED

- Focused autosave and main-view-state tests: 24 passed, 2 failed.
  - A successful save followed by a throwing `onCommit` returned `ok: false`.
  - The required clean-orphan session/version pruning helper did not exist.
- Delayed V4 reprocess smoke:
  - A reprocess started, selection moved to B and back to A before release.
  - The returned A result left the old editor text and `reprocessState=running`,
    and the smoke timed out on the new acceptance assertion.
- Delayed restore compensation smoke:
  - D completed, the first compensating A write failed, selection moved away
    and back, and a second compensating write was failed deliberately.
  - With the old restore handler restored for mutation verification, the second
    attempt displayed D instead of A and failed the new assertion.

### GREEN And Closure

- Reprocess captures the immutable operation ID, per-record operation version,
  and that session's editor revision. Selection changes no longer invalidate a
  current A result. Returning to an unedited A accepts success or shows safe
  failure; neither path can remain in `running`.
- Local edits during a delayed success or failure keep the A draft. Successful
  reprocess updates A's persisted baseline and requeues the newer draft so the
  backend cannot retain the reprocess result over the user's later edit.
- Each session now owns `pendingRestoreTarget` and a restore version. Started
  writes may advance the real successful baseline, but failed compensation
  retains the original target across repeated failures and selection changes.
  Only successful compensation clears the restore intent.
- Autosave settles persistence before notifying `onCommit`. Observer exceptions
  are isolated as best-effort notification failures; the successful outcome,
  saved UI state, and serial queue remain intact.
- Refresh prunes clean orphan sessions and operation versions through a tested
  helper while retaining dirty, saving, failed, pending-restore, and active
  reprocess state.
- Existing refresh, failed-draft navigation, multiline, Unicode whitespace,
  accessibility, safe-text, eight-language, and both Electron smoke paths
  remain covered without visual or navigation changes.

### Fix Round 2 Changed Files

- `scripts/electron-v4-shell-smoke.mjs`
- `src/renderer/app.js`
- `src/renderer/main-view-state.js`
- `src/renderer/versioned-autosave.js`
- `tests/main-view-state.test.js`
- `tests/versioned-autosave.test.js`
- `.superpowers/sdd/2026-07-27-windows-ui-v4-startup-reliability/task-9-report.md`

### Fix Round 2 Verification

- Focused Task 9 tests:
  - 83 passed, 0 failed.
- `npm.cmd test`:
  - 535 tests, 532 passed, 0 failed, 3 skipped.
- Two consecutive `npm.cmd run check:app` runs:
  - Run 1: retained regression smoke `ok: true`; V4 shell smoke `ok: true`.
  - Run 2: retained regression smoke `ok: true`; V4 shell smoke `ok: true`.
- Direct post-mutation V4 shell smoke:
  - `ok: true`.
- Syntax and `git diff --check`:
  - Passed.

### Fix Round 2 Concerns

No known functional blocker. Electron still emits expected host-profile OS
crypt and disk/GPU cache warnings. Deliberate unsafe fixture diagnostics remain
limited to process/test output and are asserted absent from visible Task 9 UI.
