# Task 13 Report: Packaged Startup And Windows Installer

Status: review findings fixed and verified (awaiting independent re-review)

## Scope

Task 13 covers the Windows UI V4 packaged-start contract, release readiness,
installer generation, persistent release evidence, and honest manual-validation
boundaries. This fix does not change iPhone source, Task 12 UI, model selection,
or API policy. It did not install, uninstall, overwrite, or modify the existing
user installation.

## Independent Review Fixes

The first independent review returned two Important and two Minor findings.
This pass addresses all four:

1. The trial guide no longer assumes that Windows has an Installed apps entry.
   It uses that entry only when present and otherwise directs the user to the
   installation directory's `Uninstall Local Flow.exe`.
2. Clean-install claims now live in a repository-persistent, non-sensitive
   manifest:
   `docs/release/evidence/windows-clean-install-v4.json`.
3. `check:product` labels itself `automated-artifacts-only`, exposes
   `automatedArtifactReadiness`, validates the evidence schema, and lists every
   manual release trial.
4. `dist:win` records a real build start and finish, and `verify:release`
   correlates installer, blockmap, and unpacked executable version, hash, size,
   modification time, and same-build time window.

## Review-Fix TDD Evidence

Every production change followed RED then GREEN.

### Uninstall And Readiness Scope

RED:

```text
node --test tests/task-13-review-fixes.test.js
2 tests, 0 passed, 2 failed
- readinessScope was undefined
- trial guide had no uninstall fallback
```

GREEN:

```text
2 tests, 2 passed, 0 failed
```

When the clean-install claim was narrowed, a second RED required the additional
`windows-isolated-clean-install-uninstall` manual item; the same focused file
returned 2/2 after implementation.

### Persistent Clean-Install Evidence

RED:

```text
ERR_MODULE_NOT_FOUND: scripts/clean-install-evidence-core.mjs
```

After the schema existed, the remaining RED failures identified the missing
manifest, readiness gate, and package command. GREEN reached 5/5. A real
no-root collector run then exposed a normalization gap:

```text
shortcut target must be normalized
shortcut working directory must be normalized
```

The fallback now records a normalized redacted role and the collector test
passes 6/6.

### Build Provenance And Freshness

RED:

```text
ERR_MODULE_NOT_FOUND: scripts/release-build-provenance-core.mjs
dist:win still called electron-builder directly
```

GREEN:

```text
17 focused packaging/provenance tests passed
```

The tests reject a stale same-version installer, version mismatch, artifact
hash drift, and an artifact outside the recorded build window.

## Packaged Startup Baseline

The prior approved real Windows desktop smoke remains the packaged-start
baseline:

```json
{
  "ok": true,
  "hiddenLaunchStayedAlive": true,
  "secondLaunchExited": true,
  "secondLaunchRevealedExistingWindow": true,
  "duplicateMainInstances": 0
}
```

The smoke scopes processes by exact executable and isolated user-data role,
excludes Electron helpers, requires a visible native window, bounds all waits,
and cleans only its known children and scoped profile.

## Release Build Provenance

`npm.cmd run dist:win` rebuilt only the project `dist` directory and did not run
the installer. It generated `dist/local-flow-release-build.json`:

- build started: `2026-07-28T05:03:59.664Z`;
- build finished: `2026-07-28T05:04:58.887Z`;
- three-artifact modification-time span: 46,844 ms;
- package, installer, and unpacked executable version: `0.1.0`.

Fresh release artifacts:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist/Local Flow Setup 0.1.0.exe` | 244,136,924 | `14f7ba0cb98e273dc60f3b67858ae98b53eb7d1b6e7f769924c18d198db325e7` |
| `dist/Local Flow Setup 0.1.0.exe.blockmap` | 255,888 | `d6435434dfaf401f6d1fb8b2bae9cb88266f42ea03ef024143df49fbd3556157` |
| `dist/win-unpacked/Local Flow.exe` | 210,485,248 | `05a18fce49f1e9eb2686f4103090a31e648fc9e17ff57124f3e63c801b799b04` |

`verify:release` also confirms the bundled Whisper CLI/model, llama.cpp
runtime, valid optional Qwen manifest, and absence of a bundled Qwen GGUF.
The Windows GitHub artifact now retains `local-flow-release-build.json`
alongside the installer, blockmap, and unpacked directory.

## Persistent Clean-Install Evidence

The retained manifest is validated by
`scripts/clean-install-evidence-core.mjs` and `check:product`. It rejects a
`passed` trial unless every required field has observed proof. It also rejects
SID values, user names, command lines, and absolute drive paths.

Current read-only observations are stored with normalized roles:

- existing executable:
  `05a18fce49f1e9eb2686f4103090a31e648fc9e17ff57124f3e63c801b799b04`,
  210,485,248 bytes, matching the unpacked executable;
- existing uninstaller:
  `91daf21af55e1ca70887285038184b408ab3ea4ada6576a2a1f40b1367ee35a0`,
  530,237 bytes;
- Start-menu shortcut:
  `48045b3078c0607524328e760847b4d909e960897ec8bb9a1616c7446bf744a6`,
  targeting `<existing-install-root>/Local Flow.exe`;
- no desktop `Local Flow.lnk`;
- no scoped Local Flow or Notepad process;
- no `.tmp/clean-install*` entry.

The initial review's no-registration result came from the restricted execution
identity. A later elevated read-only collection used the interactive user
profile and observed a current-user `Local Flow 0.1.0` entry, also visible
through the loaded-user role. No SID or profile path is retained. Because the
two scopes differed and no before/after clean-install snapshot survived, this
report makes no claim that the earlier installer trial created, preserved, or
restored the registration. The guide remains valid whether the entry is present
or absent.

## Claims Explicitly Withdrawn

The prior report claimed a successful sentinel-preservation trial, exact
Notepad insertion, shortcut restoration, registry restoration, and isolated
uninstall cleanup. Those disposable artifacts were not retained, so the claims
are removed rather than repeated.

The persistent manifest truthfully records:

- `cleanInstallTrial.status = "not_run"`;
- sentinel before/after = `not_run`;
- shortcut before/after = `not_run`;
- uninstall registration before/after = `not_run`;
- isolated process scope = `not_run`;
- product text insertion = `manual_required`.

## Automated Readiness

Fresh review-fix verification:

- focused Task 13 tests: 37 passed, 0 failed;
- `npm.cmd test`: 590 passed, 0 failed, 0 cancelled, 0 skipped;
- `npm.cmd run dist:win`: exit 0;
- `npm.cmd run check:product`: exit 0 with
  `automatedArtifactReadiness=true`;
- `npm.cmd run verify:release`: exit 0 with same-build provenance accepted.

Earlier real desktop `check:app`, `check:microphone`, `check:visual`, and
`check:packaged` evidence remains baseline evidence and was not rerun inside a
sandbox.

## Manual-Only Evidence

The following must not be represented as unattended proof:

1. live Chinese, English, Japanese, and one additional-language recordings;
2. live target-language conversion after explicit target selection;
3. complete microphone-to-Whisper-to-Notepad global-shortcut input;
4. live Escape cancellation with confirmation that no history row is added;
5. visual confirmation of the one-time Windows tray balloon;
6. a complete isolated install/uninstall trial retaining sentinel,
   shortcut, registry, process, and insertion before/after evidence;
7. iPhone build, signing, permissions, keyboard extension, and device behavior
   on macOS with Xcode.

## Remaining Concerns

- The installer is not commercially code-signed, so Windows SmartScreen may
  show an unknown-publisher warning.
- Electron Builder warns that `asar` is disabled; this existing release-layout
  decision is unchanged.
- Qwen installation remains optional and network-dependent; its model file is
  intentionally excluded from the installer.
- Native iPhone verification still requires macOS and Xcode.
