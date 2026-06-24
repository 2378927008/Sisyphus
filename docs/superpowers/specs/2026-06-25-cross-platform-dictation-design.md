# Cross-Platform Dictation Product Design

## Goal

Build a voice input product inspired by Typeless and Wispr Flow, with Windows and iPhone treated as first-class platforms.

The product should feel like a real input method, not a transcription demo. The core experience is: speak naturally, get clean editable text, and insert or copy it into the app where the user is working.

## Product Reference

Mature AI dictation products in this category usually combine several layers:

- A system-level input surface: global hotkey, floating recorder, keyboard, shortcut, or clipboard insertion.
- ASR: speech recognition with automatic language detection.
- LLM or rules-based cleanup: remove filler words, add punctuation, format lists, handle self-corrections, and optionally translate.
- Personalization: dictionary, snippets, style presets, and app/context-aware formatting.
- Privacy controls: data retention settings, cloud sync settings, and clear user-facing processing mode.

Wispr Flow publicly states that transcription occurs in the cloud for speed and accuracy. Apple custom keyboard extensions cannot directly access the microphone, so an iPhone product needs a containing app plus keyboard/shortcut handoff rather than expecting the keyboard extension to record audio by itself.

## Platform Priority

Windows and iPhone are equal-priority targets.

Windows continues with the current Electron app because it already has recording, settings, local Whisper integration, local cleanup, history, and paste support.

iPhone gets a native SwiftUI app path because the user uses mobile often and iOS system integration matters more than sharing Electron code. The iPhone target should support:

- Main app recording surface.
- Custom keyboard extension for inserting generated text into any text field where custom keyboards are allowed.
- Shortcuts actions for quick dictation to clipboard, notes, or current keyboard flow.
- Action Button and Control Center setup guidance where available.
- Shared local settings and history through an app group container.

## Recognition Strategy

The app should not depend on OpenAI API keys.

Windows default:

- Primary: local whisper.cpp.
- Optional: cloud ASR provider when configured.

iPhone default:

- Primary: Apple Speech framework or system-supported speech recognition where available.
- Optional: cloud ASR provider when configured.

Cloud API providers are optional plugins, not product foundations. Free API offerings can change, have rate limits, or require account keys. The app must describe them as optional provider integrations rather than promising unlimited free transcription.

Initial provider abstraction:

- `localWhisper`: Windows local whisper.cpp.
- `appleSpeech`: iPhone system speech recognition.
- `cloudflareWorkersAi`: optional ASR/LLM provider.
- `groq`: optional ASR/LLM provider.
- `customOpenAiCompatible`: user-supplied base URL and API key for compatible providers.

## Text Processing Strategy

All platforms share the same logical pipeline:

1. Capture audio.
2. Transcribe speech.
3. Detect source language when recognition language is Auto.
4. Clean or transform text.
5. Apply output language behavior.
6. Save editable result and history.
7. Insert into the active text destination or copy to clipboard.

Output language behavior:

- Auto: keep the same language as the detected speech.
- Specific language: rewrite or translate into the chosen language.
- Original: preserve the recognized language and only do cleanup.

When an LLM provider is not available, the app should still produce useful output by applying deterministic cleanup rules. It should show a clear message when translation or advanced rewriting requires a configured provider.

## Language Support

Interface languages:

- English
- Simplified Chinese
- Japanese
- Korean
- Traditional Chinese
- French
- Russian
- Spanish

Recognition languages:

- Auto
- English
- Chinese
- Japanese
- Korean
- French
- Russian
- Spanish

Output languages:

- Auto, same as speech
- Original
- English
- Simplified Chinese
- Japanese
- Korean
- Traditional Chinese
- French
- Russian
- Spanish

Chinese recognition can remain one Chinese option. Output should split Simplified and Traditional Chinese because this is a writing preference.

## iPhone Architecture

The iPhone app should be built as a native Swift project with these targets:

- `DictationApp`: SwiftUI containing app for recording, settings, history, provider setup, and onboarding.
- `DictationKeyboard`: custom keyboard extension for text insertion and quick access.
- `DictationIntents`: App Intents and Shortcuts for quick dictation, clipboard output, note saving, and recording toggles.
- `SharedCore`: common Swift package for settings, provider definitions, language definitions, history models, and pipeline orchestration.

Because the keyboard extension cannot directly use microphone dictation, the keyboard should hand off recording to the containing app or use shortcuts. When returning to the keyboard, it inserts the finished text through `UITextDocumentProxy`.

Minimum iPhone MVP:

- Record in app.
- Transcribe through Apple Speech.
- Show editable result.
- Copy to clipboard.
- Save history.
- Add a custom keyboard with a mic button that launches or guides the user into app-based recording.
- Add one Shortcut: quick dictate to clipboard.

## Windows Architecture

Keep the existing Electron app and refine it around the same shared concepts:

- Home screen is the dictation workspace.
- Settings drawer contains advanced model paths, diagnostics, providers, dictionary, snippets, and shortcuts.
- Existing local Whisper and local LLM paths stay available.
- Cloud providers are added through a provider registry.
- The UI clearly shows the active processing mode: local, system, or cloud.

Windows should prioritize reliability:

- The record button must explain disabled states.
- Microphone permission checks must run before recording.
- Missing local model errors must point to setup steps.
- Cloud provider failures must not erase the raw transcript.

## Personalization

V1 should include simple local personalization:

- Personal dictionary.
- Replacement rules for names, products, and terms.
- Snippets: spoken cue to formatted text.
- Style presets: default, concise, polished, message, email, developer prompt.

Team/shared dictionary is out of scope for the first implementation but the data model should not block it later.

## Privacy And Trust

The app must make processing location visible before recording:

- Local: audio and text stay on device.
- System: processed by operating system service.
- Cloud: sent to the configured provider.

For cloud mode, the app should show:

- Provider name.
- Whether an API key is configured.
- Whether history is saved locally.
- A clear note that provider pricing and retention are controlled by that provider.

Default history storage should be local-only. Cross-device sync is out of scope for the first implementation.

## UI Direction

The first screen should be a usable dictation product surface:

- Large record control.
- Current platform mode and provider status.
- Recognition and output language controls.
- Editable latest result.
- Copy, paste or insert action.
- Recent history.

Advanced settings move into a drawer or dedicated settings screen:

- Providers.
- Model paths.
- Diagnostics.
- Dictionary.
- Snippets.
- Shortcuts.
- Privacy mode.

iPhone UI should be quieter and faster than the Windows setup UI:

- One-tap recording.
- Large result editor.
- Clipboard and share buttons.
- Clear setup cards for keyboard, shortcuts, Action Button, and Control Center.

## Error Handling

Required error states:

- Microphone permission denied.
- Microphone unavailable or used by another app.
- No speech detected.
- Recognition provider unavailable.
- Cloud quota or authentication failure.
- Translation requested but no capable provider is configured.
- iPhone keyboard cannot insert into secure or unsupported fields.
- User leaves the app during recording.

Each error must include a plain-language recovery action.

## Testing

Windows tests:

- Existing Node tests continue to cover language settings, media permission normalization, local ASR, local LLM, paste, and UI smoke checks.
- Add provider registry tests.
- Add output-language auto behavior tests.
- Add disabled record-button reason tests.

iPhone tests:

- Unit tests for language mapping and provider selection.
- Unit tests for output-language behavior.
- Unit tests for history and settings persistence.
- UI tests for recording permission screens and result editing.
- Keyboard extension tests for insertion and unsupported-field messaging where simulator support allows it.

Manual iPhone test checklist:

- Fresh install permission prompt.
- Denied microphone permission recovery.
- Record short Chinese, English, Japanese, and mixed-language samples.
- Auto output keeps detected language.
- Specific output language rewrites into target language.
- Keyboard handoff flow.
- Quick dictate to clipboard shortcut.

## Implementation Phases

Phase 1: Stabilize Windows MVP

- Keep current Electron work.
- Finish UI v2.
- Add provider abstraction without requiring cloud provider implementation.
- Fix record button disabled reasons and permission test coverage.

Phase 2: iPhone MVP

- Create SwiftUI app.
- Add recording with Apple Speech.
- Add language settings, editable result, clipboard, and local history.
- Add Shortcuts action for quick dictate to clipboard.

Phase 3: iPhone Input Integration

- Add keyboard extension.
- Add handoff from keyboard to app recording.
- Add setup guidance for keyboard, Action Button, Back Tap, and Control Center.

Phase 4: Cloud Provider Plugins

- Add optional Cloudflare Workers AI and Groq providers behind the same interface.
- Add provider health checks and quota/authentication error handling.
- Keep local/system providers as defaults.

Phase 5: Personalization

- Add dictionary, replacement rules, snippets, and style presets on both platforms.
- Keep sync local-only until a dedicated sync design is approved.

## Acceptance Criteria

- A user can dictate on Windows without an OpenAI key.
- A user can dictate on iPhone without installing a local model.
- Auto output language preserves the spoken language.
- Specific output language produces the selected language when a capable processor is available.
- The app never silently falls back to English.
- The UI makes local/system/cloud processing mode visible.
- Errors explain how to recover.
- Advanced settings do not dominate the home screen.
