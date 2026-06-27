import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("README contains readable Chinese first-run guidance", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /## 中文试用步骤/);
  assert.match(readme, /## Windows 安装包试用/);
  assert.match(readme, /Local Flow Setup 0\.1\.0\.exe/);
  assert.match(readme, /安装后首次启动/);
  assert.match(readme, /Local Flow 是语音输入软件，不是默认翻译软件/);
  assert.match(readme, /输出语言.*自动.*同语音/);
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
