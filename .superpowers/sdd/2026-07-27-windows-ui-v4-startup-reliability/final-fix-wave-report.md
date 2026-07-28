# Local Flow Windows UI V4 Final Fix Wave Report

- Date: 2026-07-28
- Branch: `codex/windows-ui-v4`
- Baseline: `99efd148f1724b3434f5de3d9e58add9ea13599d`
- Review source: `final-whole-branch-review.md`
- Fix brief: `final-fix-wave-brief.md`

## Result

All 7 Important and 3 Minor findings are closed in source, regression tests, and
the Windows pull-request workflow. No finding was dismissed, reclassified, or
worked around by deleting tests or weakening assertions.

The interactive Windows desktop and installed-app trials remain an explicit
parent-agent/manual validation boundary. This wave did not run an installer,
uninstaller, or any flow targeting the existing installation.

## Finding Closure

| Finding | Closure evidence | Targeted regression evidence |
| --- | --- | --- |
| I-1 Operation isolation | Recording status now requires the current main-owned operation ID. Auxiliary paste-last and hotkey notifications use a separate path and cannot replace an active operation; paste-last is rejected silently while recording. Cancel and limit paths release recorder resources and converge HUD/Escape state. | `tests/system-input-controller.test.js`, `tests/paste-last-action.test.js`, `tests/wav-recorder.test.js` |
| I-2 Privileged IPC and microphone boundary | Every privileged main-renderer channel is registered through one authorization wrapper that requires the exact live `webContents`, top-level `senderFrame`, and approved renderer file URL. Per-channel schemas bound object shape and string lengths; WAV IPC additionally requires RIFF/WAVE bytes within 12 MiB. Microphone permission uses the same exact renderer identity, and navigation/new windows are denied outside the approved page. | `tests/ipc-authorization.test.js`, `tests/ipc-contracts.test.js`, `tests/media-permissions.test.js`, `tests/main-window.test.js`, `tests/history-ipc.test.js`, `tests/hud-actions.test.js` |
| I-3 Product UI diagnostic leakage | Main-process adapters expose only allowlisted readiness fields and stable reason codes. Renderer IPC failures map to fixed local product copy. Advanced settings no longer contains path, URL, command, provider-response, or raw setup output fields. Microphone, dictation, diagnostics, setup, history, and HUD paths no longer render raw exceptions, `spawn`/`ENOENT`, stderr, exit codes, or provider output. | `tests/product-ui-results.test.js`, `tests/renderer-ipc-results.test.js`, `tests/renderer-markup.test.js`, `tests/media-errors.test.js`, `tests/dictation-service.test.js`, `tests/local-llm.test.js`, `tests/model-setup-ipc.test.js`, `tests/hud-state.test.js` |
| I-4 Corrupt settings/history recovery | Only `ENOENT` is treated as missing. Malformed JSON and invalid root shapes are atomically renamed to a unique `.corrupt-*` file before defaults are restored. Other read failures expose a stable unavailable state and block writes, preserving the original data. Recovery state reaches the UI without technical details. | `tests/settings-store.test.js` covers malformed settings, malformed history, recovery writes, and non-missing read failures. |
| I-5 Recording and WAV limits | The AudioWorklet recorder enforces a 5-minute duration limit and 64 MiB accumulated PCM ceiling. Duration, byte-limit, normal-stop, and cancel cleanup are idempotent and close tracks, nodes, ports, and `AudioContext` before status convergence. Main-process validation independently rejects malformed or over-12-MiB WAV payloads. | `tests/wav-recorder.test.js`, `tests/ipc-contracts.test.js`, `tests/electron-runtime.test.js`, `tests/hud-state.test.js` |
| I-6 Multi-display HUD | HUD position is recalculated before every show from the display nearest the current cursor. Display add/remove/metrics changes reposition the existing HUD. Positioning preserves negative coordinates. | `tests/hud-window.test.js` |
| I-7 Windows PR gates | The Windows workflow now runs for pull requests and gates `npm test`, source app smoke, visual smoke, packaging, packaged startup, product readiness, and release verification in that order. The smoke harness keeps its real Electron behavior and was updated for the hardened IPC/media contracts. | `tests/github-actions.test.js`, `tests/electron-runtime.test.js`, and the four updated Electron smoke harnesses |
| M-1 Busy tray action | `stopping`, `transcribing`, `polishing`, and `pasting` now show a localized in-progress label and disable the dictation command. | `tests/tray-menu.test.js` |
| M-2 Load-failure localization | Main-window load failure uses fixed, non-technical recovery copy for all eight supported interface languages. | `tests/main-window.test.js` |
| M-3 Startup convergence | The top-level `app.whenReady()` chain now has a final failure handler that shows fixed localized copy and always quits cleanly. | `tests/startup-failure.test.js` |

## Preserved Product Invariants

- Local Whisper remains the default ASR and no paid API or OpenAI key is
  required.
- Automatic output preserves the detected speaking language; conversion occurs
  only when the user selects an explicit target language.
- Qwen remains optional. `verify:release` reports
  `qwenModelBundled: false`; no GGUF is bundled.
- Product UI and HUD expose only localized product language, including Advanced
  settings and startup/recovery paths.
- The approved Windows UI V4 structure and local Lucide icons remain in place.
- `git diff --name-only -- ios` is empty.
- No file under `E:\local flow` was accessed or modified.

## Verification

All commands were run from the Windows UI V4 worktree with `npm.cmd` where
applicable.

- Focused final regression set: **210 passed, 0 failed, 0 skipped**.
- `npm.cmd test`: **670 passed, 0 failed, 0 skipped**.
- `npm.cmd run check:product`: **passed** with `ok: true` and
  `automatedArtifactReadiness: true`; the tool accurately retains its
  `automated-artifacts-only` scope and lists seven manual validation areas.
- `npm.cmd run verify:release`: **passed** with `ok: true`; Whisper and llama
  runtimes were present and Qwen model bundling was false.
- `git diff --check`: **passed**.
- `git diff --name-only -- ios`: **no output**.

`check:app`, `check:visual`, and `check:packaged` were not run locally because
the fix brief assigns GUI smoke to the parent agent on an interactive Windows
desktop. The updated PR workflow now runs all three against the current source
and newly built package. The local product/release checks above validate the
existing release artifacts; they do not replace that fresh CI build or the
manual installed-app trial.

## Changed Files

Workflow and smoke harness:

- `.github/workflows/windows-installer.yml`
- `scripts/electron-app-smoke.mjs`
- `scripts/electron-microphone-smoke.mjs`
- `scripts/electron-v4-shell-smoke.mjs`
- `scripts/electron-visual-smoke.mjs`

Main, preload, renderer, and shared code:

- `src/main/dictation-service.js`
- `src/main/history-ipc.js`
- `src/main/hud-actions.js`
- `src/main/hud-window.js`
- `src/main/index.js`
- `src/main/ipc-authorization.js`
- `src/main/ipc-contracts.js`
- `src/main/local-llm.js`
- `src/main/main-i18n.js`
- `src/main/main-window.js`
- `src/main/media-permissions.js`
- `src/main/model-setup-ipc.js`
- `src/main/paste-last-action.js`
- `src/main/product-ui-results.js`
- `src/main/settings-store.js`
- `src/main/startup-failure.js`
- `src/main/system-input-controller.js`
- `src/main/tray-menu.js`
- `src/preload.cjs`
- `src/renderer/app.js`
- `src/renderer/hud-state.js`
- `src/renderer/i18n.js`
- `src/renderer/index.html`
- `src/renderer/ipc-results.js`
- `src/renderer/wav-recorder.js`
- `src/shared/media-errors.js`

Tests:

- `tests/dictation-service.test.js`
- `tests/electron-runtime.test.js`
- `tests/focus-trap.test.js`
- `tests/github-actions.test.js`
- `tests/history-ipc.test.js`
- `tests/hud-actions.test.js`
- `tests/hud-state.test.js`
- `tests/hud-window.test.js`
- `tests/ipc-authorization.test.js`
- `tests/ipc-contracts.test.js`
- `tests/local-llm.test.js`
- `tests/main-window.test.js`
- `tests/media-errors.test.js`
- `tests/media-permissions.test.js`
- `tests/model-setup-ipc.test.js`
- `tests/paste-last-action.test.js`
- `tests/product-ui-results.test.js`
- `tests/renderer-ipc-results.test.js`
- `tests/renderer-markup.test.js`
- `tests/settings-store.test.js`
- `tests/startup-failure.test.js`
- `tests/system-input-controller.test.js`
- `tests/tray-menu.test.js`
- `tests/wav-recorder.test.js`

## Remaining Validation Boundary

No review finding remains open in code. Before release, the parent agent must
rerun GUI smoke on an interactive desktop and the documented human trials for
real microphone permission/audio, paste-last concurrency, Escape cancellation,
multi-display/DPI HUD placement, foreground insertion, eight-language UI,
explicit target-language conversion, and isolated install/uninstall evidence.
