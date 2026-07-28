import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as evidenceCore from "../scripts/clean-install-evidence-core.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const evidenceUrl = new URL(
  "../docs/release/evidence/windows-clean-install-v4.json",
  import.meta.url
);

async function loadEvidenceFixture() {
  return JSON.parse(await readFile(evidenceUrl, "utf8"));
}

test("manifest validation rejects sensitive nested string values", async (t) => {
  const cases = [
    ["drive path", "Missing C:\\Users\\SensitiveUser\\private\\file.txt"],
    ["UNC path", "Cannot read \\\\private-server\\profiles\\SensitiveUser\\data"],
    ["profile fragment", "Cannot read \\Users\\SensitiveUser\\private"],
    ["SID", "Identity S-1-5-21-1111111111-2222222222-3333333333-1001"],
    ["user name", "Access denied for user Administrator"],
    ["command line", "powershell.exe -NoProfile -Command whoami"]
  ];

  for (const [name, sensitiveValue] of cases) {
    await t.test(name, async () => {
      const manifest = await loadEvidenceFixture();
      manifest.source.failureProbe = sensitiveValue;

      const result = evidenceCore.validateCleanInstallEvidence(manifest, {
        sensitiveTokens: ["Administrator", "SensitiveUser"]
      });

      assert.equal(result.ok, false);
      assert.ok(result.errors.length > 0);
    });
  }
});

test("manifest validation permits normalized role placeholders", async () => {
  const manifest = await loadEvidenceFixture();
  manifest.source.normalizedExamples = [
    "%APPDATA%/Microsoft/Windows/Start Menu/Programs/Local Flow.lnk",
    "%USERPROFILE%/Desktop/Local Flow.lnk",
    "<existing-install-root>/Local Flow.exe",
    "<isolated-install-root>/Local Flow.exe",
    "<isolated-test-profile>/Local Flow insertion.txt",
    "<project-root>/dist/Local Flow Setup.exe",
    "<redacted-machine-path>",
    "<redacted-user>",
    "<redacted-sid>",
    "<redacted-command-line>",
    "<redacted-sensitive-value>"
  ];

  assert.deepEqual(
    evidenceCore.validateCleanInstallEvidence(manifest, {
      sensitiveTokens: ["Administrator", "SensitiveUser"]
    }),
    { ok: true, errors: [] }
  );
});

test("role placeholders survive colliding sensitive-token names", async () => {
  const allowed = [
    "%APPDATA%/Local Flow",
    "%USERPROFILE%/Desktop",
    "<existing-install-root>/Local Flow.exe"
  ];
  const manifest = await loadEvidenceFixture();
  manifest.source.normalizedExamples = allowed;
  const options = {
    sensitiveTokens: ["app", "user", "install"]
  };

  assert.deepEqual(
    evidenceCore.validateCleanInstallEvidence(manifest, options),
    { ok: true, errors: [] }
  );
  assert.deepEqual(evidenceCore.redactEvidenceValue(allowed, options), allowed);
});

test("manifest validation and redaction cover sensitive nested object keys", async () => {
  const manifest = await loadEvidenceFixture();
  manifest.source.dynamicProbe = {
    "C:\\Users\\SensitiveUser\\private": "value"
  };

  const validation = evidenceCore.validateCleanInstallEvidence(manifest, {
    sensitiveTokens: ["SensitiveUser"]
  });
  const redacted = evidenceCore.redactEvidenceValue(manifest.source.dynamicProbe, {
    sensitiveTokens: ["SensitiveUser"]
  });

  assert.equal(validation.ok, false);
  assert.doesNotMatch(JSON.stringify(redacted), /SensitiveUser|C:\\Users\\/i);
});

test("arbitrary angle-bracket identities are rejected and redacted in values and keys", async () => {
  const manifest = await loadEvidenceFixture();
  manifest.source.identityValueProbe = "<Administrator>";
  manifest.source.identityKeyProbe = {
    "<Administrator>": "collector identity"
  };
  const options = { sensitiveTokens: ["Administrator"] };

  const validation = evidenceCore.validateCleanInstallEvidence(manifest, options);
  const redacted = evidenceCore.redactEvidenceValue(manifest, options);

  assert.equal(validation.ok, false);
  assert.doesNotMatch(JSON.stringify(redacted), /Administrator/i);
  assert.deepEqual(
    evidenceCore.validateCleanInstallEvidence(redacted, options),
    { ok: true, errors: [] }
  );
});

test("embedded UNC paths are rejected and redacted in values and keys", async () => {
  const manifest = await loadEvidenceFixture();
  manifest.source.uncValueProbe = "location=\\\\private-server\\share";
  manifest.source.uncKeyProbe = {
    "location=\\\\private-server\\share": "registry source"
  };

  const validation = evidenceCore.validateCleanInstallEvidence(manifest);
  const redacted = evidenceCore.redactEvidenceValue(manifest);

  assert.equal(validation.ok, false);
  assert.doesNotMatch(JSON.stringify(redacted), /private-server|\\\\share/i);
  assert.deepEqual(
    evidenceCore.validateCleanInstallEvidence(redacted),
    { ok: true, errors: [] }
  );
});

test("command-bearing fields and explicit command keys are rejected and redacted", async () => {
  const manifest = await loadEvidenceFixture();
  manifest.source.command = "git status";
  manifest.source.commandLine = "whoami /user";
  manifest.source.shellCommand = "LocalFlow.exe record";
  manifest.source.args = ["--profile", "<isolated-test-profile>"];
  manifest.source.commandKeyProbe = {
    "LocalFlow.exe record": "captured command"
  };

  const validation = evidenceCore.validateCleanInstallEvidence(manifest);
  const redacted = evidenceCore.redactEvidenceValue(manifest);

  assert.equal(validation.ok, false);
  assert.equal(redacted.source.command, "<redacted-command-line>");
  assert.equal(redacted.source.commandLine, "<redacted-command-line>");
  assert.equal(redacted.source.shellCommand, "<redacted-command-line>");
  assert.deepEqual(redacted.source.args, [
    "<redacted-command-line>",
    "<redacted-command-line>"
  ]);
  assert.deepEqual(redacted.source.commandKeyProbe, {
    "<redacted-command-line>": "captured command"
  });
  assert.deepEqual(
    evidenceCore.validateCleanInstallEvidence(redacted),
    { ok: true, errors: [] }
  );
});

test("benign ASCII evidence explanations are preserved outside command fields", async () => {
  const manifest = await loadEvidenceFixture();
  const explanation = "The node runtime is available for evidence collection.";
  manifest.source.reason = explanation;

  assert.deepEqual(
    evidenceCore.validateCleanInstallEvidence(manifest),
    { ok: true, errors: [] }
  );
  assert.equal(
    evidenceCore.redactEvidenceValue(explanation),
    explanation
  );
});

test("Chinese explanations and allowed relative paths remain valid and unchanged", async () => {
  const allowed = [
    "证据收集器可以正常运行。",
    "scripts/clean-install-evidence.mjs",
    "docs/release/evidence/windows-clean-install-v4.json"
  ];
  const manifest = await loadEvidenceFixture();
  manifest.source.safeExamples = allowed;

  assert.deepEqual(
    evidenceCore.validateCleanInstallEvidence(manifest),
    { ok: true, errors: [] }
  );
  assert.deepEqual(evidenceCore.redactEvidenceValue(allowed), allowed);
});

test("recursive evidence redaction removes sensitive values without damaging role placeholders", () => {
  assert.equal(typeof evidenceCore.redactEvidenceValue, "function");
  const redacted = evidenceCore.redactEvidenceValue(
    {
      reason: "Access denied for user Administrator",
      nested: [
        "C:\\Users\\SensitiveUser\\private\\file.txt",
        "\\\\private-server\\profiles\\SensitiveUser\\data",
        "Identity S-1-5-21-1111111111-2222222222-3333333333-1001",
        "powershell.exe -NoProfile -Command whoami"
      ],
      allowed: [
        "%APPDATA%/Local Flow",
        "%USERPROFILE%/Desktop",
        "<existing-install-root>/Local Flow.exe"
      ]
    },
    {
      sensitiveTokens: ["Administrator", "SensitiveUser"]
    }
  );
  const serialized = JSON.stringify(redacted);

  assert.doesNotMatch(serialized, /Administrator|SensitiveUser/i);
  assert.doesNotMatch(serialized, /[a-z]:[\\/]/i);
  assert.doesNotMatch(serialized, /\\\\private-server/i);
  assert.doesNotMatch(serialized, /S-1-5-21-/i);
  assert.doesNotMatch(serialized, /powershell\.exe|-NoProfile|Command whoami/i);
  assert.deepEqual(redacted.allowed, [
    "%APPDATA%/Local Flow",
    "%USERPROFILE%/Desktop",
    "<existing-install-root>/Local Flow.exe"
  ]);
});

test("specific root roles take precedence over user-profile redaction", () => {
  const existingRoot = path.join(
    process.env.USERPROFILE,
    "Local Flow Evidence Fixture"
  );
  const executablePath = path.join(existingRoot, "Local Flow.exe");

  const redacted = evidenceCore.redactEvidenceValue(executablePath, {
    replacements: [
      {
        value: existingRoot,
        replacement: "<existing-install-root>"
      }
    ]
  });

  assert.match(redacted, /^<existing-install-root>[\\/]Local Flow\.exe$/);
  assert.doesNotMatch(redacted, /%USERPROFILE%/);
});

test("collector failure never emits or persists a sensitive missing-root value", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "local-flow-privacy-"));
  const outputPath = path.join(temporaryRoot, "evidence.json");
  const sensitiveRoot = "C:\\Users\\SensitiveUser\\definitely-missing";
  const environment = {
    ...process.env,
    USERNAME: "SensitiveUser",
    USERPROFILE: "C:\\Users\\SensitiveUser",
    APPDATA: "C:\\Users\\SensitiveUser\\AppData\\Roaming"
  };
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [
      "scripts/clean-install-evidence.mjs",
      "--output",
      outputPath,
      "--existing-install-root",
      sensitiveRoot
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: environment
    }
  );
  const processOutput = `${result.stdout || ""}\n${result.stderr || ""}`;

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(processOutput, /SensitiveUser/i);
  assert.doesNotMatch(processOutput, /C:\\Users\\/i);

  let persisted = "";
  try {
    await access(outputPath);
    persisted = await readFile(outputPath, "utf8");
  } catch {
    persisted = "";
  }
  assert.doesNotMatch(persisted, /SensitiveUser|C:\\Users\\/i);
});
