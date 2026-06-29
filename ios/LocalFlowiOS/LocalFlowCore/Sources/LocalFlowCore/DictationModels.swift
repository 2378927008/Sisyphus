import Foundation

public enum ProcessingMode: String, Codable, Sendable {
    case systemAppleSpeech
    case localWhisperKit
    case cloudProvider
}

public struct DictationSettings: Codable, Equatable, Sendable {
    public var interfaceLanguage: LocalFlowLanguage
    public var recognitionLanguage: RecognitionLanguage
    public var outputSelection: OutputSelection
    public var processingMode: ProcessingMode
    public var historyLimit: Int

    public init(
        interfaceLanguage: LocalFlowLanguage = .simplifiedChinese,
        recognitionLanguage: RecognitionLanguage = .auto,
        outputSelection: OutputSelection = .auto,
        processingMode: ProcessingMode = .systemAppleSpeech,
        historyLimit: Int = 50
    ) {
        self.interfaceLanguage = interfaceLanguage
        self.recognitionLanguage = recognitionLanguage
        self.outputSelection = outputSelection
        self.processingMode = processingMode
        self.historyLimit = historyLimit
    }
}
public struct DictationHistoryItem: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var createdAt: Date
    public var transcript: String
    public var text: String
    public var recognitionLanguage: RecognitionLanguage
    public var outputSelection: OutputSelection
    public var processingMode: ProcessingMode

    public init(
        id: UUID = UUID(),
        createdAt: Date = Date(),
        transcript: String,
        text: String,
        recognitionLanguage: RecognitionLanguage,
        outputSelection: OutputSelection,
        processingMode: ProcessingMode
    ) {
        self.id = id
        self.createdAt = createdAt
        self.transcript = transcript
        self.text = text
        self.recognitionLanguage = recognitionLanguage
        self.outputSelection = outputSelection
        self.processingMode = processingMode
    }
}

public struct DictationSessionResult: Equatable, Sendable {
    public var transcript: String
    public var text: String
    public var warning: String?

    public init(transcript: String, text: String, warning: String? = nil) {
        self.transcript = transcript
        self.text = text
        self.warning = warning
    }
}
