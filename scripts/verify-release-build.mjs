import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEmbeddedLlmRuntime } from "../src/main/embedded-llm-assets.js";
import { validateWhisperSetup } from "../src/main/whisper-diagnostics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const expectedIconPath = "assets/local-flow-icon.ico";
const ignoredPaths = [
  "dist",
  "node_modules",
  "vendor/whisper",
  "vendor/llm"
];

function buildReleaseRequirements(pkg) {
  const outputDir = pkg.build?.directories?.output || "dist";
  const productName = pkg.build?.productName || "Local Flow";
  const installerName = `${productName} Setup ${pkg.version}.exe`;

  return [
    { path: "assets/local-flow-icon.ico", minBytes: 1024 },
    { path: `${outputDir}/${installerName}`, minBytes: 1024 * 1024 },
    { path: `${outputDir}/win-unpacked/${productName}.exe`, minBytes: 1024 * 1024 },
    {
      path: `${outputDir}/win-unpacked/resources/app/assets/local-flow-icon.ico`,
      minBytes: 1024
    },
    {
      path: `${outputDir}/win-unpacked/resources/app/scripts/llama-runtime-manifest.json`,
      minBytes: 256
    },
    {
      path: `${outputDir}/win-unpacked/resources/app/scripts/qwen-model-manifest.json`,
      minBytes: 256
    },
    {
      path: `${outputDir}/win-unpacked/resources/vendor/whisper/bin/Release/whisper-cli.exe`,
      minBytes: 100_000
    },
    {
      path: `${outputDir}/win-unpacked/resources/vendor/whisper/models/ggml-base.bin`,
      minBytes: 100 * 1024 * 1024
    },
    {
      path: `${outputDir}/win-unpacked/resources/vendor/llm/bin/llama-cli.exe`,
      minBytes: 1024 * 1024
    }
  ];
}

function toFsPath(relativePath) {
  return path.join(projectRoot, ...relativePath.split("/"));
}

function fail(message, details = {}) {
  const payload = { ok: false, message, ...details };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}

async function assertFileExists(requirement) {
  const fullPath = toFsPath(requirement.path);
  await access(fullPath);
  const fileStat = await stat(fullPath);
  if (!fileStat.isFile() || fileStat.size < requirement.minBytes) {
    throw new Error(`${requirement.path} is missing or too small`);
  }
  return {
    path: requirement.path,
    bytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString()
  };
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(toFsPath(relativePath), "utf8"));
}

async function sha256(relativePath) {
  const binary = await readFile(toFsPath(relativePath));
  return createHash("sha256").update(binary).digest("hex");
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

function assertManifestShape(llamaManifest, qwenManifest) {
  if (
    !/^b\d+$/.test(llamaManifest.version || "") ||
    !/^[a-f0-9]{64}$/.test(llamaManifest.cliSha256 || "")
  ) {
    throw new Error("bundled llama.cpp runtime manifest is invalid");
  }
  if (
    qwenManifest.modelId !== "Qwen/Qwen3-4B-GGUF" ||
    qwenManifest.fileName !== "Qwen3-4B-Q4_K_M.gguf" ||
    !Number.isSafeInteger(qwenManifest.size) ||
    !/^[a-f0-9]{64}$/.test(qwenManifest.sha256 || "")
  ) {
    throw new Error("bundled optional Qwen manifest is invalid");
  }
}

async function findBundledGguf(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findBundledGguf(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".gguf")) {
      matches.push(fullPath);
    }
  }
  return matches;
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
  const vendorResource = pkg.build?.extraResources?.find(
    (resource) => resource.from === "vendor" && resource.to === "vendor"
  );
  if (!vendorResource?.filter?.includes("!llm/models/**")) {
    throw new Error("the optional Qwen model directory must be excluded from the installer");
  }

  const requiredFiles = buildReleaseRequirements(pkg);
  const files = [];
  for (const requirement of requiredFiles) {
    files.push(await assertFileExists(requirement));
  }

  const outputDir = pkg.build?.directories?.output || "dist";
  const unpackedRoot = `${outputDir}/win-unpacked`;
  const llamaManifestPath =
    `${unpackedRoot}/resources/app/scripts/llama-runtime-manifest.json`;
  const qwenManifestPath =
    `${unpackedRoot}/resources/app/scripts/qwen-model-manifest.json`;
  const llamaCliPath =
    `${unpackedRoot}/resources/vendor/llm/bin/llama-cli.exe`;
  const whisperCliPath =
    `${unpackedRoot}/resources/vendor/whisper/bin/Release/whisper-cli.exe`;
  const whisperModelPath =
    `${unpackedRoot}/resources/vendor/whisper/models/ggml-base.bin`;
  const [llamaManifest, qwenManifest] = await Promise.all([
    readJson(llamaManifestPath),
    readJson(qwenManifestPath)
  ]);
  assertManifestShape(llamaManifest, qwenManifest);

  const actualLlamaCliSha256 = await sha256(llamaCliPath);
  if (actualLlamaCliSha256 !== llamaManifest.cliSha256.toLowerCase()) {
    throw new Error("packaged llama.cpp runtime does not match its manifest");
  }

  const [llamaRuntime, whisperRuntime] = await Promise.all([
    validateEmbeddedLlmRuntime(toFsPath(llamaCliPath), {
      expectedSha256: llamaManifest.cliSha256,
      runtimeValidationTimeoutMs: 10_000
    }),
    validateWhisperSetup({
      whisperCliPath: toFsPath(whisperCliPath),
      whisperModelPath: toFsPath(whisperModelPath)
    })
  ]);
  if (!llamaRuntime.ready) {
    throw new Error("packaged llama.cpp runtime check failed");
  }
  if (!whisperRuntime.ready) {
    throw new Error("packaged Whisper runtime check failed");
  }

  const bundledGguf = await findBundledGguf(
    toFsPath(`${unpackedRoot}/resources/vendor/llm`)
  );
  if (bundledGguf.length > 0) {
    throw new Error("optional Qwen model must not be bundled in the installer");
  }

  const ignored = ignoredPaths.map(assertIgnored);
  console.log(JSON.stringify({
    ok: true,
    productName: pkg.build.productName,
    version: pkg.version,
    icon: expectedIconPath,
    files,
    manifests: {
      llamaRuntime: llamaManifest.version,
      qwenModel: qwenManifest.modelId
    },
    runtimeChecks: {
      whisper: true,
      llama: true,
      qwenModelBundled: false
    },
    ignored
  }, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), {
    ignoredPaths
  });
}
