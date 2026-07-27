import test from "node:test";
import assert from "node:assert/strict";
import { createDeferredReveal, isHiddenLaunch, registerSingleInstance } from "../src/main/single-instance.js";
import { shouldStartMinimized } from "../src/main/startup-settings.js";

function createFakeApp({ lock }) {
  const listeners = new Map();
  let quitCalls = 0;
  return {
    app: {
      requestSingleInstanceLock: () => lock,
      quit: () => {
        quitCalls += 1;
      },
      on: (event, listener) => listeners.set(event, listener)
    },
    emitSecond: (argv) => listeners.get("second-instance")?.({}, argv),
    get quitCalls() {
      return quitCalls;
    }
  };
}

test("only an explicit hidden flag creates a hidden launch", () => {
  assert.equal(isHiddenLaunch(["Local Flow.exe"]), false);
  assert.equal(isHiddenLaunch(["Local Flow.exe", "--hidden"]), true);
  assert.equal(shouldStartMinimized(["Local Flow.exe"], { startMinimizedToTray: true }), false);
});

test("a second manual launch reveals while a login launch stays quiet", () => {
  const harness = createFakeApp({ lock: true });
  const reveals = [];
  assert.equal(registerSingleInstance(harness.app, {
    onSecondInstance: (argv) => reveals.push(argv)
  }), true);
  harness.emitSecond(["Local Flow.exe"]);
  harness.emitSecond(["Local Flow.exe", "--hidden"]);
  assert.deepEqual(reveals, [["Local Flow.exe"]]);
});

test("a second process that does not own the lock quits", () => {
  const harness = createFakeApp({ lock: false });

  assert.equal(registerSingleInstance(harness.app), false);
  assert.equal(harness.quitCalls, 1);
});

test("a reveal requested before window creation is flushed after creation", () => {
  let available = false;
  const reveals = [];
  const deferred = createDeferredReveal(() => {
    if (!available) return false;
    reveals.push("shown");
    return true;
  });
  assert.equal(deferred.request(), false);
  assert.equal(deferred.hasPending(), true);
  available = true;
  assert.equal(deferred.flush(), true);
  assert.equal(deferred.hasPending(), false);
  assert.deepEqual(reveals, ["shown"]);
});
