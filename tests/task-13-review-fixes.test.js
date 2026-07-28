import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("product readiness labels its automated scope and lists every manual release trial", () => {
  const result = spawnSync(process.execPath, ["scripts/product-readiness-report.mjs"], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(result.stdout || result.stderr);
  const manualAreas = new Set(payload.manualValidationRequired.map(({ area }) => area));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.readinessScope, "automated-artifacts-only");
  assert.equal(payload.automatedArtifactReadiness, true);
  assert.equal(payload.ok, payload.automatedArtifactReadiness);
  assert.deepEqual(manualAreas, new Set([
    "windows-live-multilingual-speech",
    "windows-explicit-target-language-conversion",
    "windows-microphone-to-notepad",
    "windows-escape-cancel-no-history",
    "windows-tray-balloon",
    "windows-isolated-clean-install-uninstall",
    "iphone-xcode-device-build"
  ]));
});

test("trial guide provides an honest uninstall fallback when Windows has no app entry", async () => {
  const guide = await readFile(
    new URL("../docs/release/product-trial-guide.md", import.meta.url),
    "utf8"
  );

  assert.match(guide, /仅当.*Windows.*已安装的应用.*存在.*Local Flow.*条目/);
  assert.match(guide, /否则.*安装目录.*Uninstall Local Flow\.exe/);
  assert.match(guide, /当前安装状态.*兜底/);
  assert.doesNotMatch(guide, /一定会在.*已安装的应用.*显示/);
});
