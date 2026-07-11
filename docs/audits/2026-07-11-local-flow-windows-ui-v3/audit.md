# Local Flow Windows UI v3 视觉验收

- 日期：2026-07-11（Asia/Shanghai）
- 基线：`a8671d7`
- 目标图：`docs/design/local-flow-windows-ui-v3-target.png`
- 验收方式：真实 Electron `BrowserWindow`、125% Windows DPI、`capturePage()` 双帧择优，不使用静态 HTML 替代
- 窗口与截图：980 x 720 外窗对应 966 x 683 CSS viewport、1208 x 854 PNG；760 x 560 外窗对应 747 x 523 CSS viewport、934 x 654 PNG

## 本轮修复

1. Header 使用 `assets/local-flow-icon.svg` 的 `<img>` 展示 Local Flow 图标，装饰性 `alt=""`，品牌文字继续承担可访问名称。
2. 760 宽度下 command bar 保持四列；waveform 保持可见并压缩为 96px。
3. 低高度 recent 区压缩标题、按钮和行距；缓存投影的两条记录均完整落在父滚动区裁切矩形内。
4. 完整 History 在桌面宽度将选择区与 copy/insert 动作同行排列；失败项保留安全解释，动作保持禁用。
5. Header 健康状态增加稳定节点，并与 footer 走同一 readiness 渲染路径；ready 时二者均为“本地 Whisper 已就绪”，not-ready 使用八语种短安全文案。
6. 视觉 harness 保留软件栅格器，并对每个稳定状态连续捕获两帧，使用 `toBitmap()` 计算近黑像素占比后保存较低的一帧。
7. 最新结果标题操作行增加稳定的 `#resultCharacterCount`；980 桌面视图可见并随编辑状态、本地化语言实时更新，最小窗口允许隐藏以保护动作区。

## 截图检查

| 截图 | 视图 | 验收结果 |
| --- | --- | --- |
| `01-dictation-980x720.png` | 听写主页 | 图标、品牌状态、语言行、四列命令条、可见“20 个字符”、已填充编辑器、三条 recent、footer 均清晰；无黑块、重叠或横滚。 |
| `02-history-980x720.png` | 全量 History | 四条记录清晰；完整项选择区与动作同行；失败项解释可读且动作禁用；无黑块。 |
| `03-settings-general.png` | 常规设置 | Drawer 层级、四个 tab、表单、固定保存区正常；背景遮罩均匀，无异常覆盖。 |
| `04-settings-advanced.png` | 高级设置 | Advanced 仅在显式打开后可见；路径和安装命令限制在 drawer；滚动区与固定保存区正常；无黑块。 |
| `05-dictation-760x560.png` | 最小窗口 | Waveform 为 96px 且可见；command bar 四列稳定；两条 recent 均完整可见；主流程可操作，无横滚。 |

## 自动检查

- 五个状态均满足 `scrollWidth <= clientWidth`，录音按钮完整位于 viewport 内。
- 可见控件均有文本或可访问名称；所有可见 Lucide 节点均已替换为非空 SVG。
- 主要控制区域无矩形重叠；主页和 History 未泄露路径、URL、spawn、ENOENT 或 stderr。
- Header/footer 健康文案在五个状态均同步为“本地 Whisper 已就绪”。
- 980 听写主页的 `#resultCharacterCount` 可见且为“20 个字符”；760 最小窗口按响应式规则隐藏，不挤压结果动作按钮。
- 760 x 560 状态的两条 recent DOM rect 均完整位于 recent 父区域和 viewport 内。
- 五个状态的双帧近黑像素占比均为 0，最终文件逐张人工检查未发现纯黑 capture artifact。
- Advanced 初始隐藏，显式打开后可见；Esc 已由 harness 验证可关闭 drawer。

## 结论

最终五张截图通过视觉验收。与目标图相比，现有 UI 保留当前产品的信息密度和 Electron 窗口结构，但品牌信号、状态同步、命令条、编辑器、History 动作层级、最小窗口行为和设置 drawer 均满足 UI v3 brief；未发现需要以“已知限制”放行的视觉问题。
