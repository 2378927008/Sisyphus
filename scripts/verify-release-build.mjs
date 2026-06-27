import { access, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const expectedIconPath = "assets/local-flow-icon.ico";
const requiredFiles = [
  "assets/local-flow-icon.ico",
  "dist/Local Flow Setup 0.1.0.exe",
  "dist/win-unpacked/Local Flow.exe",
  "dist/win-unpacked/resources/app/assets/local-flow-icon.ico"
];
const ignoredPaths = [
  "dist",
  "node_modules",
  "vendor/whisper",
  "vendor/llm"
];

function toFsPath(relativePath) {
  return path.join(projectRoot, ...relativePath.split("/"));
}

function fail(message, details = {}) {
  const payload = { ok: false, message, ...details };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}

async function assertFileExists(relativePath, minBytes = 1) {
  const fullPath = toFsPath(relativePath);
  await access(fullPath);
  const fileStat = await stat(fullPath);
  if (fileStat.size < minBytes) {
    throw new Error(`${relativePath} is too small: ${fileStat.size} bytes`);
  }
  return {
    path: relativePath,
    bytes: fileStat.size
  };
}

function assertIgnored(relativePath) {
  const result = spawnSync("git", ["check-ignore", "-q", relativePath], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`git check-ignore failed for ${relativePath}`);
  }
  return relativePath;
}

try {
  const pkg = JSON.parse(await readFile(toFsPath("package.json"), "utf8"));
  if (pkg.build?.win?.icon !== expectedIconPath) {
    throw new Error(`build.win.icon must be ${expectedIconPath}`);
  }
  if (pkg.build?.nsis?.installerIcon !== expectedIconPath) {
    throw new Error(`build.nsis.installerIcon must be ${expectedIconPath}`);
  }
  if (pkg.build?.nsis?.uninstallerIcon !== expectedIconPath) {
    throw new Error(`build.nsis.uninstallerIcon must be ${expectedIconPath}`);
  }

  const files = [];
  for (const relativePath of requiredFiles) {
    const minBytes = relativePath.endsWith(".exe") ? 1024 * 1024 : 1024;
    files.push(await assertFileExists(relativePath, minBytes));
  }

  const ignored = ignoredPaths.map(assertIgnored);
  console.log(JSON.stringify({
    ok: true,
    productName: pkg.build.productName,
    version: pkg.version,
    icon: expectedIconPath,
    files,
    ignored
  }, null, 2));
} catch (error) {
  fail(error.message, {
    requiredFiles,
    ignoredPaths
  });
}
