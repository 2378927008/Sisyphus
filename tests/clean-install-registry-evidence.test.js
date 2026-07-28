import test from "node:test";
import assert from "node:assert/strict";
import { buildUninstallRegistrationEvidence } from "../scripts/clean-install-evidence-core.mjs";

const EMPTY_SUCCESS_SCOPES = [
  {
    role: "collector_current_user",
    access: "success",
    matchingEntries: []
  },
  {
    role: "local_machine_64",
    access: "success",
    matchingEntries: []
  },
  {
    role: "local_machine_32",
    access: "success",
    matchingEntries: []
  },
  {
    role: "loaded_user_profiles",
    access: "success",
    matchingEntries: []
  }
];

test("interactive registry collection can report an observed absent snapshot", () => {
  const evidence = buildUninstallRegistrationEvidence({
    executionContextRole: "interactive_user",
    scopeResults: EMPTY_SUCCESS_SCOPES
  });

  assert.equal(evidence.status, "observed");
  assert.equal(evidence.executionContextRole, "interactive_user");
  assert.equal(evidence.conclusion, "absent");
  assert.deepEqual(
    evidence.scopes.map(({ role, status, collectionContextRole }) => ({
      role,
      status,
      collectionContextRole
    })),
    [
      {
        role: "collector_current_user",
        status: "observed",
        collectionContextRole: "interactive_user"
      },
      {
        role: "local_machine_64",
        status: "observed",
        collectionContextRole: "interactive_user"
      },
      {
        role: "local_machine_32",
        status: "observed",
        collectionContextRole: "interactive_user"
      },
      {
        role: "loaded_user_profiles",
        status: "observed",
        collectionContextRole: "interactive_user"
      }
    ]
  );
});

test("restricted registry collection cannot turn empty results into false absent evidence", () => {
  const evidence = buildUninstallRegistrationEvidence({
    executionContextRole: "restricted_process",
    scopeResults: EMPTY_SUCCESS_SCOPES
  });
  const scopes = Object.fromEntries(evidence.scopes.map((scope) => [scope.role, scope]));

  assert.equal(evidence.status, "partial");
  assert.equal(evidence.executionContextRole, "restricted_process");
  assert.equal(evidence.conclusion, "unknown");
  assert.equal(scopes.collector_current_user.status, "unsupported");
  assert.equal(scopes.loaded_user_profiles.status, "unsupported");
  assert.equal(scopes.local_machine_64.status, "observed");
  assert.equal(scopes.local_machine_32.status, "observed");
  assert.notEqual(evidence.conclusion, "absent");
});

test("unknown or unreadable registry collection remains unsupported instead of absent", () => {
  const evidence = buildUninstallRegistrationEvidence({
    executionContextRole: "unknown",
    scopeResults: EMPTY_SUCCESS_SCOPES.map(({ role }) => ({
      role,
      access: "unknown",
      reason: "registry scope access was not confirmed",
      matchingEntries: []
    }))
  });

  assert.equal(evidence.status, "unsupported");
  assert.equal(evidence.executionContextRole, "unknown");
  assert.equal(evidence.conclusion, "unknown");
  assert.ok(evidence.scopes.every(({ status }) => status === "unsupported"));
});
