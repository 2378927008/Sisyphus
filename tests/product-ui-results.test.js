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
