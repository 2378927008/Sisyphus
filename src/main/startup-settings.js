export function getStartupLaunchArgs(settings = {}) {
  return settings.startMinimizedToTray ? ["--hidden"] : [];
}

export function applyStartupSettings(app, settings = {}, deps = {}) {
  const execPath = deps.execPath || process.execPath;
  const options = {
    openAtLogin: Boolean(settings.launchAtLogin),
    path: execPath,
    args: getStartupLaunchArgs(settings)
  };

  app.setLoginItemSettings(options);
  return options;
}

export function shouldStartMinimized(argv = process.argv, settings = {}) {
  return argv.includes("--hidden") || Boolean(settings.startMinimizedToTray);
}
