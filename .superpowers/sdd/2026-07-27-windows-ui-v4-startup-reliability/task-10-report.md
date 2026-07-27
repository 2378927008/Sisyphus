# Task 10 Report: Dictionary, Quick Snippets, And Tray Languages

## Status

Complete. The approved V4 sidebar now opens functional personal dictionary and
quick snippet management pages, the settings drawer links to dictionary
management, and tray-facing text explicitly supports all eight interface
languages. Task 8/9 history behavior, the approved shell structure, and both
Electron smoke paths remain in place.

## RED

Tests and interactive smoke coverage were added before production changes.

- `node --test tests/renderer-markup.test.js tests/i18n.test.js tests/tray-menu.test.js`
  - Result: 56 tests, 51 passed, 5 failed.
  - Failures identified the missing personalization page markup and explicit
    CRUD strings, plus missing Japanese tray menu, tooltip, and background
    notice support.
- `npm.cmd run check:app`
  - The retained regression smoke returned `ok: true`.
  - The V4 shell smoke failed with four primary destinations, only two enabled
    destinations, and no real dictionary or snippet pages.

## GREEN

- The sidebar exposes five working destinations without changing the approved
  V4 visual structure. Home and History retain their query and selection state
  while users visit either management page.
- Dictionary and snippet pages use unframed light work surfaces, green actions,
  separator lists, responsive controls, and local Lucide icons.
- Dictionary add, edit, delete, search, duplicate rejection, and normalization
  use the shared `normalizeDictionary` contract.
- Snippet add, edit, delete, copy, search, duplicate rejection, and
  normalization use the shared `normalizeSnippets` contract. New records use
  `crypto.randomUUID()` and edits retain the existing ID.
- All personalization persistence is serialized through
  `enqueueSettingsOperation`. Optimistic local state remains recoverable after
  a failed save, and visible errors use fixed localized text.
- Full settings saves preserve the current normalized dictionary and snippets
  after removal of the old dictionary textarea.
- The settings drawer retains its four groups and hidden-by-default Advanced
  section. Its management button closes the drawer and opens the dictionary
  page.
- Renderer and tray translations explicitly cover `en`, `zh-Hans`, `ja`, `ko`,
  `zh-Hant`, `fr`, `ru`, and `es`. Unknown tray language codes alone fall back
  to English.
- The tray module remains main-process safe and does not import renderer
  localization data.
- V4 Electron smoke uses real clicks, form submissions, keyboard-compatible
  controls, clipboard calls, settings saves, injected save failures, and
  visible-text inspection rather than static source matching.

## Changed Files

- `src/renderer/index.html`
- `src/renderer/styles.css`
- `src/renderer/app.js`
- `src/renderer/i18n.js`
- `src/renderer/icons.js`
- `src/main/tray-menu.js`
- `tests/renderer-markup.test.js`
- `tests/i18n.test.js`
- `tests/tray-menu.test.js`
- `tests/focus-trap.test.js`
- `scripts/electron-v4-shell-smoke.mjs`
- `.superpowers/sdd/2026-07-27-windows-ui-v4-startup-reliability/task-10-report.md`

## Verification

- Focused Task 10 tests:
  - `node --test tests/personalization.test.js tests/renderer-markup.test.js tests/i18n.test.js tests/tray-menu.test.js`
  - 62 passed, 0 failed.
- Full unit regression:
  - `npm.cmd test`
  - 539 tests, 536 passed, 0 failed, 3 skipped.
- Direct V4 shell smoke:
  - Returned `ok: true`.
- Two consecutive `npm.cmd run check:app` runs:
  - Run 1: retained regression smoke `ok: true`; V4 shell smoke `ok: true`.
  - Run 2: retained regression smoke `ok: true`; V4 shell smoke `ok: true`.
- `git diff --check`:
  - Passed.

## Concerns

No known functional blocker. Electron continues to emit host-profile OS crypt
and disk/GPU cache warnings during smoke runs. Deliberate unsafe fixture errors
also appear in test-process output, but interactive assertions confirm paths,
URLs, process diagnostics, `ENOENT`, and `stderr` do not enter visible Task 10
UI feedback.

## Fix Round 1

### Review Reproduction And Root Causes

All Important and Minor findings in `task-10-review.md` were reproduced before
their production fixes.

- Shared normalization retained different triggers with one duplicate ID. The
  renderer's ID predicates therefore edited or deleted multiple rows.
- The settings queue serialized IPC but accepted every full response as the
  latest snapshot. A delayed D0 full save could replace optimistic D1, and a
  later language save could accept stale personalization it did not write.
- Inline editor identity existed outside the DOM, but values, revision, focus,
  and selection existed only in rebuilt form elements.
- Search did not collapse whitespace, the translated exact-match hint was not
  rendered, and list rebuilds discarded keyboard focus.

### RED

- Shared personalization and markup tests initially failed because
  `personalizationComparisonKey` was not exported and
  `snippetExactMatchHint` did not exist.
- The first extended dual smoke run retained the regression smoke at
  `ok: true`, then failed because `Local   Flow` returned zero dictionary rows.
- After the shared search fix, V4 smoke failed on missing post-submit row focus.
- After durable editor state was added, V4 smoke reproduced the delayed D0
  response removing D1 after D1's queued save failed.
- The first response merger retained D1 across D0 but a subsequent language
  response still removed D1, proving that unwritten personalization fields also
  needed explicit local ownership.

### Closure

- `normalizeSnippets` now reserves valid imported IDs and deterministically
  assigns collision-free `~N` suffixes. The first ID is retained, existing
  unique IDs remain unchanged, and repeated normalization is idempotent.
- Dictionary and snippet search use the exported shared NFKC, collapsed
  whitespace, and case-folded comparison key.
- Full settings, processing-language, detected-setup-path, and personalization
  saves all capture one response context before queueing. Responses cannot
  replace a higher local personalization version, and fields not written by a
  request always retain local ownership.
- Failed optimistic values remain in `currentSettings`, stay visible, survive
  later language saves, and are included in the next full save retry.
- Dictionary and snippet editors retain identity, values, revision, active
  field, focus, and selection outside rebuilt markup. Search and earlier save
  completion preserve an active draft.
- Save and cancel return focus to the surviving row's localized Edit action;
  add cancellation and deletion return focus to Add. Electron coverage uses
  real Tab navigation through the inline forms.
- The exact-match explanation is visible on the snippets page in all existing
  localized dictionaries.
- V4 smoke now covers duplicate-ID single-row edit/delete, snippet save
  failure, delayed full and personalization responses, failed optimistic retry,
  dictionary and snippet draft preservation, collapsed-whitespace search,
  exact-match visibility, localized actions, focus restoration, and all prior
  Task 8/9 scenarios.

### Fix Round 1 Changed Files

- `src/shared/personalization.js`
- `src/renderer/app.js`
- `src/renderer/index.html`
- `src/renderer/styles.css`
- `tests/personalization.test.js`
- `tests/renderer-markup.test.js`
- `scripts/electron-v4-shell-smoke.mjs`
- `.superpowers/sdd/2026-07-27-windows-ui-v4-startup-reliability/task-10-report.md`

### Fix Round 1 Verification

- Focused Task 10 and focus tests:
  - 80 passed, 0 failed.
- `npm.cmd test`:
  - 542 tests, 539 passed, 0 failed, 3 skipped.
- Two consecutive `npm.cmd run check:app` runs:
  - Run 1: retained regression smoke `ok: true`; V4 shell smoke `ok: true`.
  - Run 2: retained regression smoke `ok: true`; V4 shell smoke `ok: true`.
- Syntax checks and `git diff --check`:
  - Passed.

### Fix Round 1 Concerns

No known functional blocker. Electron host-profile OS crypt and disk/GPU cache
warnings remain test-environment noise. Deliberate unsafe fixture failures are
still confined to process output and remain absent from visible personalization
feedback.
