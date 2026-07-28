import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function validateWindowsKnownFolders(snapshot) {
  const errors = [];
  const required = [
    "appData",
    "localAppData",
    "desktop",
    "programs",
    "startMenu"
  ];

  for (const field of required) {
    const value = snapshot?.[field];
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      !path.win32.isAbsolute(value)
    ) {
      errors.push(`${field} must be an absolute Windows known-folder path`);
    }
  }

  if (
    errors.length === 0 &&
    path.win32.normalize(path.win32.dirname(snapshot.programs)).toLowerCase() !==
      path.win32.normalize(snapshot.startMenu).toLowerCase()
  ) {
    errors.push("programs must be a direct child of startMenu");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export async function queryWindowsKnownFolders({
  env = process.env,
  requireComplete = true
} = {}) {
  if (process.platform !== "win32") {
    throw new Error("Windows known folders are available only on Windows.");
  }

  const script = `
    $ErrorActionPreference = 'Stop'
    [pscustomobject]@{
      appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
      localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
      desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
      programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
      startMenu = [Environment]::GetFolderPath([Environment+SpecialFolder]::StartMenu)
    } | ConvertTo-Json -Compress
  `;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024
    }
  );
  const snapshot = JSON.parse(stdout.trim());
  const validation = validateWindowsKnownFolders(snapshot);
  if (requireComplete && !validation.ok) {
    throw new Error(validation.errors.join("; "));
  }
  return snapshot;
}
