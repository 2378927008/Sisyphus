# Windows Input Experience V2 Design

## Goal

Make Local Flow feel like a dependable Windows voice input tool, not just an app window that can transcribe audio.

V2 combines two tracks:

- input reliability: shortcut-driven dictation into the active Windows app should be predictable;
- HUD/UI polish: users should always understand what Local Flow is doing and how to recover.

This phase does not implement a native Windows TSF/IME. Native IME work remains a later spike because it requires native components, installer registration, signing, language bar behavior, candidate UI, and app compatibility work. V2 keeps the lower-risk companion-app architecture: background Electron process, global shortcut, HUD, Whisper transcription, and paste into the active field.

## Product Requirements

Local Flow should support a repeated daily loop:

1. User focuses a text field in another Windows app.
2. User presses `Ctrl + Alt + Space`.
3. Local Flow starts recording without bringing the main window forward.
4. HUD shows recording state and elapsed time.
5. User presses the shortcut again.
6. Local Flow transcribes, processes, and pastes the result into the active field.
7. HUD confirms success or gives a short actionable error.
8. If paste fails, the result remains recoverable from clipboard, history, and the main window.

The default language behavior remains input-method behavior:

- output language `Auto` keeps the language the user spoke;
- fixed target output languages require a capable text provider such as MyMemory Free, Ollama, or a working local model;
- missing Qwen must not block normal same-language dictation.

## Scope

### Track A: Input Reliability

Improve the existing system input controller and main-process wiring so the app cannot get stuck or silently lose text.

Required behavior:

- shortcut start and stop commands remain idempotent under rapid repeated presses;
- renderer command timeouts recover to a terminal error state and reset recording lifecycle;
- terminal states (`done`, `warning`, `error`) return to `idle` after a short visible period;
- hidden main-window recording stays supported where Electron allows it;
- if hidden recording fails, Local Flow reports the failure and gives a recovery path instead of staying busy;
- paste failures preserve the final text in history and clipboard when possible;
- tray menu state mirrors recording state and offers open-settings / retry paths.

### Track B: HUD And UI Polish

Turn the HUD from a technical status dot into a compact operational surface.

Required HUD states:

- idle: only shown when explicitly invoked or when needed for a short hint;
- starting: "Starting recording";
- recording: microphone indicator plus elapsed timer;
- stopping: "Stopping";
- transcribing: "Transcribing";
- pasting: "Pasting into active app";
- done: "Inserted";
- warning: "Needs review" with short reason;
- error: "Needs attention" with short reason.

The HUD must not expose raw model paths, stack traces, provider internals, or long diagnostic text. Full details belong in the main window.

The main window remains the recovery and setup surface:

- latest result is editable and copyable;
- history stores complete, partial, and failed target-output attempts appropriately;
- setup checklist explains when Whisper is required and Qwen is optional;
- settings drawer keeps advanced provider choices out of the primary dictation flow.

## Architecture

V2 keeps existing boundaries and tightens contracts.

### Main Process

The main process owns system input state through `createSystemInputController`.

Responsibilities:

- own current phase;
- broadcast state to main renderer, HUD renderer, and tray;
- issue explicit `recording:start`, `recording:stop`, and `recording:reset` messages;
- enforce command timeouts;
- keep terminal states visible briefly, then return to idle;
- never expose raw IPC or shell execution to renderers.

### Main Renderer

The main renderer still owns browser microphone access and WAV encoding.

Responsibilities:

- start/stop microphone capture;
- report lifecycle phases to main process;
- process WAV through existing `dictation:wav`;
- render latest result and history;
- recover from stale recording operations.

The renderer should never decide global shortcut behavior. It reports lifecycle; the main process coordinates system input.

### HUD Renderer

The HUD is display-only.

Responsibilities:

- subscribe to system input status;
- render concise localized state;
- show elapsed time while recording;
- avoid focusable controls;
- remain non-focus-stealing.

### Paste Pipeline

The paste pipeline remains clipboard plus `Ctrl+V` for V2, but it becomes more failure-aware:

- write final text to clipboard before sending paste;
- report paste command failures distinctly;
- leave text in history even when paste fails;
- avoid pasting diagnostic or raw error text;
- keep command construction allowlisted.

## Data Flow

### Successful Dictation

1. Hotkey manager receives shortcut.
2. System input controller enters `starting`.
3. Main process sends `recording:start` to main renderer.
4. Renderer starts microphone and reports `recording`.
5. HUD shows elapsed timer.
6. Hotkey triggers stop.
7. System input controller enters `stopping`.
8. Renderer stops recorder and sends WAV for processing.
9. Dictation service transcribes and processes text.
10. Dictation service writes history and pastes when enabled.
11. Renderer reports `done`.
12. HUD shows success, tray updates, state auto-idles.

### Paste Failure

1. Transcription and text processing succeed.
2. Clipboard write succeeds or fails explicitly.
3. Paste command fails or exits non-zero.
4. Dictation entry remains available in history.
5. HUD shows "Paste failed. Text saved."
6. Main window status includes the detailed error.
7. User can open Local Flow from tray and copy/edit the result.

### Setup Not Ready

If Whisper or microphone access is unavailable:

- record button and shortcut path should report not ready;
- HUD shows a short error;
- tray offers Settings;
- main window shows setup checklist and diagnostics.

## Error Handling

V2 must distinguish these failures:

- `not_ready`: provider or microphone setup is incomplete;
- `renderer_timeout`: main renderer did not acknowledge start/stop;
- `recording_failed`: microphone capture failed;
- `transcription_failed`: Whisper failed;
- `target_output_failed`: selected output language could not be produced;
- `clipboard_unavailable`: clipboard write is unavailable;
- `paste_failed`: paste command failed after result creation.

All user-facing messages should be localized through existing i18n patterns. Short HUD messages should be stable enough for tray tooltips. Detailed messages remain in the main window.

## UI Direction

HUD style should be quiet and functional:

- compact floating pill, not a large modal;
- clear state color and icon/dot;
- elapsed timer during recording;
- no settings controls;
- no decorative hero-style UI;
- high contrast enough for desktop backgrounds;
- no text overflow in Chinese, English, Japanese, Korean, French, Russian, Spanish, or Traditional Chinese.

Main window changes should be limited to reliability support:

- improve failed paste/result recovery copy;
- ensure latest result and history make sense after partial failures;
- keep advanced model settings in the drawer;
- avoid turning the main window into the primary dictation surface again.

## Out Of Scope

- Native Windows TSF/IME implementation.
- Candidate window or composition UI.
- System language bar integration.
- Code signing certificate work.
- Auto-update infrastructure.
- iPhone implementation.
- New paid cloud provider integration.
- Large redesign of the main app layout unrelated to input reliability.

## Testing

Automated coverage should include:

- system input controller state transitions for rapid toggles and terminal auto-idle;
- start/stop timeout recovery;
- HUD renderer state labels and elapsed timer behavior;
- paste failure produces recoverable result state;
- dictation history preserves successful text when paste fails;
- tray tooltip/menu reflects recording and error phases;
- Qwen missing does not block Auto same-language dictation;
- target output language still blocks or fails clearly when no capable text provider exists;
- app smoke confirms MyMemory target-output path can record;
- microphone smoke still passes.

Manual tests should cover:

- Notepad dictation and paste;
- browser text field dictation and paste;
- WeChat or another desktop app dictation and paste;
- shortcut spam during starting/stopping;
- paste failure simulation;
- hidden startup, tray-only operation, then dictation;
- opening settings from tray after a HUD error.

## Acceptance Criteria

- A configured user can dictate into another Windows app without opening the main window.
- HUD clearly shows recording, processing, inserted, warning, and error states.
- Rapid shortcut presses do not leave the app stuck.
- Paste failures keep the produced text recoverable.
- The main window remains available for setup, history, editing, and diagnostics.
- Auto output preserves spoken language and does not require Qwen.
- Existing Windows installer flow still builds and verifies.
- `npm.cmd test`, `npm.cmd run check:app`, and `npm.cmd run check:microphone` pass.

