import { describeMicrophoneError } from "../shared/media-errors.js";
import { getRecordReadiness } from "./record-readiness.js";
import { getRecordRecoveryAction } from "./record-recovery-action.js";
import { createShortcutRecorder } from "./shortcut-recorder.js";
import { createFocusTrap } from "./focus-trap.js";
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
import { renderIcons } from "./icons.js";
import {
  createEditorState,
  normalizeViewPhase,
  projectHistory,
  replaceEditorText,
  restoreEditorText
} from "./main-view-state.js";

const form = document.querySelector("#settingsForm");
const recordButton = document.querySelector("#recordButton");
const recordLabel = document.querySelector("#recordLabel");
const recordRecovery = document.querySelector("#recordRecovery");
const recordRecoveryText = document.querySelector("#recordRecoveryText");
const recordRecoveryAction = document.querySelector("#recordRecoveryAction");
const statusText = document.querySelector("#statusText");
const providerStatusText = document.querySelector("#providerStatusText");
const resultText = document.querySelector("#resultText");
const historyList = document.querySelector("#historyList");
const recentHistoryList = document.querySelector("#recentHistoryList");
const refreshHistory = document.querySelector("#refreshHistory");
const dictationTab = document.querySelector("#dictationTab");
const historyTab = document.querySelector("#historyTab");
const dictationPanel = document.querySelector("#dictationPanel");
const historyPanel = document.querySelector("#historyPanel");
const openHistory = document.querySelector("#openHistory");
const viewAllHistory = document.querySelector("#viewAllHistory");
viewAllHistory.querySelector(".button-label").dataset.i18n = "action.viewAll";
const voiceCommandBar = document.querySelector("#voiceCommandBar");
const phaseStatus = voiceCommandBar.querySelector(".provider-status");
const footerHealth = document.querySelector("#footerHealth");
const footerCopyNodes = [...footerHealth.querySelectorAll("span:not([data-lucide])")];
const checkWhisper = document.querySelector("#checkWhisper");
const checkMicrophone = document.querySelector("#checkMicrophone");
const checkTextProvider = document.querySelector("#checkTextProvider");
const diagnosticsList = document.querySelector("#diagnosticsList");
const microphoneDiagnosticsList = document.querySelector("#microphoneDiagnosticsList");
const textDiagnosticsList = document.querySelector("#textDiagnosticsList");
const openSettings = document.querySelector("#openSettings");
const closeSettings = document.querySelector("#closeSettings");
const settingsDrawer = document.querySelector("#settingsDrawer");
const drawerPanel = settingsDrawer.querySelector(".drawer-panel");
const settingsSectionButtons = [...settingsDrawer.querySelectorAll("[data-settings-section]")];
const settingsPanels = [...settingsDrawer.querySelectorAll("[data-settings-panel]")];
const localModelStatus = document.querySelector("#localModelStatus");
const setupLocalModel = document.querySelector("#setupLocalModel");
const localModelInstallCommand = document.querySelector("#localModelInstallCommand");
const setupChecklist = document.querySelector("#setupChecklist");
const whisperSetupStatus = document.querySelector("#whisperSetupStatus");
const llmSetupTitle = document.querySelector("[data-setup-type='llm'] strong");
const llmSetupStatus = document.querySelector("#llmSetupStatus");
const installWhisper = document.querySelector("#installWhisper");
const installLlm = document.querySelector("#installLlm");
const refreshSetupStatus = document.querySelector("#refreshSetupStatus");
const cancelSetup = document.querySelector("#cancelSetup");
const setupOutput = document.querySelector("#setupOutput");
const copyResult = document.querySelector("#copyResult");
const insertResult = document.querySelector("#insertResult");
const restoreResult = document.querySelector("#restoreResult");
const shortcutCaptureButtons = [...document.querySelectorAll("[data-shortcut-target]")];
const WAVEFORM_BAR_COUNT = 24;

let recorder = null;
let isRecording = false;
let recordingLifecyclePhase = "idle";
let recordingOperationToken = 0;
let currentSettings = null;
let currentProviderStatus = null;
let currentSetupStatus = null;
let currentRecordRecoveryAction = null;
let isSetupBusy = false;
let activeSetupType = "";
let currentLanguage = defaultInterfaceLanguage;
let editorState = createEditorState();
let emptyEditorMessageKey = "empty.result";
let allHistory = [];
let recentHistoryCompact = window.innerHeight < 650;
let processingLanguageSaveQueue = Promise.resolve();
let processingLanguageErrorOwner = null;
const processingLanguageRequestVersions = {
  whisperLanguage: 0,
  outputLanguage: 0
};
const mainTabs = [dictationTab, historyTab];
const SETTINGS_SAVE_FAILED_MESSAGE = "Settings could not be saved.";
const ACTIVE_LANGUAGE_STATUS_PHASES = new Set([
  "starting",
  "recording",
  "stopping",
  "transcribing",
  "pasting"
]);
const shortcutRecorder = createShortcutRecorder({
  eventTarget: window,
  buttons: shortcutCaptureButtons,
  resolveField: (name) => form.elements[name],
  translate: (key, replacements) => t(key, replacements),
  onStatus: setStatus
});
const settingsFocusTrap = createFocusTrap({
  container: drawerPanel,
  onEscape: closeSettingsDrawer
});

prepareWindowsUiV3Markup();
init();

function prepareWindowsUiV3Markup() {
  attachTranslationToIconLabel(dictationTab, "tab.dictation");
  attachTranslationToIconLabel(historyTab, "tab.history");
  attachTranslationToIconLabel(restoreResult, "action.restore");
  attachTranslationToIconLabel(copyResult, "action.copy");
  attachTranslationToIconLabel(insertResult, "action.insert");
  attachTranslationToIconLabel(viewAllHistory, "action.viewAll");

  recordButton.removeAttribute("aria-live");
  phaseStatus.setAttribute("role", "status");
  phaseStatus.setAttribute("aria-live", "polite");
  phaseStatus.setAttribute("aria-atomic", "true");

  document.querySelector("#settingsSectionGeneral").dataset.i18n = "settings.general";
  document.querySelector("#settingsSectionShortcuts").dataset.i18n = "settings.shortcuts";
  document.querySelector("#settingsSectionModels").dataset.i18n = "settings.modelsPrivacy";
  document.querySelector("#settingsSectionAdvanced").dataset.i18n = "settings.advanced";
  footerCopyNodes[1].dataset.i18n = "hint.autoKeepsLanguage";

  const waveform = document.createElement("div");
  waveform.className = "waveform";
  waveform.setAttribute("aria-hidden", "true");
  waveform.replaceChildren(...Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
    const bar = document.createElement("span");
    bar.style.setProperty("--bar-index", String(index));
    return bar;
  }));
  voiceCommandBar.insertBefore(waveform, phaseStatus);
}

function attachTranslationToIconLabel(button, key) {
  button.dataset.i18nTitle = key;
  button.dataset.i18nAriaLabel = key;

  const existingLabel = button.querySelector(".button-label");
  if (existingLabel) {
    existingLabel.dataset.i18n = key;
    return;
  }

  const textNode = [...button.childNodes].find((node) => (
    node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== ""
  ));
  if (!textNode) return;

  const label = document.createElement("span");
  label.className = "button-label";
  label.dataset.i18n = key;
  label.textContent = textNode.textContent.trim();
  textNode.replaceWith(label);
}

async function init() {
  currentSettings = await window.localFlow.getSettings();
  currentLanguage = normalizeInterfaceLanguage(currentSettings.interfaceLanguage);
  applyInterfaceLanguage(currentLanguage);
  fillSettings(currentSettings);
  setViewPhase("idle");
  renderEditorState();
  activateTab(dictationTab);
  setReadyStatus();
  recordButton.addEventListener("click", toggleRecording);
  recordRecoveryAction.addEventListener("click", applyRecordRecoveryAction);
  openSettings.addEventListener("click", () => openSettingsDrawer());
  closeSettings.addEventListener("click", closeSettingsDrawer);
  settingsDrawer.addEventListener("click", closeSettingsFromBackdrop);
  for (const button of settingsSectionButtons) {
    button.addEventListener("click", () => activateSettingsSection(button.dataset.settingsSection));
    button.addEventListener("keydown", handleSettingsSectionKeydown);
  }
  refreshHistory.addEventListener("click", renderHistory);
  viewAllHistory.addEventListener("click", () => activateTab(historyTab));
  openHistory?.addEventListener("click", () => activateTab(historyTab));
  for (const tab of mainTabs) {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", handleTabKeydown);
  }
  recentHistoryList.addEventListener("click", handleHistoryAction);
  historyList.addEventListener("click", handleHistoryAction);
  window.addEventListener("resize", handleRecentHistoryResize);
  checkWhisper.addEventListener("click", runWhisperDiagnostics);
  checkMicrophone.addEventListener("click", runMicrophoneDiagnostics);
  checkTextProvider.addEventListener("click", runTextProviderDiagnostics);
  setupLocalModel.addEventListener("click", showLocalModelInstallCommand);
  installWhisper.addEventListener("click", () => runModelSetup("whisper"));
  installLlm.addEventListener("click", () => runModelSetup("llm"));
  refreshSetupStatus.addEventListener("click", refreshSetupStatusAndSettings);
  cancelSetup.addEventListener("click", cancelActiveModelSetup);
  copyResult.addEventListener("click", copyLatestResult);
  insertResult.addEventListener("click", insertLatestResult);
  restoreResult.addEventListener("click", restoreLatestResult);
  resultText.addEventListener("blur", () => renderEditorState());
  resultText.addEventListener("input", updateEditorFromInput);
  form.interfaceLanguage.addEventListener("change", changeInterfaceLanguage);
  form.whisperLanguage.addEventListener("change", changeProcessingLanguage);
  form.outputLanguage.addEventListener("change", changeProcessingLanguage);
  form.llmProvider.addEventListener("change", refreshProcessingProviderPreview);
  form.addEventListener("submit", saveSettings);
  for (const button of shortcutCaptureButtons) {
    button.addEventListener("click", () => shortcutRecorder.start(button));
  }
  window.localFlow.onShortcutToggle(toggleRecording);
  window.localFlow.onRecordingStart(startRecording);
  window.localFlow.onRecordingStop(stopRecording);
  window.localFlow.onRecordingReset(resetRecordingLifecycle);
  window.localFlow.onOpenSettings?.(() => {
    setSettingsDrawer(true);
  });
  window.localFlow.onStatus(handleMainStatus);
  try {
    const latestStatus = await window.localFlow.getLatestStatus?.();
    if (latestStatus) {
      handleMainStatus(latestStatus);
    }
  } catch {
    // Live status remains subscribed if startup replay is unavailable.
  }

  await renderHistory();
  await renderLocalModelStatus();
  await refreshProviderStatus();
  await refreshSetupStatusView({ updateStatus: false });
}

function changeInterfaceLanguage() {
  currentLanguage = normalizeInterfaceLanguage(form.interfaceLanguage.value);
  applyInterfaceLanguage(currentLanguage);
  setReadyStatus();
  renderSetupChecklist();
  renderHistory();
}

function changeProcessingLanguage(event) {
  const field = event.currentTarget;
  const settingName = field.name;
  const requestedValue = field.value;
  const requestVersion = processingLanguageRequestVersions[settingName] + 1;
  processingLanguageRequestVersions[settingName] = requestVersion;

  processingLanguageSaveQueue = processingLanguageSaveQueue.then(() => (
    saveProcessingLanguage(field, settingName, requestedValue, requestVersion)
  ));
}

async function saveProcessingLanguage(field, settingName, requestedValue, requestVersion) {
  try {
    currentSettings = await window.localFlow.saveSettings({
      [settingName]: requestedValue
    });
    await refreshProviderStatus();
    await refreshSetupStatusView({ updateStatus: false });
    renderFooterHealth();
    clearOwnedLanguageSaveFailure(settingName, requestVersion);
  } catch {
    if (!isLatestProcessingLanguageRequest(settingName, requestVersion)) return;

    if (field.value === requestedValue) {
      field.value = currentSettings?.[settingName] ?? "auto";
    }
    processingLanguageErrorOwner = {
      field: settingName,
      version: requestVersion
    };
    setStatus(SETTINGS_SAVE_FAILED_MESSAGE);
    renderProviderStatus();
    renderSetupChecklist();
    renderFooterHealth();
  }
}

function isLatestProcessingLanguageRequest(settingName, requestVersion) {
  return processingLanguageRequestVersions[settingName] === requestVersion;
}

function clearOwnedLanguageSaveFailure(settingName, requestVersion) {
  const owner = processingLanguageErrorOwner;
  if (!owner || owner.field !== settingName || requestVersion <= owner.version) return;

  processingLanguageErrorOwner = null;
  if (statusText.textContent !== SETTINGS_SAVE_FAILED_MESSAGE) return;
  if (ACTIVE_LANGUAGE_STATUS_PHASES.has(document.body.dataset.phase)) return;
  setReadyStatus();
}

async function refreshProcessingProviderPreview() {
  try {
    await saveSettingsFromCurrentForm({ updateStatus: false });
  } catch (error) {
    setStatus(error.message);
  }
}

function handleMainStatus(payload) {
  const phaseKeys = {
    starting: "status.preparing",
    recording: "status.recording",
    stopping: "status.preparing",
    transcribing: "status.transcribing",
    polishing: "status.polishing",
    pasting: "status.pasting",
    done: "status.done"
  };
  const key = phaseKeys[payload?.phase];

  setViewPhase(payload?.phase);
  if (key) {
    setStatus(t(key));
  } else if (payload?.phase === "idle") {
    setReadyStatus();
  }
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

async function runTextProviderDiagnostics() {
  try {
    setStatus(t("status.checkingTextProvider"));
    await saveSettingsFromCurrentForm({ updateStatus: false });
    const result = await window.localFlow.checkTextProvider();
    textDiagnosticsList.innerHTML = renderChecks(result.checks);
    setStatus(result.ready ? t("status.textProviderReady") : t("status.textProviderNeedsAttention"));
  } catch (error) {
    textDiagnosticsList.innerHTML = renderChecks([
      {
        label: t("diagnostic.textProvider"),
        status: "fail",
        message: error.message
      }
    ]);
    setStatus(t("status.textProviderFailed", { message: error.message }));
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
  renderSetupChecklist();
  applyRecordReadiness();
  renderFooterHealth();
}

function renderFooterHealth() {
  if (!footerHealth) return;

  const readiness = getCurrentRecordReadiness();
  const statusNode = footerCopyNodes[0];
  footerHealth.dataset.ready = String(readiness.ready);
  if (statusNode) {
    statusNode.textContent = readiness.ready
      ? t("status.localReady")
      : getRecordDisabledMessage(readiness);
  }
}

function renderProviderStatus() {
  if (!providerStatusText || !currentProviderStatus) return;
  providerStatusText.textContent = t("status.providerMode", {
    mode: t(`provider.mode.${currentProviderStatus.mode}`),
    asr: [currentProviderStatus.asr?.label, currentProviderStatus.text?.label]
      .filter(Boolean)
      .join(" + ")
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
  renderRecordRecovery(readiness);
}

function showRecordReadinessReason(readiness) {
  const message = getRecordDisabledMessage(readiness);
  recordButton.title = message;
  setStatus(message);
}

function getRecordDisabledMessage(readiness) {
  return t(`record.disabled.${readiness.reason}`);
}

function renderRecordRecovery(readiness) {
  currentRecordRecoveryAction = isRecording ? null : getRecordRecoveryAction(readiness);

  if (!currentRecordRecoveryAction) {
    recordRecovery.hidden = true;
    recordRecoveryText.textContent = "";
    recordRecoveryAction.textContent = "";
    recordRecoveryAction.disabled = false;
    return;
  }

  recordRecovery.hidden = false;
  recordRecoveryText.textContent = t(currentRecordRecoveryAction.messageKey);
  recordRecoveryAction.textContent = t(currentRecordRecoveryAction.labelKey);
  recordRecoveryAction.disabled = isSetupBusy && currentRecordRecoveryAction.type === "installWhisper";
}

async function applyRecordRecoveryAction() {
  const action = currentRecordRecoveryAction;
  if (!action) return;

  if (action.type === "installWhisper") {
    await runModelSetup("whisper");
    return;
  }

  if (action.type === "checkMicrophone") {
    await runMicrophoneDiagnostics();
    return;
  }

  if (action.type === "useAutoOutput") {
    form.outputLanguage.value = "auto";
    await saveSettingsFromCurrentForm();
    setStatus(t("record.recovery.autoApplied"));
    return;
  }

  openSettingsDrawer();
}

function showLocalModelInstallCommand() {
  localModelInstallCommand.hidden = false;
  setStatus(t("model.installCommandShown"));
}

async function refreshSetupStatusView({ updateStatus = true } = {}) {
  if (!window.localFlow.getModelSetupStatus) return;

  try {
    currentSetupStatus = await window.localFlow.getModelSetupStatus();
  } catch (error) {
    currentSetupStatus = createFailedSetupStatus(error);
    if (updateStatus) {
      setStatus(t("setup.failed"));
    }
  }
  renderSetupChecklist();
}

async function refreshSetupStatusAndSettings() {
  if (isSetupBusy) return;
  if (!window.localFlow.refreshModelSetupStatus) {
    await refreshSetupStatusView();
    return;
  }

  setSetupBusy(true);
  try {
    currentSetupStatus = await window.localFlow.refreshModelSetupStatus();
    await saveDetectedSetupPaths();
    renderSetupChecklist();
    await renderLocalModelStatus();
    await refreshProviderStatus();
    setStatus(t("setup.refreshed"));
  } catch (error) {
    setStatus(error.message);
  } finally {
    setSetupBusy(false);
  }
}

async function runModelSetup(type) {
  if (isSetupBusy) return;
  if (!window.localFlow.startModelSetup) return;

  setSetupBusy(true);
  activeSetupType = type;
  setStatus(t(type === "whisper" ? "setup.whisper.installing" : "setup.llm.installing"));

  const stopPolling = startSetupStatusPolling(type);
  try {
    const result = await window.localFlow.startModelSetup(type);
    if (result.status === "complete") {
      const refreshedStatus = window.localFlow.refreshModelSetupStatus
        ? await window.localFlow.refreshModelSetupStatus()
        : { ...currentSetupStatus, assets: result.assets };
      currentSetupStatus = mergeSetupResult(refreshedStatus, type, result);
      await saveDetectedSetupPaths();
    } else {
      const refreshedStatus = window.localFlow.getModelSetupStatus
        ? await window.localFlow.getModelSetupStatus()
        : { ...currentSetupStatus, assets: result.assets };
      currentSetupStatus = mergeSetupResult(refreshedStatus, type, result);
    }
    renderSetupChecklist();
    await renderLocalModelStatus();
    await refreshProviderStatus();
    setStatus(result.status === "complete"
      ? t(type === "whisper" ? "setup.whisper.complete" : "setup.llm.complete")
      : getSetupFailureMessage(result));
  } catch (error) {
    setStatus(error.message);
  } finally {
    stopPolling();
    activeSetupType = "";
    setSetupBusy(false);
  }
}

async function cancelActiveModelSetup() {
  if (!isSetupBusy || !activeSetupType || !window.localFlow.cancelModelSetup) return;

  setStatus(t("setup.cancelling"));
  try {
    const result = await window.localFlow.cancelModelSetup(activeSetupType);
    currentSetupStatus = mergeSetupResult(currentSetupStatus, activeSetupType, result);
    renderSetupChecklist();
    setStatus(getSetupFailureMessage(result, "setup.cancelled"));
  } catch (error) {
    setStatus(error.message);
  }
}

function startSetupStatusPolling(type) {
  if (!window.localFlow.getModelSetupStatus) {
    return () => {};
  }

  currentSetupStatus = mergeSetupResult(currentSetupStatus, type, {
    type,
    status: "running",
    output: [],
    error: ""
  });
  renderSetupChecklist();

  const interval = window.setInterval(async () => {
    try {
      currentSetupStatus = await window.localFlow.getModelSetupStatus();
      renderSetupChecklist();
    } catch {
      // Keep the last visible setup state while the setup process is still running.
    }
  }, 1000);

  return () => window.clearInterval(interval);
}

function mergeSetupResult(status, type, result) {
  return {
    ...(status || {}),
    assets: status?.assets || result.assets || {},
    setups: {
      ...(status?.setups || {}),
      [type]: result
    }
  };
}

async function saveDetectedSetupPaths() {
  const assets = currentSetupStatus?.assets || {};
  const next = {};

  if (assets.whisper?.whisperCliPath) next.whisperCliPath = assets.whisper.whisperCliPath;
  if (assets.whisper?.whisperModelPath) next.whisperModelPath = assets.whisper.whisperModelPath;
  if (assets.llm?.cliPath) next.embeddedLlmCliPath = assets.llm.cliPath;
  if (assets.llm?.modelPath) next.embeddedLlmModelPath = assets.llm.modelPath;

  if (Object.keys(next).length) {
    currentSettings = await window.localFlow.saveSettings(next);
    fillSettings(currentSettings);
  }
}

function renderSetupChecklist() {
  if (!currentSetupStatus || !setupChecklist) return;

  const whisperReady = Boolean(
    currentSetupStatus.assets?.whisper?.whisperCliPath &&
    currentSetupStatus.assets?.whisper?.whisperModelPath
  );
  const llmReady = Boolean(currentSetupStatus.assets?.llm?.ready);
  const whisperStatus = currentSetupStatus.setups?.whisper?.status || "idle";
  const llmStatus = currentSetupStatus.setups?.llm?.status || "idle";
  const whisperSetup = currentSetupStatus.setups?.whisper || {};
  const llmSetup = currentSetupStatus.setups?.llm || {};
  const textSetupState = getTextSetupState(llmReady, llmStatus, llmSetup);

  whisperSetupStatus.textContent = getSetupStatusText("whisper", whisperReady, whisperStatus, whisperSetup);
  llmSetupTitle.textContent = t(`model.provider.${textSetupState.provider}`);
  llmSetupStatus.textContent = textSetupState.statusText || t(textSetupState.statusKey);
  setupChecklist.dataset.whisperReady = String(whisperReady);
  setupChecklist.dataset.llmReady = String(textSetupState.ready);
  installWhisper.hidden = whisperReady;
  installLlm.hidden = !textSetupState.showInstall;
  installWhisper.disabled = isSetupBusy || whisperStatus === "running";
  installLlm.disabled = isSetupBusy || llmStatus === "running";
  refreshSetupStatus.disabled = isSetupBusy;
  cancelSetup.hidden = !isSetupBusy;
  cancelSetup.disabled = !isSetupBusy;
  renderSetupOutput(getActiveSetupStatus(whisperStatus, llmStatus));
}

function getTextSetupState(llmReady, llmStatus, setup = {}) {
  const provider = currentSettings?.llmProvider || form.llmProvider?.value || "mymemory";

  if (provider === "embedded") {
    return {
      provider,
      ready: llmReady,
      showInstall: !llmReady,
      statusKey: getSetupStatusKey("llm", llmReady, llmStatus),
      statusText: getSetupStatusText("llm", llmReady, llmStatus, setup)
    };
  }

  if (provider === "ollama") {
    const ready = Boolean(currentProviderStatus?.text?.ready);
    return {
      provider,
      ready,
      showInstall: false,
      statusKey: ready ? "setup.text.ollama.ready" : "setup.text.ollama.missing"
    };
  }

  return {
    provider: "mymemory",
    ready: true,
    showInstall: false,
    statusKey: "setup.text.mymemory.ready"
  };
}

function getActiveSetupStatus(whisperStatus, llmStatus) {
  if (whisperStatus === "running") return currentSetupStatus.setups?.whisper;
  if (llmStatus === "running") return currentSetupStatus.setups?.llm;
  const setups = [currentSetupStatus.setups?.whisper, currentSetupStatus.setups?.llm]
    .filter((setup) => setup?.completedAt || setup?.output?.length);
  return setups.at(-1) || null;
}

function renderSetupOutput(setup) {
  if (!setupOutput) return;

  const lines = getVisibleSetupOutput(setup);
  if (!lines.length) {
    setupOutput.hidden = true;
    setupOutput.textContent = "";
    return;
  }

  setupOutput.hidden = false;
  setupOutput.textContent = lines.join("\n");
}

function getVisibleSetupOutput(setup) {
  const lines = (setup?.output || [])
    .map(sanitizeSetupOutputLine)
    .filter(Boolean)
    .slice(-8);

  if (!lines.length && setup?.status === "running") {
    return [t("setup.progress.wait")];
  }
  return lines;
}

function sanitizeSetupOutputLine(line) {
  const text = String(line || "").trim();
  if (!text) return "";
  if (/[A-Za-z]:\\/.test(text)) return "";
  if (/Paste these paths/i.test(text)) return "";
  return text;
}

function setSetupBusy(busy) {
  isSetupBusy = busy;
  renderSetupChecklist();
  applyRecordReadiness();
}

function createFailedSetupStatus(error) {
  const message = error?.message || t("setup.failed");
  return {
    assets: currentSetupStatus?.assets || {},
    setups: {
      whisper: { type: "whisper", status: "failed", output: [], error: message },
      llm: { type: "llm", status: "failed", output: [], error: message }
    }
  };
}

function getSetupStatusKey(type, ready, status) {
  if (ready) return `setup.${type}.ready`;
  if (status === "running") return `setup.${type}.installing`;
  if (status === "failed") return `setup.${type}.failed`;
  return `setup.${type}.missing`;
}

function getSetupStatusText(type, ready, status, setup) {
  if (!ready && status === "failed") {
    return getSetupFailureMessage(setup, `setup.${type}.failed`);
  }
  return t(getSetupStatusKey(type, ready, status));
}

function getSetupFailureMessage(setup, fallbackKey = "setup.failed") {
  if (setup?.failureReason) {
    const message = t(`setup.failure.${setup.failureReason}`);
    if (message !== `setup.failure.${setup.failureReason}`) {
      return message;
    }
  }
  return setup?.error || t(fallbackKey);
}

async function copyLatestResult() {
  if (editorState.empty) return;

  try {
    await writeClipboardText(editorState.currentText);
    setStatus(t("status.copied"));
  } catch {
    setStatus(t("status.copyFailed"));
  }
}

async function insertLatestResult() {
  if (editorState.empty) return;
  await insertText(editorState.currentText);
}

async function insertText(text) {
  if (typeof text !== "string" || text === "") return false;

  try {
    const result = await window.localFlow.insertText(text);
    if (result?.ok === false || result?.success === false) {
      setStatus(getSafeUiText("status.insertFailed", "Text could not be inserted."));
      return false;
    }
    setStatus(getSafeUiText("status.inserted", "Text inserted."));
    return true;
  } catch {
    setStatus(getSafeUiText("status.insertFailed", "Text could not be inserted."));
    return false;
  }
}

function restoreLatestResult() {
  if (!editorState.dirty || editorState.empty) return;
  editorState = restoreEditorText(editorState);
  renderEditorState();
}

function updateEditorFromInput() {
  emptyEditorMessageKey = "empty.result";
  editorState = replaceEditorText(editorState, resultText.textContent || "");
  renderEditorState({ syncText: false });
}

function replaceEditorBaseline(text, emptyMessageKey = "empty.result") {
  emptyEditorMessageKey = emptyMessageKey;
  editorState = replaceEditorText(editorState, text, { asBaseline: true });
  renderEditorState();
}

function renderEditorState({ syncText = true } = {}) {
  if (syncText) {
    resultText.textContent = editorState.currentText;
  }
  if (editorState.empty) {
    resultText.setAttribute("aria-placeholder", t(emptyEditorMessageKey));
  } else {
    resultText.removeAttribute("aria-placeholder");
  }
  resultText.dataset.emptyResult = String(editorState.empty);
  resultText.dataset.characterCount = String(editorState.characterCount);
  restoreResult.disabled = !editorState.dirty || editorState.empty;
  copyResult.disabled = editorState.empty;
  insertResult.disabled = editorState.empty;
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the focused-document copy path below.
    }
  }

  if (copyTextWithTextarea(text)) return;
  throw new Error("Copy failed.");
}

function copyTextWithTextarea(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function openSettingsDrawer(section = "general") {
  const wasOpen = settingsDrawer.classList.contains("open");
  settingsDrawer.inert = false;
  settingsDrawer.classList.add("open");
  settingsDrawer.setAttribute("aria-hidden", "false");
  activateSettingsSection(section);
  if (!wasOpen) settingsFocusTrap.activate();
}

function setSettingsDrawer(open, section = "general") {
  if (open) openSettingsDrawer(section);
  else closeSettingsDrawer();
}

function closeSettingsDrawer() {
  if (!settingsDrawer.classList.contains("open")) return;

  settingsFocusTrap.deactivate();
  const returnFocus = settingsFocusTrap.getReturnFocus();
  shortcutRecorder.cancel();
  let focusedReturnTarget = focusSettingsReturnTarget(returnFocus);
  if (settingsDrawer.contains(document.activeElement)) {
    document.activeElement.blur?.();
  }

  settingsDrawer.classList.remove("open");
  settingsDrawer.setAttribute("aria-hidden", "true");
  settingsDrawer.inert = true;

  if (document.activeElement !== focusedReturnTarget) {
    focusedReturnTarget = focusSettingsReturnTarget(focusedReturnTarget);
  }
  if (!focusedReturnTarget && settingsDrawer.contains(document.activeElement)) {
    document.activeElement.blur?.();
  }
}

function focusSettingsReturnTarget(preferredTarget) {
  for (const target of new Set([preferredTarget, openSettings])) {
    if (!isSafeSettingsReturnTarget(target)) continue;
    try {
      target.focus({ preventScroll: true });
    } catch {
      continue;
    }
    if (document.activeElement === target) return target;
  }
  return null;
}

function isSafeSettingsReturnTarget(target) {
  if (!target?.isConnected || typeof target.focus !== "function") return false;
  if (settingsDrawer.contains(target) || target.matches(":disabled")) return false;
  if (target.closest('[hidden], [inert], [aria-hidden="true"]')) return false;

  const style = target.ownerDocument?.defaultView?.getComputedStyle(target);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function activateSettingsSection(section) {
  const activeSection = settingsSectionButtons.some((button) => button.dataset.settingsSection === section)
    ? section
    : "general";

  for (const button of settingsSectionButtons) {
    const selected = button.dataset.settingsSection === activeSection;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.tabIndex = selected ? 0 : -1;
  }

  for (const panel of settingsPanels) {
    panel.hidden = panel.dataset.settingsPanel !== activeSection;
  }
}

function handleSettingsSectionKeydown(event) {
  const currentIndex = settingsSectionButtons.indexOf(event.currentTarget);
  if (currentIndex < 0) return;

  let nextIndex = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % settingsSectionButtons.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + settingsSectionButtons.length) % settingsSectionButtons.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = settingsSectionButtons.length - 1;
  }

  if (nextIndex === null) return;
  event.preventDefault();
  const nextButton = settingsSectionButtons[nextIndex];
  activateSettingsSection(nextButton.dataset.settingsSection);
  nextButton.focus();
}

function closeSettingsFromBackdrop(event) {
  if (event.target?.dataset?.closeSettings === "true") {
    closeSettingsDrawer();
  }
}

async function toggleRecording() {
  if (recordingLifecyclePhase === "recording") {
    await stopRecording();
  } else if (recordingLifecyclePhase === "idle") {
    await startRecording();
  }
}

async function startRecording() {
  if (recordingLifecyclePhase !== "idle") return;

  const operationToken = beginRecordingOperation("starting");
  reportRecordingLifecycle({ phase: "starting", message: t("status.preparing") });

  try {
    await saveSettingsFromCurrentForm({ updateStatus: false });
    if (!isCurrentRecordingOperation(operationToken)) return;

    if (!ensureRecordReady()) {
      const message = recordButton.title || statusText.textContent || "Recording is not ready.";
      setRecordingLifecyclePhase("idle");
      setViewPhase("error");
      reportRecordingLifecycle({
        phase: "error",
        reason: "not_ready",
        message
      });
      return;
    }

    const nextRecorder = new WavRecorder();
    recorder = nextRecorder;
    await nextRecorder.start();
    if (!isCurrentRecordingOperation(operationToken)) {
      cleanupRecorder(nextRecorder);
      return;
    }

    isRecording = true;
    setRecordingLifecyclePhase("recording");
    document.body.classList.add("recording");
    updateRecordLabel();
    setStatus(t("status.recording"));
    reportRecordingLifecycle({ phase: "recording", message: t("status.recording") });
  } catch (error) {
    if (!isCurrentRecordingOperation(operationToken)) return;

    const message = describeMicrophoneError(error);
    setStatus(message);
    cleanupRecorder();
    isRecording = false;
    setRecordingLifecyclePhase("idle");
    setViewPhase("error");
    document.body.classList.remove("recording");
    updateRecordLabel();
    applyRecordReadiness();
    reportRecordingLifecycle({ phase: "error", message });
  }
}

async function stopRecording() {
  if (recordingLifecyclePhase !== "recording") return;

  const operationToken = beginRecordingOperation("stopping");
  reportRecordingLifecycle({ phase: "stopping", message: t("status.preparing") });

  try {
    isRecording = false;
    document.body.classList.remove("recording");
    updateRecordLabel();
    applyRecordReadiness();
    setStatus(t("status.preparing"));
    reportRecordingLifecycle({ phase: "transcribing", message: t("status.preparing") });
    setRecordingLifecyclePhase("transcribing");

    const activeRecorder = recorder;
    const wav = await activeRecorder.stop();
    if (!isCurrentRecordingOperation(operationToken)) return;

    if (recorder === activeRecorder) {
      recorder = null;
    }

    const entry = await window.localFlow.processWav(wav);
    if (!isCurrentRecordingOperation(operationToken)) return;

    renderDictationResult(entry);
    await renderHistory();
    if (!isCurrentRecordingOperation(operationToken)) return;

    setRecordingLifecyclePhase("idle");
    setViewPhase(entry?.status === "failed" ? "warning" : "done");
  } catch (error) {
    if (!isCurrentRecordingOperation(operationToken)) return;

    setStatus(error.message);
    cleanupRecorder();
    isRecording = false;
    setRecordingLifecyclePhase("idle");
    setViewPhase("error");
    document.body.classList.remove("recording");
    updateRecordLabel();
    applyRecordReadiness();
    reportRecordingLifecycle({ phase: "error", message: error.message });
  }
}

function renderDictationResult(entry) {
  if (entry?.status === "failed") {
    replaceEditorBaseline("", "result.outputFailed");
    setStatus(t("status.outputFailed", {
      message: entry.processingError || "Unknown text model error."
    }));
    return;
  }

  replaceEditorBaseline(entry?.text || "");
}

async function saveSettings(event) {
  event.preventDefault();
  shortcutRecorder.stop();
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
    shortcutMode: data.get("shortcutMode"),
    pasteLastHotkey: data.get("pasteLastHotkey"),
    globalShortcutPaused: form.globalShortcutPaused.checked,
    launchAtLogin: form.launchAtLogin.checked,
    startMinimizedToTray: form.startMinimizedToTray.checked,
    pasteAfterTranscribe: form.pasteAfterTranscribe.checked,
    polishMode: data.get("polishMode"),
    ollamaEnabled: form.ollamaEnabled.checked,
    ollamaBaseUrl: data.get("ollamaBaseUrl"),
    ollamaModel: data.get("ollamaModel"),
    llmProvider: data.get("llmProvider"),
    embeddedLlmCliPath: data.get("embeddedLlmCliPath"),
    embeddedLlmModelPath: data.get("embeddedLlmModelPath"),
    whisperRuntimeUrl: data.get("whisperRuntimeUrl"),
    whisperRuntimeMirrorUrls: data.get("whisperRuntimeMirrorUrls"),
    whisperModelUrl: data.get("whisperModelUrl"),
    whisperModelMirrorUrls: data.get("whisperModelMirrorUrls"),
    llamaRuntimeUrl: data.get("llamaRuntimeUrl"),
    llamaRuntimeMirrorUrls: data.get("llamaRuntimeMirrorUrls"),
    qwenModelUrl: data.get("qwenModelUrl"),
    qwenModelMirrorUrls: data.get("qwenModelMirrorUrls"),
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
  allHistory = Array.isArray(history) ? history : [];

  if (!allHistory.length) {
    historyList.innerHTML = `<p class="empty">${escapeHtml(t("empty.history"))}</p>`;
    recentHistoryList.innerHTML = `<p class="empty">${escapeHtml(t("empty.history"))}</p>`;
    return;
  }

  renderRecentHistory();
  renderFullHistory();
}

function renderRecentHistory() {
  const limit = recentHistoryCompact ? 2 : 3;
  const recent = projectHistory(allHistory, limit);

  recentHistoryList.innerHTML = recent.length
    ? recent.map((item) => renderHistoryItem(item, { recent: true })).join("")
    : `<p class="empty">${escapeHtml(t("empty.history"))}</p>`;
  renderIcons(recentHistoryList);
}

function handleRecentHistoryResize() {
  const nextCompact = window.innerHeight < 650;
  if (nextCompact === recentHistoryCompact) return;

  recentHistoryCompact = nextCompact;
  renderRecentHistory();
}

function renderFullHistory() {
  historyList.innerHTML = allHistory
    .map((item, index) => renderHistoryItem(item, { index }))
    .join("");
  renderIcons(historyList);
}

function renderHistoryItem(item, { index = -1, recent = false } = {}) {
  const text = typeof item?.text === "string" ? item.text : "";
  const usable = item?.status === "complete" && text !== "";
  const id = recent ? item.id : historyEntryId(item, index);
  const resolvedIndex = recent ? findHistoryEntryIndex(id) : index;
  const preview = usable
    ? singleLineText(text)
    : t(item?.status === "failed" ? "result.outputFailed" : "empty.result");
  const count = usable ? Array.from(text).length : 0;
  const disabled = usable ? "" : " disabled";
  const actionLabel = recent ? preview : formatHistoryTime(item?.createdAt);

  return `
    <article class="history-item" data-history-item data-history-status="${escapeHtml(item?.status || "empty")}">
      <button
        type="button"
        class="history-select"
        data-history-action="select"
        data-history-id="${escapeHtml(id)}"
        data-history-index="${resolvedIndex}"
        aria-label="${escapeHtml(actionLabel || preview)}"
        ${disabled}
      >
        <time>${escapeHtml(formatHistoryTime(item?.createdAt))}</time>
        <p>${escapeHtml(preview)}</p>
        <span data-history-character-count>${escapeHtml(t("label.characterCount", { count }))}</span>
        <span data-lucide="ChevronRight" aria-hidden="true"></span>
      </button>
      ${recent ? "" : `
        <div class="button-row">
          <button
            type="button"
            class="ghost"
            data-history-action="copy"
            data-history-id="${escapeHtml(id)}"
            data-history-index="${resolvedIndex}"
            ${disabled}
          >${escapeHtml(t("action.copy"))}</button>
          <button
            type="button"
            class="ghost"
            data-history-action="insert"
            data-history-id="${escapeHtml(id)}"
            data-history-index="${resolvedIndex}"
            ${disabled}
          >${escapeHtml(insertResult.textContent.trim() || "Insert")}</button>
        </div>
      `}
    </article>
  `;
}

async function handleHistoryAction(event) {
  const actionButton = event.target.closest?.("[data-history-action]");
  if (!actionButton || actionButton.disabled) return;

  const entry = allHistory[Number(actionButton.dataset.historyIndex)];
  const text = typeof entry?.text === "string" ? entry.text : "";
  if (entry?.status !== "complete" || text === "") return;

  if (actionButton.dataset.historyAction === "select") {
    replaceEditorBaseline(text);
    activateTab(dictationTab);
    return;
  }

  if (actionButton.dataset.historyAction === "copy") {
    try {
      await writeClipboardText(text);
      setStatus(t("status.copied"));
    } catch {
      setStatus(t("status.copyFailed"));
    }
    return;
  }

  if (actionButton.dataset.historyAction === "insert") {
    await insertText(text);
  }
}

function historyEntryId(entry, index) {
  return typeof entry?.id === "string" && entry.id.trim() !== ""
    ? entry.id
    : `${typeof entry?.createdAt === "string" ? entry.createdAt : ""}:${index}`;
}

function findHistoryEntryIndex(id) {
  return allHistory.findIndex((entry, index) => historyEntryId(entry, index) === id);
}

function singleLineText(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function formatHistoryTime(createdAt) {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(currentLanguage);
}

function activateTab(activeTab, { focus = false } = {}) {
  for (const tab of mainTabs) {
    const selected = tab === activeTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }

  dictationPanel.hidden = activeTab !== dictationTab;
  historyPanel.hidden = activeTab !== historyTab;
  if (focus) activeTab.focus();
}

function handleTabKeydown(event) {
  const currentIndex = mainTabs.indexOf(event.currentTarget);
  let nextIndex = currentIndex;

  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % mainTabs.length;
  else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + mainTabs.length) % mainTabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = mainTabs.length - 1;
  else return;

  event.preventDefault();
  activateTab(mainTabs[nextIndex], { focus: true });
}

function applyInterfaceLanguage(language) {
  currentLanguage = normalizeInterfaceLanguage(language);
  document.documentElement.lang = currentLanguage;
  document.title = t("app.title");

  const selectedValues = readLanguageSelections();
  populateLanguageSelects(selectedValues);

  applyTranslations();
  renderIcons();

  renderProviderStatus();
  renderSetupChecklist();
  updateRecordLabel();
  shortcutRecorder.refreshLabels();

  renderEditorState();
}

function applyTranslations(root = document) {
  for (const element of root.querySelectorAll("[data-i18n]")) {
    if (element === resultText) continue;
    element.textContent = t(element.dataset.i18n);
  }

  for (const element of root.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }

  for (const element of root.querySelectorAll("[data-i18n-title]")) {
    element.title = t(element.dataset.i18nTitle);
  }

  for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
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

function reportRecordingLifecycle(payload) {
  window.localFlow.reportRecordingStatus?.(payload);
}

function beginRecordingOperation(phase) {
  recordingOperationToken += 1;
  setRecordingLifecyclePhase(phase);
  return recordingOperationToken;
}

function isCurrentRecordingOperation(operationToken) {
  return operationToken === recordingOperationToken;
}

function resetRecordingLifecycle() {
  recordingOperationToken += 1;
  cleanupRecorder();
  isRecording = false;
  setRecordingLifecyclePhase("idle");
  document.body.classList.remove("recording");
  updateRecordLabel();
  applyRecordReadiness();
}

function cleanupRecorder(targetRecorder = recorder) {
  if (!targetRecorder) return;

  if (recorder === targetRecorder) {
    recorder = null;
  }

  targetRecorder.dispose?.();
}

function setRecordingLifecyclePhase(phase) {
  recordingLifecyclePhase = phase;
  setViewPhase(phase);
}

function setViewPhase(phase) {
  const normalizedPhase = normalizeViewPhase(phase);
  document.body.dataset.phase = normalizedPhase;
  voiceCommandBar.dataset.phase = normalizedPhase;
  phaseStatus.textContent = t(`phase.${normalizedPhase}`);
}

function t(key, replacements = {}) {
  return getUiText(currentLanguage, key, replacements);
}

function getSafeUiText(key, fallback) {
  const translated = t(key);
  return translated === key ? fallback : translated;
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
    await this.audioContext.audioWorklet.addModule(new URL("./audio-recorder-worklet.js", import.meta.url).href);
    this.processor = new AudioWorkletNode(this.audioContext, "wav-recorder-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    this.processor.port.onmessage = (event) => {
      this.chunks.push(new Float32Array(event.data));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  async stop() {
    this.processor.port.onmessage = null;
    this.processor.port.close();
    this.processor.disconnect();
    this.source.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
    await this.audioContext.close();

    const merged = mergeFloat32(this.chunks);
    const downsampled = downsample(merged, this.sampleRate, 16000);
    return encodeWav(downsampled, 16000);
  }

  dispose() {
    try {
      if (this.processor?.port) {
        this.processor.port.onmessage = null;
        this.processor.port.close();
      }
    } catch {}

    try {
      this.processor?.disconnect();
    } catch {}

    try {
      this.source?.disconnect();
    } catch {}

    try {
      this.stream?.getTracks().forEach((track) => track.stop());
    } catch {}

    try {
      this.audioContext?.close?.().catch(() => {});
    } catch {}
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
