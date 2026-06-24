# Local Flow Dictation

Local-first Windows voice dictation MVP inspired by Typeless and Wispr Flow. It does not require an OpenAI API key.

## What Works

- Electron desktop app for Windows.
- Global shortcut: `Ctrl + Alt + Space`.
- Microphone recording in the app window.
- WAV encoding in the renderer.
- Local `whisper.cpp` command integration for speech-to-text.
- Optional Ollama local model cleanup.
- Interface language, speech recognition language, and output language settings.
- UI v2 dictation workspace with advanced settings moved into a drawer.
- Built-in local language model setup path for Qwen3-4B-GGUF through llama.cpp.
- Fallback local cleanup that removes common filler words.
- Clipboard paste into the active Windows app.
- Local settings and history under Electron user data.

## Requirements

- Node.js and npm.
- A built `whisper.cpp` executable, usually `whisper-cli.exe`.
- A Whisper model file, for example `ggml-small.bin`.
- Optional: Ollama running locally as an advanced fallback for text cleanup.

## Run

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm.cmd install
npm.cmd start
```

PowerShell may block `npm.ps1` on this machine, so use `npm.cmd`.
The mirror line is optional outside China, but it avoids slow Electron downloads on this workstation.
The start script passes conservative Electron flags for restricted Windows sessions where GPU or Chromium sandbox startup fails.

## Diagnostics

Run the microphone smoke test:

```powershell
npm.cmd run check:microphone
```

Run the app UI smoke test:

```powershell
npm.cmd run check:app
```

If microphone smoke passes but recording still fails in the app, click `检查麦克风` in the app and restart the app. If it fails with permission denied, open Windows Settings > Privacy & security > Microphone and enable microphone access for desktop apps.

Run automated tests:

```powershell
npm.cmd test
```

## Local Model Setup

In the app settings, set:

- `界面语言`: controls app UI text. Default is `简体中文`.
- `语音识别语言`: controls the language passed to Whisper. Default is `自动`.
- `输出语言`: controls final displayed/saved/pasted text. Default is `自动（同语音）`.
- `whisper.cpp 可执行文件`: full path to `whisper-cli.exe`.
- `Whisper 模型文件`: full path to a `.bin` model file.
- `Ollama`: optional advanced fallback. The recommended default path is the built-in Qwen3 local model. If you use Ollama, set a model such as `qwen3:4b`.

## Built-in Local Language Model

The app recommends `Qwen/Qwen3-4B-GGUF` with `Q4_K_M` quantization for local cleanup and translation.

- License: Apache 2.0.
- Approximate model size: 2.5 GB.
- Model file: `Qwen3-4B-Q4_K_M.gguf`.
- Install location: `vendor/llm`.

Run the setup script when you are ready to download the runtime and model:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-llm.ps1
```

The script downloads llama.cpp Windows binaries from the latest GitHub release and the Qwen3 GGUF model from Hugging Face. The app detects the installed files on next start.

The app stores settings locally and never sends audio or text to OpenAI.

You can download the Windows x64 whisper.cpp build and a multilingual model into `vendor/whisper`:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-whisper.ps1 -Model base
```

After it finishes, copy the printed executable and model paths into the app settings and click `检查本地 Whisper`.
