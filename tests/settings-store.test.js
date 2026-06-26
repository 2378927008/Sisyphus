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
