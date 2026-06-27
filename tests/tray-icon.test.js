import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getTrayIconPath } from "../src/main/tray-icon.js";

test("getTrayIconPath returns the packaged local flow SVG asset path", () => {
  assert.equal(getTrayIconPath("C:/app"), path.join("C:/app", "assets", "local-flow-icon.svg"));
});
