import path from "node:path";

const hudSize = {
  width: 360,
  height: 112
};
const hudBottomOffset = 48;

export function buildHudWindowOptions({ preloadPath, workArea } = {}) {
  const position = getHudWindowPosition(workArea);

  return {
    width: hudSize.width,
    height: hudSize.height,
    ...position,
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

export function getHudPreloadPath(rootDir) {
  return path.join(rootDir, "../hud-preload.cjs");
}

function getHudWindowPosition(workArea) {
  if (!workArea) {
    return {};
  }

  return {
    x: Math.round(workArea.x + (workArea.width - hudSize.width) / 2),
    y: Math.round(workArea.y + workArea.height - hudSize.height - hudBottomOffset)
  };
}
