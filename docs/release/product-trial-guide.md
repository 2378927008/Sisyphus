# Local Flow 试用指南

这份指南用于确认当前产品包是否已经达到“可以试用”的状态。它不假设用户有 OpenAI API key；默认路径仍然是本地 Windows 应用加免费语音识别链路。

## Windows 试用路径

1. 安装包位置：`dist\Local Flow Setup 0.1.0.exe`
2. 双击安装后启动 `Local Flow`。首次录音时，Windows 会弹出麦克风权限；必须允许，否则主按钮会保持不可用或进入权限错误状态。
3. 默认快捷键：`Ctrl + Alt + Space`。按一次开始录音，再按一次停止并把识别文本输入到当前光标位置。
4. 输出语言选择为 `Auto` 时，产品目标是保留你实际说话的语言；它不是默认翻译成英文。只有明确选择目标输出语言时，才进入翻译/改写输出链路。
5. 如果托盘图标可见，可以从托盘打开主窗口、暂停全局快捷键、打开设置或退出应用。

## Windows 本地验证命令

在项目根目录运行：

```powershell
npm.cmd test
npm.cmd run check:app
npm.cmd run check:microphone
npm.cmd run dist:win
npm.cmd run verify:release
npm.cmd run check:packaged
npm.cmd run check:product
```

这些命令分别覆盖单元/契约测试、Electron 页面启动、麦克风可见性、NSIS 安装包构建、安装包文件完整性、打包后应用隐藏启动烟测，以及产品级交付文件检查。

## iPhone 试用路径

iPhone 版本当前交付的是原生 Swift/SwiftUI 源码骨架，入口在 `ios\LocalFlowiOS`。它优先使用 Apple Speech 和系统麦克风权限，不要求 OpenAI API key。

需要在 macOS + Xcode 上完成：

```bash
cd ios/LocalFlowiOS
xcodebuild -scheme LocalFlowiOS -destination 'platform=iOS Simulator,name=iPhone 16' build
```

当前 Windows 机器不能运行 Xcode，也不能启动 iOS Simulator，所以 iPhone 的编译、签名、真机麦克风权限和键盘扩展行为必须在 Mac 上做最终确认。

## 已知边界

- Windows 包已经走 Electron + NSIS 路线，目标是后台常驻、托盘、全局快捷键和靠近输入法的输入体验。
- iPhone 的自定义键盘扩展受 iOS 沙盒限制，安全输入框、密码框等场景不能替代系统键盘行为。
- Apple Speech 的 `Auto` 识别在 MVP 中依赖 iOS 当前偏好语音语言；这不是完整的多语种自动识别模型。
- 如果选择目标输出语言，但本地语言模型或免费翻译服务不可用，产品应提示降级原因，而不是悄悄输出错误语言。
