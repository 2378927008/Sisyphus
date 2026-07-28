const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ARTIFACT_KEYS = ["installer", "blockmap", "unpackedExecutable"];
const ARTIFACT_CLOCK_TOLERANCE_MS = 2 * 60 * 1000;
const MAX_ARTIFACT_SKEW_MS = 30 * 60 * 1000;
const MAX_BUILD_DURATION_MS = 2 * 60 * 60 * 1000;

function addError(errors, condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function parseTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

export function validateReleaseBuildProvenance({
  packageVersion,
  productName,
  record,
  actualArtifacts
}) {
  const errors = [];
  addError(errors, record?.schemaVersion === 1, "record.schemaVersion must be 1");
  addError(errors, record?.productName === productName, "record.productName does not match");
  addError(errors, record?.version === packageVersion, "record.version does not match package version");

  const buildStartedAt = parseTimestamp(record?.buildStartedAt);
  const buildFinishedAt = parseTimestamp(record?.buildFinishedAt);
  const recordedAt = parseTimestamp(record?.recordedAt);
  addError(errors, Number.isFinite(buildStartedAt), "record.buildStartedAt is invalid");
  addError(errors, Number.isFinite(buildFinishedAt), "record.buildFinishedAt is invalid");
  addError(errors, Number.isFinite(recordedAt), "record.recordedAt is invalid");
  if (
    Number.isFinite(buildStartedAt) &&
    Number.isFinite(buildFinishedAt) &&
    Number.isFinite(recordedAt)
  ) {
    addError(errors, buildFinishedAt >= buildStartedAt, "build finished before it started");
    addError(errors, recordedAt >= buildFinishedAt, "record was written before build completion");
    addError(
      errors,
      buildFinishedAt - buildStartedAt <= MAX_BUILD_DURATION_MS,
      "build duration exceeds the supported window"
    );
  }

  const artifactTimes = [];
  for (const key of ARTIFACT_KEYS) {
    const expected = record?.artifacts?.[key];
    const actual = actualArtifacts?.[key];
    addError(errors, Boolean(expected), `record.artifacts.${key} is required`);
    addError(errors, Boolean(actual), `actualArtifacts.${key} is required`);
    if (!expected || !actual) {
      continue;
    }

    addError(errors, typeof expected.path === "string" && expected.path.length > 0, `${key}.path is invalid`);
    addError(errors, Number.isSafeInteger(expected.bytes) && expected.bytes > 0, `${key}.bytes is invalid`);
    addError(errors, SHA256_PATTERN.test(expected.sha256 || ""), `${key}.sha256 is invalid`);

    const expectedModifiedAt = parseTimestamp(expected.modifiedAt);
    const actualModifiedAt = parseTimestamp(actual.modifiedAt);
    addError(errors, Number.isFinite(expectedModifiedAt), `${key}.modifiedAt is invalid`);
    addError(errors, Number.isFinite(actualModifiedAt), `actual ${key}.modifiedAt is invalid`);
    if (Number.isFinite(actualModifiedAt)) {
      artifactTimes.push(actualModifiedAt);
    }

    for (const field of ["path", "bytes", "sha256", "modifiedAt"]) {
      addError(
        errors,
        actual[field] === expected[field],
        `${key}.${field} does not match the recorded build artifact`
      );
    }

    if (
      Number.isFinite(expectedModifiedAt) &&
      Number.isFinite(buildStartedAt) &&
      Number.isFinite(buildFinishedAt)
    ) {
      addError(
        errors,
        expectedModifiedAt >= buildStartedAt - ARTIFACT_CLOCK_TOLERANCE_MS,
        `${key}.modifiedAt predates the recorded build start`
      );
      addError(
        errors,
        expectedModifiedAt <= buildFinishedAt + ARTIFACT_CLOCK_TOLERANCE_MS,
        `${key}.modifiedAt follows the recorded build finish`
      );
    }
  }

  const artifactSkewMs = artifactTimes.length === ARTIFACT_KEYS.length
    ? Math.max(...artifactTimes) - Math.min(...artifactTimes)
    : null;
  if (artifactSkewMs !== null) {
    addError(
      errors,
      artifactSkewMs <= MAX_ARTIFACT_SKEW_MS,
      "release artifacts are outside the same-build modification window"
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    artifactSkewMs
  };
}
