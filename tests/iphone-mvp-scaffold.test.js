import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    "App/Info.plist",
    "App/LocalFlowiOS.entitlements",
    "App/LocalFlowiOSApp.swift",
    "App/ContentView.swift",
    "App/SpeechDictationViewModel.swift",
    "Keyboard/Info.plist",
    "Keyboard/LocalFlowKeyboard.entitlements",
    "Keyboard/KeyboardViewController.swift",
    "Intents/DictateToClipboardIntent.swift"
  ]) {
    assert.equal(existsSync(iosPath(file)), true, `${file} should exist`);
  }
});

test("iPhone app is Apple Speech first and does not require OpenAI", async () => {
  const app = await readIosFile("App", "LocalFlowiOSApp.swift");
  const viewModel = await readIosFile("App", "SpeechDictationViewModel.swift");
  const readme = await readIosFile("README.md");
  const allIosText = await Promise.all([
    readIosFile("README.md"),
    readIosFile("App", "SpeechDictationViewModel.swift"),
    readIosFile("LocalFlowCore", "Sources", "LocalFlowCore", "DictationModels.swift")
  ]);

  assert.match(viewModel, /import Speech/);
  assert.match(viewModel, /import AVFoundation/);
  assert.match(viewModel, /import Combine/);
  assert.match(viewModel, /SFSpeechRecognizer/);
  assert.match(viewModel, /Locale\.current/);
  assert.match(viewModel, /Locale\.preferredLanguages/);
  assert.doesNotMatch(viewModel, /SFSpeechRecognizer\(\)/);
  assert.match(viewModel, /setCategory\(\.record/);
  assert.match(viewModel, /setActive\(true/);
  assert.match(viewModel, /setActive\(false/);
  assert.match(app, /onOpenURL/);
  assert.match(app, /handleOpenURL/);
  assert.match(viewModel, /localflow/);
  assert.match(viewModel, /quick-dictation/);
  assert.match(readme, /Apple Speech/);
  assert.match(readme, /iOS preferred speech language/);
  assert.doesNotMatch(allIosText.join("\n"), /OPENAI_API_KEY|sk-proj|api\.openai\.com/i);
});

test("iPhone language model includes required interface and output languages", async () => {
  const source = await readIosFile("LocalFlowCore", "Sources", "LocalFlowCore", "LocalFlowLanguage.swift");

  for (const language of [
    "english",
    "simplifiedChinese",
    "japanese",
    "korean",
    "traditionalChinese",
    "french",
    "russian",
    "spanish"
  ]) {
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
  const viewModel = await readIosFile("App", "SpeechDictationViewModel.swift");

  assert.match(keyboard, /UITextDocumentProxy/);
  assert.match(keyboard, /insertText/);
  assert.match(keyboard, /localflow:\/\/quick-dictation/);
  assert.match(keyboard, /group\.com\.localflow\.dictation/);
  assert.match(keyboard, /latestResultText/);
  assert.match(viewModel, /group\.com\.localflow\.dictation/);
  assert.match(viewModel, /latestResultText/);
  assert.doesNotMatch(keyboard, /UIPasteboard\.general\.string/);
  assert.doesNotMatch(keyboard, /insertText\("Open Local Flow to dictate\."\)/);
  assert.doesNotMatch(keyboard, /AVAudioRecorder|SFSpeechRecognizer/);
});

test("iPhone Xcode handoff files declare permissions URL scheme app group and keyboard extension", async () => {
  const appInfo = await readIosFile("App", "Info.plist");
  const keyboardInfo = await readIosFile("Keyboard", "Info.plist");
  const appEntitlements = await readIosFile("App", "LocalFlowiOS.entitlements");
  const keyboardEntitlements = await readIosFile("Keyboard", "LocalFlowKeyboard.entitlements");
  const readme = await readIosFile("README.md");

  assert.match(appInfo, /NSMicrophoneUsageDescription/);
  assert.match(appInfo, /NSSpeechRecognitionUsageDescription/);
  assert.match(appInfo, /CFBundleURLSchemes/);
  assert.match(appInfo, /localflow/);
  assert.match(appEntitlements, /com\.apple\.security\.application-groups/);
  assert.match(appEntitlements, /group\.com\.localflow\.dictation/);

  assert.match(keyboardInfo, /NSExtensionPointIdentifier/);
  assert.match(keyboardInfo, /com\.apple\.keyboard-service/);
  assert.match(keyboardInfo, /RequestsOpenAccess/);
  assert.match(keyboardEntitlements, /com\.apple\.security\.application-groups/);
  assert.match(keyboardEntitlements, /group\.com\.localflow\.dictation/);

  assert.match(readme, /App Group/);
  assert.match(readme, /URL scheme/);
  assert.match(readme, /NSMicrophoneUsageDescription/);
  assert.match(readme, /NSSpeechRecognitionUsageDescription/);
  assert.match(readme, /RequestsOpenAccess/);
  assert.match(readme, /xcodebuild/);
});
