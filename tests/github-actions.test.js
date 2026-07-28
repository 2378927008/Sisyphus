import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("GitHub Actions defines a macOS iPhone source smoke workflow", async () => {
  const workflow = await readFile(new URL("../.github/workflows/iphone-smoke.yml", import.meta.url), "utf8");

  assert.match(workflow, /name:\s*iPhone Source Smoke/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on:\s*macos-latest/);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /swift --version/);
  assert.match(workflow, /brew install xcodegen/);
  assert.match(workflow, /xcodegen generate --spec ios\/LocalFlowiOS\/project\.yml/);
  assert.match(workflow, /working-directory:\s*ios\/LocalFlowiOS\/LocalFlowCore/);
  assert.match(workflow, /swift test/);
  assert.match(workflow, /node --test tests\/iphone-mvp-scaffold\.test\.js/);
  assert.doesNotMatch(workflow, /APPLE_ID|APP_STORE_CONNECT|MATCH_PASSWORD|FASTLANE|OPENAI_API_KEY|sk-proj/i);
});

test("iPhone README documents the Windows-only cloud macOS validation path", async () => {
  const readme = await readFile(new URL("../ios/LocalFlowiOS/README.md", import.meta.url), "utf8");

  assert.match(readme, /GitHub Actions/);
  assert.match(readme, /\.github\/workflows\/iphone-smoke\.yml/);
  assert.match(readme, /macOS/);
  assert.match(readme, /swift test/);
  assert.match(readme, /node --test tests\/iphone-mvp-scaffold\.test\.js/);
  assert.match(readme, /does not sign/);
  assert.match(readme, /does not require an Apple Developer account/);
});

test("LocalFlowCore can run Swift package tests on the macOS GitHub runner", async () => {
  const packageSource = await readFile(
    new URL("../ios/LocalFlowiOS/LocalFlowCore/Package.swift", import.meta.url),
    "utf8"
  );

  assert.match(packageSource, /\.iOS\(\.v16\)/);
  assert.match(packageSource, /\.macOS\(\.v13\)/);
});

test("GitHub Actions can build and upload the Windows installer artifact", async () => {
  const workflow = await readFile(new URL("../.github/workflows/windows-installer.yml", import.meta.url), "utf8");

  assert.match(workflow, /name:\s*Windows Installer Artifact/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /setup-llm\.ps1 -RuntimeOnly/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run check:app/);
  assert.match(workflow, /npm run check:visual/);
  assert.match(workflow, /npm run dist:win/);
  assert.match(workflow, /npm run check:packaged/);
  assert.match(workflow, /npm run check:product/);
  assert.match(workflow, /Tee-Object -FilePath \.tmp\/dist-win\.log/);
  assert.match(workflow, /windows-build-diagnostics/);
  assert.match(workflow, /if:\s*\$\{\{ always\(\) \}\}/);
  assert.match(workflow, /npm run verify:release/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /Local Flow Setup 0\.1\.0\.exe/);
  assert.match(workflow, /dist\/local-flow-release-build\.json/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|sk-proj|APPLE_ID|APP_STORE_CONNECT/i);
});
