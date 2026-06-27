import { mkdir, readFile, stat as fsStat, writeFile } from "node:fs/promises";
import path from "node:path";
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
  dictionary: [],
  historyLimit: 20
};

const localAssetPathKeys = [
  "whisperCliPath",
  "whisperModelPath",
  "embeddedLlmCliPath",
  "embeddedLlmModelPath"
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
  merged.historyLimit = Number.isFinite(Number(merged.historyLimit))
    ? Math.max(1, Math.min(100, Number(merged.historyLimit)))
    : defaults.historyLimit;
  merged.pasteAfterTranscribe = Boolean(merged.pasteAfterTranscribe);
  merged.ollamaEnabled = Boolean(merged.ollamaEnabled);
  merged.interfaceLanguage = normalizeInterfaceLanguage(merged.interfaceLanguage);
  merged.whisperLanguage = normalizeWhisperLanguage(merged.whisperLanguage);
  merged.outputLanguage = normalizeOutputLanguage(merged.outputLanguage);
  merged.polishMode = normalizePolishMode(merged.polishMode);
  merged.asrProvider = normalizeAsrProvider(merged.asrProvider);
  merged.llmProvider = normalizeTextProvider(merged.llmProvider);
  merged.cloudApiBaseUrl = String(merged.cloudApiBaseUrl || "").trim();
  merged.cloudApiKey = String(merged.cloudApiKey || "").trim();
  merged.providerStatus = getProcessingProviderStatus(merged);

  return merged;
}

export function createSettingsStore(userDataPath, baseSettings = defaultSettings, secretCodec = null) {
  const settingsPath = path.join(userDataPath, "settings.json");
  const historyPath = path.join(userDataPath, "history.json");

  return {
    async getSettings(options = {}) {
      const settings = await loadSettings(settingsPath, baseSettings, secretCodec);
      return options.includeSecrets ? settings : redactSecrets(settings);
    },
    async saveSettings(settings, options = {}) {
      const existing = await loadSettings(settingsPath, baseSettings, secretCodec);
      const next = mergeSettings({ ...existing, ...omitEmptyProviderSelectionOverrides(settings) }, baseSettings);
      await writeJson(settingsPath, toPersistedSettings(next, secretCodec));
      return options.includeSecrets ? next : redactSecrets(next);
    },
    async getHistory() {
      const history = await loadJson(historyPath, []);
      return Array.isArray(history) ? history : [];
    },
    async addHistory(entry, limit = defaultSettings.historyLimit) {
      const history = await this.getHistory();
      const next = [entry, ...history].slice(0, limit);
      await writeJson(historyPath, next);
      return next;
    }
  };
}

function normalizeDictionary(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function normalizePolishMode(value) {
  const mode = String(value || "").trim();
  if (mode === "raw" || mode === "command") {
    return mode;
  }
  return "polish";
}

async function loadSettings(settingsPath, baseSettings, secretCodec) {
  const persisted = await loadJson(settingsPath, baseSettings);
  const settings = mergeSettings(hydratePersistedSecrets(persisted, secretCodec), baseSettings);
  return repairMissingLocalAssetPaths(settings, baseSettings);
}

async function repairMissingLocalAssetPaths(settings, baseSettings) {
  let changed = false;
  const next = { ...settings };

  for (const key of localAssetPathKeys) {
    const currentPath = String(next[key] || "").trim();
    const detectedPath = String(baseSettings[key] || "").trim();

    if (!detectedPath || currentPath === detectedPath) {
      continue;
    }

    if (currentPath && await isFile(currentPath)) {
      continue;
    }

    if (await isFile(detectedPath)) {
      next[key] = detectedPath;
      changed = true;
    }
  }

  return changed ? mergeSettings(next, baseSettings) : settings;
}

async function isFile(filePath) {
  try {
    const file = await fsStat(filePath);
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

async function loadJson(filePath, fallback) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
