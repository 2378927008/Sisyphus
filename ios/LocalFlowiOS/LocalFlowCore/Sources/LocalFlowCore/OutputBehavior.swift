import Foundation

public enum OutputProcessingResult: Equatable, Sendable {
    case success(String)
    case requiresProvider(rawTranscript: String, message: String)
}

public func cleanupTranscript(_ transcript: String) -> String {
    transcript
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

public func processOutput(
    transcript: String,
    outputSelection: OutputSelection
) -> OutputProcessingResult {
    let cleaned = cleanupTranscript(transcript)

    switch outputSelection {
    case .auto:
        return .success(cleaned)
    case .original:
        return .success(cleaned)
    default:
        return .requiresProvider(
            rawTranscript: cleaned,
            message: "Translation requires a configured provider."
        )
    }
}
