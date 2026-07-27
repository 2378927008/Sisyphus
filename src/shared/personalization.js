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
  const seenTriggers = new Set();
  const candidates = [];

  for (const candidate of snippets) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const trigger = normalizeVisibleText(candidate.trigger, PERSONALIZATION_LIMITS.snippetTriggerLength);
    const text = String(candidate.text ?? "").trim().slice(0, PERSONALIZATION_LIMITS.snippetTextLength);
    const key = personalizationComparisonKey(trigger);
    if (!trigger || !text || seenTriggers.has(key)) {
      continue;
    }
    seenTriggers.add(key);
    candidates.push({
      requestedId: String(candidate.id ?? "").trim(),
      trigger,
      text
    });
    if (candidates.length >= PERSONALIZATION_LIMITS.snippets) {
      break;
    }
  }

  const reservedIds = new Set(candidates.map(({ requestedId }) => requestedId).filter(Boolean));
  const assignedIds = new Set();
  return candidates.map(({ requestedId, trigger, text }) => ({
    id: claimUniqueSnippetId(requestedId || String(createId()).trim(), reservedIds, assignedIds),
    trigger,
    text
  }));
}

export function expandExactSnippet(transcript, snippets) {
  const key = personalizationComparisonKey(transcript);
  const snippet = normalizeSnippets(snippets)
    .find((candidate) => personalizationComparisonKey(candidate.trigger) === key);
  return snippet
    ? { matched: true, text: snippet.text, snippetId: snippet.id }
    : { matched: false, text: String(transcript ?? ""), snippetId: null };
}

export function personalizationComparisonKey(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function normalizeEntries(entries, limit, itemLength) {
  const seen = new Set();
  const normalized = [];
  for (const entry of entries) {
    const text = normalizeVisibleText(entry, itemLength);
    const key = personalizationComparisonKey(text);
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

function claimUniqueSnippetId(requestedId, reservedIds, assignedIds) {
  const baseId = String(requestedId ?? "").trim();
  if (!baseId) {
    throw new Error("Snippet ID generation returned an empty value");
  }
  if (!assignedIds.has(baseId)) {
    assignedIds.add(baseId);
    return baseId;
  }

  let suffix = 2;
  let candidate = `${baseId}~${suffix}`;
  while (reservedIds.has(candidate) || assignedIds.has(candidate)) {
    suffix += 1;
    candidate = `${baseId}~${suffix}`;
  }
  assignedIds.add(candidate);
  return candidate;
}

function createRandomId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID !== "function") {
    throw new Error("Secure random ID generation is unavailable");
  }
  return cryptoApi.randomUUID();
}
