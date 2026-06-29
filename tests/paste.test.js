import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { buildPasteCommand, pasteText } from "../src/main/paste.js";

test("buildPasteCommand returns a Windows SendKeys command", () => {
  const command = buildPasteCommand();

  assert.equal(command.file, "powershell.exe");
  assert.ok(command.args.includes("-STA"));
  assert.match(command.args.at(-1), /SendKeys.*\^v/);
});

test("pasteText rejects with clipboard_unavailable when clipboard is missing", async () => {
  await assert.rejects(
    pasteText("hello", { clipboard: null }),
    (error) => {
      assert.equal(error.code, "clipboard_unavailable");
      return true;
    }
  );
});

test("pasteText writes clipboard text before rejecting failed paste command", async () => {
  let clipboardText = "";
  const clipboard = {
    writeText(text) {
      clipboardText = text;
    }
  };
  const spawn = () => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit("close", 1));
    return child;
  };

  await assert.rejects(
    pasteText("hello", { clipboard, spawn }),
    (error) => {
      assert.equal(error.code, "paste_failed");
      return true;
    }
  );

  assert.equal(clipboardText, "hello");
});

test("pasteText rejects spawn errors with paste_failed", async () => {
  const clipboard = {
    writeText() {}
  };
  const spawn = () => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit("error", new Error("spawn failed")));
    return child;
  };

  await assert.rejects(
    pasteText("hello", { clipboard, spawn }),
    (error) => {
      assert.equal(error.code, "paste_failed");
      return true;
    }
  );
});
