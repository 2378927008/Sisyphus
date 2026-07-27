export const PERSONALIZATION_LIMITS = Object.freeze({
  dictionaryEntries: 500,
  dictionaryTermLength: 120,
  snippets: 200,
  snippetTriggerLength: 120,
  snippetTextLength: 10000
});

export function normalizeDictionary(value) {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/)
      : [];
  return normalizeEntries(entries, PERSONALIZATION_LIMITS.dictionaryEntries, PERSONALIZATION_LIMITS.dictionaryTermLength);
}

export function normalizeSnippets(value, options = {}) {
  const createId = options.createId || createRandomId;
  const snippets = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];

  for (const candidate of snippets) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const trigger = normalizeVisibleText(candidate.trigger, PERSONALIZATION_LIMITS.snippetTriggerLength);
    const text = String(candidate.text ?? "").trim().slice(0, PERSONALIZATION_LIMITS.snippetTextLength);
    const key = comparisonKey(trigger);
    if (!trigger || !text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const id = String(candidate.id ?? "").trim() || String(createId()).trim();
    normalized.push({
      id,
      trigger,
      text
    });
    if (normalized.length >= PERSONALIZATION_LIMITS.snippets) {
      break;
    }
  }

  return normalized;
}

export function expandExactSnippet(transcript, snippets) {
  const key = comparisonKey(transcript);
  const snippet = normalizeSnippets(snippets).find((candidate) => comparisonKey(candidate.trigger) === key);
  return snippet
    ? { matched: true, text: snippet.text, snippetId: snippet.id }
    : { matched: false, text: String(transcript ?? ""), snippetId: null };
}

function normalizeEntries(entries, limit, itemLength) {
  const seen = new Set();
  const normalized = [];
  for (const entry of entries) {
    const text = normalizeVisibleText(entry, itemLength);
    const key = comparisonKey(text);
    if (!text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(text);
    if (normalized.length >= limit) {
      break;
    }
  }
  return normalized;
}

function normalizeVisibleText(value, limit) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function comparisonKey(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function createRandomId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID !== "function") {
    throw new Error("Secure random ID generation is unavailable");
  }
  return cryptoApi.randomUUID();
}
