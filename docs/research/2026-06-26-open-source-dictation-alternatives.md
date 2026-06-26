# Open Source Dictation Alternatives

Date: 2026-06-26

This note compares open-source dictation projects that can inform Local Flow. It is based on read-only GitHub API searches on 2026-06-26:

- `dictation whisper.cpp`
- `WhisperKit iOS dictation`
- `Swift Speech dictation app`
- `iOS keyboard speech to text open source`

The goal is not to copy code. The goal is to identify proven product and architecture patterns for a Typeless/Wispr Flow-style input product on Windows and iPhone.

## Evaluation Criteria

- Platform fit: Windows, iPhone, or transferable desktop input patterns.
- Input-layer fit: can type into other apps, not just transcribe files.
- ASR fit: local/offline first, with a free path for multiple users.
- License fit: permissive licenses are easier to reuse; GPL projects are learning references only unless we accept GPL obligations.
- Maintenance signal: recent updates or pushes in 2026.
- Product pattern fit: push-to-talk, hold-to-talk, global shortcut, keyboard extension, editable output, setup diagnostics.

## High-Signal Projects

| Project | Platform | License | Signal | What to borrow | Caution |
| --- | --- | --- | --- | --- | --- |
| [jatinkrmalik/vocalinux](https://github.com/jatinkrmalik/vocalinux) | Linux | GPL-3.0 | 393 stars, updated 2026-06-25 | Multi-engine offline dictation, setup flow, X11/Wayland insertion thinking, Vosk fallback | GPL code should not be copied into this app unless we deliberately choose GPL compatibility |
| [QuantiusBenignus/blurt](https://github.com/QuantiusBenignus/blurt) | GNOME/Linux | GPL-3.0 | 107 stars, updated 2026-06-20 | "Input anywhere" positioning, shell-extension integration, minimal always-available UX | Linux/GNOME-specific and GPL |
| [cjams/whispertux](https://github.com/cjams/whispertux) | Linux | MIT | 77 stars, updated 2026-06-22 | Simple GUI around whisper.cpp; useful for low-friction model/setup ideas | Linux-only, narrower product surface |
| [watzon/pindrop](https://github.com/watzon/pindrop) | macOS | MIT | 541 stars, updated 2026-06-21 | Native menu-bar dictation, WhisperKit-based local STT, privacy-first positioning | macOS only, not an iPhone keyboard |
| [vlr-code/dictly](https://github.com/vlr-code/dictly) | macOS | MIT | 39 stars, updated 2026-06-15 | Hold hotkey, local transcription, auto-paste into focused app, explicit Wispr Flow alternative framing | macOS APIs do not map directly to Windows/iOS |
| [getdictus/dictus-ios](https://github.com/getdictus/dictus-ios) | iOS | MIT | 12 stars, updated 2026-06-19 | iOS keyboard-extension direction, offline dictation, WhisperKit/CoreML stack | Small/new project; needs source review before borrowing implementation ideas |
| [thepraggyverse/whisprlocal](https://github.com/thepraggyverse/whisprlocal) | iOS | MIT | Updated 2026-06-22 | iOS app + keyboard, WhisperKit + MLX direction, zero-cloud positioning | Very small project; verify build quality first |
| [andyhtran/MiniWhisper](https://github.com/andyhtran/MiniWhisper) | macOS | MIT | 21 stars, updated 2026-06-24 | Minimal menu-bar UX, Parakeet/whisper.cpp comparison, small app architecture | macOS only |

## Secondary References

- [VasenevEA/FastWord](https://github.com/VasenevEA/FastWord): macOS hold-to-talk flow and bundled model idea. License was not declared in the GitHub API result, so treat as product-reference only.
- [luisalima/local-whisper](https://github.com/luisalima/local-whisper): macOS local dictation with voice commands. Useful for command-mode thinking.
- [jacopone/whisper-dictation](https://github.com/jacopone/whisper-dictation): NixOS/GNOME push-to-talk and real-time feedback reference.
- [Spuddy10345/whisper-raycast-extension](https://github.com/Spuddy10345/whisper-raycast-extension): Raycast extension pattern with local STT plus optional LLM cleanup. License not declared in the API result.
- [beausterling/CustomWispr](https://github.com/beausterling/CustomWispr): macOS hold-fn-to-talk pattern with post-processing, but it depends on OpenAI/GPT and is therefore not a default-path model for Local Flow.

## Patterns To Adopt

- Keep the product framed as input, not translation.
- Use push-to-talk or hold-to-talk as a first-class workflow, not only a start/stop button.
- Show the active ASR/text provider path before recording.
- Make diagnostics part of onboarding: microphone, ASR runtime/model, text provider, paste permission.
- Keep output editable and copyable before paste.
- Prefer provider abstraction early because real projects commonly support multiple STT/text cleanup engines.
- Treat app-wide insertion as core product behavior. The transcription box is a fallback, not the destination.
- For offline paths, separate model download from app startup and expose exact model/runtime status.

## iPhone Priority Recommendation

Use a two-track iPhone plan:

1. Apple Speech prototype first.
   - Fastest path to a working iPhone dictation UX.
   - Avoids bundling a large model at first.
   - Good for validating keyboard-extension constraints and user flow.

2. WhisperKit prototype second.
   - Stronger free/offline privacy story.
   - Better aligned with multi-user cost control.
   - Requires careful model packaging, first-run download, thermal/performance testing, and keyboard-extension limitations review.

The likely product shape is:

- SwiftUI host app for settings, onboarding, model/provider checks, and history.
- Keyboard extension for typing into other apps.
- Shared settings container between host app and extension.
- Apple Speech as the first implementation path.
- WhisperKit as optional offline mode after performance validation.

## Windows Recommendation

Stay with Electron for the MVP, but borrow these patterns:

- Add hold-to-talk/global shortcut mode in addition to click-to-start.
- Keep `whisper.cpp` as the local baseline.
- Add optional streaming/partial transcription after the basic end-to-end flow is stable.
- Keep text provider diagnostics and setup status visible because local model installation is fragile.
- Defer llama.cpp/Qwen as optional until runtime stability is solved on Windows.

## Reuse Boundaries

- Do not copy GPL implementation code into Local Flow unless the whole licensing strategy is reconsidered.
- Do not run third-party setup scripts or skills during development without reviewing them first.
- Prefer borrowing product patterns, test cases, and architecture ideas over implementation files.
- Any borrowed code path needs a local smoke test before it is considered part of the product.

## Next Actions

- Create an iPhone architecture spec using Apple Speech first and WhisperKit second.
- Add a Windows hold-to-talk design note and implementation plan.
- Add a small in-repo Local Flow development skill only after the current diagnostics and smoke tests stabilize.
