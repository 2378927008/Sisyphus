import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import path from "node:path";

export const embeddedLlmRecommendation = {
  provider: "llama.cpp",
  modelId: "Qwen/Qwen3-4B-GGUF",
  modelRevision: "bc640142c66e1fdd12af0bd68f40445458f3869b",
  quantization: "Q4_K_M",
  modelFile: "Qwen3-4B-Q4_K_M.gguf",
  modelSha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
  modelUrl: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf",
  modelMirrorUrl: "https://hf-mirror.com/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf",
  license: "Apache-2.0",
  approximateSize: "2.5 GB",
  runtimeVersion: "b9049",
  runtimeCliSha256: "52b59647c0cbb06d33edfc21d4b269881f8e703e452236058c010630785f4ae9",
  runtimeSource: "https://github.com/ggml-org/llama.cpp/releases/tag/b9049",
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

export async function validateEmbeddedLlmRuntime(cliPath, deps = {}) {
  const spawnImpl = deps.spawn || spawn;
  const readFile = deps.readFile || fsReadFile;
  const expectedSha256 = deps.expectedSha256 ?? embeddedLlmRecommendation.runtimeCliSha256;
  const timeoutMs = deps.runtimeValidationTimeoutMs || 5000;

  if (expectedSha256) {
    try {
      const binary = await readFile(cliPath);
      const actualSha256 = createHash("sha256").update(binary).digest("hex");
      if (actualSha256 !== expectedSha256.toLowerCase()) {
        return {
          ready: false,
          error: "llama-cli does not match the bundled version. Reinstall the local language runtime."
        };
      }
    } catch (error) {
      return {
        ready: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const child = spawnImpl(cliPath, ["--version"], {
      windowsHide: true,
      cwd: path.dirname(cliPath)
    });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child?.kill?.();
      resolve({ ready: false, error: "llama-cli runtime validation timed out." });
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on?.("data", (chunk) => {
      stdout = appendOutputTail(stdout, chunk);
    });
    child.stderr?.on?.("data", (chunk) => {
      stderr = appendOutputTail(stderr, chunk);
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
        : {
          ready: false,
          error: [stderr.trim(), stdout.trim()].filter(Boolean).join("\n") || `llama-cli exited with code ${code}.`
        });
    });
  });
}

function appendOutputTail(current, chunk, maxLength = 8192) {
  const next = current + chunk.toString();
  return next.length > maxLength ? next.slice(-maxLength) : next;
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
