import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("README contains readable Chinese first-run guidance", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /## 中文试用步骤/);
  assert.match(readme, /## Windows 安装包试用/);
  assert.match(readme, /Local Flow Setup 0\.1\.0\.exe/);
  assert.match(readme, /安装后首次启动/);
  assert.match(readme, /Local Flow 是语音输入软件，不是默认翻译软件/);
  assert.match(readme, /输出语言.*自动.*同语音/);
  assert.match(readme, /LOCAL_FLOW_LLAMA_RUNTIME_URL/);
  assert.match(readme, /LOCAL_FLOW_QWEN_MODEL_MIRROR_URLS/);
  assert.doesNotMatch(readme, /涓|鍦|璇|鐨|妯|榛/);
});

test("package metadata is suitable for local Windows release builds", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.author, "Local Flow");
  assert.equal(pkg.build.win.icon, "assets/local-flow-icon.ico");
  assert.equal(pkg.build.nsis.installerIcon, "assets/local-flow-icon.ico");
  assert.equal(pkg.build.nsis.uninstallerIcon, "assets/local-flow-icon.ico");
  assert.equal(pkg.scripts["verify:release"], "node scripts/verify-release-build.mjs");
});

test("Windows icon asset is a multi-image ICO file", async () => {
  const ico = await readFile(new URL("../assets/local-flow-icon.ico", import.meta.url));

  assert.equal(ico.toString("ascii", 0, 4), "\u0000\u0000\u0001\u0000");
  assert.ok(ico.readUInt16LE(4) >= 4);
  assert.ok(ico.length > 10_000);
});

test("Windows icon generator is checked in", async () => {
  const script = await readFile(new URL("../scripts/create-windows-icon.mjs", import.meta.url), "utf8");

  assert.match(script, /local-flow-icon\.ico/);
  assert.match(script, /writeIco/);
});

test("release verifier checks installer executable and icon config", async () => {
  const script = await readFile(new URL("../scripts/verify-release-build.mjs", import.meta.url), "utf8");

  assert.match(script, /buildReleaseRequirements/);
  assert.doesNotMatch(script, /dist\/Local Flow Setup 0\.1\.0\.exe/);
  assert.match(script, /`\$\{productName\} Setup \$\{pkg\.version\}\.exe`/);
  assert.match(script, /`\$\{outputDir\}\/win-unpacked\/\$\{productName\}\.exe`/);
  assert.match(script, /resources\/app\/scripts\/llama-runtime-manifest\.json/);
  assert.match(script, /resources\/app\/scripts\/qwen-model-manifest\.json/);
  assert.match(script, /resources\/vendor\/whisper\/bin\/Release\/whisper-cli\.exe/);
  assert.match(script, /resources\/vendor\/whisper\/models\/ggml-base\.bin/);
  assert.match(script, /resources\/vendor\/llm\/bin\/llama-cli\.exe/);
  assert.doesNotMatch(script, /resources\/vendor\/llm\/models\/Qwen3-4B-Q4_K_M\.gguf/);
  assert.match(script, /assets\/local-flow-icon\.ico/);
  assert.match(script, /git check-ignore/);
});

test("product readiness reports the approved Windows V4 design evidence", () => {
  const result = spawnSync(process.execPath, ["scripts/product-readiness-report.mjs"], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(result.stdout || result.stderr);
  const checksByPath = new Map(payload.checks.map((check) => [check.path, check]));

  assert.equal(
    checksByPath.get("docs/superpowers/specs/2026-07-27-windows-ui-v4-startup-reliability-design.md")?.ok,
    true
  );
  assert.equal(
    checksByPath.get("docs/design/local-flow-windows-ui-v4-fusion.png")?.ok,
    true
  );
});

test("Chinese product trial guide covers the complete Windows V4 trial", async () => {
  const guide = await readFile(new URL("../docs/release/product-trial-guide.md", import.meta.url), "utf8");

  for (const expected of [
    "桌面快捷方式",
    "开始菜单",
    "Ctrl + Alt + Space",
    "停止",
    "取消",
    "托盘",
    "编辑历史",
    "重新整理",
    "个人词典",
    "快捷短语",
    "自动（同语音）",
    "仅在明确选择目标语言时",
    "Qwen",
    "不影响本地 Whisper",
    "卸载"
  ]) {
    assert.ok(guide.includes(expected), `missing trial guidance: ${expected}`);
  }

  assert.doesNotMatch(guide, /\b(?:spawn|ENOENT|stderr)\b/i);
});

test("main process retains recoverable main-window and tray lifecycle wiring", async () => {
  const main = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const lifecycle = await readFile(new URL("../src/main/main-window.js", import.meta.url), "utf8");

  assert.match(main, /onFirstHide: showBackgroundNotice/);
  assert.match(main, /onLoadFailure:\s*\(\)\s*=>\s*\{/);
  assert.match(main, /showMainWindowLoadFailure\(\{/);
  assert.doesNotMatch(main, /validatedURL|errorDescription/);
  assert.match(main, /tray\?\.displayBalloon\?\.\(/);
  assert.match(main, /globalShortcut\.unregisterAll\?\.\(\)/);
  assert.match(main, /nativeShortcut\?\.unregisterAll\?\.\(\)/);
  assert.match(lifecycle, /window\.hide\(\)/);
  assert.match(lifecycle, /if \(!isMainFrame\)/);
});
