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
import { createVersionedAutosave } from "./versioned-autosave.js";
import {
  createEditorState,
  normalizeViewPhase,
  pruneHistorySessionMaps,
  readContentEditableText,
  replaceEditorText,
  updateEditorBaseline
} from "./main-view-state.js";
import {
  filterHistory,
  groupHistoryByDate,
  hasDisplayableHistoryText,
  normalizeHistoryEntries,
  resolveHistorySelection
} from "./history-view-state.js";
import {
  PERSONALIZATION_LIMITS,
  normalizeDictionary,
  normalizeSnippets,
  personalizationComparisonKey
} from "../shared/personalization.js";

const form = document.querySelector("#settingsForm");
const recordButton = document.querySelector("#recordButton");
const recordLabel = document.querySelector("#recordLabel");
const recordRecovery = document.querySelector("#recordRecovery");
const recordRecoveryText = document.querySelector("#recordRecoveryText");
const recordRecoveryAction = document.querySelector("#recordRecoveryAction");
const statusText = document.querySelector("#statusText");
const providerStatusText = document.querySelector("#providerStatusText");
const resultText = document.querySelector("#resultText");
const resultCharacterCount = document.querySelector("#resultCharacterCount");
const editorCreatedAt = document.querySelector("#editorCreatedAt");
const editorSaveState = document.querySelector("#editorSaveState");
const editorFooter = document.querySelector("#editorFooter");
const editorContextText = document.querySelector("#editorContextText");
const editorBack = document.querySelector("#editorBack");
const historyList = document.querySelector("#historyList");
const historySearch = document.querySelector("#historySearch");
const globalSearch = document.querySelector("#globalSearch");
const commandPolishMode = document.querySelector("#commandPolishMode");
const primaryNavigation = document.querySelector("#primaryNavigation");
const navHome = document.querySelector("#navHome");
const navHistory = document.querySelector("#navHistory");
const navDictionary = document.querySelector("#navDictionary");
const navSnippets = document.querySelector("#navSnippets");
const navSettings = document.querySelector("#navSettings");
const primaryNavigationButtons = [navHome, navHistory, navDictionary, navSnippets, navSettings];
const contentNavigationButtons = [navHome, navHistory, navDictionary, navSnippets];
const appTopbar = document.querySelector("#appTopbar");
const commandStrip = document.querySelector("#commandStrip");
const workspacePage = document.querySelector("#workspacePage");
const dictionaryPage = document.querySelector("#dictionaryPage");
const dictionarySearch = document.querySelector("#dictionarySearch");
const dictionaryList = document.querySelector("#dictionaryList");
const dictionaryAdd = document.querySelector("#dictionaryAdd");
const dictionaryStatus = document.querySelector("#dictionaryStatus");
const snippetsPage = document.querySelector("#snippetsPage");
const snippetSearch = document.querySelector("#snippetSearch");
const snippetList = document.querySelector("#snippetList");
const snippetAdd = document.querySelector("#snippetAdd");
const snippetStatus = document.querySelector("#snippetStatus");
const manageDictionary = document.querySelector("#manageDictionary");
const phaseStatus = commandStrip.querySelector(".provider-status");
const shortcutHintText = document.querySelector(".shortcut-hint span:last-child");
const resultActions = document.querySelector("#editorPane .button-row");
const headerHealthText = document.querySelector("#headerHealthText");
const checkWhisper = document.querySelector("#checkWhisper");
const checkMicrophone = document.querySelector("#checkMicrophone");
const checkTextProvider = document.querySelector("#checkTextProvider");
const diagnosticsList = document.querySelector("#diagnosticsList");
const microphoneDiagnosticsList = document.querySelector("#microphoneDiagnosticsList");
const textDiagnosticsList = document.querySelector("#textDiagnosticsList");
const closeSettings = document.querySelector("#closeSettings");
const settingsDrawer = document.querySelector("#settingsDrawer");
const drawerPanel = settingsDrawer.querySelector(".drawer-panel");
const settingsSectionNav = settingsDrawer.querySelector(".settings-section-tabs");
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
const reprocessResult = document.querySelector("#reprocessResult");
const shortcutCaptureButtons = [...document.querySelectorAll("[data-shortcut-target]")];
const WAVEFORM_BAR_COUNT = 24;

let recorder = null;
let isRecording = false;
let recordingLifecyclePhase = "idle";
let recordingOperationToken = 0;
let activeRecordingOperationId = null;
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
let historyQuery = "";
let selectedHistoryId = "";
let editorSavePhase = "saved";
let editorReprocessPhase = "idle";
let activePrimaryView = "home";
let editorRevision = 0;
let historyRefreshVersion = 0;
let historyInteractionVersion = 0;
let historySelectionVersion = 0;
let historyCommitVersion = 0;
let dictionaryQuery = "";
let snippetQuery = "";
let dictionaryEditor = null;
let snippetEditor = null;
let dictionaryStatusKey = "";
let snippetStatusKey = "";
const pendingPersonalizationFocus = {
  dictionary: null,
  snippets: null
};
const historyEditorSessions = new Map();
const historyReprocessVersions = new Map();
let settingsSaveQueue = Promise.resolve();
const personalizationSaveVersions = {
  dictionary: 0,
  snippets: 0
};
let processingLanguageErrorOwner = null;
const processingLanguageRequestVersions = {
  whisperLanguage: 0,
  outputLanguage: 0
};
const SETTINGS_SAVE_FAILED_KEY = "status.settingsSaveFailed";
const ACTIVE_LANGUAGE_STATUS_PHASES = new Set([
  "starting",
  "recording",
  "stopping",
  "transcribing",
  "polishing",
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
const historyAutosave = createVersionedAutosave({
  save: ({ id, text }) => window.localFlow.updateHistory(id, text),
  onState: handleHistoryAutosaveState,
  onCommit: handleHistoryAutosaveCommit
});

prepareWindowsUiV4Markup();
init();

function prepareWindowsUiV4Markup() {
  attachTranslationToIconLabel(navHome, "nav.home");
  attachTranslationToIconLabel(navHistory, "nav.history");
  attachTranslationToIconLabel(navDictionary, "nav.dictionary");
  attachTranslationToIconLabel(navSnippets, "nav.snippets");
  attachTranslationToIconLabel(navSettings, "nav.settings");
  attachTranslationToIconLabel(editorBack, "history.back");
  attachTranslationToIconLabel(restoreResult, "action.restore");
  attachTranslationToIconLabel(copyResult, "action.copy");
  attachTranslationToIconLabel(insertResult, "action.insert");
  attachTranslationToIconLabel(reprocessResult, "action.reprocess");

  recordButton.removeAttribute("aria-live");
  phaseStatus.setAttribute("role", "status");
  phaseStatus.setAttribute("aria-live", "polite");
  phaseStatus.setAttribute("aria-atomic", "true");

  document.querySelector("#settingsSectionGeneral").dataset.i18n = "settings.general";
  document.querySelector("#settingsSectionShortcuts").dataset.i18n = "settings.shortcuts";
  document.querySelector("#settingsSectionModels").dataset.i18n = "settings.modelsPrivacy";
  document.querySelector("#settingsSectionAdvanced").dataset.i18n = "settings.advanced";
  primaryNavigation.dataset.i18nAriaLabel = "aria.mainTabs";
  commandStrip.dataset.i18nAriaLabel = "aria.voiceCommandBar";
  resultActions.dataset.i18nAriaLabel = "aria.resultActions";
  settingsSectionNav.dataset.i18nAriaLabel = "aria.settingsSections";

  const waveform = document.createElement("div");
  waveform.className = "waveform";
  waveform.setAttribute("aria-hidden", "true");
  waveform.replaceChildren(...Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
    const bar = document.createElement("span");
    bar.style.setProperty("--bar-index", String(index));
    return bar;
  }));
  commandStrip.insertBefore(waveform, phaseStatus);
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
  renderPersonalizationPages();
  setViewPhase("idle");
  renderEditorState();
  activatePrimaryView("home");
  setReadyStatus();
  recordButton.addEventListener("click", toggleRecording);
  recordRecoveryAction.addEventListener("click", applyRecordRecoveryAction);
  navSettings.addEventListener("click", () => activatePrimaryView("settings"));
  closeSettings.addEventListener("click", closeSettingsDrawer);
  settingsDrawer.addEventListener("click", closeSettingsFromBackdrop);
  for (const button of settingsSectionButtons) {
    button.addEventListener("click", () => activateSettingsSection(button.dataset.settingsSection));
    button.addEventListener("keydown", handleSettingsSectionKeydown);
  }
  for (const button of contentNavigationButtons) {
    button.addEventListener("click", () => activatePrimaryView(button.dataset.primaryView));
  }
  for (const button of primaryNavigationButtons) {
    button.addEventListener("keydown", handlePrimaryNavigationKeydown);
  }
  historyList.addEventListener("click", handleHistoryAction);
  historyList.addEventListener("keydown", handleHistoryKeydown);
  historySearch.addEventListener("input", handleHistorySearchInput);
  globalSearch.addEventListener("input", handleHistorySearchInput);
  dictionarySearch.addEventListener("input", () => {
    dictionaryQuery = dictionarySearch.value;
    renderDictionaryPage();
  });
  snippetSearch.addEventListener("input", () => {
    snippetQuery = snippetSearch.value;
    renderSnippetsPage();
  });
  dictionaryAdd.addEventListener("click", beginDictionaryAdd);
  snippetAdd.addEventListener("click", beginSnippetAdd);
  dictionaryList.addEventListener("click", handleDictionaryAction);
  dictionaryList.addEventListener("input", syncDictionaryDraft);
  dictionaryList.addEventListener("submit", handleDictionarySubmit);
  snippetList.addEventListener("click", handleSnippetAction);
  snippetList.addEventListener("input", syncSnippetDraft);
  snippetList.addEventListener("submit", handleSnippetSubmit);
  manageDictionary.addEventListener("click", () => {
    closeSettingsDrawer();
    activatePrimaryView("dictionary", { focus: true });
  });
  editorBack.addEventListener("click", showHistoryListPane);
  window.addEventListener("resize", syncResponsiveWorkspace);
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
  reprocessResult.addEventListener("click", reprocessSelectedHistory);
  resultText.addEventListener("blur", () => renderEditorState());
  resultText.addEventListener("input", updateEditorFromInput);
  form.interfaceLanguage.addEventListener("change", changeInterfaceLanguage);
  form.whisperLanguage.addEventListener("change", changeProcessingLanguage);
  form.outputLanguage.addEventListener("change", changeProcessingLanguage);
  form.llmProvider.addEventListener("change", refreshProcessingProviderPreview);
  commandPolishMode.addEventListener("change", changeCommandPolishMode);
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
  syncResponsiveWorkspace();
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
  const saveOperation = createSettingsSaveOperation({
    [settingName]: requestedValue
  });

  enqueueSettingsOperation(() => (
    saveProcessingLanguage(field, settingName, requestedValue, requestVersion, saveOperation)
  ));
}

function enqueueSettingsOperation(operation) {
  const pending = settingsSaveQueue.then(operation);
  settingsSaveQueue = pending.catch(() => {});
  return pending;
}

function createSettingsSaveOperation(next) {
  const responseContext = {
    versions: {
      ...personalizationSaveVersions
    },
    writes: {
      dictionary: Object.hasOwn(next, "dictionary"),
      snippets: Object.hasOwn(next, "snippets")
    }
  };
  return async () => {
    const response = await window.localFlow.saveSettings(next);
    return reconcileSettingsResponse(response, responseContext);
  };
}

function reconcileSettingsResponse(response, responseContext) {
  const responseSettings = response && typeof response === "object" ? response : {};
  const reconciled = {
    ...currentSettings,
    ...responseSettings
  };

  for (const settingName of ["dictionary", "snippets"]) {
    const normalizer = settingName === "dictionary" ? normalizeDictionary : normalizeSnippets;
    const hasNewerLocalValue = (
      personalizationSaveVersions[settingName] > (responseContext?.versions?.[settingName] || 0)
    );
    const preservesLocalValue = !responseContext?.writes?.[settingName] || hasNewerLocalValue;
    const value = preservesLocalValue
      ? currentSettings?.[settingName]
      : Object.hasOwn(responseSettings, settingName)
        ? responseSettings[settingName]
        : currentSettings?.[settingName];
    reconciled[settingName] = normalizer(value);
  }

  currentSettings = reconciled;
  return currentSettings;
}

async function saveProcessingLanguage(
  field,
  settingName,
  requestedValue,
  requestVersion,
  saveOperation
) {
  try {
    await saveOperation();
    await refreshProviderStatus();
    await refreshSetupStatusView({ updateStatus: false });
    renderHeaderHealth();
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
    setStatus(t(SETTINGS_SAVE_FAILED_KEY));
    renderProviderStatus();
    renderSetupChecklist();
    renderHeaderHealth();
  }
}

function isLatestProcessingLanguageRequest(settingName, requestVersion) {
  return processingLanguageRequestVersions[settingName] === requestVersion;
}

function clearOwnedLanguageSaveFailure(settingName, requestVersion) {
  const owner = processingLanguageErrorOwner;
  if (!owner || owner.field !== settingName || requestVersion <= owner.version) return;

  processingLanguageErrorOwner = null;
  if (statusText.textContent !== t(SETTINGS_SAVE_FAILED_KEY)) return;
  if (ACTIVE_LANGUAGE_STATUS_PHASES.has(document.body.dataset.phase)) return;
  setReadyStatus();
}

async function refreshProcessingProviderPreview() {
  try {
    await saveSettingsFromCurrentForm({ updateStatus: false });
  } catch {
    setStatus(t(SETTINGS_SAVE_FAILED_KEY));
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
  } catch {
    setStatus(t("status.whisperFailed"));
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
    setStatus(t("status.microphoneFailed"));
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
    setStatus(t("status.textProviderFailed"));
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
}

function renderHeaderHealth(readiness = getCurrentRecordReadiness()) {
  const healthMessage = readiness.ready
    ? t("status.localReady")
    : t("status.localNeedsSetup");
  headerHealthText.textContent = healthMessage;
  headerHealthText.dataset.ready = String(readiness.ready);
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
  renderHeaderHealth(readiness);

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
  } catch {
    setStatus(t("setup.refreshFailed"));
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
      : getSetupFailureMessage(result, `setup.${type}.failed`));
  } catch {
    currentSetupStatus = mergeSetupResult(currentSetupStatus, type, {
      type,
      status: "failed",
      output: [],
      error: ""
    });
    renderSetupChecklist();
    setStatus(t("setup.startFailed"));
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
  } catch {
    setStatus(t("setup.cancelFailed"));
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
    const fieldValuesAtSave = captureFormFieldValues();
    const saveOperation = createSettingsSaveOperation(next);
    await enqueueSettingsOperation(async () => {
      await saveOperation();
      fillSettings(currentSettings, { fieldValuesAtSave });
    });
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
  return t(fallbackKey);
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

function createHistoryEditorSession(entry) {
  const text = entry?.status === "failed"
    ? (typeof entry.text === "string" && entry.text !== "" ? entry.text : entry.transcript || "")
    : entry?.text || "";
  return {
    editorState: createEditorState(text),
    savePhase: "saved",
    reprocessPhase: "idle",
    emptyMessageKey: entry?.status === "failed" ? "result.outputFailed" : "empty.result",
    commitVersion: 0,
    editorRevision: 0,
    restoreVersion: 0,
    pendingRestoreTarget: null
  };
}

function getHistoryEditorSession(id) {
  if (!id) return null;
  let session = historyEditorSessions.get(id);
  if (!session) {
    session = createHistoryEditorSession(allHistory.find((entry) => entry.id === id));
    historyEditorSessions.set(id, session);
  }
  return session;
}

function storeCurrentEditorSession() {
  if (!selectedHistoryId) return;
  const existingSession = historyEditorSessions.get(selectedHistoryId)
    || createHistoryEditorSession(allHistory.find((entry) => entry.id === selectedHistoryId));
  historyEditorSessions.set(selectedHistoryId, {
    ...existingSession,
    editorState,
    savePhase: editorSavePhase,
    reprocessPhase: editorReprocessPhase,
    emptyMessageKey: emptyEditorMessageKey,
    commitVersion: existingSession?.commitVersion || 0
  });
}

function loadHistoryEditorSession(entry) {
  const session = getHistoryEditorSession(entry?.id);
  if (!session) {
    editorState = createEditorState();
    editorSavePhase = "saved";
    editorReprocessPhase = "idle";
    emptyEditorMessageKey = "empty.result";
    return;
  }
  editorState = session.editorState;
  editorSavePhase = session.savePhase;
  editorReprocessPhase = session.reprocessPhase;
  emptyEditorMessageKey = session.emptyMessageKey;
}

function invalidateReprocessForHistory(id) {
  if (!id) return;
  historyReprocessVersions.set(id, (historyReprocessVersions.get(id) || 0) + 1);
}

async function restoreLatestResult() {
  const operationId = selectedHistoryId;
  const operationSession = getHistoryEditorSession(operationId);
  if (!operationSession) return;
  const pendingRestoreTarget = operationSession.pendingRestoreTarget;
  if (!editorState.dirty && pendingRestoreTarget === null) return;
  const baselineText = pendingRestoreTarget === null
    ? editorState.baselineText
    : pendingRestoreTarget;
  historyInteractionVersion += 1;
  invalidateReprocessForHistory(operationId);
  if (editorReprocessPhase !== "idle") {
    setEditorReprocessPhase("idle");
  }
  operationSession.restoreVersion += 1;
  const restoreVersion = operationSession.restoreVersion;
  operationSession.pendingRestoreTarget = baselineText;
  operationSession.editorRevision += 1;
  editorState = replaceEditorText(editorState, baselineText);
  editorRevision += 1;
  storeCurrentEditorSession();
  renderEditorState();
  if (!operationId) {
    setEditorSavePhase("saved");
    return;
  }

  const outcome = await historyAutosave.replace({ id: operationId, text: baselineText });
  const settledSession = getHistoryEditorSession(operationId);
  if (settledSession.restoreVersion !== restoreVersion) return;
  settledSession.savePhase = outcome?.ok ? "saved" : "error";
  if (outcome?.ok) {
    settledSession.pendingRestoreTarget = null;
    settledSession.editorState = createEditorState(baselineText);
  }
  if (selectedHistoryId !== operationId) return;
  loadHistoryEditorSession(getSelectedHistoryEntry());
  setEditorSavePhase(settledSession.savePhase);
  renderEditorState({ syncText: false });
}

function updateEditorFromInput() {
  const session = getHistoryEditorSession(selectedHistoryId);
  emptyEditorMessageKey = "empty.result";
  editorState = replaceEditorText(editorState, readContentEditableText(resultText));
  editorRevision += 1;
  historyInteractionVersion += 1;
  if (session) {
    session.editorRevision += 1;
    session.restoreVersion += 1;
    session.pendingRestoreTarget = null;
  }
  if (editorReprocessPhase !== "idle") {
    setEditorReprocessPhase("idle");
  }
  storeCurrentEditorSession();
  if (selectedHistoryId) {
    historyAutosave.schedule({
      id: selectedHistoryId,
      text: editorState.currentText
    });
  }
  renderEditorState({ syncText: false });
}

function replaceEditorBaseline(text, emptyMessageKey = "empty.result") {
  emptyEditorMessageKey = emptyMessageKey;
  editorState = replaceEditorText(editorState, text, { asBaseline: true });
  editorRevision += 1;
  setEditorSavePhase("saved");
  setEditorReprocessPhase("idle");
  storeCurrentEditorSession();
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
  resultCharacterCount.textContent = t("label.characterCount", {
    count: editorState.characterCount
  });
  const selectedSession = historyEditorSessions.get(selectedHistoryId);
  const hasPendingRestore = (
    selectedSession?.pendingRestoreTarget !== null &&
    selectedSession?.pendingRestoreTarget !== undefined
  );
  restoreResult.disabled = (
    !editorState.dirty &&
    !hasPendingRestore
  );
  copyResult.disabled = editorState.empty;
  insertResult.disabled = editorState.empty;
}

function handleHistoryAutosaveState(state) {
  if (!state?.id) return;
  const session = getHistoryEditorSession(state.id);
  session.savePhase = state.phase === "error"
    ? "error"
    : state.phase === "saved"
      ? "saved"
      : "saving";

  if (state.id !== selectedHistoryId) return;
  editorState = session.editorState;
  setEditorSavePhase(session.savePhase);
  editorRevision += 1;
  storeCurrentEditorSession();

  if (state.phase === "saved" && !isSelectableHistoryEntry(getSelectedHistoryEntry())) {
    const previousId = selectedHistoryId;
    selectedHistoryId = resolveHistorySelection(allHistory, previousId);
    historyInteractionVersion += 1;
    loadHistoryEditorSession(getSelectedHistoryEntry());
    renderHistoryProjection();
    renderSelectedHistory({ syncEditor: false });
    renderEditorState();
    return;
  }

  renderEditorState({ syncText: false });
  if (state.phase === "saved") renderHistoryProjection();
}

function handleHistoryAutosaveCommit(commit) {
  if (!commit?.id) return;
  const resultEntry = commit.result?.entry;
  allHistory = normalizeHistoryEntries(allHistory.map((entry) => (
    entry.id === commit.id
      ? {
          ...entry,
          ...(resultEntry && typeof resultEntry === "object" ? resultEntry : {}),
          id: commit.id,
          text: commit.text
        }
      : entry
  )));
  const session = getHistoryEditorSession(commit.id);
  session.editorState = updateEditorBaseline(session.editorState, commit.text);
  historyCommitVersion += 1;
  session.commitVersion = historyCommitVersion;
  if (commit.id === selectedHistoryId) {
    editorState = session.editorState;
  }
}

function setEditorSavePhase(phase) {
  editorSavePhase = phase === "error" ? "error" : phase === "saving" ? "saving" : "saved";
  editorSaveState.dataset.state = editorSavePhase;
  const key = editorSavePhase === "error"
    ? "editor.saveRetry"
    : editorSavePhase === "saving"
      ? "editor.saving"
      : "editor.saved";
  editorSaveState.textContent = t(key);
}

async function reprocessSelectedHistory() {
  const selectionVersion = historySelectionVersion;
  const interactionBeforeFlush = historyInteractionVersion;
  await historyAutosave.flush();
  if (
    selectionVersion !== historySelectionVersion ||
    interactionBeforeFlush !== historyInteractionVersion
  ) {
    return;
  }
  const operationId = selectedHistoryId;
  const entry = allHistory.find((item) => item.id === operationId);
  if (!entry || !hasHistoryTranscript(entry) || editorReprocessPhase === "running") return;
  const operationSession = getHistoryEditorSession(operationId);
  const operationEditorRevision = operationSession.editorRevision;
  const operationVersion = (historyReprocessVersions.get(operationId) || 0) + 1;
  historyReprocessVersions.set(operationId, operationVersion);
  historyInteractionVersion += 1;
  setEditorReprocessPhase("running");
  storeCurrentEditorSession();
  try {
    const result = await window.localFlow.reprocessHistory(operationId);
    if (result?.ok !== true || !result.entry || typeof result.entry !== "object") {
      const operationSession = getHistoryEditorSession(operationId);
      if (historyReprocessVersions.get(operationId) !== operationVersion) return;
      operationSession.reprocessPhase = "error";
      if (selectedHistoryId === operationId) renderHistoryOperationSession(operationId);
      return;
    }
    if (historyReprocessVersions.get(operationId) !== operationVersion) return;

    const updatedEntry = normalizeHistoryEntries([{
      ...entry,
      ...result.entry,
      id: operationId
    }])[0];
    allHistory = allHistory.map((item) => (
      item.id === operationId ? updatedEntry : item
    ));
    const currentSession = getHistoryEditorSession(operationId);
    const editedDuringOperation = currentSession.editorRevision !== operationEditorRevision;
    const updatedSession = editedDuringOperation
      ? {
          ...currentSession,
          editorState: updateEditorBaseline(currentSession.editorState, updatedEntry.text),
          reprocessPhase: "idle"
        }
      : {
          ...createHistoryEditorSession(updatedEntry),
          editorRevision: currentSession.editorRevision,
          restoreVersion: currentSession.restoreVersion
        };
    historyCommitVersion += 1;
    updatedSession.commitVersion = historyCommitVersion;
    historyEditorSessions.set(operationId, updatedSession);
    renderHistoryProjection();
    if (editedDuringOperation && updatedSession.editorState.currentText !== updatedEntry.text) {
      historyAutosave.schedule({
        id: operationId,
        text: updatedSession.editorState.currentText
      });
    }
    if (selectedHistoryId === operationId) renderHistoryOperationSession(operationId);
  } catch {
    const operationSession = getHistoryEditorSession(operationId);
    if (historyReprocessVersions.get(operationId) !== operationVersion) return;
    operationSession.reprocessPhase = "error";
    if (selectedHistoryId === operationId) renderHistoryOperationSession(operationId);
  }
}

function renderHistoryOperationSession(id) {
  if (selectedHistoryId !== id) return;
  loadHistoryEditorSession(getSelectedHistoryEntry());
  setEditorSavePhase(editorSavePhase);
  setEditorReprocessPhase(editorReprocessPhase);
  renderSelectedHistory({ syncEditor: false });
  renderEditorState();
}

function setEditorReprocessPhase(phase) {
  editorReprocessPhase = phase === "running" ? "running" : phase === "error" ? "error" : "idle";
  reprocessResult.dataset.state = editorReprocessPhase;
  renderEditorContext();
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
  for (const target of new Set([preferredTarget, navSettings])) {
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
  window.localFlow.requestRecordingToggle();
}

async function startRecording(command = {}) {
  if (recordingLifecyclePhase !== "idle") return;
  const operationId = normalizeRecordingOperationId(command.operationId);
  if (operationId === null) return;

  activeRecordingOperationId = operationId;
  const operationToken = beginRecordingOperation("starting");
  reportRecordingLifecycle({ phase: "starting", message: t("status.preparing") });

  try {
    await saveSettingsFromCurrentForm({ updateStatus: false });
  } catch {
    failRecordingStart(operationToken, operationId, t(SETTINGS_SAVE_FAILED_KEY), "settings_save_failed");
    return;
  }

  if (!isCurrentRecordingOperation(operationToken, operationId)) return;

  let nextRecorder = null;
  try {
    if (!ensureRecordReady()) {
      const message = recordButton.title || statusText.textContent || "Recording is not ready.";
      setRecordingLifecyclePhase("idle");
      setViewPhase("error");
      reportRecordingLifecycle({
        phase: "error",
        reason: "not_ready",
        message
      });
      activeRecordingOperationId = null;
      return;
    }

    nextRecorder = new WavRecorder();
    recorder = nextRecorder;
    await nextRecorder.start();
    if (!isCurrentRecordingOperation(operationToken, operationId)) {
      cleanupRecorder(nextRecorder);
      return;
    }

    isRecording = true;
    setRecordingLifecyclePhase("recording");
    document.body.classList.add("recording");
    updateRecordLabel();
    setStatus(t("status.recording"));
    reportRecordingLifecycle({ phase: "recording", message: t("status.recording") });
  } catch {
    if (!isCurrentRecordingOperation(operationToken, operationId)) {
      cleanupRecorder(nextRecorder);
      return;
    }
    failRecordingStart(operationToken, operationId, t("status.microphoneFailed"), "microphone_start_failed");
  }
}

function failRecordingStart(operationToken, operationId, message, reason) {
  if (!isCurrentRecordingOperation(operationToken, operationId)) return;

  setStatus(message);
  cleanupRecorder();
  isRecording = false;
  setRecordingLifecyclePhase("idle");
  setViewPhase("error");
  document.body.classList.remove("recording");
  updateRecordLabel();
  applyRecordReadiness();
  reportRecordingLifecycle({ phase: "error", reason, message });
  activeRecordingOperationId = null;
}

async function stopRecording(command = {}) {
  if (recordingLifecyclePhase !== "recording") return;
  const operationId = normalizeRecordingOperationId(command.operationId);
  if (operationId === null || operationId !== activeRecordingOperationId) return;

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
    if (!isCurrentRecordingOperation(operationToken, operationId)) return;

    if (recorder === activeRecorder) {
      recorder = null;
    }

    const entry = await window.localFlow.processWav(wav);
    if (!isCurrentRecordingOperation(operationToken, operationId)) return;

    activePrimaryView = "home";
    document.body.dataset.primaryView = activePrimaryView;
    syncPrimaryNavigation();
    await renderHistory();
    if (!isCurrentRecordingOperation(operationToken, operationId)) return;

    renderDictationResult(entry);
    document.body.dataset.workspacePane = "editor";
    setRecordingLifecyclePhase("idle");
    setViewPhase(entry?.status === "failed" ? "warning" : "done");
    activeRecordingOperationId = null;
  } catch {
    if (!isCurrentRecordingOperation(operationToken, operationId)) return;

    const message = t("status.processingFailed");
    setStatus(message);
    cleanupRecorder();
    isRecording = false;
    setRecordingLifecyclePhase("idle");
    setViewPhase("error");
    document.body.classList.remove("recording");
    updateRecordLabel();
    applyRecordReadiness();
    reportRecordingLifecycle({ phase: "error", reason: "processing_failed", message });
    activeRecordingOperationId = null;
  }
}

function renderDictationResult(entry) {
  if (entry?.status === "failed") {
    replaceEditorBaseline("", "result.outputFailed");
    setStatus(t("status.outputFailed"));
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
    dictionary: normalizeDictionary(currentSettings?.dictionary),
    snippets: normalizeSnippets(currentSettings?.snippets)
  };
  const fieldValuesAtSave = captureFormFieldValues(Object.keys(next));
  const saveOperation = createSettingsSaveOperation(next);

  return enqueueSettingsOperation(async () => {
    await saveOperation();
    fillSettings(currentSettings, { fieldValuesAtSave });
    currentLanguage = normalizeInterfaceLanguage(form.interfaceLanguage.value);
    applyInterfaceLanguage(currentLanguage);
    if (updateStatus) {
      setStatus(t("status.settingsSaved", { hotkey: formatHotkey(currentSettings.hotkey) }));
    }
    await refreshProviderStatus();
    await renderLocalModelStatus();
    return currentSettings;
  });
}

function fillSettings(settings, { fieldValuesAtSave } = {}) {
  for (const [key, value] of Object.entries(settings)) {
    const field = form.elements[key];
    if (!field) continue;
    if (fieldValuesAtSave?.has(key) && readFormFieldValue(field) !== fieldValuesAtSave.get(key)) {
      continue;
    }

    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = value ?? "";
    }
  }
  commandPolishMode.value = form.polishMode.value;
  renderPersonalizationPages();
}

function renderPersonalizationPages() {
  renderDictionaryPage();
  renderSnippetsPage();
}

function renderDictionaryPage() {
  const focusTarget = capturePersonalizationFocus("dictionary");
  const dictionary = normalizeDictionary(currentSettings?.dictionary);
  if (currentSettings) currentSettings = { ...currentSettings, dictionary };
  const query = normalizeSearchQuery(dictionaryQuery);
  const rows = dictionary
    .map((term, index) => ({ term, index }))
    .filter(({ term }) => !query || normalizeSearchQuery(term).includes(query));
  const markup = [];
  let editorRendered = false;

  if (dictionaryEditor?.index === -1) {
    markup.push(renderDictionaryEditor(dictionaryEditor));
    editorRendered = true;
  }
  for (const { term, index } of rows) {
    if (dictionaryEditor?.index === index) {
      markup.push(renderDictionaryEditor(dictionaryEditor));
      editorRendered = true;
      continue;
    }
    markup.push(`
      <article class="personalization-row" data-dictionary-row data-index="${index}">
        <div class="personalization-copy"><strong>${escapeHtml(term)}</strong></div>
        <div class="personalization-actions">
          ${renderIconAction("edit", index, "Pencil", "dictionary.edit")}
          ${renderIconAction("delete", index, "Trash2", "dictionary.delete", "danger-action")}
        </div>
      </article>
    `);
  }
  if (dictionaryEditor && !editorRendered) {
    markup.unshift(renderDictionaryEditor(dictionaryEditor));
  }

  dictionaryList.innerHTML = markup.length
    ? markup.join("")
    : `<p class="empty">${escapeHtml(t("dictionary.empty"))}</p>`;
  applyTranslations(dictionaryList);
  renderIcons(dictionaryList);
  renderPersonalizationStatus("dictionary");
  restorePersonalizationFocus("dictionary", focusTarget);
}

function renderDictionaryEditor(editor) {
  return `
    <form class="personalization-editor" data-personalization-form="dictionary" data-index="${editor.index}">
      <label>
        <span data-i18n="dictionary.term">${escapeHtml(t("dictionary.term"))}</span>
        <input
          name="term"
          value="${escapeHtml(editor.value)}"
          maxlength="${PERSONALIZATION_LIMITS.dictionaryTermLength}"
          autocomplete="off"
          required
        />
      </label>
      <div class="personalization-actions">
        ${renderIconAction("save", editor.index, "CheckCircle2", "dictionary.save")}
        ${renderIconAction("cancel", editor.index, "X", "dictionary.cancel")}
      </div>
    </form>
  `;
}

function renderSnippetsPage() {
  const focusTarget = capturePersonalizationFocus("snippets");
  const snippets = normalizeSnippets(currentSettings?.snippets);
  if (currentSettings) currentSettings = { ...currentSettings, snippets };
  const query = normalizeSearchQuery(snippetQuery);
  const rows = snippets.filter((snippet) => (
    !query ||
    normalizeSearchQuery(snippet.trigger).includes(query) ||
    normalizeSearchQuery(snippet.text).includes(query)
  ));
  const markup = [];
  let editorRendered = false;

  if (snippetEditor?.id === "") {
    markup.push(renderSnippetEditor(snippetEditor));
    editorRendered = true;
  }
  for (const snippet of rows) {
    if (snippetEditor?.id === snippet.id) {
      markup.push(renderSnippetEditor(snippetEditor));
      editorRendered = true;
      continue;
    }
    markup.push(`
      <article class="personalization-row" data-snippet-row data-snippet-id="${escapeHtml(snippet.id)}">
        <div class="personalization-copy">
          <strong>${escapeHtml(snippet.trigger)}</strong>
          <span>${escapeHtml(singleLineText(snippet.text))}</span>
        </div>
        <div class="personalization-actions">
          ${renderIconAction("edit", snippet.id, "Pencil", "snippets.edit")}
          ${renderIconAction("copy", snippet.id, "Copy", "snippets.copy")}
          ${renderIconAction("delete", snippet.id, "Trash2", "snippets.delete", "danger-action")}
        </div>
      </article>
    `);
  }
  if (snippetEditor && !editorRendered) {
    markup.unshift(renderSnippetEditor(snippetEditor));
  }

  snippetList.innerHTML = markup.length
    ? markup.join("")
    : `<p class="empty">${escapeHtml(t("snippets.empty"))}</p>`;
  applyTranslations(snippetList);
  renderIcons(snippetList);
  renderPersonalizationStatus("snippets");
  restorePersonalizationFocus("snippets", focusTarget);
}

function renderSnippetEditor(editor) {
  return `
    <form class="personalization-editor" data-personalization-form="snippet" data-snippet-id="${escapeHtml(editor.id)}">
      <div class="snippet-editor-fields">
        <label>
          <span data-i18n="snippets.trigger">${escapeHtml(t("snippets.trigger"))}</span>
          <input
            name="trigger"
            value="${escapeHtml(editor.trigger)}"
            maxlength="${PERSONALIZATION_LIMITS.snippetTriggerLength}"
            autocomplete="off"
            required
          />
        </label>
        <label>
          <span data-i18n="snippets.expansion">${escapeHtml(t("snippets.expansion"))}</span>
          <textarea
            name="text"
            maxlength="${PERSONALIZATION_LIMITS.snippetTextLength}"
            required
          >${escapeHtml(editor.text)}</textarea>
        </label>
      </div>
      <div class="personalization-actions">
        ${renderIconAction("save", editor.id, "CheckCircle2", "snippets.save")}
        ${renderIconAction("cancel", editor.id, "X", "snippets.cancel")}
      </div>
    </form>
  `;
}

function renderIconAction(action, value, icon, labelKey, extraClass = "") {
  return `
    <button
      type="${action === "save" ? "submit" : "button"}"
      class="icon-action ${extraClass}"
      data-personalization-action="${action}"
      data-personalization-value="${escapeHtml(value)}"
      title="${escapeHtml(t(labelKey))}"
      aria-label="${escapeHtml(t(labelKey))}"
      data-i18n-title="${labelKey}"
      data-i18n-aria-label="${labelKey}"
    >
      <span data-lucide="${icon}"></span>
    </button>
  `;
}

function beginDictionaryAdd() {
  dictionaryEditor = {
    index: -1,
    value: "",
    revision: 0
  };
  requestPersonalizationFocus("dictionary", {
    kind: "editor",
    field: "term"
  });
  setPersonalizationStatus("dictionary", "");
  renderDictionaryPage();
}

function beginSnippetAdd() {
  snippetEditor = {
    id: "",
    trigger: "",
    text: "",
    revision: 0
  };
  requestPersonalizationFocus("snippets", {
    kind: "editor",
    field: "trigger"
  });
  setPersonalizationStatus("snippets", "");
  renderSnippetsPage();
}

function syncDictionaryDraft(event) {
  const editor = event.target.closest?.('[data-personalization-form="dictionary"]');
  if (!editor || !dictionaryEditor || Number(editor.dataset.index) !== dictionaryEditor.index) return;
  dictionaryEditor = {
    ...dictionaryEditor,
    value: editor.elements.term.value,
    revision: dictionaryEditor.revision + 1
  };
}

function syncSnippetDraft(event) {
  const editor = event.target.closest?.('[data-personalization-form="snippet"]');
  if (!editor || !snippetEditor || editor.dataset.snippetId !== snippetEditor.id) return;
  snippetEditor = {
    ...snippetEditor,
    trigger: editor.elements.trigger.value,
    text: editor.elements.text.value,
    revision: snippetEditor.revision + 1
  };
}

function capturePersonalizationFocus(settingName) {
  const list = settingName === "dictionary" ? dictionaryList : snippetList;
  const active = document.activeElement;
  if (!active || !list.contains(active)) return null;

  const editor = active.closest?.("[data-personalization-form]");
  if (editor && active.name) {
    return {
      kind: "editor",
      field: active.name,
      selectionStart: active.selectionStart,
      selectionEnd: active.selectionEnd,
      selectionDirection: active.selectionDirection
    };
  }

  if (active.dataset?.personalizationAction) {
    return {
      kind: "action",
      action: active.dataset.personalizationAction,
      value: active.dataset.personalizationValue
    };
  }
  return null;
}

function requestPersonalizationFocus(settingName, target) {
  pendingPersonalizationFocus[settingName] = target;
}

function restorePersonalizationFocus(settingName, capturedTarget) {
  const target = pendingPersonalizationFocus[settingName] || capturedTarget;
  pendingPersonalizationFocus[settingName] = null;
  if (!target) return;

  queueMicrotask(() => {
    const list = settingName === "dictionary" ? dictionaryList : snippetList;
    const addButton = settingName === "dictionary" ? dictionaryAdd : snippetAdd;
    let element = null;
    if (target.kind === "add") {
      element = addButton;
    } else if (target.kind === "editor") {
      element = list.querySelector(`[data-personalization-form] [name="${target.field}"]`);
    } else if (target.kind === "action") {
      element = [...list.querySelectorAll("[data-personalization-action]")].find((candidate) => (
        candidate.dataset.personalizationAction === target.action &&
        candidate.dataset.personalizationValue === target.value
      ));
    }

    (element || addButton).focus();
    if (
      element &&
      Number.isInteger(target.selectionStart) &&
      Number.isInteger(target.selectionEnd) &&
      typeof element.setSelectionRange === "function"
    ) {
      element.setSelectionRange(
        target.selectionStart,
        target.selectionEnd,
        target.selectionDirection || "none"
      );
    }
  });
}

function handleDictionaryAction(event) {
  const button = event.target.closest?.("[data-personalization-action]");
  if (!button) return;
  const action = button.dataset.personalizationAction;
  const index = Number(button.dataset.personalizationValue);
  const dictionary = normalizeDictionary(currentSettings?.dictionary);

  if (action === "edit" && dictionary[index] !== undefined) {
    dictionaryEditor = {
      index,
      value: dictionary[index],
      revision: 0
    };
    requestPersonalizationFocus("dictionary", {
      kind: "editor",
      field: "term"
    });
    setPersonalizationStatus("dictionary", "");
    renderDictionaryPage();
  } else if (action === "cancel") {
    const cancelledIndex = dictionaryEditor?.index ?? index;
    dictionaryEditor = null;
    requestPersonalizationFocus(
      "dictionary",
      cancelledIndex >= 0
        ? { kind: "action", action: "edit", value: String(cancelledIndex) }
        : { kind: "add" }
    );
    renderDictionaryPage();
  } else if (action === "delete" && dictionary[index] !== undefined) {
    dictionaryEditor = null;
    requestPersonalizationFocus("dictionary", { kind: "add" });
    persistPersonalization("dictionary", dictionary.filter((_, itemIndex) => itemIndex !== index));
  }
}

function handleDictionarySubmit(event) {
  const editor = event.target.closest?.('[data-personalization-form="dictionary"]');
  if (!editor) return;
  event.preventDefault();
  const dictionary = normalizeDictionary(currentSettings?.dictionary);
  const index = Number(editor.dataset.index);
  const value = editor.elements.term.value;
  dictionaryEditor = {
    index,
    value,
    revision: (dictionaryEditor?.revision || 0) + 1
  };
  const candidate = normalizeDictionary([value])[0];

  if (
    !candidate ||
    normalizedVisibleLength(value) > PERSONALIZATION_LIMITS.dictionaryTermLength
  ) {
    setPersonalizationStatus("dictionary", "personalization.invalid", "error");
    return;
  }

  const withoutCurrent = dictionary.filter((_, itemIndex) => itemIndex !== index);
  if (normalizeDictionary([...withoutCurrent, candidate]).length === withoutCurrent.length) {
    setPersonalizationStatus("dictionary", "dictionary.duplicate", "error");
    return;
  }

  const next = index === -1
    ? normalizeDictionary([...dictionary, candidate])
    : normalizeDictionary(dictionary.map((term, itemIndex) => itemIndex === index ? candidate : term));
  if (next.length !== dictionary.length + (index === -1 ? 1 : 0)) {
    setPersonalizationStatus("dictionary", "personalization.invalid", "error");
    return;
  }

  dictionaryEditor = null;
  requestPersonalizationFocus("dictionary", {
    kind: "action",
    action: "edit",
    value: String(index === -1 ? next.length - 1 : index)
  });
  persistPersonalization("dictionary", next);
}

function handleSnippetAction(event) {
  const button = event.target.closest?.("[data-personalization-action]");
  if (!button) return;
  const action = button.dataset.personalizationAction;
  const id = button.dataset.personalizationValue;
  const snippets = normalizeSnippets(currentSettings?.snippets);
  const snippet = snippets.find((item) => item.id === id);

  if (action === "edit" && snippet) {
    snippetEditor = {
      id,
      trigger: snippet.trigger,
      text: snippet.text,
      revision: 0
    };
    requestPersonalizationFocus("snippets", {
      kind: "editor",
      field: "trigger"
    });
    setPersonalizationStatus("snippets", "");
    renderSnippetsPage();
  } else if (action === "cancel") {
    const cancelledId = snippetEditor?.id || id;
    snippetEditor = null;
    requestPersonalizationFocus(
      "snippets",
      cancelledId
        ? { kind: "action", action: "edit", value: cancelledId }
        : { kind: "add" }
    );
    renderSnippetsPage();
  } else if (action === "copy" && snippet) {
    copySnippetText(snippet.text);
  } else if (action === "delete" && snippet) {
    snippetEditor = null;
    requestPersonalizationFocus("snippets", { kind: "add" });
    persistPersonalization("snippets", snippets.filter((item) => item.id !== id));
  }
}

function handleSnippetSubmit(event) {
  const editor = event.target.closest?.('[data-personalization-form="snippet"]');
  if (!editor) return;
  event.preventDefault();
  const snippets = normalizeSnippets(currentSettings?.snippets);
  const triggerInput = editor.elements.trigger;
  const expansionInput = editor.elements.text;
  const editorId = editor.dataset.snippetId;
  snippetEditor = {
    id: editorId,
    trigger: triggerInput.value,
    text: expansionInput.value,
    revision: (snippetEditor?.revision || 0) + 1
  };
  const existing = snippets.find((item) => item.id === editorId);
  const candidate = existing
    ? {
        id: existing.id,
        trigger: snippetEditor.trigger,
        text: snippetEditor.text
      }
    : {
        id: crypto.randomUUID(),
        trigger: snippetEditor.trigger,
        text: snippetEditor.text
      };

  if (
    normalizedVisibleLength(candidate.trigger) > PERSONALIZATION_LIMITS.snippetTriggerLength ||
    String(candidate.text).trim().length > PERSONALIZATION_LIMITS.snippetTextLength ||
    normalizeSnippets([candidate]).length !== 1
  ) {
    setPersonalizationStatus("snippets", "personalization.invalid", "error");
    return;
  }

  const withoutCurrent = snippets.filter((item) => item.id !== candidate.id);
  if (normalizeSnippets([...withoutCurrent, candidate]).length === withoutCurrent.length) {
    setPersonalizationStatus("snippets", "snippets.duplicate", "error");
    return;
  }

  const next = existing
    ? normalizeSnippets(snippets.map((item) => item.id === existing.id ? candidate : item))
    : normalizeSnippets([...snippets, candidate]);
  if (next.length !== snippets.length + (existing ? 0 : 1)) {
    setPersonalizationStatus("snippets", "personalization.invalid", "error");
    return;
  }

  snippetEditor = null;
  requestPersonalizationFocus("snippets", {
    kind: "action",
    action: "edit",
    value: candidate.id
  });
  persistPersonalization("snippets", next);
}

async function copySnippetText(text) {
  try {
    await writeClipboardText(text);
    setPersonalizationStatus("snippets", "status.copied");
  } catch {
    setPersonalizationStatus("snippets", "status.copyFailed", "error");
  }
}

async function persistPersonalization(settingName, value) {
  const next = settingName === "dictionary"
    ? normalizeDictionary(value)
    : normalizeSnippets(value);
  const version = personalizationSaveVersions[settingName] + 1;
  personalizationSaveVersions[settingName] = version;
  currentSettings = {
    ...currentSettings,
    [settingName]: next
  };
  renderPersonalizationPages();
  const saveOperation = createSettingsSaveOperation({
    [settingName]: next
  });

  try {
    await enqueueSettingsOperation(saveOperation);
    renderPersonalizationPages();
    if (personalizationSaveVersions[settingName] === version) {
      setPersonalizationStatus(settingName, "personalization.saved");
    }
  } catch {
    if (personalizationSaveVersions[settingName] === version) {
      setPersonalizationStatus(settingName, "personalization.saveFailed", "error");
    }
  }
}

function setPersonalizationStatus(settingName, key, state = "") {
  if (settingName === "dictionary") dictionaryStatusKey = key;
  else snippetStatusKey = key;
  const element = settingName === "dictionary" ? dictionaryStatus : snippetStatus;
  element.textContent = key ? t(key) : "";
  if (state) element.dataset.state = state;
  else element.removeAttribute("data-state");
}

function renderPersonalizationStatus(settingName) {
  const key = settingName === "dictionary" ? dictionaryStatusKey : snippetStatusKey;
  const element = settingName === "dictionary" ? dictionaryStatus : snippetStatus;
  if (key) element.textContent = t(key);
}

function normalizedVisibleLength(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().length;
}

function normalizeSearchQuery(value) {
  return personalizationComparisonKey(value);
}

async function renderHistory() {
  const requestVersion = historyRefreshVersion + 1;
  historyRefreshVersion = requestVersion;
  await historyAutosave.flush();
  if (requestVersion !== historyRefreshVersion) return;
  const selectionBeforeRefresh = selectedHistoryId;
  const selectionVersionBeforeRefresh = historySelectionVersion;
  const editorRevisionBeforeRefresh = editorRevision;
  const commitVersionBeforeRefresh = historyCommitVersion;
  const history = await window.localFlow.listHistory();
  if (requestVersion !== historyRefreshVersion) return;
  const historySnapshot = normalizeHistoryEntries(Array.isArray(history) ? history : []);
  allHistory = mergeHistorySnapshotWithSessions(
    historySnapshot,
    commitVersionBeforeRefresh
  );
  pruneHistorySessionMaps(
    historyEditorSessions,
    historyReprocessVersions,
    historySnapshot.map((entry) => entry.id)
  );
  const selectedEntry = allHistory.find((entry) => entry.id === selectedHistoryId);
  selectedHistoryId = activePrimaryView === "home"
    ? resolveHistorySelection(allHistory, "")
    : isSelectableHistoryEntry(selectedEntry)
      ? selectedHistoryId
      : resolveHistorySelection(allHistory, selectedHistoryId);
  renderHistoryProjection();
  renderSelectedHistory({
    syncEditor: (
      selectedHistoryId !== selectionBeforeRefresh ||
      (
        historySelectionVersion === selectionVersionBeforeRefresh &&
        editorRevision === editorRevisionBeforeRefresh
      )
    )
  });
}

function mergeHistorySnapshotWithSessions(entries, commitVersionBeforeRefresh) {
  return normalizeHistoryEntries(entries.map((entry) => {
    const session = historyEditorSessions.get(entry.id);
    if (!session) return entry;
    if (
      session.savePhase === "saved" &&
      !session.editorState.dirty &&
      session.commitVersion <= commitVersionBeforeRefresh
    ) {
      historyEditorSessions.set(entry.id, createHistoryEditorSession(entry));
      return entry;
    }
    const text = session.savePhase === "saved"
      ? session.editorState.currentText
      : session.editorState.baselineText;
    return { ...entry, text };
  }));
}

function renderHistoryProjection() {
  const filteredHistory = filterHistory(allHistory, historyQuery);
  const groups = groupHistoryByDate(filteredHistory);

  historyList.innerHTML = groups.length
    ? groups.map((group) => `
      <section class="history-group" data-history-group="${escapeHtml(group.key)}">
        <h3 class="history-group-heading">${escapeHtml(formatHistoryGroupLabel(group))}</h3>
        ${group.entries.map((entry) => renderHistoryItem(entry)).join("")}
      </section>
    `).join("")
    : `<p class="empty">${escapeHtml(t("empty.history"))}</p>`;
  renderIcons(historyList);
}

function renderHistoryItem(item) {
  const text = typeof item?.text === "string" ? item.text : "";
  const displayable = hasDisplayableHistoryText(item);
  const selectable = isSelectableHistoryEntry(item);
  const preview = displayable
    ? singleLineText(text)
    : t(item?.status === "failed" ? "result.outputFailed" : "empty.result");
  const selected = selectable && item.id === selectedHistoryId;

  return `
    <article class="history-item" data-history-item data-history-status="${escapeHtml(item?.status || "empty")}">
      <button
        type="button"
        role="option"
        class="history-select"
        data-history-action="select"
        data-history-id="${escapeHtml(item.id)}"
        aria-label="${escapeHtml(preview)}"
        aria-selected="${selected}"
        tabindex="${selected ? "0" : "-1"}"
        ${selectable ? "" : "disabled"}
      >
        <time>${escapeHtml(formatHistoryTimeOnly(item.createdAt))}</time>
        <span class="history-copy">
          <p>${escapeHtml(preview)}</p>
          <span data-history-character-count>${escapeHtml(t("label.characterCount", {
            count: displayable ? item.characterCount : 0
          }))}</span>
        </span>
        <span data-lucide="ChevronRight" aria-hidden="true"></span>
      </button>
    </article>
  `;
}

function handleHistorySearchInput(event) {
  historyQuery = event.currentTarget.value;
  historySearch.value = historyQuery;
  globalSearch.value = historyQuery;
  renderHistoryProjection();
}

async function handleHistoryKeydown(event) {
  const current = event.target.closest?.('[data-history-action="select"]');
  if (!current) return;

  const rows = [...historyList.querySelectorAll('[data-history-action="select"]:not(:disabled)')];
  const currentIndex = rows.indexOf(current);
  if (currentIndex < 0) return;

  let nextIndex = null;
  if (event.key === "ArrowDown") nextIndex = Math.min(rows.length - 1, currentIndex + 1);
  else if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = rows.length - 1;

  if (nextIndex === null) return;
  event.preventDefault();
  const nextId = rows[nextIndex]?.dataset.historyId;
  const nextEntry = allHistory.find((item) => item.id === nextId);
  if (!nextEntry) return;

  await selectHistoryEntry(nextEntry, { focusRow: true });
}

async function handleHistoryAction(event) {
  const actionButton = event.target.closest?.("[data-history-action]");
  if (!actionButton || actionButton.disabled) return;

  const entry = allHistory.find((item) => item.id === actionButton.dataset.historyId);
  if (!entry) return;

  if (actionButton.dataset.historyAction === "select") {
    await selectHistoryEntry(entry);
  }
}

async function selectHistoryEntry(entry, { focusRow = false } = {}) {
  if (!isSelectableHistoryEntry(entry)) return;
  const requestVersion = historySelectionVersion + 1;
  historySelectionVersion = requestVersion;
  storeCurrentEditorSession();
  if (entry.id !== selectedHistoryId) {
    await historyAutosave.flush();
  }
  if (requestVersion !== historySelectionVersion) return;
  historyInteractionVersion += 1;
  selectedHistoryId = entry.id;
  renderSelectedHistory();
  renderHistoryProjection();
  if (focusRow) {
    [...historyList.querySelectorAll('[data-history-action="select"]')]
      .find((row) => row.dataset.historyId === selectedHistoryId)
      ?.focus();
  }
  document.body.dataset.workspacePane = "editor";
}

function renderSelectedHistory({ syncEditor = true } = {}) {
  const entry = getSelectedHistoryEntry();
  if (syncEditor) {
    loadHistoryEditorSession(entry);
    setEditorSavePhase(editorSavePhase);
    setEditorReprocessPhase(editorReprocessPhase);
    renderEditorState();
  } else {
    renderEditorContext();
  }
  editorCreatedAt.textContent = formatEditorMetadata(entry);
  editorCreatedAt.dateTime = entry?.createdAt || "";
}

function getSelectedHistoryEntry() {
  return allHistory.find((item) => item.id === selectedHistoryId);
}

function isSelectableHistoryEntry(entry) {
  return hasDisplayableHistoryText(entry) || entry?.status === "failed";
}

function hasHistoryTranscript(entry) {
  return typeof entry?.transcript === "string" && entry.transcript.trim() !== "";
}

function renderEditorContext() {
  const entry = getSelectedHistoryEntry();
  let key = "hint.autoKeepsLanguage";
  let contextState = "default";

  if (editorReprocessPhase === "running") {
    key = "editor.reprocessing";
  } else if (editorReprocessPhase === "error") {
    key = "editor.reprocessFailed";
    contextState = "recovery";
  } else if (entry?.status === "failed") {
    key = hasHistoryTranscript(entry)
      ? "history.recoveryAvailable"
      : "history.recoveryUnavailable";
    contextState = "recovery";
  }

  editorFooter.dataset.state = contextState;
  editorContextText.textContent = t(key);
  reprocessResult.disabled = !hasHistoryTranscript(entry) || editorReprocessPhase === "running";
}

function formatEditorMetadata(entry) {
  return entry ? formatHistoryTime(entry.createdAt) : "";
}

function formatHistoryGroupLabel(group) {
  if (group.labelKey) return t(group.labelKey);
  if (group.key === "unknown") return t("nav.history");

  const date = new Date(`${group.key}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? group.label || group.key
    : date.toLocaleDateString(currentLanguage, {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
}

function singleLineText(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function formatHistoryTime(createdAt) {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(currentLanguage);
}

function formatHistoryTimeOnly(createdAt) {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(currentLanguage, { hour: "2-digit", minute: "2-digit" });
}

async function activatePrimaryView(view, { focus = false } = {}) {
  if (view === "settings") {
    openSettingsDrawer();
    return;
  }
  const nextView = ["history", "dictionary", "snippets"].includes(view) ? view : "home";
  if (nextView === "home") {
    const requestVersion = historySelectionVersion + 1;
    historySelectionVersion = requestVersion;
    storeCurrentEditorSession();
    const nextSelection = resolveHistorySelection(allHistory, "");
    if (nextSelection !== selectedHistoryId) {
      await historyAutosave.flush();
    }
    if (requestVersion !== historySelectionVersion) return;
    historyInteractionVersion += 1;
    selectedHistoryId = nextSelection;
  }
  activePrimaryView = nextView;
  document.body.dataset.primaryView = activePrimaryView;
  workspacePage.hidden = !["home", "history"].includes(activePrimaryView);
  dictionaryPage.hidden = activePrimaryView !== "dictionary";
  snippetsPage.hidden = activePrimaryView !== "snippets";
  appTopbar.hidden = ["dictionary", "snippets"].includes(activePrimaryView);
  commandStrip.hidden = ["dictionary", "snippets"].includes(activePrimaryView);
  syncPrimaryNavigation({ focus });
  if (activePrimaryView === "home") {
    renderSelectedHistory();
    renderHistoryProjection();
    document.body.dataset.workspacePane = "editor";
  }
  if (activePrimaryView === "history") {
    document.body.dataset.workspacePane = "list";
    historySearch.focus();
  }
  if (activePrimaryView === "dictionary") {
    renderDictionaryPage();
  }
  if (activePrimaryView === "snippets") {
    renderSnippetsPage();
  }
}

function syncPrimaryNavigation({ focus = false } = {}) {
  for (const button of contentNavigationButtons) {
    const selected = button.dataset.primaryView === activePrimaryView;
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    button.tabIndex = selected ? 0 : -1;
  }
  navSettings.removeAttribute("aria-current");
  navSettings.tabIndex = 0;
  if (focus) {
    contentNavigationButtons
      .find((button) => button.dataset.primaryView === activePrimaryView)
      ?.focus();
  }
}

async function handlePrimaryNavigationKeydown(event) {
  const currentIndex = primaryNavigationButtons.indexOf(event.currentTarget);
  if (currentIndex < 0) return;

  let nextIndex = null;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    nextIndex = (currentIndex + 1) % primaryNavigationButtons.length;
  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    nextIndex = (currentIndex - 1 + primaryNavigationButtons.length) % primaryNavigationButtons.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = primaryNavigationButtons.length - 1;
  }

  if (nextIndex === null) return;
  event.preventDefault();
  const nextButton = primaryNavigationButtons[nextIndex];
  await activatePrimaryView(nextButton.dataset.primaryView, { focus: true });
}

function showHistoryListPane() {
  document.body.dataset.workspacePane = "list";
  historySearch.focus();
}

function syncResponsiveWorkspace() {
  if (window.innerWidth >= 900) return;
  if (activePrimaryView === "history" && !selectedHistoryId) {
    document.body.dataset.workspacePane = "list";
  }
}

function captureFormFieldValues(keys = Array.from(form.elements, (field) => field.name).filter(Boolean)) {
  const values = new Map();
  for (const key of keys) {
    const field = form.elements[key];
    if (field) values.set(key, readFormFieldValue(field));
  }
  return values;
}

function readFormFieldValue(field) {
  return field.type === "checkbox" ? Boolean(field.checked) : field.value;
}

function applyInterfaceLanguage(language) {
  currentLanguage = normalizeInterfaceLanguage(language);
  document.documentElement.lang = currentLanguage;
  document.title = t("app.title");

  const selectedValues = readLanguageSelections();
  populateLanguageSelects(selectedValues);

  applyTranslations();
  setEditorSavePhase(editorSavePhase);
  renderShortcutHint();
  renderIcons();

  renderProviderStatus();
  renderSetupChecklist();
  updateRecordLabel();
  shortcutRecorder.refreshLabels();

  renderEditorState();
  renderHistoryProjection();
  renderSelectedHistory({ syncEditor: false });
  renderPersonalizationPages();
}

async function changeCommandPolishMode() {
  form.polishMode.value = commandPolishMode.value;
  await saveSettingsFromCurrentForm({ updateStatus: false });
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

function renderShortcutHint() {
  const hotkey = form.hotkey?.value || currentSettings?.hotkey || "CommandOrControl+Alt+Space";
  shortcutHintText.textContent = t("hint.shortcut", {
    hotkey: formatHotkey(hotkey)
  });
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
  if (activeRecordingOperationId === null) return;
  window.localFlow.reportRecordingStatus?.({
    ...payload,
    operationId: activeRecordingOperationId
  });
}

function beginRecordingOperation(phase) {
  recordingOperationToken += 1;
  setRecordingLifecyclePhase(phase);
  return recordingOperationToken;
}

function isCurrentRecordingOperation(operationToken, operationId) {
  return (
    operationToken === recordingOperationToken &&
    operationId === activeRecordingOperationId
  );
}

function resetRecordingLifecycle(command = {}) {
  if (command.operationId !== activeRecordingOperationId) return;

  recordingOperationToken += 1;
  activeRecordingOperationId = null;
  cleanupRecorder();
  isRecording = false;
  setRecordingLifecyclePhase("idle");
  document.body.classList.remove("recording");
  updateRecordLabel();
  applyRecordReadiness();
}

function normalizeRecordingOperationId(operationId) {
  return Number.isSafeInteger(operationId) && operationId > 0 ? operationId : null;
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
  commandStrip.dataset.phase = normalizedPhase;
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
