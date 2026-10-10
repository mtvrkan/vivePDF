import Foundation

/// File-name helpers shared by the rename tool and output naming (`ops/_naming.py`, `shared/lib/naming.ts`).
enum FileNaming {
    static let maxNameLength = 120
    static let maxNameBytes = 180
    static let fallbackName = "output"
    private static let reserved: Set<String> = {
        var names: Set<String> = ["con", "prn", "aux", "nul", "conin$", "conout$"]
        for digit in "0123456789¹²³" { names.insert("com\(digit)"); names.insert("lpt\(digit)") }
        return names
    }()

    static func replace(_ text: String, _ pattern: String, with template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        return regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }

    /// `sanitize_file_name`: forbidden characters → "-", whitespace and dash runs collapsed, length-limited.
    static func sanitize(_ value: String) -> String {
        var text = replace(value, #"[<>:"/\\|?*\x{00}-\x{1f}]"#, with: "-")
        text = replace(text, #"\s+"#, with: " ")
        text = replace(text, #"(?:\s*-\s*)+"#, with: "-")
        text = replace(text, #"(?:\s*_\s*){2,}"#, with: "_")
        text = text.trimmingCharacters(in: CharacterSet(charactersIn: " ._-"))
        text = String(text.prefix(maxNameLength))
        while text.utf8.count > maxNameBytes { text.removeLast() }
        while let last = text.last, last == " " || last == "." { text.removeLast() }
        let head = text.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? text
        if reserved.contains(head.trimmingCharacters(in: .whitespaces).lowercased()) {
            let tail = text.dropFirst(head.count)
            text = "\(head)-file\(tail)"
        }
        return text.isEmpty ? fallbackName : text
    }

    /// `unique_name`: name, name-2, name-3 … not in `taken` (case-insensitive); records the result.
    static func unique(_ name: String, taken: inout Set<String>) -> String {
        var candidate = name
        var counter = 2
        while taken.contains(candidate.lowercased()) {
            candidate = "\(name)-\(counter)"
            counter += 1
        }
        taken.insert(candidate.lowercased())
        return candidate
    }

    // MARK: Output pattern (Settings › Files)

    static let outputPatternKey = "vivepdf.outputPattern"
    static let defaultOutputPattern = "{name}-{suffix}"
    static let outputPatternTokens = ["name", "suffix", "date", "time", "year"]

    static func outputPatternIsValid(_ pattern: String) -> Bool {
        !pattern.trimmingCharacters(in: .whitespaces).isEmpty
            && (pattern.contains("{name}") || pattern.contains("{date}") || pattern.contains("{time}"))
    }

    /// Replaces `{token}` with `values[token]`, leaving unknown tokens untouched.
    static func fillTokens(_ text: String, _ values: [String: String], tokenPattern: String = #"\{([^{}]+)\}"#) -> String {
        guard let regex = try? NSRegularExpression(pattern: tokenPattern) else { return text }
        let ns = text as NSString
        var result = ""
        var last = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            let key = ns.substring(with: match.range(at: 1))
            result += values[key] ?? ns.substring(with: match.range)
            last = match.range.location + match.range.length
        }
        return result + ns.substring(from: last)
    }
}

/// Month names used to read written-out dates ("18 Eylül 2026", "March 4, 2026"): the `MONTHS` table of
/// `ops/rename.py` plus the month names of `_date_names.py` for every app language.
enum DateNames {
    static let months: [String: Int] = {
        var table: [String: Int] = [:]
        let lists = [
            "ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık",
            "ocak subat mart nisan mayis haziran temmuz agustos eylul ekim kasim aralik",
            "january february march april may june july august september october november december",
            "januar februar märz april mai juni juli august september oktober november dezember",
            "janvier février mars avril mai juin juillet août septembre octobre novembre décembre",
            "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre",
            "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre",
            "jan feb mar apr may jun jul aug sep oct nov dec",
            "oca şub mar nis may haz tem ağu eyl eki kas ara",
            // `_date_names.py` additions: Portuguese, Arabic and the short forms of the other languages.
            "janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro",
            "jan fev mar abr mai jun jul ago set out nov dez",
            "يناير فبراير مارس أبريل مايو يونيو يوليو أغسطس سبتمبر أكتوبر نوفمبر ديسمبر",
            "jan feb mär apr mai jun jul aug sep okt nov dez",
            "janv févr mars avr mai juin juil août sept oct nov déc",
            "ene feb mar abr may jun jul ago sept oct nov dic",
            "gen feb mar apr mag giu lug ago set ott nov dic",
        ]
        for list in lists {
            for (index, name) in list.split(separator: " ").enumerated() where table[String(name)] == nil {
                table[String(name)] = index + 1
            }
        }
        return table
    }()

    static func month(_ name: String) -> Int? {
        months[name.lowercased()] ?? months[name.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))]
    }
}
