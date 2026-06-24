export const interfaceLanguages = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "zh-Hans", label: "Simplified Chinese", nativeLabel: "简体中文" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "ko", label: "Korean", nativeLabel: "한국어" },
  { code: "zh-Hant", label: "Traditional Chinese", nativeLabel: "繁體中文" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "ru", label: "Russian", nativeLabel: "Русский" },
  { code: "es", label: "Spanish", nativeLabel: "Español" }
];

export const whisperLanguages = [
  { code: "auto", label: "Auto", nativeLabel: "自动" },
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "zh", label: "Chinese", nativeLabel: "中文" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "ko", label: "Korean", nativeLabel: "한국어" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "ru", label: "Russian", nativeLabel: "Русский" },
  { code: "es", label: "Spanish", nativeLabel: "Español" }
];

export const outputLanguages = [
  { code: "auto", label: "Auto (same as speech)", nativeLabel: "自动（同语音）" },
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "zh-Hans", label: "Simplified Chinese", nativeLabel: "简体中文" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "ko", label: "Korean", nativeLabel: "한국어" },
  { code: "zh-Hant", label: "Traditional Chinese", nativeLabel: "繁體中文" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "ru", label: "Russian", nativeLabel: "Русский" },
  { code: "es", label: "Spanish", nativeLabel: "Español" }
];

export const defaultInterfaceLanguage = "zh-Hans";
export const defaultWhisperLanguage = "auto";
export const defaultOutputLanguage = "auto";

export function normalizeInterfaceLanguage(value) {
  return normalizeLanguage(value, interfaceLanguages, defaultInterfaceLanguage);
}

export function normalizeWhisperLanguage(value) {
  return normalizeLanguage(value, whisperLanguages, defaultWhisperLanguage);
}

export function normalizeOutputLanguage(value) {
  return normalizeLanguage(value, outputLanguages, defaultOutputLanguage);
}

export function isTargetOutputLanguage(value) {
  return normalizeOutputLanguage(value) !== defaultOutputLanguage;
}

export function getOutputLanguageName(value) {
  const normalized = normalizeOutputLanguage(value);
  return outputLanguages.find((language) => language.code === normalized)?.label || "Keep original";
}

function normalizeLanguage(value, languages, fallback) {
  const code = String(value || "").trim();
  if (code === "original" && fallback === defaultOutputLanguage) {
    return defaultOutputLanguage;
  }
  return languages.some((language) => language.code === code) ? code : fallback;
}
