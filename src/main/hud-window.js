import path from "node:path";

const hudSize = {
  width: 460,
  height: 72
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

export function getHudWindowPosition(workArea) {
  if (!workArea) {
    return {};
  }

  return {
    x: Math.round(workArea.x + (workArea.width - hudSize.width) / 2),
    y: Math.round(workArea.y + workArea.height - hudSize.height - hudBottomOffset)
  };
}

export function repositionHudWindow({ window, screen }) {
  if (!window || window.isDestroyed?.()) return false;

  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const position = getHudWindowPosition(display?.workArea);
  if (!Number.isInteger(position.x) || !Number.isInteger(position.y)) return false;

  window.setPosition(position.x, position.y, false);
  return true;
}

export function showHudWindow({ window, screen }) {
  if (!window || window.isDestroyed?.()) return false;

  repositionHudWindow({ window, screen });
  if (typeof window.showInactive === "function") {
    window.showInactive();
  } else {
    window.show();
  }
  return true;
}

export function bindHudDisplayChanges({ window, screen }) {
  const events = ["display-added", "display-removed", "display-metrics-changed"];
  const reposition = () => repositionHudWindow({ window, screen });

  for (const event of events) {
    screen.on(event, reposition);
  }

  return () => {
    for (const event of events) {
      screen.removeListener(event, reposition);
    }
  };
}
