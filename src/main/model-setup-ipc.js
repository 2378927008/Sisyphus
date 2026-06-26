export function wireModelSetupIpc({ ipcMain, modelSetupService, settingsStore }) {
  ipcMain.handle("models:setup-status", () => modelSetupService.refresh());
  ipcMain.handle("models:setup-refresh", () => refreshDetectedModelPaths({
    modelSetupService,
    settingsStore
  }));
  ipcMain.handle("models:setup-start", async (_event, type) => {
    const result = await modelSetupService.start(type);
    if (result.status === "complete" && result.assets) {
      await saveDetectedModelPaths(settingsStore, result.assets);
    }
    return result;
  });
  ipcMain.handle("models:setup-cancel", (_event, type) => modelSetupService.cancel(type));
}

export async function refreshDetectedModelPaths({ modelSetupService, settingsStore }) {
  const status = await modelSetupService.refresh();
  await saveDetectedModelPaths(settingsStore, status.assets);
  return status;
}

export async function saveDetectedModelPaths(settingsStore, assets = {}) {
  const next = collectDetectedModelPaths(assets);

  if (Object.keys(next).length) {
    await settingsStore.saveSettings(next);
  }
}

export function collectDetectedModelPaths(assets = {}) {
  const next = {};

  if (assets.whisper?.whisperCliPath) {
    next.whisperCliPath = assets.whisper.whisperCliPath;
  }
  if (assets.whisper?.whisperModelPath) {
    next.whisperModelPath = assets.whisper.whisperModelPath;
  }
  if (assets.llm?.cliPath) {
    next.embeddedLlmCliPath = assets.llm.cliPath;
  }
  if (assets.llm?.modelPath) {
    next.embeddedLlmModelPath = assets.llm.modelPath;
  }

  return next;
}
