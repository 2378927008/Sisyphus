const supportedPhases = new Set([
  "idle",
  "starting",
  "recording",
  "stopping",
  "transcribing",
  "polishing",
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
      polishing: "Polishing",
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
      polishing: "Improving the text.",
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
      raw_transcript_saved: "Raw transcript saved.",
      clipboard_unavailable: "Clipboard unavailable. Text saved.",
      paste_failed: "Paste failed. Text saved."
    },
    actions: {
      cancel: "Cancel recording",
      stop: "Stop recording",
      openMainWindow: "Open Local Flow"
    }
  },
  "zh-Hans": {
    titles: {
      idle: "Local Flow",
      starting: "正在启动",
      recording: "正在录音",
      stopping: "正在停止",
      transcribing: "正在转写",
      polishing: "正在润色",
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
      polishing: "正在优化文字",
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
      raw_transcript_saved: "原始转写已保存",
      clipboard_unavailable: "剪贴板不可用，文本已保存",
      paste_failed: "粘贴失败，文本已保存。"
    },
    actions: {
      cancel: "取消录音",
      stop: "停止录音",
      openMainWindow: "打开 Local Flow"
    }
  },
  ja: {
    titles: {
      idle: "Local Flow",
      starting: "録音を開始中",
      recording: "録音中",
      stopping: "停止中",
      transcribing: "文字起こし中",
      polishing: "文章を調整中",
      pasting: "貼り付け中",
      done: "入力完了",
      warning: "確認が必要です",
      error: "対応が必要です"
    },
    messages: {
      idle: "ショートカットで録音を開始または停止します。",
      starting: "マイクを準備しています。",
      recording: "もう一度ショートカットを押すと停止します。",
      stopping: "録音を終了しています。",
      transcribing: "音声をテキストに変換しています。",
      polishing: "テキストを整えています。",
      pasting: "現在のアプリに貼り付けています。",
      done: "テキストを入力しました。",
      warning: "Local Flow を開いて確認してください。",
      error: "Local Flow を開いて問題を解決してください。"
    },
    reasons: {
      not_ready: "セットアップが完了していません。設定を開いてください。",
      renderer_timeout: "録音が応答しませんでした。もう一度お試しください。",
      recording_failed: "録音に失敗しました。もう一度お試しください。",
      transcription_failed: "文字起こしに失敗しました。もう一度お試しください。",
      target_output_failed: "出力言語の処理に失敗しました。",
      raw_transcript_saved: "元の文字起こしを保存しました。",
      clipboard_unavailable: "クリップボードを使用できません。テキストを保存しました。",
      paste_failed: "貼り付けに失敗しました。テキストを保存しました。"
    },
    actions: {
      cancel: "録音をキャンセル",
      stop: "録音を停止",
      openMainWindow: "Local Flow を開く"
    }
  },
  ko: {
    titles: {
      idle: "Local Flow",
      starting: "녹음 시작 중",
      recording: "녹음 중",
      stopping: "중지 중",
      transcribing: "받아쓰기 중",
      polishing: "텍스트 다듬는 중",
      pasting: "붙여넣는 중",
      done: "입력 완료",
      warning: "확인 필요",
      error: "조치 필요"
    },
    messages: {
      idle: "단축키를 눌러 녹음을 시작하거나 중지하세요.",
      starting: "마이크를 준비하고 있습니다.",
      recording: "단축키를 다시 누르면 중지됩니다.",
      stopping: "녹음을 마무리하고 있습니다.",
      transcribing: "음성을 텍스트로 변환하고 있습니다.",
      polishing: "텍스트를 다듬고 있습니다.",
      pasting: "현재 앱에 붙여넣고 있습니다.",
      done: "텍스트를 입력했습니다.",
      warning: "Local Flow를 열어 확인하세요.",
      error: "Local Flow를 열어 문제를 해결하세요."
    },
    reasons: {
      not_ready: "설정이 준비되지 않았습니다. 설정을 여세요.",
      renderer_timeout: "녹음이 응답하지 않았습니다. 다시 시도하세요.",
      recording_failed: "녹음에 실패했습니다. 다시 시도하세요.",
      transcription_failed: "받아쓰기에 실패했습니다. 다시 시도하세요.",
      target_output_failed: "대상 언어 출력에 실패했습니다.",
      raw_transcript_saved: "원본 받아쓰기를 저장했습니다.",
      clipboard_unavailable: "클립보드를 사용할 수 없습니다. 텍스트를 저장했습니다.",
      paste_failed: "붙여넣기에 실패했습니다. 텍스트를 저장했습니다."
    },
    actions: {
      cancel: "녹음 취소",
      stop: "녹음 중지",
      openMainWindow: "Local Flow 열기"
    }
  },
  "zh-Hant": {
    titles: {
      idle: "Local Flow",
      starting: "正在啟動",
      recording: "正在錄音",
      stopping: "正在停止",
      transcribing: "正在轉寫",
      polishing: "正在潤飾",
      pasting: "正在貼上",
      done: "已輸入",
      warning: "需要確認",
      error: "需要處理"
    },
    messages: {
      idle: "按快捷鍵開始或停止錄音",
      starting: "正在準備麥克風",
      recording: "再次按快捷鍵停止",
      stopping: "正在結束錄音",
      transcribing: "正在將語音轉成文字",
      polishing: "正在優化文字",
      pasting: "正在貼到目前的應用程式",
      done: "文字已輸入",
      warning: "請開啟 Local Flow 查看",
      error: "請開啟 Local Flow 處理"
    },
    reasons: {
      not_ready: "錄音尚未準備好，請開啟設定",
      renderer_timeout: "錄音回應逾時，請重試",
      recording_failed: "錄音失敗，請重試",
      transcription_failed: "轉寫失敗，請重試",
      target_output_failed: "目標語言輸出失敗",
      raw_transcript_saved: "原始轉寫已儲存",
      clipboard_unavailable: "剪貼簿無法使用，文字已儲存",
      paste_failed: "貼上失敗，文字已儲存"
    },
    actions: {
      cancel: "取消錄音",
      stop: "停止錄音",
      openMainWindow: "開啟 Local Flow"
    }
  },
  fr: {
    titles: {
      idle: "Local Flow",
      starting: "Démarrage de l'enregistrement",
      recording: "Enregistrement",
      stopping: "Arrêt",
      transcribing: "Transcription",
      polishing: "Amélioration",
      pasting: "Collage",
      done: "Texte inséré",
      warning: "Vérification requise",
      error: "Action requise"
    },
    messages: {
      idle: "Utilisez le raccourci pour démarrer ou arrêter l'enregistrement.",
      starting: "Préparation du microphone.",
      recording: "Utilisez à nouveau le raccourci pour arrêter.",
      stopping: "Finalisation de l'enregistrement.",
      transcribing: "Conversion de la voix en texte.",
      polishing: "Amélioration du texte.",
      pasting: "Collage dans l'application active.",
      done: "Texte inséré.",
      warning: "Ouvrez Local Flow pour vérifier.",
      error: "Ouvrez Local Flow pour résoudre le problème."
    },
    reasons: {
      not_ready: "La configuration n'est pas prête. Ouvrez les paramètres.",
      renderer_timeout: "L'enregistrement ne répond pas. Réessayez.",
      recording_failed: "Échec de l'enregistrement. Réessayez.",
      transcription_failed: "Échec de la transcription. Réessayez.",
      target_output_failed: "Échec de la sortie dans la langue cible.",
      raw_transcript_saved: "La transcription brute a été enregistrée.",
      clipboard_unavailable: "Presse-papiers indisponible. Texte enregistré.",
      paste_failed: "Échec du collage. Texte enregistré."
    },
    actions: {
      cancel: "Annuler l'enregistrement",
      stop: "Arrêter l'enregistrement",
      openMainWindow: "Ouvrir Local Flow"
    }
  },
  ru: {
    titles: {
      idle: "Local Flow",
      starting: "Запуск записи",
      recording: "Запись",
      stopping: "Остановка",
      transcribing: "Распознавание",
      polishing: "Улучшение текста",
      pasting: "Вставка",
      done: "Текст вставлен",
      warning: "Нужна проверка",
      error: "Требуется действие"
    },
    messages: {
      idle: "Нажмите сочетание клавиш, чтобы начать или остановить запись.",
      starting: "Подготовка микрофона.",
      recording: "Нажмите сочетание клавиш ещё раз, чтобы остановить.",
      stopping: "Завершение записи.",
      transcribing: "Преобразование речи в текст.",
      polishing: "Улучшение текста.",
      pasting: "Вставка в активное приложение.",
      done: "Текст вставлен.",
      warning: "Откройте Local Flow для проверки.",
      error: "Откройте Local Flow, чтобы устранить проблему."
    },
    reasons: {
      not_ready: "Настройка не завершена. Откройте параметры.",
      renderer_timeout: "Запись не отвечает. Повторите попытку.",
      recording_failed: "Не удалось записать звук. Повторите попытку.",
      transcription_failed: "Не удалось распознать речь. Повторите попытку.",
      target_output_failed: "Не удалось подготовить текст на целевом языке.",
      raw_transcript_saved: "Исходная расшифровка сохранена.",
      clipboard_unavailable: "Буфер обмена недоступен. Текст сохранён.",
      paste_failed: "Не удалось вставить текст. Текст сохранён."
    },
    actions: {
      cancel: "Отменить запись",
      stop: "Остановить запись",
      openMainWindow: "Открыть Local Flow"
    }
  },
  es: {
    titles: {
      idle: "Local Flow",
      starting: "Iniciando grabación",
      recording: "Grabando",
      stopping: "Deteniendo",
      transcribing: "Transcribiendo",
      polishing: "Mejorando texto",
      pasting: "Pegando",
      done: "Texto insertado",
      warning: "Revisión necesaria",
      error: "Acción necesaria"
    },
    messages: {
      idle: "Usa el atajo para iniciar o detener la grabación.",
      starting: "Preparando el micrófono.",
      recording: "Usa de nuevo el atajo para detener.",
      stopping: "Finalizando la grabación.",
      transcribing: "Convirtiendo voz en texto.",
      polishing: "Mejorando el texto.",
      pasting: "Pegando en la aplicación activa.",
      done: "Texto insertado.",
      warning: "Abre Local Flow para revisar.",
      error: "Abre Local Flow para resolver el problema."
    },
    reasons: {
      not_ready: "La configuración no está lista. Abre los ajustes.",
      renderer_timeout: "La grabación no respondió. Inténtalo de nuevo.",
      recording_failed: "La grabación falló. Inténtalo de nuevo.",
      transcription_failed: "La transcripción falló. Inténtalo de nuevo.",
      target_output_failed: "Falló la salida en el idioma de destino.",
      raw_transcript_saved: "Se guardó la transcripción original.",
      clipboard_unavailable: "El portapapeles no está disponible. Texto guardado.",
      paste_failed: "No se pudo pegar. Texto guardado."
    },
    actions: {
      cancel: "Cancelar grabación",
      stop: "Detener grabación",
      openMainWindow: "Abrir Local Flow"
    }
  }
};

export function getHudViewState(state = {}, options = {}) {
  const phase = supportedPhases.has(state.phase) ? state.phase : "idle";
  const language = Object.hasOwn(hudLabels, state.language) ? state.language : "en";
  const labels = hudLabels[language];
  const isTerminalProblemPhase = phase === "warning" || phase === "error";
  const reasonMessage = isTerminalProblemPhase ? labels.reasons[state.reason] || "" : "";
  const message = reasonMessage || labels.messages[phase] || labels.messages.idle;
  const elapsed = phase === "recording" ? getRecordingElapsed(state, options) : "";
  const showRecordingActions = phase === "starting" || phase === "recording";
  const showOpenMainWindow = phase === "warning" || phase === "error";

  return {
    phase,
    language,
    title: labels.titles[phase] || labels.titles.idle,
    message,
    elapsed,
    actions: {
      cancel: {
        visible: showRecordingActions,
        disabled: false,
        label: labels.actions.cancel
      },
      stop: {
        visible: showRecordingActions,
        disabled: phase !== "recording",
        label: labels.actions.stop
      },
      openMainWindow: {
        visible: showOpenMainWindow,
        disabled: false,
        label: labels.actions.openMainWindow
      }
    }
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
