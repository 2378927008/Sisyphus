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
      "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 80; [System.Windows.Forms.SendKeys]::SendWait('^v')"
    ]
  };
}

export async function pasteText(text, deps = {}) {
  const clipboard = deps.clipboard;
  const spawnImpl = deps.spawn || spawn;

  if (!clipboard?.writeText) {
    throw new PasteError("Clipboard integration is unavailable.", "clipboard_unavailable");
  }

  try {
    clipboard.writeText(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PasteError(`Clipboard write failed. ${message}`, "clipboard_unavailable");
  }

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
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      reject(new PasteError(`Paste command failed. ${message}`, "paste_failed"));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new PasteError(`Paste command exited with code ${code}.`, "paste_failed"));
      }
    });
  });
}
