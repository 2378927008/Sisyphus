import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPackagedAppSpawnOptions } from "../scripts/packaged-start-smoke-core.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("package exposes Windows packaging scripts and electron-builder dependency", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    pkg.scripts["check:visual"],
    "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer scripts/electron-visual-smoke.mjs"
  );
  assert.equal(pkg.scripts["package:win"], "electron-builder --win --dir");
  assert.equal(pkg.scripts["dist:win"], "node scripts/build-windows-installer.mjs");
  assert.equal(pkg.scripts["check:packaged"], "node scripts/packaged-start-smoke.mjs");
  assert.equal(pkg.scripts["check:product"], "node scripts/product-readiness-report.mjs");
  assert.ok(pkg.devDependencies["electron-builder"]);
  assert.equal(pkg.dependencies["uiohook-napi"], "^1.5.5");
});

test("packaged smoke script launches the unpacked Windows app in hidden mode", async () => {
  const smokeSource = await readFile(new URL("../scripts/packaged-start-smoke.mjs", import.meta.url), "utf8");

  assert.match(smokeSource, /dist\/win-unpacked\/Local Flow\.exe/);
  assert.match(smokeSource, /--hidden/);
  assert.match(smokeSource, /LOCAL_FLOW_PACKAGED_SMOKE_MS/);
  assert.match(smokeSource, /maxSmokeMs/);
  assert.match(smokeSource, /child\.once\("error"/);
  assert.match(smokeSource, /process\.kill|child\.kill/);
});

test("packaged app launch allows the second instance to reveal its native window", () => {
  assert.deepEqual(buildPackagedAppSpawnOptions(projectRoot), {
    cwd: projectRoot,
    stdio: "ignore",
    windowsHide: false
  });
});

test("packaged startup summary counts only the isolated top-level app and visible window", () => {
  const snippet = `
    import { summarizePackagedStartup } from "./scripts/packaged-start-smoke-core.mjs";

    const exePath = "C:\\\\Apps\\\\Local Flow.exe";
    const userDataDir = "C:\\\\Temp\\\\local-flow-smoke";
    const processes = [
      {
        ProcessId: 401,
        ExecutablePath: "C:\\\\Apps\\\\Local Flow.exe",
        CommandLine: "\\"C:\\\\Apps\\\\Local Flow.exe\\" --user-data-dir=\\"C:\\\\Temp\\\\local-flow-smoke\\" --hidden",
        MainWindowHandle: 9001,
        IsWindowVisible: true
      },
      {
        ProcessId: 402,
        ExecutablePath: "C:\\\\Apps\\\\Local Flow.exe",
        CommandLine: "\\"C:\\\\Apps\\\\Local Flow.exe\\" --type=renderer --user-data-dir=\\"C:\\\\Temp\\\\local-flow-smoke\\"",
        MainWindowHandle: 0,
        IsWindowVisible: false
      },
      {
        ProcessId: 777,
        ExecutablePath: "C:\\\\Other\\\\Local Flow.exe",
        CommandLine: "\\"C:\\\\Other\\\\Local Flow.exe\\" --user-data-dir=\\"C:\\\\Temp\\\\local-flow-smoke\\"",
        MainWindowHandle: 7001,
        IsWindowVisible: true
      }
    ];

    process.stdout.write(JSON.stringify(summarizePackagedStartup({
      exePath,
      userDataDir,
      firstPid: 401,
      hiddenLaunchStayedAlive: true,
      secondLaunchExited: true,
      processes
    })));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", snippet], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    hiddenLaunchStayedAlive: true,
    secondLaunchExited: true,
    secondLaunchRevealedExistingWindow: true,
    duplicateMainInstances: 0
  });
});

test("packaged startup summary rejects a duplicate isolated top-level app", () => {
  const snippet = `
    import { summarizePackagedStartup } from "./scripts/packaged-start-smoke-core.mjs";

    const processes = [501, 502].map((ProcessId) => ({
      ProcessId,
      ExecutablePath: "C:\\\\Apps\\\\Local Flow.exe",
      CommandLine: \`"C:\\\\Apps\\\\Local Flow.exe" --user-data-dir="C:\\\\Temp\\\\local-flow-smoke"\`,
      MainWindowHandle: ProcessId === 501 ? 9100 : 0,
      IsWindowVisible: ProcessId === 501
    }));

    process.stdout.write(JSON.stringify(summarizePackagedStartup({
      exePath: "C:\\\\Apps\\\\Local Flow.exe",
      userDataDir: "C:\\\\Temp\\\\local-flow-smoke",
      firstPid: 501,
      hiddenLaunchStayedAlive: true,
      secondLaunchExited: true,
      processes
    })));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", snippet], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    hiddenLaunchStayedAlive: true,
    secondLaunchExited: true,
    secondLaunchRevealedExistingWindow: true,
    duplicateMainInstances: 1
  });
});

test("product readiness script checks Windows release and iPhone handoff artifacts", async () => {
  const readinessSource = await readFile(new URL("../scripts/product-readiness-report.mjs", import.meta.url), "utf8");

  assert.match(readinessSource, /buildReleaseRequirements/);
  assert.doesNotMatch(readinessSource, /dist\/Local Flow Setup 0\.1\.0\.exe/);
  assert.match(readinessSource, /`\$\{productName\} Setup \$\{pkg\.version\}\.exe`/);
  assert.match(readinessSource, /`\$\{outputDir\}\/win-unpacked\/\$\{appExeName\}`/);
  assert.match(readinessSource, /contentIncludes/);
  assert.match(readinessSource, /NSMicrophoneUsageDescription/);
  assert.match(readinessSource, /SFSpeechRecognizer/);
  assert.match(readinessSource, /group\.com\.localflow\.dictation/);
  assert.match(readinessSource, /ios\/LocalFlowiOS\/README\.md/);
  assert.match(readinessSource, /ios\/LocalFlowiOS\/project\.yml/);
  assert.match(readinessSource, /ios\/LocalFlowiOS\/LocalFlowCore\/Package\.swift/);
  assert.match(readinessSource, /ios\/LocalFlowiOS\/App\/SpeechDictationViewModel\.swift/);
  assert.match(readinessSource, /ios\/LocalFlowiOS\/Keyboard\/KeyboardViewController\.swift/);
  assert.match(readinessSource, /ios\/LocalFlowiOS\/Intents\/DictateToClipboardIntent\.swift/);
  assert.match(readinessSource, /ios\/LocalFlowiOS\/App\/Info\.plist/);
  assert.match(readinessSource, /ios\/LocalFlowiOS\/Keyboard\/Info\.plist/);
  assert.match(readinessSource, /docs\/release\/iphone-device-trial-checklist\.md/);
  assert.match(readinessSource, /manualValidationRequired/);
});

test("gitignore ignores temporary product smoke data", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  const ignoredEntries = gitignore.split(/\r?\n/).map((line) => line.trim());

  assert.ok(ignoredEntries.includes(".tmp/"));
});

test("product trial guide gives a concrete Windows and iPhone trial path", async () => {
  const guide = await readFile(new URL("../docs/release/product-trial-guide.md", import.meta.url), "utf8");

  assert.match(guide, /Local Flow Setup 0\.1\.0\.exe/);
  assert.match(guide, /Ctrl \+ Alt \+ Space/);
  assert.match(guide, /npm\.cmd run check:packaged/);
  assert.match(guide, /npm\.cmd run check:product/);
  assert.match(guide, /Windows Installer Artifact/);
  assert.match(guide, /local-flow-windows-installer/);
  assert.match(guide, /Apple Speech/);
  assert.match(guide, /xcodebuild/);
});

test("iPhone device trial checklist covers signing permissions and keyboard setup", async () => {
  const checklist = await readFile(new URL("../docs/release/iphone-device-trial-checklist.md", import.meta.url), "utf8");

  assert.match(checklist, /XcodeGen/);
  assert.match(checklist, /Signing & Capabilities/);
  assert.match(checklist, /group\.com\.localflow\.dictation/);
  assert.match(checklist, /NSMicrophoneUsageDescription/);
  assert.match(checklist, /NSSpeechRecognitionUsageDescription/);
  assert.match(checklist, /Settings > General > Keyboard > Keyboards/);
  assert.match(checklist, /Allow Full Access/);
  assert.match(checklist, /Local Flow Keyboard/);
  assert.match(checklist, /localflow:\/\/quick-dictation/);
});

test("electron-builder configuration targets Local Flow Windows NSIS builds", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const vendorResource = pkg.build.extraResources.find(
    (resource) => resource.from === "vendor" && resource.to === "vendor"
  );

  assert.equal(pkg.build.appId, "com.localflow.dictation");
  assert.equal(pkg.build.productName, "Local Flow");
  assert.equal(pkg.build.asar, false);
  assert.equal(pkg.build.npmRebuild, false);
  assert.equal(pkg.build.directories.output, "dist");
  assert.deepEqual(pkg.build.win.target, ["nsis"]);
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.ok(pkg.build.files.includes("src/**/*"));
  assert.ok(pkg.build.files.includes("scripts/**/*"));
  assert.ok(pkg.build.files.includes("assets/**/*"));
  assert.ok(vendorResource);
  assert.ok(vendorResource.filter.includes("!**/downloads/**"));
  assert.ok(vendorResource.filter.includes("!llm/models/**"));
});

test("tray icon asset is packaged and valid SVG", async () => {
  const iconSource = await readFile(new URL("../assets/local-flow-icon.svg", import.meta.url), "utf8");

  assert.match(iconSource, /<svg[\s>]/);
});

test("build output directories stay ignored by git", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  const ignoredEntries = gitignore.split(/\r?\n/).map((line) => line.trim());

  assert.ok(ignoredEntries.includes("dist/"));
  assert.ok(ignoredEntries.includes("out/"));
  assert.ok(ignoredEntries.includes("ios/LocalFlowiOS/*.xcodeproj/"));
});

test("vendor placeholder can be committed without allowing real vendor contents", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  const ignoredEntries = gitignore.split(/\r?\n/).map((line) => line.trim());

  assert.ok(ignoredEntries.includes("vendor/*"));
  assert.ok(ignoredEntries.includes("!vendor/.gitkeep"));
  await access(new URL("../vendor/.gitkeep", import.meta.url));
});
