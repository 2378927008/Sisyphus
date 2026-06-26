# OSS Skills And Dictation Patterns

Date: 2026-06-26

This note captures reusable patterns from open skill ecosystems and open-source dictation stacks. It is a reference for Local Flow development, not a list of third-party skills to install blindly.

## Source Set

- Anthropic `skills`: https://github.com/anthropics/skills
- Awesome Skills for LLMs: https://github.com/scienceaix/agentskills
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- Argmax OSS Swift / WhisperKit: https://github.com/argmaxinc/argmax-oss-swift
- Wispr Flow product references: https://en.wikipedia.org/wiki/Wispr_Flow
- Skill supply-chain risk reference: https://arxiv.org/abs/2605.11418

## What To Borrow From Skill Ecosystems

- Treat a reusable workflow as a small package: `SKILL.md` instructions first, optional scripts/resources second.
- Use progressive disclosure: put routing and core rules in the top-level skill, then load detailed references only when needed.
- Make every useful skill testable. A skill that suggests commands or code should include verification commands and expected failure modes.
- Prefer project-local notes over global installs when the workflow is specific to this app.
- Review third-party skills as untrusted code. Do not install or execute them just because they are popular.

## What To Borrow From Dictation Products

- The product is an input layer, not a translator. Default output should preserve the spoken language.
- The core loop should be one action: record, transcribe, clean up, paste or copy.
- Results must remain editable because dictation is probabilistic.
- App-wide input matters more than a standalone recorder. Windows needs reliable paste/global shortcut behavior; iPhone should prioritize a keyboard-extension-style flow.
- Setup should explain the active path. If the default provider is MyMemory Free, Qwen should appear optional rather than required.

## What To Borrow From Open ASR Projects

- `whisper.cpp` remains a strong Windows baseline because it is MIT licensed, local, and has CLI/examples that match this Electron app.
- `whisper.cpp` examples include CLI transcription, streaming microphone transcription, voice commands, server mode, and WebAssembly. These are useful references for future real-time transcription and local server modes.
- WhisperKit / Argmax OSS Swift is the most relevant iPhone/iOS path because it is Swift-native, MIT licensed, uses Swift Package Manager, and targets on-device speech AI on Apple silicon.
- For iPhone priority, evaluate WhisperKit and Apple Speech side by side:
  - Apple Speech: easiest system integration, no model bundling, but OS/API limits may apply.
  - WhisperKit: stronger local-first story, but larger model/download/on-device performance work.

## Current Local Flow Decisions

- Windows MVP stays on Electron + local `whisper.cpp` for ASR.
- Text output stays free-first:
  - `Auto` output preserves the source language and uses local cleanup.
  - Selected target output uses MyMemory Free by default.
  - Qwen/llama.cpp remains optional until runtime stability is proven on this machine.
- Do not make OpenAI API a default path. It can remain an optional provider later, but it is paid usage and does not match the multi-user free-first goal.

## Near-Term Backlog Candidates

- Add a project-local `docs/research/open-source-dictation-alternatives.md` comparing Spokenly, MacParakeet, VoiceInk, OpenWhispr, and other actively maintained projects before copying product patterns.
- Add an iPhone architecture spike:
  - SwiftUI host app.
  - Keyboard extension or share-sheet input path.
  - Apple Speech first-pass implementation.
  - WhisperKit offline path as optional model package.
- Add a Windows real-time transcription spike using `whisper.cpp` streaming examples.
- Add a small in-repo "development skill" for Local Flow once the workflow stabilizes:
  - setup verification commands,
  - microphone permission checklist,
  - ASR/text-provider regression checks,
  - packaging smoke tests.

## Safety Rules For Third-Party Skills

- Do not install third-party skills directly into the active Codex environment without reviewing `SKILL.md`, scripts, dependencies, and network/file-system behavior.
- Prefer copying ideas into repo docs or tests over executing unknown scripts.
- Any adopted skill should be project-local, versioned, and covered by a smoke test or checklist.
- Treat natural-language skill descriptions as executable influence: a malicious `SKILL.md` can steer tool choice and commands even without code.
