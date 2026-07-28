import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateCleanInstallEvidence,
  validateEvidenceMatchesRelease
} from "./clean-install-evidence-core.mjs";
import { validateIsolatedInstallEvidence } from "./isolated-install-evidence-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function combineValidations(...validations) {
  const errors = validations.flatMap((validation) => validation.errors || []);
  return {
    ok: errors.length === 0,
    errors
  };
}

function buildReleaseRequirements(pkg, currentRelease) {
  const outputDir = pkg.build?.directories?.output || "dist";
  const productName = pkg.build?.productName || "Local Flow";
  const installerName = `${productName} Setup ${pkg.version}.exe`;
  const appExeName = `${productName}.exe`;

  return [
    { path: `${outputDir}/${installerName}`, minBytes: 1024 * 1024, area: "windows-installer" },
    { path: `${outputDir}/win-unpacked/${appExeName}`, minBytes: 1024 * 1024, area: "windows-unpacked-app" },
    { path: "assets/local-flow-icon.ico", minBytes: 1024, area: "windows-branding" },
    {
      path: "docs/superpowers/specs/2026-07-27-windows-ui-v4-startup-reliability-design.md",
      minBytes: 4096,
      area: "windows-v4-design-spec",
      contentIncludes: ["Local Flow Windows UI V4", "local-flow-windows-ui-v4-fusion.png"]
    },
    {
      path: "docs/design/local-flow-windows-ui-v4-fusion.png",
      minBytes: 100_000,
      area: "windows-v4-approved-reference"
    },
    { path: "ios/LocalFlowiOS/README.md", minBytes: 1024, area: "iphone-source-handoff" },
    {
      path: "ios/LocalFlowiOS/project.yml",
      minBytes: 1024,
      area: "iphone-source-handoff",
      contentIncludes: ["LocalFlowiOS", "LocalFlowKeyboard", "LocalFlowCore"]
    },
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
    {
      path: "docs/release/iphone-device-trial-checklist.md",
      minBytes: 1024,
      area: "iphone-device-trial",
      contentIncludes: [
        "Signing & Capabilities",
        "group.com.localflow.dictation",
        "NSMicrophoneUsageDescription",
        "NSSpeechRecognitionUsageDescription",
        "Settings > General > Keyboard > Keyboards"
      ]
    },
    {
      path: "docs/release/product-trial-guide.md",
      minBytes: 1024,
      area: "trial-guide",
      contentIncludes: [
        "桌面快捷方式",
        "开始菜单",
        "自动（同语音）",
        "不影响本地 Whisper",
        "卸载",
        "已安装的应用",
        "Uninstall Local Flow.exe",
        "当前安装状态的兜底路径"
      ]
    },
    {
      path: "docs/release/evidence/windows-clean-install-v4.json",
      minBytes: 1024,
      area: "windows-clean-install-evidence",
      jsonValidator: (manifest) =>
        combineValidations(
          validateCleanInstallEvidence(manifest),
          validateEvidenceMatchesRelease(manifest, currentRelease)
        )
    },
    {
      path: "docs/release/evidence/windows-isolated-install-v4.json",
      minBytes: 1024,
      area: "windows-isolated-install-evidence",
      jsonValidator: (manifest) =>
        combineValidations(
          validateIsolatedInstallEvidence(manifest),
          validateEvidenceMatchesRelease(manifest, currentRelease)
        )
    }
  ];
}

const manualValidationRequired = [
  {
    area: "windows-live-multilingual-speech",
    reason: "A person must record Chinese, English, Japanese, and one additional language in the installed app.",
    command: "Manual installed-app trial"
  },
  {
    area: "windows-explicit-target-language-conversion",
    reason: "A person must select an explicit target language and confirm the converted result.",
    command: "Manual installed-app trial"
  },
  {
    area: "windows-microphone-to-notepad",
    reason: "OS microphone permission, live speech, Whisper transcription, and real Notepad insertion require a person.",
    command: "Manual installed-app trial"
  },
  {
    area: "windows-escape-cancel-no-history",
    reason: "A person must cancel audible input with Escape and confirm that no history row is added.",
    command: "Manual installed-app trial"
  },
  {
    area: "windows-tray-balloon",
    reason: "The one-time Windows tray balloon requires visual confirmation in a real desktop session.",
    command: "Manual installed-app trial"
  },
  {
    area: "iphone-xcode-device-build",
    reason: "This Windows workstation cannot run Xcode, sign the iPhone app, or verify the keyboard extension on a device.",
    command: "xcodebuild -scheme LocalFlowiOS -destination 'platform=iOS Simulator,name=iPhone 16' build"
  }
];

function toFsPath(relativePath) {
  return path.join(projectRoot, ...relativePath.split("/"));
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function releaseArtifact(relativePath) {
  const fullPath = toFsPath(relativePath);
  const fileStat = await stat(fullPath);
  return {
    status: "observed",
    path: relativePath,
    bytes: fileStat.size,
    sha256: await sha256File(fullPath)
  };
}

async function currentReleaseSnapshot(pkg) {
  const outputDir = pkg.build?.directories?.output || "dist";
  const productName = pkg.build?.productName || "Local Flow";
  return {
    version: pkg.version,
    artifacts: {
      installer: await releaseArtifact(
        `${outputDir}/${productName} Setup ${pkg.version}.exe`
      ),
      blockmap: await releaseArtifact(
        `${outputDir}/${productName} Setup ${pkg.version}.exe.blockmap`
      ),
      unpackedExecutable: await releaseArtifact(
        `${outputDir}/win-unpacked/${productName}.exe`
      )
    }
  };
}

async function fileCheck(requirement) {
  const fullPath = toFsPath(requirement.path);
  try {
    await access(fullPath);
    const fileStat = await stat(fullPath);
    let missingContent = [];
    let validationErrors = [];
    if (requirement.contentIncludes?.length) {
      const source = await readFile(fullPath, "utf8");
      missingContent = requirement.contentIncludes.filter((expectedText) => !source.includes(expectedText));
    }
    if (requirement.jsonValidator) {
      const source = await readFile(fullPath, "utf8");
      const validation = requirement.jsonValidator(JSON.parse(source));
      validationErrors = validation.errors;
    }
    return {
      ok:
        fileStat.size >= requirement.minBytes &&
        missingContent.length === 0 &&
        validationErrors.length === 0,
      area: requirement.area,
      path: requirement.path,
      bytes: fileStat.size,
      minBytes: requirement.minBytes,
      ...(missingContent.length ? { missingContent } : {}),
      ...(validationErrors.length ? { validationErrors } : {})
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
  const currentRelease = await currentReleaseSnapshot(pkg);
  const requiredFiles = buildReleaseRequirements(pkg, currentRelease);
  const checks = [];
  for (const requirement of requiredFiles) {
    checks.push(await fileCheck(requirement));
  }

  const ok = checks.every((check) => check.ok);
  print({
    ok,
    automatedArtifactReadiness: ok,
    readinessScope: "automated-artifacts-only",
    productName: pkg.build?.productName || pkg.name,
    version: pkg.version,
    checks,
    manualValidationRequired
  });
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  print({
    ok: false,
    automatedArtifactReadiness: false,
    readinessScope: "automated-artifacts-only",
    message: error.message,
    manualValidationRequired
  });
  process.exitCode = 1;
}
