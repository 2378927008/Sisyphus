import test from "node:test";
import assert from "node:assert/strict";
import * as mainWindowModule from "../src/main/main-window.js";

const {
  bindMainWindowLifecycle,
  buildMainWindowOptions,
  revealMainWindow
} = mainWindowModule;

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

test("hidden startup ignores both ready and load fallback reveals", () => {
  const harness = createWindowHarness();
  bindMainWindowLifecycle({ window: harness.window, showOnReady: false });

  harness.emitWindow("ready-to-show");
  harness.emitContents("did-finish-load");

  assert.equal(harness.calls.show, 0);
  assert.equal(harness.calls.focus, 0);
});

test("load failure dialog uses fixed recovery copy without diagnostics", async () => {
  assert.equal(typeof mainWindowModule.showMainWindowLoadFailure, "function");
  let displayedOptions;
  const diagnosticFailure = {
    errorCode: -2,
    errorDescription: "spawn C:\\Users\\Administrator\\private-helper.exe ENOENT stderr https://secret.example",
    validatedURL: "file:///C:/Users/Administrator/AppData/Local/Local%20Flow/resources/app/index.html"
  };

  await mainWindowModule.showMainWindowLoadFailure({
    app: {
      isQuitting: false,
      quit() {
        assert.fail("keep-running response must not quit");
      }
    },
    dialog: {
      async showMessageBox(options) {
        displayedOptions = options;
        return { response: 1 };
      }
    },
    language: "en",
    failure: diagnosticFailure
  });

  assert.deepEqual(displayedOptions, {
    type: "error",
    title: "Local Flow",
    message: "Local Flow could not load its main window. You can exit, or keep it running in the background and reopen it later.",
    buttons: ["Exit", "Keep running in background"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  assert.doesNotMatch(
    JSON.stringify(displayedOptions),
    /Administrator|file:|https?:|spawn|ENOENT|stderr|private-helper/i
  );
});

test("load failure dialog localizes the same fixed recovery action", async () => {
  assert.equal(typeof mainWindowModule.showMainWindowLoadFailure, "function");
  let displayedOptions;

  await mainWindowModule.showMainWindowLoadFailure({
    app: {},
    dialog: {
      async showMessageBox(options) {
        displayedOptions = options;
        return { response: 1 };
      }
    },
    language: "zh-Hans"
  });

  assert.equal(
    displayedOptions.message,
    "Local Flow \u4e3b\u7a97\u53e3\u52a0\u8f7d\u5931\u8d25\u3002\u53ef\u4ee5\u9000\u51fa\u5e94\u7528\uff0c\u6216\u7ee7\u7eed\u5728\u540e\u53f0\u8fd0\u884c\u5e76\u7a0d\u540e\u91cd\u65b0\u6253\u5f00\u3002"
  );
  assert.deepEqual(displayedOptions.buttons, ["\u9000\u51fa", "\u7ee7\u7eed\u5728\u540e\u53f0"]);
  assert.equal("detail" in displayedOptions, false);
});

test("load failure recovery copy is localized for every supported interface language", async () => {
  const messages = new Set();
  const buttonSets = new Set();

  for (const language of ["en", "zh-Hans", "ja", "ko", "zh-Hant", "fr", "ru", "es"]) {
    let options;
    await mainWindowModule.showMainWindowLoadFailure({
      app: {},
      dialog: {
        async showMessageBox(next) {
          options = next;
          return { response: 1 };
        }
      },
      language
    });
    messages.add(options.message);
    buttonSets.add(options.buttons.join("|"));
  }

  assert.equal(messages.size, 8);
  assert.equal(buttonSets.size, 8);
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

test("trusted navigation allows only the exact app page and denies every new window", () => {
  assert.equal(typeof mainWindowModule.bindTrustedWindowNavigation, "function");
  const harness = createWindowHarness();
  const approvedUrl = "file:///C:/app/src/renderer/index.html";

  mainWindowModule.bindTrustedWindowNavigation({
    window: harness.window,
    approvedUrl
  });

  const approvedNavigation = harness.emitContents("will-navigate", approvedUrl);
  const localNavigation = harness.emitContents(
    "will-navigate",
    "file:///C:/app/src/renderer/other.html"
  );
  const remoteNavigation = harness.emitContents(
    "will-redirect",
    "https://example.com"
  );

  assert.equal(approvedNavigation.defaultPrevented, false);
  assert.equal(localNavigation.defaultPrevented, true);
  assert.equal(remoteNavigation.defaultPrevented, true);
  assert.deepEqual(harness.openWindow({ url: approvedUrl }), { action: "deny" });
  assert.deepEqual(harness.openWindow({ url: "https://example.com" }), { action: "deny" });
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
    setWindowOpenHandler(handler) {
      contentsListeners.set("window-open", handler);
    },
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
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        }
      };
      contentsListeners.get(eventName)?.(event, ...args);
      return event;
    },
    openWindow(details) {
      return contentsListeners.get("window-open")?.(details);
    }
  };
}
