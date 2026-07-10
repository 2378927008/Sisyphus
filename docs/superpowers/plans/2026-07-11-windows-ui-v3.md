# Windows UI V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Local Flow Windows 主窗口重构为中文优先、无需滚动即可完成日常语音输入的产品界面，同时保留现有录音、Whisper、文本处理、全局快捷键、托盘、HUD、历史和安装包能力。

**Architecture:** 主窗口继续使用单个 Electron 渲染进程。新增纯函数视图状态模块管理标签页、编辑器基线文本和最近历史；新增受限的主进程 IPC 负责隐藏窗口并把编辑后的文本粘贴到之前的应用；现有设置、提供方、安装和历史 IPC 保持数据源角色。设置抽屉只重组信息架构，不改动模型安装与提供方实现。

**Tech Stack:** Electron 38、JavaScript ES modules、CommonJS preload、Node test runner、HTML/CSS、Lucide 本地图标、electron-builder、现有 `uiohook-napi` 原生快捷键后端。

## Global Constraints

- 以 `docs/superpowers/specs/2026-07-11-windows-ui-v3-design.md` 为唯一产品规格，以 `docs/design/local-flow-windows-ui-v3-target.png` 为视觉层级参照。
- 保留 `uiohook-napi`、全局快捷键、按住说话、Mouse4/Mouse5、托盘、HUD、自动粘贴和“粘贴上一段结果”行为。
- 保持 `build.npmRebuild=false`，不得改变当前原生模块打包策略。
- “自动输出”始终表示保留说话语言；不得把缺少 Qwen 变成同语言听写或 MyMemory 输出的阻塞项。
- 主界面不得显示模型路径、下载地址、安装命令、原始进程错误或堆栈。
- 熟悉操作使用 Lucide 图标；不手绘 SVG，不从 CDN 加载运行时资源。
- 980 x 720 与 760 x 560 不得出现横向滚动；高度不足 650 px 时允许内容区受控纵向滚动。
- 每项行为改动遵循红灯、绿灯、重构顺序；每完成一个任务运行对应聚焦测试并形成独立提交。

---

### Task 1: 建立主界面纯状态模型

**Files:**
- Create: `src/renderer/main-view-state.js`
- Create: `tests/main-view-state.test.js`

**Interfaces:**
- Produces: `createEditorState(text)`、`replaceEditorText(state, text, options)`、`restoreEditorText(state)`、`projectHistory(entries, limit)`、`normalizeViewPhase(phase)`。
- Consumes: 听写结果文本、历史记录数组和主进程阶段字符串。

- [ ] 先创建 `tests/main-view-state.test.js`，覆盖空编辑器、生成结果作为基线、用户编辑、恢复、从历史载入、最近三条投影、无效历史过滤和未知阶段回退：

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  createEditorState,
  normalizeViewPhase,
  projectHistory,
  replaceEditorText,
  restoreEditorText
} from "../src/renderer/main-view-state.js";

test("editor state keeps a deterministic generated baseline", () => {
  const generated = replaceEditorText(createEditorState(), "第一段听写", { asBaseline: true });
  const edited = replaceEditorText(generated, "第一段已编辑");

  assert.deepEqual(edited, {
    baselineText: "第一段听写",
    currentText: "第一段已编辑",
    characterCount: 7,
    dirty: true,
    empty: false
  });
  assert.deepEqual(restoreEditorText(edited), {
    baselineText: "第一段听写",
    currentText: "第一段听写",
    characterCount: 6,
    dirty: false,
    empty: false
  });
});

test("history projection keeps only usable newest entries", () => {
  const entries = [
    { createdAt: "2026-07-11T03:00:00.000Z", status: "complete", text: "三" },
    { createdAt: "2026-07-11T02:00:00.000Z", status: "failed", text: "" },
    { createdAt: "2026-07-11T01:00:00.000Z", status: "complete", text: "一" },
    { createdAt: "2026-07-10T23:00:00.000Z", status: "complete", text: "零" }
  ];

  assert.deepEqual(projectHistory(entries, 2).map((entry) => entry.text), ["三", "一"]);
});

test("unknown phases fall back to idle", () => {
  assert.equal(normalizeViewPhase("transcribing"), "transcribing");
  assert.equal(normalizeViewPhase("unexpected"), "idle");
});
```

- [ ] 运行 `node --test --test-reporter=spec tests/main-view-state.test.js`，确认因为模块不存在而失败。
- [ ] 创建 `src/renderer/main-view-state.js`，实现不可变状态转换。字符数使用 `Array.from(text).length`，历史只接受 `status === "complete"` 且文本非空的条目，阶段白名单为 `idle`、`starting`、`recording`、`stopping`、`transcribing`、`pasting`、`done`、`warning`、`error`。
- [ ] 再次运行聚焦测试并确认通过。
- [ ] 提交：`feat(renderer): add deterministic main view state`

### Task 2: 增加受限的“插入到光标位置”主进程能力

**Files:**
- Create: `src/main/insert-text.js`
- Create: `tests/insert-text.test.js`
- Modify: `src/main/index.js`
- Modify: `src/preload.cjs`
- Modify: `tests/electron-runtime.test.js`

**Interfaces:**
- Produces: `normalizeInsertText(value, maxLength)`、`insertTextIntoPreviousApp(text, dependencies)` 和 preload API `window.localFlow.insertText(text)`。
- Consumes: 主窗口实例、Electron clipboard、现有 `pasteText`、可注入延时函数。
- IPC channel: `dictation:insert-text`。

- [ ] 先创建 `tests/insert-text.test.js`，覆盖非字符串、纯空白、100000 字符上限、隐藏窗口发生在粘贴之前、粘贴成功和失败时的安全结果：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { insertTextIntoPreviousApp, normalizeInsertText } from "../src/main/insert-text.js";

test("insert text rejects empty and oversized values", () => {
  assert.throws(() => normalizeInsertText(null), /string/i);
  assert.throws(() => normalizeInsertText("   "), /empty/i);
  assert.throws(() => normalizeInsertText("x".repeat(100001)), /too long/i);
});

test("insert hides the window before invoking the existing paste pipeline", async () => {
  const calls = [];
  const result = await insertTextIntoPreviousApp("编辑后的文本", {
    mainWindow: { hide: () => calls.push("hide") },
    clipboard: {},
    wait: async () => calls.push("wait"),
    paste: async (text) => calls.push(`paste:${text}`)
  });

  assert.deepEqual(calls, ["hide", "wait", "paste:编辑后的文本"]);
  assert.deepEqual(result, { ok: true });
});

test("insert maps paste failures without exposing the raw process message", async () => {
  const result = await insertTextIntoPreviousApp("保留在剪贴板", {
    mainWindow: { hide() {} },
    clipboard: {},
    wait: async () => {},
    paste: async () => {
      const error = new Error("spawn C:\\private\\powershell.exe ENOENT");
      error.code = "paste_failed";
      throw error;
    }
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "paste_failed",
    message: "Paste failed. Text copied."
  });
});
```

- [ ] 运行 `node --test --test-reporter=spec tests/insert-text.test.js`，确认因为模块不存在而失败。
- [ ] 实现 `src/main/insert-text.js`：保留文本内部和首尾字符，不用 `trim()` 改写实际插入内容；只用 `trim()` 判断是否为空；隐藏窗口后等待 140 ms，再调用 `paste(text, { clipboard })`；失败时只返回固定安全文案和允许的错误代码。
- [ ] 在 `src/preload.cjs` 暴露 `insertText: (text) => ipcRenderer.invoke("dictation:insert-text", text)`，不暴露原始 `ipcRenderer`。
- [ ] 在 `src/main/index.js` 注册 handler；首先校验 `_event.sender === mainWindow?.webContents`，否则返回 `{ ok: false, reason: "unauthorized" }`；合法请求调用 `insertTextIntoPreviousApp`。
- [ ] 在 `tests/electron-runtime.test.js` 增加 VM preload 断言和主进程静态断言，证明 API 使用指定 channel、sender 校验发生在参数处理之前、默认应用菜单通过 `Menu.setApplicationMenu(null)` 移除但托盘仍使用 `Menu.buildFromTemplate`。
- [ ] 运行 `node --test --test-reporter=spec tests/insert-text.test.js tests/electron-runtime.test.js` 并确认通过。
- [ ] 提交：`feat(main): insert edited text into previous app`

### Task 3: 引入本地图标并重建主窗口语义结构

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/renderer/icons.js`
- Modify: `src/renderer/index.html`
- Modify: `tests/renderer-markup.test.js`

**Interfaces:**
- Produces: `renderIcons(root)`；语义化 `tablist`、`tabpanel`、录音命令条、最新结果编辑器、最近历史和全量历史列表。
- Consumes: Lucide ESM 图标和现有 DOM IDs。必须继续保留设置保存、模型安装、诊断与快捷键录制所需的现有字段 ID。

- [ ] 用 `npm.cmd install --save-exact lucide@1.24.0` 安装固定版本，并确认 `build.npmRebuild` 仍为 `false`。
- [ ] 创建 `src/renderer/icons.js`，只注册实际使用的 `Mic`、`Settings`、`History`、`Copy`、`Undo2`、`CornerDownLeft`、`ChevronRight`、`Keyboard`、`CheckCircle2`、`AlertTriangle`、`X` 图标；`renderIcons` 为图标统一设置 `width="18"`、`height="18"`、`stroke-width="1.8"` 和 `aria-hidden="true"`。
- [ ] 先在 `tests/renderer-markup.test.js` 添加失败断言：

```js
test("Windows UI v3 exposes the complete daily dictation workflow", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  assert.match(html, /role="tablist"/);
  assert.match(html, /id="dictationTab"/);
  assert.match(html, /id="historyTab"/);
  assert.match(html, /id="voiceCommandBar"/);
  assert.match(html, /id="resultEditor"[^>]*contenteditable="true"/);
  assert.match(html, /id="restoreResult"/);
  assert.match(html, /id="insertResult"/);
  assert.match(html, /id="recentHistoryList"/);
  assert.match(html, /id="fullHistoryList"/);
  assert.match(html, /id="footerHealthText"/);
  assert.doesNotMatch(html, /class="record-orb"/);
});

test("icon-only controls have localized labels and tooltips", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

  for (const id of ["openSettings", "openHistory", "restoreResult", "copyResult"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]+aria-label=`));
    assert.match(html, new RegExp(`id="${id}"[^>]+title=`));
  }
  assert.match(html, /data-lucide="settings"/);
  assert.doesNotMatch(html, /<svg[\s>]/);
});
```

- [ ] 运行 `node --test --test-reporter=spec tests/renderer-markup.test.js` 并确认缺少新结构时失败。
- [ ] 重写 `src/renderer/index.html` 的主内容为以下稳定层级：`appHeader`、`mainTabs`、`dictationPanel`、`languageControls`、`voiceCommandBar`、`recordRecovery`、`resultWorkspace`、`recentHistorySection`、`historyPanel`、`footerHealth`、`settingsDrawer`。设置表单中所有现有字段继续存在，只移动到四个设置分区。
- [ ] 使用 `<button role="tab">`、`<section role="tabpanel">`、`<ol>`/`<li>`、真实 `<button>` 和带 `<label>` 的输入控件；`resultEditor` 使用 `role="textbox" aria-multiline="true"`。
- [ ] 将安装清单、诊断结果、Qwen 状态和下载日志从主内容移动到“模型与隐私”或“高级”分区；主内容中不得再存在 `setupChecklist`。
- [ ] 运行聚焦标记测试并确认通过。
- [ ] 提交：`feat(renderer): rebuild Windows main window structure`

### Task 4: 接入标签页、编辑器、历史和插入交互

**Files:**
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/main-view-state.js`
- Modify: `scripts/electron-app-smoke.mjs`
- Modify: `tests/main-view-state.test.js`

**Interfaces:**
- Consumes: Task 1 状态函数、Task 2 `window.localFlow.insertText`、现有 `listHistory`、录音结果、状态和剪贴板降级。
- Produces: 本地标签页状态、可恢复编辑器、最近三条列表、全量历史列表、插入反馈和方向键标签导航。

- [ ] 扩展 `tests/main-view-state.test.js`：验证历史条目投影包含 `characterCount` 和稳定 ID；验证 `starting` 到 `error` 的所有阶段都有对应视图阶段。
- [ ] 在 `scripts/electron-app-smoke.mjs` 增加 `dictation:insert-text` stub、三条历史 fixture 和状态采集字段，先写以下失败场景：
  - 点击“查看全部”切换到历史标签页；
  - 点击历史条目把文本加载为新基线并返回语音输入页；
  - 编辑后字符数变化，点击恢复后回到基线；
  - 点击插入把编辑后文本传给 `dictation:insert-text`；
  - 方向键在两个主标签之间移动并更新 `aria-selected`；
  - 输出语言 change 发生后，无需提交整个设置表单即可写入保存调用。
- [ ] 运行 `npm.cmd run check:app`，确认新场景在实现前失败。
- [ ] 在 `src/renderer/app.js` 引入 `main-view-state.js` 和 `icons.js`；使用单一 `editorState` 与 `activeView`；所有结果渲染统一进入 `setResultBaseline(text)`，用户输入统一进入 `updateEditorFromDom()`。
- [ ] 保留现有 `copyLatestResult()` 降级机制，但读取 `editorState.currentText`；空文本时禁用恢复、复制和插入。
- [ ] `insertResult` 调用 `window.localFlow.insertText(editorState.currentText)`；成功时显示本地化完成状态，失败时显示固定安全警告，编辑器文本保持不变。
- [ ] 最近列表只渲染 `projectHistory(history, viewportHeight < 650 ? 2 : 3)`；全量历史保留所有历史条目，失败条目显示本地化解释但不允许插入空文本。
- [ ] 主标签实现 `ArrowLeft`、`ArrowRight`、`Home`、`End`，并把焦点移到新选中的 tab。
- [ ] 语言选择 change 使用现有 `saveSettingsFromCurrentForm({ updateStatus: false })`，随后刷新 provider/setup/health 摘要；“自动”文案保持同语言语义。
- [ ] 运行 `node --test --test-reporter=spec tests/main-view-state.test.js` 与 `npm.cmd run check:app` 并确认通过。
- [ ] 提交：`feat(renderer): wire dictation workspace interactions`

### Task 5: 重组设置抽屉并补齐焦点管理

**Files:**
- Create: `src/renderer/focus-trap.js`
- Create: `tests/focus-trap.test.js`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/styles.css`
- Modify: `scripts/electron-app-smoke.mjs`

**Interfaces:**
- Produces: `createFocusTrap({ container, onEscape })`；设置分区 `general`、`shortcuts`、`models`、`advanced`。
- Consumes: 设置抽屉元素、触发按钮和现有设置表单。

- [ ] 先创建 `tests/focus-trap.test.js`，用最小 DOM-like doubles 覆盖：打开时聚焦首个可操作元素、Tab 从末尾回到首个、Shift+Tab 从首个回到末尾、Escape 调用关闭、销毁后移除监听。
- [ ] 运行 `node --test --test-reporter=spec tests/focus-trap.test.js`，确认模块缺失而失败。
- [ ] 实现 `focus-trap.js`；可聚焦选择器只包括未禁用的链接、按钮、输入、选择框、文本域和 `[tabindex]:not([tabindex="-1"])`。
- [ ] 设置抽屉使用 `role="dialog" aria-modal="true"`；宽度 `min(560px, 100vw)`；标题栏和保存栏固定，中间区域独立滚动。
- [ ] 四个分区使用纵向分区按钮和单一可见面板；默认 `general`；`advanced` 只有用户主动选择时显示，不能因安装失败自动展开。
- [ ] 打开抽屉时记录 `document.activeElement`，启动焦点限制；Escape、背景和关闭按钮均调用同一关闭函数；关闭后恢复触发元素焦点。
- [ ] 扩展 Electron 冒烟测试，验证四个分区存在、Advanced 初始隐藏、切换分区、Escape 关闭、关闭后焦点回到 `openSettings`、Tab 不离开抽屉。
- [ ] 运行 `node --test --test-reporter=spec tests/focus-trap.test.js tests/renderer-markup.test.js` 与 `npm.cmd run check:app` 并确认通过。
- [ ] 提交：`feat(renderer): reorganize accessible settings drawer`

### Task 6: 完成八语种文案、视觉系统和响应式布局

**Files:**
- Modify: `src/renderer/i18n.js`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/app.js`
- Modify: `tests/i18n.test.js`
- Modify: `tests/renderer-markup.test.js`

**Interfaces:**
- Produces: UI v3 新增键在 `en`、`zh-Hans`、`ja`、`ko`、`zh-Hant`、`fr`、`ru`、`es` 中均有显式值；稳定的 980/760/低高度布局。
- Consumes: `data-i18n`、`data-i18n-title`、`data-i18n-aria-label` 和阶段状态。

- [ ] 在 `tests/i18n.test.js` 定义 UI v3 必需键清单并先确认失败：

```js
const uiV3Keys = [
  "tab.dictation", "tab.history", "status.localReady",
  "hint.autoKeepsLanguage", "action.restore", "action.insert",
  "action.viewAll", "action.backToDictation", "label.characterCount",
  "settings.general", "settings.shortcuts", "settings.modelsPrivacy",
  "settings.advanced", "status.inserted", "status.insertFailed"
];

test("every supported language explicitly defines Windows UI v3 copy", () => {
  for (const language of ["en", "zh-Hans", "ja", "ko", "zh-Hant", "fr", "ru", "es"]) {
    for (const key of uiV3Keys) {
      assert.equal(typeof uiTranslations[language][key], "string", `${language}.${key}`);
      assert.notEqual(uiTranslations[language][key].trim(), "", `${language}.${key}`);
    }
  }
});
```

- [ ] 为全部八种语言增加显式键值；简体中文主文案采用“语音输入、历史、自动输出保持原语言、恢复、插入到光标处、查看全部、常规、快捷键、模型与隐私、高级”。
- [ ] 扩展 `applyTranslations()`，同步处理文本、placeholder、title 和 aria-label；每次语言变化后重新执行 `renderIcons()`，避免图标节点被属性更新破坏。
- [ ] 重写主窗口 CSS，严格使用规格颜色：`#F6F8F7`、`#FFFFFF`、`#17211E`、`#66716D`、`#DCE3E0`、`#078A68`、`#D64B3C`、`#A96F16`、`#B83A3A`；圆角不超过 8 px；不使用渐变、装饰性光斑、嵌套卡片或巨大圆形按钮。
- [ ] 桌面主内容采用固定上限宽度和稳定行高；录音命令条高度不因状态文字变化而跳动；波形只改变内部 bar 的 transform/opacity，不改变布局尺寸，也不进入 live region。
- [ ] 增加 `@media (max-width: 919px)`：语言控件换行、波形缩短、次要动作隐藏文字但保留 title/aria-label；增加 `@media (max-height: 649px)`：编辑器缩短、最近记录限制为两条、内容区独立纵向滚动；设置抽屉在窄尺寸占满宽度。
- [ ] 增加 `:focus-visible` 焦点环、`prefers-reduced-motion` 关闭波形动画，并保证 `body` 与主壳 `overflow-x: hidden`。
- [ ] 在 `tests/renderer-markup.test.js` 断言 UI v3 样式不含 `record-orb`、`border-radius: 50%` 的主录音按钮、`linear-gradient`，并存在两个响应式断点和 `prefers-reduced-motion`。
- [ ] 运行 `node --test --test-reporter=spec tests/i18n.test.js tests/renderer-markup.test.js` 并确认通过。
- [ ] 提交：`style(renderer): finish localized Windows UI v3`

### Task 7: 强化 Electron 冒烟与安全回归覆盖

**Files:**
- Modify: `scripts/electron-app-smoke.mjs`
- Modify: `tests/electron-runtime.test.js`
- Modify: `tests/renderer-markup.test.js`

**Interfaces:**
- Consumes: 完整 UI v3 和现有 IPC stubs。
- Produces: 可重复的日常流程、设置流程、错误流程和安全边界验证。

- [ ] 补齐冒烟脚本 stub，确保所有新增 IPC 都有明确实现，历史 fixture 至少包含中文、英文和失败条目。
- [ ] 验证首屏可见元素：语言行、录音命令条、结果编辑器、三个最近结果槽位、健康摘要；验证主界面文本不包含 `C:\\`、`.exe`、`.gguf`、下载 URL 或 `spawn`。
- [ ] 验证缺少 Whisper 时只显示一个恢复入口；验证 MyMemory + Auto 时 Qwen 安装按钮不阻止录音。
- [ ] 验证录音完成后结果成为 baseline；本地编辑不修改历史 fixture；复制降级和插入失败均保留编辑文本。
- [ ] 验证设置四分区不会丢失现有字段和快捷键录制器；验证模型安装失败日志经过路径脱敏且只在 Advanced 可见。
- [ ] 运行 `npm.cmd test`，修复所有回归后再次运行直至零失败。
- [ ] 运行 `npm.cmd run check:app` 与 `npm.cmd run check:microphone`，确认 Electron 控制台没有阻塞级错误。
- [ ] 提交：`test(renderer): cover Windows UI v3 workflows`

### Task 8: 视觉验收、打包和发布验证

**Files:**
- Create: `docs/audits/2026-07-11-local-flow-windows-ui-v3/01-dictation-980x720.png`
- Create: `docs/audits/2026-07-11-local-flow-windows-ui-v3/02-history-980x720.png`
- Create: `docs/audits/2026-07-11-local-flow-windows-ui-v3/03-settings-general.png`
- Create: `docs/audits/2026-07-11-local-flow-windows-ui-v3/04-settings-advanced.png`
- Create: `docs/audits/2026-07-11-local-flow-windows-ui-v3/05-dictation-760x560.png`
- Create: `docs/audits/2026-07-11-local-flow-windows-ui-v3/audit.md`
- Regenerate: `dist/Local Flow Setup 0.1.0.exe`

**Interfaces:**
- Consumes: 完成的 UI v3、已确认视觉目标和 Windows 构建链。
- Produces: 截图证据、视觉审计、可安装 NSIS 包和发布验证报告。

- [ ] 启动本地 Electron 应用；分别在 980 x 720 和 760 x 560 捕获主界面，并检查 `scrollWidth <= clientWidth`、录音入口首屏可见、文字无重叠、图标非空白、中文无乱码。
- [ ] 捕获历史页、设置常规页和设置高级页；确认 Advanced 默认隐藏，主界面没有路径和安装日志，所有图标按钮都有工具提示。
- [ ] 将 980 x 720 主界面与 `docs/design/local-flow-windows-ui-v3-target.png` 对比，在 `audit.md` 记录层级、间距、字体、颜色、响应式和无障碍检查结果；发现差异后先修复再重新截图。
- [ ] 运行完整验证链：

```powershell
npm.cmd test
npm.cmd run check:app
npm.cmd run check:microphone
npm.cmd run dist:win
npm.cmd run check:product
npm.cmd run verify:release
npm.cmd run check:packaged
```

- [ ] 确认 `package.json` 中 `build.npmRebuild` 仍为 `false`，安装包包含 Lucide 运行文件、`uiohook-napi` 和所有 renderer 资源。
- [ ] 安装/启动生成的 NSIS 包，手动验证：托盘、开机启动开关、全局快捷键、Mouse4/Mouse5（硬件可用时）、录音、自动同语言输出、复制、插入、历史复用和退出。
- [ ] 运行 `git diff --check` 与 `git status --short`，确认没有缓存、下载文件、个人路径或无关改动。
- [ ] 提交：`chore(release): verify Windows UI v3 product build`

---

## 完成定义

- `npm.cmd test`、`check:app`、`check:microphone`、`dist:win`、`check:product`、`verify:release` 和 `check:packaged` 全部成功。
- 980 x 720 与 760 x 560 截图证明无横向滚动、无重叠，录音入口和主要操作处于首屏。
- 中文为当前默认界面，同时八种受支持界面的 UI v3 文案完整且无乱码。
- 最新结果可编辑、恢复、复制和插入；最近历史与全量历史可复用且不修改持久化历史。
- 高级设置默认隐藏，路径、URL、安装输出和原始诊断只在 Advanced 中出现。
- 现有全局快捷键、原生输入钩子、托盘、HUD、本地 Whisper、MyMemory、Qwen/Ollama 和安装包能力没有回归。
