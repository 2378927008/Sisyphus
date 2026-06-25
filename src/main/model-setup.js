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
  spawn = nodeSpawn,
  refreshAssets = () => detectModelAssets(rootPath)
}) {
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

    const result = await runSetup(script, spawn);
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
    return nextState;
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
    return state.get(type) || {
      type,
      status: "idle",
      output: [],
      error: "",
      startedAt: "",
      completedAt: ""
    };
  }

  function setState(type, value) {
    state.set(type, value);
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
    const output = [];
    const stdoutBuffer = createLineBuffer(output);
    const stderrBuffer = createLineBuffer(output);
    const child = spawn(
      "powershell.exe",
      ["-ExecutionPolicy", "Bypass", "-File", script.scriptPath, ...script.args],
      { windowsHide: true }
    );

    child.stdout?.on("data", (chunk) => stdoutBuffer.push(chunk));
    child.stderr?.on("data", (chunk) => stderrBuffer.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      stdoutBuffer.flush();
      stderrBuffer.flush();
      resolve({ code, output });
    });
  });
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
