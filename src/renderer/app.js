import { describeMicrophoneError } from "../shared/media-errors.js";
import { getRecordReadiness } from "./record-readiness.js";
import {
  defaultInterfaceLanguage,
  defaultOutputLanguage,
  defaultWhisperLanguage,
  interfaceLanguages,
  normalizeInterfaceLanguage,
  outputLanguages,
  whisperLanguages
} from "../shared/languages.js";
import { getUiText } from "./i18n.js";

const form = document.querySelector("#settingsForm");
const recordButton = document.querySelector("#recordButton");
const recordLabel = document.querySelector("#recordLabel");
const statusText = document.querySelector("#statusText");
const providerStatusText = document.querySelector("#providerStatusText");
const resultText = document.querySelector("#resultText");
const historyList = document.querySelector("#historyList");
const refreshHistory = document.querySelector("#refreshHistory");
const checkWhisper = document.querySelector("#checkWhisper");
const checkMicrophone = document.querySelector("#checkMicrophone");
const diagnosticsList = document.querySelector("#diagnosticsList");
const microphoneDiagnosticsList = document.querySelector("#microphoneDiagnosticsList");
const openSettings = document.querySelector("#openSettings");
const closeSettings = document.querySelector("#closeSettings");
const settingsDrawer = document.querySelector("#settingsDrawer");
const localModelStatus = document.querySelector("#localModelStatus");
const setupLocalModel = document.querySelector("#setupLocalModel");
const localModelInstallCommand = document.querySelector("#localModelInstallCommand");

let recorder = null;
let isRecording = false;
let currentSettings = null;
let currentProviderStatus = null;
let currentLanguage = defaultInterfaceLanguage;

init();

async function init() {
  currentSettings = await window.localFlow.getSettings();
  currentLanguage = normalizeInterfaceLanguage(currentSettings.interfaceLanguage);
  applyInterfaceLanguage(currentLanguage);
  fillSettings(currentSettings);
  setReadyStatus();
  await renderHistory();
  await renderLocalModelStatus();
  await refreshProviderStatus();

  recordButton.addEventListener("click", toggleRecording);
  openSettings.addEventListener("click", () => setSettingsDrawer(true));
  closeSettings.addEventListener("click", () => setSettingsDrawer(false));
  settingsDrawer.addEventListener("click", closeSettingsFromBackdrop);
  refreshHistory.addEventListener("click", renderHistory);
  checkWhisper.addEventListener("click", runWhisperDiagnostics);
  checkMicrophone.addEventListener("click", runMicrophoneDiagnostics);
  setupLocalModel.addEventListener("click", showLocalModelInstallCommand);
  form.interfaceLanguage.addEventListener("change", changeInterfaceLanguage);
  form.addEventListener("submit", saveSettings);
  window.localFlow.onShortcutToggle(toggleRecording);
  window.localFlow.onStatus(handleMainStatus);
}

function changeInterfaceLanguage() {
  currentLanguage = normalizeInterfaceLanguage(form.interfaceLanguage.value);
  applyInterfaceLanguage(currentLanguage);
  setReadyStatus();
  renderHistory();
}

function handleMainStatus(payload) {
  const phaseKeys = {
    transcribing: "status.transcribing",
    polishing: "status.polishing",
    pasting: "status.pasting",
    done: "status.done"
  };
  const key = phaseKeys[payload.phase];

  setStatus(key ? t(key) : payload.message);
}

async function runWhisperDiagnostics() {
  try {
    setStatus(t("status.checkingWhisper"));
    await saveSettingsFromCurrentForm();
    const result = await window.localFlow.checkWhisper();
    diagnosticsList.innerHTML = renderChecks(result.checks);
    setStatus(result.ready ? t("status.whisperReady") : t("status.whisperNeedsAttention"));
  } catch (error) {
    setStatus(t("status.whisperFailed", { message: error.message }));
  }
}

async function runMicrophoneDiagnostics() {
  setStatus(t("status.checkingMicrophone"));
  microphoneDiagnosticsList.innerHTML = renderChecks([
    {
      label: t("diagnostic.microphone"),
      status: "skip",
      message: t("diagnostic.requestingPermission")
    }
  ]);

  try {
    ensureMediaDevicesApi();
    const devicesBeforePermission = await navigator.mediaDevices.enumerateDevices();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    stream.getTracks().forEach((track) => track.stop());
    const devicesAfterPermission = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devicesAfterPermission.filter((device) => device.kind === "audioinput");
    const label = audioInputs.find((device) => device.label)?.label || t("diagnostic.microphone");

    microphoneDiagnosticsList.innerHTML = renderChecks([
      {
        label: t("diagnostic.mediaApi"),
        status: "pass",
        message: t("diagnostic.mediaApiAvailable")
      },
      {
        label: t("diagnostic.audioInputs"),
        status: audioInputs.length ? "pass" : "fail",
        message: audioInputs.length
          ? t("diagnostic.audioInputsFound", { count: audioInputs.length, label })
          : t("diagnostic.noAudioInputs", { count: devicesBeforePermission.length })
      },
      {
        label: t("diagnostic.permission"),
        status: "pass",
        message: t("diagnostic.permissionGranted")
      }
    ]);
    setStatus(t("status.microphoneReady"));
  } catch (error) {
    microphoneDiagnosticsList.innerHTML = renderChecks([
      {
        label: t("diagnostic.permission"),
        status: "fail",
        message: describeMicrophoneError(error)
      }
    ]);
    setStatus(describeMicrophoneError(error));
  }
}

async function renderLocalModelStatus() {
  if (!window.localFlow.getLocalModelStatus) return;

  const status = await window.localFlow.getLocalModelStatus();
  const ready = Boolean(status.ready);
  localModelStatus.className = `model-status ${ready ? "ready" : "missing"}`;
  localModelStatus.innerHTML = `
    <strong>${escapeHtml(ready ? t("model.status.ready") : t("model.status.missing"))}</strong>
    <span>${escapeHtml(ready
      ? t("model.status.readyDetail", { model: status.modelFile })
      : t("model.status.missingDetail", {
        model: `${status.modelId}:${status.quantization}`,
        size: status.approximateSize,
        license: status.license
      }))}</span>
  `;

  if (status.cliPath && !form.embeddedLlmCliPath.value) {
    form.embeddedLlmCliPath.value = status.cliPath;
  }
  if (status.modelPath && !form.embeddedLlmModelPath.value) {
    form.embeddedLlmModelPath.value = status.modelPath;
  }
  localModelInstallCommand.textContent = status.setupCommand || "powershell.exe -ExecutionPolicy Bypass -File .\\scripts\\setup-llm.ps1";
}

async function refreshProviderStatus() {
  if (!window.localFlow.getProviderStatus) return;
  currentProviderStatus = await window.localFlow.getProviderStatus();
  renderProviderStatus();
  applyRecordReadiness();
}

function renderProviderStatus() {
  if (!providerStatusText || !currentProviderStatus) return;
  providerStatusText.textContent = t("status.providerMode", {
    mode: t(`provider.mode.${currentProviderStatus.mode}`),
    asr: currentProviderStatus.asr.label
  });
}

function getCurrentRecordReadiness() {
  return getRecordReadiness({
    hasMediaDevicesApi: Boolean(navigator.mediaDevices?.getUserMedia),
    providerStatus: currentProviderStatus || currentSettings?.providerStatus
  });
}

function applyRecordReadiness() {
  const readiness = getCurrentRecordReadiness();
  renderRecordReadiness(readiness);

  if (!readiness.ready && !isRecording) {
    showRecordReadinessReason(readiness);
  }

  return readiness;
}

function ensureRecordReady() {
  const readiness = getCurrentRecordReadiness();
  renderRecordReadiness(readiness);
  if (readiness.ready) return true;

  showRecordReadinessReason(readiness);
  return false;
}

function renderRecordReadiness(readiness) {
  recordButton.disabled = !readiness.ready && !isRecording;
  recordButton.title = readiness.ready ? "" : getRecordDisabledMessage(readiness);
}

function showRecordReadinessReason(readiness) {
  const message = getRecordDisabledMessage(readiness);
  recordButton.title = message;
  setStatus(message);
}

function getRecordDisabledMessage(readiness) {
  return t(`record.disabled.${readiness.reason}`);
}

function showLocalModelInstallCommand() {
  localModelInstallCommand.hidden = false;
  setStatus(t("model.installCommandShown"));
}

function setSettingsDrawer(open) {
  settingsDrawer.classList.toggle("open", open);
  settingsDrawer.setAttribute("aria-hidden", open ? "false" : "true");
}

function closeSettingsFromBackdrop(event) {
  if (event.target?.dataset?.closeSettings === "true") {
    setSettingsDrawer(false);
  }
}

async function toggleRecording() {
  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    await saveSettingsFromCurrentForm({ updateStatus: false });
    if (!ensureRecordReady()) return;

    recorder = new WavRecorder();
    await recorder.start();
    isRecording = true;
    document.body.classList.add("recording");
    updateRecordLabel();
    setStatus(t("status.recording"));
  } catch (error) {
    setStatus(describeMicrophoneError(error));
  }
}

async function stopRecording() {
  try {
    isRecording = false;
    document.body.classList.remove("recording");
    updateRecordLabel();
    setStatus(t("status.preparing"));

    const wav = await recorder.stop();
    recorder = null;

    const entry = await window.localFlow.processWav(wav);
    resultText.dataset.emptyResult = "false";
    resultText.textContent = entry.text;
    await renderHistory();
  } catch (error) {
    setStatus(error.message);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  await saveSettingsFromCurrentForm();
}

async function saveSettingsFromCurrentForm({ updateStatus = true } = {}) {
  const data = new FormData(form);
  const next = {
    interfaceLanguage: data.get("interfaceLanguage"),
    whisperCliPath: data.get("whisperCliPath"),
    whisperModelPath: data.get("whisperModelPath"),
    whisperLanguage: data.get("whisperLanguage"),
    outputLanguage: data.get("outputLanguage"),
    hotkey: data.get("hotkey"),
    pasteAfterTranscribe: form.pasteAfterTranscribe.checked,
    polishMode: data.get("polishMode"),
    ollamaEnabled: form.ollamaEnabled.checked,
    ollamaBaseUrl: data.get("ollamaBaseUrl"),
    ollamaModel: data.get("ollamaModel"),
    llmProvider: data.get("llmProvider"),
    embeddedLlmCliPath: data.get("embeddedLlmCliPath"),
    embeddedLlmModelPath: data.get("embeddedLlmModelPath"),
    dictionary: data.get("dictionary")
  };

  currentSettings = await window.localFlow.saveSettings(next);
  currentLanguage = normalizeInterfaceLanguage(currentSettings.interfaceLanguage);
  applyInterfaceLanguage(currentLanguage);
  fillSettings(currentSettings);
  if (updateStatus) {
    setStatus(t("status.settingsSaved", { hotkey: formatHotkey(currentSettings.hotkey) }));
  }
  await refreshProviderStatus();
  await renderLocalModelStatus();
}

function fillSettings(settings) {
  for (const [key, value] of Object.entries(settings)) {
    const field = form.elements[key];
    if (!field) continue;

    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else if (key === "dictionary") {
      field.value = Array.isArray(value) ? value.join("\n") : "";
    } else {
      field.value = value ?? "";
    }
  }
}

async function renderHistory() {
  const history = await window.localFlow.listHistory();

  if (!history.length) {
    historyList.innerHTML = `<p class="empty">${escapeHtml(t("empty.history"))}</p>`;
    return;
  }

  historyList.innerHTML = history.map((item) => `
    <article class="history-item">
      <time>${new Date(item.createdAt).toLocaleString()}</time>
      <p>${escapeHtml(item.text)}</p>
    </article>
  `).join("");
}

function applyInterfaceLanguage(language) {
  currentLanguage = normalizeInterfaceLanguage(language);
  document.documentElement.lang = currentLanguage;
  document.title = t("app.title");

  const selectedValues = readLanguageSelections();
  populateLanguageSelects(selectedValues);

  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }

  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }

  renderProviderStatus();
  updateRecordLabel();

  if (resultText.dataset.emptyResult === "true") {
    resultText.textContent = t("empty.result");
  }
}

function readLanguageSelections() {
  return {
    interfaceLanguage: form.interfaceLanguage?.value || currentSettings?.interfaceLanguage || defaultInterfaceLanguage,
    whisperLanguage: form.whisperLanguage?.value || currentSettings?.whisperLanguage || defaultWhisperLanguage,
    outputLanguage: form.outputLanguage?.value || currentSettings?.outputLanguage || defaultOutputLanguage
  };
}

function populateLanguageSelects(selectedValues) {
  setSelectOptions(
    form.interfaceLanguage,
    interfaceLanguages.map((language) => ({
      value: language.code,
      label: t(`language.interface.${language.code}`)
    })),
    selectedValues.interfaceLanguage
  );
  setSelectOptions(
    form.whisperLanguage,
    whisperLanguages.map((language) => ({
      value: language.code,
      label: t(`language.whisper.${language.code}`)
    })),
    selectedValues.whisperLanguage
  );
  setSelectOptions(
    form.outputLanguage,
    outputLanguages.map((language) => ({
      value: language.code,
      label: t(`language.output.${language.code}`)
    })),
    selectedValues.outputLanguage
  );
}

function setSelectOptions(select, options, selectedValue) {
  select.innerHTML = options.map((option) => (
    `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
  )).join("");
  select.value = selectedValue;
}

function updateRecordLabel() {
  recordLabel.textContent = isRecording ? t("record.stop") : t("record.start");
}

function setReadyStatus() {
  const hotkey = currentSettings?.hotkey || form.hotkey?.value || "CommandOrControl+Alt+Space";
  setStatus(t("status.ready", { hotkey: formatHotkey(hotkey) }));
  applyRecordReadiness();
}

function renderChecks(checks) {
  return checks.map((check) => `
    <div class="diagnostic ${check.status}">
      <strong>${escapeHtml(check.label)}</strong>
      <span>${escapeHtml(check.message)}</span>
    </div>
  `).join("");
}

function ensureMediaDevicesApi() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error("navigator.mediaDevices.getUserMedia is unavailable.");
    error.name = "SecurityError";
    throw error;
  }
}

function setStatus(message) {
  statusText.textContent = message;
}

function t(key, replacements = {}) {
  return getUiText(currentLanguage, key, replacements);
}

function formatHotkey(hotkey) {
  return String(hotkey).replace("CommandOrControl", "Ctrl").replace(/\+/g, " + ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

class WavRecorder {
  async start() {
    ensureMediaDevicesApi();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    this.audioContext = new AudioContext();
    this.sampleRate = this.audioContext.sampleRate;
    this.chunks = [];
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  async stop() {
    this.processor.disconnect();
    this.source.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
    await this.audioContext.close();

    const merged = mergeFloat32(this.chunks);
    const downsampled = downsample(merged, this.sampleRate, 16000);
    return encodeWav(downsampled, 16000);
  }
}

function mergeFloat32(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function downsample(buffer, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return buffer;
  }

  const ratio = sourceRate / targetRate;
  const length = Math.round(buffer.length / ratio);
  const result = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let j = start; j < end && j < buffer.length; j += 1) {
      sum += buffer[j];
      count += 1;
    }

    result[i] = count ? sum / count : 0;
  }

  return result;
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
