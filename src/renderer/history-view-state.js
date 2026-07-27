function asText(value) {
  return typeof value === "string" ? value : "";
}

export function hasDisplayableHistoryText(entry) {
  return (
    (entry?.status === "complete" || entry?.status === "partial") &&
    asText(entry?.text).trim() !== ""
  );
}

function comparisonText(value) {
  return asText(value).normalize("NFKC").toLowerCase();
}

function stableLegacySource(entry) {
  return JSON.stringify([
    asText(entry?.createdAt),
    asText(entry?.transcript)
  ]);
}

function shortStableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function resolveHistoryEntryId(entry) {
  const id = asText(entry?.id).trim();
  return id || `legacy-${shortStableHash(stableLegacySource(entry))}`;
}

export function resolveHistoryEntryIds(entries) {
  if (!Array.isArray(entries)) return [];

  const used = new Set();
  const occurrences = new Map();
  return entries.map((entry) => {
    const baseId = resolveHistoryEntryId(entry);
    let occurrence = (occurrences.get(baseId) || 0) + 1;
    let candidate = occurrence === 1 ? baseId : `${baseId}-${occurrence}`;
    while (used.has(candidate)) {
      occurrence += 1;
      candidate = `${baseId}-${occurrence}`;
    }
    occurrences.set(baseId, occurrence);
    used.add(candidate);
    return candidate;
  });
}

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timestamp(entry) {
  const value = new Date(entry.createdAt).getTime();
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

function compareStableText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareHistoryEntries(left, right) {
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1;

  const idOrder = compareStableText(left.id, right.id);
  if (idOrder !== 0) return idOrder;
  return compareStableText(stableLegacySource(left), stableLegacySource(right));
}

function compareHistoryGroups(left, right) {
  const ranks = { today: 0, yesterday: 1, unknown: 3 };
  const leftRank = ranks[left.key] ?? 2;
  const rightRank = ranks[right.key] ?? 2;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (leftRank === 2) return compareStableText(right.key, left.key);
  return 0;
}

export function normalizeHistoryEntries(entries) {
  if (!Array.isArray(entries)) return [];

  const ids = resolveHistoryEntryIds(entries);
  return entries
    .map((entry, index) => ({ entry, id: ids[index] }))
    .filter(({ entry }) => entry && typeof entry === "object")
    .map(({ entry, id }) => {
      const text = asText(entry.text);
      const transcript = asText(entry.transcript);
      return {
        ...entry,
        id,
        text,
        transcript,
        createdAt: asText(entry.createdAt),
        status: asText(entry.status),
        characterCount: Array.from(text).length,
        searchableText: comparisonText(`${text}\n${transcript}`)
      };
    });
}

export function filterHistory(entries, query) {
  const normalizedQuery = comparisonText(query).trim();
  const normalizedEntries = normalizeHistoryEntries(entries);
  if (!normalizedQuery) return normalizedEntries;
  return normalizedEntries.filter((entry) => entry.searchableText.includes(normalizedQuery));
}

export function groupHistoryByDate(entries, { now = new Date() } = {}) {
  const currentKey = localDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);
  const groups = new Map();

  for (const entry of normalizeHistoryEntries(entries)) {
    const dateKey = localDateKey(entry.createdAt);
    const key = dateKey === currentKey ? "today" : dateKey === yesterdayKey ? "yesterday" : dateKey;
    if (!groups.has(key)) {
      const group = key === "today"
        ? { key, labelKey: "history.group.today", entries: [] }
        : key === "yesterday"
          ? { key, labelKey: "history.group.yesterday", entries: [] }
          : { key, label: key, entries: [] };
      groups.set(key, group);
    }
    groups.get(key).entries.push(entry);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, entries: [...group.entries].sort(compareHistoryEntries) }))
    .sort(compareHistoryGroups);
}

export function resolveHistorySelection(entries, selectedId) {
  const normalizedEntries = normalizeHistoryEntries(entries);
  const selected = asText(selectedId);
  if (
    selected &&
    normalizedEntries.some((entry) => entry.id === selected && hasDisplayableHistoryText(entry))
  ) {
    return selected;
  }

  const usable = normalizedEntries
    .filter(hasDisplayableHistoryText)
    .sort(compareHistoryEntries);
  return usable[0]?.id || "";
}
