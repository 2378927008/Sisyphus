import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { electronRuntimeSwitches } from "../src/main/electron-runtime.js";

test("electronRuntimeSwitches disables sandbox and GPU paths for constrained Windows sessions", () => {
  assert.deepEqual(electronRuntimeSwitches, [
    "no-sandbox",
    "disable-gpu",
    "disable-gpu-compositing",
    "disable-software-rasterizer"
  ]);
});

test("npm start passes Electron runtime switches before the app path", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    pkg.scripts.start,
    "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer ."
  );
});

test("package exposes microphone smoke test script", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    pkg.scripts["check:microphone"],
    "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer scripts/electron-microphone-smoke.mjs"
  );
});

test("package exposes full app smoke test script", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    pkg.scripts["check:app"],
    "electron --no-sandbox --disable-gpu --disable-gpu-compositing --disable-software-rasterizer scripts/electron-app-smoke.mjs"
  );
});

test("main window uses an Electron-compatible CommonJS preload script", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const preloadSource = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");

  assert.match(mainSource, /preload\.cjs/);
  assert.match(preloadSource, /require\("electron"\)/);
  assert.doesNotMatch(preloadSource, /^\s*import\s/m);
});
