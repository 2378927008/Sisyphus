import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeIsolatedRoot,
  registrationMatchesReleaseIdentity,
  registrationTargetsIsolatedRoot,
  validateIsolatedInstallEvidence
} from "./isolated-install-evidence-core.mjs";
import { validateEvidenceMatchesRelease } from "./clean-install-evidence-core.mjs";
import { queryWindowsKnownFolders } from "./windows-known-folders.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidencePath = path.join(
  projectRoot,
  "docs",
  "release",
  "evidence",
  "windows-isolated-install-v4.json"
);
const runRoot = path.join(
  projectRoot,
  ".tmp",
  `clean-install-${process.pid}-${Date.now()}`
);
const installRoot = assertSafeIsolatedRoot(
  projectRoot,
  path.join(runRoot, "app")
);
const userDataRoot = assertSafeIsolatedRoot(
  projectRoot,
  path.join(runRoot, "user-data")
);
let smokeStage = "startup";

class SmokeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SmokeError";
    this.code = code;
  }
}

function print(payload) {
  const stream = payload.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeWindowsPath(value) {
  return path.win32
    .normalize(String(value || "").replace(/^"(.*)"$/, "$1"))
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function pathsEqual(left, right) {
  return normalizeWindowsPath(left) === normalizeWindowsPath(right);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function sha256Value(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

async function observedFile(filePath, normalizedPath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new SmokeError("not_a_file", "A required release file is invalid.");
  }
  return {
    status: "observed",
    path: normalizedPath,
    sha256: await sha256File(filePath),
    bytes: fileStat.size
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) {
    return false;
  }
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function rmWithRetry(targetPath, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw lastError || new SmokeError("cleanup_failed", "Temporary release validation files could not be removed.");
}

async function terminateProcessTree(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) {
    return;
  }
  try {
    await runProcess(
      "taskkill.exe",
      ["/PID", `${pid}`, "/T", "/F"],
      { timeoutMs: 15000, windowsHide: true }
    );
  } catch {
    // The process may already have exited.
  }
}

function runProcess(
  executable,
  args,
  {
    cwd = projectRoot,
    env = process.env,
    timeoutMs = 120000,
    windowsHide = true,
    captureOutput = false
  } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide,
      stdio: captureOutput
        ? ["ignore", "pipe", "pipe"]
        : ["ignore", "ignore", "ignore"]
    });
    let stdout = "";
    let stderr = "";
    if (captureOutput) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout = `${stdout}${chunk}`.slice(-256 * 1024);
      });
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-256 * 1024);
      });
    }

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new SmokeError("process_timeout", "A release validation process timed out."));
    }, timeoutMs);

    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new SmokeError("process_start_failed", "A release validation process could not start."));
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        pid: child.pid
      });
    });
  });
}

async function runPowerShellJson(script, environment = {}) {
  const result = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: {
        ...process.env,
        ...environment
      },
      timeoutMs: 30000,
      captureOutput: true
    }
  );
  if (result.code !== 0) {
    throw new SmokeError("powershell_failed", "A Windows state check failed.");
  }
  try {
    return JSON.parse(result.stdout.trim() || "null");
  } catch {
    throw new SmokeError("powershell_output_invalid", "A Windows state check returned invalid data.");
  }
}

async function waitFor(predicate, timeoutMs, failureCode, failureMessage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(250);
  }
  throw new SmokeError(failureCode, failureMessage);
}

async function captureShellFolders() {
  return runPowerShellJson(`
    $ErrorActionPreference = 'Stop'
    $paths = @(
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders'
    )
    $names = @('AppData', 'Local AppData', 'Desktop', 'Programs', 'Start Menu')
    $keys = @()
    foreach ($registryPath in $paths) {
      $keyExists = Test-Path -LiteralPath $registryPath
      $values = @()
      foreach ($name in $names) {
        $valueExists = $false
        $value = $null
        $kind = $null
        if ($keyExists) {
          try {
            $item = Get-Item -LiteralPath $registryPath -ErrorAction Stop
            $value = $item.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
            if ($null -ne $value) {
              $valueExists = $true
              $kind = [string]$item.GetValueKind($name)
            }
          } catch {}
        }
        $values += [pscustomobject]@{
          name = $name
          exists = $valueExists
          value = if ($valueExists) { [string]$value } else { $null }
          kind = $kind
        }
      }
      $keys += [pscustomobject]@{
        path = $registryPath
        exists = $keyExists
        values = @($values)
      }
    }
    [pscustomobject]@{ keys = @($keys) } | ConvertTo-Json -Depth 6 -Compress
  `);
}

function shellSnapshotsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function queryLocalFlowRegistrations() {
  const rows = await runPowerShellJson(`
    $ErrorActionPreference = 'Stop'
    $base = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    $matches = @()
    if (Test-Path -LiteralPath $base) {
      foreach ($child in @(Get-ChildItem -LiteralPath $base -ErrorAction Stop)) {
        $entry = Get-ItemProperty -LiteralPath $child.PSPath -ErrorAction Stop
        if (
          [string]$entry.DisplayName -like '*Local Flow*' -or
          [string]$entry.UninstallString -like '*Local Flow*'
        ) {
          $matches += [pscustomobject]@{
            keyPath = [string]$child.PSPath
            displayName = [string]$entry.DisplayName
            displayVersion = [string]$entry.DisplayVersion
            installLocation = [string]$entry.InstallLocation
            uninstallString = [string]$entry.UninstallString
          }
        }
      }
    }
    ConvertTo-Json -InputObject @($matches) -Depth 4 -Compress
  `);
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
}

async function queryInstallRegistry(installRegistryGuid) {
  return runPowerShellJson(`
    $ErrorActionPreference = 'Stop'
    $registryPath = "HKCU:\\Software\\$env:LOCAL_FLOW_INSTALL_REGISTRY_GUID"
    if (Test-Path -LiteralPath $registryPath) {
      $entry = Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop
      [pscustomobject]@{
        exists = $true
        installLocation = [string]$entry.InstallLocation
      } | ConvertTo-Json -Compress
    } else {
      [pscustomobject]@{
        exists = $false
        installLocation = ''
      } | ConvertTo-Json -Compress
    }
  `, {
    LOCAL_FLOW_INSTALL_REGISTRY_GUID: installRegistryGuid
  });
}

async function removeIsolatedRegistrations(installRegistryGuid) {
  await runPowerShellJson(`
    $ErrorActionPreference = 'Stop'
    $installRoot = [System.IO.Path]::GetFullPath($env:LOCAL_FLOW_ISOLATED_INSTALL_ROOT)
    $installRegistryPath = "HKCU:\\Software\\$env:LOCAL_FLOW_INSTALL_REGISTRY_GUID"
    $base = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    $uninstallEntriesRemoved = 0
    if (Test-Path -LiteralPath $base) {
      foreach ($child in @(Get-ChildItem -LiteralPath $base -ErrorAction Stop)) {
        $entry = Get-ItemProperty -LiteralPath $child.PSPath -ErrorAction Stop
        $location = [string]$entry.InstallLocation
        $uninstallString = [string]$entry.UninstallString
        $matchesRoot = (
          $location -and
          [System.IO.Path]::GetFullPath($location) -ieq $installRoot
        )
        $matchesUninstaller = (
          $uninstallString -and
          $uninstallString.IndexOf(
            (Join-Path $installRoot 'Uninstall Local Flow.exe'),
            [System.StringComparison]::OrdinalIgnoreCase
          ) -ge 0
        )
        if ($matchesRoot -or $matchesUninstaller) {
          Remove-Item -LiteralPath $child.PSPath -Recurse -Force
          $uninstallEntriesRemoved += 1
        }
      }
    }
    $installKeyRemoved = $false
    if (Test-Path -LiteralPath $installRegistryPath) {
      $entry = Get-ItemProperty -LiteralPath $installRegistryPath -ErrorAction Stop
      $location = [string]$entry.InstallLocation
      if (
        $location -and
        [System.IO.Path]::GetFullPath($location) -ieq $installRoot
      ) {
        Remove-Item -LiteralPath $installRegistryPath -Recurse -Force
        $installKeyRemoved = $true
      }
    }
    [pscustomobject]@{
      uninstallEntriesRemoved = $uninstallEntriesRemoved
      installKeyRemoved = $installKeyRemoved
    } | ConvertTo-Json -Compress
  `, {
    LOCAL_FLOW_ISOLATED_INSTALL_ROOT: installRoot,
    LOCAL_FLOW_INSTALL_REGISTRY_GUID: installRegistryGuid
  });
}

async function queryExecutionContextRole() {
  const result = await runPowerShellJson(`
    $role = 'unknown'
    try {
      $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
      if ([string]$identity.Name -match '(?i)(codexsandbox|sandbox)') {
        $role = 'restricted_process'
      } else {
        $role = 'interactive_user'
      }
    } catch {}
    [pscustomobject]@{ role = $role } | ConvertTo-Json -Compress
  `);
  return result.role;
}

async function inspectShortcut(shortcutPath) {
  return runPowerShellJson(`
    $ErrorActionPreference = 'Stop'
    $shortcutPath = $env:LOCAL_FLOW_ISOLATED_SHORTCUT
    if (-not (Test-Path -LiteralPath $shortcutPath)) {
      throw 'shortcut missing'
    }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($shortcutPath)
    [pscustomobject]@{
      target = [string]$link.TargetPath
      workingDirectory = [string]$link.WorkingDirectory
    } | ConvertTo-Json -Compress
  `, {
    LOCAL_FLOW_ISOLATED_SHORTCUT: shortcutPath
  });
}

async function captureProtectedState(
  shellSnapshot,
  protectedRoot,
  startMenuShortcutPath,
  desktopShortcutPath,
  installRegistryGuid
) {
  const registrations = await queryLocalFlowRegistrations();
  const installRegistry = await queryInstallRegistry(installRegistryGuid);
  const protectedFiles = [];
  if (protectedRoot) {
    for (const name of ["Local Flow.exe", "Uninstall Local Flow.exe"]) {
      const filePath = path.join(protectedRoot, name);
      if (await exists(filePath)) {
        const fileStat = await stat(filePath);
        protectedFiles.push({
          name,
          bytes: fileStat.size,
          sha256: await sha256File(filePath)
        });
      } else {
        protectedFiles.push({ name, exists: false });
      }
    }
  }
  const startMenuShortcut = await exists(startMenuShortcutPath)
    ? {
        exists: true,
        bytes: (await stat(startMenuShortcutPath)).size,
        sha256: await sha256File(startMenuShortcutPath)
      }
    : { exists: false };
  const desktopShortcut = await exists(desktopShortcutPath)
    ? {
        exists: true,
        bytes: (await stat(desktopShortcutPath)).size,
        sha256: await sha256File(desktopShortcutPath)
      }
    : { exists: false };
  return {
    shellSnapshot,
    registrations,
    installRegistry,
    protectedFiles,
    startMenuShortcut,
    desktopShortcut
  };
}

async function removeShortcutIfOwned(shortcutPath, installedExecutable) {
  if (!(await exists(shortcutPath))) {
    return false;
  }
  const shortcut = await inspectShortcut(shortcutPath);
  if (!pathsEqual(shortcut.target, installedExecutable)) {
    return false;
  }
  await rm(shortcutPath, { force: true });
  return true;
}

function requireInstallRegistryGuid(pkg) {
  const installRegistryGuid = String(pkg.build?.nsis?.guid || "").trim();
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      installRegistryGuid
    )
  ) {
    throw new SmokeError(
      "install_registry_guid_invalid",
      "The Windows installer identity is not configured safely."
    );
  }
  return installRegistryGuid;
}

async function releaseArtifacts(pkg) {
  const outputDir = pkg.build?.directories?.output || "dist";
  const productName = pkg.build?.productName || "Local Flow";
  requireInstallRegistryGuid(pkg);
  return {
    version: pkg.version,
    installer: await observedFile(
      path.join(projectRoot, outputDir, `${productName} Setup ${pkg.version}.exe`),
      `${outputDir}/${productName} Setup ${pkg.version}.exe`
    ),
    blockmap: await observedFile(
      path.join(projectRoot, outputDir, `${productName} Setup ${pkg.version}.exe.blockmap`),
      `${outputDir}/${productName} Setup ${pkg.version}.exe.blockmap`
    ),
    unpackedExecutable: await observedFile(
      path.join(projectRoot, outputDir, "win-unpacked", `${productName}.exe`),
      `${outputDir}/win-unpacked/${productName}.exe`
    )
  };
}

async function packagedResourcesMatch(unpackedRoot, installedRoot) {
  const relativeFiles = [
    "resources/app/package.json",
    "resources/app/src/main/index.js",
    "resources/app/src/renderer/app.js",
    "resources/app/scripts/whisper-runtime-manifest.json",
    "resources/vendor/whisper/bin/Release/whisper-cli.exe",
    "resources/vendor/whisper/models/ggml-base.bin",
    "resources/vendor/llm/bin/llama-cli.exe"
  ];
  for (const relativeFile of relativeFiles) {
    const unpackedPath = path.join(unpackedRoot, ...relativeFile.split("/"));
    const installedPath = path.join(installedRoot, ...relativeFile.split("/"));
    if (
      !(await exists(unpackedPath)) ||
      !(await exists(installedPath)) ||
      (await sha256File(unpackedPath)) !== (await sha256File(installedPath))
    ) {
      return false;
    }
  }
  return true;
}

async function runSmoke() {
  smokeStage = "read_package";
  const pkg = JSON.parse(
    await readFile(path.join(projectRoot, "package.json"), "utf8")
  );
  const productName = pkg.build?.productName || "Local Flow";
  const installRegistryGuid = requireInstallRegistryGuid(pkg);
  smokeStage = "release_artifacts";
  const release = await releaseArtifacts(pkg);
  const installerPath = path.join(
    projectRoot,
    ...release.installer.path.split("/")
  );
  const unpackedRoot = path.join(
    projectRoot,
    pkg.build?.directories?.output || "dist",
    "win-unpacked"
  );
  const installedExecutable = path.join(installRoot, `${productName}.exe`);
  const uninstallerPath = path.join(
    installRoot,
    `Uninstall ${productName}.exe`
  );
  smokeStage = "resolve_known_folders";
  const knownFolders = await queryWindowsKnownFolders();
  const desktop = knownFolders.desktop;
  const programs = knownFolders.programs;
  const startMenuShortcut = path.join(programs, `${productName}.lnk`);
  const desktopShortcut = path.join(desktop, `${productName}.lnk`);
  const isolatedEnvironment = process.env;
  const protectedRoot = process.env.LOCAL_FLOW_PROTECTED_INSTALL_ROOT || "";
  let shellBackup = null;
  let shellFoldersRestored = false;
  let preflightSafe = false;
  let installerAttempted = false;
  let launchedProcess = null;
  let primaryError = null;

  try {
    smokeStage = "prepare_temp";
    await rm(runRoot, { recursive: true, force: true });
    await mkdir(runRoot, { recursive: true });
    await Promise.all(
      [
        installRoot,
        userDataRoot
      ].map((directory) => mkdir(directory, { recursive: true }))
    );

    smokeStage = "preflight_registration";
    const registrationsBefore = await queryLocalFlowRegistrations();
    const currentUserRegistrationCountBefore = registrationsBefore.length;
    if (currentUserRegistrationCountBefore !== 0) {
      throw new SmokeError(
        "existing_registration_detected",
        "The isolated install check refused to run because this Windows account already has Local Flow registered."
      );
    }
    const installRegistryBefore = await queryInstallRegistry(
      installRegistryGuid
    );
    const currentUserInstallKeyExistedBefore = installRegistryBefore.exists;
    if (currentUserInstallKeyExistedBefore) {
      throw new SmokeError(
        "existing_install_key_detected",
        "The isolated install check refused to run because this Windows account already has a Local Flow installation."
      );
    }
    const startMenuShortcutExistedBefore = await exists(startMenuShortcut);
    const desktopShortcutExistedBefore = await exists(desktopShortcut);
    if (startMenuShortcutExistedBefore || desktopShortcutExistedBefore) {
      throw new SmokeError(
        "existing_shortcut_detected",
        "The isolated install check refused to replace an existing Local Flow shortcut."
      );
    }
    preflightSafe = true;

    smokeStage = "capture_shell_folders";
    shellBackup = await captureShellFolders();
    await writeFile(
      path.join(runRoot, "shell-folders-backup.json"),
      `${JSON.stringify(shellBackup, null, 2)}\n`,
      "utf8"
    );
    smokeStage = "capture_protected_state";
    const protectedStateBefore = await captureProtectedState(
      shellBackup,
      protectedRoot,
      startMenuShortcut,
      desktopShortcut,
      installRegistryGuid
    );
    const protectedStateSha256 = sha256Value(protectedStateBefore);
    smokeStage = "execution_context";
    const executionContextRole = await queryExecutionContextRole();

    smokeStage = "install";
    installerAttempted = true;
    const installerResult = await runProcess(
      installerPath,
      ["/S", "/currentuser", `/D=${installRoot}`],
      {
        env: isolatedEnvironment,
        timeoutMs: 300000
      }
    );
    if (installerResult.code !== 0) {
      throw new SmokeError(
        "installer_failed",
        "The Windows installer did not complete successfully."
      );
    }
    smokeStage = "verify_installed_files";
    await waitFor(
      async () =>
        (await exists(installedExecutable)) &&
        (await exists(uninstallerPath)) &&
        (await exists(startMenuShortcut)),
      60000,
      "installed_files_missing",
      "The installed application, uninstaller, or Start menu shortcut was not created."
    );

    const installedExecutableEvidence = await observedFile(
      installedExecutable,
      `<isolated-install-root>/${productName}.exe`
    );
    if (
      installedExecutableEvidence.sha256 !== release.unpackedExecutable.sha256 ||
      installedExecutableEvidence.bytes !== release.unpackedExecutable.bytes
    ) {
      throw new SmokeError(
        "installed_executable_mismatch",
        "The installed executable does not match the packaged release."
      );
    }
    const uninstallerEvidence = await observedFile(
      uninstallerPath,
      `<isolated-install-root>/Uninstall ${productName}.exe`
    );
    smokeStage = "verify_installed_resources";
    const resourcesMatch = await packagedResourcesMatch(
      unpackedRoot,
      installRoot
    );
    if (!resourcesMatch) {
      throw new SmokeError(
        "installed_resources_mismatch",
        "Installed application resources do not match the packaged release."
      );
    }

    smokeStage = "verify_shortcuts";
    const shortcut = await inspectShortcut(startMenuShortcut);
    if (!pathsEqual(shortcut.target, installedExecutable)) {
      throw new SmokeError(
        "shortcut_target_mismatch",
        "The isolated Start menu shortcut points to the wrong application."
      );
    }
    if (!(await exists(desktopShortcut))) {
      throw new SmokeError(
        "desktop_shortcut_missing",
        "The isolated desktop shortcut was not created."
      );
    }
    const desktopLink = await inspectShortcut(desktopShortcut);
    if (!pathsEqual(desktopLink.target, installedExecutable)) {
      throw new SmokeError(
        "desktop_shortcut_target_mismatch",
        "The isolated desktop shortcut points to the wrong application."
      );
    }
    const startMenuShortcutSha256 = await sha256File(startMenuShortcut);
    const desktopShortcutSha256 = await sha256File(desktopShortcut);

    smokeStage = "verify_install_registration";
    const registrationsAfterInstall = await queryLocalFlowRegistrations();
    if (registrationsAfterInstall.length !== 1) {
      throw new SmokeError(
        "registration_missing",
        "The isolated uninstall registration was not created exactly once."
      );
    }
    const registration = registrationsAfterInstall[0];
    const registrationMatchesRoot = registrationTargetsIsolatedRoot(
      registration,
      { installRoot, uninstallerPath }
    );
    if (!registrationMatchesRoot) {
      throw new SmokeError(
        "registration_target_mismatch",
        "The isolated uninstall registration points outside the test root."
      );
    }
    if (
      !registrationMatchesReleaseIdentity(registration, {
        productName,
        version: pkg.version
      })
    ) {
      throw new SmokeError(
        "registration_identity_mismatch",
        "The isolated uninstall registration does not match this release."
      );
    }
    const installRegistryAfterInstall = await queryInstallRegistry(
      installRegistryGuid
    );
    if (
      !installRegistryAfterInstall.exists ||
      !pathsEqual(installRegistryAfterInstall.installLocation, installRoot)
    ) {
      throw new SmokeError(
        "install_registry_target_mismatch",
        "The isolated installer registration points outside the test root."
      );
    }

    const userDataArgument = `--user-data-dir=${userDataRoot}`;
    smokeStage = "first_launch";
    launchedProcess = spawn(
      installedExecutable,
      [userDataArgument, "--hidden"],
      {
        cwd: installRoot,
        env: isolatedEnvironment,
        windowsHide: false,
        stdio: "ignore"
      }
    );
    await new Promise((resolve, reject) => {
      launchedProcess.once("spawn", resolve);
      launchedProcess.once("error", () =>
        reject(
          new SmokeError(
            "installed_launch_failed",
            "The installed application could not start."
          )
        )
      );
    });
    await waitFor(
      async () => isProcessAlive(launchedProcess.pid),
      30000,
      "installed_launch_not_ready",
      "The installed application did not reach a stable running state."
    );
    await delay(1500);
    const firstLaunchMainProcessCount = isProcessAlive(launchedProcess.pid)
      ? 1
      : 0;

    smokeStage = "second_launch";
    const secondLaunch = await runProcess(
      installedExecutable,
      [userDataArgument],
      {
        cwd: installRoot,
        env: isolatedEnvironment,
        timeoutMs: 15000,
        windowsHide: false
      }
    );
    await delay(1000);
    const mainProcessCountAfterSecondLaunch = isProcessAlive(
      launchedProcess.pid
    )
      ? 1
      : 0;
    if (
      secondLaunch.code !== 0 ||
      firstLaunchMainProcessCount !== 1 ||
      mainProcessCountAfterSecondLaunch !== 1
    ) {
      throw new SmokeError(
        "single_instance_failed",
        "The installed application did not preserve a single main instance."
      );
    }

    smokeStage = "stop_installed_app";
    await terminateProcessTree(launchedProcess.pid);
    await waitFor(
      async () => !isProcessAlive(launchedProcess.pid),
      30000,
      "installed_process_cleanup_failed",
      "The installed application did not stop cleanly."
    );
    launchedProcess = null;

    smokeStage = "uninstall";
    const uninstallResult = await runProcess(
      uninstallerPath,
      ["/S", "/currentuser"],
      {
        cwd: projectRoot,
        env: isolatedEnvironment,
        timeoutMs: 180000
      }
    );
    if (uninstallResult.code !== 0) {
      throw new SmokeError(
        "uninstaller_failed",
        "The isolated uninstaller did not complete successfully."
      );
    }

    await waitFor(
      async () =>
        !(await exists(installedExecutable)) &&
        !(await exists(startMenuShortcut)) &&
        !(await exists(desktopShortcut)) &&
        (await queryLocalFlowRegistrations()).length === 0 &&
        !(await queryInstallRegistry(installRegistryGuid)).exists,
      60000,
      "uninstall_cleanup_incomplete",
      "The isolated uninstall left application, shortcut, or registration residue."
    );
    const matchingProcessCount = launchedProcess?.pid &&
      isProcessAlive(launchedProcess.pid)
      ? 1
      : 0;

    smokeStage = "verify_shell_folders_unchanged";
    shellFoldersRestored = shellSnapshotsMatch(
      shellBackup,
      await captureShellFolders()
    );
    if (!shellFoldersRestored) {
      throw new SmokeError(
        "shell_folder_restore_failed",
        "Windows shell folders were not restored after the isolated install check."
      );
    }

    smokeStage = "verify_protected_state";
    const protectedStateAfter = await captureProtectedState(
      await captureShellFolders(),
      protectedRoot,
      startMenuShortcut,
      desktopShortcut,
      installRegistryGuid
    );
    const protectedStateAfterSha256 = sha256Value(protectedStateAfter);
    const protectedStateUnchanged =
      protectedStateAfterSha256 === protectedStateSha256;
    if (!protectedStateUnchanged) {
      throw new SmokeError(
        "protected_state_changed",
        "The isolated install check changed protected Windows state."
      );
    }

    smokeStage = "write_evidence";
    const manifest = {
      schemaVersion: 1,
      evidenceKind: "local-flow-windows-isolated-install",
      generatedAt: new Date().toISOString(),
      safety: {
        existingInstallMutation: "prohibited",
        currentUserRegistrationCountBefore,
        currentUserInstallKeyExistedBefore,
        installRootRole: "project_tmp",
        knownFolderMode: "clean_runner_profile_observed",
        knownFoldersObserved: true,
        shortcutsAbsentBefore:
          !startMenuShortcutExistedBefore &&
          !desktopShortcutExistedBefore,
        shellFoldersRestored
      },
      releaseArtifacts: release,
      lifecycle: {
        status: "passed",
        preflight: {
          status: "observed",
          executionContextRole,
          protectedStateSha256
        },
        installation: {
          status: "observed",
          installerExitCode: installerResult.code,
          executable: installedExecutableEvidence,
          uninstaller: uninstallerEvidence,
          startMenuShortcut: {
            status: "observed",
            path: `<clean-runner-profile>/Start Menu/Programs/${productName}.lnk`,
            targetRole: "isolated_install_executable",
            sha256: startMenuShortcutSha256
          },
          desktopShortcut: {
            status: "observed",
            path: `<clean-runner-profile>/Desktop/${productName}.lnk`,
            targetRole: "isolated_install_executable",
            sha256: desktopShortcutSha256
          },
          uninstallRegistration: {
            status: "observed",
            displayName: registration.displayName,
            displayVersion: registration.displayVersion,
            installLocationRole: "isolated_install_root",
            uninstallTargetRole: "isolated_install_uninstaller"
          },
          installRegistry: {
            status: "observed",
            installLocationRole: "isolated_install_root"
          },
          packagedResourcesMatchRelease: resourcesMatch
        },
        launch: {
          status: "observed",
          userDataRole: "isolated_test_profile",
          firstLaunchMainProcessCount,
          secondLaunchExitCode: secondLaunch.code,
          mainProcessCountAfterSecondLaunch
        },
        uninstall: {
          status: "observed",
          exitCode: uninstallResult.code,
          executableRemoved: !(await exists(installedExecutable)),
          shortcutRemoved:
            !(await exists(startMenuShortcut)) &&
            !(await exists(desktopShortcut)),
          registrationRemoved:
            (await queryLocalFlowRegistrations()).length === 0,
          installRegistryRemoved:
            !(await queryInstallRegistry(installRegistryGuid)).exists,
          matchingProcessCount
        },
        postflight: {
          status: "observed",
          protectedStateSha256: protectedStateAfterSha256,
          protectedStateUnchanged
        },
        productTextInsertion: {
          status: "manual_required",
          path: [
            "global_shortcut",
            "microphone",
            "whisper",
            "output_pipeline",
            "send_input",
            "notepad"
          ]
        }
      }
    };
    const schemaValidation = validateIsolatedInstallEvidence(manifest);
    const releaseValidation = validateEvidenceMatchesRelease(manifest, {
      version: release.version,
      artifacts: release
    });
    const errors = [
      ...schemaValidation.errors,
      ...releaseValidation.errors
    ];
    if (errors.length > 0) {
      throw new SmokeError(
        "evidence_invalid",
        "The isolated install evidence did not pass release validation."
      );
    }
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(
      evidencePath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
    print({
      ok: true,
      lifecycle: "passed",
      version: pkg.version,
      evidence: "docs/release/evidence/windows-isolated-install-v4.json",
      microphoneToNotepad: "manual_required"
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (launchedProcess?.pid) {
      await terminateProcessTree(launchedProcess.pid);
    }
    let cleanupError = null;
    if (
      preflightSafe &&
      installerAttempted &&
      (await exists(uninstallerPath))
    ) {
      try {
        await runProcess(
          uninstallerPath,
          ["/S", "/currentuser"],
          {
            cwd: projectRoot,
            env: isolatedEnvironment,
            timeoutMs: 120000
          }
        );
        await waitFor(
          async () => !(await exists(installedExecutable)),
          30000,
          "cleanup_uninstall_incomplete",
          "The isolated application cleanup did not complete."
        );
      } catch (error) {
        cleanupError = error;
      }
    }
    if (preflightSafe && installerAttempted) {
      try {
        await removeIsolatedRegistrations(installRegistryGuid);
      } catch (error) {
        cleanupError ||= error;
      }
      for (const shortcutPath of [startMenuShortcut, desktopShortcut]) {
        try {
          await removeShortcutIfOwned(shortcutPath, installedExecutable);
        } catch (error) {
          cleanupError ||= error;
        }
      }
    }
    try {
      await rmWithRetry(runRoot);
    } catch (error) {
      cleanupError ||= error;
    }
    if (cleanupError) {
      if (primaryError && typeof primaryError === "object") {
        primaryError.cleanupFailed = true;
      } else {
        throw cleanupError;
      }
    }
  }
}

try {
  await runSmoke();
} catch (error) {
  print({
    ok: false,
    stage: smokeStage,
    cleanup: error?.cleanupFailed ? "failed" : "completed",
    reason:
      error instanceof SmokeError
        ? error.code
        : "isolated_install_smoke_failed",
    message:
      error instanceof Error
        ? error.message
        : "The isolated install check failed."
  });
  process.exitCode = 1;
}
