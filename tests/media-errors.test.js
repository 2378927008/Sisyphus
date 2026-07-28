import test from "node:test";
import assert from "node:assert/strict";
import { describeMicrophoneError } from "../src/shared/media-errors.js";

test("describeMicrophoneError explains permission denial", () => {
  const result = describeMicrophoneError({ name: "NotAllowedError" });

  assert.match(result, /microphone permission/i);
  assert.match(result, /Windows Settings/i);
});

test("describeMicrophoneError explains missing microphone devices", () => {
  const result = describeMicrophoneError({ name: "NotFoundError" });

  assert.match(result, /No microphone/i);
});

test("describeMicrophoneError explains busy microphone devices", () => {
  const result = describeMicrophoneError({ name: "NotReadableError" });

  assert.match(result, /busy/i);
});

test("describeMicrophoneError never exposes raw runtime diagnostics or developer commands", () => {
  for (const error of [
    {
      name: "SecurityError",
      message: "spawn C:\\private\\helper.exe ENOENT stderr https://secret.example"
    },
    {
      name: "UnknownError",
      message: "\\\\server\\share /home/private/mic exit code 7"
    }
  ]) {
    const result = describeMicrophoneError(error);
    assert.doesNotMatch(
      result,
      /npm|[A-Za-z]:[\\/]|\\\\server|\/home\/|https?:|spawn|ENOENT|stderr|exit code/i
    );
  }
});
