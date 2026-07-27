# Local Flow Dictation

Local-first Windows voice dictation app inspired by Typeless and Wispr Flow. It does not require an OpenAI API key.

## What Works

- Electron desktop app for Windows.
- Global shortcut: `Ctrl + Alt + Space`.
- Shortcut behavior can be set to toggle or hold-to-dictate. Hold mode uses the native input hook when available, and falls back to toggle behavior if native release events cannot be loaded.
- Paste last result shortcut: `Ctrl + Alt + V` by default.
- Background tray mode: closing the main window keeps Local Flow running.
- Tray actions for showing the app, starting/stopping dictation, pausing the shortcut, launch-at-login, start-minimized, settings, and quit.
- Microphone recording in the app window.
- WAV encoding in the renderer.
- Local `whisper.cpp` command integration for speech-to-text.
- Interface language, speech recognition language, and output language settings.
- UI v2 dictation workspace with advanced settings moved into a drawer.
- Free-first text output path: automatic output keeps the spoken language locally; selected target-language output can use MyMemory Free.
- Built-in local language model setup path for Qwen3-4B-GGUF through llama.cpp.
- Optional Ollama local model cleanup.
- Fallback local cleanup that removes common filler words.
- Clipboard paste into the active Windows app.
- Local settings and history under Electron user data.

## Requirements

- Node.js and npm for source/development runs.
- A built `whisper.cpp` executable, usually `whisper-cli.exe`.
- A Whisper model file, for example `ggml-base.bin` or `ggml-small.bin`.
- Optional: internet access for MyMemory Free when a target output language is selected.
- Optional: Ollama or the built-in Qwen3 local model as advanced fallbacks for text cleanup.

## Run From Source

Recommended on Windows:

```powershell
.\Start-LocalFlow.cmd
```

The launcher switches into this project folder and starts the app first. If the Electron runtime is missing, it falls back to dependency installation and starts again. Use it if `npm` reports that it cannot find `package.json`.

Manual command-line startup:

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm.cmd install
npm.cmd start
```

PowerShell may block `npm.ps1` on this machine, so use `npm.cmd`. The mirror line is optional outside China, but it avoids slow Electron downloads on this workstation.

## Windows Installable Build

Local Flow can be packaged as a Windows installer with electron-builder.

```powershell
npm.cmd install
npm.cmd run dist:win
```

Installer output is written to `dist/`. The generated installer is a build artifact and is not committed to git.

For a faster local packaging smoke test, run:

```powershell
npm.cmd run package:win
```

## Windows 安装包试用

如果只是试用产品，不需要从源码启动。直接运行安装包：

```powershell
.\dist\Local Flow Setup 0.1.0.exe
```

安装后首次启动会显示主窗口，方便检查模型和麦克风状态。建议保持默认设置：

- `界面语言`: 简体中文。
- `语音识别语言`: 自动。
- `输出语言`: 自动（同语音）。
- `文本模型提供方`: MyMemory Free。

Local Flow 是语音输入软件，不是默认翻译软件。输出语言为 `自动（同语音）` 时，你说中文就输出中文，你说英文就输出英文。只有主动选择某个目标输出语言时，才会尝试把结果转换成目标语言。

录音前必须配置 Whisper 语音模型。如果首页的 `开始录音` 按钮不可用，先点击 `安装 Whisper`，或在设置抽屉里填写 `whisper.cpp 可执行文件` 和 `Whisper 模型文件`。Qwen3 是可选的本地文本模型，不是录音必需项；默认试用可以先不安装 Qwen。

Windows 安装包已内置经过校验的 llama.cpp 运行时，因此安装 Qwen 时通常只需下载约 2.5 GB 的模型文件，不再查询 GitHub 发布信息。若 Whisper 或 Qwen 模型下载失败，打开 `设置` > `模型下载源`，填入可直连的主下载地址或备用镜像地址后重试；多个备用地址可用分号或换行分隔。

## Startup And Tray Behavior

The installed app keeps running from the tray when the main window is closed. Use the tray menu to show Local Flow, start or stop dictation, pause or resume the global shortcut, toggle launch at login, toggle start minimized to tray, open settings, or quit.

Launch at login is off by default. Enable it from Settings or the tray menu. Start minimized to tray is also off by default so first-run setup remains visible.

If the global shortcut conflicts with another app, Local Flow shows a hotkey error in the main status/HUD. Use the tray menu or Settings to pause the shortcut, change the shortcut, then resume.

## Desktop Convenience

Open `设置` > `快捷键` to tune the desktop input loop:

- `全局快捷键`: starts/stops dictation. Default: `Ctrl + Alt + Space`.
- `语音输入快捷键行为`: choose press-to-toggle or hold-to-dictate. Hold mode uses the native input hook when available; if the native hook cannot load, Local Flow falls back to toggle mode with a warning.
- `粘贴上一段结果快捷键`: pastes the last successful dictation again. Default: `Ctrl + Alt + V`.
- Mouse side button: enter `Mouse4` or `Mouse5` directly as the global dictation shortcut. If native input hook loading fails on a machine, map the side button to the keyboard shortcut in your mouse driver, PowerToys, or device software.

## 中文试用步骤

在项目文件夹中打开 PowerShell：

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-06-24\typeless-wisper-flow-windows-iphone-github
.\Start-LocalFlow.cmd
```

试用时建议先保持默认设置：

- `界面语言`: 简体中文。
- `语音识别语言`: 自动。
- `输出语言`: 自动（同语音）。
- `文本模型提供方`: MyMemory Free。

Local Flow 是语音输入软件，不是默认翻译软件。你说中文就输出中文，你说英文就输出英文。只有主动选择某个目标输出语言时，才会尝试把结果转换成目标语言。

如果 `开始录音` 按钮不可用，通常先处理 Whisper 语音模型：

1. 点击首页的 `安装 Whisper`，或在设置抽屉里填写 `whisper.cpp 可执行文件` 和 `Whisper 模型文件`。
2. 点击 `检查麦克风`，确认 Windows 已允许桌面应用访问麦克风。
3. 点击 `刷新安装状态`，再回到首页录音。

Qwen3 是可选的本地文本模型，不是录音必需项。默认试用可以先不安装 Qwen；如果 Qwen 安装卡住，可以点 `取消安装`，继续使用 Whisper + MyMemory Free/本地清理路径。

## Diagnostics

Run the microphone smoke test:

```powershell
npm.cmd run check:microphone
```

Run the app UI smoke test:

```powershell
npm.cmd run check:app
```

Run automated tests:

```powershell
npm.cmd test
```

If microphone smoke passes but recording still fails in the app, click `检查麦克风` in the app and restart the app. If it fails with permission denied, open Windows Settings > Privacy & security > Microphone and enable microphone access for desktop apps.

## Local Model Setup

In the app settings:

- `界面语言`: controls app UI text. Default is `简体中文`.
- `语音识别语言`: controls the language passed to Whisper. Default is `自动`.
- `输出语言`: controls final displayed/saved/pasted text. Default is `自动（同语音）`.
- `whisper.cpp 可执行文件`: full path to `whisper-cli.exe`.
- `Whisper 模型文件`: full path to a `.bin` model file.
- `文本模型提供方`: defaults to `MyMemory Free`. With `输出语言=自动`, the app keeps the spoken language and uses local cleanup. When a target output language is selected, MyMemory Free is used for target-language output.
- `Ollama` / `内置 Qwen3`: optional advanced fallbacks. If you use Ollama, set a model such as `qwen3:4b`.
- `模型下载源`: optional direct-download URLs for Whisper, llama.cpp, and Qwen. Leave blank for the official defaults; use it only when GitHub or Hugging Face downloads fail.

You can download the Windows x64 whisper.cpp build and a multilingual model into `vendor/whisper`:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-whisper.ps1 -Model base
```

After it finishes, click `刷新安装状态` or copy the printed executable and model paths into the app settings and click `检查本地 Whisper`.

If GitHub or Hugging Face is too slow in your network, configure `设置` > `模型下载源` before clicking `安装 Whisper`, or pass direct-download mirrors to the script:

```powershell
$env:LOCAL_FLOW_WHISPER_RUNTIME_URL='https://your-mirror.example/whisper-bin-x64.zip'
$env:LOCAL_FLOW_WHISPER_RUNTIME_MIRROR_URLS='https://backup.example/whisper-bin-x64.zip'
$env:LOCAL_FLOW_WHISPER_MODEL_URL='https://your-mirror.example/ggml-base.bin'
$env:LOCAL_FLOW_WHISPER_MODEL_MIRROR_URLS='https://backup.example/ggml-base.bin'
powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-whisper.ps1 -Model base
```

## Optional Built-in Local Language Model

The default path does not require Qwen. The app still includes an optional local model path for users who want offline cleanup or target-language output without MyMemory. It recommends `Qwen/Qwen3-4B-GGUF` with `Q4_K_M` quantization.

- License: Apache 2.0.
- Approximate model size: 2.5 GB.
- Model file: `Qwen3-4B-Q4_K_M.gguf`.
- Pinned model revision: `bc640142c66e1fdd12af0bd68f40445458f3869b`.
- Verified model SHA-256: `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`.
- Install location: `vendor/llm`.

Run the setup script when you are ready to download the runtime and model:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-llm.ps1
```

The Windows installer bundles the verified llama.cpp `b9049` CPU runtime. Source checkouts download that pinned runtime only when it is missing. The setup script downloads the Qwen model from a pinned Hugging Face revision, tries the reachable mirror before the main site, and verifies both archives with SHA-256. The app detects installed files on next start or after `刷新安装状态`.

If GitHub or Hugging Face is too slow in your network, configure `设置` > `模型下载源` before clicking `安装 Qwen`, or point the installer at your own direct-download mirrors before running the script. These URLs should serve the same llama.cpp Windows zip or `Qwen3-4B-Q4_K_M.gguf` file:

```powershell
$env:LOCAL_FLOW_LLAMA_RUNTIME_URL='https://your-mirror.example/llama-bin-win-cpu-x64.zip'
$env:LOCAL_FLOW_LLAMA_RUNTIME_MIRROR_URLS='https://backup.example/llama-bin-win-cpu-x64.zip'
$env:LOCAL_FLOW_QWEN_MODEL_URL='https://your-mirror.example/Qwen3-4B-Q4_K_M.gguf'
$env:LOCAL_FLOW_QWEN_MODEL_MIRROR_URLS='https://backup.example/Qwen3-4B-Q4_K_M.gguf'
powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-llm.ps1
```

`LOCAL_FLOW_LLAMA_RUNTIME_URL` and `LOCAL_FLOW_QWEN_MODEL_URL` replace the default primary source. The `*_MIRROR_URLS` variables add fallback sources; separate multiple URLs with semicolons or new lines. This is intended for company mirrors, local HTTP caches, or a self-hosted copy of the official files.

The app stores settings locally and never sends audio or text to OpenAI.
