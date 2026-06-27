import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("package exposes Windows packaging scripts and electron-builder dependency", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.scripts["package:win"], "electron-builder --win --dir");
  assert.equal(pkg.scripts["dist:win"], "electron-builder --win nsis");
  assert.ok(pkg.devDependencies["electron-builder"]);
});

test("electron-builder configuration targets Local Flow Windows NSIS builds", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const vendorResource = pkg.build.extraResources.find(
    (resource) => resource.from === "vendor" && resource.to === "vendor"
  );

  assert.equal(pkg.build.appId, "com.localflow.dictation");
  assert.equal(pkg.build.productName, "Local Flow");
  assert.equal(pkg.build.asar, false);
  assert.equal(pkg.build.directories.output, "dist");
  assert.deepEqual(pkg.build.win.target, ["nsis"]);
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.ok(pkg.build.files.includes("src/**/*"));
  assert.ok(pkg.build.files.includes("scripts/**/*"));
  assert.ok(vendorResource);
  assert.ok(vendorResource.filter.includes("!**/downloads/**"));
});

test("build output directories stay ignored by git", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  const ignoredEntries = gitignore.split(/\r?\n/).map((line) => line.trim());

  assert.ok(ignoredEntries.includes("dist/"));
  assert.ok(ignoredEntries.includes("out/"));
});

test("vendor placeholder can be committed without allowing real vendor contents", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  const ignoredEntries = gitignore.split(/\r?\n/).map((line) => line.trim());

  assert.ok(ignoredEntries.includes("vendor/*"));
  assert.ok(ignoredEntries.includes("!vendor/.gitkeep"));
  await access(new URL("../vendor/.gitkeep", import.meta.url));
});
