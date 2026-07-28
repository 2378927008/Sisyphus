import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  queryWindowsKnownFolders,
  validateWindowsKnownFolders
} from "../scripts/windows-known-folders.mjs";

test("known-folder validation accepts a coherent Windows profile", () => {
  const startMenu = "C:\\Users\\runner\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu";
  assert.deepEqual(
    validateWindowsKnownFolders({
      appData: "C:\\Users\\runner\\AppData\\Roaming",
      localAppData: "C:\\Users\\runner\\AppData\\Local",
      desktop: "C:\\Users\\runner\\Desktop",
      startMenu,
      programs: path.win32.join(startMenu, "Programs")
    }),
    { ok: true, errors: [] }
  );
});

test("known-folder validation rejects environment-only fake profiles", () => {
  const validation = validateWindowsKnownFolders({
    appData: "relative\\AppData",
    localAppData: "",
    desktop: "relative\\Desktop",
    startMenu: "relative\\Start Menu",
    programs: "relative\\Start Menu\\Programs"
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.errors.length >= 4);
});

test(
  "Windows known-folder preflight executes against the current account",
  { skip: process.platform !== "win32" },
  async () => {
    const snapshot = await queryWindowsKnownFolders({
      requireComplete: false
    });
    const validation = validateWindowsKnownFolders(snapshot);
    assert.match(snapshot.appData, /^[a-z]:\\/i);
    assert.match(snapshot.localAppData, /^[a-z]:\\/i);
    assert.match(snapshot.startMenu, /^[a-z]:\\/i);
    assert.ok(
      validation.ok ||
        validation.errors.some((error) => error.includes("desktop")),
      validation.errors.join("; ")
    );
  }
);
