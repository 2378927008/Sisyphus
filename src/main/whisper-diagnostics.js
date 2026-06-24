import { stat as fsStat } from "node:fs/promises";
import { spawn } from "node:child_process";

export async function validateWhisperSetup(settings = {}, deps = {}) {
  const cliCheck = await checkFile({
    id: "whisperCliPath",
    label: "whisper.cpp executable",
    filePath: settings.whisperCliPath,
    requiredSuffix: ".exe",
    deps
  });

  const modelCheck = await checkFile({
    id: "whisperModelPath",
    label: "Whisper model",
    filePath: settings.whisperModelPath,
    requiredSuffix: ".bin",
    deps
  });

  const canRunWhisper = cliCheck.status === "pass" && modelCheck.status === "pass";
  const runnableCheck = canRunWhisper
    ? await checkRunnable(settings.whisperCliPath, deps)
    : {
        id: "whisperRunnable",
        label: "whisper-cli help command",
        status: "skip",
        message: "Skipped until executable and model paths pass."
      };

  return {
    ready: [cliCheck, modelCheck, runnableCheck].every((check) => check.status === "pass"),
    checks: [cliCheck, modelCheck, runnableCheck]
  };
}

async function checkFile({ id, label, filePath, requiredSuffix, deps }) {
  const normalized = String(filePath || "").trim();

  if (!normalized) {
    return {
      id,
      label,
      status: "fail",
      message: `${label} path is empty.`
    };
  }

  if (requiredSuffix && !normalized.toLowerCase().endsWith(requiredSuffix)) {
    return {
      id,
      label,
      status: "fail",
      message: `${label} should point to a ${requiredSuffix} file.`,
      path: normalized
    };
  }

  try {
    const stat = await (deps.stat || fsStat)(normalized);

    if (!stat.isFile()) {
      return {
        id,
        label,
        status: "fail",
        message: `${label} path is not a file.`,
        path: normalized
      };
    }

    return {
      id,
      label,
      status: "pass",
      message: `${label} file exists.`,
      path: normalized
    };
  } catch {
    return {
      id,
      label,
      status: "fail",
      message: `${label} file was not found.`,
      path: normalized
    };
  }
}

async function checkRunnable(cliPath, deps) {
  try {
    const result = await (deps.run || runProcess)(cliPath, ["-h"], { timeoutMs: 8000 });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;

    if (result.code === 0 && /whisper|usage|options/i.test(output)) {
      return {
        id: "whisperRunnable",
        label: "whisper-cli help command",
        status: "pass",
        message: "whisper-cli starts and returns help output."
      };
    }

    return {
      id: "whisperRunnable",
      label: "whisper-cli help command",
      status: "fail",
      message: `whisper-cli exited with code ${result.code}.`
    };
  } catch (error) {
    return {
      id: "whisperRunnable",
      label: "whisper-cli help command",
      status: "fail",
      message: error.message
    };
  }
}

function runProcess(file, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("whisper-cli help command timed out."));
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
      resolve({ code, stdout, stderr });
    });
  });
}
