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

  return {
    ...embeddedLlmRecommendation,
    ready: (hasCli || hasServer) && hasModel,
    runtimeReady: hasCli || hasServer,
    modelReady: hasModel,
    cliPath: hasCli ? cliPath : "",
    serverPath: hasServer ? serverPath : "",
    modelPath: hasModel ? modelPath : "",
    installDir,
    binDir,
    modelDir
  };
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
