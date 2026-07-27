export function isHiddenLaunch(argv = []) {
  return Array.isArray(argv) && argv.some((argument) => argument === "--hidden");
}

export function registerSingleInstance(app, { onSecondInstance = () => {} } = {}) {
  const ownsLock = app.requestSingleInstanceLock();
  if (!ownsLock) {
    app.quit();
    return false;
  }

  app.on("second-instance", (_event, argv = []) => {
    if (!isHiddenLaunch(argv)) {
      onSecondInstance(argv);
    }
  });
  return true;
}

export function createDeferredReveal(reveal) {
  let pending = false;
  return {
    request() {
      pending = !reveal();
      return !pending;
    },
    flush() {
      if (!pending) return true;
      pending = !reveal();
      return !pending;
    },
    hasPending() {
      return pending;
    }
  };
}
