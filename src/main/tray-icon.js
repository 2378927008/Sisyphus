import path from "node:path";

export function getTrayIconPath(appRoot) {
  return path.join(appRoot, "assets", "local-flow-icon.svg");
}
