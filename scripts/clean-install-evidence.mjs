import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCleanInstallEvidence } from "./clean-install-evidence-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const defaultOutput = path.join(
  projectRoot,
  "docs",
  "release",
  "evidence",
  "windows-clean-install-v4.json"
);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function replaceInsensitive(value, search, replacement) {
  if (!search) {
    return value;
  }
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), replacement);
}

function normalizeMachineValue(value, existingInstallRoot) {
  if (typeof value !== "string") {
    return value;
  }
  let normalized = value;
  normalized = replaceInsensitive(normalized, existingInstallRoot, "<existing-install-root>");
  normalized = replaceInsensitive(normalized, projectRoot, "<project-root>");
  normalized = replaceInsensitive(normalized, process.env.APPDATA, "%APPDATA%");
  normalized = replaceInsensitive(normalized, process.env.USERPROFILE, "%USERPROFILE%");
  normalized = normalized.replaceAll("\\", "/");
  if (/[a-z]:\//i.test(normalized)) {
    return "<redacted-machine-path>";
  }
  return normalized;
}

async function sha256File(filePath) {
  const binary = await readFile(filePath);
  return createHash("sha256").update(binary).digest("hex");
}

async function observedFile(filePath, normalizedPath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`${normalizedPath} is not a file`);
  }
  return {
    status: "observed",
    path: normalizedPath,
    sha256: await sha256File(filePath),
    bytes: fileStat.size
  };
}

function runPowerShell(script, environment = {}) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        ...environment
      }
    }
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "PowerShell query failed").trim());
  }
  return JSON.parse(result.stdout.trim());
}

async function collectShortcut(existingInstallRoot) {
  const shortcutPath = path.join(
    process.env.APPDATA || "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Local Flow.lnk"
  );
  try {
    const shortcut = runPowerShell(
      `
        $path = $env:LOCAL_FLOW_EVIDENCE_SHORTCUT
        if (-not (Test-Path -LiteralPath $path)) {
          [pscustomobject]@{ exists = $false } | ConvertTo-Json -Compress
          exit 0
        }
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut($path)
        [pscustomobject]@{
          exists = $true
          target = $link.TargetPath
          workingDirectory = $link.WorkingDirectory
        } | ConvertTo-Json -Compress
      `,
      { LOCAL_FLOW_EVIDENCE_SHORTCUT: shortcutPath }
    );
    if (!shortcut.exists) {
      return {
        status: "observed",
        path: "%APPDATA%/Microsoft/Windows/Start Menu/Programs/Local Flow.lnk",
        exists: false
      };
    }
    return {
      status: "observed",
      path: "%APPDATA%/Microsoft/Windows/Start Menu/Programs/Local Flow.lnk",
      exists: true,
      target: normalizeMachineValue(shortcut.target, existingInstallRoot),
      workingDirectory: normalizeMachineValue(
        shortcut.workingDirectory,
        existingInstallRoot
      ),
      sha256: await sha256File(shortcutPath)
    };
  } catch (error) {
    return {
      status: "unsupported",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function collectUninstallRegistration(existingInstallRoot) {
  try {
    const snapshot = runPowerShell(`
      $scopes = @(
        [pscustomobject]@{ role = 'current_user'; path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' },
        [pscustomobject]@{ role = 'local_machine_64'; path = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' },
        [pscustomobject]@{ role = 'local_machine_32'; path = 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' },
        [pscustomobject]@{ role = 'loaded_users'; path = 'Registry::HKEY_USERS\\*\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' }
      )
      $scopeResults = @()
      $matches = @()
      foreach ($scope in $scopes) {
        $entries = @(
          Get-ItemProperty -Path $scope.path -ErrorAction SilentlyContinue |
            Where-Object {
              $_.DisplayName -like '*Local Flow*' -or
              $_.UninstallString -like '*Local Flow*'
            }
        )
        $scopeResults += [pscustomobject]@{
          role = $scope.role
          status = 'observed'
          matchingEntryCount = $entries.Count
        }
        foreach ($entry in $entries) {
          $matches += [pscustomobject]@{
            role = $scope.role
            displayName = [string]$entry.DisplayName
            displayVersion = [string]$entry.DisplayVersion
            installLocation = [string]$entry.InstallLocation
            uninstallString = [string]$entry.UninstallString
          }
        }
      }
      [pscustomobject]@{
        scopes = @($scopeResults)
        matchingEntries = @($matches)
      } | ConvertTo-Json -Depth 5 -Compress
    `);
    const matchingEntries = (snapshot.matchingEntries || []).map((entry) => ({
      role: entry.role,
      displayName: entry.displayName,
      displayVersion: entry.displayVersion,
      installLocation: normalizeMachineValue(entry.installLocation, existingInstallRoot),
      uninstallString: normalizeMachineValue(entry.uninstallString, existingInstallRoot)
    }));
    return {
      status: "observed",
      scopes: snapshot.scopes,
      matchingEntries,
      conclusion: matchingEntries.length === 0 ? "absent" : "present"
    };
  } catch (error) {
    return {
      status: "unsupported",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function collectScopedProcesses(existingInstallRoot) {
  const releaseExe = path.join(projectRoot, "dist", "win-unpacked", "Local Flow.exe");
  const existingExe = existingInstallRoot
    ? path.join(existingInstallRoot, "Local Flow.exe")
    : "";
  try {
    const snapshot = runPowerShell(
      `
        $releaseExe = $env:LOCAL_FLOW_EVIDENCE_RELEASE_EXE
        $existingExe = $env:LOCAL_FLOW_EVIDENCE_EXISTING_EXE
        $matches = @(
          Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object {
              ($_.Name -ieq 'notepad.exe') -or
              ($_.Name -ieq 'Local Flow.exe' -and (
                $_.ExecutablePath -ieq $releaseExe -or
                ($existingExe -and $_.ExecutablePath -ieq $existingExe)
              ))
            }
        )
        [pscustomobject]@{
          matchingProcessCount = $matches.Count
        } | ConvertTo-Json -Compress
      `,
      {
        LOCAL_FLOW_EVIDENCE_RELEASE_EXE: releaseExe,
        LOCAL_FLOW_EVIDENCE_EXISTING_EXE: existingExe
      }
    );
    return {
      status: "observed",
      processNames: ["Local Flow.exe", "notepad.exe"],
      scope: "exact known Local Flow executable roles plus notepad.exe",
      matchingProcessCount: snapshot.matchingProcessCount
    };
  } catch (error) {
    return {
      status: "unsupported",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

async function collectTemporaryTestArtifacts() {
  const temporaryRoot = path.join(projectRoot, ".tmp");
  let matchingEntryCount = 0;
  try {
    const entries = await readdir(temporaryRoot, { withFileTypes: true });
    matchingEntryCount = entries.filter((entry) => entry.name.startsWith("clean-install")).length;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return {
    status: "observed",
    scope: ".tmp/clean-install*",
    matchingEntryCount
  };
}

async function collectExistingInstallation(existingInstallRoot, releaseExecutable) {
  if (!existingInstallRoot) {
    return {
      status: "unsupported",
      reason: "LOCAL_FLOW_EXISTING_INSTALL_ROOT was not provided"
    };
  }
  const executable = await observedFile(
    path.join(existingInstallRoot, "Local Flow.exe"),
    "<existing-install-root>/Local Flow.exe"
  );
  const uninstaller = await observedFile(
    path.join(existingInstallRoot, "Uninstall Local Flow.exe"),
    "<existing-install-root>/Uninstall Local Flow.exe"
  );
  return {
    status: "observed",
    role: "existing_user_install",
    root: "<existing-install-root>",
    executable,
    uninstaller,
    executableMatchesRelease: executable.sha256 === releaseExecutable.sha256
  };
}

async function createManifest(existingInstallRoot) {
  const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const outputDir = pkg.build?.directories?.output || "dist";
  const productName = pkg.build?.productName || "Local Flow";
  const installerPath = path.join(
    projectRoot,
    outputDir,
    `${productName} Setup ${pkg.version}.exe`
  );
  const blockmapPath = `${installerPath}.blockmap`;
  const unpackedExecutablePath = path.join(
    projectRoot,
    outputDir,
    "win-unpacked",
    `${productName}.exe`
  );
  const unpackedExecutable = await observedFile(
    unpackedExecutablePath,
    `${outputDir}/win-unpacked/${productName}.exe`
  );

  const desktopShortcutPath = path.join(
    process.env.USERPROFILE || os.homedir(),
    "Desktop",
    "Local Flow.lnk"
  );
  let desktopShortcutExists = false;
  try {
    const shortcutStat = await stat(desktopShortcutPath);
    desktopShortcutExists = shortcutStat.isFile();
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return {
    schemaVersion: 1,
    evidenceKind: "local-flow-windows-clean-install",
    generatedAt: new Date().toISOString(),
    readinessScope: "read-only-current-state-and-manual-clean-install-plan",
    source: {
      collector: "scripts/clean-install-evidence.mjs",
      command: "npm.cmd run collect:clean-install-evidence",
      existingInstallInput: "LOCAL_FLOW_EXISTING_INSTALL_ROOT=<existing-install-root>"
    },
    safety: {
      existingInstallMutation: "prohibited",
      installerRun: false,
      uninstallerRun: false
    },
    releaseArtifacts: {
      status: "observed",
      version: pkg.version,
      installer: await observedFile(
        installerPath,
        `${outputDir}/${productName} Setup ${pkg.version}.exe`
      ),
      blockmap: await observedFile(
        blockmapPath,
        `${outputDir}/${productName} Setup ${pkg.version}.exe.blockmap`
      ),
      unpackedExecutable
    },
    currentState: {
      status: "observed",
      existingInstallation: await collectExistingInstallation(
        existingInstallRoot,
        unpackedExecutable
      ),
      startMenuShortcut: await collectShortcut(existingInstallRoot),
      desktopShortcut: {
        status: "observed",
        path: "%USERPROFILE%/Desktop/Local Flow.lnk",
        exists: desktopShortcutExists
      },
      uninstallRegistration: collectUninstallRegistration(existingInstallRoot),
      scopedProcesses: collectScopedProcesses(existingInstallRoot),
      temporaryTestArtifacts: await collectTemporaryTestArtifacts()
    },
    cleanInstallTrial: {
      status: "not_run",
      isolatedInstallRoot: {
        status: "manual_required",
        role: "isolated_install_root",
        value: null
      },
      sentinel: {
        before: { status: "not_run", sha256: null },
        after: { status: "not_run", sha256: null }
      },
      shortcuts: {
        before: { status: "not_run", target: null, sha256: null },
        after: { status: "not_run", target: null, sha256: null }
      },
      uninstallRegistration: {
        before: { status: "not_run", matchingEntries: null },
        after: { status: "not_run", matchingEntries: null }
      },
      processScope: {
        status: "not_run",
        executableRole: "isolated_install_executable",
        userDataRole: "isolated_test_profile",
        matchingProcessCount: null
      },
      productTextInsertion: {
        status: "manual_required",
        targetApplication: "Windows Notepad",
        path: [
          "global_shortcut",
          "microphone",
          "whisper",
          "output_pipeline",
          "send_input",
          "notepad"
        ],
        expectedText: "Local Flow clean-install insertion trial",
        evidenceToRetain: [
          "target text file hash",
          "trial timestamp",
          "isolated user-data role"
        ]
      }
    }
  };
}

try {
  const outputPath = path.resolve(readArgument("--output") || defaultOutput);
  const existingInstallRoot =
    readArgument("--existing-install-root") ||
    process.env.LOCAL_FLOW_EXISTING_INSTALL_ROOT ||
    "";
  const manifest = await createManifest(existingInstallRoot);
  const validation = validateCleanInstallEvidence(manifest);
  if (!validation.ok) {
    throw new Error(`evidence manifest validation failed: ${validation.errors.join("; ")}`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output: normalizeMachineValue(outputPath, existingInstallRoot),
    readinessScope: manifest.readinessScope,
    cleanInstallTrial: manifest.cleanInstallTrial.status
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error)
  }, null, 2)}\n`);
  process.exitCode = 1;
}
