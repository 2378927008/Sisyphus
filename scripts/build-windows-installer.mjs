import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateReleaseBuildProvenance } from "./release-build-provenance-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

async function artifactMetadata(relativePath) {
  const fullPath = path.join(projectRoot, ...relativePath.split("/"));
  const [fileStat, binary] = await Promise.all([
    stat(fullPath),
    readFile(fullPath)
  ]);
  return {
    path: relativePath,
    bytes: fileStat.size,
    sha256: createHash("sha256").update(binary).digest("hex"),
    modifiedAt: fileStat.mtime.toISOString()
  };
}

try {
  const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const outputDir = pkg.build?.directories?.output || "dist";
  const productName = pkg.build?.productName || "Local Flow";
  const recordPath = path.join(projectRoot, outputDir, "local-flow-release-build.json");
  const artifactPaths = {
    installer: `${outputDir}/${productName} Setup ${pkg.version}.exe`,
    blockmap: `${outputDir}/${productName} Setup ${pkg.version}.exe.blockmap`,
    unpackedExecutable: `${outputDir}/win-unpacked/${productName}.exe`
  };

  await rm(recordPath, { force: true });
  const buildStartedAt = new Date().toISOString();
  const electronBuilderCli = require.resolve("electron-builder/out/cli/cli.js");
  const build = spawnSync(
    process.execPath,
    [electronBuilderCli, "--win", "nsis", "--publish", "never"],
    {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: false
    }
  );
  if (build.error) {
    throw build.error;
  }
  if (build.status !== 0) {
    throw new Error(`electron-builder exited with status ${build.status}`);
  }
  const buildFinishedAt = new Date().toISOString();
  const artifacts = {
    installer: await artifactMetadata(artifactPaths.installer),
    blockmap: await artifactMetadata(artifactPaths.blockmap),
    unpackedExecutable: await artifactMetadata(artifactPaths.unpackedExecutable)
  };
  const record = {
    schemaVersion: 1,
    productName,
    version: pkg.version,
    buildStartedAt,
    buildFinishedAt,
    recordedAt: new Date().toISOString(),
    artifacts
  };
  const validation = validateReleaseBuildProvenance({
    packageVersion: pkg.version,
    productName,
    record,
    actualArtifacts: artifacts
  });
  if (!validation.ok) {
    throw new Error(`release build provenance failed: ${validation.errors.join("; ")}`);
  }

  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    version: pkg.version,
    buildStartedAt,
    buildFinishedAt,
    artifactSkewMs: validation.artifactSkewMs,
    record: `${outputDir}/local-flow-release-build.json`
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error)
  }, null, 2)}\n`);
  process.exitCode = 1;
}
