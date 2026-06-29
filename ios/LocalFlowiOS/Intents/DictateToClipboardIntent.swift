import AppIntents

@available(iOS 16.0, *)
public struct DictateToClipboardIntent: AppIntent {
    public static var title: LocalizedStringResource = "Quick Dictate to Clipboard"
    public static var description = IntentDescription(
        "Opens Local Flow quick dictation. The host app records with Apple Speech, then copies the editable result to the clipboard."
    )
    public static var openAppWhenRun: Bool = true

    public init() {}

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: "Open Local Flow and start quick dictation.")
    }
}
