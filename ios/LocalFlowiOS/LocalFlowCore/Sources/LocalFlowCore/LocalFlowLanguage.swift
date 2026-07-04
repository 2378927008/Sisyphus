import Foundation

public enum LocalFlowLanguage: String, CaseIterable, Codable, Identifiable, Sendable {
    case english = "en"
    case simplifiedChinese = "zh-Hans"
    case japanese = "ja"
    case korean = "ko"
    case traditionalChinese = "zh-Hant"
    case french = "fr"
    case russian = "ru"
    case spanish = "es"

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .english: return "English"
        case .simplifiedChinese: return "简体中文"
        case .japanese: return "日本語"
        case .korean: return "한국어"
        case .traditionalChinese: return "繁體中文"
        case .french: return "Français"
        case .russian: return "Русский"
        case .spanish: return "Español"
        }
    }

    public static let supportedInterfaceLanguages: [LocalFlowLanguage] = [
        .english,
        .simplifiedChinese,
        .japanese,
        .korean,
        .traditionalChinese,
        .french,
        .russian,
        .spanish
    ]

    public static let supportedOutputLanguages: [OutputSelection] = [
        .auto,
        .original,
        .english,
        .simplifiedChinese,
        .japanese,
        .korean,
        .traditionalChinese,
        .french,
        .russian,
        .spanish
    ]
}

public enum RecognitionLanguage: String, CaseIterable, Codable, Identifiable, Sendable {
    case auto
    case english
    case chinese
    case japanese
    case korean
    case french
    case russian
    case spanish

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .auto: return "Auto"
        case .english: return "English"
        case .chinese: return "中文"
        case .japanese: return "日本語"
        case .korean: return "한국어"
        case .french: return "Français"
        case .russian: return "Русский"
        case .spanish: return "Español"
        }
    }

    public var localeIdentifier: String? {
        switch self {
        case .auto: return nil
        case .english: return "en-US"
        case .chinese: return "zh-CN"
        case .japanese: return "ja-JP"
        case .korean: return "ko-KR"
        case .french: return "fr-FR"
        case .russian: return "ru-RU"
        case .spanish: return "es-ES"
        }
    }
}

public enum OutputSelection: String, CaseIterable, Codable, Identifiable, Sendable {
    case auto
    case original
    case english
    case simplifiedChinese
    case japanese
    case korean
    case traditionalChinese
    case french
    case russian
    case spanish

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .auto: return "Auto"
        case .original: return "Original"
        case .english: return "English"
        case .simplifiedChinese: return "简体中文"
        case .japanese: return "日本語"
        case .korean: return "한국어"
        case .traditionalChinese: return "繁體中文"
        case .french: return "Français"
        case .russian: return "Русский"
        case .spanish: return "Español"
        }
    }
}
