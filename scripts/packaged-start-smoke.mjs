import { spawn } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const exeRelativePath = "dist/win-unpacked/Local Flow.exe";
const exePath = path.join(projectRoot, ...exeRelativePath.split("/"));
const userDataDir = path.join(projectRoot, ".tmp", "packaged-start-smoke-user-data");
const defaultSmokeMs = 8000;
const maxSmokeMs = 30000;
const requestedSmokeMs = Number.parseInt(process.env.LOCAL_FLOW_PACKAGED_SMOKE_MS || `${defaultSmokeMs}`, 10);
const smokeMs =
  Number.isFinite(requestedSmokeMs) && requestedSmokeMs > 0
    ? Math.min(requestedSmokeMs, maxSmokeMs)
    : defaultSmokeMs;
const shutdownMs = 5000;

function print(payload) {
  const stream = payload.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertPackagedAppExists() {
  await access(exePath);
}

async function runSmoke() {
  await assertPackagedAppExists();
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });

  const child = spawn(exePath, [`--user-data-dir=${userDataDir}`, "--hidden"], {
    cwd: projectRoot,
    stdio: "ignore",
    windowsHide: true
  });

  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ type: "exit", code, signal }));
  });
  const errorPromise = new Promise((resolve) => {
    child.once("error", (error) => resolve({ type: "error", error }));
  });

  try {
    const startupResult = await Promise.race([
      wait(smokeMs).then(() => ({ type: "alive" })),
      exitPromise,
      errorPromise
    ]);

    if (startupResult.type === "error") {
      throw startupResult.error;
    }
    if (startupResult.type === "exit") {
      const exit = startupResult;
      throw new Error(`packaged app exited early with code ${exit.code ?? "null"} signal ${exit.signal ?? "null"}`);
    }

    child.kill();
    const shutdownResult = await Promise.race([exitPromise, wait(shutdownMs).then(() => null)]);
    if (shutdownResult === null && child.exitCode === null) {
      child.kill("SIGKILL");
      await Promise.race([exitPromise, wait(1000)]);
    }

    print({
      ok: true,
      exe: exeRelativePath,
      pid: child.pid,
      aliveMs: smokeMs,
      mode: "hidden"
    });
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
    await rm(userDataDir, { recursive: true, force: true });
  }
}

try {
  await runSmoke();
} catch (error) {
  print({
    ok: false,
    exe: exeRelativePath,
    message: error.message
  });
  process.exitCode = 1;
}
