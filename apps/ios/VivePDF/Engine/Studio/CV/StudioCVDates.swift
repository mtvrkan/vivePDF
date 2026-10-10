import Foundation

/// Port of `cv/cvDates.ts`: "Mar 2021" / "03.2021" / "2021" dates in the CV language.
enum StudioCVDates {
    struct MonthYear: Equatable { var month: Int?; var year: Int }

    private static var cache: [String: [String]] = [:]
    private static let lock = NSLock()

    /// Twelve month names (`short` or `long`) as the CV language writes them on their own.
    static func monthNames(_ language: String, long: Bool) -> [String] {
        let key = "\(language)|\(long)"
        lock.lock()
        defer { lock.unlock() }
        if let hit = cache[key] { return hit }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: language)
        let names = (long ? formatter.standaloneMonthSymbols : formatter.shortStandaloneMonthSymbols) ?? formatter.monthSymbols ?? []
        cache[key] = names
        return names
    }

    private static func plain(_ value: String, _ language: String) -> String {
        var folded = value.decomposedStringWithCompatibilityMapping.unicodeScalars.filter { !($0.properties.generalCategory == .nonspacingMark || $0.properties.generalCategory == .spacingMark || $0.properties.generalCategory == .enclosingMark) }
            .reduce(into: "") { $0.unicodeScalars.append($1) }
        if folded.hasSuffix(".") { folded.removeLast() }
        return folded.lowercased(with: Locale(identifier: language))
    }

    private static func valid(_ year: Int) -> Bool { (1900...2100).contains(year) }

    static func parse(_ text: String, language: String) -> MonthYear? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.range(of: "^\\d{4}$", options: .regularExpression) != nil {
            let year = Int(value) ?? 0
            return valid(year) ? MonthYear(month: nil, year: year) : nil
        }
        if let match = value.range(of: "^(\\d{1,2})\\s*[./-]\\s*(\\d{4})$", options: .regularExpression) {
            let parts = value[match].split(whereSeparator: { "./- ".contains($0) }).map(String.init)
            guard parts.count == 2, let month = Int(parts[0]), let year = Int(parts[1]) else { return nil }
            return (1...12).contains(month) && valid(year) ? MonthYear(month: month, year: year) : nil
        }
        guard value.range(of: "^\\S+\\s+\\d{4}$", options: .regularExpression) != nil else { return nil }
        let pieces = value.split(whereSeparator: \.isWhitespace).map(String.init)
        guard pieces.count == 2, let year = Int(pieces[1]), valid(year) else { return nil }
        let word = plain(pieces[0], language)
        for candidate in [language, "en"] {
            for long in [false, true] {
                if let index = monthNames(candidate, long: long).firstIndex(where: { plain($0, candidate) == word }) {
                    return MonthYear(month: index + 1, year: year)
                }
            }
        }
        return nil
    }

    static func format(_ value: MonthYear, language: String) -> String {
        guard let month = value.month else { return String(value.year) }
        let names = monthNames(language, long: false)
        return "\(names.indices.contains(month - 1) ? names[month - 1] : String(month)) \(value.year)"
    }
}

/// Desktop strings in the CV's own language (`translatorFor(theme.language)`): headings and dates
/// follow the CV language even when the app runs in another one.
final class StudioCVTranslator {
    private static var tables: [String: [String: String]] = [:]
    private static let lock = NSLock()
    let language: String

    init(language: String) { self.language = language }

    private static func table(_ language: String) -> [String: String] {
        lock.lock()
        defer { lock.unlock() }
        if let hit = tables[language] { return hit }
        var flat: [String: String] = [:]
        let url = Bundle.main.url(forResource: "common", withExtension: "json", subdirectory: "locales/\(language)")
            ?? Bundle.main.url(forResource: "common", withExtension: "json", subdirectory: "DesktopLocales/\(language)")
        if let url, let data = try? Data(contentsOf: url), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let studio = json["studio"] as? [String: Any] {
            flatten(studio, prefix: "studio", into: &flat)
        }
        tables[language] = flat
        return flat
    }

    private static func flatten(_ value: Any, prefix: String, into out: inout [String: String]) {
        if let dict = value as? [String: Any] {
            for (key, child) in dict { flatten(child, prefix: "\(prefix).\(key)", into: &out) }
        } else if let text = value as? String {
            out[prefix] = text
        }
    }

    func callAsFunction(_ key: String, _ args: [String: Any] = [:]) -> String {
        if let value = Self.table(language)[key] ?? Self.table("en")[key] { return L10n.interpolate(value, args) }
        return t(key, args)
    }
}
