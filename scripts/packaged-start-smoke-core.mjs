import path from "node:path";

function normalizeWindowsPath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  return path.win32.normalize(value.trim().replace(/^"(.*)"$/, "$1"))
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function getUserDataArgument(commandLine) {
  if (typeof commandLine !== "string") {
    return "";
  }

  const match = commandLine.match(
    /(?:^|\s)--user-data-dir(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s]+))/i
  );
  return match ? match[1] || match[2] || match[3] || "" : "";
}

function isElectronHelper(commandLine) {
  return typeof commandLine === "string" && /(?:^|\s)--type(?:=|\s+)/i.test(commandLine);
}

export function buildPackagedAppSpawnOptions(projectRoot) {
  return {
    cwd: projectRoot,
    stdio: "ignore",
    windowsHide: false
  };
}

export function filterScopedProcesses(processes, { exePath, userDataDir, includeHelpers = true } = {}) {
  const normalizedExe = normalizeWindowsPath(exePath);
  const normalizedUserData = normalizeWindowsPath(userDataDir);

  return (Array.isArray(processes) ? processes : []).filter((processInfo) => {
    if (normalizeWindowsPath(processInfo?.ExecutablePath) !== normalizedExe) {
      return false;
    }
    if (normalizeWindowsPath(getUserDataArgument(processInfo?.CommandLine)) !== normalizedUserData) {
      return false;
    }
    return includeHelpers || !isElectronHelper(processInfo?.CommandLine);
  });
}

export function summarizePackagedStartup({
  exePath,
  userDataDir,
  firstPid,
  hiddenLaunchStayedAlive,
  secondLaunchExited,
  processes
} = {}) {
  const mainProcesses = filterScopedProcesses(processes, {
    exePath,
    userDataDir,
    includeHelpers: false
  });
  const firstMainProcess = mainProcesses.find(
    (processInfo) => Number(processInfo.ProcessId) === Number(firstPid)
  );
  const hasVisibleWindow = mainProcesses.some(
    (processInfo) =>
      Number(processInfo.MainWindowHandle) > 0 &&
      processInfo.IsWindowVisible === true
  );
  const firstStayedAlive = Boolean(hiddenLaunchStayedAlive && firstMainProcess);
  const secondExited = Boolean(secondLaunchExited);
  const duplicateMainInstances = Math.max(0, mainProcesses.length - 1);
  const secondLaunchRevealedExistingWindow = Boolean(
    firstStayedAlive && secondExited && hasVisibleWindow
  );

  return {
    ok:
      firstStayedAlive &&
      secondExited &&
      secondLaunchRevealedExistingWindow &&
      duplicateMainInstances === 0,
    hiddenLaunchStayedAlive: firstStayedAlive,
    secondLaunchExited: secondExited,
    secondLaunchRevealedExistingWindow,
    duplicateMainInstances
  };
}
