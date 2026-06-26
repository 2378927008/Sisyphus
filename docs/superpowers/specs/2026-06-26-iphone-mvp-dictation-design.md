# iPhone MVP Dictation Design

## Goal

Build the first iPhone path for Local Flow as a real voice input product: speak, review editable text, and send it to the place where the user is writing.

This is not a translation-first app. With output language set to Auto, the iPhone app must keep the same language the user spoke. Translation or target-language rewriting is an explicit user choice.

## Constraints

- The default path must not require an OpenAI API key.
- The default path must be usable by many users without per-user paid API cost controlled by us.
- The first implementation should avoid bundling a large local model.
- The app should still leave a clean path for WhisperKit offline mode after the basic iPhone flow is proven.
- iOS custom keyboard extensions cannot be treated as a full recorder surface. The containing app owns recording; the keyboard extension helps with insertion and handoff.
- Windows and iPhone share product behavior, but not implementation technology. iPhone should be native Swift/SwiftUI.

## Recommended Approach

Use Apple Speech first, then add WhisperKit as an optional offline mode.

Apple Speech first is the fastest way to validate the iPhone product loop because it uses system speech recognition and avoids initial model packaging work. It also lets us test the hardest product question early: whether users can comfortably move between an iPhone recording surface, clipboard, shortcuts, and a keyboard-assisted insertion path.

WhisperKit remains the second track because it fits the free/offline privacy goal better. It should not block the first iPhone MVP because model size, first-run download, thermal behavior, memory pressure, and extension constraints all need separate validation.

## Alternatives Considered

### Option A: Apple Speech First

Pros:

- Fastest route to a working iPhone MVP.
- No bundled model in the first build.
- Works well for testing microphone permissions, editing, history, clipboard, and shortcuts.

Cons:

- System speech availability and behavior can vary by language, device, region, and OS version.
- Privacy mode is "system" rather than strictly local.

Decision: use this as the first implementation path.

### Option B: WhisperKit First

Pros:

- Strongest local/offline story.
- Better long-term match for multi-user cost control.
- Open-source Swift-native direction aligns with projects like Dictus iOS and Pindrop.

Cons:

- Larger packaging and performance risk.
- First-run model download and storage UX must be designed.
- Keyboard extension constraints still remain.

Decision: keep as the second prototype after Apple Speech MVP.

### Option C: Free Cloud API First

Pros:

- Could be simpler to ship if a provider has a generous free tier.
- Can provide strong accuracy for some languages.

Cons:

- Free API terms, limits, pricing, and availability can change.
- Multi-user usage can become unreliable or expensive.
- Does not satisfy the local/system-first trust goal.

Decision: do not use this as the product foundation. Cloud providers can be optional later.

## Product Scope

The first iPhone MVP includes:

- SwiftUI host app.
- Microphone permission onboarding.
- One-tap recording surface.
- Apple Speech transcription.
- Recognition language setting with Auto as default.
- Output language setting with Auto as default.
- Editable latest result.
- Copy to clipboard.
- Share sheet.
- Local history.
- Shortcut action for "dictate to clipboard" or "open quick dictation".
- Keyboard extension setup screen and a minimal keyboard extension that explains handoff and can insert the latest copied or shared result where supported.

The first iPhone MVP excludes:

- Built-in OpenAI API requirement.
- Team accounts or paid cloud sync.
- Full WhisperKit offline transcription.
- Target-language translation without a capable provider.
- Real-time word-by-word streaming UI.
- Background recording.
- Guaranteed insertion into secure text fields, password fields, or apps that reject custom keyboard behavior.

## Architecture

Create a native iOS project later with these targets:

- `LocalFlowiOS`: SwiftUI host app for recording, editing, settings, history, and onboarding.
- `LocalFlowKeyboard`: custom keyboard extension for insertion help and handoff.
- `LocalFlowIntents`: App Intents for Shortcuts actions.
- `LocalFlowCore`: shared Swift package for language definitions, provider status, dictation sessions, output behavior, history models, and persistence.

The Windows app remains Electron. Shared behavior should be documented and tested conceptually, not forced through shared runtime code.

## Data Flow

1. User opens the iPhone app or a Shortcut.
2. App checks microphone and speech recognition permission.
3. User records speech.
4. Apple Speech returns recognized text and available language metadata.
5. The app applies output behavior:
   - Auto: preserve the recognized language and only apply deterministic cleanup.
   - Original: preserve recognized text with minimal cleanup.
   - Specific language: use a configured capable provider; if unavailable, show a clear error and keep the raw transcript.
6. User edits the result.
7. App saves local history.
8. User copies, shares, or returns to a keyboard-assisted insertion flow.

## Language Behavior

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

Required behavior:

- Auto output never silently rewrites everything into English.
- If the user speaks Chinese and output is Auto, the result remains Chinese.
- If the user speaks English and output is Auto, the result remains English.
- If specific output language is selected but no capable provider exists, the app keeps the raw transcript and explains that translation requires a provider.

## UI Direction

The iPhone home screen should be a usable recorder, not a settings page.

Primary surface:

- Large hold/tap record control.
- Current mode label: System Apple Speech, Local WhisperKit, or Cloud provider.
- Recognition language and output language controls.
- Editable result area.
- Copy and share actions.
- Recent history list.

Settings:

- Language settings.
- History retention.
- Keyboard setup.
- Shortcuts setup.
- Provider status.
- Future offline model management.

Keyboard extension:

- Shows a compact Local Flow key.
- Provides a clear handoff action to open quick dictation in the host app.
- Can insert latest available result through `UITextDocumentProxy` where iOS allows it.
- Explains unsupported fields without implying the app is broken.

## Persistence

Use local-only storage for the MVP:

- App group container for settings shared by host app, keyboard extension, and intents.
- Local history database or structured file store.
- User-controlled history clear action.

Do not add account sync in the iPhone MVP.

## Error Handling

Required recoverable errors:

- Microphone permission denied: show a direct path to Settings.
- Speech recognition permission denied: show a direct path to Settings.
- Speech recognition unavailable: keep recording controls disabled and explain the current provider is unavailable.
- No speech detected: keep the audio session result empty and allow retry.
- Output translation unavailable: keep the raw transcript and ask the user to configure a capable provider.
- Keyboard insertion unsupported: copy to clipboard and explain that the current field or app does not allow insertion.
- User leaves during recording: stop recording safely and keep any partial transcript if the provider returned one.

## Testing Plan

Unit tests:

- Language option mapping.
- Output Auto preserves source language.
- Specific output language requires a capable provider.
- History save, load, delete, and clear.
- Provider status labels for system, local, and cloud modes.

UI tests:

- First-run permission screen.
- Denied permission recovery.
- Record button disabled state when Apple Speech is unavailable.
- Edit latest result and copy.
- History item reopen.

Manual device tests:

- Fresh install on iPhone.
- Denied microphone permission recovery.
- Denied speech recognition permission recovery.
- Short Chinese dictation with output Auto.
- Short English dictation with output Auto.
- Short Japanese or Korean dictation with output Auto.
- Specific output language selected without provider.
- Shortcut quick dictation path.
- Keyboard extension handoff and latest-result insertion in a normal text field.
- Unsupported secure field behavior.

## Milestones

### Milestone 1: iPhone App Shell

- Create SwiftUI host app.
- Add language settings UI.
- Add provider status model.
- Add local history model.
- Add clipboard/share result actions.

### Milestone 2: Apple Speech Dictation

- Add microphone and speech recognition permission flow.
- Record and transcribe through Apple Speech.
- Apply Auto output behavior.
- Save editable result to history.

### Milestone 3: Shortcuts

- Add quick dictation Shortcut or app intent.
- Support quick copy-to-clipboard flow.
- Validate permission recovery through Shortcut entry.

### Milestone 4: Keyboard Extension

- Add keyboard extension target.
- Add setup guidance in host app.
- Add handoff action to host app quick dictation.
- Insert latest result where `UITextDocumentProxy` allows it.

### Milestone 5: WhisperKit Spike

- Add separate prototype branch or target flag for WhisperKit.
- Validate model download size and startup time.
- Validate multilingual accuracy and thermal behavior.
- Decide whether WhisperKit becomes a user-facing offline mode.

## Acceptance Criteria

- A user can dictate on iPhone without an OpenAI key.
- A user can complete the core loop without installing a local model.
- Auto output preserves the spoken language.
- The app never silently falls back to English.
- The result is editable before copy or insertion.
- The UI clearly labels Apple Speech as system processing.
- Translation into a selected target language is blocked with a clear explanation when no capable provider is configured.
- Keyboard limitations are explained as iOS limitations, not generic failures.
- All history is local-only by default.

## Implementation Preconditions

Actual iOS implementation requires macOS and Xcode. This Windows workspace can prepare specs, plans, shared behavior definitions, provider contracts, test cases, and documentation, but it cannot compile or run an iPhone app locally without an Apple development environment.
