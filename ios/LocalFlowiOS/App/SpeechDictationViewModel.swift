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
    @Published var statusText = "Checking permissions..."
    @Published var isRecording = false
    @Published var canRecord = false
    @Published var microphonePermissionGranted = false
    @Published var speechPermissionGranted = false
    @Published var history: [DictationHistoryItem] = []

    private let audioEngine = AVAudioEngine()
    private let appGroupIdentifier = "group.com.localflow.dictation"
    private let latestResultKey = "latestResultText"
    private lazy var historyStore = DictationHistoryStore(appGroupIdentifier: appGroupIdentifier)
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?

    var deviceReadinessItems: [DeviceReadinessItem] {
        [
            DeviceReadinessItem(
                id: "microphone",
                title: "Microphone",
                detail: microphonePermissionGranted
                    ? "Allowed for this app."
                    : "Allow microphone access in iPhone Settings.",
                isReady: microphonePermissionGranted
            ),
            DeviceReadinessItem(
                id: "speech-recognition",
                title: "Speech Recognition",
                detail: speechPermissionGranted
                    ? "Apple Speech permission is enabled."
                    : "Allow speech recognition so Local Flow can transcribe locally through Apple Speech.",
                isReady: speechPermissionGranted
            ),
            DeviceReadinessItem(
                id: "keyboard-extension",
                title: "Local Flow Keyboard",
                detail: "Enable Local Flow Keyboard in Settings > General > Keyboard > Keyboards, then turn on Allow Full Access.",
                isReady: false
            )
        ]
    }

    func requestPermissions() async {
        loadHistory()
        microphonePermissionGranted = await requestMicrophonePermission()
        speechPermissionGranted = await requestSpeechPermission()

        canRecord = microphonePermissionGranted && speechPermissionGranted
        statusText = canRecord
            ? "Ready. Auto output keeps the speech language."
            : "Microphone or speech recognition permission is disabled."
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

        statusText = "Quick dictation requested."
        if !canRecord {
            await requestPermissions()
        }
        await startRecording()
    }

    func startRecording() async {
        guard !isRecording else { return }
        guard canRecord else {
            statusText = "Enable microphone and speech recognition in Settings."
            return
        }

        stopRecognitionTask()
        let locale = resolvedAppleSpeechLocale()
        speechRecognizer = SFSpeechRecognizer(locale: locale)

        guard let speechRecognizer, speechRecognizer.isAvailable else {
            statusText = "Apple Speech is unavailable right now."
            return
        }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest else {
            statusText = "Could not create a speech recognition request."
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
                ? "Listening with iOS preferred speech language..."
                : "Listening..."
        } catch {
            deactivateAudioSession()
            statusText = "Could not start microphone recording."
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
            statusText = result.isFinal ? "Recognized." : "Listening..."
        }

        if error != nil {
            stopRecording()
            statusText = transcript.isEmpty ? "No speech detected. Try again." : "Partial transcript saved."
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
            statusText = text.isEmpty ? "No speech detected. Try again." : "Ready to copy or share."
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
        statusText = "History cleared."
    }

    func useHistoryItem(_ item: DictationHistoryItem) {
        transcript = item.transcript
        editableText = item.text
        settings.recognitionLanguage = item.recognitionLanguage
        settings.outputSelection = item.outputSelection
        UserDefaults(suiteName: appGroupIdentifier)?.set(item.text, forKey: latestResultKey)
        statusText = "Loaded from history."
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
