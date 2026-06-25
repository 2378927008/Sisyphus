import test from "node:test";
import assert from "node:assert/strict";
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
    "base"
  ]);
  assert.equal(spawned[0].options.windowsHide, true);
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

test("createModelSetupService fails successful Whisper script when assets are not detected", async () => {
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawnImpl: () => fakeChildProcess({ code: 0, stdout: ["script complete\n"] }),
    refreshAssets: async () => ({ whisper: {}, llm: {} })
  });

  const result = await service.start("whisper");

  assert.equal(result.status, "failed");
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
