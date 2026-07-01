import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createModelSetupService,
  getModelSetupScript,
  killSetupProcessTree
} from "../src/main/model-setup.js";

test("getModelSetupScript returns only known local setup scripts", () => {
  const rootPath = "C:/app";

  assert.deepEqual(getModelSetupScript("whisper", rootPath), {
    type: "whisper",
    scriptPath: path.join(rootPath, "scripts", "setup-whisper.ps1"),
    args: ["-Model", "base"]
  });
  assert.deepEqual(getModelSetupScript("llm", rootPath), {
    type: "llm",
    scriptPath: path.join(rootPath, "scripts", "setup-llm.ps1"),
    args: []
  });
  assert.equal(getModelSetupScript("bad", rootPath), null);
  assert.equal(getModelSetupScript("toString", rootPath), null);
});

test("getModelSetupScript supports packaged script and asset roots", () => {
  const scriptRootPath = "C:/Program Files/Local Flow/resources/app";
  const assetRootPath = "C:/Program Files/Local Flow/resources";
  const nodeExecutable = "C:/Program Files/Local Flow/Local Flow.exe";

  assert.deepEqual(getModelSetupScript("whisper", {
    scriptRootPath,
    assetRootPath,
    nodeExecutable
  }), {
    type: "whisper",
    scriptPath: path.join(scriptRootPath, "scripts", "setup-whisper.ps1"),
    args: [
      "-Model",
      "base",
      "-InstallDir",
      path.join(assetRootPath, "vendor", "whisper"),
      "-NodeExe",
      nodeExecutable
    ]
  });
  assert.deepEqual(getModelSetupScript("llm", {
    scriptRootPath,
    assetRootPath,
    nodeExecutable
  }), {
    type: "llm",
    scriptPath: path.join(scriptRootPath, "scripts", "setup-llm.ps1"),
    args: [
      "-InstallDir",
      path.join(assetRootPath, "vendor", "llm"),
      "-NodeExe",
      nodeExecutable
    ]
  });
});

test("killSetupProcessTree uses taskkill for Windows child process trees", () => {
  const spawned = [];
  let childKillCalls = 0;

  killSetupProcessTree({
    pid: 4321,
    kill: () => {
      childKillCalls += 1;
    }
  }, (file, args, options) => {
    spawned.push({ file, args, options });
    return fakeTaskkillProcess();
  }, "win32");

  assert.deepEqual(spawned, [{
    file: "taskkill.exe",
    args: ["/PID", "4321", "/T", "/F"],
    options: { windowsHide: true, stdio: "ignore" }
  }]);
  assert.equal(childKillCalls, 0);
});

test("killSetupProcessTree falls back to child kill outside Windows process trees", () => {
  let childKillCalls = 0;
  const spawned = [];

  killSetupProcessTree({
    pid: 4321,
    kill: () => {
      childKillCalls += 1;
    }
  }, (...args) => {
    spawned.push(args);
    return fakeTaskkillProcess();
  }, "linux");

  assert.equal(childKillCalls, 1);
  assert.deepEqual(spawned, []);
});

test("createModelSetupService starts PowerShell with a known setup script only", async () => {
  const spawned = [];
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: (file, args, options) => {
      spawned.push({ file, args, options });
      return fakeChildProcess({ code: 0, stdout: ["ok"] });
    },
    refreshAssets: async () => readyAssets()
  });

  const result = await service.start("whisper");

  assert.equal(result.type, "whisper");
  assert.equal(result.status, "complete");
  assert.equal(spawned[0].file, "powershell.exe");
  assert.deepEqual(spawned[0].args, [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join("C:/app", "scripts", "setup-whisper.ps1"),
    "-Model",
    "base",
    "-InstallDir",
    path.join("C:/app", "vendor", "whisper")
  ]);
  assert.equal(spawned[0].options.windowsHide, true);
});

test("createModelSetupService passes packaged setup roots and Electron node env", async () => {
  const spawned = [];
  const scriptRootPath = "C:/Program Files/Local Flow/resources/app";
  const assetRootPath = "C:/Program Files/Local Flow/resources";
  const nodeExecutable = "C:/Program Files/Local Flow/Local Flow.exe";
  const service = createModelSetupService({
    rootPath: "C:/fallback",
    scriptRootPath,
    assetRootPath,
    nodeExecutable,
    setupEnv: { ELECTRON_RUN_AS_NODE: "1" },
    spawn: (file, args, options) => {
      spawned.push({ file, args, options });
      return fakeChildProcess({ code: 0, stdout: ["ok"] });
    },
    refreshAssets: async () => readyAssets()
  });

  const result = await service.start("llm");

  assert.equal(result.status, "complete");
  assert.equal(spawned[0].file, "powershell.exe");
  assert.deepEqual(spawned[0].args, [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(scriptRootPath, "scripts", "setup-llm.ps1"),
    "-InstallDir",
    path.join(assetRootPath, "vendor", "llm"),
    "-NodeExe",
    nodeExecutable
  ]);
  assert.equal(spawned[0].options.windowsHide, true);
  assert.equal(spawned[0].options.env.ELECTRON_RUN_AS_NODE, "1");
});

test("setup scripts accept a NodeExe parameter for packaged builds", () => {
  const setupScripts = [
    readFileSync(path.join(process.cwd(), "scripts", "setup-whisper.ps1"), "utf8"),
    readFileSync(path.join(process.cwd(), "scripts", "setup-llm.ps1"), "utf8")
  ];

  for (const script of setupScripts) {
    assert.match(script, /\[string\]\$NodeExe = "node"/);
    assert.doesNotMatch(script, /&\s+node\b/);
    assert.doesNotMatch(script, /\|\s+node\b/);
    assert.match(script, /&\s+\$NodeExe\b/);
  }
});

test("setup scripts emit structured failure markers", () => {
  const whisperScript = readFileSync(path.join(process.cwd(), "scripts", "setup-whisper.ps1"), "utf8");
  const llmScript = readFileSync(path.join(process.cwd(), "scripts", "setup-llm.ps1"), "utf8");

  for (const reason of [
    "whisper_release_metadata",
    "whisper_release_asset_missing",
    "whisper_runtime_download",
    "whisper_extract_failed",
    "whisper_runtime_missing",
    "whisper_model_download"
  ]) {
    assert.match(whisperScript, new RegExp(`Fail-Setup -Code "${reason}"`));
  }

  for (const reason of [
    "llm_release_metadata",
    "llm_release_asset_missing",
    "llm_extract_failed",
    "llm_runtime_missing",
  ]) {
    assert.match(llmScript, new RegExp(`Fail-Setup -Code "${reason}"`));
  }
  assert.match(llmScript, /-FailureCode "llm_runtime_download"/);
  assert.match(llmScript, /-FailureCode "llm_model_download"/);

  assert.match(whisperScript, /LOCAL_FLOW_SETUP_ERROR:\$Code/);
  assert.match(llmScript, /LOCAL_FLOW_SETUP_ERROR:\$Code/);
});

test("setup-llm supports deployment supplied fallback download URLs", () => {
  const llmScript = readFileSync(path.join(process.cwd(), "scripts", "setup-llm.ps1"), "utf8");

  assert.match(llmScript, /Download-WithFallback/);
  assert.match(llmScript, /LOCAL_FLOW_LLAMA_RUNTIME_URL/);
  assert.match(llmScript, /LOCAL_FLOW_LLAMA_RUNTIME_MIRROR_URLS/);
  assert.match(llmScript, /LOCAL_FLOW_QWEN_MODEL_URL/);
  assert.match(llmScript, /LOCAL_FLOW_QWEN_MODEL_MIRROR_URLS/);
  assert.match(llmScript, /\$asset\.browser_download_url/);
  assert.match(llmScript, /\$modelMirrorUrl/);
});

test("createModelSetupService rejects inherited setup type names without spawning", async () => {
  let spawnCalls = 0;
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => {
      spawnCalls += 1;
      return fakeChildProcess({ code: 0 });
    },
    refreshAssets: async () => readyAssets()
  });

  await assert.rejects(
    service.start("toString"),
    /Unknown setup type: toString/
  );
  assert.equal(spawnCalls, 0);
});

test("createModelSetupService rejects duplicate setup requests for the same type", async () => {
  let closeProcess = null;
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => fakePendingChildProcess((close) => {
      closeProcess = close;
    }),
    refreshAssets: async () => ({ whisper: {}, llm: {} })
  });

  const firstRun = service.start("llm");

  await assert.rejects(
    service.start("llm"),
    /llm setup is already running/
  );

  closeProcess(0);
  await firstRun;
});

test("createModelSetupService cancels a running setup and allows retry", async () => {
  let attempts = 0;
  const killedPids = [];
  const service = createModelSetupService({
    rootPath: "C:/app",
    killProcessTree: (child) => {
      killedPids.push(child.pid);
    },
    spawn: () => {
      attempts += 1;
      if (attempts === 1) {
        return fakeStuckChildProcess();
      }
      return fakeChildProcess({ code: 0, stdout: ["retry ok\n"] });
    },
    refreshAssets: async () => readyAssets()
  });

  const firstRun = service.start("llm");
  await delay(0);

  const cancelled = service.cancel("llm");

  assert.equal(cancelled.status, "failed");
  assert.equal(cancelled.error, "Setup cancelled.");
  assert.deepEqual(killedPids, [2468]);
  assert.equal((await firstRun).status, "failed");
  assert.equal(service.getStatus("llm").status, "failed");

  const retry = await service.start("llm");

  assert.equal(retry.status, "complete");
  assert.equal(attempts, 2);
});

test("createModelSetupService returns current status when cancelling an idle setup", () => {
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => fakeChildProcess({ code: 0 }),
    refreshAssets: async () => readyAssets()
  });

  const status = service.cancel("llm");

  assert.equal(status.status, "idle");
});

test("createModelSetupService exposes setup output while the process is still running", async () => {
  let closeProcess = null;
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => fakePendingChildProcess((close) => {
      closeProcess = close;
    }, {
      stdout: ["Fetching latest whisper.cpp release metadata...\n"],
      stderr: ["Downloaded 5.0 MB / 141.1 MB\n"]
    }),
    refreshAssets: async () => readyAssets()
  });

  const firstRun = service.start("whisper");
  await delay(0);

  assert.deepEqual(service.getStatus("whisper").output, [
    "Fetching latest whisper.cpp release metadata...",
    "Downloaded 5.0 MB / 141.1 MB"
  ]);
  assert.equal(service.getStatus("whisper").status, "running");

  closeProcess(0);
  await firstRun;
});

test("createModelSetupService reports failed setup with captured output", async () => {
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => fakeChildProcess({
      code: 7,
      stdout: ["download started"],
      stderr: ["network failed"]
    }),
    refreshAssets: async () => ({ whisper: {}, llm: {} })
  });

  const result = await service.start("whisper");

  assert.equal(result.status, "failed");
  assert.equal(result.error, "Setup exited with code 7.");
  assert.deepEqual(result.output, ["download started", "network failed"]);
});

test("createModelSetupService classifies structured setup failures", async () => {
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => fakeChildProcess({
      code: 1,
      stdout: [
        "Downloading ggml-base.bin...\n",
        "LOCAL_FLOW_SETUP_ERROR:whisper_model_download\n"
      ],
      stderr: ["Download failed after 3 attempts: HTTP 403"]
    }),
    refreshAssets: async () => ({ whisper: {}, llm: {} })
  });

  const result = await service.start("whisper");

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "whisper_model_download");
  assert.match(result.error, /Whisper model download failed/);
  assert.deepEqual(result.output, [
    "Downloading ggml-base.bin...",
    "LOCAL_FLOW_SETUP_ERROR:whisper_model_download",
    "Download failed after 3 attempts: HTTP 403"
  ]);
});

test("createModelSetupService classifies timeout and spawn failures without leaking raw commands", async () => {
  const timeoutService = createModelSetupService({
    rootPath: "C:/app",
    setupTimeoutMs: 5,
    killProcessTree: () => {},
    spawnImpl: () => fakeStuckChildProcess(),
    refreshAssets: async () => readyAssets()
  });
  const timeoutResult = await Promise.race([
    timeoutService.start("whisper"),
    delay(50).then(() => ({ status: "timed-out-test-sentinel" }))
  ]);

  assert.equal(timeoutResult.status, "failed");
  assert.equal(timeoutResult.failureReason, "setup_timeout");
  assert.match(timeoutResult.error, /timed out/);
  assert.doesNotMatch(timeoutResult.error, /powershell\.exe/i);

  const spawnService = createModelSetupService({
    rootPath: "C:/app",
    spawnImpl: () => {
      throw new Error("spawn powershell.exe ENOENT");
    },
    refreshAssets: async () => readyAssets()
  });
  const spawnResult = await spawnService.start("llm");

  assert.equal(spawnResult.status, "failed");
  assert.equal(spawnResult.failureReason, "setup_spawn_failed");
  assert.match(spawnResult.error, /could not start/);
  assert.doesNotMatch(spawnResult.error, /ENOENT/);
});

test("createModelSetupService fails successful Whisper script when assets are not detected", async () => {
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawnImpl: () => fakeChildProcess({ code: 0, stdout: ["script complete\n"] }),
    refreshAssets: async () => ({ whisper: {}, llm: {} })
  });

  const result = await service.start("whisper");

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "whisper_assets_missing");
  assert.match(result.error, /Whisper setup finished but required assets were not found/);
  assert.deepEqual(result.output, ["script complete"]);
});

test("createModelSetupService fails successful LLM script when assets are not ready", async () => {
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawnImpl: () => fakeChildProcess({ code: 0, stdout: ["script complete\n"] }),
    refreshAssets: async () => ({ whisper: {}, llm: { ready: false } })
  });

  const result = await service.start("llm");

  assert.equal(result.status, "failed");
  assert.match(result.error, /Qwen setup finished but required assets were not found/);
  assert.deepEqual(result.output, ["script complete"]);
});

test("createModelSetupService buffers split output chunks into complete lines", async () => {
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => fakeOrderedChildProcess({
      code: 0,
      events: [
        ["stdout", "down"],
        ["stdout", "load\nnext\n"],
        ["stderr", "err"],
        ["stderr", "or\n"]
      ]
    }),
    refreshAssets: async () => ({ whisper: {}, llm: {} })
  });

  const result = await service.start("whisper");

  assert.deepEqual(result.output, ["download", "next", "error"]);
});

test("createModelSetupService caps output to the last 40 completed lines", async () => {
  const lines = Array.from({ length: 45 }, (_, index) => `line ${index + 1}`);
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => fakeChildProcess({
      code: 0,
      stdout: [`${lines.join("\n")}\n`]
    }),
    refreshAssets: async () => ({ whisper: {}, llm: {} })
  });

  const result = await service.start("whisper");

  assert.deepEqual(result.output, lines.slice(5));
});

test("createModelSetupService refreshes assets after process close", async () => {
  const order = [];
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => fakeCloseRecordingChildProcess(order),
    refreshAssets: async () => {
      order.push("refresh");
      return readyAssets();
    }
  });

  const result = await service.start("whisper");

  assert.equal(result.status, "complete");
  assert.deepEqual(order, ["close", "refresh"]);
});

test("createModelSetupService uses spawnImpl injection", async () => {
  let spawnImplCalls = 0;
  let legacySpawnCalls = 0;
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: () => {
      legacySpawnCalls += 1;
      return fakeChildProcess({ code: 0 });
    },
    spawnImpl: () => {
      spawnImplCalls += 1;
      return fakeChildProcess({ code: 0 });
    },
    refreshAssets: async () => readyAssets()
  });

  await service.start("llm");

  assert.equal(spawnImplCalls, 1);
  assert.equal(legacySpawnCalls, 0);
});

test("createModelSetupService records process errors as failed and allows retry", async () => {
  let attempts = 0;
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawnImpl: () => {
      attempts += 1;
      if (attempts === 1) {
        return fakeErrorChildProcess({
          error: new Error("PowerShell unavailable"),
          stdout: ["download\n"]
        });
      }
      return fakeChildProcess({ code: 0, stdout: ["retry ok\n"] });
    },
    refreshAssets: async () => readyAssets()
  });

  const failed = await service.start("whisper");

  assert.equal(failed.status, "failed");
  assert.match(failed.error, /PowerShell unavailable/);
  assert.deepEqual(failed.output, ["download"]);
  assert.equal(service.getStatus("whisper").status, "failed");

  const retry = await service.start("whisper");

  assert.equal(retry.status, "complete");
  assert.equal(attempts, 2);
});

test("createModelSetupService records spawn failures as failed and allows retry", async () => {
  let attempts = 0;
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawnImpl: () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("spawn failed");
      }
      return fakeChildProcess({ code: 0, stdout: ["retry ok\n"] });
    },
    refreshAssets: async () => readyAssets()
  });

  const failed = await service.start("whisper");

  assert.equal(failed.status, "failed");
  assert.match(failed.error, /spawn failed/);
  assert.equal(service.getStatus("whisper").status, "failed");

  const retry = await service.start("whisper");

  assert.equal(retry.status, "complete");
  assert.equal(attempts, 2);
});

test("createModelSetupService records refresh failures as failed and allows retry", async () => {
  let refreshAttempts = 0;
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawnImpl: () => fakeChildProcess({ code: 0, stdout: ["setup output\n"] }),
    refreshAssets: async () => {
      refreshAttempts += 1;
      if (refreshAttempts === 1) {
        throw new Error("asset scan failed");
      }
      return readyAssets();
    }
  });

  const failed = await service.start("whisper");

  assert.equal(failed.status, "failed");
  assert.match(failed.error, /asset scan failed/);
  assert.deepEqual(failed.output, ["setup output"]);
  assert.equal(service.getStatus("whisper").status, "failed");

  const retry = await service.start("whisper");

  assert.equal(retry.status, "complete");
  assert.equal(refreshAttempts, 2);
});

test("createModelSetupService returns status snapshots", async () => {
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawnImpl: () => fakeChildProcess({ code: 0, stdout: ["ok\n"] }),
    refreshAssets: async () => readyAssets()
  });

  await service.start("whisper");
  const status = service.getStatus("whisper");
  status.status = "running";
  status.output.push("mutated");

  assert.equal(service.getStatus("whisper").status, "complete");
  assert.deepEqual(service.getStatus("whisper").output, ["ok"]);
});

test("createModelSetupService snapshots shallow object fields", async () => {
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawnImpl: () => fakeChildProcess({ code: 0 }),
    refreshAssets: async () => ({ whisper: { ready: true }, llm: { ready: false } })
  });

  await service.start("whisper");
  const status = service.getStatus("whisper");
  status.assets.whisper.ready = false;

  assert.equal(service.getStatus("whisper").assets.whisper.ready, true);
});

test("createModelSetupService times out a stuck setup process and allows retry", async () => {
  let attempts = 0;
  const killedPids = [];
  const service = createModelSetupService({
    rootPath: "C:/app",
    setupTimeoutMs: 5,
    killProcessTree: (child) => {
      killedPids.push(child.pid);
    },
    spawnImpl: () => {
      attempts += 1;
      if (attempts === 1) {
        return fakeStuckChildProcess();
      }
      return fakeChildProcess({ code: 0, stdout: ["retry ok\n"] });
    },
    refreshAssets: async () => readyAssets()
  });

  const failed = await Promise.race([
    service.start("whisper"),
    delay(50).then(() => ({ status: "timed-out-test-sentinel" }))
  ]);

  assert.equal(failed.status, "failed");
  assert.match(failed.error, /timed out/);
  assert.deepEqual(killedPids, [2468]);
  assert.equal(service.getStatus("whisper").status, "failed");

  const retry = await service.start("whisper");

  assert.equal(retry.status, "complete");
  assert.equal(attempts, 2);
});

function fakeChildProcess({ code = 0, stdout = [], stderr = [] }) {
  const handlers = new Map();
  const child = {
    stdout: fakeStream(stdout),
    stderr: fakeStream(stderr),
    on(event, callback) {
      handlers.set(event, callback);
      if (event === "close") {
        queueMicrotask(() => callback(code));
      }
      return child;
    }
  };
  return child;
}

function fakeErrorChildProcess({ error, stdout = [], stderr = [] }) {
  const child = {
    stdout: fakeStream(stdout),
    stderr: fakeStream(stderr),
    on(event, callback) {
      if (event === "error") {
        queueMicrotask(() => callback(error));
      }
      return child;
    }
  };
  return child;
}

function fakeCloseRecordingChildProcess(order) {
  const child = {
    stdout: fakeStream([]),
    stderr: fakeStream([]),
    on(event, callback) {
      if (event === "close") {
        queueMicrotask(() => {
          order.push("close");
          callback(0);
        });
      }
      return child;
    }
  };
  return child;
}

function fakeOrderedChildProcess({ code = 0, events = [] }) {
  const handlers = new Map();
  const streamHandlers = {
    stdout: new Map(),
    stderr: new Map()
  };
  const child = {
    stdout: fakeControlledStream(streamHandlers.stdout),
    stderr: fakeControlledStream(streamHandlers.stderr),
    on(event, callback) {
      handlers.set(event, callback);
      if (event === "close") {
        queueMicrotask(() => {
          for (const [streamName, chunk] of events) {
            streamHandlers[streamName].get("data")?.(Buffer.from(chunk));
          }
          callback(code);
        });
      }
      return child;
    }
  };
  return child;
}

function fakeStream(chunks) {
  return {
    on(event, callback) {
      if (event === "data") {
        for (const chunk of chunks) {
          queueMicrotask(() => callback(Buffer.from(chunk)));
        }
      }
      return this;
    }
  };
}

function fakeControlledStream(handlers) {
  return {
    on(event, callback) {
      handlers.set(event, callback);
      return this;
    }
  };
}

function fakePendingChildProcess(registerClose, { stdout = [], stderr = [] } = {}) {
  const child = {
    stdout: fakeStream(stdout),
    stderr: fakeStream(stderr),
    on(event, callback) {
      if (event === "close") {
        registerClose(callback);
      }
      return child;
    }
  };
  return child;
}

function fakeStuckChildProcess() {
  const child = {
    pid: 2468,
    stdout: fakeStream([]),
    stderr: fakeStream([]),
    on() {
      return child;
    },
    kill() {
      return true;
    }
  };
  return child;
}

function fakeTaskkillProcess() {
  const child = {
    on() {
      return child;
    }
  };
  return child;
}

function readyAssets() {
  return {
    whisper: {
      whisperCliPath: "C:/app/vendor/whisper/bin/Release/whisper-cli.exe",
      whisperModelPath: "C:/app/vendor/whisper/models/ggml-base.bin"
    },
    llm: {
      ready: true,
      cliPath: "C:/app/vendor/llm/bin/llama-cli.exe",
      modelPath: "C:/app/vendor/llm/models/Qwen3-4B-Q4_K_M.gguf"
    }
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
