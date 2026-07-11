import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { buildPasteCommand, pasteText } from "../src/main/paste.js";

test("buildPasteCommand returns a Windows SendKeys command", () => {
  const command = buildPasteCommand();

  assert.equal(command.file, "powershell.exe");
  assert.ok(command.args.includes("-STA"));
  assert.match(command.args.at(-1), /SendKeys.*\^v/);
  assert.doesNotMatch(command.args.at(-1), /Start-Sleep/);
});

test("pasteText aborts during the focus delay without spawning SendKeys", async () => {
  const controller = new AbortController();
  let spawnCalls = 0;

  await assert.rejects(
    pasteText("hello", {
      clipboard: { writeText() {} },
      signal: controller.signal,
      wait: async () => controller.abort(),
      spawn: () => {
        spawnCalls += 1;
        const child = new EventEmitter();
        process.nextTick(() => child.emit("close", 0));
        return child;
      }
    }),
    (error) => error.code === "paste_failed"
  );

  assert.equal(spawnCalls, 0);
});

test("pasteText waits for child close after kill succeeds", async () => {
  const controller = new AbortController();
  const child = new EventEmitter();
  const spawned = createDeferred();
  let killCalls = 0;
  child.kill = () => {
    killCalls += 1;
    return true;
  };

  const observed = observePromise(pasteText("hello", {
    clipboard: { writeText() {} },
    signal: controller.signal,
    wait: async () => {},
    spawn: () => {
      spawned.resolve();
      return child;
    }
  }));

  await spawned.promise;
  controller.abort();
  await flushMicrotasks();

  assert.equal(observed.state, "pending");
  assert.equal(killCalls, 1);

  child.emit("close", 0);
  await observed.completion;

  assert.equal(observed.state, "rejected");
  assert.equal(observed.value.code, "paste_failed");
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("close"), 0);
});

test("pasteText falls back to Windows taskkill when child.kill returns false", async () => {
  const controller = new AbortController();
  const child = new EventEmitter();
  const taskkill = new EventEmitter();
  const spawned = createDeferred();
  const spawnCalls = [];
  child.pid = 4242;
  child.kill = () => false;

  const observed = observePromise(pasteText("hello", {
    clipboard: { writeText() {} },
    signal: controller.signal,
    wait: async () => {},
    platform: "win32",
    spawn: (file, args, options) => {
      spawnCalls.push({ file, args, options });
      if (spawnCalls.length === 1) {
        spawned.resolve();
        return child;
      }
      return taskkill;
    }
  }));

  await spawned.promise;
  controller.abort();
  await flushMicrotasks();

  assert.equal(observed.state, "pending");
  assert.deepEqual(spawnCalls[1], {
    file: "taskkill.exe",
    args: ["/PID", "4242", "/T", "/F"],
    options: { windowsHide: true, stdio: "ignore" }
  });

  taskkill.emit("close", 0);
  await observed.completion;

  assert.equal(observed.state, "rejected");
  assert.equal(observed.value.code, "paste_failed");
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(taskkill.listenerCount("error"), 0);
  assert.equal(taskkill.listenerCount("close"), 0);
});

test("pasteText uses an injected process-tree fallback when child.kill throws", async () => {
  const controller = new AbortController();
  const child = new EventEmitter();
  const spawned = createDeferred();
  const fallback = createDeferred();
  let fallbackCalls = 0;
  child.pid = 5252;
  child.kill = () => {
    throw new Error("kill failed");
  };

  const observed = observePromise(pasteText("hello", {
    clipboard: { writeText() {} },
    signal: controller.signal,
    wait: async () => {},
    platform: "win32",
    killProcessTree: async (receivedChild) => {
      fallbackCalls += 1;
      assert.equal(receivedChild, child);
      return fallback.promise;
    },
    spawn: () => {
      spawned.resolve();
      return child;
    }
  }));

  await spawned.promise;
  controller.abort();
  await flushMicrotasks();

  assert.equal(observed.state, "pending");
  assert.equal(fallbackCalls, 1);

  fallback.resolve(true);
  await observed.completion;

  assert.equal(observed.state, "rejected");
  assert.equal(observed.value.code, "paste_failed");
});

test("pasteText waits for its bounded timeout when taskkill errors", async () => {
  const controller = new AbortController();
  const child = new EventEmitter();
  const taskkill = new EventEmitter();
  const spawned = createDeferred();
  const timers = createManualTimers();
  let spawnCalls = 0;
  child.pid = 6262;
  child.kill = () => false;

  const observed = observePromise(pasteText("hello", {
    clipboard: { writeText() {} },
    signal: controller.signal,
    wait: async () => {},
    platform: "win32",
    terminationTimeoutMs: 250,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    spawn: () => {
      spawnCalls += 1;
      if (spawnCalls === 1) {
        spawned.resolve();
        return child;
      }
      return taskkill;
    }
  }));

  await spawned.promise;
  controller.abort();
  await flushMicrotasks();

  assert.equal(observed.state, "pending");
  taskkill.emit("error", new Error("taskkill unavailable"));
  await flushMicrotasks();
  assert.equal(observed.state, "pending");
  assert.deepEqual(timers.delays, [250]);

  timers.fireNext();
  await observed.completion;

  assert.equal(observed.state, "rejected");
  assert.equal(observed.value.code, "paste_failed");
  assert.equal(child.listenerCount("error"), 1);
  assert.equal(child.listenerCount("close"), 1);
  assert.equal(timers.pendingCount, 1);

  timers.fireNext();

  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(timers.pendingCount, 0);
});

test("pasteText detaches a hanging taskkill helper and drains late process events", async () => {
  const abortController = createManualAbortController();
  const child = new EventEmitter();
  const taskkill = new EventEmitter();
  const spawned = createDeferred();
  const timers = createManualTimers();
  let spawnCalls = 0;
  let childUnrefCalls = 0;
  let helperKillCalls = 0;
  let helperUnrefCalls = 0;
  child.pid = 6363;
  child.kill = () => false;
  child.unref = () => {
    childUnrefCalls += 1;
  };
  taskkill.kill = () => {
    helperKillCalls += 1;
    return false;
  };
  taskkill.unref = () => {
    helperUnrefCalls += 1;
  };

  const observed = observePromise(pasteText("hello", {
    clipboard: { writeText() {} },
    signal: abortController.signal,
    wait: async () => {},
    platform: "win32",
    terminationTimeoutMs: 250,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    spawn: () => {
      spawnCalls += 1;
      if (spawnCalls === 1) {
        spawned.resolve();
        return child;
      }
      return taskkill;
    }
  }));

  await spawned.promise;
  abortController.abort();
  await flushMicrotasks();
  assert.equal(observed.state, "pending");
  assert.equal(timers.pendingCount, 1);

  timers.fireNext();
  await observed.completion;

  assert.equal(observed.state, "rejected");
  assert.equal(observed.value.code, "paste_failed");
  assert.equal(helperKillCalls, 1);
  assert.equal(helperUnrefCalls, 1);
  assert.equal(childUnrefCalls, 1);
  assert.equal(abortController.signal.listenerCount, 0);
  assert.equal(taskkill.listenerCount("error"), 1);
  assert.equal(taskkill.listenerCount("close"), 1);
  assert.equal(child.listenerCount("error"), 1);
  assert.equal(child.listenerCount("close"), 1);

  taskkill.emit("error", new Error("late taskkill error"));
  child.emit("error", new Error("late child error"));
  taskkill.emit("close", 1);
  child.emit("close", 1);
  await flushMicrotasks();

  assert.equal(taskkill.listenerCount("error"), 0);
  assert.equal(taskkill.listenerCount("close"), 0);
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(timers.pendingCount, 0);
});

test("pasteText bounds drain cleanup when killing the taskkill helper throws", async () => {
  const abortController = createManualAbortController();
  const child = new EventEmitter();
  const taskkill = new EventEmitter();
  const spawned = createDeferred();
  const timers = createManualTimers();
  let spawnCalls = 0;
  let childUnrefCalls = 0;
  let helperKillCalls = 0;
  let helperUnrefCalls = 0;
  child.pid = 6464;
  child.kill = () => false;
  child.unref = () => {
    childUnrefCalls += 1;
  };
  taskkill.kill = () => {
    helperKillCalls += 1;
    throw new Error("helper kill failed");
  };
  taskkill.unref = () => {
    helperUnrefCalls += 1;
  };

  const observed = observePromise(pasteText("hello", {
    clipboard: { writeText() {} },
    signal: abortController.signal,
    wait: async () => {},
    platform: "win32",
    terminationTimeoutMs: 250,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    spawn: () => {
      spawnCalls += 1;
      if (spawnCalls === 1) {
        spawned.resolve();
        return child;
      }
      return taskkill;
    }
  }));

  await spawned.promise;
  abortController.abort();
  await flushMicrotasks();
  timers.fireNext();
  await observed.completion;

  assert.equal(observed.state, "rejected");
  assert.equal(helperKillCalls, 1);
  assert.equal(helperUnrefCalls, 1);
  assert.equal(childUnrefCalls, 1);
  assert.equal(abortController.signal.listenerCount, 0);
  assert.equal(taskkill.listenerCount("error"), 1);
  assert.equal(child.listenerCount("error"), 1);
  assert.equal(timers.pendingCount, 2);

  timers.fireAll();

  assert.equal(taskkill.listenerCount("error"), 0);
  assert.equal(taskkill.listenerCount("close"), 0);
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(timers.pendingCount, 0);
});

test("pasteText never reports success during abort error and close races", async () => {
  const controller = new AbortController();
  const child = new EventEmitter();
  const spawned = createDeferred();
  const fallback = createDeferred();
  const timers = createManualTimers();
  child.pid = 7272;
  child.kill = () => true;

  const observed = observePromise(pasteText("hello", {
    clipboard: { writeText() {} },
    signal: controller.signal,
    wait: async () => {},
    platform: "win32",
    killProcessTree: () => fallback.promise,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    spawn: () => {
      spawned.resolve();
      return child;
    }
  }));

  await spawned.promise;
  controller.abort();
  await flushMicrotasks();
  assert.equal(observed.state, "pending");
  child.emit("error", new Error("late child error"));
  child.emit("close", 0);
  await observed.completion;
  fallback.reject(new Error("late fallback failure"));
  await flushMicrotasks();

  assert.equal(observed.state, "rejected");
  assert.equal(observed.value.code, "paste_failed");
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(timers.pendingCount, 0);
});

test("pasteText rejects with clipboard_unavailable when clipboard is missing", async () => {
  await assert.rejects(
    pasteText("hello", { clipboard: null }),
    (error) => {
      assert.equal(error.code, "clipboard_unavailable");
      return true;
    }
  );
});

test("pasteText writes clipboard text before rejecting failed paste command", async () => {
  let clipboardText = "";
  const clipboard = {
    writeText(text) {
      clipboardText = text;
    }
  };
  const spawn = () => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit("close", 1));
    return child;
  };

  await assert.rejects(
    pasteText("hello", { clipboard, spawn }),
    (error) => {
      assert.equal(error.code, "paste_failed");
      return true;
    }
  );

  assert.equal(clipboardText, "hello");
});

test("pasteText rejects spawn errors with paste_failed", async () => {
  const clipboard = {
    writeText() {}
  };
  const spawn = () => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit("error", new Error("spawn failed")));
    return child;
  };

  await assert.rejects(
    pasteText("hello", { clipboard, spawn }),
    (error) => {
      assert.equal(error.code, "paste_failed");
      return true;
    }
  );
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function observePromise(promise) {
  const observed = {
    state: "pending",
    value: undefined,
    completion: null
  };
  observed.completion = promise.then(
    (value) => {
      observed.state = "fulfilled";
      observed.value = value;
    },
    (error) => {
      observed.state = "rejected";
      observed.value = error;
    }
  );
  return observed;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createManualTimers() {
  let nextId = 1;
  const timers = new Map();
  const delays = [];

  return {
    delays,
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, callback);
      delays.push(delay);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fireNext() {
      const [id, callback] = timers.entries().next().value || [];
      assert.ok(callback, "expected a pending termination timeout");
      timers.delete(id);
      callback();
    },
    fireAll() {
      let remaining = 20;
      while (timers.size && remaining > 0) {
        this.fireNext();
        remaining -= 1;
      }
      assert.equal(timers.size, 0, "manual timers should drain within the safety bound");
    },
    get pendingCount() {
      return timers.size;
    }
  };
}

function createManualAbortController() {
  let aborted = false;
  const listeners = new Map();
  const signal = {
    get aborted() {
      return aborted;
    },
    get listenerCount() {
      return listeners.size;
    },
    addEventListener(type, listener, options = {}) {
      if (type === "abort") listeners.set(listener, Boolean(options.once));
    },
    removeEventListener(type, listener) {
      if (type === "abort") listeners.delete(listener);
    }
  };

  return {
    signal,
    abort() {
      if (aborted) return;
      aborted = true;
      for (const [listener, once] of [...listeners]) {
        if (once) listeners.delete(listener);
        listener.call(signal, { type: "abort", target: signal });
      }
    }
  };
}
