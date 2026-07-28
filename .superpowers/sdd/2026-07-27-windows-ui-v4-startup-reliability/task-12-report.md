# Task 12 Report: Visual Regression And Complete Application Verification

Status: implemented and verified, awaiting independent review

## Scope

Implemented Windows UI V4 visual regression only. No iPhone, model/API policy, or Task 13 packaging changes were made.

## RED

1. Added the exact `check:visual` package contract and approved viewport contract.
2. Ran `node --test tests/packaging-config.test.js tests/renderer-markup.test.js`.
3. Observed the expected failure: `check:visual` was undefined and `scripts/electron-visual-smoke.mjs` did not exist (42 passed, 2 failed).
4. Added stricter failing contracts during visual repair for the real 460 x 72 HUD, 1180/980 language and toolbar fit, the 2x narrow command layout, and Windows native-select arrow clearance.

## GREEN

- Added `scripts/electron-visual-smoke.mjs` using the real preload, real IPC shape, deterministic shared app-smoke fixtures, Electron `capturePage()`, fixed viewports, and a side-by-side approved-reference comparison.
- Extracted app smoke settings/history to `scripts/electron-app-smoke-fixtures.mjs` so app and visual checks consume the same data source.
- Used `buildHudWindowOptions` directly and asserted the real 460 x 72 HUD dimensions, clipping, and overlap.
- Added runtime checks for blank captures, horizontal overflow, select text fit, command/button clipping, focus visibility, overlap, icon rendering, and editor action rows.
- Reserved an explicit 18 px Windows native-select arrow margin in language text-fit assertions.
- Verified the 2x master-detail search/select/edit/copy/insert workflow without weakening clipping assertions.
- Applied bounded responsive CSS fixes for 1180, 980, and the 2x narrow CSS viewport.

## Visual artifacts

- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\desktop-split.png` (1180 x 800, 104036 bytes)
- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\compact-split.png` (980 x 720, 89762 bytes)
- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\master-detail-list.png` (780 x 600, 45934 bytes)
- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\master-detail-editor.png` (780 x 600, 55915 bytes)
- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\reference-comparison.png` (1900 x 730, 701434 bytes)
- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\design-qa.md`

## Comparison conclusion

Result: passed.

All five PNGs were opened and inspected, not only generated. The final 1180 comparison has complete `自动` and `自动（同语音）` text, one-row editor actions, a real 460 x 72 HUD, readable content, and no blocking hierarchy, density, spacing, button-fit, focus, clipping, or overlap mismatch. The 980 and both 780 states are usable and clean. Detailed repair rounds and visual judgments are recorded in `design-qa.md`.

Computed evidence from the final visual run:

- 1180 recognition/output selects: 90 px / 179 px, both `textFits=true`; editor action tops: `[173, 173, 173, 173]`.
- 980 recognition/output selects: 90 px / 186 px, both `textFits=true`.
- 780 recognition/output selects: 90 px / 364 px, both `textFits=true`.
- 2x recognition/output selects: 90 px / 167 px, both `textFits=true`.
- Select text-fit calculations reserve 18 px beyond text and padding for the Windows native arrow.
- HUD capture: 460 x 72, clipped `[]`, overlaps `[]`.

## Verification

- `node --check scripts/electron-visual-smoke.mjs`: exit 0.
- Focused contracts: 45 passed, 0 failed.
- `node --test tests/electron-runtime.test.js`: 55 passed, 0 failed.
- `npm.cmd test`: 564 tests; 561 passed, 3 skipped, 0 failed.
- `npm.cmd run check:app` run 1: exit 0; app and V4 shell both `ok: true`; OS input `SENT=2 SESSION=1`.
- `npm.cmd run check:app` run 2: exit 0; app and V4 shell both `ok: true`; OS input `SENT=2 SESSION=1`.
- `npm.cmd run check:microphone`: exit 0; 3 audio inputs and 3 audio outputs detected before and after permission.
- Final `npm.cmd run check:visual`: exit 0; five required PNG files exist and are non-empty; 2x workflow passed.
- Pre-commit `git diff --check 08fc526`: exit 0.
- Post-commit `git diff --check 08fc526..HEAD`: exit 0.

## Concerns

- No open product or visual blocker.
- App smoke intentionally exercises raw diagnostic failures in main-process test output; the renderer and HUD assertions confirm those strings do not leak into normal product UI.
- Task 12 remains awaiting independent review and is not marked complete.
