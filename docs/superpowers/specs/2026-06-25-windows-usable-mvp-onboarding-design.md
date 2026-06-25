# Windows Usable MVP Onboarding Design

## Goal

Make the Windows app usable by a non-technical user without an OpenAI API key. A first-time user should understand what is missing, install or detect the local models, record speech, receive editable text, and know why a feature is unavailable when setup is incomplete.

This phase is Windows-only. iPhone, cloud ASR, and cloud text providers remain future phases.

## Product Position

The app should feel like a local-first voice input product, not a developer diagnostics panel. The home screen remains the dictation workspace. Advanced setup stays in the settings drawer, but first-run setup and model readiness become visible and actionable from the main experience.

## Primary User Flow

1. User opens the app.
2. App detects local Whisper and local Qwen/llama.cpp assets.
3. If Whisper is missing, the home screen shows a setup checklist and disables recording with a plain-language reason.
4. User can start Whisper installation from the app. The app runs the existing PowerShell setup script through the main process.
5. App shows install status, command output summary, and a retry path if the script fails.
6. User can refresh detection after installation. Detected paths are saved automatically.
7. If the local language model is missing, the app explains that dictation can still transcribe when Whisper is ready, but cleanup/translation needs the model.
8. User records speech, receives editable text, and can copy or paste it.

## Setup Scope

### Whisper

Whisper is required before recording can start. The app should expose:

- Detected executable path.
- Detected model path.
- Installed / missing / installing / failed status.
- A primary setup action that runs `scripts/setup-whisper.ps1 -Model base`.
- A refresh action that re-runs asset detection.
- A diagnostics action that validates executable and model paths.

The setup action should not download through renderer code. The renderer calls a main-process IPC handler, and the main process spawns PowerShell with `windowsHide: true`.

### Local Language Model

The Qwen3 local model is recommended for cleanup and target-language output. It is not required for raw transcription. The app should expose:

- Detected `llama-cli.exe` path.
- Detected Qwen GGUF model path.
- Installed / missing / installing / failed status.
- A setup action that runs `scripts/setup-llm.ps1`.
- A refresh action that re-runs asset detection.

If this model is missing and the user requests cleanup or translation that needs it, the app must preserve the raw transcript as a partial result and explain the missing model.

## UI Requirements

### Home Screen

The home screen should prioritize repeated dictation use:

- Large record control.
- Recognition language and output language controls.
- Processing mode line: local/system/cloud, with current provider.
- Setup checklist visible when required assets are missing.
- Editable latest result area.
- Recent history.
- Copy latest result button.

The home screen should not expose raw executable paths unless the user opens settings.

### Settings Drawer

The drawer keeps advanced controls:

- Interface language.
- Whisper executable and model paths.
- Qwen/llama.cpp executable and model paths.
- Model setup commands and install output.
- Whisper diagnostics.
- Microphone diagnostics.
- Text processing mode.
- Ollama fallback settings.
- Dictionary.
- Hotkey.

The drawer may include install buttons, but the first-run checklist on the home screen must also provide the primary install path.

## Main-Process Responsibilities

Add a model setup orchestration layer with clear boundaries:

- Detect current assets by reusing `detectWhisperAssets()` and `detectEmbeddedLlmAssets()`.
- Run setup scripts through a safe allowlist. Only known local scripts can be executed.
- Track one setup process at a time per model type.
- Return structured setup status to the renderer.
- Capture recent stdout/stderr lines for user-readable troubleshooting.
- Never accept arbitrary command strings from the renderer.

## Renderer Responsibilities

The renderer should:

- Render setup status and disable duplicate install clicks while installation is running.
- Refresh provider/model status after setup completes.
- Save detected paths through existing settings APIs.
- Keep record readiness focused on ASR readiness.
- Show text-model limitations as a warning, not as a hard block for recording.

## Error Handling

Required user-facing errors:

- PowerShell is unavailable.
- Setup script exits with a non-zero code.
- Network download fails.
- Download succeeds but expected executable/model is missing.
- Whisper executable or model path is invalid.
- Language model is missing when cleanup/translation is requested.
- User starts setup while another setup is already running.

Errors should include a plain recovery path: retry, check network, open settings, or run the displayed command manually.

## Security And Trust

- No OpenAI API key is required.
- No cloud provider is used in this phase.
- Renderer cannot execute arbitrary commands.
- Local setup scripts run only from the project `scripts` directory.
- Existing CSP and AudioWorklet recording protections remain in place.
- API keys stay redacted from renderer settings.

## Testing

Automated tests should cover:

- Main-process setup command construction.
- Allowlisted setup script execution.
- Setup status transitions: idle, running, complete, failed.
- Duplicate setup request rejection.
- Renderer setup checklist copy and disabled states.
- Smoke test verifies the setup checklist appears when assets are missing.
- Existing dictation, language, provider, settings, CSP, and microphone tests still pass.

Manual or smoke verification should cover:

- `npm.cmd test`.
- JS syntax checks.
- `npm.cmd run check:app`.
- `npm.cmd run check:microphone`.

## Acceptance Criteria

- Fresh app state clearly explains missing Whisper and shows an install action.
- Recording remains disabled until Whisper executable and model paths are ready.
- User can trigger Whisper setup from the app without copying a PowerShell command.
- User can trigger Qwen local model setup from the app.
- Successful setup refreshes status and persists detected paths.
- Failed setup shows actionable output without crashing the app.
- The home screen feels like a dictation product surface, not a settings page.
- All existing supported interface languages continue to render.
- Automated tests and smoke checks pass.
