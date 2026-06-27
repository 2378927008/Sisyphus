const MENU_LABELS = {
  en: {
    showMainWindow: "Show",
    startDictation: "Start dictation",
    stopDictation: "Stop dictation",
    pauseShortcut: "Pause shortcut",
    resumeShortcut: "Resume shortcut",
    launchAtLogin: "Launch at login",
    startMinimizedToTray: "Start minimized to tray",
    settings: "Settings",
    quit: "Quit"
  },
  "zh-Hans": {
    showMainWindow: "显示主窗口",
    startDictation: "开始语音输入",
    stopDictation: "停止语音输入",
    pauseShortcut: "暂停全局快捷键",
    resumeShortcut: "恢复全局快捷键",
    launchAtLogin: "开机自动启动",
    startMinimizedToTray: "启动后最小化到托盘",
    settings: "设置",
    quit: "退出"
  }
};

const PHASE_LABELS = {
  en: {
    idle: "Idle",
    starting: "Starting",
    recording: "Recording",
    stopping: "Stopping",
    transcribing: "Transcribing",
    done: "Done",
    warning: "Warning",
    error: "Error"
  },
  "zh-Hans": {
    idle: "空闲",
    starting: "正在启动",
    recording: "正在录音",
    stopping: "正在停止",
    transcribing: "正在转写",
    done: "完成",
    warning: "警告",
    error: "错误"
  }
};

const STOP_PHASES = new Set(["recording", "starting"]);

export function buildTrayMenuTemplate({
  language = "en",
  state = {},
  settings = {},
  handlers = {}
} = {}) {
  const labels = getLabels(MENU_LABELS, language);
  const dictationLabel = STOP_PHASES.has(state.phase)
    ? labels.stopDictation
    : labels.startDictation;
  const shortcutLabel = settings.globalShortcutPaused
    ? labels.resumeShortcut
    : labels.pauseShortcut;

  return [
    {
      label: labels.showMainWindow,
      click: handlers.showMainWindow
    },
    {
      label: dictationLabel,
      click: handlers.toggleDictation
    },
    {
      label: shortcutLabel,
      click: handlers.toggleShortcutPaused
    },
    {
      type: "separator"
    },
    {
      label: labels.launchAtLogin,
      type: "checkbox",
      checked: Boolean(settings.launchAtLogin),
      click: handlers.toggleLaunchAtLogin
    },
    {
      label: labels.startMinimizedToTray,
      type: "checkbox",
      checked: Boolean(settings.startMinimizedToTray),
      click: handlers.toggleStartMinimized
    },
    {
      type: "separator"
    },
    {
      label: labels.settings,
      click: handlers.openSettings
    },
    {
      label: labels.quit,
      click: handlers.quit
    }
  ];
}

export function getTrayTooltip({ language = "en", state = {} } = {}) {
  const labels = getLabels(PHASE_LABELS, language);
  const phaseLabel = labels[state.phase] || labels.idle;

  return `Local Flow - ${phaseLabel}`;
}

function getLabels(labelSets, language) {
  return labelSets[language] || labelSets.en;
}
