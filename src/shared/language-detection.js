// Lightweight heuristic metadata, not authoritative language detection.
export function detectLikelyLanguage(input) {
  if (typeof input !== "string") return "unknown";

  const text = input.trim().toLowerCase();
  if (!text || !/[a-z\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]/i.test(text)) {
    return "unknown";
  }

  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\u3400-\u9fff]/.test(text)) return "zh";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";

  if (/\b(hola|este|esta|prueba|gracias|por favor)\b/.test(text)) return "es";
  if (/\b(bonjour|merci|ceci|avec|pour|texte)\b/.test(text)) return "fr";
  if (/[a-z]/.test(text)) return "en";

  return "unknown";
}
