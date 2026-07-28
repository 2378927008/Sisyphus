import path from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const EXECUTION_CONTEXT_ROLES = new Set([
  "interactive_user",
  "restricted_process",
  "unknown"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addError(errors, condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function validateObservedFile(errors, value, field, pathPrefix = "") {
  addError(errors, value?.status === "observed", `${field}.status must be observed`);
  addError(
    errors,
    typeof value?.path === "string" &&
      value.path.length > 0 &&
      (!pathPrefix || value.path.startsWith(pathPrefix)),
    `${field}.path is invalid`
  );
  addError(
    errors,
    SHA256_PATTERN.test(value?.sha256 || ""),
    `${field}.sha256 must be SHA-256`
  );
  addError(
    errors,
    Number.isSafeInteger(value?.bytes) && value.bytes > 0,
    `${field}.bytes must be positive`
  );
}

function validateNoMachineSpecificValues(errors, value, field = "manifest") {
  if (typeof value === "string") {
    if (/[a-z]:[\\/]/i.test(value) || /^[/\\]{2}[^/\\]/.test(value)) {
      errors.push(`${field} must not contain an absolute machine path`);
    }
    if (/\bS-\d-\d+(?:-\d+){1,}\b/i.test(value)) {
      errors.push(`${field} must not contain a Windows SID`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateNoMachineSpecificValues(errors, item, `${field}[${index}]`)
    );
    return;
  }
  if (!isObject(value)) {
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    validateNoMachineSpecificValues(errors, nestedValue, `${field}.${key}`);
  }
}

export function assertSafeIsolatedRoot(projectRoot, candidateRoot) {
  const temporaryRoot = path.resolve(projectRoot, ".tmp");
  const resolvedCandidate = path.resolve(candidateRoot);
  const relative = path.relative(temporaryRoot, resolvedCandidate);
  const isNested =
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative);

  if (!isNested) {
    throw new Error("Isolated install root must remain under the project .tmp directory.");
  }
  return resolvedCandidate;
}

export function registrationTargetsIsolatedRoot(
  registration,
  { installRoot, uninstallerPath } = {}
) {
  const normalize = (value) =>
    path.win32
      .normalize(String(value || "").replace(/^"(.*)"$/, "$1"))
      .replace(/[\\/]+$/, "")
      .toLowerCase();
  const normalizedInstallRoot = normalize(installRoot);
  const normalizedUninstaller = normalize(uninstallerPath);
  const normalizedLocation = normalize(registration?.installLocation);
  const normalizedCommand = String(registration?.uninstallString || "")
    .replaceAll('"', "")
    .toLowerCase();

  return Boolean(
    normalizedInstallRoot &&
      normalizedUninstaller &&
      (
        normalizedLocation === normalizedInstallRoot ||
        normalizedCommand.includes(normalizedUninstaller)
      )
  );
}

export function registrationMatchesReleaseIdentity(
  registration,
  { productName, version } = {}
) {
  return Boolean(
    String(productName || "") &&
      String(version || "") &&
      String(registration?.displayName || "") === String(productName) &&
      String(registration?.displayVersion || "") === String(version)
  );
}

export function validateIsolatedInstallEvidence(manifest) {
  const errors = [];
  addError(errors, isObject(manifest), "manifest must be an object");
  if (!isObject(manifest)) {
    return { ok: false, errors };
  }

  addError(errors, manifest.schemaVersion === 1, "schemaVersion must be 1");
  addError(
    errors,
    manifest.evidenceKind === "local-flow-windows-isolated-install",
    "evidenceKind is invalid"
  );
  addError(
    errors,
    ISO_DATE_PATTERN.test(manifest.generatedAt || ""),
    "generatedAt must be UTC ISO-8601"
  );

  const safety = manifest.safety;
  addError(
    errors,
    safety?.existingInstallMutation === "prohibited",
    "existingInstallMutation must be prohibited"
  );
  addError(
    errors,
    safety?.currentUserRegistrationCountBefore === 0,
    "currentUserRegistrationCountBefore must be zero"
  );
  addError(
    errors,
    safety?.currentUserInstallKeyExistedBefore === false,
    "currentUserInstallKeyExistedBefore must be false"
  );
  addError(
    errors,
    safety?.installRootRole === "project_tmp",
    "installRootRole must be project_tmp"
  );
  addError(
    errors,
    safety?.knownFolderMode === "clean_runner_profile_observed",
    "knownFolderMode must be clean_runner_profile_observed"
  );
  addError(
    errors,
    safety?.knownFoldersObserved === true,
    "knownFoldersObserved must be true"
  );
  addError(
    errors,
    safety?.shortcutsAbsentBefore === true,
    "shortcutsAbsentBefore must be true"
  );
  addError(
    errors,
    safety?.shellFoldersRestored === true,
    "shellFoldersRestored must be true"
  );

  const release = manifest.releaseArtifacts;
  addError(
    errors,
    /^\d+\.\d+\.\d+$/.test(release?.version || ""),
    "releaseArtifacts.version is invalid"
  );
  validateObservedFile(errors, release?.installer, "releaseArtifacts.installer");
  validateObservedFile(errors, release?.blockmap, "releaseArtifacts.blockmap");
  validateObservedFile(
    errors,
    release?.unpackedExecutable,
    "releaseArtifacts.unpackedExecutable"
  );

  const lifecycle = manifest.lifecycle;
  addError(errors, lifecycle?.status === "passed", "lifecycle.status must be passed");

  const preflight = lifecycle?.preflight;
  addError(errors, preflight?.status === "observed", "lifecycle.preflight.status must be observed");
  addError(
    errors,
    EXECUTION_CONTEXT_ROLES.has(preflight?.executionContextRole),
    "lifecycle.preflight.executionContextRole is invalid"
  );
  addError(
    errors,
    SHA256_PATTERN.test(preflight?.protectedStateSha256 || ""),
    "lifecycle.preflight.protectedStateSha256 must be SHA-256"
  );

  const installation = lifecycle?.installation;
  addError(
    errors,
    installation?.status === "observed",
    "lifecycle.installation.status must be observed"
  );
  addError(
    errors,
    installation?.installerExitCode === 0,
    "lifecycle.installation.installerExitCode must be zero"
  );
  validateObservedFile(
    errors,
    installation?.executable,
    "lifecycle.installation.executable",
    "<isolated-install-root>/"
  );
  validateObservedFile(
    errors,
    installation?.uninstaller,
    "lifecycle.installation.uninstaller",
    "<isolated-install-root>/"
  );
  const shortcut = installation?.startMenuShortcut;
  addError(
    errors,
    shortcut?.status === "observed",
    "lifecycle.installation.startMenuShortcut.status must be observed"
  );
  addError(
    errors,
    shortcut?.path?.startsWith("<clean-runner-profile>/"),
    "lifecycle.installation.startMenuShortcut.path is invalid"
  );
  addError(
    errors,
    shortcut?.targetRole === "isolated_install_executable",
    "lifecycle.installation.startMenuShortcut.targetRole is invalid"
  );
  addError(
    errors,
    SHA256_PATTERN.test(shortcut?.sha256 || ""),
    "lifecycle.installation.startMenuShortcut.sha256 must be SHA-256"
  );
  const desktopShortcut = installation?.desktopShortcut;
  addError(
    errors,
    desktopShortcut?.status === "observed",
    "lifecycle.installation.desktopShortcut.status must be observed"
  );
  addError(
    errors,
    desktopShortcut?.path?.startsWith("<clean-runner-profile>/"),
    "lifecycle.installation.desktopShortcut.path is invalid"
  );
  addError(
    errors,
    desktopShortcut?.targetRole === "isolated_install_executable",
    "lifecycle.installation.desktopShortcut.targetRole is invalid"
  );
  addError(
    errors,
    SHA256_PATTERN.test(desktopShortcut?.sha256 || ""),
    "lifecycle.installation.desktopShortcut.sha256 must be SHA-256"
  );
  const registration = installation?.uninstallRegistration;
  addError(
    errors,
    registration?.status === "observed",
    "lifecycle.installation.uninstallRegistration.status must be observed"
  );
  addError(
    errors,
    registration?.displayName === "Local Flow",
    "lifecycle.installation.uninstallRegistration.displayName is invalid"
  );
  addError(
    errors,
    registration?.displayVersion === release?.version,
    "lifecycle.installation.uninstallRegistration.displayVersion is invalid"
  );
  addError(
    errors,
    registration?.installLocationRole === "isolated_install_root",
    "lifecycle.installation.uninstallRegistration.installLocationRole is invalid"
  );
  addError(
    errors,
    registration?.uninstallTargetRole === "isolated_install_uninstaller",
    "lifecycle.installation.uninstallRegistration.uninstallTargetRole is invalid"
  );
  const installRegistry = installation?.installRegistry;
  addError(
    errors,
    installRegistry?.status === "observed",
    "lifecycle.installation.installRegistry.status must be observed"
  );
  addError(
    errors,
    installRegistry?.installLocationRole === "isolated_install_root",
    "lifecycle.installation.installRegistry.installLocationRole is invalid"
  );
  addError(
    errors,
    installation?.packagedResourcesMatchRelease === true,
    "lifecycle.installation.packagedResourcesMatchRelease must be true"
  );

  const launch = lifecycle?.launch;
  addError(errors, launch?.status === "observed", "lifecycle.launch.status must be observed");
  addError(
    errors,
    launch?.userDataRole === "isolated_test_profile",
    "lifecycle.launch.userDataRole is invalid"
  );
  addError(
    errors,
    launch?.firstLaunchMainProcessCount === 1,
    "lifecycle.launch.firstLaunchMainProcessCount must be one"
  );
  addError(
    errors,
    launch?.secondLaunchExitCode === 0,
    "lifecycle.launch.secondLaunchExitCode must be zero"
  );
  addError(
    errors,
    launch?.mainProcessCountAfterSecondLaunch === 1,
    "lifecycle.launch.mainProcessCountAfterSecondLaunch must be one"
  );

  const uninstall = lifecycle?.uninstall;
  addError(
    errors,
    uninstall?.status === "observed",
    "lifecycle.uninstall.status must be observed"
  );
  addError(
    errors,
    uninstall?.exitCode === 0,
    "lifecycle.uninstall.exitCode must be zero"
  );
  for (const field of [
    "executableRemoved",
    "shortcutRemoved",
    "registrationRemoved",
    "installRegistryRemoved"
  ]) {
    addError(
      errors,
      uninstall?.[field] === true,
      `lifecycle.uninstall.${field} must be true`
    );
  }
  addError(
    errors,
    uninstall?.matchingProcessCount === 0,
    "lifecycle.uninstall.matchingProcessCount must be zero"
  );

  const postflight = lifecycle?.postflight;
  addError(
    errors,
    postflight?.status === "observed",
    "lifecycle.postflight.status must be observed"
  );
  addError(
    errors,
    SHA256_PATTERN.test(postflight?.protectedStateSha256 || ""),
    "lifecycle.postflight.protectedStateSha256 must be SHA-256"
  );
  addError(
    errors,
    postflight?.protectedStateSha256 === preflight?.protectedStateSha256,
    "lifecycle.postflight protected state must match preflight"
  );
  addError(
    errors,
    postflight?.protectedStateUnchanged === true,
    "lifecycle.postflight.protectedStateUnchanged must be true"
  );

  const insertion = lifecycle?.productTextInsertion;
  addError(
    errors,
    insertion?.status === "manual_required",
    "lifecycle.productTextInsertion.status must be manual_required"
  );
  const expectedInsertionPath = [
    "global_shortcut",
    "microphone",
    "whisper",
    "output_pipeline",
    "send_input",
    "notepad"
  ];
  addError(
    errors,
    Array.isArray(insertion?.path) &&
      expectedInsertionPath.every(
        (step, index) => insertion.path[index] === step
      ) &&
      insertion.path.length === expectedInsertionPath.length,
    "lifecycle.productTextInsertion.path is invalid"
  );

  validateNoMachineSpecificValues(errors, manifest);
  return {
    ok: errors.length === 0,
    errors
  };
}
