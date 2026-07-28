import test from "node:test";
import assert from "node:assert/strict";
import {
  collectDetectedModelPaths,
  refreshDetectedModelPaths,
  wireModelSetupIpc
} from "../src/main/model-setup-ipc.js";

test("collectDetectedModelPaths maps only detected local model paths", () => {
  assert.deepEqual(collectDetectedModelPaths({
    whisper: {
      whisperCliPath: "C:/app/vendor/whisper/whisper-cli.exe",
      whisperModelPath: "C:/app/vendor/whisper/ggml-base.bin"
    },
    llm: {
      cliPath: "C:/app/vendor/llm/llama-cli.exe",
      modelPath: "C:/app/vendor/llm/Qwen3-4B-Q4_K_M.gguf",
      serverPath: "C:/app/vendor/llm/llama-server.exe"
    }
  }), {
    whisperCliPath: "C:/app/vendor/whisper/whisper-cli.exe",
    whisperModelPath: "C:/app/vendor/whisper/ggml-base.bin",
    embeddedLlmCliPath: "C:/app/vendor/llm/llama-cli.exe",
    embeddedLlmModelPath: "C:/app/vendor/llm/Qwen3-4B-Q4_K_M.gguf"
  });

  assert.deepEqual(collectDetectedModelPaths({
    whisper: {},
    llm: {
      cliPath: "",
      modelPath: ""
    }
  }), {});
});

test("refreshDetectedModelPaths saves detected paths without requesting secret-bearing return values", async () => {
  const saved = [];
  const status = {
    assets: {
      whisper: {
        whisperCliPath: "C:/whisper/whisper-cli.exe",
        whisperModelPath: "C:/whisper/ggml-base.bin"
      },
      llm: {
        cliPath: "C:/llm/llama-cli.exe",
        modelPath: "C:/llm/Qwen3-4B-Q4_K_M.gguf"
      }
    },
    setups: {}
  };
  const result = await refreshDetectedModelPaths({
    modelSetupService: {
      refresh: async () => status
    },
    settingsStore: {
      saveSettings: async (...args) => {
        saved.push(args);
      }
    }
  });

  assert.deepEqual(result, {
    assets: {
      whisper: { ready: true },
      llm: { ready: false }
    },
    setups: {}
  });
  assert.deepEqual(saved, [[{
    whisperCliPath: "C:/whisper/whisper-cli.exe",
    whisperModelPath: "C:/whisper/ggml-base.bin",
    embeddedLlmCliPath: "C:/llm/llama-cli.exe",
    embeddedLlmModelPath: "C:/llm/Qwen3-4B-Q4_K_M.gguf"
  }]]);
});

test("refreshDetectedModelPaths does not save when no paths are detected", async () => {
  let saveCalls = 0;
  const status = {
    assets: {
      whisper: {},
      llm: {
        ready: false
      }
    },
    setups: {}
  };

  const result = await refreshDetectedModelPaths({
    modelSetupService: {
      refresh: async () => status
    },
    settingsStore: {
      saveSettings: async () => {
        saveCalls += 1;
      }
    }
  });

  assert.deepEqual(result, {
    assets: {
      whisper: { ready: false },
      llm: { ready: false }
    },
    setups: {}
  });
  assert.equal(saveCalls, 0);
});

test("model setup start IPC returns failed setup result without persisting stale assets", async () => {
  const handlers = new Map();
  let saveCalls = 0;
  const failedResult = {
    type: "whisper",
    status: "failed",
    error: "Setup exited with code 7.",
    output: ["download failed"],
    assets: {
      whisper: {
        whisperCliPath: "C:/old/whisper-cli.exe",
        whisperModelPath: "C:/old/ggml-base.bin"
      },
      llm: {}
    }
  };

  wireModelSetupIpc({
    ipcMain: fakeIpcMain(handlers),
    modelSetupService: {
      refresh: async () => ({ assets: {}, setups: {} }),
      start: async () => failedResult
    },
    settingsStore: {
      saveSettings: async () => {
        saveCalls += 1;
        throw new Error("settings write should not run");
      }
    }
  });

  const result = await handlers.get("models:setup-start")(null, "whisper");

  assert.deepEqual(result, {
    assets: {
      whisper: { ready: true },
      llm: { ready: false }
    },
    setups: {
      whisper: {
        type: "whisper",
        status: "failed",
        failureReason: "setup_failed"
      }
    }
  });
  assert.equal(saveCalls, 0);
});

test("model setup start IPC persists detected paths only after complete setup", async () => {
  const handlers = new Map();
  const saved = [];
  const completeResult = {
    type: "llm",
    status: "complete",
    output: ["setup complete"],
    assets: {
      whisper: {},
      llm: {
        cliPath: "C:/llm/llama-cli.exe",
        modelPath: "C:/llm/Qwen3-4B-Q4_K_M.gguf"
      }
    }
  };

  wireModelSetupIpc({
    ipcMain: fakeIpcMain(handlers),
    modelSetupService: {
      refresh: async () => ({ assets: {}, setups: {} }),
      start: async (_type) => completeResult
    },
    settingsStore: {
      saveSettings: async (...args) => {
        saved.push(args);
      }
    }
  });

  const result = await handlers.get("models:setup-start")(null, "llm");

  assert.deepEqual(result, {
    assets: {
      whisper: { ready: false },
      llm: { ready: false }
    },
    setups: {
      llm: {
        type: "llm",
        status: "complete"
      }
    }
  });
  assert.deepEqual(saved, [[{
    embeddedLlmCliPath: "C:/llm/llama-cli.exe",
    embeddedLlmModelPath: "C:/llm/Qwen3-4B-Q4_K_M.gguf"
  }]]);
});

test("model setup status IPC only refreshes setup status without saving settings", async () => {
  const handlers = new Map();
  let saveCalls = 0;
  const status = {
    assets: {
      whisper: {
        whisperCliPath: "C:/whisper/whisper-cli.exe"
      }
    },
    setups: {}
  };

  wireModelSetupIpc({
    ipcMain: fakeIpcMain(handlers),
    modelSetupService: {
      refresh: async () => status,
      start: async () => ({ status: "complete" })
    },
    settingsStore: {
      saveSettings: async () => {
        saveCalls += 1;
      }
    }
  });

  const result = await handlers.get("models:setup-status")();

  assert.deepEqual(result, {
    assets: {
      whisper: { ready: false },
      llm: { ready: false }
    },
    setups: {}
  });
  assert.equal(saveCalls, 0);
});

test("model setup cancel IPC delegates to the setup service", async () => {
  const handlers = new Map();
  const calls = [];
  const cancelled = {
    type: "llm",
    status: "failed",
    error: "Setup cancelled.",
    output: ["download started"]
  };

  wireModelSetupIpc({
    ipcMain: fakeIpcMain(handlers),
    modelSetupService: {
      refresh: async () => ({ assets: {}, setups: {} }),
      start: async () => ({ status: "complete" }),
      cancel: (type) => {
        calls.push(type);
        return cancelled;
      }
    },
    settingsStore: {
      saveSettings: async () => {
        throw new Error("cancel should not save settings");
      }
    }
  });

  const result = await handlers.get("models:setup-cancel")(null, "llm");

  assert.deepEqual(result, {
    assets: {
      whisper: { ready: false },
      llm: { ready: false }
    },
    setups: {
      llm: {
        type: "llm",
        status: "failed",
        failureReason: "setup_failed"
      }
    }
  });
  assert.deepEqual(calls, ["llm"]);
});

function fakeIpcMain(handlers) {
  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
}
