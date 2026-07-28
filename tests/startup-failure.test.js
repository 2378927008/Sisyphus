import assert from "node:assert/strict";
import test from "node:test";
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
