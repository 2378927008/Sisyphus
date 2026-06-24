# Language Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate interface language, speech recognition language, and output language controls to the local-first dictation app.

**Architecture:** Store language preferences in the existing settings store. Keep language metadata and UI translations in focused shared modules, and route output translation through the existing local Ollama cleanup path.

**Tech Stack:** Electron, Node.js ESM, node:test, whisper.cpp, optional Ollama.

---

### Task 1: Settings Schema

**Files:**
- Modify: `src/main/settings-store.js`
- Test: `tests/settings-store.test.js`

- [ ] Add `interfaceLanguage`, `outputLanguage`, and normalized supported value lists.
- [ ] Write tests that assert defaults are Simplified Chinese, Auto recognition, and Keep original output.
- [ ] Write tests that invalid language values fall back to defaults.
- [ ] Run `npm.cmd test -- tests/settings-store.test.js`.

### Task 2: Output Language Prompting

**Files:**
- Modify: `src/shared/text-cleanup.js`
- Modify: `src/main/local-llm.js`
- Test: `tests/text-cleanup.test.js`

- [ ] Add output language names and `buildOutputPrompt`.
- [ ] Write tests that Keep original preserves the existing polish prompt.
- [ ] Write tests that Simplified Chinese and Spanish output prompts ask for final text only.
- [ ] Make `polishTranscript` require Ollama for target-language output and throw a clear error when disabled.
- [ ] Run `npm.cmd test -- tests/text-cleanup.test.js`.

### Task 3: Renderer i18n

**Files:**
- Create: `src/shared/languages.js`
- Create: `src/renderer/i18n.js`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`
- Test: `scripts/electron-app-smoke.mjs`

- [ ] Add UI translations for English, Simplified Chinese, Japanese, Korean, Traditional Chinese, French, Russian, and Spanish.
- [ ] Replace hardcoded visible UI strings with `data-i18n` keys and runtime text updates.
- [ ] Add settings controls for interface language and output language.
- [ ] Keep speech recognition language as a separate control.
- [ ] Update the Electron smoke test to assert Simplified Chinese default UI and working recording flow.

### Task 4: Verification

**Files:**
- Existing tests and smoke scripts.

- [ ] Run `npm.cmd test`.
- [ ] Run JS syntax checks for all non-vendor JS/MJS/CJS files.
- [ ] Run `npm.cmd run check:microphone`.
- [ ] Run `npm.cmd run check:app`.
