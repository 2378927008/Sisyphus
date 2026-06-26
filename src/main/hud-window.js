import path from "node:path";

export function buildHudWindowOptions({ preloadPath }) {
  return {
    width: 360,
    height: 112,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    transparent: false,
    backgroundColor: "#171717",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  };
}

export function getHudHtmlPath(rootDir) {
  return path.join(rootDir, "../renderer/hud.html");
}
