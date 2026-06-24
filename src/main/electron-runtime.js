export const electronRuntimeSwitches = [
  "no-sandbox",
  "disable-gpu",
  "disable-gpu-compositing",
  "disable-software-rasterizer"
];

export function applyElectronRuntimeSwitches(app) {
  app.disableHardwareAcceleration();

  for (const runtimeSwitch of electronRuntimeSwitches) {
    app.commandLine.appendSwitch(runtimeSwitch);
  }
}
