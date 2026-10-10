import Foundation

/// Port of `_studio_cv_text.py`: text folding, dates, contacts, locations and language levels used to
/// read a CV PDF back into fields.
enum StudioCVText {
    static let nameLimit = 200
    static let textLimit = 4000

    struct Words: Decodable {
        let HEADINGS: [String: [String]]
        let MONTHS: [String]
        let PRESENT_WORDS: [String]
    }

    static let words: Words = {
        if let url = StudioResources.url("studio-cv-words", "json"), let data = try? Data(contentsOf: url), let words = try? JSONDecoder().decode(Words.self, from: data) { return words }
        return Words(HEADINGS: [:], MONTHS: ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], PRESENT_WORDS: ["present", "current", "now"])
    }()

    // MARK: Regex helpers

    static func re(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        (try? NSRegularExpression(pattern: pattern, options: options)) ?? NSRegularExpression()
    }

    static func full(_ s: String) -> NSRange { NSRange(location: 0, length: (s as NSString).length) }

    static func search(_ regex: NSRegularExpression, _ s: String) -> NSTextCheckingResult? { regex.firstMatch(in: s, range: full(s)) }

    static func matches(_ regex: NSRegularExpression, _ s: String) -> [NSTextCheckingResult] { regex.matches(in: s, range: full(s)) }

    /// `re.split`.
    static func split(_ s: String, _ regex: NSRegularExpression) -> [String] {
        let ns = s as NSString
        var parts: [String] = []
        var last = 0
        for m in regex.matches(in: s, range: full(s)) {
            parts.append(ns.substring(with: NSRange(location: last, length: m.range.location - last)))
            last = m.range.location + m.range.length
        }
        parts.append(ns.substring(from: last))
        return parts
    }

    static func sub(_ s: String, _ range: NSRange) -> String { (s as NSString).substring(with: range) }

    /// `re.match`: anchored at the start.
    static func matchStart(_ regex: NSRegularExpression, _ s: String) -> NSTextCheckingResult? {
        regex.firstMatch(in: s, options: .anchored, range: full(s))
    }

    static func fullMatch(_ regex: NSRegularExpression, _ s: String) -> Bool {
        guard let m = matchStart(regex, s) else { return false }
        return m.range.length == (s as NSString).length
    }

    private static func alternation(_ words: [String]) -> String {
        Array(Set(words)).sorted { $0.count != $1.count ? $0.count > $1.count : $0 < $1 }.map(NSRegularExpression.escapedPattern(for:)).joined(separator: "|")
    }

    // MARK: Patterns

    static let month = "(?:\(alternation(words.MONTHS)))\\.?"
    static let year = "(?:19|20)\\d{2}"
    static let date = "(?:\\b\(month)\\s*,?\\s*\(year)|\\b\\d{1,2}\\s*[./]\\s*\(year)|\\b\(year)\\s*[./]\\s*\\d{1,2}(?!\\d)|\\b\(year))(?!\\d)"
    static let present = "(?:\(alternation(words.PRESENT_WORDS)))\\b"
    static let range = re("(?<start>\(date))\\s*(?:-|~|\\bto\\b|\\buntil\\b|\\bbis\\b|\\ba\\b|\\bal\\b|\\bau\\b|\\bate\\b|\\bhasta\\b)\\s*(?<end>\(date)|\(present))")
    static let since = re("\\b(?:since|seit|depuis|desde|dal|dalla|itibaren)\\s+(?<start>\(date))")
    static let single = re(date)
    static let presentOnly = re("\(present)$")
    static let durationUnit = "(?:years?|yrs?|months?|mos?|yil|ay|jahre?|monate?|ans?|mois|anos?|meses?|anni|mesi)"
    static let duration = re("\\(\\s*(?:less than a year|\\d+\\s*\(durationUnit)\\b[^)]*)\\)|[·•]\\s*\\d+\\s*\(durationUnit)\\b(?:\\s*\\d+\\s*\(durationUnit)\\b)?")
    static let footer = re("(?:page|sayfa|seite|pagina|pag)\\.?\\s*\\d+\\s*(?:of|/|von|de|sur|di)\\s*\\d+")
    static let bullet = re("^\\s*(?:[-•·▪■◦●○*►▸✓✔]|\\d{1,2}[.)])\\s+")
    static let email = re("[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+")
    static let url = re("(?:https?://|www\\.)[^\\s,;|()<>]+|\\b(?:[a-z0-9-]+\\.)+(?:com|net|org|io|dev|me|co|tr|de|fr|es|it|pt|uk|info|app|ai|eu|us|ca|nl|be|ch|at)\\b(?:/[^\\s,;|()<>]*)?", .caseInsensitive)
    static let phone = re("(?<![\\w/])\\+?\\(?\\d[\\d\\s().\\-–]{5,}\\d(?![\\w/])")
    static let label = re("\\((?:linkedin|mobile|home|work|personal|company|portfolio|blog|other|cep|ev|iş)\\)|\\b(?:e-?mail|tel|phone|telefon|mobile|gsm|cep|web|website|linkedin|github)\\s*:", .caseInsensitive)
    static let locationPrefix = re("^(?:address|adres|location|konum|adresse|ort|wohnort|direccion|ubicacion|indirizzo|endereco|localizacao)\\s*:\\s*")
    static let locationWords: Set<String> = ["remote", "uzaktan", "area", "bolgesi", "turkiye", "turkey", "germany", "deutschland", "france", "spain", "espana", "italy", "italia", "portugal", "brasil", "brazil", "usa", "uk", "netherlands", "remoto", "remote-first"]
    static let separators = CharacterSet(charactersIn: " \t|,;·•-–—:()[]/")

    struct DateSpan { var start: String; var end: String; var current: Bool; var before: String; var after: String }

    // MARK: Text helpers

    private static let folded: [Unicode.Scalar: Unicode.Scalar] = ["ı": "i", "’": "'", "‘": "'", "ʼ": "'", "´": "'", "–": "-", "—": "-", "‐": "-", "‑": "-", "‒": "-", "−": "-"]

    /// `fold`: accent-free lower case, one code point for one (UTF-16 layout kept so ranges map back).
    static func fold(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            var mapped = folded[scalar]
            if mapped == nil {
                let first = String(scalar).decomposedStringWithCompatibilityMapping.unicodeScalars.first.map { String($0).lowercased() } ?? String(scalar)
                if first.unicodeScalars.count == 1, let s = first.unicodeScalars.first { mapped = s } else { mapped = scalar }
            }
            if let m = mapped, m.utf16.count != scalar.utf16.count { mapped = scalar }
            out.append(mapped ?? scalar)
        }
        return String(out)
    }

    static func plainLine(_ text: String) -> String {
        let spaced = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let lone = re("(?<!\\S)\u{00AD}(?!\\S)")
        return lone.stringByReplacingMatches(in: spaced, range: full(spaced), withTemplate: "-").replacingOccurrences(of: "\u{00AD}", with: "")
    }

    static func clip(_ text: String, _ limit: Int = nameLimit) -> String {
        var s = String(text.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.prefix(limit).map(Character.init))
        while let last = s.last, last.isWhitespace { s.removeLast() }
        return s
    }

    static func trimmed(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").trimmingCharacters(in: separators)
    }

    static func headingKey(_ text: String) -> String {
        let groups = split(fold(text).trimmingCharacters(in: .whitespacesAndNewlines), re("\\s{2,}")).map { group -> String in
            let tokens = group.split(whereSeparator: { $0.isWhitespace }).map(String.init)
            return tokens.count >= 3 && tokens.allSatisfy({ $0.count == 1 }) ? tokens.joined() : group
        }
        let joined = groups.joined(separator: " ")
        let cleaned = re("[^\\w&' ]+").stringByReplacingMatches(in: joined, range: full(joined), withTemplate: " ").replacingOccurrences(of: "_", with: " ")
        return cleaned.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    private static let headingIndex: [String: String] = {
        var index: [String: String] = [:]
        for (key, phrases) in words.HEADINGS { for phrase in phrases { index[headingKey(phrase)] = key } }
        return index
    }()

    static func headingOf(_ text: String) -> String? {
        guard text.count <= 60 else { return nil }
        return headingIndex[headingKey(text)]
    }

    private static func blanked(_ text: String, _ folded: String, _ pattern: NSRegularExpression) -> String {
        let ns = NSMutableString(string: text)
        for m in matches(pattern, folded) { ns.replaceCharacters(in: m.range, with: String(repeating: " ", count: m.range.length)) }
        return ns as String
    }

    static func withoutDuration(_ text: String) -> String { blanked(text, fold(text), duration) }

    static func findRange(_ text: String) -> DateSpan? {
        let f = fold(text)
        var start = "", end = "", current = false
        let match: NSTextCheckingResult
        if let m = search(range, f) {
            match = m
            start = sub(text, m.range(withName: "start"))
            end = sub(text, m.range(withName: "end"))
            current = fullMatch(presentOnly, sub(f, m.range(withName: "end")))
        } else if let m = search(since, f) {
            match = m
            start = sub(text, m.range(withName: "start"))
            current = true
        } else {
            return nil
        }
        let ns = text as NSString
        let before = trimmed(withoutDuration(ns.substring(to: match.range.location)))
        let after = trimmed(withoutDuration(ns.substring(from: match.range.location + match.range.length)))
        return DateSpan(start: clip(start), end: clip(end), current: current, before: before, after: after)
    }

    static func findSingle(_ text: String) -> DateSpan? {
        guard let m = search(single, fold(text)) else { return nil }
        let ns = text as NSString
        return DateSpan(start: "", end: clip(ns.substring(with: m.range)), current: false, before: trimmed(ns.substring(to: m.range.location)), after: trimmed(ns.substring(from: m.range.location + m.range.length)))
    }

    static func urlKind(_ url: String) -> String {
        let f = fold(url)
        if f.contains("linkedin.com") { return "linkedin" }
        if f.contains("github.com") { return "github" }
        return "website"
    }

    private static func blank(_ text: String, _ ranges: [NSRange]) -> String {
        let ns = NSMutableString(string: text)
        for r in ranges { ns.replaceCharacters(in: r, with: String(repeating: " ", count: r.length)) }
        return ns as String
    }

    /// `contacts_in`: emails, links and phone numbers found in a line plus the remaining text.
    static func contactsIn(_ text: String) -> (found: [(String, String)], rest: String) {
        var found: [(Int, String, String)] = []
        var remaining = text
        let emails = matches(email, remaining)
        for m in emails { found.append((m.range.location, "email", sub(remaining, m.range))) }
        remaining = blank(remaining, emails.map(\.range))
        let urls = matches(url, remaining)
        for m in urls {
            var value = sub(remaining, m.range)
            while let last = value.last, ".,;:)-".contains(last) { value.removeLast() }
            found.append((m.range.location, urlKind(value), value))
        }
        remaining = blank(remaining, urls.map(\.range))
        let snapshot = remaining
        for m in matches(phone, snapshot) {
            let value = sub(snapshot, m.range)
            let digits = value.filter(\.isNumber).count
            if (7...15).contains(digits) && search(range, fold(value)) == nil {
                found.append((m.range.location, "phone", value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")))
                if let r = remaining.range(of: value) { remaining.replaceSubrange(r, with: String(repeating: " ", count: value.count)) }
            }
        }
        found.sort { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }
        let unlabelled = label.stringByReplacingMatches(in: remaining, range: full(remaining), withTemplate: " ")
        return (found.map { ($0.1, clip($0.2)) }, trimmed(unlabelled))
    }

    static func locationValue(_ text: String) -> String {
        let f = fold(text).trimmingCharacters(in: .whitespacesAndNewlines)
        if let prefix = matchStart(locationPrefix, f) {
            let stripped = text.trimmingCharacters(in: .whitespacesAndNewlines) as NSString
            return clip(trimmed(stripped.substring(from: min(stripped.length, prefix.range.length))))
        }
        let words = f.replacingOccurrences(of: ",", with: " ").split(whereSeparator: { $0.isWhitespace }).map(String.init)
        var right = text
        while let last = right.last, last.isWhitespace { right.removeLast() }
        if words.isEmpty || text.count > 60 || words.count > 6 || text.contains(where: \.isNumber) || right.hasSuffix(".") { return "" }
        if text.contains(",") || !locationWords.isDisjoint(with: words) { return clip(trimmed(text)) }
        return ""
    }

    // MARK: Language levels

    private static let levels: [(NSRegularExpression, Int)] = [
        ("native|bilingual|mother tongue|ana ?dil|muttersprache|langue maternelle|nativ[oa]|madrelingua|lengua materna|lingua materna|bilingue", 5),
        ("full professional", 4),
        ("professional working|upper intermediate|orta ileri", 3),
        ("limited working", 2),
        ("elementary|beginner|basic|baslangic|temel|grundkenntnisse|debutant|basico|principiante|elementare", 1),
        ("fluent|advanced|ileri|akici|fliessend|fließend|verhandlungssicher|courant|avance|avanzado|avanzato|avancado|fluido|fluente", 4),
        ("intermediate|orta|gut|intermediaire|intermedio|intermediario|conversational", 3),
        ("c1|c2", 4),
        ("b2", 3),
        ("b1|a2", 2),
        ("a1", 1),
    ].map { (re("\\b(?:\($0.0))\\b"), $0.1) }
    private static let levelFiller = re("\\b(?:proficiency|level|seviye|seviyesi|niveau|nivel|livello|or|and|ve)\\b")
    private static let parens = re("\\([^)]*\\)")

    static func languageLevel(_ text: String) -> (String, Int) {
        let f = fold(text)
        let level = levels.first { search($0.0, f) != nil }?.1 ?? 0
        let ns = NSMutableString(string: text)
        for m in matches(parens, f) where levels.contains(where: { search($0.0, sub(f, m.range)) != nil }) {
            ns.replaceCharacters(in: m.range, with: String(repeating: " ", count: m.range.length))
        }
        var name = ns as String
        for (pattern, _) in levels { name = blanked(name, fold(name), pattern) }
        if level > 0 { name = blanked(name, fold(name), levelFiller) }
        let emptyParens = re("\\(\\s*\\)")
        name = trimmed(emptyParens.stringByReplacingMatches(in: name, range: full(name), withTemplate: " "))
        return (clip(name), level)
    }
}
