const supportedPhases = new Set([
  "idle",
  "starting",
  "recording",
  "stopping",
  "transcribing",
  "pasting",
  "done",
  "warning",
  "error"
]);

const hudLabels = {
  en: {
    titles: {
      idle: "Local Flow",
      starting: "Starting recording",
      recording: "Recording",
      stopping: "Stopping",
      transcribing: "Transcribing",
      pasting: "Pasting",
      done: "Inserted",
      warning: "Needs review",
      error: "Needs attention"
    },
    messages: {
      idle: "Press shortcut to start or stop recording.",
      starting: "Preparing microphone.",
      recording: "Press shortcut again to stop.",
      stopping: "Finishing recording.",
      transcribing: "Turning speech into text.",
      pasting: "Pasting into the active app.",
      done: "Text inserted.",
      warning: "Open Local Flow to review.",
      error: "Open Local Flow to fix the issue."
    },
    reasons: {
      not_ready: "Setup is not ready. Open settings.",
      renderer_timeout: "Recording did not respond. Try again.",
      recording_failed: "Recording failed. Try again.",
      transcription_failed: "Transcription failed. Try again.",
      target_output_failed: "Target language output failed.",
      clipboard_unavailable: "Clipboard unavailable. Text saved.",
      paste_failed: "Paste failed. Text saved."
    }
  },
  "zh-Hans": {
    titles: {
      idle: "Local Flow",
      starting: "正在启动",
      recording: "正在录音",
      stopping: "正在停止",
      transcribing: "正在转写",
      pasting: "正在粘贴",
      done: "已输入",
      warning: "需要确认",
      error: "需要处理"
    },
    messages: {
      idle: "按快捷键开始或停止录音",
      starting: "正在准备麦克风",
      recording: "再次按快捷键停止",
      stopping: "正在结束录音",
      transcribing: "正在将语音转成文字",
      pasting: "正在粘贴到当前应用",
      done: "文本已输入",
      warning: "请打开 Local Flow 查看",
      error: "请打开 Local Flow 处理"
    },
    reasons: {
      not_ready: "录音尚未准备好，请打开设置",
      renderer_timeout: "录音响应超时，请重试",
      recording_failed: "录音失败，请重试",
      transcription_failed: "转写失败，请重试",
      target_output_failed: "目标语言输出失败",
      clipboard_unavailable: "剪贴板不可用，文本已保存",
      paste_failed: "粘贴失败，文本已保存。"
    }
  }
};

export function getHudViewState(state = {}, options = {}) {
  const phase = supportedPhases.has(state.phase) ? state.phase : "idle";
  const language = state.language === "en" ? "en" : "zh-Hans";
  const labels = hudLabels[language];
  const reasonMessage = phase === "warning" || phase === "error" ? labels.reasons[state.reason] || "" : "";
  const message = reasonMessage || getSafeStateMessage(state.message) || labels.messages[phase] || labels.messages.idle;
  const elapsed = phase === "recording" ? getRecordingElapsed(state, options) : "";

  return {
    phase,
    title: labels.titles[phase] || labels.titles.idle,
    message,
    elapsed
  };
}

export function formatElapsed(milliseconds) {
  const numericMilliseconds = Number(milliseconds);
  const safeMilliseconds = Number.isFinite(numericMilliseconds) ? Math.max(0, numericMilliseconds) : 0;
  const totalSeconds = Math.floor(safeMilliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getRecordingElapsed(state, options) {
  const startedAtMs = Date.parse(state.recordingStartedAt || state.updatedAt || "");
  if (!Number.isFinite(startedAtMs)) {
    return "00:00";
  }

  const providedNowMs = Number(options.nowMs);
  const nowMs = Number.isFinite(providedNowMs) ? providedNowMs : Date.now();
  return formatElapsed(nowMs - startedAtMs);
}

function getSafeStateMessage(message) {
  if (typeof message !== "string") {
    return "";
  }

  const value = message.trim();
  if (!value || containsUnsafeDiagnostic(value)) {
    return "";
  }

  return limitHudText(value);
}

function containsUnsafeDiagnostic(value) {
  return (
    /[A-Za-z]:[\\/]/.test(value) ||
    /\\\\[^\\/\s]+[\\/][^\\/\s]+/.test(value) ||
    /(^|\s)\/[^\s/]+\/\S*/.test(value) ||
    /(^|[\s"'`(])(?:\.{1,2}[\\/])?(?:vendor|vendors|model|models)[\\/]\S+/i.test(value) ||
    /\.(?:gguf|bin|exe)\b/i.test(value) ||
    /\b(?:llama-cli|whisper-cli)\b/i.test(value) ||
    /\bspawn\b/i.test(value) ||
    /\bENOENT\b/i.test(value) ||
    /\bstack trace\b/i.test(value) ||
    /^\s*at\s+\S+/im.test(value)
  );
}

function limitHudText(text) {
  const value = String(text || "");
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}
