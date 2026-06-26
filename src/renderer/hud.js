const hudRoot = document.querySelector("#hudRoot");
const hudTitle = document.querySelector("#hudTitle");
const hudMessage = document.querySelector("#hudMessage");

const titleByPhase = {
  idle: "Local Flow",
  recording: "正在录音",
  transcribing: "正在转写",
  pasting: "正在粘贴",
  done: "已输入",
  error: "需要处理"
};

window.localFlow?.onSystemInputStatus?.((state) => {
  renderHudState(state);
});

function renderHudState(state = {}) {
  const phase = state.phase || "idle";
  hudRoot.dataset.phase = phase;
  hudTitle.textContent = titleByPhase[phase] || "Local Flow";
  hudMessage.textContent = state.message || "按快捷键开始或停止录音";
}
