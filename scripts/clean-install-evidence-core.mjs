const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const EVIDENCE_STATUSES = new Set([
  "observed",
  "not_run",
  "manual_required",
  "unsupported"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addError(errors, condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function validateStatus(errors, value, field) {
  addError(
    errors,
    isObject(value) && EVIDENCE_STATUSES.has(value.status),
    `${field}.status must be an explicit evidence status`
  );
}

function validateObservedFile(errors, value, field) {
  validateStatus(errors, value, field);
  if (value?.status !== "observed") {
    return;
  }
  addError(errors, typeof value.path === "string" && value.path.length > 0, `${field}.path is required`);
  addError(errors, SHA256_PATTERN.test(value.sha256 || ""), `${field}.sha256 must be SHA-256`);
  addError(errors, Number.isSafeInteger(value.bytes) && value.bytes > 0, `${field}.bytes must be positive`);
}

function validateSnapshotPair(errors, pair, field, requiredStatus) {
  addError(errors, isObject(pair?.before), `${field}.before is required`);
  addError(errors, isObject(pair?.after), `${field}.after is required`);
  for (const edge of ["before", "after"]) {
    validateStatus(errors, pair?.[edge], `${field}.${edge}`);
    if (requiredStatus) {
      addError(
        errors,
        pair?.[edge]?.status === requiredStatus,
        `${field}.${edge}.status must be ${requiredStatus}`
      );
    }
  }
}

function validateNoSensitiveMachineData(errors, manifest) {
  const serialized = JSON.stringify(manifest);
  addError(errors, !/S-1-5-21-\d+/i.test(serialized), "manifest must not contain a Windows user SID");
  addError(errors, !/[a-z]:[\\/]/i.test(serialized), "manifest must not contain absolute drive paths");
  addError(errors, !/\\\\Users\\\\[^%<]/i.test(serialized), "manifest must not contain an absolute user profile");
  addError(errors, !/"(?:userName|userSid|commandLine)"\s*:/i.test(serialized), "manifest must not contain user or command-line fields");
}

function validateCurrentState(errors, currentState) {
  validateStatus(errors, currentState, "currentState");
  addError(errors, currentState?.status === "observed", "currentState.status must be observed");

  const existing = currentState?.existingInstallation;
  validateStatus(errors, existing, "currentState.existingInstallation");
  if (existing?.status === "observed") {
    addError(errors, existing.role === "existing_user_install", "existing installation role is invalid");
    addError(errors, existing.root === "<existing-install-root>", "existing installation root must be normalized");
    validateObservedFile(errors, existing.executable, "currentState.existingInstallation.executable");
    validateObservedFile(errors, existing.uninstaller, "currentState.existingInstallation.uninstaller");
  }

  const shortcut = currentState?.startMenuShortcut;
  validateStatus(errors, shortcut, "currentState.startMenuShortcut");
  if (shortcut?.status === "observed") {
    addError(errors, shortcut.path?.startsWith("%APPDATA%/"), "start-menu shortcut path must be normalized");
    if (shortcut.exists !== false) {
      const hasObservedInstall = existing?.status === "observed";
      addError(
        errors,
        hasObservedInstall
          ? shortcut.target?.startsWith("<existing-install-root>/")
          : shortcut.target === "<redacted-machine-path>",
        "shortcut target must be normalized"
      );
      addError(
        errors,
        hasObservedInstall
          ? shortcut.workingDirectory === "<existing-install-root>"
          : shortcut.workingDirectory === "<redacted-machine-path>",
        "shortcut working directory must be normalized"
      );
      addError(errors, SHA256_PATTERN.test(shortcut.sha256 || ""), "shortcut sha256 must be present");
    }
  }

  const desktopShortcut = currentState?.desktopShortcut;
  validateStatus(errors, desktopShortcut, "currentState.desktopShortcut");
  if (desktopShortcut?.status === "observed") {
    addError(errors, desktopShortcut.path?.startsWith("%USERPROFILE%/"), "desktop shortcut path must be normalized");
    addError(errors, typeof desktopShortcut.exists === "boolean", "desktop shortcut existence must be recorded");
  }

  const registration = currentState?.uninstallRegistration;
  validateStatus(errors, registration, "currentState.uninstallRegistration");
  if (registration?.status === "observed") {
    const requiredRoles = new Set([
      "current_user",
      "local_machine_64",
      "local_machine_32",
      "loaded_users"
    ]);
    for (const scope of registration.scopes || []) {
      requiredRoles.delete(scope.role);
      addError(errors, scope.status === "observed", `registry scope ${scope.role || "unknown"} was not observed`);
      addError(errors, Number.isSafeInteger(scope.matchingEntryCount), `registry scope ${scope.role || "unknown"} count is invalid`);
    }
    addError(errors, requiredRoles.size === 0, "all standard uninstall registry roles must be represented");
    addError(errors, Array.isArray(registration.matchingEntries), "uninstall matchingEntries must be an array");
    if (registration?.matchingEntries?.length === 0) {
      addError(errors, registration.conclusion === "absent", "empty uninstall entries must conclude absent");
    } else {
      addError(errors, registration.conclusion === "present", "non-empty uninstall entries must conclude present");
    }
  }

  const processes = currentState?.scopedProcesses;
  validateStatus(errors, processes, "currentState.scopedProcesses");
  if (processes?.status === "observed") {
    addError(errors, Array.isArray(processes.processNames) && processes.processNames.length > 0, "process scope must name processes");
    addError(errors, Number.isSafeInteger(processes.matchingProcessCount), "process match count is invalid");
  }

  const temporary = currentState?.temporaryTestArtifacts;
  validateStatus(errors, temporary, "currentState.temporaryTestArtifacts");
  if (temporary?.status === "observed") {
    addError(errors, temporary.scope === ".tmp/clean-install*", "temporary evidence scope is invalid");
    addError(errors, Number.isSafeInteger(temporary.matchingEntryCount), "temporary evidence count is invalid");
  }
}

function validateCleanInstallTrial(errors, trial) {
  addError(
    errors,
    ["not_run", "passed", "failed"].includes(trial?.status),
    "cleanInstallTrial.status must be not_run, passed, or failed"
  );
  validateStatus(errors, trial?.isolatedInstallRoot, "cleanInstallTrial.isolatedInstallRoot");
  validateSnapshotPair(errors, trial?.sentinel, "cleanInstallTrial.sentinel");
  validateSnapshotPair(errors, trial?.shortcuts, "cleanInstallTrial.shortcuts");
  validateSnapshotPair(
    errors,
    trial?.uninstallRegistration,
    "cleanInstallTrial.uninstallRegistration"
  );
  validateStatus(errors, trial?.processScope, "cleanInstallTrial.processScope");
  validateStatus(errors, trial?.productTextInsertion, "cleanInstallTrial.productTextInsertion");

  const insertionPath = trial?.productTextInsertion?.path;
  addError(
    errors,
    Array.isArray(insertionPath) &&
      ["global_shortcut", "microphone", "whisper", "output_pipeline", "send_input", "notepad"]
        .every((step, index) => insertionPath[index] === step),
    "product text insertion path must be reproducible"
  );

  if (trial?.status === "not_run") {
    addError(
      errors,
      trial.isolatedInstallRoot?.status === "manual_required",
      "not-run trial must mark isolated install root manual_required"
    );
    validateSnapshotPair(errors, trial.sentinel, "cleanInstallTrial.sentinel", "not_run");
    validateSnapshotPair(errors, trial.shortcuts, "cleanInstallTrial.shortcuts", "not_run");
    validateSnapshotPair(
      errors,
      trial.uninstallRegistration,
      "cleanInstallTrial.uninstallRegistration",
      "not_run"
    );
    addError(errors, trial.processScope?.status === "not_run", "not-run trial process scope must be not_run");
    addError(
      errors,
      trial.productTextInsertion?.status === "manual_required",
      "not-run trial text insertion must be manual_required"
    );
  }

  if (trial?.status === "passed") {
    const proofStatuses = [
      trial.isolatedInstallRoot?.status,
      trial.sentinel?.before?.status,
      trial.sentinel?.after?.status,
      trial.shortcuts?.before?.status,
      trial.shortcuts?.after?.status,
      trial.uninstallRegistration?.before?.status,
      trial.uninstallRegistration?.after?.status,
      trial.processScope?.status,
      trial.productTextInsertion?.status
    ];
    addError(
      errors,
      proofStatuses.every((status) => status === "observed"),
      "cleanInstallTrial.status passed requires observed proof for every trial field"
    );
  }
}

export function validateCleanInstallEvidence(manifest) {
  const errors = [];
  addError(errors, isObject(manifest), "manifest must be an object");
  if (!isObject(manifest)) {
    return { ok: false, errors };
  }

  addError(errors, manifest.schemaVersion === 1, "schemaVersion must be 1");
  addError(
    errors,
    manifest.evidenceKind === "local-flow-windows-clean-install",
    "evidenceKind is invalid"
  );
  addError(errors, ISO_DATE_PATTERN.test(manifest.generatedAt || ""), "generatedAt must be UTC ISO-8601");
  addError(
    errors,
    manifest.readinessScope === "read-only-current-state-and-manual-clean-install-plan",
    "readinessScope is invalid"
  );
  addError(
    errors,
    manifest.safety?.existingInstallMutation === "prohibited",
    "existing install mutation must be prohibited"
  );
  addError(errors, manifest.safety?.installerRun === false, "installerRun must be false");
  addError(errors, manifest.safety?.uninstallerRun === false, "uninstallerRun must be false");

  validateStatus(errors, manifest.releaseArtifacts, "releaseArtifacts");
  addError(errors, manifest.releaseArtifacts?.status === "observed", "release artifacts must be observed");
  addError(errors, /^\d+\.\d+\.\d+$/.test(manifest.releaseArtifacts?.version || ""), "release version is invalid");
  validateObservedFile(errors, manifest.releaseArtifacts?.installer, "releaseArtifacts.installer");
  validateObservedFile(errors, manifest.releaseArtifacts?.blockmap, "releaseArtifacts.blockmap");
  validateObservedFile(
    errors,
    manifest.releaseArtifacts?.unpackedExecutable,
    "releaseArtifacts.unpackedExecutable"
  );

  validateCurrentState(errors, manifest.currentState);
  validateCleanInstallTrial(errors, manifest.cleanInstallTrial);
  validateNoSensitiveMachineData(errors, manifest);

  return {
    ok: errors.length === 0,
    errors
  };
}
