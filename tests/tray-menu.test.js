import test from "node:test";
import assert from "node:assert/strict";
import { buildTrayMenuTemplate, getTrayTooltip } from "../src/main/tray-menu.js";

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
