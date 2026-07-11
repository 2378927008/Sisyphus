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
    const cleanup = () => {
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
    const onError = (error) => {
      const message = error instanceof Error ? error.message : String(error);
      finish(new PasteError(`Paste command failed. ${message}`, "paste_failed"));
    };
    const onClose = (code) => {
      if (code === 0) {
        finish();
      } else {
        finish(new PasteError(`Paste command exited with code ${code}.`, "paste_failed"));
      }
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      child.removeListener?.("error", onError);
      child.removeListener?.("close", onClose);
      child.once?.("error", () => {});
      try {
        if (typeof child.kill === "function" && child.exitCode == null && !child.killed) {
          child.kill();
        }
      } catch {
        // The process may have exited between the abort event and kill call.
      }
      reject(createAbortError());
    };

    child.once("error", onError);
    child.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
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
