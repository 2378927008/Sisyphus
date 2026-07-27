function asText(value) {
  return typeof value === "string" ? value : "";
}

function comparisonText(value) {
  return asText(value).normalize("NFKC").toLowerCase();
}

function validId(entry, index) {
  const id = asText(entry?.id).trim();
  return id || `${asText(entry?.createdAt)}:${index}`;
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

export function normalizeHistoryEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry && typeof entry === "object")
    .map(({ entry, index }) => {
      const text = asText(entry.text);
      const transcript = asText(entry.transcript);
      return {
        ...entry,
        id: validId(entry, index),
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

  return [...groups.values()];
}

export function resolveHistorySelection(entries, selectedId) {
  const normalizedEntries = normalizeHistoryEntries(entries);
  const selected = asText(selectedId);
  if (selected && normalizedEntries.some((entry) => entry.id === selected)) return selected;

  const usable = normalizedEntries
    .filter((entry) => entry.status === "complete" || entry.status === "partial")
    .sort((left, right) => timestamp(right) - timestamp(left));
  return usable[0]?.id || normalizedEntries[0]?.id || "";
}
