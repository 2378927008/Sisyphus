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
    launchAtLogin: "开机自启",
    startMinimizedToTray: "启动后最小化到托盘",
    settings: "设置",
    quit: "退出"
  },
  ja: {
    showMainWindow: "表示",
    startDictation: "音声入力を開始",
    stopDictation: "音声入力を停止",
    pauseShortcut: "ショートカットを一時停止",
    resumeShortcut: "ショートカットを再開",
    launchAtLogin: "ログイン時に起動",
    startMinimizedToTray: "起動時にトレイへ最小化",
    settings: "設定",
    quit: "終了"
  },
  ko: {
    showMainWindow: "표시",
    startDictation: "음성 입력 시작",
    stopDictation: "음성 입력 중지",
    pauseShortcut: "단축키 일시 중지",
    resumeShortcut: "단축키 다시 시작",
    launchAtLogin: "로그인 시 실행",
    startMinimizedToTray: "시작할 때 트레이로 최소화",
    settings: "설정",
    quit: "종료"
  },
  "zh-Hant": {
    showMainWindow: "顯示主視窗",
    startDictation: "開始語音輸入",
    stopDictation: "停止語音輸入",
    pauseShortcut: "暫停全域快捷鍵",
    resumeShortcut: "恢復全域快捷鍵",
    launchAtLogin: "登入時啟動",
    startMinimizedToTray: "啟動後最小化至系統匣",
    settings: "設定",
    quit: "結束"
  },
  fr: {
    showMainWindow: "Afficher",
    startDictation: "Démarrer la dictée",
    stopDictation: "Arrêter la dictée",
    pauseShortcut: "Suspendre le raccourci",
    resumeShortcut: "Réactiver le raccourci",
    launchAtLogin: "Lancer à la connexion",
    startMinimizedToTray: "Démarrer réduit dans la zone de notification",
    settings: "Paramètres",
    quit: "Quitter"
  },
  ru: {
    showMainWindow: "Показать",
    startDictation: "Начать диктовку",
    stopDictation: "Остановить диктовку",
    pauseShortcut: "Приостановить сочетание клавиш",
    resumeShortcut: "Возобновить сочетание клавиш",
    launchAtLogin: "Запускать при входе",
    startMinimizedToTray: "Запускать свёрнутым в область уведомлений",
    settings: "Настройки",
    quit: "Выход"
  },
  es: {
    showMainWindow: "Mostrar",
    startDictation: "Iniciar dictado",
    stopDictation: "Detener dictado",
    pauseShortcut: "Pausar atajo",
    resumeShortcut: "Reanudar atajo",
    launchAtLogin: "Iniciar al acceder",
    startMinimizedToTray: "Iniciar minimizado en la bandeja",
    settings: "Ajustes",
    quit: "Salir"
  }
};

const PHASE_LABELS = {
  en: {
    idle: "Idle",
    starting: "Starting",
    recording: "Recording",
    stopping: "Stopping",
    transcribing: "Transcribing",
    pasting: "Pasting",
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
    pasting: "正在粘贴",
    done: "已完成",
    warning: "需要确认",
    error: "错误"
  },
  ja: {
    idle: "待機中",
    starting: "開始中",
    recording: "録音中",
    stopping: "停止中",
    transcribing: "文字起こし中",
    pasting: "貼り付け中",
    done: "完了",
    warning: "要確認",
    error: "エラー"
  },
  ko: {
    idle: "대기 중",
    starting: "시작 중",
    recording: "녹음 중",
    stopping: "중지 중",
    transcribing: "받아쓰기 중",
    pasting: "붙여넣는 중",
    done: "완료",
    warning: "확인 필요",
    error: "오류"
  },
  "zh-Hant": {
    idle: "閒置",
    starting: "正在啟動",
    recording: "正在錄音",
    stopping: "正在停止",
    transcribing: "正在轉寫",
    pasting: "正在貼上",
    done: "已完成",
    warning: "需要確認",
    error: "錯誤"
  },
  fr: {
    idle: "Inactif",
    starting: "Démarrage",
    recording: "Enregistrement",
    stopping: "Arrêt",
    transcribing: "Transcription",
    pasting: "Collage",
    done: "Terminé",
    warning: "Attention requise",
    error: "Erreur"
  },
  ru: {
    idle: "Ожидание",
    starting: "Запуск",
    recording: "Запись",
    stopping: "Остановка",
    transcribing: "Распознавание",
    pasting: "Вставка",
    done: "Готово",
    warning: "Требуется внимание",
    error: "Ошибка"
  },
  es: {
    idle: "En espera",
    starting: "Iniciando",
    recording: "Grabando",
    stopping: "Deteniendo",
    transcribing: "Transcribiendo",
    pasting: "Pegando",
    done: "Completado",
    warning: "Requiere atención",
    error: "Error"
  }
};

const BACKGROUND_NOTICES = {
  en: "Local Flow is still running in the background. Use the tray icon to reopen it.",
  "zh-Hans": "Local Flow 仍在后台运行，可以通过托盘图标重新打开。",
  ja: "Local Flow はバックグラウンドで実行中です。トレイアイコンから再度開けます。",
  ko: "Local Flow가 백그라운드에서 실행 중입니다. 트레이 아이콘을 사용해 다시 열 수 있습니다.",
  "zh-Hant": "Local Flow 仍在背景執行，可透過系統匣圖示重新開啟。",
  fr: "Local Flow fonctionne toujours en arrière-plan. Utilisez l'icône de la zone de notification pour le rouvrir.",
  ru: "Local Flow продолжает работать в фоновом режиме. Откройте его снова через значок в области уведомлений.",
  es: "Local Flow sigue ejecutándose en segundo plano. Usa el icono de la bandeja para volver a abrirlo."
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

export function getBackgroundNotice(language = "en") {
  return BACKGROUND_NOTICES[language] || BACKGROUND_NOTICES.en;
}

function getLabels(labelSets, language) {
  return labelSets[language] || labelSets.en;
}
