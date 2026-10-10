import Foundation

/// Full-text query language of the desktop search (`ops/search.py`, SQLite FTS5): words AND-ed together,
/// `word*` prefixes, `"exact phrases"`, `-word` / `-"phrase"` exclusions, `OR` between groups and
/// `NEAR(a b, 5)`. Matching is case-, diacritic- and Turkish-dotless-i-insensitive, on whole words.
enum SearchQuery {
    enum Term: Equatable {
        case word(String, prefix: Bool)
        case phrase([String])
        case near([String], distance: Int)
    }

    struct Clause: Equatable {
        var term: Term
        var negated: Bool
    }

    /// OR of AND-groups (FTS5 precedence: AND binds tighter than OR).
    typealias Expression = [[Clause]]

    // MARK: Folding & tokenising

    private static let turkishFold: [Character: Character] = ["ş": "s", "ğ": "g", "ç": "c", "ö": "o", "ü": "u", "ı": "i", "İ": "i", "I": "i"]

    /// `fold_text` + FTS5 `remove_diacritics`: lower case, no accents, dotless i → i.
    static func fold(_ text: String) -> String {
        var mapped = String()
        mapped.reserveCapacity(text.count)
        for char in text { mapped.append(turkishFold[char] ?? char) }
        return mapped.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }

    static func isWordCharacter(_ char: Character) -> Bool {
        char != "_" && (char.isLetter || char.isNumber || char.unicodeScalars.contains { CharacterSet.nonBaseCharacters.contains($0) })
    }

    /// Splits already-folded text into word tokens (`[^\W_]+`).
    static func tokens(_ folded: String) -> [String] {
        var result: [String] = []
        var current = ""
        for char in folded {
            if isWordCharacter(char) {
                current.append(char)
            } else if !current.isEmpty {
                result.append(current)
                current = ""
            }
        }
        if !current.isEmpty { result.append(current) }
        return result
    }

    // MARK: Parsing

    private enum Token {
        case near(String), or, negPhrase(String), phrase(String), negWord(String), word(String)
    }

    private static func lex(_ query: String) -> [Token] {
        var tokens: [Token] = []
        let chars = Array(query)
        var i = 0
        func readWord(from start: Int) -> (String, Int) {
            var j = start
            while j < chars.count, isWordCharacter(chars[j]) { j += 1 }
            var word = String(chars[start..<j])
            if j < chars.count, chars[j] == "*", !word.isEmpty { word.append("*"); j += 1 }
            return (word, j)
        }
        while i < chars.count {
            let c = chars[i]
            if c == "N", query.hasPrefix("NEAR(", at: i, chars), let close = chars[(i + 5)...].firstIndex(of: ")") {
                tokens.append(.near(String(chars[(i + 5)..<close])))
                i = close + 1
            } else if c == "O", i + 1 < chars.count, chars[i + 1] == "R",
                      i == 0 || !isWordCharacter(chars[i - 1]), i + 2 >= chars.count || !isWordCharacter(chars[i + 2]) {
                tokens.append(.or)
                i += 2
            } else if c == "-", i + 1 < chars.count, chars[i + 1] == "\"", let close = chars[(i + 2)...].firstIndex(of: "\"") {
                tokens.append(.negPhrase(String(chars[(i + 2)..<close])))
                i = close + 1
            } else if c == "\"", let close = chars[(i + 1)...].firstIndex(of: "\"") {
                tokens.append(.phrase(String(chars[(i + 1)..<close])))
                i = close + 1
            } else if c == "-", i + 1 < chars.count, isWordCharacter(chars[i + 1]) {
                let (word, end) = readWord(from: i + 1)
                tokens.append(.negWord(word))
                i = end
            } else if isWordCharacter(c) {
                let (word, end) = readWord(from: i)
                tokens.append(.word(word))
                i = end
            } else {
                i += 1
            }
        }
        return tokens
    }

    private static func wordTerm(_ raw: String) -> Term? {
        let prefix = raw.hasSuffix("*")
        let parts = tokens(fold(prefix ? String(raw.dropLast()) : raw))
        guard !parts.isEmpty else { return nil }
        if parts.count == 1 { return .word(parts[0], prefix: prefix) }
        return .phrase(parts)
    }

    private static func phraseTerm(_ body: String) -> Term? {
        let parts = tokens(fold(body))
        guard !parts.isEmpty else { return nil }
        return parts.count == 1 ? .word(parts[0], prefix: false) : .phrase(parts)
    }

    static func parse(_ query: String) -> Expression {
        var groups: Expression = [[]]
        for token in lex(query) {
            var clause: Clause?
            switch token {
            case .near(let body):
                let pieces = body.split(separator: ",", maxSplits: 1).map(String.init)
                let terms = tokens(fold(pieces.first ?? ""))
                let distance = pieces.count > 1 ? Int(pieces[1].trimmingCharacters(in: .whitespaces)) ?? 10 : 10
                if terms.count >= 2 { clause = Clause(term: .near(terms, distance: distance), negated: false) }
            case .or:
                if !(groups.last ?? []).isEmpty { groups.append([]) }
            case .negPhrase(let body): clause = phraseTerm(body).map { Clause(term: $0, negated: true) }
            case .phrase(let body): clause = phraseTerm(body).map { Clause(term: $0, negated: false) }
            case .negWord(let word): clause = wordTerm(word).map { Clause(term: $0, negated: true) }
            case .word(let word): clause = wordTerm(word).map { Clause(term: $0, negated: false) }
            }
            if let clause { groups[groups.count - 1].append(clause) }
        }
        return groups.filter { !$0.isEmpty }
    }

    /// Folded words/phrases used to build snippets (`positive_terms`).
    static func positiveTerms(_ expression: Expression) -> [String] {
        expression.flatMap { group in
            group.compactMap { clause -> String? in
                guard !clause.negated else { return nil }
                switch clause.term {
                case .word(let word, _): return word
                case .phrase(let words): return words.joined(separator: " ")
                case .near: return nil
                }
            }
        }
    }

    // MARK: Snippets

    struct Snippet: Hashable {
        var before: String
        var match: String
        var after: String
        var isEmpty: Bool { before.isEmpty && match.isEmpty && after.isEmpty }
    }

    static let snippetRadius = 60

    /// Context around the first positive term on the page (`build_snippet`), mapped back to the original text.
    static func snippet(text: String, terms: [String]) -> Snippet {
        let original = Array(text)
        var folded: [Character] = []
        var origin: [Int] = []
        folded.reserveCapacity(original.count)
        for (index, char) in original.enumerated() {
            let mapped = String(turkishFold[char] ?? char).folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
            for f in mapped {
                // Whitespace runs fold to one space so phrases match across line breaks.
                folded.append(f.isWhitespace ? " " : f)
                origin.append(index)
            }
        }
        let haystack = String(folded)
        for term in terms where !term.isEmpty {
            guard let range = haystack.range(of: term) else { continue }
            let lo = haystack.distance(from: haystack.startIndex, to: range.lowerBound)
            let hi = haystack.distance(from: haystack.startIndex, to: range.upperBound) - 1
            guard lo < origin.count, hi < origin.count else { continue }
            let start = origin[lo], end = origin[hi] + 1
            let from = max(0, start - snippetRadius), to = min(original.count, end + snippetRadius)
            let clean: (ArraySlice<Character>) -> String = { String($0).replacingOccurrences(of: "\n", with: " ") }
            return Snippet(before: (from > 0 ? "…" : "") + clean(original[from..<start]),
                           match: clean(original[start..<end]),
                           after: clean(original[end..<to]) + (to < original.count ? "…" : ""))
        }
        let stripped = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\n", with: " ")
        return Snippet(before: String(stripped.prefix(160)) + (stripped.count > 160 ? "…" : ""), match: "", after: "")
    }
}

private extension String {
    func hasPrefix(_ prefix: String, at offset: Int, _ chars: [Character]) -> Bool {
        let p = Array(prefix)
        guard offset + p.count <= chars.count else { return false }
        return Array(chars[offset..<(offset + p.count)]) == p
    }
}

/// An in-memory inverted index over page texts. Immutable once built, so queries can run off the main actor.
final class SearchCorpus: @unchecked Sendable {
    struct Page {
        let file: Int
        let number: Int
        let text: String
        let length: Int
    }

    struct File {
        let folderID: String
        let path: String
        let title: String
        let pages: Int
        let modified: Date
    }

    let files: [File]
    let pages: [Page]
    /// token → (page index, word position), sorted by page then position.
    private let postings: [String: [(page: Int32, position: Int32)]]
    private let sortedTokens: [String]

    init(files: [File], pageTexts: [(file: Int, number: Int, text: String)]) {
        self.files = files
        var pages: [Page] = []
        var postings: [String: [(page: Int32, position: Int32)]] = [:]
        for entry in pageTexts {
            let pageIndex = Int32(pages.count)
            let words = SearchQuery.tokens(SearchQuery.fold(entry.text))
            for (position, word) in words.enumerated() { postings[word, default: []].append((pageIndex, Int32(position))) }
            pages.append(Page(file: entry.file, number: entry.number, text: entry.text, length: words.count))
        }
        self.pages = pages
        self.postings = postings
        sortedTokens = postings.keys.sorted()
    }

    static let empty = SearchCorpus(files: [], pageTexts: [])

    private func occurrences(of word: String, prefix: Bool) -> [Int32: [Int32]] {
        var result: [Int32: [Int32]] = [:]
        let keys: [String]
        if prefix {
            // Binary search to the first key ≥ word, then walk while keys share the prefix.
            var lo = 0, hi = sortedTokens.count
            while lo < hi { let mid = (lo + hi) / 2; if sortedTokens[mid] < word { lo = mid + 1 } else { hi = mid } }
            var found: [String] = []
            while lo < sortedTokens.count, sortedTokens[lo].hasPrefix(word) { found.append(sortedTokens[lo]); lo += 1 }
            keys = found
        } else {
            keys = [word]
        }
        for key in keys {
            for posting in postings[key] ?? [] { result[posting.page, default: []].append(posting.position) }
        }
        if prefix { for (page, list) in result { result[page] = list.sorted() } }
        return result
    }

    /// Pages matching a term, with the number of hits on each (for ranking).
    private func matches(_ term: SearchQuery.Term) -> [Int32: Int] {
        switch term {
        case .word(let word, let prefix):
            return occurrences(of: word, prefix: prefix).mapValues(\.count)
        case .phrase(let words):
            let lists = words.map { occurrences(of: $0, prefix: false) }
            guard let first = lists.first else { return [:] }
            var result: [Int32: Int] = [:]
            for (page, starts) in first {
                let others = lists.dropFirst().map { Set($0[page] ?? []) }
                guard others.allSatisfy({ !$0.isEmpty }) else { continue }
                let hits = starts.filter { start in others.enumerated().allSatisfy { $0.element.contains(start + Int32($0.offset + 1)) } }.count
                if hits > 0 { result[page] = hits }
            }
            return result
        case .near(let words, let distance):
            let lists = words.map { occurrences(of: $0, prefix: false) }
            guard let first = lists.first else { return [:] }
            var result: [Int32: Int] = [:]
            for page in first.keys {
                let perTerm = lists.map { $0[page] ?? [] }
                guard perTerm.allSatisfy({ !$0.isEmpty }) else { continue }
                if Self.within(perTerm, distance: distance) { result[page] = perTerm.reduce(0) { $0 + $1.count } }
            }
            return result
        }
    }

    /// True when one occurrence of every term fits in a window with at most `distance` words between them.
    static func within(_ positions: [[Int32]], distance: Int) -> Bool {
        var merged: [(position: Int32, term: Int)] = []
        for (term, list) in positions.enumerated() { merged += list.map { ($0, term) } }
        merged.sort { $0.position < $1.position }
        var counts = [Int](repeating: 0, count: positions.count)
        var covered = 0
        var left = 0
        for right in merged.indices {
            if counts[merged[right].term] == 0 { covered += 1 }
            counts[merged[right].term] += 1
            while covered == positions.count {
                let span = Int(merged[right].position - merged[left].position) - (positions.count - 1)
                if span <= distance { return true }
                counts[merged[left].term] -= 1
                if counts[merged[left].term] == 0 { covered -= 1 }
                left += 1
            }
        }
        return false
    }

    /// Page indices matching the expression, best first.
    func evaluate(_ expression: SearchQuery.Expression) -> [(page: Int, score: Double)] {
        var scores: [Int32: Double] = [:]
        for group in expression {
            let positives = group.filter { !$0.negated }
            guard !positives.isEmpty else { continue }
            var candidate: [Int32: Int]?
            for clause in positives {
                let found = matches(clause.term)
                if let current = candidate {
                    candidate = current.filter { found[$0.key] != nil }.reduce(into: [:]) { $0[$1.key] = $1.value + (found[$1.key] ?? 0) }
                } else {
                    candidate = found
                }
                if candidate?.isEmpty == true { break }
            }
            guard var pagesHit = candidate else { continue }
            for clause in group where clause.negated {
                for page in matches(clause.term).keys { pagesHit[page] = nil }
            }
            for (page, hits) in pagesHit {
                let length = Double(max(pages[Int(page)].length, 1))
                // Term density, damped by page length: a cheap stand-in for FTS5's bm25.
                let score = Double(hits) / log2(length + 2)
                scores[page] = max(scores[page] ?? 0, score)
            }
        }
        return scores.map { (Int($0.key), $0.value) }.sorted { $0.score == $1.score ? $0.page < $1.page : $0.score > $1.score }
    }
}
