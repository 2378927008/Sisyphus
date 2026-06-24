import { stat as fsStat } from "node:fs/promises";
import path from "node:path";

export async function detectWhisperAssets(rootPath, deps = {}) {
  const stat = deps.stat || fsStat;
  const whisperCliPath = path.join(rootPath, "vendor", "whisper", "bin", "Release", "whisper-cli.exe");
  const whisperModelPath = path.join(rootPath, "vendor", "whisper", "models", "ggml-base.bin");
  const [hasCli, hasModel] = await Promise.all([
    isFile(whisperCliPath, stat),
    isFile(whisperModelPath, stat)
  ]);

  if (!hasCli || !hasModel) {
    return {};
  }

  return {
    whisperCliPath,
    whisperModelPath
  };
}

async function isFile(filePath, stat) {
  try {
    const file = await stat(filePath);
    return file.isFile();
  } catch {
    return false;
  }
}
