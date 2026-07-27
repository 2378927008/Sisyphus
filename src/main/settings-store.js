import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat as fsStat, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeDictionary, normalizeSnippets } from "../shared/personalization.js";
import {
  defaultInterfaceLanguage,
  defaultOutputLanguage,
  defaultWhisperLanguage,
  normalizeInterfaceLanguage,
  normalizeOutputLanguage,
  normalizeWhisperLanguage
} from "../shared/languages.js";
import {
  getProcessingProviderStatus,
  normalizeAsrProvider,
  normalizeTextProvider
} from "./provider-registry.js";

export const defaultSettings = {
  hotkey: "CommandOrControl+Alt+Space",
  launchAtLogin: false,
  startMinimizedToTray: false,
  globalShortcutPaused: false,
  shortcutMode: "toggle",
  pasteLastHotkey: "CommandOrControl+Alt+V",
  asrProvider: "localWhisper",
  whisperCliPath: "",
  whisperModelPath: "",
  cloudApiBaseUrl: "",
  cloudApiKey: "",
  interfaceLanguage: defaultInterfaceLanguage,
  whisperLanguage: defaultWhisperLanguage,
  outputLanguage: defaultOutputLanguage,
  polishMode: "polish",
  pasteAfterTranscribe: true,
  ollamaEnabled: false,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "qwen3:4b",
  llmProvider: "mymemory",
  embeddedLlmCliPath: "",
  embeddedLlmModelPath: "",
  whisperRuntimeUrl: "",
  whisperRuntimeMirrorUrls: "",
  whisperModelUrl: "",
  whisperModelMirrorUrls: "",
  llamaRuntimeUrl: "",
  llamaRuntimeMirrorUrls: "",
  qwenModelUrl: "",
  qwenModelMirrorUrls: "",
  dictionary: [],
  snippets: [],
  historyLimit: 20
};

const localAssetPathKeys = [
  "whisperCliPath",
  "whisperModelPath",
  "embeddedLlmCliPath",
  "embeddedLlmModelPath"
];

const downloadSourceKeys = [
  "whisperRuntimeUrl",
  "whisperRuntimeMirrorUrls",
  "whisperModelUrl",
  "whisperModelMirrorUrls",
  "llamaRuntimeUrl",
  "llamaRuntimeMirrorUrls",
  "qwenModelUrl",
  "qwenModelMirrorUrls"
];

export function createSafeStorageSecretCodec(safeStorage) {
  try {
    if (!safeStorage?.isEncryptionAvailable?.()) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    encrypt(value) {
      return safeStorage.encryptString(String(value)).toString("base64");
    },
    decrypt(value) {
      return safeStorage.decryptString(Buffer.from(String(value), "base64"));
    }
  };
}

export function mergeSettings(input = {}, baseSettings = defaultSettings) {
  const defaults = { ...defaultSettings, ...baseSettings };
  const merged = { ...defaults };

  for (const key of Object.keys(defaultSettings)) {
    if (Object.hasOwn(input, key)) {
      merged[key] = input[key];
    }
  }

  for (const key of ["whisperCliPath", "whisperModelPath", "embeddedLlmCliPath", "embeddedLlmModelPath"]) {
    if (!String(merged[key] || "").trim() && String(defaults[key] || "").trim()) {
      merged[key] = defaults[key];
    }
  }

  merged.dictionary = normalizeDictionary(merged.dictionary);
  merged.snippets = normalizeSnippets(merged.snippets);
  merged.historyLimit = Number.isFinite(Number(merged.historyLimit))
    ? Math.max(1, Math.min(100, Number(merged.historyLimit)))
    : defaults.historyLimit;
  merged.pasteAfterTranscribe = Boolean(merged.pasteAfterTranscribe);
  merged.ollamaEnabled = Boolean(merged.ollamaEnabled);
  merged.launchAtLogin = Boolean(merged.launchAtLogin);
  merged.startMinimizedToTray = Boolean(merged.startMinimizedToTray);
  merged.globalShortcutPaused = Boolean(merged.globalShortcutPaused);
  merged.shortcutMode = normalizeShortcutMode(merged.shortcutMode);
  merged.pasteLastHotkey = String(merged.pasteLastHotkey ?? "").trim();
  merged.interfaceLanguage = normalizeInterfaceLanguage(merged.interfaceLanguage);
  merged.whisperLanguage = normalizeWhisperLanguage(merged.whisperLanguage);
  merged.outputLanguage = normalizeOutputLanguage(merged.outputLanguage);
  merged.polishMode = normalizePolishMode(merged.polishMode);
  merged.asrProvider = normalizeAsrProvider(merged.asrProvider);
  merged.llmProvider = normalizeTextProvider(merged.llmProvider);
  merged.cloudApiBaseUrl = String(merged.cloudApiBaseUrl || "").trim();
  merged.cloudApiKey = String(merged.cloudApiKey || "").trim();
  for (const key of downloadSourceKeys) {
    merged[key] = String(merged[key] || "").trim();
  }
  merged.providerStatus = getProcessingProviderStatus(merged);

  return merged;
}

export function createSettingsStore(userDataPath, baseSettings = defaultSettings, secretCodec = null, ioOverrides = {}) {
  const settingsPath = path.join(userDataPath, "settings.json");
  const historyPath = path.join(userDataPath, "history.json");
  const io = resolveFileIo(ioOverrides);
  let settingsOperationQueue = Promise.resolve();
  let historyOperationQueue = Promise.resolve();
  const enqueueSettingsOperation = (operation) => {
    const pending = settingsOperationQueue.then(operation);
    settingsOperationQueue = pending.catch(() => {});
    return pending;
  };
  const enqueueHistoryOperation = (operation) => {
    const pending = historyOperationQueue.then(operation);
    historyOperationQueue = pending.catch(() => {});
    return pending;
  };

  return {
    getSettings(options = {}) {
      return enqueueSettingsOperation(async () => {
        const settings = await loadSettings(settingsPath, baseSettings, secretCodec, io);
        return options.includeSecrets ? settings : redactSecrets(settings);
      });
    },
    saveSettings(settings, options = {}) {
      return enqueueSettingsOperation(async () => {
        const existing = await loadSettings(settingsPath, baseSettings, secretCodec, io);
        const next = mergeSettings({ ...existing, ...omitEmptyProviderSelectionOverrides(settings) }, baseSettings);
        await writeJson(settingsPath, toPersistedSettings(next, secretCodec), io);
        return options.includeSecrets ? next : redactSecrets(next);
      });
    },
    getHistory() {
      return enqueueHistoryOperation(() => loadHistory(historyPath, io));
    },
    getHistoryEntry(id) {
      return enqueueHistoryOperation(async () => {
        const history = await loadHistory(historyPath, io);
        return history.find((entry) => entry?.id === id) || null;
      });
    },
    addHistory(entry, limit = defaultSettings.historyLimit) {
      return enqueueHistoryOperation(async () => {
        const history = await loadHistory(historyPath, io);
        const next = [entry, ...history].slice(0, Math.max(1, Number(limit) || defaultSettings.historyLimit));
        await writeJson(historyPath, next, io);
        return next;
      });
    },
    updateHistory(id, patch) {
      return enqueueHistoryOperation(async () => {
        const history = await loadHistory(historyPath, io);
        const index = history.findIndex((entry) => entry?.id === id);
        if (index < 0) {
          return null;
        }
        const updated = { ...history[index], ...normalizeHistoryPatch(patch), updatedAt: new Date().toISOString() };
        const next = [...history];
        next[index] = updated;
        await writeJson(historyPath, next, io);
        return updated;
      });
    }
  };
}

function normalizePolishMode(value) {
  const mode = String(value || "").trim();
  if (mode === "raw" || mode === "command") {
    return mode;
  }
  return "polish";
}

function normalizeShortcutMode(value) {
  return String(value || "").trim() === "hold" ? "hold" : "toggle";
}

async function loadSettings(settingsPath, baseSettings, secretCodec, io) {
  const persisted = await loadJson(settingsPath, baseSettings, io);
  const settings = mergeSettings(hydratePersistedSecrets(persisted, secretCodec), baseSettings);
  const repaired = await repairMissingLocalAssetPaths(settings, baseSettings, io);
  const changedKeys = localAssetPathKeys.filter((key) => settings[key] !== repaired[key]);

  if (changedKeys.length) {
    await persistRepairedLocalAssetPaths(settingsPath, persisted, repaired, changedKeys, io);
  }

  return repaired;
}

async function persistRepairedLocalAssetPaths(settingsPath, persisted, repaired, changedKeys, io) {
  const next = persisted && typeof persisted === "object" && !Array.isArray(persisted)
    ? { ...persisted }
    : {};

  for (const key of changedKeys) {
    next[key] = repaired[key];
  }

  try {
    await writeJson(settingsPath, next, io);
  } catch {
    // Keep the repaired in-memory settings usable if migration cannot be persisted.
  }
}

async function repairMissingLocalAssetPaths(settings, baseSettings, io) {
  let changed = false;
  const next = { ...settings };

  for (const key of localAssetPathKeys) {
    const currentPath = String(next[key] || "").trim();
    const detectedPath = String(baseSettings[key] || "").trim();

    if (currentPath && await isFile(currentPath, io)) {
      continue;
    }

    if (detectedPath && await isFile(detectedPath, io)) {
      if (currentPath !== detectedPath) {
        next[key] = detectedPath;
        changed = true;
      }
      continue;
    }

    if (currentPath) {
      next[key] = "";
      changed = true;
    }
  }

  return changed ? mergeSettings(next, baseSettings) : settings;
}

async function isFile(filePath, io) {
  try {
    const file = await io.stat(filePath);
    return file.isFile();
  } catch {
    return false;
  }
}

function hydratePersistedSecrets(settings, secretCodec) {
  if (!settings || typeof settings !== "object") {
    return settings;
  }

  const hydrated = { ...settings };

  if (!hasProviderValue(hydrated.cloudApiKey) && hasProviderValue(hydrated.cloudApiKeyEncrypted) && secretCodec) {
    try {
      hydrated.cloudApiKey = secretCodec.decrypt(hydrated.cloudApiKeyEncrypted);
    } catch {
      hydrated.cloudApiKey = "";
    }
  }

  return hydrated;
}

function omitEmptyProviderSelectionOverrides(settings) {
  const next = { ...settings };

  for (const key of ["asrProvider", "llmProvider"]) {
    if (Object.hasOwn(next, key) && isEmptyProviderValue(next[key])) {
      delete next[key];
    }
  }

  return next;
}

function isEmptyProviderValue(value) {
  return value == null || String(value).trim() === "";
}

function hasProviderValue(value) {
  return !isEmptyProviderValue(value);
}

function redactSecrets(settings) {
  return {
    ...settings,
    cloudApiKey: ""
  };
}

function toPersistedSettings(settings, secretCodec) {
  const persisted = {};

  for (const key of Object.keys(defaultSettings)) {
    if (key === "cloudApiKey" && secretCodec && hasProviderValue(settings.cloudApiKey)) {
      continue;
    }

    if (Object.hasOwn(settings, key)) {
      persisted[key] = settings[key];
    }
  }

  if (secretCodec && hasProviderValue(settings.cloudApiKey)) {
    persisted.cloudApiKeyEncrypted = secretCodec.encrypt(settings.cloudApiKey);
    delete persisted.cloudApiKey;
  }

  return persisted;
}

async function loadJson(filePath, fallback, io) {
  try {
    const content = await io.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function loadHistory(historyPath, io) {
  const history = await loadJson(historyPath, [], io);
  return Array.isArray(history) ? history : [];
}

function normalizeHistoryPatch(patch) {
  const next = {};
  const fields = ["status", "pasteStatus", "source", "snippetId"];
  for (const key of fields) {
    if (Object.hasOwn(patch || {}, key)) {
      next[key] = String(patch[key] ?? "").trim();
    }
  }
  if (Object.hasOwn(patch || {}, "text")) {
    next.text = String(patch.text ?? "").slice(0, 100000);
  }
  for (const key of ["processingError", "pasteError"]) {
    if (Object.hasOwn(patch || {}, key)) {
      next[key] = String(patch[key] ?? "").slice(0, 240);
    }
  }
  return next;
}

async function writeJson(filePath, value, io) {
  await io.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${io.randomUUID()}.tmp`;
  try {
    await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await io.rename(temporaryPath, filePath);
  } finally {
    await io.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function resolveFileIo(overrides) {
  return {
    mkdir: overrides.mkdir || mkdir,
    readFile: overrides.readFile || readFile,
    stat: overrides.stat || fsStat,
    writeFile: overrides.writeFile || writeFile,
    rename: overrides.rename || rename,
    rm: overrides.rm || rm,
    randomUUID: overrides.randomUUID || randomUUID
  };
}
