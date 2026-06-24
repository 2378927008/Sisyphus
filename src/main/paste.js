import { spawn } from "node:child_process";

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
    throw new Error("Clipboard integration is unavailable.");
  }

  clipboard.writeText(text);

  const command = buildPasteCommand();
  await new Promise((resolve, reject) => {
    const child = spawnImpl(command.file, command.args, { windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Paste command exited with code ${code}.`));
      }
    });
  });
}
