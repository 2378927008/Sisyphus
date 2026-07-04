import AVFoundation
import Combine
import Foundation
import LocalFlowCore
import Speech

struct DeviceReadinessItem: Identifiable {
    let id: String
    let title: String
    let detail: String
    let isReady: Bool
}

@MainActor
final class SpeechDictationViewModel: ObservableObject {
    @Published var settings = DictationSettings()
    @Published var editableText = ""
    @Published var transcript = ""
    @Published var statusText = InterfaceCopy.localized(for: .simplifiedChinese).checkingPermissions
    @Published var isRecording = false
    @Published var canRecord = false
    @Published var microphonePermissionGranted = false
    @Published var speechPermissionGranted = false
    @Published var history: [DictationHistoryItem] = []

    private let audioEngine = AVAudioEngine()
    private let appGroupIdentifier = "group.com.localflow.dictation"
    private let latestResultKey = "latestResultText"
    private let settingsKey = "dictationSettings"
    private lazy var historyStore = DictationHistoryStore(appGroupIdentifier: appGroupIdentifier)
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?

    var copy: InterfaceCopy {
        InterfaceCopy.localized(for: settings.interfaceLanguage)
    }

    var deviceReadinessItems: [DeviceReadinessItem] {
        [
            DeviceReadinessItem(
                id: "microphone",
                title: copy.microphoneTitle,
                detail: microphonePermissionGranted
                    ? copy.microphoneAllowed
                    : copy.microphoneDenied,
                isReady: microphonePermissionGranted
            ),
            DeviceReadinessItem(
                id: "speech-recognition",
                title: copy.speechRecognitionTitle,
                detail: speechPermissionGranted
                    ? copy.speechEnabled
                    : copy.speechDenied,
                isReady: speechPermissionGranted
            ),
            DeviceReadinessItem(
                id: "keyboard-extension",
                title: copy.keyboardTitle,
                detail: copy.keyboardDetail,
                isReady: false
            )
        ]
    }

    func requestPermissions() async {
        loadSettings()
        loadHistory()
        microphonePermissionGranted = await requestMicrophonePermission()
        speechPermissionGranted = await requestSpeechPermission()

        canRecord = microphonePermissionGranted && speechPermissionGranted
        statusText = canRecord
            ? copy.readyAuto
            : copy.permissionDisabled
    }

    func toggleRecording() async {
        if isRecording {
            stopRecording()
        } else {
            await startRecording()
        }
    }

    func handleOpenURL(_ url: URL) async {
        guard url.scheme == "localflow", url.host == "quick-dictation" else { return }

        statusText = copy.quickDictationRequested
        if !canRecord {
            await requestPermissions()
        }
        await startRecording()
    }

    func startRecording() async {
        guard !isRecording else { return }
        guard canRecord else {
            statusText = copy.enablePermissions
            return
        }

        stopRecognitionTask()
        let locale = resolvedAppleSpeechLocale()
        speechRecognizer = SFSpeechRecognizer(locale: locale)

        guard let speechRecognizer, speechRecognizer.isAvailable else {
            statusText = copy.appleSpeechUnavailable
            return
        }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest else {
            statusText = copy.createRequestFailed
            return
        }

        recognitionRequest.shouldReportPartialResults = true
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak recognitionRequest] buffer, _ in
            recognitionRequest?.append(buffer)
        }

        do {
            try configureAudioSessionForRecording()
            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true
            statusText = settings.recognitionLanguage == .auto
                ? copy.listeningPreferred
                : copy.listeningStatus
        } catch {
            deactivateAudioSession()
            statusText = copy.startMicFailed
            return
        }

        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            Task { @MainActor in
                self?.handleRecognition(result: result, error: error)
            }
        }
    }

    func stopRecording() {
        guard isRecording else { return }

        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        isRecording = false
        deactivateAudioSession()
        applyOutputBehavior()
    }

    private func handleRecognition(result: SFSpeechRecognitionResult?, error: Error?) {
        if let result {
            transcript = result.bestTranscription.formattedString
            editableText = transcript
            statusText = result.isFinal ? copy.recognized : copy.listeningStatus
        }

        if error != nil {
            stopRecording()
            statusText = transcript.isEmpty ? copy.noSpeechDetected : copy.partialTranscriptSaved
        }
    }

    private func applyOutputBehavior() {
        let result = processOutput(
            transcript: transcript,
            outputSelection: settings.outputSelection
        )

        switch result {
        case .success(let text):
            editableText = text
            statusText = text.isEmpty ? copy.noSpeechDetected : copy.readyCopyShare
            saveHistory(text: text, warning: nil)
        case .requiresProvider(let rawTranscript, let message):
            editableText = rawTranscript
            statusText = message
            saveHistory(text: rawTranscript, warning: message)
        }
    }

    private func saveHistory(text: String, warning: String?) {
        guard !text.isEmpty else { return }

        let item = DictationHistoryItem(
            transcript: transcript,
            text: text,
            recognitionLanguage: settings.recognitionLanguage,
            outputSelection: settings.outputSelection,
            processingMode: settings.processingMode
        )
        history.insert(item, at: 0)
        history = Array(history.prefix(settings.historyLimit))
        historyStore.saveHistory(history)
        UserDefaults(suiteName: appGroupIdentifier)?.set(text, forKey: latestResultKey)
        _ = warning
    }

    func loadHistory() {
        history = Array(historyStore.loadHistory().prefix(settings.historyLimit))
    }

    func clearHistory() {
        history = []
        historyStore.clearHistory()
        UserDefaults(suiteName: appGroupIdentifier)?.removeObject(forKey: latestResultKey)
        statusText = copy.historyCleared
    }

    func useHistoryItem(_ item: DictationHistoryItem) {
        transcript = item.transcript
        editableText = item.text
        settings.recognitionLanguage = item.recognitionLanguage
        settings.outputSelection = item.outputSelection
        UserDefaults(suiteName: appGroupIdentifier)?.set(item.text, forKey: latestResultKey)
        saveSettings()
        statusText = copy.loadedFromHistory
    }

    func loadSettings() {
        guard
            let data = UserDefaults(suiteName: appGroupIdentifier)?.data(forKey: settingsKey),
            let savedSettings = try? JSONDecoder().decode(DictationSettings.self, from: data)
        else {
            return
        }

        settings = savedSettings
        statusText = copy.checkingPermissions
    }

    func saveSettings() {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        UserDefaults(suiteName: appGroupIdentifier)?.set(data, forKey: settingsKey)
    }

    func refreshInterfaceLanguage() {
        saveSettings()
        statusText = canRecord ? copy.readyAuto : copy.checkingPermissions
    }

    private func stopRecognitionTask() {
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        deactivateAudioSession()
        isRecording = false
    }

    private func resolvedAppleSpeechLocale() -> Locale {
        if let localeIdentifier = settings.recognitionLanguage.localeIdentifier {
            return Locale(identifier: localeIdentifier)
        }

        let supportedIdentifiers = Set(SFSpeechRecognizer.supportedLocales().map(\.identifier))
        if let preferred = Locale.preferredLanguages.first(where: { identifier in
            supportedIdentifiers.contains(identifier)
        }) {
            return Locale(identifier: preferred)
        }

        return Locale.current
    }

    private func configureAudioSessionForRecording() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true)
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func requestSpeechPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }
}
