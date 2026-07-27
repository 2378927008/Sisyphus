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
  let startRecordingPending = false;
  let stopRecordingPending = false;
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
    refreshLifecycleTimers(phase, updatedAt);
    broadcast();
    return getState();
  }

  async function start() {
    if (state.phase === "recording" || startRecordingPending || isBusyPhase(state.phase)) {
      return;
    }

    if (!isReadyToRecord()) {
      setPhase("error", {
        reason: "not_ready",
        message: "Local Flow is not ready to record."
      });
      return;
    }

    startRecordingPending = true;
    try {
      await startRecording();
    } finally {
      startRecordingPending = false;
    }
  }

  async function stop() {
    if (state.phase !== "recording" || stopRecordingPending) {
      return;
    }

    stopRecordingPending = true;
    try {
      await stopRecording();
    } finally {
      stopRecordingPending = false;
    }
  }

  async function cancel() {
    if (state.phase !== "starting" && state.phase !== "recording") {
      return;
    }

    requestRendererReset();
    setPhase("idle");
  }

  async function toggle() {
    if (state.phase === "recording") {
      await stop();
      return;
    }

    await start();
  }

  function handleRendererStatus(payload = {}) {
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
      requestRendererReset();
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
    handleRendererStatus
  };
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
