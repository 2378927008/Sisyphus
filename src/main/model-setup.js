import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { detectEmbeddedLlmAssets } from "./embedded-llm-assets.js";
import { detectWhisperAssets } from "./whisper-assets.js";

const setupScripts = {
  whisper: {
    script: path.join("scripts", "setup-whisper.ps1"),
    args: ["-Model", "base"]
  },
  llm: {
    script: path.join("scripts", "setup-llm.ps1"),
    args: []
  }
};

export function getModelSetupScript(type, rootPath) {
  if (!Object.hasOwn(setupScripts, type)) {
    return null;
  }

  const config = setupScripts[type];

  return {
    type,
    scriptPath: path.join(rootPath, config.script),
    args: [...config.args]
  };
}

export function createModelSetupService({
  rootPath,
  spawnImpl,
  spawn,
  refreshAssets = () => detectModelAssets(rootPath)
}) {
  const spawnProcess = spawnImpl || spawn || nodeSpawn;
  const state = new Map();

  async function start(type) {
    const script = getModelSetupScript(type, rootPath);
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

    let result;
    try {
      result = await runSetup(script, spawnProcess);
    } catch (error) {
      return failSetup(type, {
        output: error.output || [],
        error: formatSetupError(error)
      });
    }

    try {
      const assets = await refreshAssets();
      const nextState = {
        ...getStatus(type),
        status: result.code === 0 ? "complete" : "failed",
        output: result.output,
        error: result.code === 0 ? "" : `Setup exited with code ${result.code}.`,
        completedAt: new Date().toISOString(),
        assets
      };
      setState(type, nextState);
      return getStatus(type);
    } catch (error) {
      return failSetup(type, {
        output: result.output,
        error: formatSetupError(error)
      });
    }
  }

  async function refresh() {
    const assets = await refreshAssets();
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

  function failSetup(type, { output, error }) {
    const nextState = {
      ...getStatus(type),
      status: "failed",
      output: [...output],
      error,
      completedAt: new Date().toISOString()
    };
    setState(type, nextState);
    return getStatus(type);
  }

  return {
    start,
    refresh,
    getStatus
  };
}

async function detectModelAssets(rootPath) {
  const [whisper, llm] = await Promise.all([
    detectWhisperAssets(rootPath),
    detectEmbeddedLlmAssets(rootPath)
  ]);
  return { whisper, llm };
}

function runSetup(script, spawn) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const output = [];
    const stdoutBuffer = createLineBuffer(output);
    const stderrBuffer = createLineBuffer(output);
    let child;

    function flushOutput() {
      stdoutBuffer.flush();
      stderrBuffer.flush();
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
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
      flushOutput();
      resolve({ code, output });
    }

    try {
      child = spawn(
        "powershell.exe",
        ["-ExecutionPolicy", "Bypass", "-File", script.scriptPath, ...script.args],
        { windowsHide: true }
      );
    } catch (error) {
      fail(error);
      return;
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

function createLineBuffer(output) {
  let pending = "";

  function push(chunk) {
    pending += String(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    pushCompletedLines(output, lines);
  }

  function flush() {
    if (!pending) {
      return;
    }
    pushCompletedLines(output, [pending]);
    pending = "";
  }

  return { push, flush };
}

function pushCompletedLines(output, lines) {
  const completedLines = lines
    .map((line) => line.trim())
    .filter(Boolean);
  output.push(...completedLines);
  trimOutput(output);
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
