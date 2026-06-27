# Windows Release Polish V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Windows installer build so Local Flow has clean documentation, honest release metadata, a configured Windows icon, and a repeatable release verification command.

**Architecture:** Keep changes in release-facing boundaries: `README.md`, `package.json`, `assets/`, `scripts/`, and focused tests. Avoid changing dictation architecture or main-process state machines.

**Tech Stack:** Electron 38, electron-builder, Node.js built-in test runner, PowerShell/Windows packaging.

---

## File Map

- `README.md`: replace corrupted Chinese sections with valid UTF-8 usage and setup documentation.
- `package.json`: add minimal release metadata, Windows icon configuration, and `verify:release` script.
- `assets/local-flow-icon.ico`: generated Windows app/installer icon.
- `scripts/create-windows-icon.mjs`: deterministic local icon generator using Node buffers.
- `scripts/verify-release-build.mjs`: release artifact verifier.
- `tests/release-polish.test.js`: tests for README text, release metadata, icon asset, and release verification script wiring.

## Task 1: README Release Documentation

**Files:**
- Modify: `README.md`
- Create: `tests/release-polish.test.js`

- [ ] **Step 1: Write failing README tests**

Add tests that fail on the current mojibake Chinese text:

```js
test("README contains readable Chinese first-run guidance", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /## 中文试用步骤/);
  assert.match(readme, /Local Flow 是语音输入软件，不是默认翻译软件/);
  assert.match(readme, /输出语言.*自动.*同语音/);
  assert.doesNotMatch(readme, /涓|鍦|璇|鐨|妯|榛/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/release-polish.test.js`

Expected: FAIL because `README.md` still contains mojibake and lacks `## 中文试用步骤`.

- [ ] **Step 3: Replace corrupted README sections**

Rewrite the corrupted Chinese sections with valid UTF-8 Chinese. Keep the English sections concise and preserve existing source/build commands.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/release-polish.test.js`

Expected: PASS for README checks.

- [ ] **Step 5: Commit**

```powershell
git add README.md tests/release-polish.test.js
git commit -m "docs: repair windows release guidance"
```

## Task 2: Release Metadata And Windows Icon Config

**Files:**
- Modify: `package.json`
- Modify: `tests/release-polish.test.js`

- [ ] **Step 1: Write failing package metadata tests**

Add tests:

```js
test("package metadata is suitable for local Windows release builds", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.author, "Local Flow");
  assert.equal(pkg.build.win.icon, "assets/local-flow-icon.ico");
  assert.equal(pkg.build.nsis.installerIcon, "assets/local-flow-icon.ico");
  assert.equal(pkg.build.nsis.uninstallerIcon, "assets/local-flow-icon.ico");
  assert.equal(pkg.scripts["verify:release"], "node scripts/verify-release-build.mjs");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/release-polish.test.js`

Expected: FAIL because metadata, icon config, and script are not present.

- [ ] **Step 3: Add minimal package metadata**

Set:

```json
"author": "Local Flow"
```

Configure:

```json
"win": {
  "target": ["nsis"],
  "icon": "assets/local-flow-icon.ico"
},
"nsis": {
  "installerIcon": "assets/local-flow-icon.ico",
  "uninstallerIcon": "assets/local-flow-icon.ico"
}
```

Add:

```json
"verify:release": "node scripts/verify-release-build.mjs"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/release-polish.test.js`

Expected: PASS for package metadata checks.

- [ ] **Step 5: Commit**

```powershell
git add package.json tests/release-polish.test.js
git commit -m "chore: add windows release metadata"
```

## Task 3: Generate Windows ICO Asset

**Files:**
- Create: `scripts/create-windows-icon.mjs`
- Create: `assets/local-flow-icon.ico`
- Modify: `tests/release-polish.test.js`

- [ ] **Step 1: Write failing icon asset tests**

Add tests:

```js
test("Windows icon asset is a multi-image ICO file", async () => {
  const ico = await readFile(new URL("../assets/local-flow-icon.ico", import.meta.url));
  assert.equal(ico.toString("ascii", 0, 4), "\u0000\u0000\u0001\u0000");
  assert.ok(ico.readUInt16LE(4) >= 4);
  assert.ok(ico.length > 10_000);
});

test("Windows icon generator is checked in", async () => {
  const script = await readFile(new URL("../scripts/create-windows-icon.mjs", import.meta.url), "utf8");
  assert.match(script, /local-flow-icon\.ico/);
  assert.match(script, /writeIco/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/release-polish.test.js`

Expected: FAIL because the `.ico` and generator script do not exist.

- [ ] **Step 3: Implement deterministic icon generator**

Create `scripts/create-windows-icon.mjs` that writes `assets/local-flow-icon.ico` using uncompressed BGRA DIB icon entries for 16, 24, 32, 48, 64, 128, and 256 px sizes.

- [ ] **Step 4: Generate the icon**

Run: `node scripts/create-windows-icon.mjs`

Expected: `assets/local-flow-icon.ico` exists and is larger than 10 KB.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm.cmd test -- tests/release-polish.test.js`

Expected: PASS for icon asset checks.

- [ ] **Step 6: Commit**

```powershell
git add assets/local-flow-icon.ico scripts/create-windows-icon.mjs tests/release-polish.test.js
git commit -m "chore: add windows app icon"
```

## Task 4: Release Build Verification Script

**Files:**
- Create: `scripts/verify-release-build.mjs`
- Modify: `tests/release-polish.test.js`

- [ ] **Step 1: Write failing verifier tests**

Add tests:

```js
test("release verifier checks installer executable and icon config", async () => {
  const script = await readFile(new URL("../scripts/verify-release-build.mjs", import.meta.url), "utf8");
  assert.match(script, /Local Flow Setup 0\.1\.0\.exe/);
  assert.match(script, /dist\/win-unpacked\/Local Flow\.exe/);
  assert.match(script, /assets\/local-flow-icon\.ico/);
  assert.match(script, /git check-ignore/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/release-polish.test.js`

Expected: FAIL because verifier script does not exist.

- [ ] **Step 3: Implement verifier script**

The script should:

- read `package.json`;
- verify `build.win.icon` and NSIS icon fields point to `assets/local-flow-icon.ico`;
- check `assets/local-flow-icon.ico`;
- check `dist/Local Flow Setup 0.1.0.exe`;
- check `dist/win-unpacked/Local Flow.exe`;
- check `dist/win-unpacked/resources/app/assets/local-flow-icon.ico`;
- run `git check-ignore -q dist node_modules vendor/whisper vendor/llm`;
- print JSON with `"ok": true` when all checks pass.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- tests/release-polish.test.js`

Expected: PASS for verifier source checks.

- [ ] **Step 5: Commit**

```powershell
git add scripts/verify-release-build.mjs tests/release-polish.test.js
git commit -m "chore: add release build verifier"
```

## Task 5: Final Release Verification

**Files:**
- No new source files expected.

- [ ] **Step 1: Run all tests**

Run: `npm.cmd test`

Expected: all tests pass.

- [ ] **Step 2: Run app smoke**

Run: `npm.cmd run check:app`

Expected: JSON includes `"ok": true`.

- [ ] **Step 3: Run microphone smoke**

Run: `npm.cmd run check:microphone`

Expected: JSON includes `"ok": true` and at least one `audioinput` device.

- [ ] **Step 4: Build installer**

Run: `npm.cmd run dist:win`

Expected: command exits 0 and does not print `default Electron icon is used`.

- [ ] **Step 5: Verify release artifacts**

Run: `npm.cmd run verify:release`

Expected: JSON includes `"ok": true`.

- [ ] **Step 6: Confirm git state**

Run: `git status --short --branch`

Expected: branch is `codex/windows-release-polish-v1` with no tracked modifications. Ignored build directories may appear only with `git status --ignored`.

- [ ] **Step 7: Report installer paths**

Report:

- `dist/Local Flow Setup 0.1.0.exe`;
- `dist/win-unpacked/Local Flow.exe`;
- verification command results.
