import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getAppRoot, getRuntimeRoot, getVendorRoot } from "../src/main/runtime-root.js";

test("getRuntimeRoot uses the current working directory for source runs", () => {
  assert.equal(
    getRuntimeRoot({
      app: { isPackaged: false },
      cwd: () => "C:/project/local-flow",
      resourcesPath: "C:/project/local-flow/resources"
    }),
    "C:/project/local-flow"
  );
});

test("getRuntimeRoot uses Electron resourcesPath for packaged runs", () => {
  assert.equal(
    getRuntimeRoot({
      app: { isPackaged: true },
      cwd: () => "C:/Users/Alice",
      resourcesPath: "C:/Program Files/Local Flow/resources"
    }),
    "C:/Program Files/Local Flow/resources"
  );
});

test("getAppRoot uses the current working directory for source runs", () => {
  assert.equal(
    getAppRoot({
      app: { isPackaged: false },
      cwd: () => "C:/project/local-flow",
      resourcesPath: "C:/project/local-flow/resources"
    }),
    "C:/project/local-flow"
  );
});

test("getAppRoot resolves packaged app files under resources/app", () => {
  assert.equal(
    getAppRoot({
      app: { isPackaged: true },
      cwd: () => "C:/Users/Alice",
      resourcesPath: "C:/Program Files/Local Flow/resources"
    }),
    path.join("C:/Program Files/Local Flow/resources", "app")
  );
});

test("getVendorRoot resolves vendor under the runtime root", () => {
  assert.equal(
    getVendorRoot("C:/Program Files/Local Flow/resources"),
    path.join("C:/Program Files/Local Flow/resources", "vendor")
  );
});
