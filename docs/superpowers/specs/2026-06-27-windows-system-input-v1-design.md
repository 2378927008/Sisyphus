# Windows System Input V1 Design

## Goal

Turn Local Flow from a usable dictation window into a Windows-wide voice input tool. A user should be able to stay in Notepad, a browser, WeChat, or another text field, press the global shortcut, speak, press the shortcut again, and receive text in the original field.

This is not a full Windows TSF/IME implementation. V1 deliberately uses a lower-risk architecture: background app, global shortcut, non-focus-stealing HUD, local transcription, and paste into the active field.

## Why Not Build A Real IME Yet

A real Windows input method requires TSF/IME integration, native components, installer registration, signing, composition handling, candidate UI, language bar behavior, and many app-specific edge cases. That is a much larger product and engineering project.

Typeless/Wispr Flow-style behavior can be approximated first with a background companion app. This gets the user value earlier and gives us real evidence before deciding whether native IME work is worth the cost.

## Product Flow

1. Local Flow starts and stays in the tray.
2. If first-run setup is incomplete, opening the app shows the full settings/setup window.
3. If setup is ready, the app can run with the main window hidden.
4. User focuses a text field in any app.
5. User presses `Ctrl + Alt + Space`.
6. A small HUD appears near the lower center of the screen without taking keyboard focus.
7. Recording starts through the existing renderer audio path.
8. User presses the shortcut again.
9. Recording stops, Whisper transcribes, text processing runs, and the app pastes the result into the still-focused field.
10. On failure, the HUD shows a short error and the text remains available in the main window history.

## Architecture

### Windows Surfaces

- Main window: full settings, setup, result editing, diagnostics, and history.
- HUD window: small recording/status surface for repeated use.
- Tray: show main window, start/stop dictation, quit.

The main window remains an Electron `BrowserWindow`. The HUD is a separate frameless Electron `BrowserWindow` with `alwaysOnTop`, `skipTaskbar`, and a non-focus-stealing configuration where Electron/Windows supports it.

### Recording Owner

V1 keeps the existing renderer recording path. The main renderer already owns `getUserMedia`, `AudioWorklet`, WAV encoding, and `dictation:wav` IPC. The global shortcut continues to send `recording:toggle` to this renderer.

The key behavior change is window lifecycle:

- The main window can be hidden while its webContents remains loaded.
- The HUD mirrors state but does not own microphone capture in V1.
- If hidden-window recording fails in manual testing, V1 falls back to showing the main window inactive for recording and logs that as an architecture boundary.

### Focus And Paste

V1 avoids stealing focus rather than trying to perfectly restore focus:

- Do not show the main window when the global shortcut starts recording.
- Show the HUD as non-focus-stealing.
- Keep the user's target app as the active foreground app.
- Paste uses the existing clipboard plus `Ctrl+V` path.

If a user starts dictation while the main settings window is focused, paste will target that window unless the user changes focus first. This is acceptable for V1 and should be explained by UI copy.

### State Machine

Add a main-process dictation mode state:

- `idle`
- `recording`
- `transcribing`
- `pasting`
- `done`
- `error`

The state is broadcast to:

- main renderer,
- HUD renderer,
- tray label/menu state.

The renderer can still emit detailed status, but the main process owns whether the app is in HUD/system input mode.

## Qwen Boundary

Qwen/llama.cpp remains optional. It is not part of Windows System Input V1 acceptance.

Current known issue: the local `llama-cli` path can crash with Windows exit code `3221225477`. That requires a separate stability spike covering binary selection, CPU instruction compatibility, runtime dependencies, and a tiny prompt smoke test.

Default system input behavior should use:

- local Whisper for speech recognition,
- automatic output preserving the spoken language,
- local deterministic cleanup,
- MyMemory Free only when the user explicitly selects a target output language.

## Third-Party Skill Safety

Third-party skills and open dictation apps may inform product patterns, but no external skill is installed or executed in this phase.

Before reuse:

- record URL and commit SHA,
- review license,
- inspect scripts and dependencies,
- reject arbitrary shell execution,
- reject hidden network fetches,
- copy only reviewed ideas into local docs/tests.

The project-local review gate is `docs/research/2026-06-27-third-party-skill-security-review.md`.

## UI Requirements

### HUD

The HUD should be compact and operational:

- idle hint when invoked,
- recording state,
- elapsed timer,
- transcribing state,
- paste/done state,
- short error state,
- no settings controls,
- no raw model paths.

### Main Window

The main window remains the setup and recovery surface:

- diagnostics,
- model setup,
- text provider settings,
- history,
- editable latest result.

It should not be required for normal repeated dictation once setup is ready.

## Error Handling

Required V1 errors:

- hotkey registration failed,
- microphone unavailable,
- Whisper not configured,
- recording failed while hidden,
- transcription failed,
- text processing failed for target language,
- paste command failed,
- clipboard unavailable.

Each error should appear in the HUD and main window status. The main history should retain raw/partial output when available.

## Testing

Automated tests should cover:

- HUD window option construction.
- State machine transitions.
- Global shortcut toggles without showing the main window.
- Tray "start/stop dictation" uses the same controller path.
- Main window close hides instead of quitting.
- Paste remains allowlisted and does not accept arbitrary command strings.
- Qwen missing does not block recording.

Smoke tests should cover:

- app starts with main window available,
- HUD DOM exists,
- shortcut IPC still toggles recording,
- default provider path remains Auto same-language,
- renderer console has no errors.

Manual tests should cover:

- Notepad: shortcut, dictate, paste.
- Browser text field: shortcut, dictate, paste.
- WeChat or another desktop app: shortcut, dictate, paste.
- Start with main window hidden.
- Open settings from tray and close back to tray.

## Acceptance Criteria

- A configured user can dictate into another Windows app without interacting with the main window.
- The HUD appears during dictation and disappears or settles after completion.
- The target app usually keeps focus through the recording loop.
- The final text is pasted into the active input field.
- Qwen missing or broken does not prevent recording.
- The main window remains available for setup and recovery.
- Automated tests, app smoke, and microphone smoke pass.

