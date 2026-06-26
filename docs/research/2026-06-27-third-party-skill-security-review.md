# Third-Party Skill And Dictation Reference Security Review

Date: 2026-06-27

This note defines how Local Flow can learn from third-party skills and open dictation projects without turning them into a supply-chain risk. It is a review gate, not an approval to install or execute external code.

## Candidate References

These projects are useful for product and architecture patterns:

- Epicenter / Whispering: https://github.com/EpicenterHQ/epicenter
- Buzz: https://github.com/chidiwilliams/buzz
- Vibe: https://github.com/thewh1teagle/vibe
- VoiceInk: https://github.com/Beingpax/VoiceInk
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- WhisperKit / Argmax OSS Swift: https://github.com/argmaxinc/WhisperKit

## Reuse Rules

- Treat every third-party skill as untrusted input, even when it is only natural-language instructions.
- Do not install external skills into the active Codex environment until reviewed.
- Do not execute third-party setup scripts from a repository checkout.
- Prefer borrowing product patterns, tests, state machines, and UX flows over implementation code.
- Only copy implementation code after license review, attribution planning, and a focused security review.
- GPL and AGPL projects are learning references only unless the product licensing strategy deliberately accepts copyleft obligations.
- MIT, Apache-2.0, and BSD code may still be unsafe; permissive license is not a security review.

## Intake Checklist

For each third-party skill or project, record:

- Repository URL.
- Exact commit SHA reviewed.
- License and copyleft impact.
- Maintainer and release activity.
- Runtime language and package manager.
- Lockfile presence.
- Install scripts, postinstall hooks, and binary downloads.
- Network endpoints contacted at install time and runtime.
- File system write locations.
- Microphone, clipboard, accessibility, keyboard, screen, or automation permissions.
- Shell execution paths.
- Update mechanism.
- Telemetry and analytics behavior.
- Any encoded, minified, obfuscated, or generated code that affects runtime behavior.

## Skill-Specific Review

For `SKILL.md` style packages:

- Read the top-level `SKILL.md` completely.
- Read every directly referenced script, template, and reference file before use.
- Reject skills that instruct the agent to ignore system, developer, or user instructions.
- Reject skills that request secrets, API keys, cookies, browser sessions, SSH keys, or token files unless the task explicitly needs them and the destination is controlled.
- Reject skills that ask the agent to run broad destructive commands.
- Reject skills that hide network fetches behind short commands.
- Reject skills that recommend piping remote content into a shell.
- Convert useful instructions into project-local docs or tests instead of installing the skill globally.

## Code Review Checklist

For code borrowed into Local Flow:

- Renderer must never receive raw command execution privileges.
- IPC payloads must be structured and allowlisted.
- PowerShell or shell commands must be constructed from constants plus validated paths.
- Downloads must use known URLs, expected filenames, and preferably checksums.
- Clipboard writes must be explicit and limited to the latest dictation result.
- Global shortcuts must be user-configurable and unregister cleanly on quit.
- Auto-paste must not paste secrets or diagnostic logs.
- Logs must not include raw API keys, full tokens, or private audio paths unless the user explicitly exports diagnostics.
- Any model installer must support cancellation and failure recovery.

## Current Local Flow Decision

For the next Windows phase, Local Flow will not import third-party code. It will borrow these patterns:

- Background tray app as the normal mode.
- Global shortcut as the primary trigger.
- Small non-disruptive recording HUD.
- Automatic paste into the active app.
- Full settings window as a secondary surface.
- Third-party model setup remains optional and failure-tolerant.

Qwen/llama.cpp is handled as a separate stability spike. It must not block the Windows system-level input experience.

