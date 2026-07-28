const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const EVIDENCE_STATUSES = new Set([
  "observed",
  "partial",
  "not_run",
  "manual_required",
  "unsupported"
]);
const REGISTRY_SCOPE_ROLES = [
  "collector_current_user",
  "local_machine_64",
  "local_machine_32",
  "loaded_user_profiles"
];
const EXECUTION_CONTEXT_ROLES = new Set([
  "interactive_user",
  "restricted_process",
  "unknown"
]);
const INSTALL_LOCATION_ROLES = new Set([
  "none",
  "existing_install_root",
  "isolated_install_root",
  "redacted_other_location"
]);
const UNINSTALL_TARGET_ROLES = new Set([
  "none",
  "existing_install_uninstaller",
  "isolated_install_uninstaller",
  "redacted_other_target"
]);
const ALLOWED_ROLE_PLACEHOLDERS = new Set([
  "%appdata%",
  "%userprofile%",
  "<existing-install-root>",
  "<isolated-install-root>",
  "<isolated-test-profile>",
  "<project-root>",
  "<redacted-machine-path>",
  "<redacted-user>",
  "<redacted-sid>",
  "<redacted-command-line>",
  "<redacted-sensitive-value>"
]);
const COMMAND_FIELD_KEYS = new Set([
  "command",
  "commandline",
  "args",
  "arguments",
  "argv",
  "shellcommand"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addError(errors, condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function replaceInsensitive(value, search, replacement) {
  if (typeof search !== "string" || search.length < 3) {
    return value;
  }
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), replacement);
}

function replaceTokenInsensitive(value, search, replacement) {
  if (typeof search !== "string" || search.length < 3) {
    return value;
  }
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(
    new RegExp(`(^|[^a-z0-9_.@-])${escaped}(?=$|[^a-z0-9_.@-])`, "gi"),
    `$1${replacement}`
  );
}

function replaceAngleTokenInsensitive(value, search, replacement) {
  if (typeof search !== "string" || search.length < 3) {
    return value;
  }
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(
    new RegExp(`<\\s*${escaped}\\s*>`, "gi"),
    replacement
  );
}

function protectRolePlaceholders(value) {
  const placeholders = [];
  const protectedValue = value.replace(
    /%[a-z0-9_-]+%|<[a-z0-9][a-z0-9_-]*>/gi,
    (placeholder) => {
      if (!ALLOWED_ROLE_PLACEHOLDERS.has(placeholder.toLowerCase())) {
        return placeholder;
      }
      const index = placeholders.push(placeholder) - 1;
      return `\u0000${index}\u0000`;
    }
  );
  return {
    value: protectedValue,
    restore(protectedText) {
      return protectedText.replace(
        /\u0000(\d+)\u0000/g,
        (_, index) => placeholders[Number(index)] || ""
      );
    }
  };
}

function defaultSensitiveTokens(options = {}) {
  return [
    ...(Array.isArray(options.sensitiveTokens) ? options.sensitiveTokens : []),
    process.env.USERNAME,
    process.env.USERPROFILE,
    process.env.APPDATA
  ].filter(
    (token) =>
      typeof token === "string" &&
      token.length >= 3 &&
      !/^%[^%]+%$/.test(token) &&
      !/^<[^>]+>$/.test(token)
  );
}

function isCommandField(key) {
  return (
    typeof key === "string" &&
    COMMAND_FIELD_KEYS.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase())
  );
}

function hasExplicitCommandGrammar(value) {
  const trimmed = value.trim();
  return (
    /^(?:"[^"\r\n]+\.(?:exe|cmd|bat|ps1)"|[^\s"'`]+\.(?:exe|cmd|bat|ps1))\s+\S+(?:\s+[^\r\n]+)*$/i.test(
      trimmed
    ) ||
    /^git\s+status(?:\s+[^\r\n]+)*$/i.test(trimmed) ||
    /^whoami\s+\/user(?:\s+[^\r\n]+)*$/i.test(trimmed)
  );
}

function containsCommandLine(value, context = {}) {
  if (value === "<redacted-command-line>") {
    return false;
  }
  return (
    (context.commandBearing === true && value.trim().length > 0) ||
    hasExplicitCommandGrammar(value)
  );
}

function containsUncPath(value) {
  return /\\\\[^\\\s]+\\[^\s]+/i.test(value);
}

function privacyViolations(value, sensitiveTokens, context = {}) {
  const protectedValue = protectRolePlaceholders(value).value;
  const violations = [];
  if (/[a-z]:[\\/]/i.test(protectedValue)) {
    violations.push("absolute drive path");
  }
  if (containsUncPath(protectedValue)) {
    violations.push("UNC path");
  }
  if (/(?:^|[\\/])Users[\\/][^%<\\/]+/i.test(protectedValue)) {
    violations.push("user profile path");
  }
  if (/\bS-\d-\d+(?:-\d+){1,}\b/i.test(protectedValue)) {
    violations.push("Windows SID");
  }
  if (
    /\b(?:for\s+user|user(?:name)?\s*[:=])\s*[a-z0-9_.@-]+/i.test(
      protectedValue
    )
  ) {
    violations.push("user identity");
  }
  if (containsCommandLine(value, context)) {
    violations.push("command line");
  }
  if (
    sensitiveTokens.some((token) => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `(^|[^a-z0-9_.@-])${escaped}(?=$|[^a-z0-9_.@-])`,
        "i"
      ).test(protectedValue);
    })
  ) {
    violations.push("configured sensitive token");
  }
  return violations;
}

function redactEvidenceNode(value, options, context) {
  if (Array.isArray(value)) {
    return value.map((item) => redactEvidenceNode(item, options, context));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => {
        const nestedContext = {
          commandBearing: context.commandBearing || isCommandField(key)
        };
        return [
          redactEvidenceNode(key, options, { commandBearing: false }),
          redactEvidenceNode(nestedValue, options, nestedContext)
        ];
      })
    );
  }
  if (typeof value !== "string") {
    return value;
  }

  let redacted = value;
  const replacements = [
    ...(Array.isArray(options.replacements) ? options.replacements : []),
    { value: process.env.APPDATA, replacement: "%APPDATA%" },
    { value: process.env.USERPROFILE, replacement: "%USERPROFILE%" }
  ];
  for (const replacement of replacements) {
    redacted = replaceInsensitive(
      redacted,
      replacement?.value,
      replacement?.replacement || "<redacted-sensitive-value>"
    );
  }

  const protectedValue = protectRolePlaceholders(redacted);
  redacted = protectedValue.value;
  for (const token of defaultSensitiveTokens(options)) {
    redacted = replaceAngleTokenInsensitive(redacted, token, "<redacted-user>");
    redacted = replaceTokenInsensitive(redacted, token, "<redacted-user>");
  }
  redacted = redacted.replace(
    /\b((?:for\s+user|user(?:name)?\s*[:=])\s*)[a-z0-9_.@-]+/gi,
    "$1<redacted-user>"
  );
  redacted = redacted.replace(
    /\bS-\d-\d+(?:-\d+){1,}\b/gi,
    "<redacted-sid>"
  );

  if (containsCommandLine(redacted, context)) {
    return "<redacted-command-line>";
  }
  if (
    /[a-z]:[\\/]/i.test(redacted) ||
    containsUncPath(redacted) ||
    /(?:^|[\\/])Users[\\/][^%<\\/]+/i.test(redacted)
  ) {
    return "<redacted-machine-path>";
  }
  return protectedValue.restore(redacted);
}

export function redactEvidenceValue(value, options = {}) {
  return redactEvidenceNode(value, options, { commandBearing: false });
}

export function buildUninstallRegistrationEvidence({
  executionContextRole,
  scopeResults
}) {
  const contextRole = EXECUTION_CONTEXT_ROLES.has(executionContextRole)
    ? executionContextRole
    : "unknown";
  const resultsByRole = new Map(
    (Array.isArray(scopeResults) ? scopeResults : [])
      .filter((scope) => REGISTRY_SCOPE_ROLES.includes(scope?.role))
      .map((scope) => [scope.role, scope])
  );
  const scopes = [];
  const matchingEntries = [];

  for (const role of REGISTRY_SCOPE_ROLES) {
    const result = resultsByRole.get(role);
    const accessConfirmed = result?.access === "success";
    const representsInteractiveUser =
      contextRole === "interactive_user" ||
      !["collector_current_user", "loaded_user_profiles"].includes(role);
    const contextConfirmed = contextRole !== "unknown";
    const observed =
      Boolean(result) &&
      accessConfirmed &&
      contextConfirmed &&
      representsInteractiveUser;

    if (observed) {
      const entries = Array.isArray(result.matchingEntries)
        ? result.matchingEntries
        : [];
      scopes.push({
        role,
        status: "observed",
        collectionContextRole: contextRole,
        matchingEntryCount: entries.length
      });
      matchingEntries.push(...entries.map((entry) => ({ ...entry, role })));
      continue;
    }

    let reason = result?.reason;
    if (!reason && !contextConfirmed) {
      reason = "execution context could not be confirmed";
    } else if (!reason && !representsInteractiveUser) {
      reason = "scope does not represent the interactive user";
    } else if (!reason && !accessConfirmed) {
      reason = "registry scope access was not confirmed";
    }
    scopes.push({
      role,
      status: "unsupported",
      collectionContextRole: contextRole,
      reason
    });
  }

  const observedCount = scopes.filter(({ status }) => status === "observed").length;
  const status =
    observedCount === scopes.length
      ? "observed"
      : observedCount > 0
        ? "partial"
        : "unsupported";
  const conclusion =
    matchingEntries.length > 0
      ? "present"
      : status === "observed" && contextRole === "interactive_user"
        ? "absent"
        : "unknown";

  return {
    status,
    executionContextRole: contextRole,
    scopes,
    matchingEntries,
    conclusion
  };
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

function isNormalizedRolePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[a-z]:[\\/]/i.test(value) &&
    !/^[/\\]{2}[^/\\]/.test(value)
  );
}

function validatePassedRegistrySnapshot(errors, snapshot, field) {
  addError(errors, snapshot?.status === "observed", `${field}.status must be observed`);
  addError(
    errors,
    snapshot?.executionContextRole === "interactive_user",
    `${field}.executionContextRole must be interactive_user`
  );
  addError(errors, Array.isArray(snapshot?.scopes), `${field}.scopes must be an array`);
  addError(
    errors,
    Array.isArray(snapshot?.matchingEntries),
    `${field}.matchingEntries must be an array`
  );

  const roleOccurrences = new Map(
    REGISTRY_SCOPE_ROLES.map((role) => [role, 0])
  );
  const matchingEntriesByRole = new Map(
    REGISTRY_SCOPE_ROLES.map((role) => [role, 0])
  );
  for (const [index, entry] of (snapshot?.matchingEntries || []).entries()) {
    const entryField = `${field}.matchingEntries[${index}]`;
    addError(errors, isObject(entry), `${entryField} must be an object`);
    if (!isObject(entry)) {
      continue;
    }
    addError(
      errors,
      REGISTRY_SCOPE_ROLES.includes(entry.role),
      `${entryField}.role must be a standard registry role`
    );
    addError(
      errors,
      typeof entry.displayName === "string" &&
        entry.displayName.trim().length > 0 &&
        entry.displayName.length <= 256,
      `${entryField}.displayName is invalid`
    );
    addError(
      errors,
      typeof entry.displayVersion === "string" &&
        entry.displayVersion.length <= 128,
      `${entryField}.displayVersion is invalid`
    );
    addError(
      errors,
      INSTALL_LOCATION_ROLES.has(entry.installLocationRole),
      `${entryField}.installLocationRole is invalid`
    );
    addError(
      errors,
      UNINSTALL_TARGET_ROLES.has(entry.uninstallTargetRole),
      `${entryField}.uninstallTargetRole is invalid`
    );
    if (matchingEntriesByRole.has(entry.role)) {
      matchingEntriesByRole.set(
        entry.role,
        matchingEntriesByRole.get(entry.role) + 1
      );
    }
  }

  for (const scope of snapshot?.scopes || []) {
    const role = scope?.role;
    if (roleOccurrences.has(role)) {
      roleOccurrences.set(role, roleOccurrences.get(role) + 1);
    }
    addError(
      errors,
      REGISTRY_SCOPE_ROLES.includes(role),
      `${field}.scopes ${role || "unknown"} role is invalid`
    );
    addError(
      errors,
      scope?.status === "observed",
      `${field}.scopes ${role || "unknown"} must be observed`
    );
    addError(
      errors,
      scope?.collectionContextRole === "interactive_user",
      `${field}.scopes ${role || "unknown"} context must be interactive_user`
    );
    addError(
      errors,
      Number.isSafeInteger(scope?.matchingEntryCount) &&
        scope.matchingEntryCount >= 0,
      `${field}.scopes ${role || "unknown"} matchingEntryCount is invalid`
    );
    if (matchingEntriesByRole.has(role)) {
      addError(
        errors,
        scope?.matchingEntryCount === matchingEntriesByRole.get(role),
        `${field}.scopes ${role} matchingEntryCount does not match retained entries`
      );
    }
  }
  for (const role of REGISTRY_SCOPE_ROLES) {
    addError(
      errors,
      roleOccurrences.get(role) === 1,
      `${field}.scopes role ${role} must appear exactly once`
    );
  }
  addError(
    errors,
    [...roleOccurrences.values()].every((count) => count > 0),
    `${field}.scopes must include all standard registry roles`
  );
  const expectedConclusion =
    (snapshot?.matchingEntries || []).length > 0 ? "present" : "absent";
  addError(
    errors,
    snapshot?.conclusion === expectedConclusion,
    `${field}.conclusion does not match retained entries`
  );
}

function validateNoSensitiveMachineData(errors, manifest, options) {
  const sensitiveTokens = defaultSensitiveTokens(options);

  function visit(value, field, context = { commandBearing: false }) {
    if (typeof value === "string") {
      const violations = privacyViolations(value, sensitiveTokens, context);
      for (const violation of violations) {
        errors.push(`${field} must not contain ${violation}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visit(item, `${field}[${index}]`, context)
      );
      return;
    }
    if (!isObject(value)) {
      return;
    }
    for (const [key, nestedValue] of Object.entries(value)) {
      for (const violation of privacyViolations(
        key,
        sensitiveTokens,
        { commandBearing: false }
      )) {
        errors.push(`${field} key must not contain ${violation}`);
      }
      if (/^(?:userName|userSid)$/i.test(key)) {
        errors.push(`${field}.${key} is a prohibited sensitive field`);
      }
      visit(
        nestedValue,
        `${field}.${key}`,
        { commandBearing: context.commandBearing || isCommandField(key) }
      );
    }
  }

  visit(manifest, "manifest");
}

function validateCurrentState(errors, currentState) {
  validateStatus(errors, currentState, "currentState");
  addError(
    errors,
    ["observed", "partial"].includes(currentState?.status),
    "currentState.status must be observed or partial"
  );
  addError(
    errors,
    EXECUTION_CONTEXT_ROLES.has(currentState?.executionContextRole),
    "currentState.executionContextRole is invalid"
  );

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
  addError(
    errors,
    EXECUTION_CONTEXT_ROLES.has(registration?.executionContextRole),
    "uninstall registration executionContextRole is invalid"
  );
  addError(
    errors,
    registration?.executionContextRole === currentState?.executionContextRole,
    "uninstall registration context must match currentState"
  );
  addError(errors, Array.isArray(registration?.scopes), "uninstall scopes must be an array");
  addError(
    errors,
    Array.isArray(registration?.matchingEntries),
    "uninstall matchingEntries must be an array"
  );

  const requiredRoles = new Set(REGISTRY_SCOPE_ROLES);
  let observedScopeCount = 0;
  for (const scope of registration?.scopes || []) {
    requiredRoles.delete(scope.role);
    addError(
      errors,
      ["observed", "unsupported"].includes(scope.status),
      `registry scope ${scope.role || "unknown"} status is invalid`
    );
    addError(
      errors,
      scope.collectionContextRole === registration?.executionContextRole,
      `registry scope ${scope.role || "unknown"} context is invalid`
    );
    if (scope.status === "observed") {
      observedScopeCount += 1;
      addError(
        errors,
        Number.isSafeInteger(scope.matchingEntryCount) &&
          scope.matchingEntryCount >= 0,
        `registry scope ${scope.role || "unknown"} count is invalid`
      );
    } else {
      addError(
        errors,
        typeof scope.reason === "string" && scope.reason.length > 0,
        `registry scope ${scope.role || "unknown"} reason is required`
      );
    }
  }
  addError(
    errors,
    requiredRoles.size === 0,
    "all standard uninstall registry roles must be represented"
  );

  const expectedRegistrationStatus =
    observedScopeCount === REGISTRY_SCOPE_ROLES.length
      ? "observed"
      : observedScopeCount > 0
        ? "partial"
        : "unsupported";
  addError(
    errors,
    registration?.status === expectedRegistrationStatus,
    "uninstall registration status does not match scope coverage"
  );

  const matchingEntryCount = Array.isArray(registration?.matchingEntries)
    ? registration.matchingEntries.length
    : 0;
  const expectedConclusion =
    matchingEntryCount > 0
      ? "present"
      : expectedRegistrationStatus === "observed" &&
          registration?.executionContextRole === "interactive_user"
        ? "absent"
        : "unknown";
  addError(
    errors,
    registration?.conclusion === expectedConclusion,
    "uninstall registration conclusion does not match trusted evidence"
  );

  if (currentState?.status === "observed") {
    const componentStatuses = [
      existing?.status,
      shortcut?.status,
      desktopShortcut?.status,
      registration?.status,
      currentState?.scopedProcesses?.status,
      currentState?.temporaryTestArtifacts?.status
    ];
    addError(
      errors,
      componentStatuses.every((status) => status === "observed"),
      "observed currentState requires every component to be observed"
    );
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

    addError(
      errors,
      trial.isolatedInstallRoot?.role === "isolated_install_root",
      "cleanInstallTrial.isolatedInstallRoot.role is invalid"
    );
    addError(
      errors,
      trial.isolatedInstallRoot?.value === "<isolated-install-root>",
      "cleanInstallTrial.isolatedInstallRoot.value must be a normalized isolated root"
    );

    for (const edge of ["before", "after"]) {
      addError(
        errors,
        SHA256_PATTERN.test(trial.sentinel?.[edge]?.sha256 || ""),
        `cleanInstallTrial.sentinel.${edge}.sha256 must be SHA-256`
      );
      addError(
        errors,
        isNormalizedRolePath(trial.shortcuts?.[edge]?.target),
        `cleanInstallTrial.shortcuts.${edge}.target must be normalized`
      );
      addError(
        errors,
        SHA256_PATTERN.test(trial.shortcuts?.[edge]?.sha256 || ""),
        `cleanInstallTrial.shortcuts.${edge}.sha256 must be SHA-256`
      );
      validatePassedRegistrySnapshot(
        errors,
        trial.uninstallRegistration?.[edge],
        `cleanInstallTrial.uninstallRegistration.${edge}`
      );
    }

    addError(
      errors,
      trial.processScope?.executableRole === "isolated_install_executable",
      "cleanInstallTrial.processScope.executableRole is invalid"
    );
    addError(
      errors,
      trial.processScope?.userDataRole === "isolated_test_profile",
      "cleanInstallTrial.processScope.userDataRole is invalid"
    );
    addError(
      errors,
      Number.isSafeInteger(trial.processScope?.matchingProcessCount) &&
        trial.processScope.matchingProcessCount === 0,
      "cleanInstallTrial.processScope.matchingProcessCount must be zero"
    );

    const targetFile = trial.productTextInsertion?.targetFile;
    addError(
      errors,
      targetFile?.role === "isolated_notepad_output",
      "cleanInstallTrial.productTextInsertion.targetFile.role is invalid"
    );
    addError(
      errors,
      isNormalizedRolePath(targetFile?.path) &&
        targetFile.path.startsWith("<isolated-test-profile>/"),
      "cleanInstallTrial.productTextInsertion.targetFile.path must be normalized"
    );
    addError(
      errors,
      SHA256_PATTERN.test(targetFile?.sha256 || ""),
      "cleanInstallTrial.productTextInsertion.targetFile.sha256 must be SHA-256"
    );
    addError(
      errors,
      Number.isSafeInteger(targetFile?.bytes) && targetFile.bytes > 0,
      "cleanInstallTrial.productTextInsertion.targetFile.bytes must be positive"
    );
    addError(
      errors,
      ISO_DATE_PATTERN.test(trial.productTextInsertion?.observedAt || ""),
      "cleanInstallTrial.productTextInsertion.observedAt must be UTC ISO-8601"
    );
    addError(
      errors,
      trial.productTextInsertion?.isolatedProfileRole === "isolated_test_profile",
      "cleanInstallTrial.productTextInsertion.isolatedProfileRole is invalid"
    );
  }
}

export function validateCleanInstallEvidence(manifest, options = {}) {
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
  validateNoSensitiveMachineData(errors, manifest, options);

  return {
    ok: errors.length === 0,
    errors
  };
}
