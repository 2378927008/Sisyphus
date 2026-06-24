import test from "node:test";
import assert from "node:assert/strict";
import { buildPasteCommand } from "../src/main/paste.js";

test("buildPasteCommand returns a Windows SendKeys command", () => {
  const command = buildPasteCommand();

  assert.equal(command.file, "powershell.exe");
  assert.ok(command.args.includes("-STA"));
  assert.match(command.args.at(-1), /SendKeys.*\^v/);
});
