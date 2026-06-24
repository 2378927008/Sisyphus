import { app, BrowserWindow, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyElectronRuntimeSwitches } from "../src/main/electron-runtime.js";
import { configureMediaPermissions } from "../src/main/media-permissions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, "microphone-smoke.html");

applyElectronRuntimeSwitches(app);

const timeout = setTimeout(() => {
  console.error("Microphone smoke test timed out.");
  app.exit(2);
}, 30000);

app.whenReady().then(async () => {
  configureMediaPermissions(session.defaultSession);

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await window.loadFile(htmlPath);
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        const before = await navigator.mediaDevices.enumerateDevices();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        const after = await navigator.mediaDevices.enumerateDevices();
        return {
          ok: true,
          devicesBefore: before.map((device) => ({ kind: device.kind, label: device.label })),
          devicesAfter: after.map((device) => ({ kind: device.kind, label: device.label }))
        };
      })()
    `);
    console.log(JSON.stringify(result, null, 2));
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      name: error.name,
      message: error.message
    }, null, 2));
    clearTimeout(timeout);
    app.exit(1);
  }
});
