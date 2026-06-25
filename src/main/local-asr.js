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

    if (shouldRetryChineseRecognition(settings, transcript)) {
      const retryArgs = buildWhisperArgs({
        modelPath,
        wavPath,
        language: "zh"
      });

      try {
        const retryResult = await runProcess(cliPath, retryArgs, deps);
        const retryTranscript = parseWhisperOutput(`${retryResult.stdout}\n${retryResult.stderr}`);
        if (isBetterChineseTranscript(retryTranscript, transcript)) {
          return retryTranscript;
        }
      } catch {
        // Keep the automatic transcript if the Chinese retry cannot complete.
      }
    }

    return transcript;
  } finally {
    await rm(wavPath, { force: true });
  }
}

function shouldRetryChineseRecognition(settings = {}, transcript = "") {
  if ((settings.whisperLanguage || "auto") !== "auto") {
    return false;
  }
  if (!prefersChineseRecognition(settings)) {
    return false;
  }
  return hasLatinLetters(transcript);
}

function prefersChineseRecognition(settings = {}) {
  return isChineseLanguageCode(settings.interfaceLanguage) || isChineseLanguageCode(settings.outputLanguage);
}

function isChineseLanguageCode(value) {
  return String(value || "").startsWith("zh");
}

function containsChinese(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ""));
}

function hasLatinLetters(value) {
  return latinLetterCount(value) > 0;
}

function isBetterChineseTranscript(candidate, original) {
  const candidateChinese = chineseCharacterCount(candidate);
  const originalChinese = chineseCharacterCount(original);

  if (candidateChinese < 2) {
    return false;
  }

  return candidateChinese > originalChinese &&
    chineseDensity(candidate) > chineseDensity(original);
}

function chineseCharacterCount(value) {
  return (String(value || "").match(/[\u4e00-\u9fff]/g) || []).length;
}

function latinLetterCount(value) {
  return (String(value || "").match(/[A-Za-z]/g) || []).length;
}

function chineseDensity(value) {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text.length) {
    return 0;
  }
  return chineseCharacterCount(text) / text.length;
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
