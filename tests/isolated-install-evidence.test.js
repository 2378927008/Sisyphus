import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertSafeIsolatedRoot,
  registrationMatchesReleaseIdentity,
  registrationTargetsIsolatedRoot,
  validateIsolatedInstallEvidence
} from "../scripts/isolated-install-evidence-core.mjs";

function observedFile(filePath, sha256 = "a".repeat(64), bytes = 1024) {
  return {
    status: "observed",
    path: filePath,
    sha256,
    bytes
  };
}

function createPassedEvidence() {
  return {
    schemaVersion: 1,
    evidenceKind: "local-flow-windows-isolated-install",
    generatedAt: "2026-07-28T12:00:00.000Z",
    safety: {
      existingInstallMutation: "prohibited",
      currentUserRegistrationCountBefore: 0,
      currentUserInstallKeyExistedBefore: false,
      installRootRole: "project_tmp",
      knownFolderMode: "clean_runner_profile_observed",
      knownFoldersObserved: true,
      shortcutsAbsentBefore: true,
      shellFoldersRestored: true
    },
    releaseArtifacts: {
      version: "0.1.0",
      installer: observedFile(
        "dist/Local Flow Setup 0.1.0.exe",
        "1".repeat(64),
        244_000_000
      ),
      blockmap: observedFile(
        "dist/Local Flow Setup 0.1.0.exe.blockmap",
        "2".repeat(64),
        255_000
      ),
      unpackedExecutable: observedFile(
        "dist/win-unpacked/Local Flow.exe",
        "3".repeat(64),
        210_000_000
      )
    },
    lifecycle: {
      status: "passed",
      preflight: {
        status: "observed",
        executionContextRole: "restricted_process",
        protectedStateSha256: "4".repeat(64)
      },
      installation: {
        status: "observed",
        installerExitCode: 0,
        executable: observedFile(
          "<isolated-install-root>/Local Flow.exe",
          "3".repeat(64),
          210_000_000
        ),
        uninstaller: observedFile(
          "<isolated-install-root>/Uninstall Local Flow.exe",
          "5".repeat(64),
          530_000
        ),
        startMenuShortcut: {
          status: "observed",
          path: "<clean-runner-profile>/Start Menu/Programs/Local Flow.lnk",
          targetRole: "isolated_install_executable",
          sha256: "6".repeat(64)
        },
        desktopShortcut: {
          status: "observed",
          path: "<clean-runner-profile>/Desktop/Local Flow.lnk",
          targetRole: "isolated_install_executable",
          sha256: "7".repeat(64)
        },
        uninstallRegistration: {
          status: "observed",
          displayName: "Local Flow",
          displayVersion: "0.1.0",
          installLocationRole: "isolated_install_root",
          uninstallTargetRole: "isolated_install_uninstaller"
        },
        installRegistry: {
          status: "observed",
          installLocationRole: "isolated_install_root"
        },
        packagedResourcesMatchRelease: true
      },
      launch: {
        status: "observed",
        userDataRole: "isolated_test_profile",
        firstLaunchMainProcessCount: 1,
        secondLaunchExitCode: 0,
        mainProcessCountAfterSecondLaunch: 1
      },
      uninstall: {
        status: "observed",
        exitCode: 0,
        executableRemoved: true,
        shortcutRemoved: true,
        registrationRemoved: true,
        installRegistryRemoved: true,
        matchingProcessCount: 0
      },
      postflight: {
        status: "observed",
        protectedStateSha256: "4".repeat(64),
        protectedStateUnchanged: true
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
}

test("isolated install evidence accepts a complete automated lifecycle", () => {
  assert.deepEqual(
    validateIsolatedInstallEvidence(createPassedEvidence()),
    { ok: true, errors: [] }
  );
});

test("isolated install evidence keeps microphone-to-Notepad verification manual", () => {
  const evidence = createPassedEvidence();
  evidence.lifecycle.productTextInsertion.status = "observed";

  const result = validateIsolatedInstallEvidence(evidence);

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) =>
      error.includes("productTextInsertion.status")
    )
  );
});

test("isolated install evidence rejects incomplete uninstall cleanup", () => {
  const evidence = createPassedEvidence();
  evidence.lifecycle.uninstall.registrationRemoved = false;
  evidence.lifecycle.uninstall.matchingProcessCount = 2;

  const result = validateIsolatedInstallEvidence(evidence);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("registrationRemoved")));
  assert.ok(result.errors.some((error) => error.includes("matchingProcessCount")));
});

test("isolated install evidence rejects pre-existing current-user registration", () => {
  const evidence = createPassedEvidence();
  evidence.safety.currentUserRegistrationCountBefore = 1;

  const result = validateIsolatedInstallEvidence(evidence);

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) =>
      error.includes("currentUserRegistrationCountBefore")
    )
  );
});

test("isolated install evidence rejects overwritten runner shortcuts", () => {
  const evidence = createPassedEvidence();
  evidence.safety.shortcutsAbsentBefore = false;
  delete evidence.lifecycle.installation.desktopShortcut;

  const result = validateIsolatedInstallEvidence(evidence);

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("shortcutsAbsentBefore"))
  );
  assert.ok(
    result.errors.some((error) => error.includes("desktopShortcut.status"))
  );
});

test("isolated install root must remain under the project .tmp directory", () => {
  const projectRoot = path.resolve("C:/workspace/local-flow");

  assert.doesNotThrow(() =>
    assertSafeIsolatedRoot(
      projectRoot,
      path.join(projectRoot, ".tmp", "clean-install-123", "app")
    )
  );
  assert.throws(
    () =>
      assertSafeIsolatedRoot(
        projectRoot,
        path.resolve("C:/Users/Someone/AppData/Local/Programs/Local Flow")
      ),
    /project \.tmp/
  );
});

test("uninstall registration can prove the isolated root from its command", () => {
  const installRoot = path.resolve("C:/workspace/.tmp/clean-install/app");
  const uninstallerPath = path.join(
    installRoot,
    "Uninstall Local Flow.exe"
  );

  assert.equal(
    registrationTargetsIsolatedRoot(
      {
        installLocation: "",
        uninstallString: `"${uninstallerPath}" /currentuser`
      },
      { installRoot, uninstallerPath }
    ),
    true
  );
});

test("uninstall registration must match the packaged product identity", () => {
  assert.equal(
    registrationMatchesReleaseIdentity(
      { displayName: "Local Flow", displayVersion: "0.1.0" },
      { productName: "Local Flow", version: "0.1.0" }
    ),
    true
  );
  assert.equal(
    registrationMatchesReleaseIdentity(
      { displayName: "Local Flow", displayVersion: "9.9.9" },
      { productName: "Local Flow", version: "0.1.0" }
    ),
    false
  );
});

test("isolated install smoke guards the clean runner profile and temporary install root", async () => {
  const source = await readFile(
    new URL("../scripts/isolated-install-smoke.mjs", import.meta.url),
    "utf8"
  );

  assert.match(source, /assertSafeIsolatedRoot/);
  assert.match(source, /currentUserRegistrationCountBefore/);
  assert.match(source, /installRegistryGuid/);
  assert.match(
    source,
    /const installRegistryGuid = requireInstallRegistryGuid\(pkg\)/
  );
  assert.match(source, /existing_install_key_detected/);
  assert.match(source, /queryWindowsKnownFolders/);
  assert.match(source, /existing_shortcut_detected/);
  assert.match(source, /shellFoldersRestored/);
  assert.match(source, /\["\/S", "\/currentuser"/);
  assert.match(source, /--user-data-dir=/);
  assert.match(source, /windows-isolated-install-v4\.json/);
  assert.match(
    source,
    /const startMenuShortcutSha256 = await sha256File\(startMenuShortcut\)/
  );
  assert.match(
    source,
    /const desktopShortcutSha256 = await sha256File\(desktopShortcut\)/
  );
  assert.match(source, /sha256: startMenuShortcutSha256/);
  assert.match(source, /let smokeStage = "startup"/);
  assert.match(source, /stage: smokeStage/);
  assert.match(source, /try \{\s+smokeStage = "prepare_temp"/);
  assert.doesNotMatch(
    source,
    /New-ItemProperty|Remove-ItemProperty/
  );
  assert.match(
    source,
    /shellFoldersRestored = shellSnapshotsMatch\(\s+shellBackup,\s+await captureShellFolders\(\)/
  );
  assert.match(source, /finally \{[\s\S]+await rmWithRetry\(runRoot\)/);
  assert.match(source, /preflightSafe && installerAttempted/);
  assert.match(source, /removeShortcutIfOwned/);
  assert.match(source, /let primaryError = null/);
  assert.match(source, /primaryError = error/);
  assert.match(source, /cwd: projectRoot/);
  assert.doesNotMatch(source, /Get-CimInstance Win32_Process/);
  assert.match(source, /finally/);
  assert.doesNotMatch(source, /E:\\\\local flow/i);
  assert.doesNotMatch(source, /USERPROFILE:\s*profileRoot/);
});
