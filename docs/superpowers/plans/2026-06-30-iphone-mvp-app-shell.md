# iPhone MVP App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first native iPhone source slice for Local Flow: Apple Speech-first dictation, Auto same-language output rules, local history models, keyboard handoff, and Shortcuts intent scaffolding.

**Architecture:** This Windows repository cannot compile iOS, so the first deliverable is an auditable Swift source tree plus Node-based structural tests. `LocalFlowCore` owns language/output/history behavior, the SwiftUI app owns Apple Speech recording and editing, the keyboard extension only inserts the latest result or opens the host app, and App Intents expose quick dictation entry points.

**Tech Stack:** Swift 5.9+, SwiftUI, Speech, AVFoundation, UIKit keyboard extension, AppIntents, Swift Package Manager for shared core, Node test runner for repository-level validation on Windows.

---

## File Structure

- Create: `ios/LocalFlowiOS/README.md`
  - Explains the iPhone MVP, Windows limitations, and Xcode integration steps.
- Create: `ios/LocalFlowiOS/LocalFlowCore/Package.swift`
  - Swift Package manifest for shared iOS core.
- Create: `ios/LocalFlowiOS/LocalFlowCore/Sources/LocalFlowCore/LocalFlowLanguage.swift`
  - Language definitions and supported interface/recognition/output language lists.
- Create: `ios/LocalFlowiOS/LocalFlowCore/Sources/LocalFlowCore/DictationModels.swift`
  - Provider, settings, dictation result, and history item models.
- Create: `ios/LocalFlowiOS/LocalFlowCore/Sources/LocalFlowCore/OutputBehavior.swift`
  - Deterministic cleanup and output-language behavior. Auto preserves source language.
- Create: `ios/LocalFlowiOS/LocalFlowCore/Tests/LocalFlowCoreTests/OutputBehaviorTests.swift`
  - Swift tests for Auto and selected target-language behavior.
- Create: `ios/LocalFlowiOS/App/LocalFlowiOSApp.swift`
  - SwiftUI app entry.
- Create: `ios/LocalFlowiOS/App/ContentView.swift`
  - Primary iPhone recorder surface.
- Create: `ios/LocalFlowiOS/App/SpeechDictationViewModel.swift`
  - Apple Speech permission, AVAudioSession setup, deep-link handoff, and recording orchestration.
- Create: `ios/LocalFlowiOS/App/Info.plist`
  - Host app microphone permission, speech permission, and `localflow` URL scheme declarations.
- Create: `ios/LocalFlowiOS/App/LocalFlowiOS.entitlements`
  - Host app App Group entitlement for sharing latest dictation with extensions.
- Create: `ios/LocalFlowiOS/Keyboard/KeyboardViewController.swift`
  - Minimal keyboard extension source for latest-result insertion and app handoff.
- Create: `ios/LocalFlowiOS/Keyboard/Info.plist`
  - Keyboard extension declaration with open access for App Group handoff.
- Create: `ios/LocalFlowiOS/Keyboard/LocalFlowKeyboard.entitlements`
  - Keyboard App Group entitlement for reading latest dictation.
- Create: `ios/LocalFlowiOS/Intents/DictateToClipboardIntent.swift`
  - App Intent scaffold for quick dictation to clipboard.
- Create: `tests/iphone-mvp-scaffold.test.js`
  - Windows-runnable repository tests for iPhone architecture and product constraints.

## Task 1: iPhone Scaffold Contract Tests

**Files:**
- Create: `tests/iphone-mvp-scaffold.test.js`

- [ ] **Step 1: Add failing repository tests**

Add tests that assert required iPhone files exist, the app uses Apple Speech, Auto output is not translation-first, OpenAI is not required, and the keyboard extension is insertion/handoff only:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const iosRoot = path.join(root, "ios", "LocalFlowiOS");

function iosPath(...parts) {
  return path.join(iosRoot, ...parts);
}

async function readIosFile(...parts) {
  return readFile(iosPath(...parts), "utf8");
}

test("iPhone MVP source tree includes app core keyboard and intent slices", () => {
  for (const file of [
    "README.md",
    "LocalFlowCore/Package.swift",
    "LocalFlowCore/Sources/LocalFlowCore/LocalFlowLanguage.swift",
    "LocalFlowCore/Sources/LocalFlowCore/DictationModels.swift",
    "LocalFlowCore/Sources/LocalFlowCore/OutputBehavior.swift",
    "LocalFlowCore/Tests/LocalFlowCoreTests/OutputBehaviorTests.swift",
    "App/LocalFlowiOSApp.swift",
    "App/ContentView.swift",
    "App/SpeechDictationViewModel.swift",
    "Keyboard/KeyboardViewController.swift",
    "Intents/DictateToClipboardIntent.swift"
  ]) {
    assert.equal(existsSync(iosPath(file)), true, `${file} should exist`);
  }
});

test("iPhone app is Apple Speech first and does not require OpenAI", async () => {
  const viewModel = await readIosFile("App", "SpeechDictationViewModel.swift");
  const readme = await readIosFile("README.md");
  const allIosText = await Promise.all([
    readIosFile("README.md"),
    readIosFile("App", "SpeechDictationViewModel.swift"),
    readIosFile("LocalFlowCore", "Sources", "LocalFlowCore", "DictationModels.swift")
  ]);

  assert.match(viewModel, /import Speech/);
  assert.match(viewModel, /import AVFoundation/);
  assert.match(viewModel, /setCategory\(\.record/);
  assert.match(viewModel, /setActive\(true/);
  assert.match(viewModel, /SFSpeechRecognizer/);
  assert.match(readme, /Apple Speech/);
  assert.doesNotMatch(allIosText.join("\n"), /OPENAI_API_KEY|sk-proj|api\.openai\.com/i);
});

test("iPhone language model includes required interface and output languages", async () => {
  const source = await readIosFile("LocalFlowCore", "Sources", "LocalFlowCore", "LocalFlowLanguage.swift");

  for (const language of ["english", "simplifiedChinese", "japanese", "korean", "traditionalChinese", "french", "russian", "spanish"]) {
    assert.match(source, new RegExp(`case ${language}\\b`));
  }
  assert.match(source, /static let supportedInterfaceLanguages/);
  assert.match(source, /static let supportedOutputLanguages/);
  assert.match(source, /case auto/);
  assert.match(source, /case original/);
});

test("iPhone Auto output preserves source language and target output requires provider", async () => {
  const behavior = await readIosFile("LocalFlowCore", "Sources", "LocalFlowCore", "OutputBehavior.swift");
  const tests = await readIosFile("LocalFlowCore", "Tests", "LocalFlowCoreTests", "OutputBehaviorTests.swift");

  assert.match(behavior, /case \.auto:/);
  assert.match(behavior, /return \.success\(cleaned\)/);
  assert.match(behavior, /Translation requires a configured provider/);
  assert.match(tests, /testAutoOutputKeepsChineseTranscript/);
  assert.match(tests, /testSelectedTargetLanguageRequiresProvider/);
});

test("iPhone keyboard extension inserts latest text or opens host app handoff", async () => {
  const keyboard = await readIosFile("Keyboard", "KeyboardViewController.swift");

  assert.match(keyboard, /UITextDocumentProxy/);
  assert.match(keyboard, /insertText/);
  assert.match(keyboard, /localflow:\/\/quick-dictation/);
  assert.doesNotMatch(keyboard, /UIPasteboard\.general\.string/);
  assert.doesNotMatch(keyboard, /AVAudioRecorder|SFSpeechRecognizer/);
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm.cmd test -- tests/iphone-mvp-scaffold.test.js
```

Expected before implementation: failures because the iPhone files are missing.

## Task 2: Shared iPhone Core

**Files:**
- Create: `ios/LocalFlowiOS/LocalFlowCore/Package.swift`
- Create: `ios/LocalFlowiOS/LocalFlowCore/Sources/LocalFlowCore/LocalFlowLanguage.swift`
- Create: `ios/LocalFlowiOS/LocalFlowCore/Sources/LocalFlowCore/DictationModels.swift`
- Create: `ios/LocalFlowiOS/LocalFlowCore/Sources/LocalFlowCore/OutputBehavior.swift`
- Create: `ios/LocalFlowiOS/LocalFlowCore/Tests/LocalFlowCoreTests/OutputBehaviorTests.swift`

- [ ] **Step 1: Implement core package**

Create a Swift package named `LocalFlowCore` with language definitions, dictation settings, result models, and output processing:

```swift
public enum OutputSelection: String, CaseIterable, Codable, Sendable {
    case auto
    case original
    case english
    case simplifiedChinese
    case japanese
    case korean
    case traditionalChinese
    case french
    case russian
    case spanish
}

public enum OutputProcessingResult: Equatable, Sendable {
    case success(String)
    case requiresProvider(rawTranscript: String, message: String)
}

public func processOutput(transcript: String, outputSelection: OutputSelection) -> OutputProcessingResult {
    let cleaned = cleanupTranscript(transcript)
    switch outputSelection {
    case .auto, .original:
        return .success(cleaned)
    default:
        return .requiresProvider(rawTranscript: cleaned, message: "Translation requires a configured provider.")
    }
}
```

- [ ] **Step 2: Add Swift unit tests**

Add Swift tests proving Chinese Auto output remains Chinese and target output fails recoverably without a provider:

```swift
func testAutoOutputKeepsChineseTranscript() {
    let result = processOutput(transcript: "你好，今天帮我写一封邮件。", outputSelection: .auto)
    XCTAssertEqual(result, .success("你好，今天帮我写一封邮件。"))
}

func testSelectedTargetLanguageRequiresProvider() {
    let result = processOutput(transcript: "hello world", outputSelection: .simplifiedChinese)
    XCTAssertEqual(result, .requiresProvider(rawTranscript: "hello world", message: "Translation requires a configured provider."))
}
```

## Task 3: SwiftUI Host App Source

**Files:**
- Create: `ios/LocalFlowiOS/App/LocalFlowiOSApp.swift`
- Create: `ios/LocalFlowiOS/App/ContentView.swift`
- Create: `ios/LocalFlowiOS/App/SpeechDictationViewModel.swift`

- [ ] **Step 1: Implement Apple Speech view model**

Create an `ObservableObject` that requests microphone and speech permissions, configures `AVAudioSession` with `.record` and `.measurement` before starting `AVAudioEngine`, uses `SFSpeechRecognizer`, captures audio with `AVAudioEngine`, stores editable output text through `processOutput`, and saves the latest result into the app group for the keyboard extension.

- [ ] **Step 2: Implement product-first recorder UI**

Create a SwiftUI home screen with provider label, recognition/output pickers, large record button, editable result editor, copy/share actions, and clear permission status text.

## Task 4: Keyboard And Shortcut Scaffolds

**Files:**
- Create: `ios/LocalFlowiOS/Keyboard/KeyboardViewController.swift`
- Create: `ios/LocalFlowiOS/Intents/DictateToClipboardIntent.swift`

- [ ] **Step 1: Add keyboard extension source**

The keyboard must not record audio. It reads the latest shared app-group result, inserts it through `UITextDocumentProxy`, and opens `localflow://quick-dictation` for app handoff. It must not fallback to the system clipboard or insert explanatory placeholder text into the user's current field.

- [ ] **Step 2: Add App Intent source**

Create a `DictateToClipboardIntent` scaffold that opens quick dictation and documents the clipboard flow.

## Task 5: Documentation And Verification

**Files:**
- Create: `ios/LocalFlowiOS/README.md`
- Modify only if tests reveal gaps.

- [ ] **Step 1: Document Xcode integration**

Document that this Windows repo prepares source code only, and that actual iPhone compile/run requires macOS and Xcode. Include target mapping for host app, keyboard extension, intents, app group, URL scheme, and required permissions.

- [ ] **Step 2: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/iphone-mvp-scaffold.test.js
```

Expected: iPhone scaffold tests pass.

- [ ] **Step 3: Run full tests**

Run:

```powershell
npm.cmd test
```

Expected: all repository tests pass.

- [ ] **Step 4: Commit**

```powershell
git add ios tests/iphone-mvp-scaffold.test.js docs/superpowers/plans/2026-06-30-iphone-mvp-app-shell.md
git commit -m "feat: add iphone mvp source scaffold"
```

## Self-Review

Spec coverage:

- Apple Speech-first iPhone route: Tasks 2 and 3.
- No OpenAI key requirement: Task 1 test and README.
- Auto output preserves spoken language: Task 2 tests.
- Target output requires capable provider: Task 2 tests.
- Native SwiftUI app source: Task 3.
- Keyboard extension handoff/insertion: Task 4.
- Shortcut/App Intent path: Task 4.
- Windows limitation documented: Task 5.

Placeholder scan:

- The plan does not defer implementation with `TBD` or unnamed files.
- The only excluded item is real iPhone compilation, explicitly blocked by the Windows environment.

Type consistency:

- `OutputSelection`, `OutputProcessingResult`, `DictationSettings`, and `DictationHistoryItem` are the shared core names used across app, keyboard, intent, and tests.
