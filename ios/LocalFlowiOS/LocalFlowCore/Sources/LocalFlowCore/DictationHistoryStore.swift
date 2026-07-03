import Foundation

public struct DictationHistoryStore {
    public static let defaultStorageKey = "dictationHistory"

    private let defaults: UserDefaults
    private let storageKey: String

    public init(
        defaults: UserDefaults = .standard,
        key: String = DictationHistoryStore.defaultStorageKey
    ) {
        self.defaults = defaults
        self.storageKey = key
    }

    public init(
        appGroupIdentifier: String,
        key: String = DictationHistoryStore.defaultStorageKey
    ) {
        self.defaults = UserDefaults(suiteName: appGroupIdentifier) ?? .standard
        self.storageKey = key
    }

    public func loadHistory() -> [DictationHistoryItem] {
        guard let data = defaults.data(forKey: storageKey) else {
            return []
        }

        do {
            return try JSONDecoder().decode([DictationHistoryItem].self, from: data)
        } catch {
            return []
        }
    }

    public func saveHistory(_ history: [DictationHistoryItem]) {
        guard !history.isEmpty else {
            clearHistory()
            return
        }

        guard let data = try? JSONEncoder().encode(history) else {
            return
        }

        defaults.set(data, forKey: storageKey)
    }

    public func clearHistory() {
        defaults.removeObject(forKey: storageKey)
    }
}
