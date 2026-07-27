import test from "node:test";
import assert from "node:assert/strict";
import {
  bindMainWindowLifecycle,
  buildMainWindowOptions,
  revealMainWindow
} from "../src/main/main-window.js";

test("main window uses V4 dimensions and native frame", () => {
  const options = buildMainWindowOptions({ preloadPath: "C:/app/preload.cjs" });

  assert.equal(options.width, 1180);
  assert.equal(options.height, 800);
  assert.equal(options.minWidth, 780);
  assert.equal(options.minHeight, 600);
  assert.equal(options.frame, undefined);
  assert.equal(options.show, false);
  assert.equal(options.webPreferences.preload, "C:/app/preload.cjs");
});

test("ready and load fallback reveal only once", () => {
  const harness = createWindowHarness();
  bindMainWindowLifecycle({ window: harness.window, showOnReady: true });

  harness.emitWindow("ready-to-show");
  harness.emitContents("did-finish-load");

  assert.equal(harness.calls.show, 1);
  assert.equal(harness.calls.focus, 1);
});

test("reveal restores a minimized window before focusing it", () => {
  const harness = createWindowHarness({ minimized: true });

  assert.equal(revealMainWindow(harness.window), true);
  assert.equal(harness.calls.restore, 1);
  assert.equal(harness.calls.show, 1);
  assert.equal(harness.calls.focus, 1);
});

test("reveal refuses destroyed windows", () => {
  const harness = createWindowHarness({ destroyed: true });

  assert.equal(revealMainWindow(harness.window), false);
  assert.equal(harness.calls.show, 0);
  assert.equal(harness.calls.focus, 0);
});

test("close hides to tray and notifies only once until quitting", () => {
  const harness = createWindowHarness();
  let firstHideCount = 0;
  let quitting = false;
  bindMainWindowLifecycle({
    window: harness.window,
    isQuitting: () => quitting,
    onFirstHide: () => {
      firstHideCount += 1;
    }
  });

  const firstClose = harness.emitWindow("close");
  const secondClose = harness.emitWindow("close");
  quitting = true;
  const quittingClose = harness.emitWindow("close");

  assert.equal(firstClose.defaultPrevented, true);
  assert.equal(secondClose.defaultPrevented, true);
  assert.equal(quittingClose.defaultPrevented, false);
  assert.equal(harness.calls.hide, 2);
  assert.equal(firstHideCount, 1);
});

test("only main-frame failures are reported", () => {
  const harness = createWindowHarness();
  const failures = [];
  bindMainWindowLifecycle({
    window: harness.window,
    onLoadFailure: (failure) => failures.push(failure)
  });

  harness.emitContents("did-fail-load", -3, "subframe failed", "https://subframe", false);
  harness.emitContents("did-fail-load", -2, "main frame failed", "file:///index.html", true);

  assert.deepEqual(failures, [{
    errorCode: -2,
    errorDescription: "main frame failed",
    validatedURL: "file:///index.html"
  }]);
});

function createWindowHarness({ minimized = false, destroyed = false } = {}) {
  const windowListeners = new Map();
  const contentsListeners = new Map();
  const calls = {
    focus: 0,
    hide: 0,
    restore: 0,
    show: 0
  };
  const webContents = {
    isDestroyed: () => destroyed,
    once(eventName, listener) {
      contentsListeners.set(eventName, listener);
    },
    on(eventName, listener) {
      contentsListeners.set(eventName, listener);
    }
  };
  const window = {
    webContents,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore() {
      calls.restore += 1;
    },
    show() {
      calls.show += 1;
    },
    focus() {
      calls.focus += 1;
    },
    hide() {
      calls.hide += 1;
    },
    once(eventName, listener) {
      windowListeners.set(eventName, listener);
    },
    on(eventName, listener) {
      windowListeners.set(eventName, listener);
    }
  };

  return {
    calls,
    window,
    emitWindow(eventName, ...args) {
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      windowListeners.get(eventName)?.(event, ...args);
      return event;
    },
    emitContents(eventName, ...args) {
      contentsListeners.get(eventName)?.({}, ...args);
    }
  };
}
