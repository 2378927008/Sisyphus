export function createSettingsEffectsTransaction({
  settingsStore,
  getCurrentSettings,
  setCurrentSettings,
  applyStartupSettings,
  registerHotkey,
  refreshTrayMenu,
  reportSystemError
}) {
  let transactionQueue = Promise.resolve();

  const runTransaction = async (settings) => {
    const previousSettings = getCurrentSettings() || await settingsStore.getSettings();
    const next = await settingsStore.saveSettings(settings);
    setCurrentSettings(next);

    try {
      await applyStartupSettings(next);
    } catch (error) {
      const restored = await settingsStore.saveSettings({
        launchAtLogin: previousSettings.launchAtLogin,
        startMinimizedToTray: previousSettings.startMinimizedToTray
      });
      setCurrentSettings(restored);
      refreshTrayMenu();
      await registerHotkey(restored);
      reportSystemError(error, "startup_settings_failed");
      error.localFlowStatusReported = true;
      throw error;
    }

    await registerHotkey(next);
    refreshTrayMenu();
    return next;
  };

  return function saveSettingsWithSystemEffects(settings) {
    const pending = transactionQueue.then(() => runTransaction(settings));
    transactionQueue = pending.catch(() => {});
    return pending;
  };
}
