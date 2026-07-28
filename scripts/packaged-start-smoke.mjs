import { spawn } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPackagedAppSpawnOptions,
  filterScopedProcesses,
  summarizePackagedStartup
} from "./packaged-start-smoke-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const exeRelativePath = "dist/win-unpacked/Local Flow.exe";
const exePath = path.join(projectRoot, ...exeRelativePath.split("/"));
const userDataDir = path.join(projectRoot, ".tmp", "packaged-start-smoke-user-data");
const defaultSmokeMs = 5000;
const maxSmokeMs = 30000;
const requestedSmokeMs = Number.parseInt(
  process.env.LOCAL_FLOW_PACKAGED_SMOKE_MS || `${defaultSmokeMs}`,
  10
);
const smokeMs =
  Number.isFinite(requestedSmokeMs) && requestedSmokeMs > 0
    ? Math.min(requestedSmokeMs, maxSmokeMs)
    : defaultSmokeMs;
const secondLaunchTimeoutMs = 8000;
const revealTimeoutMs = 12000;
const processQueryTimeoutMs = 5000;
const cleanupTimeoutMs = 5000;
const pollIntervalMs = 250;

const failedSummary = Object.freeze({
  ok: false,
  hiddenLaunchStayedAlive: false,
  secondLaunchExited: false,
  secondLaunchRevealedExistingWindow: false,
  duplicateMainInstances: 0
});

function print(payload) {
  const stream = payload.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function observeChild(child) {
  let spawnError = null;
  let exitResult = null;
  let resolveCompletion;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const spawned = new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });

  child.on("error", (error) => {
    spawnError = error;
    if (!exitResult) {
      exitResult = { type: "error", error };
      resolveCompletion(exitResult);
    }
  });
  child.once("exit", (code, signal) => {
    if (!exitResult) {
      exitResult = { type: "exit", code, signal };
      resolveCompletion(exitResult);
    }
  });

  return {
    spawned,
    completion,
    isAlive() {
      return !spawnError && !exitResult && child.exitCode === null;
    }
  };
}

function spawnPackagedApp(args) {
  const child = spawn(exePath, args, buildPackagedAppSpawnOptions(projectRoot));
  return { child, observer: observeChild(child) };
}

async function requireStableProcess(observer, durationMs, label) {
  const result = await Promise.race([
    observer.completion,
    wait(durationMs).then(() => ({ type: "alive" }))
  ]);
  if (result.type === "error") {
    throw result.error;
  }
  if (result.type === "exit") {
    throw new Error(
      `${label} exited early with code ${result.code ?? "null"} signal ${result.signal ?? "null"}`
    );
  }
  return observer.isAlive();
}

async function requirePromptExit(observer, durationMs) {
  const result = await Promise.race([
    observer.completion,
    wait(durationMs).then(() => ({ type: "timeout" }))
  ]);
  if (result.type === "error") {
    throw result.error;
  }
  if (result.type === "timeout") {
    return false;
  }
  return result.type === "exit" && result.code === 0;
}

async function runProcess(file, args, { env = process.env, timeoutMs = processQueryTimeoutMs } = {}) {
  const child = spawn(file, args, {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${file} timed out`));
    }, timeoutMs);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function queryPackagedProcesses() {
  const command = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LocalFlowSmokeUser32 {
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
$target = [System.IO.Path]::GetFullPath($env:LOCAL_FLOW_SMOKE_EXE)
$rows = @(
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ExecutablePath -and
      [string]::Equals(
        [System.IO.Path]::GetFullPath($_.ExecutablePath),
        $target,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    } |
    ForEach-Object {
      $handle = [IntPtr]::Zero
      try {
        $handle = (Get-Process -Id $_.ProcessId -ErrorAction Stop).MainWindowHandle
      } catch {}
      [pscustomobject]@{
        ProcessId = [int]$_.ProcessId
        ExecutablePath = [string]$_.ExecutablePath
        CommandLine = [string]$_.CommandLine
        MainWindowHandle = [int64]$handle
        IsWindowVisible = (
          $handle -ne [IntPtr]::Zero -and
          [LocalFlowSmokeUser32]::IsWindowVisible($handle)
        )
      }
    }
)
ConvertTo-Json -InputObject $rows -Compress -Depth 4
`;
  const result = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      env: {
        ...process.env,
        LOCAL_FLOW_SMOKE_EXE: exePath
      }
    }
  );

  if (result.code !== 0) {
    throw new Error(`process query failed with code ${result.code ?? "null"}`);
  }
  const parsed = JSON.parse(result.stdout.trim() || "[]");
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function pollForRevealedSummary({
  firstPid,
  hiddenLaunchStayedAlive,
  secondLaunchExited,
  firstObserver
}) {
  const deadline = Date.now() + revealTimeoutMs;
  let latest = failedSummary;

  while (Date.now() < deadline) {
    const processes = await queryPackagedProcesses();
    latest = summarizePackagedStartup({
      exePath,
      userDataDir,
      firstPid,
      hiddenLaunchStayedAlive: hiddenLaunchStayedAlive && firstObserver.isAlive(),
      secondLaunchExited,
      processes
    });
    if (latest.ok) {
      return latest;
    }
    if (!firstObserver.isAlive() || latest.duplicateMainInstances > 0) {
      return latest;
    }
    await wait(pollIntervalMs);
  }

  return latest;
}

async function terminateKnownChild(processRecord) {
  if (!processRecord?.child || !processRecord.observer?.isAlive()) {
    return;
  }
  processRecord.child.kill("SIGKILL");
  await Promise.race([
    processRecord.observer.completion,
    wait(1000)
  ]);
}

async function terminateScopedProcesses() {
  let processes = [];
  try {
    processes = await queryPackagedProcesses();
  } catch {
    return;
  }

  const scoped = filterScopedProcesses(processes, {
    exePath,
    userDataDir,
    includeHelpers: true
  });
  for (const processInfo of scoped) {
    const pid = Number(processInfo.ProcessId);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      continue;
    }
    try {
      await runProcess(
        "taskkill.exe",
        ["/PID", `${pid}`, "/T", "/F"],
        { timeoutMs: cleanupTimeoutMs }
      );
    } catch {
      // The process may already have exited.
    }
  }
}

async function runSmoke() {
  let first = null;
  let second = null;
  let summary = { ...failedSummary };

  try {
    await access(exePath);
    await rm(userDataDir, { recursive: true, force: true });
    await mkdir(userDataDir, { recursive: true });

    const userDataArgument = `--user-data-dir=${userDataDir}`;
    first = spawnPackagedApp([userDataArgument, "--hidden"]);
    await first.observer.spawned;
    const hiddenLaunchStayedAlive = await requireStableProcess(
      first.observer,
      smokeMs,
      "hidden packaged app"
    );

    second = spawnPackagedApp([userDataArgument]);
    await second.observer.spawned;
    const secondLaunchExited = await requirePromptExit(
      second.observer,
      secondLaunchTimeoutMs
    );

    summary = await pollForRevealedSummary({
      firstPid: first.child.pid,
      hiddenLaunchStayedAlive,
      secondLaunchExited,
      firstObserver: first.observer
    });

    print({
      ...summary,
      exe: exeRelativePath,
      pid: first.child.pid,
      userDataScope: ".tmp/packaged-start-smoke-user-data"
    });
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await terminateKnownChild(second);
    await terminateKnownChild(first);
    await terminateScopedProcesses();
    await rm(userDataDir, { recursive: true, force: true });
  }

  return summary;
}

try {
  await runSmoke();
} catch (error) {
  print({
    ...failedSummary,
    exe: exeRelativePath,
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
}
