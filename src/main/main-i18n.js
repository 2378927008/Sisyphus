const mainWindowLoadFailures = {
  en: {
    message: "Local Flow could not load its main window. You can exit, or keep it running in the background and reopen it later.",
    buttons: ["Exit", "Keep running in background"]
  },
  "zh-Hans": {
    message: "Local Flow 主窗口加载失败。可以退出应用，或继续在后台运行并稍后重新打开。",
    buttons: ["退出", "继续在后台"]
  },
  ja: {
    message: "Local Flow のメイン画面を読み込めませんでした。終了するか、バックグラウンドで実行して後で開き直せます。",
    buttons: ["終了", "バックグラウンドで続行"]
  },
  ko: {
    message: "Local Flow 기본 창을 불러오지 못했습니다. 종료하거나 백그라운드에서 계속 실행한 뒤 나중에 다시 열 수 있습니다.",
    buttons: ["종료", "백그라운드에서 계속"]
  },
  "zh-Hant": {
    message: "Local Flow 主視窗載入失敗。您可以結束應用程式，或繼續在背景執行並稍後重新開啟。",
    buttons: ["結束", "繼續在背景執行"]
  },
  fr: {
    message: "Local Flow n'a pas pu charger sa fenêtre principale. Vous pouvez quitter ou le laisser fonctionner en arrière-plan et le rouvrir plus tard.",
    buttons: ["Quitter", "Continuer en arrière-plan"]
  },
  ru: {
    message: "Local Flow не удалось загрузить главное окно. Можно выйти или оставить приложение в фоне и открыть его позже.",
    buttons: ["Выйти", "Продолжить в фоне"]
  },
  es: {
    message: "Local Flow no pudo cargar la ventana principal. Puedes salir o dejarlo en segundo plano y volver a abrirlo más tarde.",
    buttons: ["Salir", "Continuar en segundo plano"]
  }
};

const startupFailures = {
  en: ["Local Flow could not start. Close the app and try again.", "Close"],
  "zh-Hans": ["Local Flow 无法启动。请关闭应用后重试。", "关闭"],
  ja: ["Local Flow を起動できませんでした。アプリを閉じて再試行してください。", "閉じる"],
  ko: ["Local Flow를 시작할 수 없습니다. 앱을 닫고 다시 시도하세요.", "닫기"],
  "zh-Hant": ["Local Flow 無法啟動。請關閉應用程式後重試。", "關閉"],
  fr: ["Local Flow n'a pas pu démarrer. Fermez l'application et réessayez.", "Fermer"],
  ru: ["Не удалось запустить Local Flow. Закройте приложение и повторите попытку.", "Закрыть"],
  es: ["Local Flow no pudo iniciarse. Cierra la aplicación y vuelve a intentarlo.", "Cerrar"]
};

export function getMainWindowLoadFailureCopy(language) {
  return mainWindowLoadFailures[language] || mainWindowLoadFailures.en;
}

export function getStartupFailureCopy(language) {
  const [message, button] = startupFailures[language] || startupFailures.en;
  return { message, button };
}
