import { defaultOutputLanguage, getOutputLanguageName, normalizeOutputLanguage } from "./languages.js";

const chineseFillers = [
  "嗯",
  "呃",
  "额",
  "啊",
  "那个",
  "这个",
  "就是",
  "然后"
];

const englishFillers = [
  "um",
  "uh",
  "erm",
  "like",
  "you know",
  "i mean"
];

export function polishLocally(input = "") {
  let text = String(input);

  for (const filler of chineseFillers) {
    text = text.replace(new RegExp(`(^|\\s)${escapeRegExp(filler)}(?=\\s|$)`, "g"), " ");
  }

  for (const filler of englishFillers) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(filler)}\\b`, "gi"), " ");
  }

  return text
    .replace(/,{2,}/g, ",")
    .replace(/\.{3,}/g, ".")
    .replace(/。{2,}/g, "。")
    .replace(/，{2,}/g, "，")
    .replace(/\s+/g, " ")
    .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "$1")
    .replace(/\s+([,.;:!?，。！？；：])/g, "$1")
    .trim();
}

export function buildPolishPrompt({ mode = "polish", transcript = "", dictionary = [] } = {}) {
  const terms = Array.isArray(dictionary) && dictionary.length > 0
    ? dictionary.join(", ")
    : "none";

  if (mode === "command") {
    return [
      "You are a local dictation editing assistant.",
      "The user may have spoken an editing instruction.",
      "Return only the final edited text. Do not explain.",
      "Keep the final text in the same language as the transcript unless the spoken instruction explicitly asks for translation.",
      `Personal dictionary: ${terms}`,
      `Transcript: ${transcript}`
    ].join("\n");
  }

  return [
    "Rewrite the transcript as polished text.",
    "Remove filler words, repeated phrases, and false starts.",
    "Keep the final text in the same language as the transcript.",
    "Keep names and product terms from the personal dictionary unchanged.",
    "Return only the final text. Do not explain.",
    `Personal dictionary: ${terms}`,
    `Transcript: ${transcript}`
  ].join("\n");
}

export function buildOutputPrompt({
  mode = "polish",
  outputLanguage = defaultOutputLanguage,
  transcript = "",
  dictionary = []
} = {}) {
  const normalizedOutputLanguage = normalizeOutputLanguage(outputLanguage);

  if (normalizedOutputLanguage === defaultOutputLanguage) {
    const sameLanguageMode = mode === "translate" ? "polish" : mode;
    return buildPolishPrompt({ mode: sameLanguageMode, transcript, dictionary });
  }

  const targetLanguageName = getOutputLanguageName(normalizedOutputLanguage);
  const terms = Array.isArray(dictionary) && dictionary.length > 0
    ? dictionary.join(", ")
    : "none";

  if (mode === "command") {
    return [
      "You are a local dictation editing assistant.",
      "The user may have spoken an editing instruction.",
      `Apply the instruction and return the final edited text in ${targetLanguageName}.`,
      "Return only the final text. Do not explain.",
      `Personal dictionary: ${terms}`,
      `Transcript: ${transcript}`
    ].join("\n");
  }

  return [
    `Translate and rewrite the transcript as natural ${targetLanguageName}.`,
    "Remove filler words, repeated phrases, and false starts.",
    "Keep names and product terms from the personal dictionary unchanged unless a standard localized name is clearly required.",
    "Return only the final text. Do not explain.",
    `Personal dictionary: ${terms}`,
    `Transcript: ${transcript}`
  ].join("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
