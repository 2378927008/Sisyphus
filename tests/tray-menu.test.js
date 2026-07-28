import test from "node:test";
import assert from "node:assert/strict";
import { buildTrayMenuTemplate, getBackgroundNotice, getTrayTooltip } from "../src/main/tray-menu.js";

const supportedTrayLanguages = {
  en: {
    show: "Show",
    recording: "Recording",
    polishing: "Polishing",
    notice: "Local Flow is still running in the background. Use the tray icon to reopen it."
  },
  "zh-Hans": {
    show: "显示主窗口",
    recording: "正在录音",
    polishing: "正在润色",
    notice: "Local Flow 仍在后台运行，可以通过托盘图标重新打开。"
  },
  ja: {
    show: "表示",
    recording: "録音中",
    polishing: "文章を調整中",
    notice: "Local Flow はバックグラウンドで実行中です。トレイアイコンから再度開けます。"
  },
  ko: {
    show: "표시",
    recording: "녹음 중",
    polishing: "텍스트 다듬는 중",
    notice: "Local Flow가 백그라운드에서 실행 중입니다. 트레이 아이콘을 사용해 다시 열 수 있습니다."
  },
  "zh-Hant": {
    show: "顯示主視窗",
    recording: "正在錄音",
    polishing: "正在潤飾",
    notice: "Local Flow 仍在背景執行，可透過系統匣圖示重新開啟。"
  },
  fr: {
    show: "Afficher",
    recording: "Enregistrement",
    polishing: "Amélioration",
    notice: "Local Flow fonctionne toujours en arrière-plan. Utilisez l'icône de la zone de notification pour le rouvrir."
  },
  ru: {
    show: "Показать",
    recording: "Запись",
    polishing: "Улучшение текста",
    notice: "Local Flow продолжает работать в фоновом режиме. Откройте его снова через значок в области уведомлений."
  },
  es: {
    show: "Mostrar",
    recording: "Grabando",
    polishing: "Mejorando texto",
    notice: "Local Flow sigue ejecutándose en segundo plano. Usa el icono de la bandeja para volver a abrirlo."
  }
};

test("background notice is localized for every supported interface language", () => {
  for (const [language, expected] of Object.entries(supportedTrayLanguages)) {
    assert.equal(getBackgroundNotice(language), expected.notice, language);
  }
  assert.equal(getBackgroundNotice("unknown"), supportedTrayLanguages.en.notice);
});

test("buildTrayMenuTemplate returns product tray actions in order", () => {
  const handlers = {
    showMainWindow: () => {},
    toggleDictation: () => {},
    toggleShortcutPaused: () => {},
    toggleLaunchAtLogin: () => {},
    toggleStartMinimized: () => {},
    openSettings: () => {},
    quit: () => {}
  };

  const template = buildTrayMenuTemplate({ handlers });

  assert.deepEqual(template.map(getVisibleMenuText), [
    "Show",
    "Start dictation",
    "Pause shortcut",
    "separator",
    "Launch at login",
    "Start minimized to tray",
    "separator",
    "Settings",
    "Quit"
  ]);
  assert.equal(template[0].click, handlers.showMainWindow);
  assert.equal(template[1].click, handlers.toggleDictation);
  assert.equal(template[2].click, handlers.toggleShortcutPaused);
  assert.equal(template[4].click, handlers.toggleLaunchAtLogin);
  assert.equal(template[5].click, handlers.toggleStartMinimized);
  assert.equal(template[7].click, handlers.openSettings);
  assert.equal(template[8].click, handlers.quit);
});

test("buildTrayMenuTemplate reflects recording and paused state", () => {
  const template = buildTrayMenuTemplate({
    state: { phase: "recording" },
    settings: { globalShortcutPaused: true }
  });
  const chineseTemplate = buildTrayMenuTemplate({
    language: "zh-Hans",
    state: { phase: "recording" },
    settings: { globalShortcutPaused: true }
  });

  assert.equal(template[1].label, "Stop dictation");
  assert.equal(template[2].label, "Resume shortcut");
  assert.equal(chineseTemplate[1].label, "停止语音输入");
  assert.equal(chineseTemplate[2].label, "恢复全局快捷键");
});

test("tray dictation action is disabled with an accurate label during non-cancellable work", () => {
  for (const phase of ["stopping", "transcribing", "polishing", "pasting"]) {
    const item = buildTrayMenuTemplate({ state: { phase } })[1];
    assert.equal(item.label, "Dictation in progress", phase);
    assert.equal(item.enabled, false, phase);
  }
});

test("buildTrayMenuTemplate marks startup checkboxes from settings", () => {
  const template = buildTrayMenuTemplate({
    settings: {
      launchAtLogin: true,
      startMinimizedToTray: true
    }
  });

  assert.equal(template[4].type, "checkbox");
  assert.equal(template[4].checked, true);
  assert.equal(template[5].type, "checkbox");
  assert.equal(template[5].checked, true);
});

test("buildTrayMenuTemplate returns Simplified Chinese labels", () => {
  const template = buildTrayMenuTemplate({ language: "zh-Hans" });

  assert.deepEqual(template.map(getVisibleMenuText), [
    "显示主窗口",
    "开始语音输入",
    "暂停全局快捷键",
    "separator",
    "开机自启",
    "启动后最小化到托盘",
    "separator",
    "设置",
    "退出"
  ]);
});

test("tray menu selects every exact supported interface language and only unknown codes fall back", () => {
  for (const [language, expected] of Object.entries(supportedTrayLanguages)) {
    assert.equal(buildTrayMenuTemplate({ language })[0].label, expected.show, language);
  }
  assert.equal(buildTrayMenuTemplate({ language: "unknown" })[0].label, supportedTrayLanguages.en.show);
});

function getVisibleMenuText(item) {
  return item.type === "separator" ? item.type : item.label;
}

test("getTrayTooltip returns localized phase status and fallback", () => {
  assert.equal(getTrayTooltip({ state: { phase: "recording" } }), "Local Flow - Recording");
  assert.equal(getTrayTooltip({ state: { phase: "pasting" } }), "Local Flow - Pasting");

  const chinesePhaseTooltips = [
    ["idle", "Local Flow - 空闲"],
    ["starting", "Local Flow - 正在启动"],
    ["recording", "Local Flow - 正在录音"],
    ["stopping", "Local Flow - 正在停止"],
    ["transcribing", "Local Flow - 正在转写"],
    ["polishing", "Local Flow - 正在润色"],
    ["pasting", "Local Flow - 正在粘贴"],
    ["done", "Local Flow - 已完成"],
    ["warning", "Local Flow - 需要确认"],
    ["error", "Local Flow - 错误"]
  ];

  for (const [phase, tooltip] of chinesePhaseTooltips) {
    assert.equal(getTrayTooltip({
      language: "zh-Hans",
      state: { phase }
    }), tooltip);
  }

  assert.equal(getTrayTooltip({
    language: "unknown",
    state: { phase: "unknown" }
  }), "Local Flow - Idle");
});

test("tray tooltip selects every exact supported interface language", () => {
  for (const [language, expected] of Object.entries(supportedTrayLanguages)) {
    assert.equal(
      getTrayTooltip({ language, state: { phase: "recording" } }),
      `Local Flow - ${expected.recording}`,
      language
    );
    assert.equal(
      getTrayTooltip({ language, state: { phase: "polishing" } }),
      `Local Flow - ${expected.polishing}`,
      language
    );
  }
});
