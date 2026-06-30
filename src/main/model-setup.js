import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { detectEmbeddedLlmAssets } from "./embedded-llm-assets.js";
import { detectWhisperAssets } from "./whisper-assets.js";

const defaultSetupTimeoutMs = 60 * 60 * 1000;

const setupScripts = {
  whisper: {
    script: path.join("scripts", "setup-whisper.ps1"),
    args: ["-Model", "base"],
    installDir: path.join("vendor", "whisper")
  },
  llm: {
    script: path.join("scripts", "setup-llm.ps1"),
    args: [],
    installDir: path.join("vendor", "llm")
  }
};

export function getModelSetupScript(type, setupRoot) {
  if (!Object.hasOwn(setupScripts, type)) {
    return null;
  }

  const config = setupScripts[type];
  const roots = resolveSetupRoots(setupRoot);
  const args = [...config.args];

  if (!roots.legacyRoot && roots.assetRootPath) {
    args.push("-InstallDir", path.join(roots.assetRootPath, config.installDir));
  }
  if (!roots.legacyRoot && roots.nodeExecutable) {
    args.push("-NodeExe", roots.nodeExecutable);
  }

  return {
    type,
    scriptPath: path.join(roots.scriptRootPath, config.script),
    args
  };
}

export function createModelSetupService({
  rootPath,
  scriptRootPath = rootPath,
  assetRootPath = rootPath,
  nodeExecutable,
  setupEnv,
  spawnImpl,
  spawn,
  setupTimeoutMs = defaultSetupTimeoutMs,
  killProcessTree = killSetupProcessTree,
  refreshAssets
}) {
  const spawnProcess = spawnImpl || spawn || nodeSpawn;
  const refreshModelAssets = refreshAssets || (() => detectModelAssets(assetRootPath || rootPath));
  const state = new Map();
  const activeRuns = new Map();

  async function start(type) {
    const script = getModelSetupScript(type, {
      rootPath,
      scriptRootPath,
      assetRootPath,
      nodeExecutable
    });
    if (!script) {
      throw new Error(`Unknown setup type: ${type}`);
    }
    if (state.get(type)?.status === "running") {
      throw new Error(`${type} setup is already running.`);
    }

    setState(type, {
      type,
      status: "running",
      output: [],
      error: "",
      startedAt: new Date().toISOString(),
      completedAt: ""
    });

    const activeRun = {
      cancelled: false,
      cancel: null,
      getOutput: () => []
    };
    activeRuns.set(type, activeRun);

    let result;
    try {
      result = await runSetup(script, spawnProcess, setupTimeoutMs, killProcessTree, (output) => {
        const current = state.get(type);
        if (current?.status === "running") {
          setState(type, {
            ...current,
            output: [...output]
          });
        }
      }, (controls) => {
        activeRun.cancel = controls.cancel;
        activeRun.getOutput = controls.getOutput;
      }, setupEnv);
    } catch (error) {
      if (activeRun.cancelled) {
        return getStatus(type);
      }
      return failSetup(type, createSetupFailure(type, {
        output: error.output || [],
        error
      }));
    } finally {
      if (activeRuns.get(type) === activeRun) {
        activeRuns.delete(type);
      }
    }

    if (activeRun.cancelled) {
      return getStatus(type);
    }

    try {
      const assets = await refreshModelAssets();
      const assetError = result.code === 0 ? getSetupAssetError(type, assets) : "";
      const setupFailure = result.code === 0 && assetError
        ? createSetupFailure(type, {
          output: result.output,
          reason: getSetupAssetFailureReason(type),
          fallbackError: assetError
        })
        : createSetupFailure(type, {
          output: result.output,
          code: result.code
        });
      const nextState = {
        ...getStatus(type),
        status: result.code === 0 && !assetError ? "complete" : "failed",
        output: result.output,
        error: result.code === 0 && !assetError ? "" : setupFailure.error,
        failureReason: result.code === 0 && !assetError ? "" : setupFailure.failureReason,
        completedAt: new Date().toISOString(),
        assets
      };
      setState(type, nextState);
      return getStatus(type);
    } catch (error) {
      return failSetup(type, createSetupFailure(type, {
        output: result.output,
        error
      }));
    }
  }

  function cancel(type) {
    const current = getStatus(type);
    const activeRun = activeRuns.get(type);

    if (current.status !== "running" || !activeRun) {
      return current;
    }

    activeRun.cancelled = true;
    activeRun.cancel?.();
    setState(type, {
      ...current,
      status: "failed",
      output: activeRun.getOutput(),
      error: "Setup cancelled.",
      completedAt: new Date().toISOString()
    });
    activeRuns.delete(type);
    return getStatus(type);
  }

  async function refresh() {
    const assets = await refreshModelAssets();
    return {
      assets,
      setups: {
        whisper: getStatus("whisper"),
        llm: getStatus("llm")
      }
    };
  }

  function getStatus(type) {
    return cloneStatus(state.get(type) || {
      type,
      status: "idle",
      output: [],
      error: "",
      startedAt: "",
      completedAt: ""
    });
  }

  function setState(type, value) {
    state.set(type, value);
  }

  function failSetup(type, { output, error, failureReason = "" }) {
    const nextState = {
      ...getStatus(type),
      status: "failed",
      output: [...output],
      error,
      failureReason,
      completedAt: new Date().toISOString()
    };
    setState(type, nextState);
    return getStatus(type);
  }

  return {
    start,
    cancel,
    refresh,
    getStatus
  };
}

function resolveSetupRoots(setupRoot) {
  if (typeof setupRoot === "string") {
    return {
      legacyRoot: true,
      scriptRootPath: setupRoot
    };
  }

  const rootPath = setupRoot?.rootPath;
  const scriptRootPath = setupRoot?.scriptRootPath || rootPath;
  return {
    legacyRoot: false,
    scriptRootPath,
    assetRootPath: setupRoot?.assetRootPath || rootPath || scriptRootPath,
    nodeExecutable: setupRoot?.nodeExecutable
  };
}

async function detectModelAssets(rootPath) {
  const [whisper, llm] = await Promise.all([
    detectWhisperAssets(rootPath),
    detectEmbeddedLlmAssets(rootPath)
  ]);
  return { whisper, llm };
}

function getSetupAssetError(type, assets) {
  if (type === "whisper") {
    return assets.whisper?.whisperCliPath && assets.whisper?.whisperModelPath
      ? ""
      : "Whisper setup finished but required assets were not found.";
  }

  if (type === "llm") {
    return assets.llm?.ready
      ? ""
      : "Qwen setup finished but required assets were not found.";
  }

  return "Setup finished but required assets were not found.";
}

function getSetupAssetFailureReason(type) {
  if (type === "whisper") return "whisper_assets_missing";
  if (type === "llm") return "llm_assets_missing";
  return "setup_assets_missing";
}

export function killSetupProcessTree(child, spawn = nodeSpawn, platform = process.platform) {
  if (platform === "win32" && child?.pid) {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore" }
    );
    killer?.on?.("error", () => {
      child?.kill?.();
    });
    return;
  }

  child?.kill?.();
}

function runSetup(script, spawn, timeoutMs, killProcessTree, onOutput, onControls = () => {}, setupEnv) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const output = [];
    const stdoutBuffer = createLineBuffer(output, onOutput);
    const stderrBuffer = createLineBuffer(output, onOutput);
    let child;
    let timeout = null;

    function flushOutput() {
      stdoutBuffer.flush();
      stderrBuffer.flush();
    }

    function clearSetupTimeout() {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearSetupTimeout();
      flushOutput();
      const setupError = error instanceof Error ? error : new Error(String(error));
      setupError.output = [...output];
      reject(setupError);
    }

    function complete(code) {
      if (settled) {
        return;
      }
      settled = true;
      clearSetupTimeout();
      flushOutput();
      resolve({ code, output });
    }

    function timeOut() {
      if (settled) {
        return;
      }
      try {
        killProcessTree(child);
      } catch {
        child?.kill?.();
      }
      fail(new Error(`Setup timed out after ${timeoutMs} ms.`));
    }

    try {
      const spawnOptions = setupEnv
        ? { windowsHide: true, env: { ...process.env, ...setupEnv } }
        : { windowsHide: true };
      child = spawn(
        "powershell.exe",
        ["-ExecutionPolicy", "Bypass", "-File", script.scriptPath, ...script.args],
        spawnOptions
      );
      onControls({
        cancel() {
          try {
            killProcessTree(child);
          } catch {
            child?.kill?.();
          }
          fail(new Error("Setup cancelled."));
        },
        getOutput() {
          flushOutput();
          return [...output];
        }
      });
    } catch (error) {
      fail(error);
      return;
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeout = setTimeout(timeOut, timeoutMs);
      timeout.unref?.();
    }

    child.stdout?.on("data", (chunk) => stdoutBuffer.push(chunk));
    child.stderr?.on("data", (chunk) => stderrBuffer.push(chunk));
    child.on("error", fail);
    child.on("close", complete);
  });
}

function cloneStatus(status) {
  return cloneSnapshotValue(status);
}

function formatSetupError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function createSetupFailure(type, { output = [], error, code, reason, fallbackError } = {}) {
  const failureReason = reason ||
    findStructuredSetupReason(output) ||
    classifySetupError(error) ||
    (Number.isInteger(code) && code !== 0 ? "setup_exit_code" : "");
  const message = getSetupFailureMessage(type, failureReason, {
    code,
    error,
    fallbackError
  });

  return {
    output: [...output],
    error: message,
    failureReason
  };
}

function findStructuredSetupReason(output = []) {
  for (const line of output) {
    const match = String(line).match(/\bLOCAL_FLOW_SETUP_ERROR:([a-z0-9_]+)/i);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function classifySetupError(error) {
  const message = formatSetupError(error);
  if (/timed out/i.test(message)) return "setup_timeout";
  if (/spawn .*powershell|powershell.*ENOENT|powershell.*not found/i.test(message)) {
    return "setup_spawn_failed";
  }
  return "";
}

function getSetupFailureMessage(type, reason, { code, error, fallbackError } = {}) {
  const messages = {
    whisper_release_metadata: "Could not fetch whisper.cpp release metadata. Check your network or proxy, then retry.",
    whisper_release_asset_missing: "The current whisper.cpp release did not include the expected Windows x64 package. Update Local Flow or retry later.",
    whisper_runtime_download: "Whisper runtime download failed. Check your network or proxy, then retry.",
    whisper_extract_failed: "Whisper runtime archive could not be extracted. Delete the cached zip and retry.",
    whisper_runtime_missing: "Whisper runtime was extracted, but whisper-cli.exe was not found. Delete the cached runtime and retry.",
    whisper_model_download: "Whisper model download failed. Check your network or proxy, then retry.",
    whisper_assets_missing: "Whisper setup finished but required assets were not found.",
    llm_release_metadata: "Could not fetch llama.cpp release metadata. Check your network or proxy, then retry.",
    llm_release_asset_missing: "The current llama.cpp release did not include a compatible Windows runtime. Update Local Flow or retry later.",
    llm_runtime_download: "llama.cpp runtime download failed. Check your network or proxy, then retry.",
    llm_extract_failed: "llama.cpp runtime archive could not be extracted. Delete the cached zip and retry.",
    llm_runtime_missing: "llama.cpp runtime was extracted, but llama-cli.exe or llama-server.exe was not found.",
    llm_model_download: "Qwen model download failed. This file is large; check network stability, disk space, and proxy settings, then retry.",
    llm_assets_missing: "Qwen setup finished but required assets were not found.",
    setup_timeout: "Model setup timed out. Check network stability and retry.",
    setup_spawn_failed: "Model setup could not start PowerShell. Restart Local Flow and try again.",
    setup_assets_missing: "Setup finished but required assets were not found."
  };

  if (messages[reason]) return messages[reason];
  if (reason === "setup_exit_code" && Number.isInteger(code)) {
    return `Setup exited with code ${code}.`;
  }
  if (fallbackError) return fallbackError;
  return formatSetupError(error);
}

function createLineBuffer(output, onOutput = () => {}) {
  let pending = "";

  function push(chunk) {
    pending += String(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    pushCompletedLines(output, lines, onOutput);
  }

  function flush() {
    if (!pending) {
      return;
    }
    pushCompletedLines(output, [pending], onOutput);
    pending = "";
  }

  return { push, flush };
}

function pushCompletedLines(output, lines, onOutput) {
  const completedLines = lines
    .map((line) => line.trim())
    .filter(Boolean);
  if (!completedLines.length) {
    return;
  }
  output.push(...completedLines);
  trimOutput(output);
  onOutput([...output]);
}

function trimOutput(output) {
  while (output.length > 40) {
    output.shift();
  }
}

function cloneSnapshotValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneSnapshotValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneSnapshotValue(item)])
    );
  }
  return value;
}
