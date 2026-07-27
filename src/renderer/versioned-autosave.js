function noop() {}

function saveFailure(result) {
  const candidateReason = typeof result?.reason === "string" ? result.reason.trim() : "";
  const error = new Error("history_save_failed");
  error.name = "HistorySaveError";
  error.code = "history_save_failed";
  error.reason = /^[a-z][a-z0-9_]{0,63}$/.test(candidateReason) ? candidateReason : "save_failed";
  return error;
}

export function createVersionedAutosave({
  delayMs = 450,
  save,
  onState = noop,
  onCommit = noop,
  setTimeout: scheduleTimer = globalThis.setTimeout,
  clearTimeout: cancelTimer = globalThis.clearTimeout
} = {}) {
  if (typeof save !== "function") throw new TypeError("save must be a function");

  let timer = null;
  let pending = null;
  let version = 0;
  let cancelledThrough = 0;
  let chain = Promise.resolve();
  let latestOutcome = { ok: true, version: 0 };

  function current(request) {
    return request.version === version && request.version > cancelledThrough;
  }

  function emit(phase, request, error) {
    if (!current(request)) return;
    onState({ phase, id: request.id, text: request.text, version: request.version, ...(error ? { error } : {}) });
  }

  async function run(request) {
    if (!current(request)) {
      return { ok: false, cancelled: true, ...request };
    }
    emit("saving", request);
    let result;
    try {
      result = await save({ id: request.id, text: request.text, version: request.version });
      if (result && typeof result === "object" && result.ok === false) {
        throw saveFailure(result);
      }
    } catch (error) {
      const outcome = { ok: false, ...request, error };
      if (request.version === version) latestOutcome = outcome;
      emit("error", request, error);
      return outcome;
    }

    const outcome = { ok: true, ...request, result };
    try {
      onCommit({ id: request.id, text: request.text, version: request.version, result });
    } catch {
      // Persistence already succeeded; observer failures cannot change that fact.
    }
    if (request.version === version) latestOutcome = outcome;
    emit("saved", request);
    return outcome;
  }

  function queuePending() {
    timer = null;
    const request = pending;
    pending = null;
    if (!request || !current(request)) return;
    chain = chain.then(() => run(request), () => run(request));
  }

  function schedule({ id, text }) {
    version += 1;
    const request = { id, text, version };
    pending = request;
    if (timer !== null) cancelTimer(timer);
    timer = scheduleTimer(queuePending, Math.max(0, Number(delayMs) || 0));
    emit("pending", request);
    return request.version;
  }

  async function flush() {
    while (true) {
      if (timer !== null) {
        cancelTimer(timer);
        queuePending();
      }

      const observedChain = chain;
      await observedChain;
      if (timer === null && observedChain === chain) return latestOutcome;
    }
  }

  function cancelPending() {
    if (timer !== null) cancelTimer(timer);
    timer = null;
    pending = null;
    cancelledThrough = version;
  }

  function cancel() {
    cancelPending();
  }

  function replace({ id, text }) {
    cancelPending();
    version += 1;
    const request = { id, text, version };
    latestOutcome = { ok: false, pending: true, ...request };
    emit("pending", request);
    chain = chain.then(() => run(request), () => run(request));
    return chain;
  }

  return { schedule, flush, cancel, replace };
}
