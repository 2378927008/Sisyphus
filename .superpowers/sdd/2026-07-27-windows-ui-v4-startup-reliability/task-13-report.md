# Task 13 Report: Packaged Startup And Windows Installer

Status: Fix Round 4 implemented and verified (awaiting scoped re-review; Task
13 not complete)

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

## Fix Round 2 (2026-07-28)

Status: implemented and verified with TDD; awaiting scoped re-review. Task 13
is not complete.

This round addresses the three Important findings in
`task-13-re-review.md`. It changes only the Windows clean-install evidence
collector, validator, persistent manifest, tests, and this Task 13 record. It
does not change iPhone source, Task 12 UI, model selection, or API policy. No
installer or uninstaller was run, no release package was rebuilt, and the
existing installation root was not accessed or modified.

### Passed Proof Shape

A `passed` trial now requires actual proof instead of nine status strings:

- normalized `<isolated-install-root>` role and value;
- sentinel before/after SHA-256;
- shortcut before/after normalized target and SHA-256;
- uninstall-registration before/after snapshots with all four registry views,
  an interactive execution-context role, per-view counts, and entry arrays;
- exact isolated executable/profile roles and a non-negative process count;
- a reproducible Notepad insertion path, normalized target-file role/path,
  target-file SHA-256 and size, UTC observation timestamp, and isolated profile
  role.

RED:

```text
node --test tests/clean-install-evidence.test.js
8 tests: 7 passed, 1 failed
observed statuses with null proof returned true instead of false
```

GREEN:

```text
8 tests: 8 passed, 0 failed
```

### Registry Identity And Scope Readability

The collector no longer uses `SilentlyContinue` for uninstall registration.
Each scope uses terminating access checks and reports `observed` only when the
query succeeds and its execution context is trusted for that view. The
non-sensitive roles are:

- `collector_current_user`;
- `local_machine_64`;
- `local_machine_32`;
- `loaded_user_profiles`.

Every scope records `collectionContextRole`; the snapshot records
`executionContextRole` as `interactive_user`, `restricted_process`, or
`unknown`. Restricted collection cannot use current-user or loaded-profile
views as interactive-user proof. Unknown identity produces only
`unsupported`; partial coverage produces `partial`; neither can conclude
`absent`.

RED:

```text
registry pure tests: missing buildUninstallRegistrationEvidence export
collector integration: executionContextRole and trusted scope roles absent
```

GREEN:

```text
registry pure tests: 3 passed, 0 failed
collector integration: 1 passed, 0 failed
```

The committed legacy registry snapshot did not retain per-scope access
confirmation. It is therefore conservatively reclassified as:

```text
currentState.status = partial
executionContextRole = unknown
uninstallRegistration.status = unsupported
uninstallRegistration.conclusion = unknown
```

The earlier normalized executable, uninstaller, shortcut, process, and
temporary-artifact observations remain retained. The historical interactive
registry observation remains narrative context only; it is not promoted to a
new current trusted snapshot.

### Full Output Privacy

The validator now checks every nested string value and object key. It rejects
raw drive paths, UNC paths, user-profile paths, SIDs, user identity values,
command lines, prohibited identity fields, and configured current-user/profile
tokens. `%APPDATA%`, `%USERPROFILE%`, and `<existing-install-root>` remain
valid normalized roles.

The collector applies the same recursive redaction before JSON persistence,
before success output, and before failure output. PowerShell failures are
reduced to normalized reasons; raw exception messages are not printed.
Registry results retain only display metadata and normalized target roles, not
raw uninstall command lines.

RED:

```text
privacy tests: 4 passed, 6 failed
- UNC, user-name, and command-line values were accepted
- recursive redaction was absent
- a synthetic sensitive user-profile path was printed verbatim

nested-object-key test: validation returned true

specific-root precedence test:
%USERPROFILE% replaced the exact normalized install-root role

placeholder-collision test:
short user-name tokens rejected valid normalized role placeholders
```

GREEN:

```text
privacy tests: 10 passed, 0 failed
nested-object-key test: 1 passed, 0 failed
specific-root precedence test: 1 passed, 0 failed
placeholder-collision test: 1 passed, 0 failed
```

### Evidence And Manual Boundary

`docs/release/evidence/windows-clean-install-v4.json` still records:

- `cleanInstallTrial.status = "not_run"`;
- sentinel, shortcut, uninstall-registration, and process proof as `not_run`;
- Notepad insertion as `manual_required`;
- `installerRun = false`;
- `uninstallerRun = false`.

A complete isolated install/uninstall trial and live microphone-to-Notepad
insertion remain manual-only. The complete manual-validation list in Automated
Readiness remains unchanged.

Fresh Fix Round 2 verification:

- focused evidence, registry, privacy, readiness, and provenance tests:
  30 passed, 0 failed;
- `npm.cmd test`: 608 passed, 0 failed, 0 cancelled, 0 skipped;
- `npm.cmd run check:product`: exit 0,
  `automatedArtifactReadiness=true`;
- `npm.cmd run verify:release`: exit 0, existing same-build provenance accepted
  with 46,844 ms artifact skew;
- both changed evidence scripts passed `node --check`;
- `git diff --check`: passed.

No real-desktop manual validation was run or claimed in this round. No
installer/uninstaller was executed, no release artifact was rebuilt, and the
existing installation root was not accessed.

## Fix Round 3 (2026-07-28)

Status: implemented and verified with TDD; awaiting scoped re-review. Task 13
is not complete.

This round is limited to the three Important findings in
`task-13-re-review-round-2.md`. It changes the clean-install evidence
validator, focused evidence tests, and Task 13 records only. The collector's
registry identity and access decisions are unchanged. No UI, iPhone, model,
API, release package, installer, uninstaller, or existing installation was
accessed or modified.

### RED

Passed-proof consistency:

```text
node --test tests/clean-install-evidence.test.js
14 tests: 9 passed, 5 failed
- null matchingEntries element was accepted
- per-role matchingEntryCount mismatch was accepted
- duplicate standard scope role was accepted
- malformed display metadata and target roles were not fully rejected
- matchingProcessCount=999 was accepted
```

The existing missing-role guard remained GREEN during RED. The complete
positive fixture was corrected to retain both claimed before entries and
remained GREEN.

Privacy and benign-ASCII behavior:

```text
node --test tests/clean-install-evidence-privacy.test.js
18 tests: 14 passed, 4 failed
- <Administrator> was protected in nested values and keys
- location=\\private-server\share bypassed nested value/key checks
- git status, whoami /user, and LocalFlow.exe record survived command fields
- The node runtime is available for evidence collection. was rejected
```

### GREEN

For a `passed` trial, each uninstall-registration snapshot now:

- requires every matching entry to be a non-null object;
- validates a standard scope role, bounded string display metadata, and
  allowlisted install/uninstall target roles;
- requires every standard scope role exactly once;
- reconciles each scope's count with retained entries for that role;
- reconciles `present`/`absent` conclusion with the retained entries; and
- requires every scope and snapshot to be observed under the interactive role.

A passed trial now requires the final isolated process count to equal zero.
The complete positive fixture includes two before entries matching its
current-user and loaded-profile counts, plus an empty and `absent` after
snapshot.

Privacy handling now:

- protects only explicit schema placeholders such as `%APPDATA%`,
  `%USERPROFILE%`, `<existing-install-root>`, `<isolated-install-root>`,
  `<isolated-test-profile>`, `<project-root>`, and redaction roles;
- detects embedded backslash UNC paths without requiring a leading boundary;
- passes command-bearing field context recursively for `command`,
  `commandLine`, `args`, `argv`, and `shellCommand`;
- treats an executable-plus-arguments form as explicit command grammar for
  dynamic keys and unstructured values; and
- preserves ordinary English and Chinese explanations and allowed relative
  paths.

Validation and redaction tests are symmetric for arbitrary angle-bracket user
tokens, embedded UNC values/keys, command-bearing fields, explicit command
keys, legal placeholders, benign ASCII, Chinese text, and relative paths.

### Verification

```text
node --test tests/clean-install-evidence.test.js tests/clean-install-evidence-privacy.test.js tests/clean-install-registry-evidence.test.js tests/task-13-review-fixes.test.js
37 passed, 0 failed

node --check scripts/clean-install-evidence-core.mjs
exit 0

node --check scripts/clean-install-evidence.mjs
exit 0

npm.cmd test
619 passed, 0 failed, 0 cancelled, 0 skipped

npm.cmd run check:product
exit 0; ok=true; automatedArtifactReadiness=true

npm.cmd run verify:release
exit 0; ok=true; version=0.1.0; artifactSkewMs=46844

git diff --check
exit 0
```

The committed evidence manifest remains valid and deliberately unchanged with
`cleanInstallTrial.status = "not_run"`. A real isolated install/uninstall,
microphone-to-Notepad insertion, and the other documented desktop/device
trials remain manual-only. No such trial is claimed by this round.

## Fix Round 4 (2026-07-28)

Status: implemented and verified with TDD; awaiting scoped re-review. Task 13
is not complete.

This round is limited to the residual Important finding in
`task-13-re-review-round-3.md`. It changes only explicit command-key privacy
grammar, focused privacy tests, and Task 13 records. The collector registry
identity, passed-proof schema, UI, iPhone, model, API, installer, uninstaller,
and release workflow are unchanged. No installer or uninstaller was run, and
the existing installation root was not accessed.

### RED

```text
node --test tests/clean-install-evidence-privacy.test.js
38 tests: 24 passed, 14 failed
```

The two new parent tests contained 18 validation/redaction subtests. The
`git status` and `whoami /user` null, empty, and non-empty cases produced 12
expected failing subtests because their nested dynamic keys were accepted and
preserved. Node also counted the two failed parent tests. All six
`LocalFlow.exe record` subtests remained GREEN, as did the benign ASCII
key/value control.

### GREEN

```text
node --test tests/clean-install-evidence-privacy.test.js
38 passed, 0 failed
```

`hasExplicitCommandGrammar()` now adds anchored grammar for bare `git status`
and `whoami /user` commands alongside the existing executable-extension
grammar. The recursive privacy walk remains unchanged and no global prose scan
was introduced.

Validation and redaction now symmetrically cover each of `git status`,
`whoami /user`, and `LocalFlow.exe record` as a nested dynamic key whose value
is null, empty, or non-empty. The exact sentence
`The node runtime is available for evidence collection.` remains valid and
unchanged as both a value and a dynamic key. Existing legal placeholders,
Chinese explanations, and relative paths remain covered by the focused suite.

### Verification

```text
node --test tests/clean-install-evidence.test.js tests/clean-install-evidence-privacy.test.js tests/clean-install-registry-evidence.test.js tests/task-13-review-fixes.test.js
57 passed, 0 failed

node --check scripts/clean-install-evidence-core.mjs
exit 0

node --check scripts/clean-install-evidence.mjs
exit 0

npm.cmd test
639 passed, 0 failed, 0 cancelled, 0 skipped

npm.cmd run check:product
exit 0; ok=true; automatedArtifactReadiness=true

npm.cmd run verify:release
exit 0; ok=true; version=0.1.0; artifactSkewMs=46844

git diff --check
exit 0
```

The committed evidence manifest remains unchanged and valid with
`cleanInstallTrial.status = "not_run"`. No real desktop or device trial was run
or claimed.
