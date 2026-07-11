import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { buildPasteCommand, pasteText } from "../src/main/paste.js";

test("buildPasteCommand returns a Windows SendKeys command", () => {
  const command = buildPasteCommand();

  assert.equal(command.file, "powershell.exe");
  assert.ok(command.args.includes("-STA"));
  assert.match(command.args.at(-1), /SendKeys.*\^v/);
  assert.doesNotMatch(command.args.at(-1), /Start-Sleep/);
});

test("pasteText aborts during the focus delay without spawning SendKeys", async () => {
  const controller = new AbortController();
  let spawnCalls = 0;

  await assert.rejects(
    pasteText("hello", {
      clipboard: { writeText() {} },
      signal: controller.signal,
      wait: async () => controller.abort(),
      spawn: () => {
        spawnCalls += 1;
        const child = new EventEmitter();
        process.nextTick(() => child.emit("close", 0));
        return child;
      }
    }),
    (error) => error.code === "paste_failed"
  );

  assert.equal(spawnCalls, 0);
});

test("pasteText kills an active SendKeys process when aborted", async () => {
  const controller = new AbortController();
  const child = new EventEmitter();
  let killCalls = 0;
  child.kill = () => {
    killCalls += 1;
    process.nextTick(() => child.emit("close", 1));
    return true;
  };

  const result = pasteText("hello", {
    clipboard: { writeText() {} },
    signal: controller.signal,
    wait: async () => {},
    spawn: () => {
      process.nextTick(() => controller.abort());
      setImmediate(() => child.emit("close", 0));
      return child;
    }
  });

  await assert.rejects(result, (error) => error.code === "paste_failed");
  assert.equal(killCalls, 1);
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
