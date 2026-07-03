# iPhone Device Trial Checklist

This checklist is for the first real-device Local Flow iPhone trial. It assumes the source lives in `ios/LocalFlowiOS` and the Xcode project is generated with XcodeGen.

## Generate The Project

```bash
brew install xcodegen
xcodegen generate --spec ios/LocalFlowiOS/project.yml
open ios/LocalFlowiOS/LocalFlowiOS.xcodeproj
```

## Signing & Capabilities

1. Select the `LocalFlowiOS` app target.
2. Set a personal or team Apple Development signing team.
3. Select the `LocalFlowKeyboard` extension target and use the same signing team.
4. Add the App Group capability to both targets.
5. Confirm the shared group is `group.com.localflow.dictation`.
6. Keep the host app bundle identifier as `com.localflow.dictation`.
7. Keep the keyboard extension bundle identifier as `com.localflow.dictation.keyboard`.

## Permission Prompts

Run the app on a physical iPhone and confirm these prompts appear on first use:

1. Microphone permission from `NSMicrophoneUsageDescription`.
2. Speech Recognition permission from `NSSpeechRecognitionUsageDescription`.
3. The app home screen should show Microphone and Speech Recognition as ready after both prompts are allowed.

If either permission is denied, use the in-app `Open iPhone Settings` action and allow the missing permission in iOS Settings.

## Keyboard Extension Setup

1. Install and run the host app once.
2. Open `Settings > General > Keyboard > Keyboards`.
3. Tap `Add New Keyboard`.
4. Select `Local Flow Keyboard`.
5. Open the `Local Flow Keyboard` entry.
6. Turn on `Allow Full Access`.

The MVP uses App Group storage for the latest dictation result, so `Allow Full Access` is required for the keyboard to read the shared result.

## Quick Dictation Flow

1. Open Local Flow.
2. Tap `Start Dictation`.
3. Speak a short phrase.
4. Tap `Stop Dictation`.
5. Confirm the editable result keeps the spoken language when output is Auto.
6. Tap `Copy` or `Share`.
7. Open another app and switch to `Local Flow Keyboard`.
8. Tap `Insert Latest` and confirm the latest result is inserted.
9. Tap `Dictate` from the keyboard and confirm it opens `localflow://quick-dictation`.

## Known iOS Boundaries

- The keyboard extension does not record audio.
- The host app records through Apple Speech first.
- Auto recognition uses the iOS preferred speech language in this MVP.
- Selected target-language output requires a capable provider; otherwise the raw transcript is preserved.
