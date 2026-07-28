export function createPasteLastAction({
  hasActiveOperation = () => false,
  getText = () => "",
  paste = async () => {},
  notify = () => {}
} = {}) {
  return async function pasteLast() {
    if (hasActiveOperation()) {
      return { ok: false, reason: "recording_active" };
    }

    const text = String(getText() || "").trim();
    if (!text) {
      notify({
        phase: "warning",
        reason: "no_last_dictation",
        message: "No previous dictation result to paste."
      });
      return { ok: false, reason: "no_last_dictation" };
    }

    notify({
      phase: "pasting",
      message: "Pasting last dictation..."
    });

    try {
      await paste(text);
      notify({
        phase: "done",
        message: "Last dictation pasted."
      });
      return { ok: true };
    } catch (error) {
      const reason = typeof error?.code === "string" && error.code
        ? error.code
        : "paste_failed";
      notify({
        phase: "warning",
        reason,
        message: "Paste failed. Text copied."
      });
      return { ok: false, reason };
    }
  };
}
