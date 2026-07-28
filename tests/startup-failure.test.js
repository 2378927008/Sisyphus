import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { handleStartupFailure } from "../src/main/startup-failure.js";

test("startup failures show fixed localized product copy and always quit", async () => {
  for (const language of ["en", "zh-Hans", "ja", "ko", "zh-Hant", "fr", "ru", "es"]) {
    let options;
    let quitCalls = 0;
    await handleStartupFailure({
      app: {
        quit() {
          quitCalls += 1;
        }
      },
      dialog: {
        async showMessageBox(next) {
          options = next;
        }
      },
      language,
      error: new Error("stderr spawn C:\\private\\app.exe ENOENT https://vendor.example exit code 7")
    });

    assert.equal(options.title, "Local Flow");
    assert.equal(options.buttons.length, 1);
    assert.doesNotMatch(
      JSON.stringify(options),
      /[A-Za-z]:[\\/]|https?:|spawn|ENOENT|stderr|exit code/i
    );
    assert.equal(quitCalls, 1);
  }
});

test("primary startup funnels synchronous permission setup and later failures into one final catch", async () => {
  const mainSource = await readFile(new URL("../src/main/index.js", import.meta.url), "utf8");
  const permissionStart = mainSource.indexOf("configureMediaPermissions(");
  const runtimeStart = mainSource.indexOf("runtimeRoot =", permissionStart);
  const readyStart = mainSource.indexOf("app.whenReady().then(async () => {");
  const shutdownStart = mainSource.indexOf('app.on("will-quit"', readyStart);

  assert.notEqual(permissionStart, -1);
  assert.notEqual(runtimeStart, -1);
  assert.notEqual(readyStart, -1);
  assert.notEqual(shutdownStart, -1);
  assert.doesNotMatch(
    mainSource.slice(permissionStart, runtimeStart),
    /\.catch\s*\(/,
    "synchronous permission configuration must not be treated as a promise"
  );
  assert.match(
    mainSource.slice(readyStart, shutdownStart),
    /\}\)\.catch\(\(\) => handleStartupFailure\(\{[\s\S]*?language: lastSettings\?\.interfaceLanguage[\s\S]*?\}\)\);/,
    "the entire ready chain must converge on the localized startup failure handler"
  );
});
