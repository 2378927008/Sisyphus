import assert from "node:assert/strict";
import test from "node:test";

const forbiddenTechnicalText =
  /[A-Za-z]:[\\/]|\\\\server|\/home\/|https?:|file:|\bspawn\b|ENOENT|stderr|exit(?:ed)?\s+(?:code\s+)?\d|Daily limit exceeded|provider response/i;

async function loadProductUiResults() {
  try {
    return await import("../src/main/product-ui-results.js");
  } catch (error) {
    assert.fail(`product UI result module is unavailable: ${error?.code || error?.message}`);
  }
}

test("diagnostic result adapters return only stable ready and reason fields", async () => {
  const {
    toTextDiagnosticResult,
    toWhisperDiagnosticResult
  } = await loadProductUiResults();
  const diagnostic = {
    ready: false,
    checks: [{
      id: "whisperRunnable",
      label: "provider response",
      status: "fail",
      path: "C:\\Users\\Private\\whisper-cli.exe",
      message: "stderr: spawn ENOENT https://vendor.example exit code 7"
    }]
  };

  assert.deepEqual(toWhisperDiagnosticResult(diagnostic), {
    ready: false,
    reason: "whisper_unavailable"
  });
  assert.deepEqual(toTextDiagnosticResult(diagnostic), {
    ready: false,
    reason: "text_provider_unavailable"
  });
  assert.doesNotMatch(
    JSON.stringify([
      toWhisperDiagnosticResult(diagnostic),
      toTextDiagnosticResult(diagnostic)
    ]),
    forbiddenTechnicalText
  );
});

test("model status and setup adapters remove paths URLs output and raw failures", async () => {
  const {
    toLocalModelUiStatus,
    toModelSetupUiStatus
  } = await loadProductUiResults();
  const rawStatus = {
    ready: false,
    runtimeReady: false,
    modelReady: true,
    modelId: "Qwen/Qwen3-4B-GGUF",
    quantization: "Q4_K_M",
    approximateSize: "2.5 GB",
    license: "Apache-2.0",
    modelFile: "Qwen3-4B-Q4_K_M.gguf",
    modelUrl: "https://vendor.example/model",
    cliPath: "C:\\private\\llama-cli.exe",
    runtimeError: "stderr spawn ENOENT",
    setupCommand: "powershell.exe -File C:\\private\\setup.ps1"
  };
  const setup = {
    assets: {
      whisper: {
        whisperCliPath: "C:\\private\\whisper-cli.exe",
        whisperModelPath: "C:\\private\\model.bin"
      },
      llm: {
        ready: false,
        cliPath: "/home/private/llama-cli",
        modelPath: "/home/private/qwen.gguf"
      }
    },
    setups: {
      whisper: {
        type: "whisper",
        status: "failed",
        failureReason: "download_failed",
        output: ["provider response", "stderr spawn ENOENT"],
        error: "https://vendor.example exit code 7"
      }
    }
  };

  const localModel = toLocalModelUiStatus(rawStatus);
  const setupStatus = toModelSetupUiStatus(setup);

  assert.deepEqual(localModel, {
    ready: false,
    runtimeReady: false,
    modelReady: true,
    modelId: "Qwen/Qwen3-4B-GGUF",
    quantization: "Q4_K_M",
    approximateSize: "2.5 GB",
    license: "Apache-2.0"
  });
  assert.deepEqual(setupStatus, {
    assets: {
      whisper: { ready: true },
      llm: { ready: false }
    },
    setups: {
      whisper: {
        type: "whisper",
        status: "failed",
        failureReason: "download_failed"
      }
    }
  });
  assert.doesNotMatch(JSON.stringify([localModel, setupStatus]), forbiddenTechnicalText);
});

test("renderer settings adapter exposes only current product controls", async () => {
  const { toRendererSettings } = await loadProductUiResults();
  const rendererSettings = toRendererSettings({
    hotkey: "CommandOrControl+Alt+Space",
    shortcutMode: "toggle",
    pasteLastHotkey: "CommandOrControl+Alt+V",
    globalShortcutPaused: false,
    launchAtLogin: true,
    startMinimizedToTray: true,
    pasteAfterTranscribe: true,
    interfaceLanguage: "zh-Hans",
    whisperLanguage: "auto",
    outputLanguage: "auto",
    polishMode: "polish",
    ollamaEnabled: false,
    llmProvider: "mymemory",
    dictionary: ["Local Flow"],
    snippets: [{ id: "s1", trigger: "address", text: "Product Road 1" }],
    whisperCliPath: "C:\\private\\whisper-cli.exe",
    whisperModelPath: "C:\\private\\model.bin",
    embeddedLlmCliPath: "C:\\private\\llama-cli.exe",
    embeddedLlmModelPath: "C:\\private\\qwen.gguf",
    cloudApiBaseUrl: "https://private.example/v1",
    cloudApiKey: "secret-key",
    ollamaBaseUrl: "http://localhost:11434",
    qwenModelUrl: "https://private.example/qwen.gguf",
    providerStatus: {
      rawError: "stderr spawn ENOENT"
    }
  });

  assert.deepEqual(Object.keys(rendererSettings).sort(), [
    "dictionary",
    "globalShortcutPaused",
    "hotkey",
    "interfaceLanguage",
    "launchAtLogin",
    "llmProvider",
    "ollamaEnabled",
    "outputLanguage",
    "pasteAfterTranscribe",
    "pasteLastHotkey",
    "polishMode",
    "shortcutMode",
    "snippets",
    "startMinimizedToTray",
    "whisperLanguage"
  ]);
  assert.equal(rendererSettings.launchAtLogin, true);
  assert.deepEqual(rendererSettings.dictionary, ["Local Flow"]);
  assert.deepEqual(rendererSettings.snippets, [{
    id: "s1",
    trigger: "address",
    text: "Product Road 1"
  }]);
  assert.doesNotMatch(JSON.stringify(rendererSettings), forbiddenTechnicalText);
  assert.doesNotMatch(
    JSON.stringify(rendererSettings),
    /(?:CliPath|ModelPath|RuntimeUrl|MirrorUrls|BaseUrl|ApiKey|providerStatus)/
  );
});

test("status adapter keeps lifecycle fields and stable reasons without raw messages", async () => {
  const { toRendererStatusPayload } = await loadProductUiResults();
  const safeStatus = toRendererStatusPayload({
    operationId: 42,
    phase: "warning",
    reason: "paste_failed",
    message: "stderr spawn C:\\private\\paste.exe ENOENT",
    updatedAt: "2026-07-28T10:00:00.000Z",
    recordingStartedAt: "2026-07-28T09:59:55.000Z",
    providerUrl: "https://private.example/log"
  });
  const unsafeReasonStatus = toRendererStatusPayload({
    phase: "error",
    reason: "spawn C:\\private\\provider.exe ENOENT",
    message: "https://private.example/log"
  });

  assert.deepEqual(safeStatus, {
    operationId: 42,
    phase: "warning",
    reason: "paste_failed",
    updatedAt: "2026-07-28T10:00:00.000Z",
    recordingStartedAt: "2026-07-28T09:59:55.000Z"
  });
  assert.deepEqual(unsafeReasonStatus, {
    operationId: null,
    phase: "error",
    reason: ""
  });
  assert.doesNotMatch(JSON.stringify([safeStatus, unsafeReasonStatus]), forbiddenTechnicalText);
});

test("history and dictation adapters expose only editable product fields", async () => {
  const {
    toRendererDictationResult,
    toRendererHistoryActionResult,
    toRendererHistoryList
  } = await loadProductUiResults();
  const rawEntry = {
    id: "history-1",
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:01:00.000Z",
    transcript: "spoken words",
    text: "clean words",
    status: "complete",
    processingError: "provider_response",
    pasteError: "spawn C:\\private\\paste.exe ENOENT",
    providerDiagnostics: "https://private.example/log",
    modelPath: "C:\\private\\model.bin",
    apiKey: "secret-key"
  };
  const expectedEntry = {
    id: "history-1",
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:01:00.000Z",
    transcript: "spoken words",
    text: "clean words",
    status: "complete"
  };

  assert.deepEqual(toRendererHistoryList([rawEntry, null]), [expectedEntry]);
  assert.deepEqual(toRendererHistoryActionResult({
    ok: true,
    entry: rawEntry,
    diagnostics: "stderr"
  }), {
    ok: true,
    entry: expectedEntry
  });
  assert.deepEqual(toRendererDictationResult(rawEntry), expectedEntry);
  assert.doesNotMatch(
    JSON.stringify([
      toRendererHistoryList([rawEntry]),
      toRendererHistoryActionResult({ ok: true, entry: rawEntry }),
      toRendererDictationResult(rawEntry)
    ]),
    forbiddenTechnicalText
  );
});

test("history and dictation adapters map unknown failures to product-owned reasons", async () => {
  const {
    toRendererDictationResult,
    toRendererHistoryActionResult
  } = await loadProductUiResults();

  assert.deepEqual(toRendererHistoryActionResult({
    ok: false,
    reason: "provider_response",
    message: "spawn C:\\private\\helper.exe ENOENT"
  }), {
    ok: false,
    reason: "operation_failed"
  });
  assert.deepEqual(toRendererDictationResult({
    ok: false,
    reason: "provider_response",
    providerUrl: "https://private.example/log"
  }), {
    ok: false,
    reason: "operation_failed"
  });
});
