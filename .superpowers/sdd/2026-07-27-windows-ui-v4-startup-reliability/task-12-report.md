# Task 12 Report: Visual Regression And Complete Application Verification

Status: review fix round 2 implemented and verified, awaiting scoped re-review

## Scope

Implemented and repaired Windows UI V4 visual regression only. No iPhone, model/API policy, or Task 13 packaging changes were made.

## Initial RED/GREEN

- RED: the package and viewport contracts failed because `check:visual` and its script did not exist.
- GREEN: added the real-preload deterministic Electron capture flow, shared app-smoke fixture, five required artifacts, real 460 x 72 HUD, 2x master-detail workflow, native-select safety, and responsive visual fixes.

## Review Fix RED

Added three failing focused contracts before implementation:

1. Required captures must re-focus after all settling work, re-check the declared target immediately before `capturePage()`, and verify an in-bounds focus treatment in the captured pixels.
2. The real HUD collision set must include waveform, title, message, timer, and every visible action control instead of excluding text.
3. The 780 master-detail record button must remain at most 54 px high and use a compact command layout.

`node --test tests/renderer-markup.test.js` initially reported 35 passed and 3 failed for these missing guarantees.

During GREEN integration, the real visual run also exposed two meaningful edge cases:

- An inset outline has no outward viewport extent when `outlineOffset + outlineWidth <= 0`.
- Windows anti-aliases the focus ring, so the captured-pixel check uses a bounded 36-channel tolerance around the computed focus color.

Both edge cases received failing focused contracts before their implementation changes.

## Review Fix GREEN

- Moved required focus handling into the final capture step after state assertions and waits.
- Added a final `activeElement`, `:focus-visible`, visible-treatment, and viewport-bounds assertion immediately before each capture.
- Added dynamic screenshot-pixel verification around the runtime treatment rectangle; no screenshot coordinates are hard-coded.
- Kept `#resultText` as the editor active element while using the in-bounds `#resultEditor:focus-within` viewport as the visible editor treatment.
- Expanded HUD clipping and collision checks to independently laid-out leaf regions: waveform, title, message, timer, cancel, stop, and open-main. The explicit allowed-overlap set is empty.
- Reworked only the 700-899 px command grid so the 780 record button is 46 px high and language controls remain complete.
- Kept all existing blank, overflow, clipping, overlap, native-select, icon, pane, and 2x workflow assertions.

## Review Fix Round 2 RED

Added behavioral tests before implementation for:

1. a complete four-edge focus ring that must pass;
2. eight nearby blue pixels without a ring that must fail;
3. one blue edge without the other three edges that must fail;
4. exact HUD visible-region validation, including rejection when warning omits `hudOpenMain` or reports clipping/overlap.

The first focused run reported 36 passed and 3 failed: the two strengthened script contracts failed and the behavioral suite could not import the not-yet-created pure assertion module.

The first real desktop GREEN attempt then exposed a second RED: warning HUD `hudOpenMain` occupied `top=56, bottom=96` in the real 72 px window and failed clipping. A CSS contract was added first and failed with 37 passed, 1 failed.

## Review Fix Round 2 GREEN

- Added pure `measureFocusRingCoverage()` logic and behavioral fixtures. Runtime focus checks retain dynamic computed rectangle/color binding, 36-channel tolerance, and viewport bounds, but now require 50% matched positions independently on left, right, top, and bottom.
- Runtime edge evidence passed:
  - desktop editor: left 489/265 required, right 529/265, top 598/299, bottom 360/299;
  - compact search: left 40/20, right 40/20, top 368/184, bottom 368/184;
  - master list search: left 40/20, right 40/20, top 680/340, bottom 680/340;
  - master editor: left 285/143, right 285/143, top 716/358, bottom 716/358.
- `readHudVisualState()` now returns exact visible region IDs and measures every visible leaf region.
- Recording exact IDs: `hudWaveform`, `hudTitle`, `hudMessage`, `hudTimer`, `hudCancel`, `hudStop`; `clipped=[]`, `overlaps=[]`.
- Warning exact IDs: `hudWaveform`, `hudTitle`, `hudMessage`, `hudOpenMain`; `clipped=[]`, `overlaps=[]`.
- Fixed the real warning-state defect by placing recording actions and open-main in the same 40 px grid area. The HUD remains 460 x 72 and the saved HUD image remains the recording state.
- Existing 780 density, blank, overflow, clipping, overlap, native-select, focus timing, icon, pane, and 2x workflow checks remain intact.

## Visual Artifacts

- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\desktop-split.png` (1180 x 800, 104456 bytes)
- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\compact-split.png` (980 x 720, 90388 bytes)
- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\master-detail-list.png` (780 x 600, 49439 bytes)
- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\master-detail-editor.png` (780 x 600, 54712 bytes)
- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\reference-comparison.png` (1900 x 730, 701515 bytes)
- `C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\.tmp\ui-v4-visual\design-qa.md`

## Manual Visual Conclusion

Result: passed.

All five required PNGs were regenerated at 11:10 local time and opened at original detail. Desktop and master editor visibly outline their editor viewports; compact and master list visibly outline their search inputs. The declared target has the visible blue treatment in every required image. The real recording HUD is clean at 460 x 72 with no text/timer/button collision. The 780 command strip remains materially tighter, its record button is 46 px high, and no label, button, or workflow is clipped.

The combined comparison retains the approved hierarchy, density, spacing, complete language labels, one-row 1180 editor actions, and bottom HUD. No blocking reference mismatch remains.

## Verification

- `node --check scripts/electron-visual-smoke.mjs` and `node --check scripts/visual-regression-assertions.mjs`: exit 0.
- Round 2 focused behavioral/contracts: 44 passed, 0 failed.
- `npm.cmd test`: 573 tests; 570 passed, 3 skipped, 0 failed.
- `npm.cmd run check:app`: exit 0; app and V4 shell both `ok: true`; real OS input evidence `SENT=2 SESSION=1`.
- `npm.cmd run check:microphone`: exit 0; 3 audio inputs and 3 audio outputs detected before and after permission.
- `npm.cmd run check:visual`: exit 0 on the real Windows desktop; five required PNGs, 50% four-edge focus coverage for all four declared targets, exact recording/warning HUD states, 460 x 72 recording HUD, and 2x workflow passed.
- `git diff --check`: exit 0 before documentation update and before commit.
- Post-commit `git diff --check b06412e..HEAD` and `git diff --check 08fc526..HEAD`: exit 0.

## Concerns

- No open product or visual blocker in Task 12 scope.
- App smoke intentionally emits raw diagnostic exceptions to process stderr as negative fixtures; renderer and HUD checks continue to prevent these strings from leaking into normal product UI.
- Task 12 is not complete. Review fix round 2 remains awaiting scoped independent re-review.
