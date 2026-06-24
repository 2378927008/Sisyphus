import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  llmProvider: "embedded",
  embeddedLlmCliPath: "",
  embeddedLlmModelPath: "",
  dictionary: [],
  historyLimit: 20
};

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
  merged.asrProvider = normalizeAsrProvider(merged.asrProvider);
  merged.llmProvider = normalizeTextProvider(merged.llmProvider);
  merged.providerStatus = getProcessingProviderStatus(merged);

  return merged;
}

export function createSettingsStore(userDataPath, baseSettings = defaultSettings) {
  const settingsPath = path.join(userDataPath, "settings.json");
  const historyPath = path.join(userDataPath, "history.json");

  return {
    async getSettings() {
      return loadJson(settingsPath, baseSettings).then((settings) => mergeSettings(settings, baseSettings));
    },
    async saveSettings(settings) {
      const existing = await loadJson(settingsPath, baseSettings);
      const next = mergeSettings({ ...existing, ...settings }, baseSettings);
      await writeJson(settingsPath, toPersistedSettings(next));
      return next;
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

function toPersistedSettings(settings) {
  const persisted = {};

  for (const key of Object.keys(defaultSettings)) {
    if (Object.hasOwn(settings, key)) {
      persisted[key] = settings[key];
    }
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
