import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export function buildWhisperArgs({ modelPath, wavPath, language = "auto" }) {
  const args = ["-m", modelPath, "-f", wavPath, "-nt"];

  if (language && language !== "auto") {
    args.push("-l", language);
  }

  return args;
}

export function parseWhisperOutput(output = "") {
  return String(output)
    .replace(/whisper_print_timings:[\s\S]*$/i, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(whisper_|ggml_|main:|system_info:|load_backend:|read_audio_data:)/i.test(line))
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function transcribeWithWhisper(wavBuffer, settings, deps = {}) {
  const cliPath = settings.whisperCliPath?.trim();
  const modelPath = settings.whisperModelPath?.trim();

  if (!cliPath || !modelPath) {
    throw new Error("Whisper is not configured. Set the whisper.cpp executable and model path first.");
  }

  const tempDir = path.join(os.tmpdir(), "local-flow-dictation");
  await mkdir(tempDir, { recursive: true });
  const wavPath = path.join(tempDir, `dictation-${Date.now()}.wav`);

  await writeFile(wavPath, wavBuffer);

  try {
    const args = buildWhisperArgs({
      modelPath,
      wavPath,
      language: settings.whisperLanguage || "auto"
    });
    const { stdout, stderr } = await runProcess(cliPath, args, deps);
    const transcript = parseWhisperOutput(`${stdout}\n${stderr}`);

    if (!transcript) {
      throw new Error("Whisper returned an empty transcript.");
    }

    return transcript;
  } finally {
    await rm(wavPath, { force: true });
  }
}

function runProcess(file, args, deps = {}) {
  const spawnImpl = deps.spawn || spawn;
  const timeoutMs = deps.timeoutMs || 120000;

  return new Promise((resolve, reject) => {
    const child = spawnImpl(file, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Whisper transcription timed out."));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || `Whisper exited with code ${code}.`));
      }
    });
  });
}
