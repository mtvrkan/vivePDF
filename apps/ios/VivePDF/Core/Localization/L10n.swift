import Foundation
import Observation
import SwiftUI

/// The eight interface languages, mirroring `apps/desktop/src/app/locales.ts`.
enum AppLocale: String, CaseIterable, Identifiable, Codable {
    case tr, en, de, fr, es, it
    case ptBR = "pt-BR"
    case ar

    var id: String { rawValue }

    var nativeName: String {
        switch self {
        case .tr: "Türkçe"
        case .en: "English"
        case .de: "Deutsch"
        case .fr: "Français"
        case .es: "Español"
        case .it: "Italiano"
        case .ptBR: "Português (Brasil)"
        case .ar: "العربية"
        }
    }

    var isRTL: Bool { self == .ar }
    var layoutDirection: LayoutDirection { isRTL ? .rightToLeft : .leftToRight }
    var foundationLocale: Locale { Locale(identifier: rawValue) }

    /// Picks the closest supported locale from the system's preferred languages (falls back to English).
    static func detect(_ preferred: [String] = Locale.preferredLanguages) -> AppLocale {
        for tag in preferred {
            let lower = tag.lowercased()
            if lower.hasPrefix("pt") { return .ptBR }
            let base = String(lower.split(separator: "-").first ?? "")
            if let match = AppLocale.allCases.first(where: { $0.rawValue == base }) { return match }
        }
        return .en
    }
}

/// i18next-compatible lookup over the desktop catalogs (`locales/<code>/common.json`), plus iOS-only
/// overlays in `Resources/L10n/*.l10n.json` (`{ "<locale>": { "dotted.key": "text" } }`).
///
/// Supports `{{name}}` interpolation and `_zero/_one/_two/_few/_many/_other` plural suffixes driven by a
/// `count` argument, exactly like the desktop app. Views re-render on language change because `t` reads
/// the observable `locale`.
@Observable
final class L10n {
    static let shared = L10n()
    static let storageKey = "vivepdf.locale"

    var locale: AppLocale {
        didSet {
            UserDefaults.standard.set(locale.rawValue, forKey: Self.storageKey)
            load(locale)
        }
    }

    @ObservationIgnored private var catalogs: [AppLocale: [String: String]] = [:]

    private init() {
        let stored = UserDefaults.standard.string(forKey: Self.storageKey).flatMap(AppLocale.init(rawValue:))
        locale = stored ?? AppLocale.detect()
        load(.en)
        load(locale)
    }

    var isRTL: Bool { locale.isRTL }

    func t(_ key: String, _ args: [String: Any] = [:]) -> String {
        let current = locale
        let count = (args["count"] as? Int) ?? (args["count"] as? Double).map { Int($0) }
        let candidates: [String]
        if let count {
            candidates = Self.pluralCategories(count, current).map { "\(key)_\($0)" } + ["\(key)_other", key]
        } else {
            candidates = [key]
        }
        for locale in [current, .en] {
            guard let catalog = catalogs[locale] else { continue }
            for candidate in candidates {
                if let value = catalog[candidate] { return Self.interpolate(value, args) }
            }
        }
        return key
    }

    /// True when the key exists in the current language or English.
    func has(_ key: String) -> Bool {
        catalogs[locale]?[key] != nil || catalogs[.en]?[key] != nil
            || catalogs[.en]?["\(key)_other"] != nil
    }

    /// Every key below a prefix, e.g. `keys(under: "tools.grid.descriptions")`.
    func keys(under prefix: String) -> [String] {
        let start = prefix + "."
        return (catalogs[.en] ?? [:]).keys.filter { $0.hasPrefix(start) }.sorted()
    }

    // MARK: - Loading

    private func load(_ locale: AppLocale) {
        guard catalogs[locale] == nil else { return }
        var flat: [String: String] = [:]
        if let url = Bundle.main.url(forResource: "common", withExtension: "json", subdirectory: "DesktopLocales/\(locale.rawValue)")
            ?? Bundle.main.url(forResource: "common", withExtension: "json", subdirectory: "locales/\(locale.rawValue)"),
           let data = try? Data(contentsOf: url),
           let json = try? JSONSerialization.jsonObject(with: data) {
            Self.flatten(json, prefix: "", into: &flat)
        }
        for url in Bundle.main.urls(forResourcesWithExtension: "json", subdirectory: nil) ?? [] where url.lastPathComponent.hasSuffix(".l10n.json") {
            guard let data = try? Data(contentsOf: url),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let table = json[locale.rawValue] else { continue }
            Self.flatten(table, prefix: "", into: &flat)
        }
        catalogs[locale] = flat
    }

    private static func flatten(_ value: Any, prefix: String, into out: inout [String: String]) {
        if let dict = value as? [String: Any] {
            for (key, child) in dict {
                flatten(child, prefix: prefix.isEmpty ? key : "\(prefix).\(key)", into: &out)
            }
        } else if let text = value as? String {
            out[prefix] = shortcutLabel(text)
        } else if let array = value as? [Any] {
            for (index, child) in array.enumerated() { flatten(child, prefix: "\(prefix).\(index)", into: &out) }
        }
    }

    /// iPad keyboards use Apple modifier glyphs, like the desktop app does on macOS.
    static func shortcutLabel(_ text: String) -> String {
        guard text.contains("Ctrl") || text.contains("Alt+") else { return text }
        return text
            .replacingOccurrences(of: "Ctrl+Shift+", with: "⇧⌘")
            .replacingOccurrences(of: "Ctrl+Alt+", with: "⌥⌘")
            .replacingOccurrences(of: "Ctrl+", with: "⌘")
            .replacingOccurrences(of: "Alt+", with: "⌥")
            .replacingOccurrences(of: "Shift+", with: "⇧")
    }

    static func interpolate(_ template: String, _ args: [String: Any]) -> String {
        guard template.contains("{{") else { return template }
        var result = ""
        var rest = Substring(template)
        while let open = rest.range(of: "{{") {
            result += rest[..<open.lowerBound]
            guard let close = rest.range(of: "}}", range: open.upperBound..<rest.endIndex) else {
                rest = rest[open.lowerBound...]
                break
            }
            let name = rest[open.upperBound..<close.lowerBound].split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
            if let value = args[name] {
                result += format(value)
            } else {
                result += rest[open.lowerBound..<close.upperBound]
            }
            rest = rest[close.upperBound...]
        }
        return result + rest
    }

    private static func format(_ value: Any) -> String {
        switch value {
        case let number as Int: return NumberFormatter.localizedString(from: NSNumber(value: number), number: .decimal)
        case let number as Double: return NumberFormatter.localizedString(from: NSNumber(value: number), number: .decimal)
        default: return "\(value)"
        }
    }

    /// CLDR plural categories, most specific first.
    static func pluralCategories(_ n: Int, _ locale: AppLocale) -> [String] {
        switch locale {
        case .ar:
            let mod = n % 100
            if n == 0 { return ["zero"] }
            if n == 1 { return ["one"] }
            if n == 2 { return ["two"] }
            if (3...10).contains(mod) { return ["few"] }
            if (11...99).contains(mod) { return ["many"] }
            return ["other"]
        case .fr, .ptBR:
            if n == 0 || n == 1 { return ["one"] }
            if n != 0 && n % 1_000_000 == 0 { return ["many", "other"] }
            return ["other"]
        case .es, .it:
            if n == 1 { return ["one"] }
            if n != 0 && n % 1_000_000 == 0 { return ["many", "other"] }
            return ["other"]
        case .tr, .en, .de:
            return n == 1 ? ["one"] : ["other"]
        }
    }
}

/// Shorthand used throughout the UI: `t("nav.home")`, `t("common.andMore", ["count": 3])`.
func t(_ key: String, _ args: [String: Any] = [:]) -> String {
    L10n.shared.t(key, args)
}
