import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildUninstallRegistrationEvidence,
  redactEvidenceValue,
  validateCleanInstallEvidence
} from "./clean-install-evidence-core.mjs";

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

function normalizeMachineValue(value, existingInstallRoot) {
  const normalized = redactEvidenceValue(value, {
    replacements: [
      {
        value: existingInstallRoot,
        replacement: "<existing-install-root>"
      },
      {
        value: projectRoot,
        replacement: "<project-root>"
      }
    ]
  });
  return typeof normalized === "string"
    ? normalized.replaceAll("\\", "/")
    : normalized;
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
    const detail = normalizeMachineValue(
      (result.stderr || result.stdout || "PowerShell query failed").trim(),
      ""
    );
    throw new Error(`PowerShell query failed: ${detail}`);
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
      reason: normalizeMachineValue(
        error instanceof Error ? error.message : String(error),
        existingInstallRoot
      )
    };
  }
}

function collectUninstallRegistration(existingInstallRoot) {
  try {
    const snapshot = runPowerShell(`
      function Get-ExecutionContextRole {
        try {
          $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
          if ([string]$identity.Name -match '(?i)(codexsandbox|sandbox)') {
            return 'restricted_process'
          }
          try {
            $currentSid = [string]$identity.User.Value
            $explorers = @(
              Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" -ErrorAction Stop
            )
            foreach ($explorer in $explorers) {
              $owner = Invoke-CimMethod -InputObject $explorer -MethodName GetOwnerSid -ErrorAction Stop
              if ([string]$owner.Sid -eq $currentSid) {
                return 'interactive_user'
              }
            }
          } catch {
            return 'unknown'
          }
        } catch {
          return 'unknown'
        }
        return 'unknown'
      }

      function Convert-LocalFlowEntry {
        param($Entry)
        $existingRoot = [string]$env:LOCAL_FLOW_EVIDENCE_EXISTING_ROOT
        $installLocation = [string]$Entry.InstallLocation
        $uninstallString = [string]$Entry.UninstallString
        $installLocationRole = if (-not $installLocation) {
          'none'
        } elseif ($existingRoot -and $installLocation.IndexOf(
          $existingRoot,
          [System.StringComparison]::OrdinalIgnoreCase
        ) -ge 0) {
          'existing_install_root'
        } else {
          'redacted_other_location'
        }
        $uninstallTargetRole = if (-not $uninstallString) {
          'none'
        } elseif ($existingRoot -and $uninstallString.IndexOf(
          $existingRoot,
          [System.StringComparison]::OrdinalIgnoreCase
        ) -ge 0) {
          'existing_install_uninstaller'
        } else {
          'redacted_other_target'
        }
        [pscustomobject]@{
          displayName = [string]$Entry.DisplayName
          displayVersion = [string]$Entry.DisplayVersion
          installLocationRole = $installLocationRole
          uninstallTargetRole = $uninstallTargetRole
        }
      }

      function Get-LocalFlowEntriesAtBase {
        param([string]$BasePath)
        $matches = @()
        if (-not (Test-Path -LiteralPath $BasePath -ErrorAction Stop)) {
          return $matches
        }
        $children = @(Get-ChildItem -LiteralPath $BasePath -ErrorAction Stop)
        foreach ($child in $children) {
          $entry = Get-ItemProperty -LiteralPath $child.PSPath -ErrorAction Stop
          if (
            [string]$entry.DisplayName -like '*Local Flow*' -or
            [string]$entry.UninstallString -like '*Local Flow*'
          ) {
            $matches += Convert-LocalFlowEntry -Entry $entry
          }
        }
        return $matches
      }

      function Get-LoadedUserEntries {
        $matches = @()
        $profiles = @(
          Get-ChildItem -LiteralPath 'Registry::HKEY_USERS' -ErrorAction Stop |
            Where-Object { [string]$_.PSChildName -notmatch '_Classes$' }
        )
        foreach ($profile in $profiles) {
          $basePath = "$($profile.PSPath)\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
          $matches += @(Get-LocalFlowEntriesAtBase -BasePath $basePath)
        }
        return $matches
      }

      $scopeDefinitions = @(
        [pscustomobject]@{
          role = 'collector_current_user'
          path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
        },
        [pscustomobject]@{
          role = 'local_machine_64'
          path = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
        },
        [pscustomobject]@{
          role = 'local_machine_32'
          path = 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
        },
        [pscustomobject]@{
          role = 'loaded_user_profiles'
          path = $null
        }
      )
      $scopeResults = @()
      foreach ($scope in $scopeDefinitions) {
        try {
          $entries = if ($scope.role -eq 'loaded_user_profiles') {
            @(Get-LoadedUserEntries)
          } else {
            @(Get-LocalFlowEntriesAtBase -BasePath $scope.path)
          }
          $scopeResults += [pscustomobject]@{
            role = $scope.role
            access = 'success'
            matchingEntries = @($entries)
          }
        } catch {
          $scopeResults += [pscustomobject]@{
            role = $scope.role
            access = 'failed'
            reason = 'registry_scope_query_failed'
            matchingEntries = @()
          }
        }
      }
      [pscustomobject]@{
        executionContextRole = Get-ExecutionContextRole
        scopeResults = @($scopeResults)
      } | ConvertTo-Json -Depth 5 -Compress
    `, {
      LOCAL_FLOW_EVIDENCE_EXISTING_ROOT: existingInstallRoot
    });
    return buildUninstallRegistrationEvidence({
      executionContextRole: snapshot.executionContextRole,
      scopeResults: snapshot.scopeResults
    });
  } catch {
    return buildUninstallRegistrationEvidence({
      executionContextRole: "unknown",
      scopeResults: [
        "collector_current_user",
        "local_machine_64",
        "local_machine_32",
        "loaded_user_profiles"
      ].map((role) => ({
        role,
        access: "unknown",
        reason: "registry collection did not complete",
        matchingEntries: []
      }))
    });
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
      reason: normalizeMachineValue(
        error instanceof Error ? error.message : String(error),
        existingInstallRoot
      )
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

  const existingInstallation = await collectExistingInstallation(
    existingInstallRoot,
    unpackedExecutable
  );
  const startMenuShortcut = await collectShortcut(existingInstallRoot);
  const uninstallRegistration = collectUninstallRegistration(existingInstallRoot);
  const scopedProcesses = collectScopedProcesses(existingInstallRoot);
  const temporaryTestArtifacts = await collectTemporaryTestArtifacts();
  const currentStateStatus = [
    existingInstallation,
    startMenuShortcut,
    { status: "observed" },
    uninstallRegistration,
    scopedProcesses,
    temporaryTestArtifacts
  ].every(({ status }) => status === "observed")
    ? "observed"
    : "partial";

  return {
    schemaVersion: 1,
    evidenceKind: "local-flow-windows-clean-install",
    generatedAt: new Date().toISOString(),
    readinessScope: "read-only-current-state-and-manual-clean-install-plan",
    source: {
      collector: "scripts/clean-install-evidence.mjs",
      collectionMode: "repository_persistent_read_only_snapshot",
      existingInstallInputRole: "normalized_existing_install_root",
      registrySnapshotDisposition: "per_scope_access_and_context_recorded"
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
      status: currentStateStatus,
      executionContextRole: uninstallRegistration.executionContextRole,
      existingInstallation,
      startMenuShortcut,
      desktopShortcut: {
        status: "observed",
        path: "%USERPROFILE%/Desktop/Local Flow.lnk",
        exists: desktopShortcutExists
      },
      uninstallRegistration,
      scopedProcesses,
      temporaryTestArtifacts
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

const outputPath = path.resolve(readArgument("--output") || defaultOutput);
const existingInstallRoot =
  readArgument("--existing-install-root") ||
  process.env.LOCAL_FLOW_EXISTING_INSTALL_ROOT ||
  "";

try {
  const collectedManifest = await createManifest(existingInstallRoot);
  const manifest = redactEvidenceValue(collectedManifest, {
    replacements: [
      {
        value: existingInstallRoot,
        replacement: "<existing-install-root>"
      },
      {
        value: projectRoot,
        replacement: "<project-root>"
      }
    ]
  });
  const validation = validateCleanInstallEvidence(manifest);
  if (!validation.ok) {
    throw new Error(`evidence manifest validation failed: ${validation.errors.join("; ")}`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const successOutput = redactEvidenceValue(
    {
      ok: true,
      output: normalizeMachineValue(outputPath, existingInstallRoot),
      readinessScope: manifest.readinessScope,
      cleanInstallTrial: manifest.cleanInstallTrial.status
    },
    {
      replacements: [
        {
          value: existingInstallRoot,
          replacement: "<existing-install-root>"
        },
        {
          value: projectRoot,
          replacement: "<project-root>"
        }
      ]
    }
  );
  process.stdout.write(`${JSON.stringify(successOutput, null, 2)}\n`);
} catch (error) {
  const failureOutput = redactEvidenceValue(
    {
      ok: false,
      message: normalizeMachineValue(
        error instanceof Error ? error.message : String(error),
        existingInstallRoot
      )
    },
    {
      replacements: [
        {
          value: existingInstallRoot,
          replacement: "<existing-install-root>"
        },
        {
          value: projectRoot,
          replacement: "<project-root>"
        }
      ]
    }
  );
  process.stderr.write(`${JSON.stringify(failureOutput, null, 2)}\n`);
  process.exitCode = 1;
}
