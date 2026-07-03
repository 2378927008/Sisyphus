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

This Windows workspace cannot compile or run an iPhone app locally. The iPhone handoff includes an XcodeGen project spec so a Mac can generate the Xcode project from the checked-in source layout instead of recreating targets by hand.

On macOS:

```bash
brew install xcodegen
xcodegen generate --spec ios/LocalFlowiOS/project.yml
open ios/LocalFlowiOS/LocalFlowiOS.xcodeproj
```

The generated project contains:

1. A host app target named `LocalFlowiOS`.
2. A keyboard extension target named `LocalFlowKeyboard`.
3. A local Swift Package dependency on `LocalFlowCore`.
4. Host app sources from `App` and `Intents`.
5. Keyboard extension sources from `Keyboard`.
6. Host app `Info.plist` and entitlements from `App`.
7. Keyboard extension `Info.plist` and entitlements from `Keyboard`.

After opening the project, configure signing in Xcode for the host app and keyboard extension. Confirm the App Group `group.com.localflow.dictation` is available to both targets, the URL scheme `localflow` is present, the host app includes `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`, and the keyboard extension keeps `RequestsOpenAccess` enabled because the MVP reads the shared App Group result.

After signing is configured, a command-line smoke build should look like:

```bash
xcodebuild -scheme LocalFlowiOS -destination 'platform=iOS Simulator,name=iPhone 16' build
```

## Device Trial Checklist

Use `docs/release/iphone-device-trial-checklist.md` before handing the app to a tester. It covers Signing & Capabilities, the `group.com.localflow.dictation` App Group, microphone and speech recognition prompts, and the Local Flow Keyboard setup path.

For the keyboard extension, install and run the host app once, then open `Settings > General > Keyboard > Keyboards`, add `Local Flow Keyboard`, and enable `Allow Full Access`.

## Cloud macOS Validation

For a Windows-only development machine, GitHub Actions provides the first cloud macOS validation gate in `.github/workflows/iphone-smoke.yml`.

The workflow runs on `macos-latest`, installs XcodeGen, generates the Xcode project from `ios/LocalFlowiOS/project.yml`, executes `swift test` inside `ios/LocalFlowiOS/LocalFlowCore`, and runs `node --test tests/iphone-mvp-scaffold.test.js` from the repository root. This catches Swift package and iPhone handoff regressions before a local Mac is available.

This smoke workflow does not sign the app, does not upload to TestFlight, and does not require an Apple Developer account. Final host-app build, signing, keyboard extension validation, and device testing still require macOS with Xcode.

## Product Rules

- Auto output preserves the recognized language.
- Recognition Auto uses the iOS preferred speech language while the provider is Apple Speech.
- Specific target-language output keeps the raw transcript and explains that translation requires a provider.
- The keyboard extension does not record audio. iOS keyboard extensions are not the recorder surface.
- History is local-only by default.
- Processing mode must be visible to the user as System Apple Speech.
