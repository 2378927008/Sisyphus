import { spawn } from "node:child_process";
import { isTargetOutputLanguage } from "../shared/languages.js";
import { buildOutputPrompt, polishLocally } from "../shared/text-cleanup.js";

export async function polishTranscript(transcript, settings = {}, deps = {}) {
  if (!transcript?.trim()) {
    return "";
  }

  const requiresOllama = isTargetOutputLanguage(settings.outputLanguage);
  const prompt = buildOutputPrompt({
    mode: settings.polishMode || "polish",
    outputLanguage: settings.outputLanguage || "auto",
    transcript,
    dictionary: settings.dictionary || []
  });

  if (settings.polishMode === "raw") {
    if (requiresOllama) {
      return polishWithRequiredLlm(prompt, settings, deps);
    }
    return transcript.trim();
  }

  if (hasEmbeddedLlm(settings)) {
    try {
      const result = await polishWithEmbeddedLlm(prompt, settings, deps);
      if (result) {
        return result;
      }
    } catch (error) {
      if (requiresOllama) {
        throw new Error(`Install the built-in local language model or enable Ollama to produce the selected output language: ${error.message}`);
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
        throw new Error(`Install the built-in local language model or enable Ollama to produce the selected output language: ${error.message}`);
      }
      return polishLocally(transcript);
    }
  }

  if (requiresOllama) {
    throw new Error("Install the built-in local language model or enable Ollama to produce the selected output language locally.");
  }

  return polishLocally(transcript);
}

async function polishWithRequiredLlm(prompt, settings, deps = {}) {
  if (hasEmbeddedLlm(settings)) {
    try {
      return await polishWithEmbeddedLlm(prompt, settings, deps);
    } catch (error) {
      throw new Error(`Install the built-in local language model or enable Ollama to produce the selected output language: ${error.message}`);
    }
  }

  if (settings.ollamaEnabled) {
    try {
      return await polishWithOllama(prompt, settings, deps);
    } catch (error) {
      throw new Error(`Install the built-in local language model or enable Ollama to produce the selected output language: ${error.message}`);
    }
  }

  throw new Error("Install the built-in local language model or enable Ollama to produce the selected output language locally.");
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
