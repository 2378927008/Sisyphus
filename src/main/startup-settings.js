import { isHiddenLaunch } from "./single-instance.js";

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

  try {
    app.setLoginItemSettings(options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not update Windows startup settings: ${reason}`, { cause: error });
  }

  return options;
}

export function shouldStartMinimized(argv = process.argv) {
  return isHiddenLaunch(argv);
}
