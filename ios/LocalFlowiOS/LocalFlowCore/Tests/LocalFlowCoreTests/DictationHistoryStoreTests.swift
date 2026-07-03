import Foundation
import XCTest
@testable import LocalFlowCore

final class DictationHistoryStoreTests: XCTestCase {
    func testSaveAndLoadHistory() {
        let suiteName = "DictationHistoryStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer {
            defaults.removePersistentDomain(forName: suiteName)
        }
        let store = DictationHistoryStore(defaults: defaults)
        let item = DictationHistoryItem(
            transcript: "hello world",
            text: "hello world",
            recognitionLanguage: .english,
            outputSelection: .auto,
            processingMode: .systemAppleSpeech
        )

        store.saveHistory([item])

        XCTAssertEqual(store.loadHistory(), [item])
    }

    func testClearHistory() {
        let suiteName = "DictationHistoryStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer {
            defaults.removePersistentDomain(forName: suiteName)
        }
        let store = DictationHistoryStore(defaults: defaults)
        let item = DictationHistoryItem(
            transcript: "hello world",
            text: "hello world",
            recognitionLanguage: .english,
            outputSelection: .auto,
            processingMode: .systemAppleSpeech
        )

        store.saveHistory([item])
        store.clearHistory()

        XCTAssertEqual(store.loadHistory(), [])
    }
}
