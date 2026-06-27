# Windows Release Polish V1 Design

## Goal

Make the current Windows build feel like a product that can be installed, tested by another user, and diagnosed when setup fails.

This phase builds on Windows Productization V1. It does not replace the companion-app architecture with a native TSF/IME, and it does not start the iPhone implementation. The focus is release polish around the existing Windows app.

## Product Requirements

Local Flow should communicate a clear promise:

- it is a voice input app, not a translation app;
- automatic output keeps the spoken language;
- Whisper is required before recording;
- Qwen is optional for advanced local cleanup and target-language output;
- MyMemory Free is only used for selected target-language output, not for automatic same-language dictation.

The app should be understandable to a non-developer who installs it from `Local Flow Setup 0.1.0.exe`.

## Scope

### Documentation Repair

Repair the Chinese sections in `README.md`. The current file contains mojibake in the Chinese trial steps and model setup sections. Replace that corrupted text with valid UTF-8 Chinese.

The README must cover:

- installable build path;
- source run path;
- recommended first-run settings;
- why recording can be disabled;
- how to install or configure Whisper;
- why Qwen is optional;
- how to test microphone access;
- what automatic output means.

### Release Metadata

Add minimal release metadata to `package.json` so the installer is less obviously a raw Electron app:

- `author`;
- useful `homepage` or project metadata only if local and non-misleading;
- Windows application icon configuration when an icon file exists.

Do not add false company or repository URLs.

### App Icon

The existing SVG tray icon should remain the tray source of truth. For Windows packaging, add a generated `.ico` asset under `assets/` and configure electron-builder to use it for the app and installer.

The icon should be simple and legible at small sizes. It does not need final brand polish, but it should remove the default Electron icon from local builds.

### Build Verification

Add a lightweight packaging verification script that checks release-critical output after `dist:win`:

- installer exists;
- unpacked app executable exists;
- packaged app icon asset exists;
- package config includes Windows icon metadata;
- build artifacts remain ignored by git.

The script should not install the app or require elevated permissions.

### First-Run And Model Setup Copy

Improve user-facing copy where it reduces confusion:

- label Whisper as required for recording;
- label Qwen as optional;
- avoid implying Local Flow is primarily a translation tool;
- explain that automatic output follows the spoken language.

Keep this to text and status improvements. Do not redesign the whole UI in this phase.

## Out Of Scope

- Native Windows TSF/IME implementation.
- New iPhone app implementation.
- Paid cloud API integration.
- Automatic model bundling decisions beyond current `vendor` packaging behavior.
- Code signing certificates.
- Auto-update infrastructure.
- Full brand identity design.

## Architecture

Most changes should stay in release-facing boundaries:

- `package.json` for electron-builder metadata and scripts;
- `assets/` for icon files;
- `scripts/` for packaging verification;
- `README.md` for user documentation;
- existing i18n files for small copy corrections.

Avoid growing `src/main/index.js` unless a release issue requires main-process behavior. This phase should not introduce new background state machines.

## Testing

Use test-first changes where behavior is modified.

Automated coverage should include:

- package config exposes Windows icon metadata;
- packaging verification script exists and is wired to npm;
- README no longer contains common mojibake markers;
- user-facing copy still describes automatic output as same-language by default;
- existing tests remain green.

Manual or smoke verification:

- `npm.cmd test`;
- `npm.cmd run check:app`;
- `npm.cmd run check:microphone`;
- `npm.cmd run dist:win`;
- packaging verification script against `dist/`.

## Acceptance Criteria

- README Chinese trial/setup sections render as valid Chinese text.
- Installer builds with a configured Windows icon and no default Electron icon warning.
- `package.json` has minimal honest release metadata.
- A release verification command can check the local build artifacts.
- `npm.cmd test` passes.
- App and microphone smoke checks pass.
- `npm.cmd run dist:win` produces `dist/Local Flow Setup 0.1.0.exe`.
- Git status is clean except ignored build, dependency, worktree, and local vendor directories.
