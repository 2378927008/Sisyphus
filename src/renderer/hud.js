import { getHudViewState } from "./hud-state.js";
import { renderIcons } from "./icons.js";

const hudRoot = document.querySelector("#hudRoot");
const hudTitle = document.querySelector("#hudTitle");
const hudMessage = document.querySelector("#hudMessage");
const hudTimer = document.querySelector("#hudTimer");
const hudCancel = document.querySelector("#hudCancel");
const hudStop = document.querySelector("#hudStop");
const hudOpenMain = document.querySelector("#hudOpenMain");
const hudOpenMainLabel = document.querySelector("#hudOpenMainLabel");

let latestState = { phase: "idle", language: "zh-Hans" };
let timerId = null;

window.localFlow?.onSystemInputStatus?.((state) => {
  latestState = state && typeof state === "object" ? state : { phase: "idle", language: "zh-Hans" };
  renderHudState();
});

hudCancel.addEventListener("click", () => {
  window.localFlow?.cancel?.();
});
hudStop.addEventListener("click", () => {
  window.localFlow?.stop?.();
});
hudOpenMain.addEventListener("click", () => {
  window.localFlow?.openMainWindow?.();
});

renderIcons();
renderHudState();

function renderHudState() {
  const viewState = getHudViewState(latestState);

  hudRoot.dataset.phase = viewState.phase;
  hudTitle.textContent = viewState.title;
  hudMessage.textContent = viewState.message;
  hudTimer.textContent = viewState.elapsed;
  document.documentElement.lang = viewState.language;

  applyActionState(hudCancel, viewState.actions.cancel);
  applyActionState(hudStop, viewState.actions.stop);
  applyActionState(hudOpenMain, viewState.actions.openMainWindow);
  hudOpenMainLabel.textContent = viewState.actions.openMainWindow.label;

  syncTimer(viewState.phase);
}

function applyActionState(button, action) {
  button.hidden = !action.visible;
  button.disabled = action.disabled;
  button.title = action.label;
  button.setAttribute("aria-label", action.label);
}

function syncTimer(phase) {
  if (phase === "recording") {
    if (!timerId) {
      timerId = window.setInterval(renderHudState, 250);
    }
    return;
  }

  if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
}
