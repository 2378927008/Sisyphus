import test from "node:test";
import assert from "node:assert/strict";
import { validateReleaseBuildProvenance } from "../scripts/release-build-provenance-core.mjs";

function artifact(path, modifiedAt, sha256) {
  return {
    path,
    bytes: 1_000_000,
    sha256,
    modifiedAt
  };
}

function createCoherentBuild() {
  const artifacts = {
    installer: artifact(
      "dist/Local Flow Setup 0.1.0.exe",
      "2026-07-28T08:08:00.000Z",
      "a".repeat(64)
    ),
    blockmap: artifact(
      "dist/Local Flow Setup 0.1.0.exe.blockmap",
      "2026-07-28T08:09:00.000Z",
      "b".repeat(64)
    ),
    unpackedExecutable: artifact(
      "dist/win-unpacked/Local Flow.exe",
      "2026-07-28T08:03:00.000Z",
      "c".repeat(64)
    )
  };
  return {
    record: {
      schemaVersion: 1,
      productName: "Local Flow",
      version: "0.1.0",
      buildStartedAt: "2026-07-28T08:00:00.000Z",
      buildFinishedAt: "2026-07-28T08:10:00.000Z",
      recordedAt: "2026-07-28T08:10:01.000Z",
      artifacts
    },
    actualArtifacts: structuredClone(artifacts)
  };
}

test("release provenance accepts artifacts from one bounded versioned build", () => {
  const { record, actualArtifacts } = createCoherentBuild();

  const result = validateReleaseBuildProvenance({
    packageVersion: "0.1.0",
    productName: "Local Flow",
    record,
    actualArtifacts
  });

  assert.deepEqual(result, {
    ok: true,
    errors: [],
    artifactSkewMs: 6 * 60 * 1000
  });
});

test("release provenance rejects a stale same-version installer", () => {
  const { record, actualArtifacts } = createCoherentBuild();
  actualArtifacts.installer.modifiedAt = "2026-07-27T08:08:00.000Z";

  const result = validateReleaseBuildProvenance({
    packageVersion: "0.1.0",
    productName: "Local Flow",
    record,
    actualArtifacts
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("installer.modifiedAt")));
});

test("release provenance rejects a record for another package version", () => {
  const { record, actualArtifacts } = createCoherentBuild();
  record.version = "0.0.9";

  const result = validateReleaseBuildProvenance({
    packageVersion: "0.1.0",
    productName: "Local Flow",
    record,
    actualArtifacts
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("record.version")));
});

test("release provenance rejects artifact content changed after the build record", () => {
  const { record, actualArtifacts } = createCoherentBuild();
  actualArtifacts.blockmap.sha256 = "d".repeat(64);

  const result = validateReleaseBuildProvenance({
    packageVersion: "0.1.0",
    productName: "Local Flow",
    record,
    actualArtifacts
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("blockmap.sha256")));
});
