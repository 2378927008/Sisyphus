# Local Flow 中文试用指南

Local Flow 是一款 Windows 语音输入软件，不是默认翻译软件。日常使用通过全局快捷键、录音 HUD 和系统托盘完成；主窗口用于查看历史、编辑文本、管理个人词典和快捷短语。默认语音识别使用本地 Whisper，不需要 OpenAI API key。

## 安装与启动

本地生成的安装包是 `dist\Local Flow Setup 0.1.0.exe`，免安装版本位于 `dist\win-unpacked`。

1. 运行安装包，选择一个明确的非系统目录完成安装。
2. 安装结束后，可通过桌面快捷方式或开始菜单中的 `Local Flow` 启动。
3. 正常手动启动会显示主窗口。再次点击桌面快捷方式或开始菜单时，应唤回同一个窗口，不会再启动第二套托盘、快捷键或录音服务。
4. 首次录音时允许 Windows 麦克风权限。拒绝后可在 Windows 的“隐私和安全性 > 麦克风”中重新允许。

## 日常语音输入

1. 把光标放到记事本、浏览器或聊天软件的输入位置。
2. 按 `Ctrl + Alt + Space` 开始听写，再按一次停止录音并转写。
3. 录音 HUD 会显示当前状态。点击“停止”会继续转写并插入文本；点击“取消”或按 `Escape` 会丢弃本次录音，不新增历史。
4. 点击主窗口关闭按钮时，Local Flow 会隐藏到托盘并继续提供语音输入。每次运行会话第一次关闭时会出现一次后台运行说明；点击托盘图标可重新打开。

## 历史与个性化

- 在“历史记录”中搜索并选择一条记录，可以直接编辑历史内容；修改会自动保存。
- “重新整理”会从保存的原始转写重新处理，不会反复改写已经整理过的文本。
- “个人词典”用于保存产品名、人名和专业术语，后续整理会优先保留这些写法。
- “快捷短语”使用精确匹配：整段语音与唤起短语一致时才展开，避免在长句内部误触发。

## 语言行为

- 输出语言选择“自动（同语音）”时，Local Flow 自动识别输入语言并保持同一种语言。中文输入仍输出中文，英文输入仍输出英文。
- 仅在明确选择目标语言时才执行语言转换；未选择目标语言时不会统一输出英文。
- Qwen 是可选的本地文本整理能力。没有安装 Qwen 时，不影响本地 Whisper 的基础听写、自动语言保持、历史编辑、个人词典和快捷短语。
- 明确选择目标语言后，如果本地语言模型不可用，应用会给出可恢复提示，不会悄悄输出错误语言。

## 卸载

打开 Windows“设置 > 应用 > 已安装的应用”，找到 `Local Flow` 并选择“卸载”。卸载程序应移除安装目录、桌面快捷方式和开始菜单入口，不应删除安装目录以外的无关用户文件。

## 发布前验证

在项目根目录依次运行：

```powershell
npm.cmd test
npm.cmd run check:app
npm.cmd run check:microphone
npm.cmd run check:visual
npm.cmd run package:win
npm.cmd run check:packaged
npm.cmd run dist:win
npm.cmd run check:product
npm.cmd run verify:release
```

`check:packaged` 会验证隐藏启动持续存活、第二次可见启动及时退出、现有窗口被唤回，并确认没有重复的主应用实例。`verify:release` 会检查安装包、免安装程序、Whisper 运行时与基础模型、llama.cpp 运行时，以及 Qwen 可选模型清单；Qwen 模型本体不随安装包分发。

## GitHub 安装包

仓库推送后，GitHub Actions 会运行 `Windows Installer Artifact` 工作流。在对应任务的产物区域下载 `local-flow-windows-installer`，其中应包含：

- `Local Flow Setup 0.1.0.exe`
- `Local Flow Setup 0.1.0.exe.blockmap`
- `win-unpacked` 免安装目录

当前安装包尚未进行商业代码签名，Windows 可能显示未知发布者提示。正式公开发布前需要补充代码签名和正式 Release 流程。

## iPhone 当前边界

iPhone 版本仍是原生 Swift/SwiftUI 源码交付，使用 Apple Speech 与系统麦克风权限，不需要 OpenAI API key。Windows 不能运行 Xcode 或 iOS 模拟器，因此最终编译、签名、真机权限和键盘扩展行为需要在 macOS + Xcode 上确认：

```bash
cd ios/LocalFlowiOS
xcodebuild -scheme LocalFlowiOS -destination 'platform=iOS Simulator,name=iPhone 16' build
```

本次 Windows V4 发布不修改 iPhone 源码。
