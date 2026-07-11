export function createSettingsEffectsTransaction({
  settingsStore,
  setCurrentSettings,
  applyStartupSettings,
  registerHotkey,
  refreshTrayMenu,
  reportSystemError
}) {
  let transactionQueue = Promise.resolve();

  const runTransaction = async (settings) => {
    const previousSettings = await settingsStore.getSettings({ includeSecrets: true });

    try {
      const next = await settingsStore.saveSettings(settings);
      setCurrentSettings(next);
      await applyStartupSettings(next);
      await registerHotkey(next);
      await refreshTrayMenu();
      return next;
    } catch (error) {
      const primaryError = error;
      const rollbackErrors = [];
      const attemptRollback = async (operation) => {
        try {
          await operation();
        } catch (rollbackError) {
          rollbackErrors.push(normalizeTransactionError(rollbackError));
        }
      };

      await attemptRollback(() => settingsStore.saveSettings(previousSettings));
      await attemptRollback(() => setCurrentSettings(previousSettings));
      await attemptRollback(() => applyStartupSettings(previousSettings));
      await attemptRollback(() => registerHotkey(previousSettings));
      await attemptRollback(() => refreshTrayMenu());

      try {
        reportSystemError(primaryError, "settings_update_failed", rollbackErrors);
      } catch (reportError) {
        rollbackErrors.push(normalizeTransactionError(reportError));
      }
      throw primaryError;
    }
  };

  return function saveSettingsWithSystemEffects(settings) {
    const pending = transactionQueue.then(() => runTransaction(settings));
    transactionQueue = pending.catch(() => {});
    return pending;
  };
}

function normalizeTransactionError(error) {
  return error instanceof Error ? error : new Error(String(error));
}
