const validPhases = new Set(["idle", "recording", "transcribing", "pasting", "done", "error"]);

export function createSystemInputController({
  sendToMain = () => {},
  sendToHud = () => {},
  startRecording = async () => {},
  stopRecording = async () => {},
  isReadyToRecord = () => true
} = {}) {
  let state = {
    phase: "idle",
    message: "",
    reason: "",
    updatedAt: new Date().toISOString()
  };

  function getState() {
    return { ...state };
  }

  function setPhase(phase, patch = {}) {
    if (!validPhases.has(phase)) {
      throw new Error(`Unknown system input phase: ${phase}`);
    }
    state = {
      ...state,
      ...patch,
      phase,
      updatedAt: new Date().toISOString()
    };
    broadcast();
    return getState();
  }

  async function toggle() {
    if (state.phase === "recording") {
      await stopRecording();
      return;
    }

    if (!isReadyToRecord()) {
      setPhase("error", {
        reason: "not_ready",
        message: "Local Flow is not ready to record."
      });
      return;
    }

    await startRecording();
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

  return {
    getState,
    setPhase,
    toggle,
    handleRendererStatus
  };
}

function normalizeRendererPhase(phase) {
  if (phase === "done") return "done";
  if (phase === "error") return "error";
  if (phase === "pasting") return "pasting";
  if (phase === "transcribing" || phase === "polishing") return "transcribing";
  return "idle";
}
