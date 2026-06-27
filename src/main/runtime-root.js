import path from "node:path";

export function getRuntimeRoot({ app, cwd = process.cwd, resourcesPath = process.resourcesPath } = {}) {
  if (app?.isPackaged && resourcesPath) return resourcesPath;
  return cwd();
}

export function getAppRoot({ app, cwd = process.cwd, resourcesPath = process.resourcesPath } = {}) {
  if (app?.isPackaged && resourcesPath) {
    return path.join(resourcesPath, "app");
  }
  return cwd();
}

export function getVendorRoot(runtimeRoot) {
  return path.join(runtimeRoot, "vendor");
}
