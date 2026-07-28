# Task 13 Report: Packaged Startup And Windows Installer

Status: implemented and verified (awaiting independent review)

## Scope

Completed the Windows UI V4 packaged-start, release-readiness, installer, and
clean-install verification work. No iPhone source, Task 12 visual
implementation, model selection, or API policy was changed.

## Takeover Audit

The replacement implementer inherited uncommitted Task 13 work from commit
`641707d`. The retained changes were audited rather than discarded:

- focused release tests initially passed 20/20;
- all four modified scripts passed `node --check`;
- the existing diff contained the intended release contracts, but no durable
  execution log proving the prior implementer's original RED run survived;
- the real packaged-start check exposed a harness defect:
  `secondLaunchRevealedExistingWindow=false`.

The real app could reveal its window when launched normally. The smoke harness
used `windowsHide: true` for the GUI process, so the verifier itself suppressed
the native window it expected to observe.

## Replacement RED/GREEN

RED:

```text
node --test tests/packaging-config.test.js
SyntaxError: ... does not provide an export named
'buildPackagedAppSpawnOptions'
```

GREEN:

- added `buildPackagedAppSpawnOptions(projectRoot)`;
- packaged GUI launches now use `windowsHide: false`;
- PowerShell/CIM query helpers remain hidden;
- focused release tests pass 21/21;
- both packaged smoke files pass `node --check`;
- the real desktop packaged-start check now passes all required fields.

## Packaged Startup Evidence

Approved real Windows desktop run:

```json
{
  "ok": true,
  "hiddenLaunchStayedAlive": true,
  "secondLaunchExited": true,
  "secondLaunchRevealedExistingWindow": true,
  "duplicateMainInstances": 0,
  "exe": "dist/win-unpacked/Local Flow.exe",
  "pid": 10320,
  "userDataScope": ".tmp/packaged-start-smoke-user-data"
}
```

The smoke:

- scopes CIM rows by exact executable path and isolated `--user-data-dir`;
- excludes Electron `--type` helper processes from main-instance counts;
- uses `MainWindowHandle` plus Win32 `IsWindowVisible`;
- bounds spawn, second-exit, query, reveal, and cleanup waits;
- terminates only children or exact executable/user-data matches in `finally`;
- removes only `.tmp/packaged-start-smoke-user-data`.

## Pre-Package Gates

- `npm.cmd test`: exit 0; 578 passed, 0 failed, 0 cancelled, 0 skipped.
- `npm.cmd run check:app`: exit 0; app smoke `ok=true`, V4 shell smoke
  `ok=true`, real OS Escape evidence `SENT=2 SESSION=1`.
- `npm.cmd run check:microphone`: exit 0; three audio inputs and three audio
  outputs visible before and after permission acquisition.
- `npm.cmd run check:visual`: exit 0; `ok=true`, five required PNGs,
  real 460 x 72 HUD states, and the 2x search/select/edit/copy/insert workflow.
- The combined approved-reference comparison and all four application
  screenshots were opened and inspected. No clipping, overlap, blank capture,
  missing focus treatment, or blocking hierarchy mismatch was observed.

## Build And Release Gates

- `npm.cmd run package:win`: exit 0.
- `npm.cmd run check:packaged`: exit 0 with the exact JSON above.
- `npm.cmd run dist:win`: exit 0.
- `npm.cmd run check:product`: exit 0.
- `npm.cmd run verify:release`: exit 0.
- `git diff --check`: exit 0; only line-ending conversion warnings.

Fresh release artifacts:

| Artifact | Bytes | Modified (Asia/Shanghai) |
| --- | ---: | --- |
| `dist/Local Flow Setup 0.1.0.exe` | 244,126,626 | 2026-07-28 12:23:06 |
| `dist/Local Flow Setup 0.1.0.exe.blockmap` | 255,869 | 2026-07-28 12:23:17 |
| `dist/win-unpacked/Local Flow.exe` | 210,485,248 | 2026-07-28 12:22:29 |

Absolute installer:

```text
C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\dist\Local Flow Setup 0.1.0.exe
```

Absolute unpacked executable:

```text
C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github\.worktrees\windows-ui-v4\dist\win-unpacked\Local Flow.exe
```

Release verification confirmed:

- bundled Whisper CLI: 479,232 bytes;
- bundled Whisper `ggml-base.bin`: 147,951,465 bytes;
- bundled llama CLI: 2,501,632 bytes;
- llama runtime manifest: `b9049`;
- optional model manifest: `Qwen/Qwen3-4B-GGUF`;
- `runtimeChecks.whisper=true`;
- `runtimeChecks.llama=true`;
- `runtimeChecks.qwenModelBundled=false`;
- no GGUF model is shipped inside the installer.

## Clean-Install Evidence

The interrupted clean-install trial left durable, scoped artifacts that were
audited before cleanup:

- the isolated temporary install directory was empty after uninstall;
- the unrelated sentinel still existed with SHA-256
  `17E05F6F65F2B157FFEFD6DE9D06D6A65C3CE28C5A3CE81EE70A6CABD21B49A2`;
- the Notepad target contained the exact UTF-8 text
  `Local Flow 清洁安装插入测试`;
- isolated user-data profiles existed for visible startup, single instance,
  tray behavior, and Notepad insertion;
- the restored `E:\local flow\Local Flow.exe` SHA-256 exactly matched the
  fresh unpacked executable:
  `05A18FCE49F1E9EB2686F4103090A31E648FC9E17FF57124F3E63C801B799B04`;
- the real-user uninstall record points only to
  `E:\local flow\Uninstall Local Flow.exe`;
- the original Start-menu shortcut backup hash and target were verified, then
  restored exactly;
- no temporary desktop shortcut remained;
- no test-scoped Local Flow or Notepad process remained.

The final machine state preserves the user's existing `E:\local flow`
installation. Only isolated `.tmp/clean-install*` profiles and exact test
processes are eligible for cleanup.

## Deterministic Product Evidence

- dictionary normalization and exact-snippet expansion are covered by the
  full automated suite;
- automatic output preserves the detected language when the optional text
  model is unavailable;
- target-language output requires an explicit selection and a ready provider;
- the release verifier proves that Qwen is optional and absent from the
  installer while Whisper and llama runtimes remain ready;
- real OS Escape injection is covered by `check:app` and does not rely on a
  renderer-only synthetic key event.

## Manual-Only Evidence

The following require a person speaking into the installed application and
must not be represented as unattended proof:

1. live Chinese, English, Japanese, and one additional-language recordings;
2. live target-language conversion after an explicit target selection;
3. a complete microphone-to-Whisper-to-Notepad global-shortcut trial;
4. live Escape cancellation with audible input and visual confirmation that
   no history row is added;
5. visual confirmation of the one-time Windows tray balloon.

The automated gates validate the underlying permissions, runtimes, language
rules, global-shortcut state machine, OS Escape path, history rules, and text
insertion path, but they do not substitute for these human speech samples.

## Remaining Concerns

- The installer is not commercially code-signed, so Windows SmartScreen may
  show an unknown-publisher warning.
- Electron Builder warns that `asar` is disabled. This is an existing release
  layout decision, not changed in Task 13.
- Qwen model installation remains optional and network-dependent; the model is
  intentionally excluded from the installer.
- Native iPhone build/signing still requires macOS and Xcode.
