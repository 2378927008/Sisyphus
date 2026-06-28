import { getHudViewState } from "./hud-state.js";

const hudRoot = document.querySelector("#hudRoot");
const hudTitle = document.querySelector("#hudTitle");
const hudMessage = document.querySelector("#hudMessage");
const hudTimer = document.querySelector("#hudTimer");

let latestState = { phase: "idle", language: "zh-Hans" };
let timerId = null;

window.localFlow?.onSystemInputStatus?.((state) => {
  latestState = state && typeof state === "object" ? state : { phase: "idle", language: "zh-Hans" };
  renderHudState();
});

renderHudState();

function renderHudState() {
  const viewState = getHudViewState(latestState);

  hudRoot.dataset.phase = viewState.phase;
  hudTitle.textContent = viewState.title;
  hudMessage.textContent = viewState.message;
  hudTimer.textContent = viewState.elapsed;

  syncTimer(viewState.phase);
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
