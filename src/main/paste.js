import { spawn } from "node:child_process";

export class PasteError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PasteError";
    this.code = code;
  }
}

export function buildPasteCommand() {
  return {
    file: "powershell.exe",
    args: [
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
    ]
  };
}

export async function pasteText(text, deps = {}) {
  const clipboard = deps.clipboard;
  const spawnImpl = deps.spawn || spawn;
  const signal = deps.signal;
  const wait = deps.wait || waitForTimeout;
  const platform = deps.platform ?? process.platform;
  const killProcessTree = deps.killProcessTree || ((child) => (
    killPasteProcessTree(child, { platform, spawn: spawnImpl })
  ));
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  const terminationTimeoutMs = normalizeTerminationTimeout(deps.terminationTimeoutMs);

  if (!clipboard?.writeText) {
    throw new PasteError("Clipboard integration is unavailable.", "clipboard_unavailable");
  }

  try {
    clipboard.writeText(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PasteError(`Clipboard write failed. ${message}`, "clipboard_unavailable");
  }

  throwIfAborted(signal);
  await wait(80, signal);
  throwIfAborted(signal);

  const command = buildPasteCommand();
  await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command.file, command.args, { windowsHide: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reject(new PasteError(`Paste command failed. ${message}`, "paste_failed"));
      return;
    }

    let settled = false;
    let aborting = false;
    let fallbackStarted = false;
    let terminationTimer = null;
    const cleanup = () => {
      clearTerminationTimer();
      signal?.removeEventListener("abort", onAbort);
      child.removeListener?.("error", onError);
      child.removeListener?.("close", onClose);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const finishAbort = () => finish(createAbortError());
    const clearTerminationTimer = () => {
      if (terminationTimer === null) return;
      clearTimer(terminationTimer);
      terminationTimer = null;
    };
    const armTerminationTimer = (onTimeout) => {
      clearTerminationTimer();
      terminationTimer = setTimer(() => {
        terminationTimer = null;
        onTimeout();
      }, terminationTimeoutMs);
    };
    const startProcessTreeFallback = () => {
      if (settled || fallbackStarted) return;

      fallbackStarted = true;
      armTerminationTimer(finishAbort);
      if (platform !== "win32" || !child.pid) return;

      let fallback;
      try {
        fallback = killProcessTree(child, { platform, spawn: spawnImpl });
      } catch {
        return;
      }
      Promise.resolve(fallback).then(
        (confirmed) => {
          if (!settled && confirmed !== false) finishAbort();
        },
        () => {}
      );
    };
    const onError = (error) => {
      if (aborting) {
        startProcessTreeFallback();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      finish(new PasteError(`Paste command failed. ${message}`, "paste_failed"));
    };
    const onClose = (code) => {
      if (aborting) {
        finishAbort();
        return;
      }
      if (code === 0) {
        finish();
      } else {
        finish(new PasteError(`Paste command exited with code ${code}.`, "paste_failed"));
      }
    };
    const onAbort = () => {
      if (settled || aborting) return;
      aborting = true;
      signal?.removeEventListener("abort", onAbort);

      if (child.exitCode != null) {
        finishAbort();
        return;
      }

      let killStarted = false;
      try {
        killStarted = typeof child.kill === "function" && child.kill() === true;
      } catch {
        startProcessTreeFallback();
        return;
      }
      if (settled || fallbackStarted) return;
      if (child.exitCode != null) {
        finishAbort();
      } else if (killStarted) {
        armTerminationTimer(startProcessTreeFallback);
      } else {
        startProcessTreeFallback();
      }
    };

    child.once("error", onError);
    child.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export function killPasteProcessTree(child, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const spawnImpl = deps.spawn || spawn;
  if (platform !== "win32" || !child?.pid) return Promise.resolve(false);

  return new Promise((resolve, reject) => {
    let killer;
    try {
      killer = spawnImpl(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" }
      );
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const cleanup = () => {
      killer.removeListener?.("error", onError);
      killer.removeListener?.("close", onClose);
    };
    const finish = (error, confirmed = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(confirmed);
    };
    const onError = (error) => finish(error);
    const onClose = (code) => {
      if (code === 0) {
        finish(null, true);
      } else {
        finish(new Error(`taskkill exited with code ${code}.`));
      }
    };

    if (!killer?.once) {
      finish(new Error("taskkill process could not be monitored."));
      return;
    }
    killer.once("error", onError);
    killer.once("close", onClose);
  });
}

function waitForTimeout(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function createAbortError() {
  return new PasteError("Paste cancelled.", "paste_failed");
}

function normalizeTerminationTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 1000;
}
