# Local Flow iPhone MVP

This folder contains the first native iPhone source slice for Local Flow.

The default iPhone path is Apple Speech first. It does not require an OpenAI key, does not bundle a large model in the first build, and keeps Auto output in the same language the user spoke. Translation into a selected target language is intentionally blocked until a capable provider is configured.

Apple Speech does not provide the same cross-language automatic detection contract as local Whisper. In this MVP, recognition Auto uses the iOS preferred speech language for Apple Speech. Output Auto still preserves the recognized transcript and never silently translates it into English.

## What Is Included

- `LocalFlowCore`: Swift Package with language definitions, dictation settings, output behavior, and local history models.
- `App`: SwiftUI host app source for recording, editing, copying, sharing, and reviewing history.
- `Keyboard`: custom keyboard extension source for inserting the latest result or handing off to the host app.
- `Intents`: App Intent scaffold for a future quick dictate-to-clipboard Shortcut.
- Local history is stored on-device through `LocalFlowCore` and shared with extensions through the App Group where needed.

## Xcode Integration

This Windows workspace cannot compile or run an iPhone app locally. To build on macOS:

1. Create an iOS app project named `LocalFlowiOS` in Xcode.
2. Add `LocalFlowCore` as a local Swift Package from `ios/LocalFlowiOS/LocalFlowCore`.
3. Add the files under `App` to the host app target.
4. Set the host app `Info.plist` to `App/Info.plist`.
5. Set the host app entitlements file to `App/LocalFlowiOS.entitlements`.
6. Add a custom keyboard extension target and include `Keyboard/KeyboardViewController.swift`.
7. Set the keyboard extension `Info.plist` to `Keyboard/Info.plist`.
8. Set the keyboard extension entitlements file to `Keyboard/LocalFlowKeyboard.entitlements`.
9. Add `Intents/DictateToClipboardIntent.swift` to the host app target or to a dedicated App Intents target.
10. Configure the URL scheme `localflow` if Xcode does not pick it up from `App/Info.plist`.
11. Configure the App Group `group.com.localflow.dictation` for both the host app and keyboard extension.
12. Confirm `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` are present in the built host app.
13. Confirm the keyboard extension has `RequestsOpenAccess` enabled because the MVP uses the shared App Group result.

On macOS, use Xcode's UI first for signing and entitlements. After the project is created, a command-line smoke build should look like:

```bash
xcodebuild -scheme LocalFlowiOS -destination 'platform=iOS Simulator,name=iPhone 16' build
```

## Cloud macOS Validation

For a Windows-only development machine, GitHub Actions provides the first cloud macOS validation gate in `.github/workflows/iphone-smoke.yml`.

The workflow runs on `macos-latest`, executes `swift test` inside `ios/LocalFlowiOS/LocalFlowCore`, and runs `node --test tests/iphone-mvp-scaffold.test.js` from the repository root. This catches Swift package and iPhone handoff regressions before a local Mac is available.

This smoke workflow does not sign the app, does not create an Xcode project, does not upload to TestFlight, and does not require an Apple Developer account. Final host-app build, signing, keyboard extension validation, and device testing still require macOS with Xcode.

## Product Rules

- Auto output preserves the recognized language.
- Recognition Auto uses the iOS preferred speech language while the provider is Apple Speech.
- Specific target-language output keeps the raw transcript and explains that translation requires a provider.
- The keyboard extension does not record audio. iOS keyboard extensions are not the recorder surface.
- History is local-only by default.
- Processing mode must be visible to the user as System Apple Speech.
