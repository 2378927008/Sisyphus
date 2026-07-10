const VIEW_PHASES = new Set([
  "idle",
  "starting",
  "recording",
  "stopping",
  "transcribing",
  "pasting",
  "done",
  "warning",
  "error"
]);

function normalizeText(text) {
  return typeof text === "string" ? text : "";
}

function characterCount(text) {
  return Array.from(text).length;
}

function normalizeLimit(limit) {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
}

function editorState(baselineText, currentText) {
  return {
    baselineText,
    currentText,
    characterCount: characterCount(currentText),
    dirty: currentText !== baselineText
  };
}

export function createEditorState(text = "") {
  const normalizedText = normalizeText(text);
  return editorState(normalizedText, normalizedText);
}

export function replaceEditorText(state, text, options = {}) {
  const currentState = state && typeof state === "object" ? state : createEditorState();
  const nextText = normalizeText(text);
  const baselineText = options && options.asBaseline
    ? nextText
    : normalizeText(currentState.baselineText);
  return editorState(baselineText, nextText);
}

export function restoreEditorText(state) {
  const currentState = state && typeof state === "object" ? state : createEditorState();
  const baselineText = normalizeText(currentState.baselineText);
  return editorState(baselineText, baselineText);
}

export function projectHistory(entries, limit) {
  const normalizedLimit = normalizeLimit(limit);
  if (!Array.isArray(entries) || normalizedLimit === 0) {
    return [];
  }

  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => (
      entry &&
      typeof entry === "object" &&
      entry.status === "complete" &&
      normalizeText(entry.text) !== ""
    ))
    .slice(0, normalizedLimit)
    .map(({ entry, index }) => {
      const text = normalizeText(entry.text);
      const id = typeof entry.id === "string" && entry.id.trim() !== ""
        ? entry.id
        : `${normalizeText(entry.createdAt)}:${index}`;
      return {
        ...entry,
        text,
        id,
        characterCount: characterCount(text)
      };
    });
}

export function normalizeViewPhase(phase) {
  return VIEW_PHASES.has(phase) ? phase : "idle";
}
