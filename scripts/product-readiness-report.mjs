import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function buildReleaseRequirements(pkg) {
  const outputDir = pkg.build?.directories?.output || "dist";
  const productName = pkg.build?.productName || "Local Flow";
  const installerName = `${productName} Setup ${pkg.version}.exe`;
  const appExeName = `${productName}.exe`;

  return [
    { path: `${outputDir}/${installerName}`, minBytes: 1024 * 1024, area: "windows-installer" },
    { path: `${outputDir}/win-unpacked/${appExeName}`, minBytes: 1024 * 1024, area: "windows-unpacked-app" },
    { path: "assets/local-flow-icon.ico", minBytes: 1024, area: "windows-branding" },
    { path: "ios/LocalFlowiOS/README.md", minBytes: 1024, area: "iphone-source-handoff" },
    { path: "ios/LocalFlowiOS/LocalFlowCore/Package.swift", minBytes: 256, area: "iphone-source-handoff" },
    {
      path: "ios/LocalFlowiOS/LocalFlowCore/Sources/LocalFlowCore/LocalFlowLanguage.swift",
      minBytes: 1024,
      area: "iphone-source-handoff"
    },
    {
      path: "ios/LocalFlowiOS/LocalFlowCore/Sources/LocalFlowCore/DictationModels.swift",
      minBytes: 512,
      area: "iphone-source-handoff"
    },
    {
      path: "ios/LocalFlowiOS/LocalFlowCore/Sources/LocalFlowCore/OutputBehavior.swift",
      minBytes: 512,
      area: "iphone-source-handoff"
    },
    {
      path: "ios/LocalFlowiOS/LocalFlowCore/Tests/LocalFlowCoreTests/OutputBehaviorTests.swift",
      minBytes: 512,
      area: "iphone-source-handoff"
    },
    {
      path: "ios/LocalFlowiOS/App/Info.plist",
      minBytes: 128,
      area: "iphone-app-handoff",
      contentIncludes: ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription", "localflow"]
    },
    {
      path: "ios/LocalFlowiOS/App/LocalFlowiOS.entitlements",
      minBytes: 64,
      area: "iphone-app-handoff",
      contentIncludes: ["group.com.localflow.dictation"]
    },
    {
      path: "ios/LocalFlowiOS/App/LocalFlowiOSApp.swift",
      minBytes: 256,
      area: "iphone-app-handoff",
      contentIncludes: ["LocalFlowiOSApp", "handleOpenURL"]
    },
    { path: "ios/LocalFlowiOS/App/ContentView.swift", minBytes: 1024, area: "iphone-app-handoff" },
    {
      path: "ios/LocalFlowiOS/App/SpeechDictationViewModel.swift",
      minBytes: 1024,
      area: "iphone-app-handoff",
      contentIncludes: ["SFSpeechRecognizer", "AVAudioSession", "group.com.localflow.dictation"]
    },
    {
      path: "ios/LocalFlowiOS/Keyboard/Info.plist",
      minBytes: 128,
      area: "iphone-keyboard-handoff",
      contentIncludes: ["com.apple.keyboard-service", "RequestsOpenAccess"]
    },
    {
      path: "ios/LocalFlowiOS/Keyboard/LocalFlowKeyboard.entitlements",
      minBytes: 64,
      area: "iphone-keyboard-handoff",
      contentIncludes: ["group.com.localflow.dictation"]
    },
    {
      path: "ios/LocalFlowiOS/Keyboard/KeyboardViewController.swift",
      minBytes: 1024,
      area: "iphone-keyboard-handoff",
      contentIncludes: ["UITextDocumentProxy", "insertText", "localflow://quick-dictation"]
    },
    {
      path: "ios/LocalFlowiOS/Intents/DictateToClipboardIntent.swift",
      minBytes: 512,
      area: "iphone-intent-handoff"
    },
    { path: "docs/release/product-trial-guide.md", minBytes: 1024, area: "trial-guide" }
  ];
}

const manualValidationRequired = [
  {
    area: "iphone-native-build",
    reason: "This Windows workstation cannot run Xcode or the iOS Simulator.",
    command: "xcodebuild -scheme LocalFlowiOS -destination 'platform=iOS Simulator,name=iPhone 16' build"
  },
  {
    area: "microphone-runtime-permission",
    reason: "Windows and iOS permission prompts are OS-managed and must be accepted in the real app session.",
    command: "npm.cmd run check:microphone"
  }
];

function toFsPath(relativePath) {
  return path.join(projectRoot, ...relativePath.split("/"));
}

async function fileCheck(requirement) {
  const fullPath = toFsPath(requirement.path);
  try {
    await access(fullPath);
    const fileStat = await stat(fullPath);
    let missingContent = [];
    if (requirement.contentIncludes?.length) {
      const source = await readFile(fullPath, "utf8");
      missingContent = requirement.contentIncludes.filter((expectedText) => !source.includes(expectedText));
    }
    return {
      ok: fileStat.size >= requirement.minBytes && missingContent.length === 0,
      area: requirement.area,
      path: requirement.path,
      bytes: fileStat.size,
      minBytes: requirement.minBytes,
      ...(missingContent.length ? { missingContent } : {})
    };
  } catch (error) {
    return {
      ok: false,
      area: requirement.area,
      path: requirement.path,
      minBytes: requirement.minBytes,
      message: error.message
    };
  }
}

function print(payload) {
  const stream = payload.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
}

try {
  const pkg = JSON.parse(await readFile(toFsPath("package.json"), "utf8"));
  const requiredFiles = buildReleaseRequirements(pkg);
  const checks = [];
  for (const requirement of requiredFiles) {
    checks.push(await fileCheck(requirement));
  }

  const ok = checks.every((check) => check.ok);
  print({
    ok,
    productName: pkg.build?.productName || pkg.name,
    version: pkg.version,
    checks,
    manualValidationRequired
  });
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  print({
    ok: false,
    message: error.message,
    manualValidationRequired
  });
  process.exitCode = 1;
}
