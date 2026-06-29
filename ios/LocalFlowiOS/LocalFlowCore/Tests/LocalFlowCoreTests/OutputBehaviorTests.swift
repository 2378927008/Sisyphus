import XCTest
@testable import LocalFlowCore

final class OutputBehaviorTests: XCTestCase {
    func testAutoOutputKeepsChineseTranscript() {
        let result = processOutput(
            transcript: "你好，今天帮我写一封邮件。",
            outputSelection: .auto
        )

        XCTAssertEqual(result, .success("你好，今天帮我写一封邮件。"))
    }

    func testAutoOutputKeepsEnglishTranscript() {
        let result = processOutput(
            transcript: "hello world",
            outputSelection: .auto
        )

        XCTAssertEqual(result, .success("hello world"))
    }

    func testOriginalOutputKeepsRecognizedTranscript() {
        let result = processOutput(
            transcript: "  quick note for tomorrow  ",
            outputSelection: .original
        )

        XCTAssertEqual(result, .success("quick note for tomorrow"))
    }

    func testSelectedTargetLanguageRequiresProvider() {
        let result = processOutput(
            transcript: "hello world",
            outputSelection: .simplifiedChinese
        )

        XCTAssertEqual(
            result,
            .requiresProvider(
                rawTranscript: "hello world",
                message: "Translation requires a configured provider."
            )
        )
    }
}
