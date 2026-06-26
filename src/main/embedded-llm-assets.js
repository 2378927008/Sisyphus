import { spawn } from "node:child_process";
import { stat as fsStat } from "node:fs/promises";
import path from "node:path";

export const embeddedLlmRecommendation = {
  provider: "llama.cpp",
  modelId: "Qwen/Qwen3-4B-GGUF",
  quantization: "Q4_K_M",
  modelFile: "Qwen3-4B-Q4_K_M.gguf",
  modelUrl: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
  modelMirrorUrl: "https://hf-mirror.com/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
  license: "Apache-2.0",
  approximateSize: "2.5 GB",
  runtimeReleaseApi: "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest",
  setupCommand: buildEmbeddedLlmInstallCommand()
};

export async function detectEmbeddedLlmAssets(rootPath, deps = {}) {
  const stat = deps.stat || fsStat;
  const validateRuntime = deps.validateRuntime || validateEmbeddedLlmRuntime;
  const installDir = path.join(rootPath, "vendor", "llm");
  const binDir = path.join(installDir, "bin");
  const modelDir = path.join(installDir, "models");
  const cliPath = path.join(binDir, "llama-cli.exe");
  const serverPath = path.join(binDir, "llama-server.exe");
  const modelPath = path.join(modelDir, embeddedLlmRecommendation.modelFile);
  const [hasCli, hasServer, hasModel] = await Promise.all([
    isFile(cliPath, stat),
    isFile(serverPath, stat),
    isFile(modelPath, stat)
  ]);
  const runtimeCheck = hasCli
    ? await validateRuntime(cliPath, deps)
    : { ready: false, error: hasServer ? "llama-cli.exe was not found." : "" };
  const runtimeReady = Boolean(hasCli && runtimeCheck.ready);

  return {
    ...embeddedLlmRecommendation,
    ready: runtimeReady && hasModel,
    runtimeReady,
    modelReady: hasModel,
    cliPath: hasCli ? cliPath : "",
    serverPath: hasServer ? serverPath : "",
    modelPath: hasModel ? modelPath : "",
    runtimeError: runtimeCheck.error || "",
    installDir,
    binDir,
    modelDir
  };
}

export function validateEmbeddedLlmRuntime(cliPath, deps = {}) {
  const spawnImpl = deps.spawn || spawn;
  const timeoutMs = deps.runtimeValidationTimeoutMs || 5000;

  return new Promise((resolve) => {
    let settled = false;
    const child = spawnImpl(cliPath, ["-h"], {
      windowsHide: true,
      cwd: path.dirname(cliPath)
    });
    let stderr = "";

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child?.kill?.();
      resolve({ ready: false, error: "llama-cli runtime validation timed out." });
    }, timeoutMs);
    timer.unref?.();

    child.stderr?.on?.("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on?.("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ready: false, error: error.message });
    });
    child.on?.("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code === 0
        ? { ready: true, error: "" }
        : { ready: false, error: stderr.trim() || `llama-cli exited with code ${code}.` });
    });
  });
}

export function buildEmbeddedLlmInstallCommand() {
  return "powershell.exe -ExecutionPolicy Bypass -File .\\scripts\\setup-llm.ps1";
}

export function selectLlamaReleaseAsset(assets = []) {
  const candidates = assets
    .filter((asset) => isWindowsRuntimeAsset(asset?.name))
    .sort((left, right) => scoreRuntimeAsset(right.name) - scoreRuntimeAsset(left.name));

  return candidates[0] || null;
}

function isWindowsRuntimeAsset(name = "") {
  const normalized = String(name).toLowerCase();
  return normalized.startsWith("llama-") &&
    normalized.includes("bin-win") &&
    normalized.includes("x64") &&
    normalized.endsWith(".zip") &&
    !/(cudart|cuda|vulkan|kompute|opencl|sycl)/.test(normalized);
}

function scoreRuntimeAsset(name = "") {
  const normalized = String(name).toLowerCase();
  if (normalized.includes("avx2")) return 30;
  if (normalized.includes("avx")) return 20;
  return 10;
}

async function isFile(filePath, stat) {
  try {
    const file = await stat(filePath);
    return file.isFile();
  } catch {
    return false;
  }
}
