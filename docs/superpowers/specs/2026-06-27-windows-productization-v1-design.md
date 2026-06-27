# Windows Productization V1 Design

## Goal

Turn Local Flow from a developer-run Electron MVP into a Windows desktop product that can be installed, launched at startup, controlled from the tray, and used repeatedly as a background voice input assistant.

This phase does not build a native Windows TSF/IME. It keeps the lower-risk companion-app architecture from Windows System Input V1 and productizes the Windows shell around it.

## Product Positioning

Local Flow should feel like a voice input utility, not a translation app and not a web page. The normal loop is:

1. The app starts in the background or opens the main window on first run.
2. The user focuses a text field in another Windows app.
3. The user presses the global shortcut.
4. A compact HUD appears without stealing focus.
5. Speech is recorded, transcribed, cleaned up, and pasted into the focused field.
6. The app remains available from the tray for settings, diagnostics, and recovery.

## Scope

### Installer

Use `electron-builder` to produce a Windows NSIS installer.

The installer should:

- set product name to `Local Flow`;
- generate an installer under `dist/`;
- create Start Menu and desktop shortcuts;
- package the Electron app, source files, scripts, and vendor assets needed by the current local-first workflow;
- exclude development-only files such as `.git`, `.worktrees`, docs plans, tests, and generated output folders;
- keep `dist/` ignored by git.

Installer artifacts are build outputs and should not be committed.

### Startup Behavior

Add a user-facing setting for launching Local Flow at Windows login.

Requirements:

- default is off;
- setting is persisted with the existing settings store;
- use Electron `app.setLoginItemSettings()` in the main process;
- reflect the current setting in the settings drawer and tray menu;
- when enabled, the app should launch in a background-friendly mode after login.

### Background Mode

Add a separate setting for startup window behavior:

- default remains main-window-visible for safer first-run setup;
- user can enable "start minimized to tray";
- closing the main window hides it to tray rather than quitting;
- quitting remains explicit through the tray menu.

Normal dictation should not require the main window once setup is complete.

### Tray Menu

Improve the tray from a minimal development menu into the main background control surface.

Required tray items:

- Show Local Flow;
- Start/stop dictation;
- Pause/resume global shortcut;
- Launch at login toggle;
- Start minimized toggle;
- Settings;
- Quit.

Tray labels should follow the selected interface language where practical. If full runtime localization is too large for this phase, English and Simplified Chinese must be correct and the implementation must fall back cleanly to English.

The tray should also reflect core state:

- idle;
- starting;
- recording;
- stopping;
- transcribing;
- done;
- warning;
- error.

### Global Shortcut Stability

The global shortcut should be reliable and recoverable.

Requirements:

- saving settings re-registers the shortcut;
- duplicate or invalid shortcut registration failures surface in the HUD and main status;
- a pause/resume shortcut mode disables global shortcut handling without quitting the app;
- tray state shows whether shortcuts are paused;
- paused shortcuts remain paused until the user resumes them or changes the setting.

This phase does not need a full shortcut recorder UI. The existing text setting can remain if validation and error reporting are clear.

### Startup And Packaging Scripts

Add package scripts:

- `package:win`: build an unpacked or packaged Windows app suitable for local validation;
- `dist:win`: build the NSIS installer.

The existing `Start-LocalFlow.cmd` remains for developer and source-tree use.

### Documentation

Update `README.md` with:

- installing from the generated Windows installer;
- running from source for development;
- launch-at-login behavior;
- tray menu usage;
- shortcut conflict recovery;
- where installer artifacts are generated.

## Architecture

### Main Process

The main process owns Windows product behavior:

- tray menu construction and refresh;
- global shortcut registration lifecycle;
- login item settings;
- startup minimized behavior;
- app quit versus hide-to-tray behavior.

Keep these responsibilities in focused modules where possible instead of growing `src/main/index.js` further.

Recommended modules:

- `src/main/tray-menu.js`: build tray template from state, settings, and callbacks;
- `src/main/startup-settings.js`: read/apply launch-at-login and startup-window settings;
- `src/main/hotkey-manager.js`: register, pause, resume, and report global shortcut status.

### Renderer

The renderer exposes settings controls and status. It should not directly call Windows startup APIs.

Settings to add:

- launch at login;
- start minimized to tray;
- pause global shortcut, if kept as persistent user preference.

The renderer continues to use existing IPC patterns through `preload.cjs`.

### Packaging

Use `electron-builder` from npm. Keep packaging configuration in `package.json` unless it grows enough to justify a separate config file.

The package config should avoid bundling large accidental directories and should keep app runtime assets explicit.

## Data Model

Extend settings with:

```js
launchAtLogin: false,
startMinimizedToTray: false,
globalShortcutPaused: false
```

Normalize these values to booleans in `mergeSettings`.

## Error Handling

Required errors and user-visible behavior:

- hotkey registration failed: HUD and main status explain the conflict;
- startup login item apply failed: settings status explains the failure and keeps previous persisted setting;
- tray action failed: status shows a short error and app remains running;
- package command missing dependencies: npm script exits non-zero and documentation points to `npm install`.

## Testing

Automated tests must cover:

- settings defaults and boolean normalization;
- startup settings adapter calls `app.setLoginItemSettings()` with expected values;
- tray menu contains required actions and localized labels;
- hotkey manager supports register, unregister, pause, resume, and failure reporting;
- main process source wires the productization modules instead of duplicating all logic inline;
- package scripts and `electron-builder` config exist;
- installer output directory is ignored.

Smoke tests must still cover:

- app starts and returns `"ok": true`;
- microphone smoke returns `"ok": true`;
- HUD and main window still exist;
- default Auto output behavior remains same-language.

Manual validation should cover:

- build installer with `npm.cmd run dist:win`;
- install app on this Windows user profile;
- launch from Start Menu shortcut;
- enable launch at login;
- close main window and confirm tray remains;
- start and stop dictation from tray;
- pause shortcut and confirm global shortcut no longer starts recording;
- resume shortcut and confirm it works again.

## Acceptance Criteria

- `npm.cmd run dist:win` produces a Windows installer under `dist/`.
- Installed Local Flow launches and shows the main window on first run.
- Closing the window keeps the app available from the tray.
- Launch-at-login can be enabled and disabled from settings or tray.
- Start-minimized-to-tray can be enabled and disabled.
- Global shortcut can be paused/resumed without quitting.
- Hotkey registration failures are visible and recoverable.
- Existing dictation, HUD, app smoke, and microphone smoke tests pass.
- Worktree is clean after implementation and build artifacts remain untracked.

## Out Of Scope

- Native Windows TSF/IME registration.
- Auto-update service.
- Code signing certificate purchase or signing pipeline.
- Store packaging.
- Multi-user enterprise installer policy.
- Replacing Whisper or solving Qwen runtime stability.
