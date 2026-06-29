# Local Flow iPhone MVP

This folder contains the first native iPhone source slice for Local Flow.

The default iPhone path is Apple Speech first. It does not require an OpenAI key, does not bundle a large model in the first build, and keeps Auto output in the same language the user spoke. Translation into a selected target language is intentionally blocked until a capable provider is configured.

Apple Speech does not provide the same cross-language automatic detection contract as local Whisper. In this MVP, recognition Auto uses the iOS preferred speech language for Apple Speech. Output Auto still preserves the recognized transcript and never silently translates it into English.

## What Is Included

- `LocalFlowCore`: Swift Package with language definitions, dictation settings, output behavior, and local history models.
- `App`: SwiftUI host app source for recording, editing, copying, sharing, and reviewing history.
- `Keyboard`: custom keyboard extension source for inserting the latest result or handing off to the host app.
- `Intents`: App Intent scaffold for a future quick dictate-to-clipboard Shortcut.

## Xcode Integration

This Windows workspace cannot compile or run an iPhone app locally. To build on macOS:

1. Create an iOS app project named `LocalFlowiOS` in Xcode.
2. Add `LocalFlowCore` as a local Swift Package from `ios/LocalFlowiOS/LocalFlowCore`.
3. Add the files under `App` to the host app target.
4. Add a custom keyboard extension target and include `Keyboard/KeyboardViewController.swift`.
5. Add an App Intents extension or the host app intent target and include `Intents/DictateToClipboardIntent.swift`.
6. Configure the URL scheme `localflow`.
7. Configure an app group such as `group.com.localflow.dictation` for sharing the latest result between the host app and keyboard extension.
8. Add `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` to the host app `Info.plist`.

## Product Rules

- Auto output preserves the recognized language.
- Recognition Auto uses the iOS preferred speech language while the provider is Apple Speech.
- Specific target-language output keeps the raw transcript and explains that translation requires a provider.
- The keyboard extension does not record audio. iOS keyboard extensions are not the recorder surface.
- History is local-only by default.
- Processing mode must be visible to the user as System Apple Speech.
