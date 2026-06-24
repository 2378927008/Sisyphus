# Windows Provider and Recording Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the Windows dictation MVP by adding a provider abstraction, preserving raw transcripts on text-processing failures, making Auto output language behave predictably, and explaining disabled recording states.

**Architecture:** Keep the current Electron app and local Whisper path. Add small focused modules for provider resolution, language detection, and record readiness instead of expanding `dictation-service.js` or `app.js` with more conditional logic. Cloud providers are represented as disabled descriptors in this phase, so the UI and pipeline are ready for the Cloudflare/Groq provider implementation phase without making network calls yet.

**Tech Stack:** Electron, Node.js ESM/CommonJS preload, node:test, local whisper.cpp, embedded llama.cpp/Ollama optional text processing.

---

## File Structure

- Create `src/main/provider-registry.js`: normalizes speech and text provider settings, reports active processing mode, and blocks unsupported cloud provider selection with explicit messages.
- Create `tests/provider-registry.test.js`: covers provider defaults, local/system/cloud mode reporting, and unsupported provider handling.
- Create `tests/dictation-service.test.js`: covers service orchestration, partial-result behavior, and paste safety when cleanup fails.
- Create `src/shared/language-detection.js`: lightweight local script-based language detection used for history metadata and Auto output visibility.
- Create `tests/language-detection.test.js`: covers Chinese, Japanese, Korean, Cyrillic/Russian, Latin/English, Spanish/French hints, and unknown text.
- Create `src/renderer/record-readiness.js`: browser-safe helper that explains why the record button should be enabled or disabled.
- Create `tests/record-readiness.test.js`: covers missing media APIs, missing Whisper paths, provider readiness, and ready state.
- Modify `src/main/settings-store.js`: add provider settings with safe defaults.
- Modify `src/main/dictation-service.js`: inject provider resolution, add detected language metadata, and preserve raw transcript if cleanup/translation fails.
- Modify `src/main/index.js`: expose provider status over IPC.
- Modify `src/preload.cjs`: expose provider status to renderer.
- Modify `src/renderer/app.js`: apply record readiness state and show provider mode/status in the existing status line.
- Modify `src/renderer/index.html`: add a compact provider status element near the record control.
- Modify `src/renderer/i18n.js`: add localized status labels and disabled-record reasons.

## Task 1: Provider Registry

**Files:**
- Create: `src/main/provider-registry.js`
- Create: `tests/provider-registry.test.js`
- Modify: `src/main/settings-store.js`

- [ ] **Step 1: Write provider registry tests**

Create `tests/provider-registry.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  getProcessingProviderStatus,
  normalizeAsrProvider,
  normalizeTextProvider
} from "../src/main/provider-registry.js";

test("normalizeAsrProvider defaults to localWhisper on Windows", () => {
  assert.equal(normalizeAsrProvider(""), "localWhisper");
  assert.equal(normalizeAsrProvider("localWhisper"), "localWhisper");
  assert.equal(normalizeAsrProvider("cloudflareWorkersAi"), "cloudflareWorkersAi");
  assert.equal(normalizeAsrProvider("unknown"), "localWhisper");
});

test("normalizeTextProvider keeps embedded and ollama providers", () => {
  assert.equal(normalizeTextProvider(""), "embedded");
  assert.equal(normalizeTextProvider("embedded"), "embedded");
  assert.equal(normalizeTextProvider("ollama"), "ollama");
  assert.equal(normalizeTextProvider("groq"), "groq");
  assert.equal(normalizeTextProvider("bad"), "embedded");
});

test("getProcessingProviderStatus reports local mode when Whisper is configured", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "localWhisper",
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin",
    llmProvider: "embedded",
    embeddedLlmCliPath: "C:/tools/llama-cli.exe",
    embeddedLlmModelPath: "C:/models/qwen.gguf"
  });

  assert.equal(status.mode, "local");
  assert.equal(status.asr.ready, true);
  assert.equal(status.text.ready, true);
  assert.equal(status.readyToRecord, true);
});

test("getProcessingProviderStatus explains missing local Whisper setup", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "localWhisper",
    whisperCliPath: "",
    whisperModelPath: "",
    llmProvider: "embedded"
  });

  assert.equal(status.mode, "local");
  assert.equal(status.asr.ready, false);
  assert.equal(status.readyToRecord, false);
  assert.equal(status.recordingBlockedReason, "whisper_not_configured");
});

test("getProcessingProviderStatus reports cloud providers as not configured in Phase 1", () => {
  const status = getProcessingProviderStatus({
    asrProvider: "groq",
    cloudApiKey: "",
    llmProvider: "groq"
  });

  assert.equal(status.mode, "cloud");
  assert.equal(status.asr.ready, false);
  assert.equal(status.text.ready, false);
  assert.equal(status.recordingBlockedReason, "cloud_provider_not_configured");
});
```

- [ ] **Step 2: Run provider registry tests and verify they fail**

Run:

```powershell
npm.cmd test -- tests/provider-registry.test.js
```

Expected: FAIL with `Cannot find module '../src/main/provider-registry.js'`.

- [ ] **Step 3: Implement provider registry**

Create `src/main/provider-registry.js`:

```js
const asrProviders = new Set(["localWhisper", "appleSpeech", "cloudflareWorkersAi", "groq", "customOpenAiCompatible"]);
const textProviders = new Set(["embedded", "ollama", "cloudflareWorkersAi", "groq", "customOpenAiCompatible"]);

export function normalizeAsrProvider(value) {
  const provider = String(value || "").trim();
  return asrProviders.has(provider) ? provider : "localWhisper";
}

export function normalizeTextProvider(value) {
  const provider = String(value || "").trim();
  return textProviders.has(provider) ? provider : "embedded";
}

export function getProcessingProviderStatus(settings = {}) {
  const asrProvider = normalizeAsrProvider(settings.asrProvider);
  const textProvider = normalizeTextProvider(settings.llmProvider);
  const mode = getMode(asrProvider, textProvider);
  const asr = getAsrStatus(asrProvider, settings);
  const text = getTextStatus(textProvider, settings);
  const readyToRecord = Boolean(asr.ready);

  return {
    mode,
    readyToRecord,
    recordingBlockedReason: readyToRecord ? "" : asr.blockedReason,
    asr,
    text
  };
}

function getMode(asrProvider, textProvider) {
  if (asrProvider === "appleSpeech") return "system";
  if (isCloudProvider(asrProvider) || isCloudProvider(textProvider)) return "cloud";
  return "local";
}

function getAsrStatus(provider, settings) {
  if (provider === "localWhisper") {
    const ready = Boolean(String(settings.whisperCliPath || "").trim() && String(settings.whisperModelPath || "").trim());
    return {
      provider,
      label: "Local whisper.cpp",
      ready,
      blockedReason: ready ? "" : "whisper_not_configured"
    };
  }

  if (provider === "appleSpeech") {
    return {
      provider,
      label: "Apple Speech",
      ready: false,
      blockedReason: "apple_speech_not_available_on_windows"
    };
  }

  return getCloudStatus(provider, settings);
}

function getTextStatus(provider, settings) {
  if (provider === "embedded") {
    const ready = Boolean(String(settings.embeddedLlmCliPath || "").trim() && String(settings.embeddedLlmModelPath || "").trim());
    return {
      provider,
      label: "Built-in local language model",
      ready,
      blockedReason: ready ? "" : "embedded_llm_not_configured"
    };
  }

  if (provider === "ollama") {
    const ready = Boolean(settings.ollamaEnabled);
    return {
      provider,
      label: "Ollama",
      ready,
      blockedReason: ready ? "" : "ollama_not_enabled"
    };
  }

  return getCloudStatus(provider, settings);
}

function getCloudStatus(provider, settings) {
  const ready = Boolean(String(settings.cloudApiKey || "").trim());
  return {
    provider,
    label: provider,
    ready,
    blockedReason: ready ? "" : "cloud_provider_not_configured"
  };
}

function isCloudProvider(provider) {
  return ["cloudflareWorkersAi", "groq", "customOpenAiCompatible"].includes(provider);
}
```

- [ ] **Step 4: Add provider defaults to settings**

In `src/main/settings-store.js`, import normalizers:

```js
import {
  getProcessingProviderStatus,
  normalizeAsrProvider,
  normalizeTextProvider
} from "./provider-registry.js";
```

Add these fields to `defaultSettings`:

```js
  asrProvider: "localWhisper",
  cloudApiBaseUrl: "",
  cloudApiKey: "",
```

Normalize them inside `mergeSettings` before returning:

```js
  merged.asrProvider = normalizeAsrProvider(merged.asrProvider);
  merged.llmProvider = normalizeTextProvider(merged.llmProvider);
  merged.providerStatus = getProcessingProviderStatus(merged);
```

- [ ] **Step 5: Run provider tests**

Run:

```powershell
npm.cmd test -- tests/provider-registry.test.js tests/settings-store.test.js
```

Expected: PASS for provider registry and existing settings tests.

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/main/provider-registry.js src/main/settings-store.js tests/provider-registry.test.js tests/settings-store.test.js
git commit -m "feat: add processing provider registry"
```

## Task 2: Dictation Service Partial Result Safety

**Files:**
- Create: `tests/dictation-service.test.js`
- Modify: `src/main/dictation-service.js`

- [ ] **Step 1: Write dictation service tests**

Create `tests/dictation-service.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { DictationService } from "../src/main/dictation-service.js";

test("processWav saves polished result and pastes when enabled", async () => {
  const history = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, { pasteAfterTranscribe: true, historyLimit: 20 }),
    clipboard: {},
    transcribe: async () => "um hello world",
    polish: async () => "hello world",
    paste: async (text) => history.push({ pasted: text }),
    notifyStatus: () => {}
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(entry.text, "hello world");
  assert.equal(entry.transcript, "um hello world");
  assert.equal(entry.status, "complete");
  assert.equal(history.at(-1).pasted, "hello world");
});

test("processWav preserves raw transcript when text processing fails", async () => {
  const history = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, { pasteAfterTranscribe: true, historyLimit: 20 }),
    clipboard: {},
    transcribe: async () => "hello world",
    polish: async () => {
      throw new Error("Install a language model");
    },
    paste: async () => {
      throw new Error("paste should not run after partial processing");
    },
    notifyStatus: () => {}
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(entry.status, "partial");
  assert.equal(entry.text, "hello world");
  assert.equal(entry.processingError, "Install a language model");
  assert.equal(history[0].text, "hello world");
});

function fakeSettingsStore(history, overrides = {}) {
  return {
    async getSettings() {
      return {
        polishMode: "polish",
        outputLanguage: "auto",
        pasteAfterTranscribe: false,
        historyLimit: 20,
        ...overrides
      };
    },
    async addHistory(entry) {
      history.unshift(entry);
      return history;
    }
  };
}
```

- [ ] **Step 2: Run dictation service tests and verify the partial-result test fails**

Run:

```powershell
npm.cmd test -- tests/dictation-service.test.js
```

Expected: FAIL because `DictationService` does not accept injected `transcribe`, `polish`, or `paste` functions and currently throws on cleanup failure.

- [ ] **Step 3: Refactor `DictationService` with injectable dependencies and partial results**

Replace `src/main/dictation-service.js` with:

```js
import { detectLikelyLanguage } from "../shared/language-detection.js";
import { transcribeWithWhisper } from "./local-asr.js";
import { polishTranscript } from "./local-llm.js";
import { pasteText } from "./paste.js";
import { getProcessingProviderStatus } from "./provider-registry.js";

export class DictationService {
  constructor({
    settingsStore,
    clipboard,
    notifyStatus,
    transcribe = transcribeWithWhisper,
    polish = polishTranscript,
    paste = pasteText,
    providerStatus = getProcessingProviderStatus
  }) {
    this.settingsStore = settingsStore;
    this.clipboard = clipboard;
    this.notifyStatus = notifyStatus || (() => {});
    this.transcribe = transcribe;
    this.polish = polish;
    this.paste = paste;
    this.providerStatus = providerStatus;
  }

  async processWav(wavBuffer) {
    const settings = await this.settingsStore.getSettings();
    const providers = this.providerStatus(settings);

    this.notifyStatus({ phase: "transcribing", message: "Transcribing speech..." });
    const transcript = await this.transcribe(wavBuffer, settings);
    const detectedLanguage = detectLikelyLanguage(transcript);

    let text = transcript.trim();
    let status = "complete";
    let processingError = "";

    try {
      this.notifyStatus({ phase: "polishing", message: "Cleaning up dictation..." });
      text = await this.polish(transcript, settings);
    } catch (error) {
      status = "partial";
      processingError = error.message;
      this.notifyStatus({ phase: "warning", message: `Saved raw transcript. ${error.message}` });
    }

    const entry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      transcript,
      text,
      mode: settings.polishMode,
      outputLanguage: settings.outputLanguage,
      detectedLanguage,
      providerMode: providers.mode,
      status,
      processingError
    };

    await this.settingsStore.addHistory(entry, settings.historyLimit);

    if (settings.pasteAfterTranscribe && status === "complete") {
      this.notifyStatus({ phase: "pasting", message: "Pasting into the active app..." });
      await this.paste(text, { clipboard: this.clipboard });
    }

    this.notifyStatus({ phase: status === "complete" ? "done" : "warning", message: status === "complete" ? "Dictation complete." : "Raw transcript saved." });
    return entry;
  }
}
```

- [ ] **Step 4: Run dictation service tests**

Run:

```powershell
npm.cmd test -- tests/dictation-service.test.js
```

Expected: PASS.

- [ ] **Step 5: Run local pipeline tests**

Run:

```powershell
npm.cmd test -- tests/dictation-service.test.js tests/local-asr.test.js tests/local-llm.test.js tests/paste.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add src/main/dictation-service.js tests/dictation-service.test.js
git commit -m "feat: preserve raw dictation results on cleanup failure"
```

## Task 3: Local Language Detection Metadata

**Files:**
- Create: `src/shared/language-detection.js`
- Create: `tests/language-detection.test.js`
- Test: `tests/dictation-service.test.js`

- [ ] **Step 1: Write language detection tests**

Create `tests/language-detection.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { detectLikelyLanguage } from "../src/shared/language-detection.js";

test("detectLikelyLanguage detects common CJK scripts", () => {
  assert.equal(detectLikelyLanguage("这是一个测试"), "zh");
  assert.equal(detectLikelyLanguage("これはテストです"), "ja");
  assert.equal(detectLikelyLanguage("안녕하세요 테스트입니다"), "ko");
});

test("detectLikelyLanguage detects Cyrillic as Russian", () => {
  assert.equal(detectLikelyLanguage("привет это тест"), "ru");
});

test("detectLikelyLanguage detects Latin text with simple hints", () => {
  assert.equal(detectLikelyLanguage("hello this is a test"), "en");
  assert.equal(detectLikelyLanguage("hola este es una prueba"), "es");
  assert.equal(detectLikelyLanguage("bonjour ceci est un test"), "fr");
});

test("detectLikelyLanguage returns unknown for empty or numeric text", () => {
  assert.equal(detectLikelyLanguage(""), "unknown");
  assert.equal(detectLikelyLanguage("12345"), "unknown");
});
```

- [ ] **Step 2: Run language detection tests and verify they fail**

Run:

```powershell
npm.cmd test -- tests/language-detection.test.js
```

Expected: FAIL because `src/shared/language-detection.js` does not exist.

- [ ] **Step 3: Implement lightweight language detection**

Create `src/shared/language-detection.js`:

```js
export function detectLikelyLanguage(input = "") {
  const text = String(input).trim().toLowerCase();
  if (!text || !/[a-z\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]/i.test(text)) {
    return "unknown";
  }

  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\u3400-\u9fff]/.test(text)) return "zh";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";

  if (/\b(hola|este|esta|prueba|gracias|por favor)\b/.test(text)) return "es";
  if (/\b(bonjour|merci|ceci|avec|pour|texte)\b/.test(text)) return "fr";
  if (/[a-z]/.test(text)) return "en";

  return "unknown";
}
```

- [ ] **Step 4: Add detected language assertion to dictation service tests**

In the first `tests/dictation-service.test.js` test, add:

```js
  assert.equal(entry.detectedLanguage, "en");
```

Add a new partial Chinese assertion test:

```js
test("processWav stores detected language metadata for automatic output", async () => {
  const history = [];
  const service = new DictationService({
    settingsStore: fakeSettingsStore(history, { outputLanguage: "auto" }),
    clipboard: {},
    transcribe: async () => "这是一个测试",
    polish: async (text) => text,
    notifyStatus: () => {}
  });

  const entry = await service.processWav(Buffer.from("wav"));

  assert.equal(entry.detectedLanguage, "zh");
  assert.equal(entry.outputLanguage, "auto");
});
```

- [ ] **Step 5: Run language and service tests**

Run:

```powershell
npm.cmd test -- tests/language-detection.test.js tests/dictation-service.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/shared/language-detection.js tests/language-detection.test.js tests/dictation-service.test.js src/main/dictation-service.js
git commit -m "feat: store detected dictation language metadata"
```

## Task 4: Record Button Readiness

**Files:**
- Create: `src/renderer/record-readiness.js`
- Create: `tests/record-readiness.test.js`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/i18n.js`
- Modify: `src/main/index.js`
- Modify: `src/preload.cjs`

- [ ] **Step 1: Write record readiness tests**

Create `tests/record-readiness.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { getRecordReadiness } from "../src/renderer/record-readiness.js";

test("getRecordReadiness blocks recording when media devices API is unavailable", () => {
  const readiness = getRecordReadiness({
    hasMediaDevicesApi: false,
    providerStatus: { readyToRecord: true }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "media_api_unavailable");
});

test("getRecordReadiness blocks recording when provider is not ready", () => {
  const readiness = getRecordReadiness({
    hasMediaDevicesApi: true,
    providerStatus: {
      readyToRecord: false,
      recordingBlockedReason: "whisper_not_configured"
    }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "whisper_not_configured");
});

test("getRecordReadiness allows recording when media and provider are ready", () => {
  const readiness = getRecordReadiness({
    hasMediaDevicesApi: true,
    providerStatus: { readyToRecord: true }
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, "");
});
```

- [ ] **Step 2: Run record readiness tests and verify they fail**

Run:

```powershell
npm.cmd test -- tests/record-readiness.test.js
```

Expected: FAIL because `src/renderer/record-readiness.js` does not exist.

- [ ] **Step 3: Implement record readiness helper**

Create `src/renderer/record-readiness.js`:

```js
export function getRecordReadiness({ hasMediaDevicesApi, providerStatus } = {}) {
  if (!hasMediaDevicesApi) {
    return {
      ready: false,
      reason: "media_api_unavailable"
    };
  }

  if (!providerStatus?.readyToRecord) {
    return {
      ready: false,
      reason: providerStatus?.recordingBlockedReason || "provider_not_ready"
    };
  }

  return {
    ready: true,
    reason: ""
  };
}
```

- [ ] **Step 4: Expose provider status IPC**

In `src/main/index.js`, import `getProcessingProviderStatus`:

```js
import { getProcessingProviderStatus } from "./provider-registry.js";
```

Add this IPC handler in `wireIpc()`:

```js
  ipcMain.handle("providers:status", async () => {
    const settings = await settingsStore.getSettings();
    return getProcessingProviderStatus(settings);
  });
```

In `src/preload.cjs`, expose:

```js
  getProviderStatus: () => ipcRenderer.invoke("providers:status"),
```

- [ ] **Step 5: Add provider status UI element**

In `src/renderer/index.html`, inside `.status-line` after `#statusText`, add:

```html
          <p id="providerStatusText" class="provider-status"></p>
```

- [ ] **Step 6: Apply readiness state in renderer**

In `src/renderer/app.js`, import the helper:

```js
import { getRecordReadiness } from "./record-readiness.js";
```

Add a DOM reference:

```js
const providerStatusText = document.querySelector("#providerStatusText");
```

Add state near the current globals:

```js
let currentProviderStatus = null;
```

After `await renderLocalModelStatus();` in `init()`, add:

```js
  await refreshProviderStatus();
```

At the end of `saveSettingsFromCurrentForm`, before `await renderLocalModelStatus();`, add:

```js
  await refreshProviderStatus();
```

Add these functions:

```js
async function refreshProviderStatus() {
  if (!window.localFlow.getProviderStatus) return;
  currentProviderStatus = await window.localFlow.getProviderStatus();
  renderProviderStatus();
  applyRecordReadiness();
}

function renderProviderStatus() {
  if (!providerStatusText || !currentProviderStatus) return;
  providerStatusText.textContent = t("status.providerMode", {
    mode: t(`provider.mode.${currentProviderStatus.mode}`),
    asr: currentProviderStatus.asr.label
  });
}

function applyRecordReadiness() {
  const readiness = getRecordReadiness({
    hasMediaDevicesApi: Boolean(navigator.mediaDevices?.getUserMedia),
    providerStatus: currentProviderStatus || currentSettings?.providerStatus
  });

  recordButton.disabled = !readiness.ready && !isRecording;
  recordButton.title = readiness.ready ? "" : t(`record.disabled.${readiness.reason}`);

  if (!readiness.ready && !isRecording) {
    setStatus(t(`record.disabled.${readiness.reason}`));
  }
}
```

Call `applyRecordReadiness();` at the end of `setReadyStatus()`.

- [ ] **Step 7: Add localized labels**

In `src/renderer/i18n.js`, add these exact keys to each locale object.

English:

```js
"status.providerMode": "{mode} mode · {asr}",
"provider.mode.local": "Local",
"provider.mode.system": "System",
"provider.mode.cloud": "Cloud",
"record.disabled.media_api_unavailable": "Recording is unavailable because this browser session cannot access microphone APIs.",
"record.disabled.whisper_not_configured": "Set the whisper.cpp executable and model path before recording.",
"record.disabled.cloud_provider_not_configured": "Configure the selected cloud provider before recording.",
"record.disabled.apple_speech_not_available_on_windows": "Apple Speech is only available in the iPhone app.",
"record.disabled.provider_not_ready": "The selected speech provider is not ready."
```

Simplified Chinese:

```js
"status.providerMode": "{mode}模式 · {asr}",
"provider.mode.local": "本地",
"provider.mode.system": "系统",
"provider.mode.cloud": "云端",
"record.disabled.media_api_unavailable": "当前浏览器会话无法访问麦克风 API，暂时不能录音。",
"record.disabled.whisper_not_configured": "请先设置 whisper.cpp 可执行文件和模型路径。",
"record.disabled.cloud_provider_not_configured": "请先配置所选云端服务。",
"record.disabled.apple_speech_not_available_on_windows": "Apple Speech 只在 iPhone 应用中可用。",
"record.disabled.provider_not_ready": "所选语音识别服务尚未就绪。"
```

Japanese:

```js
"status.providerMode": "{mode}モード · {asr}",
"provider.mode.local": "ローカル",
"provider.mode.system": "システム",
"provider.mode.cloud": "クラウド",
"record.disabled.media_api_unavailable": "このブラウザーセッションではマイク API にアクセスできないため、録音できません。",
"record.disabled.whisper_not_configured": "録音前に whisper.cpp 実行ファイルとモデルパスを設定してください。",
"record.disabled.cloud_provider_not_configured": "選択したクラウドプロバイダーを設定してください。",
"record.disabled.apple_speech_not_available_on_windows": "Apple Speech は iPhone アプリでのみ利用できます。",
"record.disabled.provider_not_ready": "選択した音声認識プロバイダーはまだ準備できていません。"
```

Korean:

```js
"status.providerMode": "{mode} 모드 · {asr}",
"provider.mode.local": "로컬",
"provider.mode.system": "시스템",
"provider.mode.cloud": "클라우드",
"record.disabled.media_api_unavailable": "현재 브라우저 세션에서 마이크 API에 접근할 수 없어 녹음할 수 없습니다.",
"record.disabled.whisper_not_configured": "녹음하기 전에 whisper.cpp 실행 파일과 모델 경로를 설정하세요.",
"record.disabled.cloud_provider_not_configured": "선택한 클라우드 제공자를 먼저 설정하세요.",
"record.disabled.apple_speech_not_available_on_windows": "Apple Speech는 iPhone 앱에서만 사용할 수 있습니다.",
"record.disabled.provider_not_ready": "선택한 음성 인식 제공자가 아직 준비되지 않았습니다."
```

Traditional Chinese:

```js
"status.providerMode": "{mode}模式 · {asr}",
"provider.mode.local": "本地",
"provider.mode.system": "系統",
"provider.mode.cloud": "雲端",
"record.disabled.media_api_unavailable": "目前瀏覽器工作階段無法存取麥克風 API，暫時不能錄音。",
"record.disabled.whisper_not_configured": "請先設定 whisper.cpp 執行檔與模型路徑。",
"record.disabled.cloud_provider_not_configured": "請先設定所選雲端服務。",
"record.disabled.apple_speech_not_available_on_windows": "Apple Speech 只在 iPhone 應用程式中可用。",
"record.disabled.provider_not_ready": "所選語音辨識服務尚未就緒。"
```

French:

```js
"status.providerMode": "Mode {mode} · {asr}",
"provider.mode.local": "Local",
"provider.mode.system": "Système",
"provider.mode.cloud": "Cloud",
"record.disabled.media_api_unavailable": "L'enregistrement est indisponible car cette session ne peut pas accéder aux API du microphone.",
"record.disabled.whisper_not_configured": "Définissez l'exécutable whisper.cpp et le chemin du modèle avant d'enregistrer.",
"record.disabled.cloud_provider_not_configured": "Configurez le fournisseur cloud sélectionné avant d'enregistrer.",
"record.disabled.apple_speech_not_available_on_windows": "Apple Speech est disponible uniquement dans l'application iPhone.",
"record.disabled.provider_not_ready": "Le fournisseur de reconnaissance vocale sélectionné n'est pas prêt."
```

Russian:

```js
"status.providerMode": "Режим {mode} · {asr}",
"provider.mode.local": "Локальный",
"provider.mode.system": "Системный",
"provider.mode.cloud": "Облачный",
"record.disabled.media_api_unavailable": "Запись недоступна, потому что этот сеанс не может получить доступ к API микрофона.",
"record.disabled.whisper_not_configured": "Перед записью укажите исполняемый файл whisper.cpp и путь к модели.",
"record.disabled.cloud_provider_not_configured": "Перед записью настройте выбранного облачного провайдера.",
"record.disabled.apple_speech_not_available_on_windows": "Apple Speech доступен только в приложении для iPhone.",
"record.disabled.provider_not_ready": "Выбранный провайдер распознавания речи еще не готов."
```

Spanish:

```js
"status.providerMode": "Modo {mode} · {asr}",
"provider.mode.local": "Local",
"provider.mode.system": "Sistema",
"provider.mode.cloud": "Nube",
"record.disabled.media_api_unavailable": "La grabación no está disponible porque esta sesión no puede acceder a las API del micrófono.",
"record.disabled.whisper_not_configured": "Configura el ejecutable de whisper.cpp y la ruta del modelo antes de grabar.",
"record.disabled.cloud_provider_not_configured": "Configura el proveedor en la nube seleccionado antes de grabar.",
"record.disabled.apple_speech_not_available_on_windows": "Apple Speech solo está disponible en la app para iPhone.",
"record.disabled.provider_not_ready": "El proveedor de reconocimiento de voz seleccionado aún no está listo."
```

- [ ] **Step 8: Run readiness and UI smoke tests**

Run:

```powershell
npm.cmd test -- tests/record-readiness.test.js tests/i18n.test.js tests/electron-runtime.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```powershell
git add src/renderer/record-readiness.js tests/record-readiness.test.js src/renderer/app.js src/renderer/index.html src/renderer/i18n.js src/main/index.js src/preload.cjs
git commit -m "feat: explain recording readiness in the UI"
```

## Task 5: Full Verification

**Files:**
- Existing tests and package scripts.

- [ ] **Step 1: Run all automated tests**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass.

- [ ] **Step 2: Run syntax check for source and tests**

Run:

```powershell
Get-ChildItem -Path src,tests,scripts -Include *.js,*.mjs,*.cjs -Recurse | ForEach-Object { node --check $_.FullName }
```

Expected: no output and exit code 0.

- [ ] **Step 3: Run app smoke test**

Run:

```powershell
npm.cmd run check:app
```

Expected: app launches in Electron smoke mode and exits successfully.

- [ ] **Step 4: Run microphone smoke test when the environment has a microphone**

Run:

```powershell
npm.cmd run check:microphone
```

Expected: pass when Windows grants microphone permission. If the machine lacks an available microphone or Windows blocks desktop-app microphone access, record the exact error and do not mark this check as passed.

- [ ] **Step 5: Check Git status**

Run:

```powershell
git status --short --branch
```

Expected: clean working tree on `master`.

## Self-Review Notes

- Spec coverage: this plan covers Phase 1 only: Windows provider abstraction, Auto language metadata, raw transcript preservation, and record-button reliability. iPhone MVP, iPhone keyboard, real cloud provider HTTP calls, snippets, and style presets are intentionally separate plans.
- Completeness scan: this plan contains concrete files, functions, commands, and expected outcomes for each task.
- Type consistency: provider names are `localWhisper`, `appleSpeech`, `cloudflareWorkersAi`, `groq`, and `customOpenAiCompatible`; output mode values are `local`, `system`, and `cloud`; record readiness reasons are stable string identifiers used by tests and i18n.
