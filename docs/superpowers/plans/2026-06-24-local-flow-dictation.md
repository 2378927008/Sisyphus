# Local Flow Dictation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop MVP for local-first voice dictation without requiring an OpenAI API key.

**Architecture:** Electron owns tray, global hotkey, clipboard, settings, history, and local process orchestration. The renderer records microphone audio, encodes WAV, and sends it to the main process. Speech-to-text uses a configured `whisper.cpp` executable, and text cleanup uses Ollama when enabled with a deterministic local fallback.

**Tech Stack:** Electron 38, plain HTML/CSS/JavaScript, Node test runner, whisper.cpp CLI, optional Ollama.

---

### Task 1: Project Shell

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`

- [x] Add npm scripts for `start` and `test`.
- [x] Ignore local dependencies, build output, and env files.
- [x] Document local model setup and the `npm.cmd` PowerShell workaround.

### Task 2: Testable Local Pipeline Modules

**Files:**
- Create: `src/shared/text-cleanup.js`
- Create: `src/main/local-asr.js`
- Create: `src/main/settings-store.js`
- Create: `src/main/paste.js`
- Create: `tests/*.test.js`

- [x] Write failing tests for cleanup, Whisper output parsing, settings merging, and paste command construction.
- [x] Implement the smallest modules needed to pass those tests.

### Task 3: Electron Runtime

**Files:**
- Create: `src/main/index.js`
- Create: `src/main/dictation-service.js`
- Create: `src/main/local-llm.js`
- Create: `src/preload.js`

- [x] Create the main window, tray menu, global shortcut, IPC handlers, settings persistence, and dictation orchestration.
- [x] Call `whisper.cpp` locally and optionally call Ollama at `localhost`.
- [x] Paste polished text to the active app with the Windows clipboard and SendKeys.

### Task 4: Recorder UI

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/app.js`
- Create: `src/renderer/styles.css`

- [x] Build the first-screen desktop control surface.
- [x] Record microphone audio, encode 16 kHz mono WAV, and send it to the main process.
- [x] Add settings and local history views.

### Task 5: Verification

**Files:**
- Use: `package.json`
- Create: `scripts/setup-whisper.ps1`

- [ ] Run `npm.cmd test` and confirm all tests pass.
- [ ] Run `npm.cmd install` if Electron is not installed.
- [ ] Start the app with `npm.cmd start` and verify it opens.
- [ ] Run `powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-whisper.ps1 -Model base` to install local whisper.cpp assets.
