# UI V2 and Embedded LLM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the engineering-style home screen with a usable dictation product interface and add an embedded local language model setup path based on Qwen3-4B-GGUF.

**Architecture:** Keep speech recognition on whisper.cpp. Add an embedded LLM asset detector and setup script for llama.cpp plus Qwen3-4B-GGUF, expose model status over IPC, and move advanced configuration into a settings drawer.

**Tech Stack:** Electron, Node.js ESM/CommonJS preload, node:test, PowerShell setup scripts, whisper.cpp, llama.cpp, Qwen3-4B-GGUF.

---

### Task 1: Embedded LLM Assets

**Files:**
- Create: `src/main/embedded-llm-assets.js`
- Create: `tests/embedded-llm-assets.test.js`
- Create: `scripts/setup-llm.ps1`
- Modify: `src/main/settings-store.js`
- Modify: `src/main/index.js`
- Modify: `src/preload.cjs`

- [ ] Add metadata for `Qwen/Qwen3-4B-GGUF`, `Qwen3-4B-Q4_K_M.gguf`, Apache 2.0, and approximate 2.5GB size.
- [ ] Detect `vendor/llm/bin/llama-cli.exe`, `vendor/llm/bin/llama-server.exe`, and `vendor/llm/models/Qwen3-4B-Q4_K_M.gguf`.
- [ ] Expose `llm:status` IPC and `window.localFlow.getLocalModelStatus()`.
- [ ] Add a setup script that downloads llama.cpp Windows binaries from the latest GitHub release and the Qwen3-4B GGUF model from Hugging Face.

### Task 2: Embedded LLM Runtime Hook

**Files:**
- Modify: `src/main/local-llm.js`
- Test: `tests/local-llm.test.js`

- [ ] Add a local `llama-cli` code path when embedded LLM paths are configured.
- [ ] Keep Ollama as an advanced fallback.
- [ ] If target output language requires an LLM and neither embedded model nor Ollama is ready, return a clear install message.

### Task 3: UI V2

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/i18n.js`
- Modify: `scripts/electron-app-smoke.mjs`

- [ ] Make the first screen a focused dictation workspace with a large record button, language strip, editable result area, and recent history.
- [ ] Move model paths, diagnostics, Ollama, dictionary, and advanced settings into a drawer.
- [ ] Show built-in local language model status and setup command in the drawer.
- [ ] Keep all existing IDs needed by tests and IPC.

### Task 4: Verification

**Files:**
- Existing tests and scripts.

- [ ] Run `npm.cmd test`.
- [ ] Run syntax checks for all non-vendor JS/MJS/CJS files.
- [ ] Run `npm.cmd run check:microphone`.
- [ ] Run `npm.cmd run check:app`.
