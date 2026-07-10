import test from "node:test";
import assert from "node:assert/strict";
import { insertTextIntoPreviousApp, normalizeInsertText } from "../src/main/insert-text.js";

test("normalizeInsertText rejects non-string values", () => {
  assert.throws(() => normalizeInsertText(null), TypeError);
});

test("normalizeInsertText rejects whitespace-only text", () => {
  assert.throws(() => normalizeInsertText(" \t\n "), /non-whitespace/i);
});

test("normalizeInsertText counts Unicode code points at the configured boundary", () => {
  assert.equal(normalizeInsertText("😀😀", 2), "😀😀");
  assert.throws(() => normalizeInsertText("😀😀😀", 2), /maximum/i);
});

test("normalizeInsertText defaults to a 100000 code point maximum", () => {
  assert.equal(normalizeInsertText("a".repeat(100000)).length, 100000);
  assert.throws(() => normalizeInsertText("a".repeat(100001)), /maximum/i);
});

test("normalizeInsertText preserves meaningful leading and trailing whitespace", () => {
  const text = "  keep this spacing  \n";

  assert.equal(normalizeInsertText(text), text);
});

test("insertTextIntoPreviousApp hides, waits, then pastes normalized text", async () => {
  const calls = [];
  const clipboard = {};
  const mainWindow = {
    isDestroyed: () => false,
    hide: () => calls.push("hide")
  };
  const text = "  edited text  ";

  const result = await insertTextIntoPreviousApp(text, {
    mainWindow,
    clipboard,
    wait: async (milliseconds) => calls.push(["wait", milliseconds]),
    paste: async (receivedText, dependencies) => calls.push(["paste", receivedText, dependencies])
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    "hide",
    ["wait", 140],
    ["paste", text, { clipboard }]
  ]);
});

test("insertTextIntoPreviousApp does not paste when the window is destroyed while waiting", async () => {
  let destroyed = false;
  let pasteCalls = 0;

  const result = await insertTextIntoPreviousApp("edited text", {
    mainWindow: {
      isDestroyed: () => destroyed,
      hide() {}
    },
    wait: async () => {
      destroyed = true;
    },
    paste: async () => {
      pasteCalls += 1;
    }
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "window_unavailable",
    message: "Paste failed. Text copied."
  });
  assert.equal(pasteCalls, 0);
});

test("insertTextIntoPreviousApp maps wait failures without exposing diagnostics", async () => {
  let pasteCalls = 0;

  const result = await insertTextIntoPreviousApp("edited text", {
    mainWindow: {
      isDestroyed: () => false,
      hide() {}
    },
    wait: async () => {
      throw new Error("C:/secret/path timeout stack trace");
    },
    paste: async () => {
      pasteCalls += 1;
    }
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "paste_failed",
    message: "Paste failed. Text copied."
  });
  assert.equal(pasteCalls, 0);
});

test("insertTextIntoPreviousApp maps clipboard failures without exposing diagnostics", async () => {
  const result = await insertTextIntoPreviousApp("edited text", {
    mainWindow: {
      isDestroyed: () => false,
      hide() {}
    },
    wait: async () => {},
    paste: async () => {
      const error = new Error("C:/secret/path spawn ENOENT stack trace");
      error.code = "clipboard_unavailable";
      throw error;
    }
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "clipboard_unavailable",
    message: "Paste failed. Text copied."
  });
});

test("insertTextIntoPreviousApp normalizes unknown paste failures", async () => {
  const result = await insertTextIntoPreviousApp("edited text", {
    mainWindow: {
      isDestroyed: () => false,
      hide() {}
    },
    wait: async () => {},
    paste: async () => {
      const error = new Error("C:/secret/path spawn ENOENT stack trace");
      error.code = "unexpected_failure";
      throw error;
    }
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "paste_failed",
    message: "Paste failed. Text copied."
  });
});

test("insertTextIntoPreviousApp does not paste when the main window is unavailable", async () => {
  let pasteCalls = 0;

  const result = await insertTextIntoPreviousApp("edited text", {
    mainWindow: {
      isDestroyed: () => true,
      hide() {
        throw new Error("should not hide");
      }
    },
    paste: async () => {
      pasteCalls += 1;
    }
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "window_unavailable",
    message: "Paste failed. Text copied."
  });
  assert.equal(pasteCalls, 0);
});

test("insertTextIntoPreviousApp does not paste when hiding the main window fails", async () => {
  let pasteCalls = 0;

  const result = await insertTextIntoPreviousApp("edited text", {
    mainWindow: {
      isDestroyed: () => false,
      hide() {
        throw new Error("window handle is invalid");
      }
    },
    paste: async () => {
      pasteCalls += 1;
    }
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "window_unavailable",
    message: "Paste failed. Text copied."
  });
  assert.equal(pasteCalls, 0);
});
