import Foundation

/// Text clean-up used when copying from a page (`shared/lib/copyText.ts`) and the web lookups offered for a
/// selection (`shared/lib/webSearch.ts`).
enum ViewerText {
    // MARK: - Copy clean-up

    private static let ligatures: [Character: String] = [
        "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "\u{00a0}": " ", "’": "'", "“": "\"", "”": "\"",
    ]
    private static let minNumberedRatio = 0.6

    private static func normalizeCharacters(_ text: String) -> String {
        var out = ""
        out.reserveCapacity(text.count)
        for char in text { if let replacement = ligatures[char] { out += replacement } else { out.append(char) } }
        return out
    }

    private static func lineNumber(_ line: String) -> Int? {
        let trimmed = line.drop { $0 == " " || $0 == "\t" }
        let digits = trimmed.prefix { $0.isASCII && $0.isNumber }
        guard (1...4).contains(digits.count), let value = Int(digits) else { return nil }
        let rest = trimmed.dropFirst(digits.count)
        if rest.isEmpty || rest.first == " " || rest.first == "\t" || [".", ":", ")"].contains(rest.first) { return value }
        return nil
    }

    private static func isNumberOnly(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return (1...4).contains(trimmed.count) && trimmed.allSatisfy { $0.isASCII && $0.isNumber }
    }

    private static func stripLineNumbers(_ lines: [String]) -> [String] {
        let content = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard content.count >= 2 else { return lines }
        var numbered = 0, previous = 0, ascending = 0
        for line in content {
            guard let value = lineNumber(line) else { continue }
            numbered += 1
            if value > previous { ascending += 1 }
            previous = value
        }
        if Double(numbered) / Double(content.count) < minNumberedRatio || Double(ascending) < Double(numbered) * minNumberedRatio { return lines }
        return lines.filter { !isNumberOnly($0) }.map { line in
            guard lineNumber(line) != nil else { return line }
            var rest = Substring(line).drop { $0 == " " || $0 == "\t" }
            rest = rest.drop { $0.isASCII && $0.isNumber }
            if let first = rest.first, [".", ":", ")"].contains(first) { rest = rest.dropFirst() }
            if rest.first == " " || rest.first == "\t" { rest = rest.dropFirst() }
            return String(rest)
        }
    }

    private static func mergeNumberColumn(_ lines: [String]) -> [String] {
        let numeric = lines.filter(isNumberOnly).count
        let textual = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty && !isNumberOnly($0) }.count
        if numeric == 0 || textual == 0 || Double(numeric) < Double(textual) * minNumberedRatio { return lines }
        return lines.filter { !isNumberOnly($0) }
    }

    private static func joinBrokenWords(_ lines: [String]) -> [String] {
        var joined: [String] = []
        for line in lines {
            let next = String(line.drop { $0 == " " || $0 == "\t" })
            if let previous = joined.last, previous.count >= 2,
               let last = previous.last, ["-", "\u{2010}", "\u{00ad}"].contains(last),
               previous.dropLast().last?.isLetter == true,
               next.first?.isLowercase == true {
                let word = next.prefix { !$0.isWhitespace }
                let remainder = next.dropFirst(word.count).trimmingCharacters(in: .whitespaces)
                joined[joined.count - 1] = String(previous.dropLast()) + word
                if !remainder.isEmpty { joined.append(remainder) }
                continue
            }
            joined.append(line)
        }
        return joined
    }

    /// Cleans text copied from pages: ligatures, soft hyphens, line-number columns, hyphenated line breaks.
    static func cleanCopiedText(_ pages: [String]) -> String {
        let lines = pages.flatMap { $0.components(separatedBy: CharacterSet.newlines) }
        let normalized = lines.map { line -> String in
            var text = normalizeCharacters(line)
            // Soft hyphen inside a word disappears; elsewhere it becomes a real hyphen below.
            var chars = Array(text)
            var index = 1
            while index < chars.count - 1 {
                if chars[index] == "\u{00ad}", chars[index - 1].isLetter, chars[index + 1].isLetter { chars.remove(at: index) } else { index += 1 }
            }
            text = String(chars)
            while let last = text.last, last == " " || last == "\t" { text.removeLast() }
            return text
        }
        let cleaned = joinBrokenWords(stripLineNumbers(mergeNumberColumn(normalized))).map { $0.replacingOccurrences(of: "\u{00ad}", with: "-") }
        var result = cleaned.joined(separator: "\n")
        while result.contains("\n\n\n") { result = result.replacingOccurrences(of: "\n\n\n", with: "\n\n") }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isListItemStart(_ line: String) -> Bool {
        let pattern = #"^\s*(?:[-*•▪◦–]\s|\(?\d{1,3}[.)]\s|\(?[a-z][.)]\s|\[\d{1,3}\]\s)"#
        return line.range(of: pattern, options: .regularExpression) != nil
    }

    /// Joins wrapped lines into paragraphs (blank lines and list items start new ones).
    static func reflowParagraphs(_ text: String) -> String {
        var paragraphs: [String] = []
        var current = ""
        for raw in text.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                if !current.isEmpty { paragraphs.append(current) }
                current = ""
                continue
            }
            if !current.isEmpty && isListItemStart(line) {
                paragraphs.append(current)
                current = line
                continue
            }
            current = current.isEmpty ? line : "\(current) \(line)"
        }
        if !current.isEmpty { paragraphs.append(current) }
        return paragraphs.map { $0.replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression) }.joined(separator: "\n\n")
    }

    /// "Copy as Markdown": bullet characters become Markdown list items.
    static func markdown(_ text: String) -> String {
        text.components(separatedBy: "\n").map { line in
            guard let first = line.first, ["-", "*", "•"].contains(first), line.dropFirst().first == " " else { return line }
            return "- " + line.dropFirst(2)
        }.joined(separator: "\n")
    }

    /// First non-empty line of a selection, shortened for a bookmark title (`bookmarkTitle.ts`).
    static func bookmarkTitle(from selection: String, limit: Int = 120) -> String {
        let line = selection.components(separatedBy: .newlines)
            .map { $0.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty } ?? ""
        guard line.count > limit else { return line }
        return String(line.prefix(limit - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }

    /// Search box input → query (`searchQuery.ts`): at least two characters unless it is CJK.
    static func effectiveSearchQuery(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count >= 2 { return trimmed }
        let ideographic = trimmed.unicodeScalars.contains { scalar in
            (0x4E00...0x9FFF).contains(scalar.value) || (0x3040...0x30FF).contains(scalar.value) || (0xAC00...0xD7AF).contains(scalar.value) || (0x3400...0x4DBF).contains(scalar.value)
        }
        return ideographic ? trimmed : ""
    }

    // MARK: - Web lookups

    enum SearchEngine: String, CaseIterable {
        case google, bing, duckduckgo, startpage, brave, yandex
    }

    private static let maxQueryLength = 500

    private static func encode(_ query: String) -> String {
        let trimmed = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxQueryLength))
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.!~*'()")
        return trimmed.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }

    private static func baseLocale(_ locale: String) -> String {
        locale.split(separator: "-").first.map { $0.lowercased() } ?? "en"
    }

    static func searchURL(_ engine: SearchEngine, _ query: String) -> URL? {
        let q = encode(query)
        let string: String = switch engine {
        case .google: "https://www.google.com/search?q=\(q)"
        case .bing: "https://www.bing.com/search?q=\(q)"
        case .duckduckgo: "https://duckduckgo.com/?q=\(q)"
        case .startpage: "https://www.startpage.com/sp/search?query=\(q)"
        case .brave: "https://search.brave.com/search?q=\(q)"
        case .yandex: "https://yandex.com/search/?text=\(q)"
        }
        return URL(string: string)
    }

    static func scholarURL(_ query: String) -> URL? { URL(string: "https://scholar.google.com/scholar?q=\(encode(query))") }

    static func wikipediaURL(_ query: String, locale: String) -> URL? {
        URL(string: "https://\(baseLocale(locale)).wikipedia.org/w/index.php?search=\(encode(query))")
    }

    static func defineURL(_ query: String, locale: String) -> URL? {
        let base = baseLocale(locale)
        if base == "tr" { return URL(string: "https://sozluk.gov.tr/?ara=\(encode(query))") }
        let wiktionary: Set<String> = ["en", "tr", "fr", "de", "es", "it", "pt", "ru", "ja", "zh", "nl", "pl"]
        return URL(string: "https://\(wiktionary.contains(base) ? base : "en").wiktionary.org/wiki/\(encode(query))")
    }

    static func translateURL(_ query: String, locale: String) -> URL? {
        let targets = ["zh-cn": "zh-CN", "zh-tw": "zh-TW", "pt-br": "pt"]
        let target = targets[locale.lowercased()] ?? baseLocale(locale)
        // Google rejects very long URLs; cut at a word boundary like the desktop.
        var text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        while encode(text).count > 1800, let cut = text.lastIndex(where: \.isWhitespace) { text = String(text[..<cut]) }
        if encode(text).count > 1800 { text = String(text.prefix(600)) }
        return URL(string: "https://translate.google.com/?sl=auto&tl=\(target)&text=\(encode(text))&op=translate")
    }
}
