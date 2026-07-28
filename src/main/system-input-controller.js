const validPhases = new Set([
  "idle",
  "starting",
  "recording",
  "stopping",
  "transcribing",
  "polishing",
  "pasting",
  "done",
  "error",
  "warning"
]);

const terminalPhases = new Set(["done", "error", "warning"]);

export function createSystemInputController({
  sendToMain = () => {},
  sendToHud = () => {},
  startRecording = async () => {},
  stopRecording = async () => {},
  isReadyToRecord = () => true,
  requestRendererReset = () => {},
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  commandTimeoutMs = 8000,
  terminalAutoIdleMs = 2500,
  now = () => new Date().toISOString()
} = {}) {
  let state = {
    phase: "idle",
    message: "",
    reason: "",
    updatedAt: now()
  };
  let startRecordingPendingOperationId = null;
  let stopRecordingPendingOperationId = null;
  let nextOperationId = 1;
  let activeOperationId = null;
  let commandTimeout = null;
  let terminalAutoIdleTimeout = null;

  function getState() {
    return { ...state };
  }

  function setPhase(phase, patch = {}) {
    if (!validPhases.has(phase)) {
      throw new Error(`Unknown system input phase: ${phase}`);
    }
    const previousPhase = state.phase;
    const previousRecordingStartedAt = state.recordingStartedAt;
    const updatedAt = now();
    const hasMessage = Object.prototype.hasOwnProperty.call(patch, "message");
    const hasReason = Object.prototype.hasOwnProperty.call(patch, "reason");
    const hasRecordingStartedAt = Object.prototype.hasOwnProperty.call(patch, "recordingStartedAt");
    const hasOperationId = Object.prototype.hasOwnProperty.call(patch, "operationId");
    state = {
      ...state,
      ...patch,
      message: hasMessage ? patch.message : "",
      reason: hasReason ? patch.reason : "",
      phase,
      updatedAt
    };
    if (phase === "recording" && !hasRecordingStartedAt) {
      state.recordingStartedAt =
        previousPhase === "recording" && previousRecordingStartedAt ? previousRecordingStartedAt : updatedAt;
    }
    if (phase !== "recording" && !hasRecordingStartedAt) {
      delete state.recordingStartedAt;
    }
    if ((phase === "idle" || hasOperationId && patch.operationId === undefined)) {
      delete state.operationId;
    }
    if (phase === "idle" || terminalPhases.has(phase)) {
      activeOperationId = null;
    }
    refreshLifecycleTimers(phase, updatedAt);
    broadcast();
    return getState();
  }

  async function start() {
    if (
      state.phase === "recording" ||
      startRecordingPendingOperationId !== null ||
      isBusyPhase(state.phase)
    ) {
      return;
    }

    if (!isReadyToRecord()) {
      setPhase("error", {
        reason: "not_ready",
        message: "Local Flow is not ready to record."
      });
      return;
    }

    const operationId = nextOperationId;
    nextOperationId += 1;
    activeOperationId = operationId;
    setPhase("starting", {
      operationId,
      message: "Starting recording..."
    });
    startRecordingPendingOperationId = operationId;
    try {
      await startRecording({ operationId });
    } finally {
      if (startRecordingPendingOperationId === operationId) {
        startRecordingPendingOperationId = null;
      }
    }
  }

  async function stop() {
    if (state.phase !== "recording" || stopRecordingPendingOperationId !== null) {
      return;
    }

    const operationId = activeOperationId;
    if (!isValidOperationId(operationId)) {
      return;
    }

    setPhase("stopping", {
      operationId,
      message: "Stopping recording..."
    });
    stopRecordingPendingOperationId = operationId;
    try {
      await stopRecording({ operationId });
    } finally {
      if (stopRecordingPendingOperationId === operationId) {
        stopRecordingPendingOperationId = null;
      }
    }
  }

  async function cancel() {
    if (state.phase !== "starting" && state.phase !== "recording") {
      return;
    }

    const operationId = activeOperationId;
    if (!isValidOperationId(operationId)) {
      return;
    }

    activeOperationId = null;
    if (startRecordingPendingOperationId === operationId) {
      startRecordingPendingOperationId = null;
    }
    requestRendererReset({ operationId });
    setPhase("idle", { operationId: undefined });
  }

  async function toggle() {
    if (state.phase === "recording") {
      await stop();
      return;
    }

    await start();
  }

  function handleRendererStatus(payload = {}) {
    if (
      !isValidOperationId(activeOperationId) ||
      payload.operationId !== activeOperationId
    ) {
      return false;
    }

    const phase = normalizeRendererPhase(payload.phase);
    setPhase(phase, {
      operationId: activeOperationId,
      message: payload.message || "",
      reason: payload.reason || ""
    });
    return true;
  }

  function handleSystemStatus(payload = {}) {
    const phase = normalizeRendererPhase(payload.phase);
    setPhase(phase, {
      message: payload.message || "",
      reason: payload.reason || ""
    });
  }

  function broadcast() {
    const snapshot = getState();
    sendToMain(snapshot);
    sendToHud(snapshot);
  }

  function refreshLifecycleTimers(phase, updatedAt) {
    if (phase === "starting" || phase === "stopping") {
      scheduleCommandTimeout(phase, updatedAt);
    } else {
      clearCommandTimeout();
    }

    if (terminalPhases.has(phase)) {
      scheduleTerminalAutoIdle(phase, updatedAt);
    } else {
      clearTerminalAutoIdleTimeout();
    }
  }

  function scheduleCommandTimeout(phase, updatedAt) {
    clearCommandTimeout();
    commandTimeout = setTimeoutImpl(() => {
      if (state.phase !== phase || state.updatedAt !== updatedAt) {
        return;
      }
      commandTimeout = null;
      const operationId = activeOperationId;
      activeOperationId = null;
      requestRendererReset(
        isValidOperationId(operationId) ? { operationId } : undefined
      );
      setPhase("error", {
        reason: "renderer_timeout",
        message: phase === "starting" ? "Recording did not start." : "Recording did not stop."
      });
    }, commandTimeoutMs);
    unrefTimeout(commandTimeout);
  }

  function clearCommandTimeout() {
    if (commandTimeout === null) {
      return;
    }
    clearTimeoutImpl(commandTimeout);
    commandTimeout = null;
  }

  function scheduleTerminalAutoIdle(phase, updatedAt) {
    clearTerminalAutoIdleTimeout();
    terminalAutoIdleTimeout = setTimeoutImpl(() => {
      terminalAutoIdleTimeout = null;
      if (state.phase === phase && state.updatedAt === updatedAt) {
        setPhase("idle");
      }
    }, terminalAutoIdleMs);
    unrefTimeout(terminalAutoIdleTimeout);
  }

  function clearTerminalAutoIdleTimeout() {
    if (terminalAutoIdleTimeout === null) {
      return;
    }
    clearTimeoutImpl(terminalAutoIdleTimeout);
    terminalAutoIdleTimeout = null;
  }

  return {
    getState,
    setPhase,
    start,
    stop,
    cancel,
    toggle,
    handleRendererStatus,
    handleSystemStatus
  };
}

function isValidOperationId(operationId) {
  return Number.isSafeInteger(operationId) && operationId > 0;
}

function normalizeRendererPhase(phase) {
  if (phase === "starting") return "starting";
  if (phase === "recording") return "recording";
  if (phase === "stopping") return "stopping";
  if (phase === "done") return "done";
  if (phase === "error") return "error";
  if (phase === "warning") return "warning";
  if (phase === "pasting") return "pasting";
  if (phase === "transcribing") return "transcribing";
  if (phase === "polishing") return "polishing";
  return "idle";
}

function isBusyPhase(phase) {
  return (
    phase === "starting" ||
    phase === "stopping" ||
    phase === "transcribing" ||
    phase === "polishing" ||
    phase === "pasting"
  );
}

function unrefTimeout(timeout) {
  if (timeout && typeof timeout.unref === "function") {
    timeout.unref();
  }
}
