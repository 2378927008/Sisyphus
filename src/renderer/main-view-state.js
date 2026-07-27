import { resolveHistoryEntryIds } from "./history-view-state.js";

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

export {
  filterHistory,
  groupHistoryByDate,
  normalizeHistoryEntries,
  resolveHistorySelection,
  resolveHistoryEntryId,
  resolveHistoryEntryIds
} from "./history-view-state.js";

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
    dirty: currentText !== baselineText,
    empty: currentText === ""
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

export function updateEditorBaseline(state, text) {
  const currentState = state && typeof state === "object" ? state : createEditorState();
  return editorState(normalizeText(text), normalizeText(currentState.currentText));
}

export function restoreEditorText(state) {
  const currentState = state && typeof state === "object" ? state : createEditorState();
  const baselineText = normalizeText(currentState.baselineText);
  return editorState(baselineText, baselineText);
}

const CONTENTEDITABLE_BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "HEADER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "UL"
]);

function contenteditableNodeText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.nodeType === 3) {
    return typeof node.nodeValue === "string" ? node.nodeValue : "";
  }
  if (node.nodeType !== 1) return "";
  if (String(node.tagName).toUpperCase() === "BR") return "\n";

  let output = "";
  const children = Array.from(node.childNodes || []);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const block = (
      child?.nodeType === 1 &&
      CONTENTEDITABLE_BLOCK_TAGS.has(String(child.tagName).toUpperCase())
    );
    if (block && output !== "" && !output.endsWith("\n")) output += "\n";
    output += contenteditableNodeText(child);
    if (block && index < children.length - 1 && !output.endsWith("\n")) output += "\n";
  }
  return output;
}

export function readContentEditableText(element) {
  return contenteditableNodeText(element);
}

function shouldRetainOrphanHistorySession(session) {
  return Boolean(
    session?.editorState?.dirty ||
    session?.savePhase === "saving" ||
    session?.savePhase === "error" ||
    session?.reprocessPhase === "running" ||
    session?.reprocessPhase === "error" ||
    (session?.pendingRestoreTarget !== null && session?.pendingRestoreTarget !== undefined)
  );
}

export function pruneHistorySessionMaps(sessions, operationVersions, activeIds = []) {
  const active = new Set(activeIds);
  for (const [id, session] of sessions) {
    if (!active.has(id) && !shouldRetainOrphanHistorySession(session)) {
      sessions.delete(id);
    }
  }
  for (const id of operationVersions.keys()) {
    if (!active.has(id) && !sessions.has(id)) {
      operationVersions.delete(id);
    }
  }
}

export function projectHistory(entries, limit) {
  const normalizedLimit = normalizeLimit(limit);
  if (!Array.isArray(entries) || normalizedLimit === 0) {
    return [];
  }

  const ids = resolveHistoryEntryIds(entries);
  return entries
    .map((entry, index) => ({ entry, id: ids[index] }))
    .filter(({ entry }) => (
      entry &&
      typeof entry === "object" &&
      entry.status === "complete" &&
      normalizeText(entry.text) !== ""
    ))
    .slice(0, normalizedLimit)
    .map(({ entry, id }) => {
      const text = normalizeText(entry.text);
      return {
        ...entry,
        text,
        id,
        characterCount: characterCount(text)
      };
    });
}

export function normalizeViewPhase(phase) {
  if (phase === "polishing") return "transcribing";
  return VIEW_PHASES.has(phase) ? phase : "idle";
}
