import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  createModelSetupService,
  getModelSetupScript
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

test("createModelSetupService starts PowerShell with a known setup script only", async () => {
  const spawned = [];
  const service = createModelSetupService({
    rootPath: "C:/app",
    spawn: (file, args, options) => {
      spawned.push({ file, args, options });
      return fakeChildProcess({ code: 0, stdout: ["ok"] });
    },
    refreshAssets: async () => ({ whisper: { ready: true }, llm: { ready: false } })
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
    refreshAssets: async () => ({ whisper: {}, llm: {} })
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

function fakePendingChildProcess(registerClose) {
  const child = {
    stdout: fakeStream([]),
    stderr: fakeStream([]),
    on(event, callback) {
      if (event === "close") {
        registerClose(callback);
      }
      return child;
    }
  };
  return child;
}
