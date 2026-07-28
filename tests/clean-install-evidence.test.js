import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCleanInstallEvidence } from "../scripts/clean-install-evidence-core.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function observedFile(path, sha256, bytes) {
  return {
    status: "observed",
    path,
    sha256,
    bytes
  };
}

function createTruthfulManifest() {
  return {
    schemaVersion: 1,
    evidenceKind: "local-flow-windows-clean-install",
    generatedAt: "2026-07-28T08:00:00.000Z",
    readinessScope: "read-only-current-state-and-manual-clean-install-plan",
    safety: {
      existingInstallMutation: "prohibited",
      installerRun: false,
      uninstallerRun: false
    },
    releaseArtifacts: {
      status: "observed",
      version: "0.1.0",
      installer: observedFile(
        "dist/Local Flow Setup 0.1.0.exe",
        "a".repeat(64),
        244_000_000
      ),
      blockmap: observedFile(
        "dist/Local Flow Setup 0.1.0.exe.blockmap",
        "b".repeat(64),
        255_000
      ),
      unpackedExecutable: observedFile(
        "dist/win-unpacked/Local Flow.exe",
        "c".repeat(64),
        210_000_000
      )
    },
    currentState: {
      status: "observed",
      existingInstallation: {
        status: "observed",
        role: "existing_user_install",
        root: "<existing-install-root>",
        executable: observedFile(
          "<existing-install-root>/Local Flow.exe",
          "c".repeat(64),
          210_000_000
        ),
        uninstaller: observedFile(
          "<existing-install-root>/Uninstall Local Flow.exe",
          "d".repeat(64),
          530_000
        )
      },
      startMenuShortcut: {
        status: "observed",
        path: "%APPDATA%/Microsoft/Windows/Start Menu/Programs/Local Flow.lnk",
        target: "<existing-install-root>/Local Flow.exe",
        workingDirectory: "<existing-install-root>",
        sha256: "e".repeat(64)
      },
      desktopShortcut: {
        status: "observed",
        path: "%USERPROFILE%/Desktop/Local Flow.lnk",
        exists: false
      },
      uninstallRegistration: {
        status: "observed",
        scopes: [
          { role: "current_user", status: "observed", matchingEntryCount: 0 },
          { role: "local_machine_64", status: "observed", matchingEntryCount: 0 },
          { role: "local_machine_32", status: "observed", matchingEntryCount: 0 },
          { role: "loaded_users", status: "observed", matchingEntryCount: 0 }
        ],
        matchingEntries: [],
        conclusion: "absent"
      },
      scopedProcesses: {
        status: "observed",
        processNames: ["Local Flow.exe", "notepad.exe"],
        matchingProcessCount: 0
      },
      temporaryTestArtifacts: {
        status: "observed",
        scope: ".tmp/clean-install*",
        matchingEntryCount: 0
      }
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

test("clean-install evidence schema accepts a truthful read-only manifest", () => {
  const result = validateCleanInstallEvidence(createTruthfulManifest());

  assert.deepEqual(result, { ok: true, errors: [] });
});

test("clean-install evidence schema rejects success claims without observed proof", () => {
  const manifest = createTruthfulManifest();
  manifest.cleanInstallTrial.status = "passed";

  const result = validateCleanInstallEvidence(manifest);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("cleanInstallTrial.status")));
});

test("committed clean-install evidence is valid, normalized, and explicitly not run", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../docs/release/evidence/windows-clean-install-v4.json", import.meta.url),
    "utf8"
  ));
  const serialized = JSON.stringify(manifest);
  const registration = manifest.currentState.uninstallRegistration;

  assert.deepEqual(validateCleanInstallEvidence(manifest), { ok: true, errors: [] });
  assert.doesNotMatch(serialized, /S-1-5-21-/);
  assert.doesNotMatch(serialized, /C:\\\\Users\\\\/i);
  assert.doesNotMatch(serialized, /E:\\\\/i);
  assert.equal(
    registration.conclusion,
    registration.matchingEntries.length === 0 ? "absent" : "present"
  );
  assert.equal(manifest.cleanInstallTrial.status, "not_run");
  assert.equal(manifest.cleanInstallTrial.productTextInsertion.status, "manual_required");
});

test("product readiness validates the persistent clean-install evidence manifest", () => {
  const result = spawnSync(process.execPath, ["scripts/product-readiness-report.mjs"], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  const payload = JSON.parse(result.stdout || result.stderr);
  const evidenceCheck = payload.checks.find(
    ({ area }) => area === "windows-clean-install-evidence"
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(evidenceCheck?.ok, true);
  assert.equal(evidenceCheck?.path, "docs/release/evidence/windows-clean-install-v4.json");
});

test("package exposes a repeatable read-only evidence collector", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    pkg.scripts["collect:clean-install-evidence"],
    "node scripts/clean-install-evidence.mjs"
  );
});

test("collector stays truthful when no existing-install root is supplied", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "local-flow-evidence-"));
  const outputPath = path.join(temporaryRoot, "evidence.json");
  const environment = { ...process.env };
  delete environment.LOCAL_FLOW_EXISTING_INSTALL_ROOT;
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    ["scripts/clean-install-evidence.mjs", "--output", outputPath],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: environment
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(manifest.currentState.existingInstallation.status, "unsupported");
  assert.deepEqual(validateCleanInstallEvidence(manifest), { ok: true, errors: [] });
});
