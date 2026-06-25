import { spawn } from "node:child_process";
import { detectLikelyLanguage } from "../shared/language-detection.js";
import { isTargetOutputLanguage } from "../shared/languages.js";
import { buildOutputPrompt, polishLocally } from "../shared/text-cleanup.js";

export async function polishTranscript(transcript, settings = {}, deps = {}) {
  if (!transcript?.trim()) {
    return "";
  }

  const requiresOllama = isTargetOutputLanguage(settings.outputLanguage);
  const usesMyMemory = settings.llmProvider === "mymemory";
  const prompt = buildOutputPrompt({
    mode: settings.polishMode || "polish",
    outputLanguage: settings.outputLanguage || "auto",
    transcript,
    dictionary: settings.dictionary || []
  });

  if (settings.polishMode === "raw") {
    if (requiresOllama && usesMyMemory) {
      return polishWithMyMemory(transcript, settings, deps);
    }
    if (requiresOllama) {
      return polishWithRequiredLlm(prompt, settings, deps);
    }
    return transcript.trim();
  }

  if (requiresOllama && usesMyMemory) {
    return polishWithMyMemory(transcript, settings, deps);
  }

  if (hasEmbeddedLlm(settings)) {
    try {
      const result = await polishWithEmbeddedLlm(prompt, settings, deps);
      if (result) {
        return result;
      }
    } catch (error) {
      if (requiresOllama) {
        throw new Error(`Install the built-in local language model, enable Ollama, or select MyMemory Free to produce the selected output language: ${error.message}`);
      }
    }
  }

  if (settings.ollamaEnabled) {
    try {
      const result = await polishWithOllama(prompt, settings, deps);
      if (result) {
        return result;
      }
    } catch (error) {
      if (requiresOllama) {
        throw new Error(`Install the built-in local language model, enable Ollama, or select MyMemory Free to produce the selected output language: ${error.message}`);
      }
      return polishLocally(transcript);
    }
  }

  if (requiresOllama) {
    throw new Error("Install the built-in local language model, enable Ollama, or select MyMemory Free to produce the selected output language.");
  }

  return polishLocally(transcript);
}

async function polishWithRequiredLlm(prompt, settings, deps = {}) {
  if (hasEmbeddedLlm(settings)) {
    try {
      return await polishWithEmbeddedLlm(prompt, settings, deps);
    } catch (error) {
      throw new Error(`Install the built-in local language model, enable Ollama, or select MyMemory Free to produce the selected output language: ${error.message}`);
    }
  }

  if (settings.ollamaEnabled) {
    try {
      return await polishWithOllama(prompt, settings, deps);
    } catch (error) {
      throw new Error(`Install the built-in local language model, enable Ollama, or select MyMemory Free to produce the selected output language: ${error.message}`);
    }
  }

  throw new Error("Install the built-in local language model, enable Ollama, or select MyMemory Free to produce the selected output language.");
}

function hasEmbeddedLlm(settings = {}) {
  return Boolean(settings.embeddedLlmCliPath?.trim() && settings.embeddedLlmModelPath?.trim());
}

async function polishWithEmbeddedLlm(prompt, settings, deps = {}) {
  const cliPath = settings.embeddedLlmCliPath.trim();
  const args = buildLlamaCliArgs({
    modelPath: settings.embeddedLlmModelPath.trim(),
    prompt,
    maxTokens: settings.embeddedLlmMaxTokens || 512
  });
  return runLlamaCli(cliPath, args, deps);
}

export function buildLlamaCliArgs({ modelPath, prompt, maxTokens = 512 }) {
  return [
    "-m",
    modelPath,
    "-p",
    prompt,
    "-n",
    String(maxTokens),
    "--temp",
    "0.2",
    "--top-p",
    "0.8",
    "--no-display-prompt"
  ];
}

function runLlamaCli(file, args, deps = {}) {
  const spawnImpl = deps.spawn || spawn;
  const timeoutMs = deps.timeoutMs || 120000;

  return new Promise((resolve, reject) => {
    const child = spawnImpl(file, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Local language model timed out."));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stripModelOutput(stdout));
      } else {
        reject(new Error(stderr.trim() || `Local language model exited with code ${code}.`));
      }
    });
  });
}

function stripModelOutput(output = "") {
  return String(output)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
}

async function polishWithOllama(prompt, settings, deps = {}) {
  const baseUrl = (settings.ollamaBaseUrl || "http://localhost:11434").replace(/\/$/, "");
  const model = settings.ollamaModel || "qwen2.5:3b";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  const fetchImpl = deps.fetch || fetch;

  try {
    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}.`);
    }

    const data = await response.json();
    return String(data.message?.content || "")
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .trim();
  } finally {
    clearTimeout(timer);
  }
}

async function polishWithMyMemory(transcript, settings, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const sourceText = settings.polishMode === "raw" ? transcript.trim() : polishLocally(transcript);
  const sourceLanguage = getMyMemorySourceLanguage(settings, sourceText);
  const targetLanguage = toMyMemoryLanguage(settings.outputLanguage);

  if (!targetLanguage) {
    throw new Error("Unsupported MyMemory target language.");
  }
  if (sourceLanguage === targetLanguage) {
    return sourceText;
  }

  const translated = [];
  for (const chunk of splitUtf8Chunks(sourceText, 480)) {
    translated.push(await translateMyMemoryChunk(chunk, sourceLanguage, targetLanguage, fetchImpl, deps));
  }
  return translated.join(" ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

async function translateMyMemoryChunk(text, sourceLanguage, targetLanguage, fetchImpl, deps = {}) {
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", `${sourceLanguage}|${targetLanguage}`);
  url.searchParams.set("mt", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.myMemoryTimeoutMs || 20000);

  try {
    const response = await fetchImpl(url.toString(), { signal: controller.signal });
    const data = await response.json();
    const responseStatus = Number(data.responseStatus || response.status || 200);
    if (!response.ok || responseStatus >= 400) {
      throw new Error(data.responseDetails || `MyMemory returned ${responseStatus}.`);
    }

    const translatedText = String(data.responseData?.translatedText || "").trim();
    if (!translatedText) {
      throw new Error("MyMemory returned an empty translation.");
    }
    return translatedText;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("MyMemory translation timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getMyMemorySourceLanguage(settings, text) {
  const selectedLanguage = String(settings.whisperLanguage || "auto").trim();
  const source = selectedLanguage && selectedLanguage !== "auto"
    ? selectedLanguage
    : detectLikelyLanguage(text);
  return toMyMemoryLanguage(source) || "en";
}

function toMyMemoryLanguage(language) {
  const normalized = String(language || "").trim();
  const languageMap = {
    en: "en",
    zh: "zh-CN",
    "zh-Hans": "zh-CN",
    "zh-Hant": "zh-TW",
    ja: "ja",
    ko: "ko",
    fr: "fr",
    ru: "ru",
    es: "es"
  };
  return languageMap[normalized] || "";
}

function splitUtf8Chunks(text, maxBytes) {
  const chunks = [];
  let current = "";

  for (const char of text) {
    const next = current + char;
    if (current && Buffer.byteLength(next, "utf8") > maxBytes) {
      chunks.push(current.trim());
      current = char;
    } else {
      current = next;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}
