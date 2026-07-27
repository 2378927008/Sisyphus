import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSettingsStore, mergeSettings, defaultSettings } from "../src/main/settings-store.js";

test("mergeSettings preserves defaults for missing values", () => {
  const settings = mergeSettings({ whisperModelPath: "C:/models/ggml-small.bin" });

  assert.equal(settings.whisperModelPath, "C:/models/ggml-small.bin");
  assert.equal(settings.hotkey, defaultSettings.hotkey);
  assert.equal(settings.ollamaBaseUrl, defaultSettings.ollamaBaseUrl);
  assert.equal(settings.asrProvider, "localWhisper");
  assert.equal(settings.cloudApiBaseUrl, "");
  assert.equal(settings.cloudApiKey, "");
  assert.equal(settings.interfaceLanguage, "zh-Hans");
  assert.equal(settings.whisperLanguage, "auto");
  assert.equal(settings.outputLanguage, "auto");
  assert.equal(settings.llmProvider, "mymemory");
});

test("mergeSettings ignores unknown keys", () => {
  const settings = mergeSettings({ unknown: true, hotkey: "CommandOrControl+Alt+Space" });

  assert.equal(settings.hotkey, "CommandOrControl+Alt+Space");
  assert.equal("unknown" in settings, false);
});

test("mergeSettings includes Windows productization defaults", () => {
  const settings = mergeSettings();

  assert.equal(settings.launchAtLogin, false);
  assert.equal(settings.startMinimizedToTray, false);
  assert.equal(settings.globalShortcutPaused, false);
  assert.equal(settings.shortcutMode, "toggle");
  assert.equal(settings.pasteLastHotkey, "CommandOrControl+Alt+V");
});

test("mergeSettings normalizes Windows productization settings", () => {
  const settings = mergeSettings({
    launchAtLogin: 1,
    startMinimizedToTray: "yes",
    globalShortcutPaused: "",
    shortcutMode: "hold",
    pasteLastHotkey: " CommandOrControl+Shift+V "
  });

  assert.equal(settings.launchAtLogin, true);
  assert.equal(settings.startMinimizedToTray, true);
  assert.equal(settings.globalShortcutPaused, false);
  assert.equal(settings.shortcutMode, "hold");
  assert.equal(settings.pasteLastHotkey, "CommandOrControl+Shift+V");
});

test("mergeSettings rejects unsupported shortcut modes and allows clearing paste-last hotkey", () => {
  const settings = mergeSettings({
    shortcutMode: "press",
    pasteLastHotkey: "   "
  });

  assert.equal(settings.shortcutMode, "toggle");
  assert.equal(settings.pasteLastHotkey, "");
});

test("mergeSettings accepts default overrides", () => {
  const settings = mergeSettings({}, {
    ...defaultSettings,
    whisperCliPath: "C:/project/vendor/whisper/bin/Release/whisper-cli.exe"
  });

  assert.equal(settings.whisperCliPath, "C:/project/vendor/whisper/bin/Release/whisper-cli.exe");
});

test("mergeSettings fills empty saved Whisper paths from detected defaults", () => {
  const settings = mergeSettings(
    { whisperCliPath: "", whisperModelPath: "" },
    {
      ...defaultSettings,
      whisperCliPath: "C:/project/vendor/whisper/bin/Release/whisper-cli.exe",
      whisperModelPath: "C:/project/vendor/whisper/models/ggml-base.bin"
    }
  );

  assert.equal(settings.whisperCliPath, "C:/project/vendor/whisper/bin/Release/whisper-cli.exe");
  assert.equal(settings.whisperModelPath, "C:/project/vendor/whisper/models/ggml-base.bin");
});

test("mergeSettings keeps supported language preferences", () => {
  const settings = mergeSettings({
    interfaceLanguage: "ja",
    whisperLanguage: "es",
    outputLanguage: "fr"
  });

  assert.equal(settings.interfaceLanguage, "ja");
  assert.equal(settings.whisperLanguage, "es");
  assert.equal(settings.outputLanguage, "fr");
});

test("mergeSettings rejects unsupported language preferences", () => {
  const settings = mergeSettings({
    interfaceLanguage: "pt-BR",
    whisperLanguage: "zh-Hant",
    outputLanguage: "de"
  });

  assert.equal(settings.interfaceLanguage, "zh-Hans");
  assert.equal(settings.whisperLanguage, "auto");
  assert.equal(settings.outputLanguage, "auto");
});

test("mergeSettings maps legacy original output language to automatic same-language output", () => {
  const settings = mergeSettings({ outputLanguage: "original" });

  assert.equal(settings.outputLanguage, "auto");
});

test("mergeSettings maps legacy translate polish mode to same-language polish", () => {
  const settings = mergeSettings({ polishMode: "translate" });

  assert.equal(settings.polishMode, "polish");
});

test("mergeSettings normalizes invalid provider preferences", () => {
  const settings = mergeSettings({
    asrProvider: "bad-asr",
    llmProvider: "bad-text"
  });

  assert.equal(settings.asrProvider, "localWhisper");
  assert.equal(settings.llmProvider, "mymemory");
});

test("mergeSettings reports recording ready when Whisper paths are configured", () => {
  const settings = mergeSettings({
    whisperCliPath: "C:/tools/whisper-cli.exe",
    whisperModelPath: "C:/models/ggml-base.bin"
  });

  assert.equal(settings.providerStatus.readyToRecord, true);
});

test("createSettingsStore accepts optional settings I/O dependencies", async () => {
  let readCalls = 0;
  const store = createSettingsStore(
    "C:/virtual-local-flow",
    defaultSettings,
    null,
    {
      readFile: async () => {
        readCalls += 1;
        const error = new Error("missing settings");
        error.code = "ENOENT";
        throw error;
      },
      writeFile: async () => {},
      mkdir: async () => {},
      rename: async () => {},
      rm: async () => {},
      randomUUID: () => "test-id",
      stat: async () => {
        const error = new Error("missing asset");
        error.code = "ENOENT";
        throw error;
      }
    }
  );

  const settings = await store.getSettings();

  assert.equal(readCalls, 1);
  assert.equal(settings.hotkey, defaultSettings.hotkey);
});

test("saveSettings serializes full user settings with detected setup paths", async () => {
  const controlledIo = createFirstWriteBarrierIo();
  const store = createSettingsStore("C:/virtual-local-flow", defaultSettings, null, controlledIo.io);
  const fullUserSave = store.saveSettings({
    ...defaultSettings,
    hotkey: "CommandOrControl+Shift+Space",
    outputLanguage: "fr"
  });
  await controlledIo.firstWriteStarted;

  assert.equal(controlledIo.readCommitted(), null);
  assert.equal(controlledIo.temporaryCount, 1);

  const setupPathSave = store.saveSettings({
    whisperCliPath: "C:/local-flow/whisper-cli.exe",
    whisperModelPath: "C:/local-flow/ggml-base.bin"
  });
  const readsBeforeFirstWriteCompleted = controlledIo.readCalls;

  controlledIo.releaseFirstWrite();
  await Promise.all([fullUserSave, setupPathSave]);
  const persisted = controlledIo.readPersisted();

  assert.equal(controlledIo.temporaryCount, 0);
  assert.equal(readsBeforeFirstWriteCompleted, 1);
  assert.equal(persisted.hotkey, "CommandOrControl+Shift+Space");
  assert.equal(persisted.outputLanguage, "fr");
  assert.equal(persisted.whisperCliPath, "C:/local-flow/whisper-cli.exe");
  assert.equal(persisted.whisperModelPath, "C:/local-flow/ggml-base.bin");
});

test("getSettings waits for an in-flight save and reads its committed value", async () => {
  const controlledIo = createFirstWriteBarrierIo();
  const store = createSettingsStore("C:/virtual-local-flow", defaultSettings, null, controlledIo.io);
  const save = store.saveSettings({ outputLanguage: "es" });
  await controlledIo.firstWriteStarted;

  const get = store.getSettings();
  const readsBeforeFirstWriteCompleted = controlledIo.readCalls;

  controlledIo.releaseFirstWrite();
  const [, settings] = await Promise.all([save, get]);

  assert.equal(readsBeforeFirstWriteCompleted, 1);
  assert.equal(settings.outputLanguage, "es");
});

test("settings operation queue recovers after a rejected save", async () => {
  let content = null;
  let writeCalls = 0;
  const store = createSettingsStore("C:/virtual-local-flow", defaultSettings, null, {
    mkdir: async () => {},
    readFile: async () => {
      if (content === null) {
        const error = new Error("missing settings");
        error.code = "ENOENT";
        throw error;
      }
      return content;
    },
    stat: async () => ({ isFile: () => true }),
    writeFile: async (_filePath, nextContent) => {
      writeCalls += 1;
      if (writeCalls === 1) {
        throw new Error("injected settings write failure");
      }
      content = nextContent;
    },
    rename: async () => {},
    rm: async () => {},
    randomUUID: () => "test-id"
  });

  await assert.rejects(
    store.saveSettings({ hotkey: "CommandOrControl+Shift+Space" }),
    /injected settings write failure/
  );
  const saved = await store.saveSettings({ outputLanguage: "ja" });

  assert.equal(writeCalls, 2);
  assert.equal(saved.outputLanguage, "ja");
  assert.equal(JSON.parse(content).outputLanguage, "ja");
});

test("getSettings repairs missing persisted local model paths from detected vendor defaults", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));
  const vendorPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-vendor-"));

  try {
    const whisperCliPath = path.join(vendorPath, "vendor", "whisper", "bin", "Release", "whisper-cli.exe");
    const whisperModelPath = path.join(vendorPath, "vendor", "whisper", "models", "ggml-base.bin");
    const embeddedLlmCliPath = path.join(vendorPath, "vendor", "llm", "bin", "llama-cli.exe");
    const embeddedLlmModelPath = path.join(vendorPath, "vendor", "llm", "models", "Qwen3-4B-Q4_K_M.gguf");
    await mkdir(path.dirname(whisperCliPath), { recursive: true });
    await mkdir(path.dirname(whisperModelPath), { recursive: true });
    await mkdir(path.dirname(embeddedLlmCliPath), { recursive: true });
    await mkdir(path.dirname(embeddedLlmModelPath), { recursive: true });
    await writeFile(whisperCliPath, "exe", "utf8");
    await writeFile(whisperModelPath, "model", "utf8");
    await writeFile(embeddedLlmCliPath, "exe", "utf8");
    await writeFile(embeddedLlmModelPath, "model", "utf8");

    const settingsPath = path.join(userDataPath, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify({
      whisperCliPath: path.join(vendorPath, "missing", "old-whisper-cli.exe"),
      whisperModelPath: path.join(vendorPath, "missing", "old-ggml-base.bin"),
      embeddedLlmCliPath: path.join(vendorPath, "missing", "old-llama-cli.exe"),
      embeddedLlmModelPath: path.join(vendorPath, "missing", "old-qwen.gguf")
    }, null, 2)}\n`, "utf8");

    const store = createSettingsStore(userDataPath, {
      ...defaultSettings,
      whisperCliPath,
      whisperModelPath,
      embeddedLlmCliPath,
      embeddedLlmModelPath
    });
    const settings = await store.getSettings();

    assert.equal(settings.whisperCliPath, whisperCliPath);
    assert.equal(settings.whisperModelPath, whisperModelPath);
    assert.equal(settings.embeddedLlmCliPath, embeddedLlmCliPath);
    assert.equal(settings.embeddedLlmModelPath, embeddedLlmModelPath);
    assert.equal(settings.providerStatus.readyToRecord, true);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
    await rm(vendorPath, { recursive: true, force: true });
  }
});

test("getSettings clears missing persisted local model paths when no detected default exists", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));

  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify({
      outputLanguage: "en",
      llmProvider: "embedded",
      embeddedLlmCliPath: path.join(userDataPath, "missing", "old-llama-cli.exe"),
      embeddedLlmModelPath: path.join(userDataPath, "missing", "old-qwen.gguf"),
      cloudApiKeyEncrypted: "preserve-encrypted-secret"
    }, null, 2)}\n`, "utf8");

    const store = createSettingsStore(userDataPath, defaultSettings);
    const settings = await store.getSettings();
    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));

    assert.equal(settings.embeddedLlmCliPath, "");
    assert.equal(settings.embeddedLlmModelPath, "");
    assert.equal(settings.providerStatus.text.configured, false);
    assert.equal(settings.providerStatus.text.blockedReason, "embedded_llm_not_configured");
    assert.equal(persisted.embeddedLlmCliPath, "");
    assert.equal(persisted.embeddedLlmModelPath, "");
    assert.equal(persisted.cloudApiKeyEncrypted, "preserve-encrypted-secret");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("getSettings keeps existing custom local model paths", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));
  const vendorPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-vendor-"));

  try {
    const customWhisperCliPath = path.join(vendorPath, "custom", "whisper-cli.exe");
    const customWhisperModelPath = path.join(vendorPath, "custom", "ggml-small.bin");
    await mkdir(path.dirname(customWhisperCliPath), { recursive: true });
    await writeFile(customWhisperCliPath, "exe", "utf8");
    await writeFile(customWhisperModelPath, "model", "utf8");

    const settingsPath = path.join(userDataPath, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify({
      whisperCliPath: customWhisperCliPath,
      whisperModelPath: customWhisperModelPath
    }, null, 2)}\n`, "utf8");

    const store = createSettingsStore(userDataPath, {
      ...defaultSettings,
      whisperCliPath: path.join(vendorPath, "vendor", "whisper", "bin", "Release", "whisper-cli.exe"),
      whisperModelPath: path.join(vendorPath, "vendor", "whisper", "models", "ggml-base.bin")
    });
    const settings = await store.getSettings();

    assert.equal(settings.whisperCliPath, customWhisperCliPath);
    assert.equal(settings.whisperModelPath, customWhisperModelPath);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
    await rm(vendorPath, { recursive: true, force: true });
  }
});

test("saveSettings preserves persisted provider settings across partial saves", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));

  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify({
      asrProvider: "customOpenAiCompatible",
      cloudApiBaseUrl: "https://api.example.test/v1",
      cloudApiKey: "secret-key",
      llmProvider: "groq"
    }, null, 2)}\n`, "utf8");

    const store = createSettingsStore(userDataPath);
    const saved = await store.saveSettings({ hotkey: "CommandOrControl+Shift+Space" });
    const privateSettings = await store.getSettings({ includeSecrets: true });
    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));

    assert.equal(saved.hotkey, "CommandOrControl+Shift+Space");
    assert.equal(saved.asrProvider, "customOpenAiCompatible");
    assert.equal(saved.cloudApiBaseUrl, "https://api.example.test/v1");
    assert.equal(saved.cloudApiKey, "");
    assert.equal(privateSettings.cloudApiKey, "secret-key");
    assert.equal(saved.llmProvider, "groq");
    assert.equal(persisted.asrProvider, "customOpenAiCompatible");
    assert.equal(persisted.cloudApiBaseUrl, "https://api.example.test/v1");
    assert.equal(persisted.cloudApiKey, "secret-key");
    assert.equal("providerStatus" in persisted, false);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("saveSettings preserves persisted providers when partial save sends empty values", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));

  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify({
      asrProvider: "customOpenAiCompatible",
      cloudApiBaseUrl: "https://api.example.test/v1",
      cloudApiKey: "secret-key",
      llmProvider: "groq"
    }, null, 2)}\n`, "utf8");

    const store = createSettingsStore(userDataPath);
    const saved = await store.saveSettings({
      hotkey: "CommandOrControl+Shift+Space",
      asrProvider: null,
      llmProvider: ""
    });
    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));

    assert.equal(saved.asrProvider, "customOpenAiCompatible");
    assert.equal(saved.llmProvider, "groq");
    assert.equal(persisted.asrProvider, "customOpenAiCompatible");
    assert.equal(persisted.llmProvider, "groq");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("saveSettings applies explicit valid provider changes", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));

  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify({
      asrProvider: "customOpenAiCompatible",
      cloudApiKey: "secret-key",
      llmProvider: "groq"
    }, null, 2)}\n`, "utf8");

    const store = createSettingsStore(userDataPath);
    const saved = await store.saveSettings({
      asrProvider: "localWhisper",
      llmProvider: "ollama"
    });
    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));

    assert.equal(saved.asrProvider, "localWhisper");
    assert.equal(saved.llmProvider, "ollama");
    assert.equal(persisted.asrProvider, "localWhisper");
    assert.equal(persisted.llmProvider, "ollama");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("saveSettings persists Windows productization settings", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));

  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    const store = createSettingsStore(userDataPath);
    await store.saveSettings({
      launchAtLogin: true,
      startMinimizedToTray: true,
      globalShortcutPaused: true,
      shortcutMode: "hold",
      pasteLastHotkey: "CommandOrControl+Shift+V"
    });

    const settings = await store.getSettings();
    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));

    assert.equal(settings.launchAtLogin, true);
    assert.equal(settings.startMinimizedToTray, true);
    assert.equal(settings.globalShortcutPaused, true);
    assert.equal(settings.shortcutMode, "hold");
    assert.equal(settings.pasteLastHotkey, "CommandOrControl+Shift+V");
    assert.equal(persisted.launchAtLogin, true);
    assert.equal(persisted.startMinimizedToTray, true);
    assert.equal(persisted.globalShortcutPaused, true);
    assert.equal(persisted.shortcutMode, "hold");
    assert.equal(persisted.pasteLastHotkey, "CommandOrControl+Shift+V");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("saveSettings persists model download source settings", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));

  try {
    const store = createSettingsStore(userDataPath);

    await store.saveSettings({
      whisperRuntimeUrl: " https://mirror.example/whisper.zip ",
      whisperRuntimeMirrorUrls: "https://backup.example/whisper.zip",
      whisperModelUrl: "https://mirror.example/ggml-base.bin",
      whisperModelMirrorUrls: "https://backup.example/ggml-base.bin",
      llamaRuntimeUrl: "https://mirror.example/llama.zip",
      llamaRuntimeMirrorUrls: "https://backup.example/llama.zip",
      qwenModelUrl: "https://mirror.example/Qwen3-4B-Q4_K_M.gguf",
      qwenModelMirrorUrls: "https://backup.example/Qwen3-4B-Q4_K_M.gguf"
    });

    const settings = await store.getSettings();

    assert.equal(settings.whisperRuntimeUrl, "https://mirror.example/whisper.zip");
    assert.equal(settings.whisperRuntimeMirrorUrls, "https://backup.example/whisper.zip");
    assert.equal(settings.whisperModelUrl, "https://mirror.example/ggml-base.bin");
    assert.equal(settings.whisperModelMirrorUrls, "https://backup.example/ggml-base.bin");
    assert.equal(settings.llamaRuntimeUrl, "https://mirror.example/llama.zip");
    assert.equal(settings.llamaRuntimeMirrorUrls, "https://backup.example/llama.zip");
    assert.equal(settings.qwenModelUrl, "https://mirror.example/Qwen3-4B-Q4_K_M.gguf");
    assert.equal(settings.qwenModelMirrorUrls, "https://backup.example/Qwen3-4B-Q4_K_M.gguf");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("getSettings redacts cloud credentials unless secrets are explicitly requested", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));

  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify({
      asrProvider: "customOpenAiCompatible",
      cloudApiBaseUrl: "https://api.example.test/v1",
      cloudApiKey: "secret-key",
      llmProvider: "embedded"
    }, null, 2)}\n`, "utf8");

    const store = createSettingsStore(userDataPath);
    const publicSettings = await store.getSettings();
    const privateSettings = await store.getSettings({ includeSecrets: true });

    assert.equal(publicSettings.cloudApiKey, "");
    assert.equal(publicSettings.providerStatus.asr.configured, true);
    assert.equal(privateSettings.cloudApiKey, "secret-key");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("saveSettings preserves persisted cloud credentials when partial save omits them", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));

  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify({
      asrProvider: "customOpenAiCompatible",
      cloudApiBaseUrl: "https://api.example.test/v1",
      cloudApiKey: "secret-key",
      llmProvider: "customOpenAiCompatible"
    }, null, 2)}\n`, "utf8");

    const store = createSettingsStore(userDataPath);
    const saved = await store.saveSettings({
      hotkey: "CommandOrControl+Shift+Space"
    });
    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));

    assert.equal(saved.cloudApiBaseUrl, "https://api.example.test/v1");
    assert.equal(saved.cloudApiKey, "");
    assert.equal(persisted.cloudApiBaseUrl, "https://api.example.test/v1");
    assert.equal(persisted.cloudApiKey, "secret-key");
    assert.equal("providerStatus" in persisted, false);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("saveSettings clears persisted cloud credentials when explicitly emptied", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));

  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify({
      asrProvider: "customOpenAiCompatible",
      cloudApiBaseUrl: "https://api.example.test/v1",
      cloudApiKey: "secret-key",
      llmProvider: "customOpenAiCompatible"
    }, null, 2)}\n`, "utf8");

    const store = createSettingsStore(userDataPath);
    const saved = await store.saveSettings({
      cloudApiBaseUrl: "",
      cloudApiKey: null
    });
    const privateSettings = await store.getSettings({ includeSecrets: true });
    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));

    assert.equal(saved.cloudApiBaseUrl, "");
    assert.equal(saved.cloudApiKey, "");
    assert.equal(privateSettings.cloudApiBaseUrl, "");
    assert.equal(privateSettings.cloudApiKey, "");
    assert.equal(persisted.cloudApiBaseUrl, "");
    assert.equal(persisted.cloudApiKey, "");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("saveSettings applies explicit cloud credential changes", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));

  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify({
      asrProvider: "customOpenAiCompatible",
      cloudApiBaseUrl: "https://api.example.test/v1",
      cloudApiKey: "secret-key",
      llmProvider: "customOpenAiCompatible"
    }, null, 2)}\n`, "utf8");

    const store = createSettingsStore(userDataPath);
    const saved = await store.saveSettings({
      cloudApiBaseUrl: "https://api.updated.test/v1",
      cloudApiKey: "updated-key"
    });
    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));

    assert.equal(saved.cloudApiBaseUrl, "https://api.updated.test/v1");
    assert.equal(saved.cloudApiKey, "");
    assert.equal(persisted.cloudApiBaseUrl, "https://api.updated.test/v1");
    assert.equal(persisted.cloudApiKey, "updated-key");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("saveSettings uses an injected secret codec instead of persisting raw cloud API keys", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-settings-"));
  const secretCodec = {
    encrypt: (value) => Buffer.from(`coded:${value}`).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8").replace(/^coded:/, "")
  };

  try {
    const settingsPath = path.join(userDataPath, "settings.json");
    const store = createSettingsStore(userDataPath, defaultSettings, secretCodec);
    await store.saveSettings({
      asrProvider: "customOpenAiCompatible",
      cloudApiBaseUrl: "https://api.example.test/v1",
      cloudApiKey: "secret-key"
    });

    const publicSettings = await store.getSettings();
    const privateSettings = await store.getSettings({ includeSecrets: true });
    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));

    assert.equal(publicSettings.cloudApiKey, "");
    assert.equal(privateSettings.cloudApiKey, "secret-key");
    assert.equal(persisted.cloudApiKey, undefined);
    assert.equal(typeof persisted.cloudApiKeyEncrypted, "string");
    assert.notEqual(persisted.cloudApiKeyEncrypted, "secret-key");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("history updates preserve transcript and serialize writes", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-flow-history-"));

  try {
    const store = createSettingsStore(userDataPath);
    await store.addHistory({ id: "h1", transcript: "原文", text: "旧文本", status: "complete" });
    const [first, second] = await Promise.all([
      store.updateHistory("h1", { transcript: "篡改", text: "新文本", processingError: "x".repeat(300) }),
      store.updateHistory("h1", { pasteStatus: "pasted" })
    ]);
    const persisted = await store.getHistoryEntry("h1");

    assert.equal(first.transcript, "原文");
    assert.equal(second.transcript, "原文");
    assert.equal(persisted.transcript, "原文");
    assert.equal(persisted.text, "新文本");
    assert.equal(persisted.pasteStatus, "pasted");
    assert.equal(persisted.processingError.length, 240);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("history replacement writes clean up temporary files when rename fails", async () => {
  const writes = [];
  const removed = [];
  const io = {
    mkdir: async () => {},
    readFile: async () => "[]",
    stat: async () => ({ isFile: () => true }),
    writeFile: async (filePath, content) => writes.push({ filePath, content }),
    rename: async () => { throw new Error("rename failed"); },
    rm: async (filePath) => removed.push(filePath),
    randomUUID: () => "test-id"
  };
  const store = createSettingsStore("C:/virtual-local-flow", defaultSettings, null, io);

  await assert.rejects(store.addHistory({ id: "h1", transcript: "原文", text: "文本" }), /rename failed/);
  assert.equal(writes.length, 1);
  assert.match(writes[0].filePath, /history\.json\.\d+\.test-id\.tmp$/);
  assert.deepEqual(removed, [writes[0].filePath]);
});

function createFirstWriteBarrierIo() {
  let committedContent = null;
  let readCalls = 0;
  let writeCalls = 0;
  const temporaryFiles = new Map();
  let releaseFirstWrite;
  let markFirstWriteStarted;
  const firstWriteStarted = new Promise((resolve) => {
    markFirstWriteStarted = resolve;
  });
  const firstWriteRelease = new Promise((resolve) => {
    releaseFirstWrite = resolve;
  });

  return {
    firstWriteStarted,
    releaseFirstWrite,
    get readCalls() {
      return readCalls;
    },
    get temporaryCount() {
      return temporaryFiles.size;
    },
    readCommitted() {
      return committedContent === null ? null : JSON.parse(committedContent);
    },
    readPersisted() {
      return JSON.parse(committedContent);
    },
    io: {
      mkdir: async () => {},
      readFile: async () => {
        readCalls += 1;
        if (committedContent === null) {
          const error = new Error("missing settings");
          error.code = "ENOENT";
          throw error;
        }
        return committedContent;
      },
      stat: async () => ({ isFile: () => true }),
      writeFile: async (filePath, nextContent) => {
        writeCalls += 1;
        temporaryFiles.set(filePath, nextContent);
        if (writeCalls === 1) {
          markFirstWriteStarted();
          await firstWriteRelease;
        }
      },
      rename: async (temporaryPath) => {
        if (!temporaryFiles.has(temporaryPath)) {
          const error = new Error("missing temporary file");
          error.code = "ENOENT";
          throw error;
        }
        committedContent = temporaryFiles.get(temporaryPath);
        temporaryFiles.delete(temporaryPath);
      },
      rm: async (filePath) => {
        temporaryFiles.delete(filePath);
      },
      randomUUID: () => "test-id"
    }
  };
}
