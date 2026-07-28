import { getStartupFailureCopy } from "./main-i18n.js";

export async function handleStartupFailure({
  app,
  dialog,
  language = "en"
} = {}) {
  const copy = getStartupFailureCopy(language);

  try {
    await dialog?.showMessageBox?.({
      type: "error",
      title: "Local Flow",
      message: copy.message,
      buttons: [copy.button],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
  } catch {
    // Quitting remains mandatory even when the native dialog is unavailable.
  } finally {
    app.isQuitting = true;
    app.quit?.();
  }
}
