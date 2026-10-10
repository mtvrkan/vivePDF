import Foundation

/// Page choices of the page tools (`PagesScope` in `_ranges.py` / `pageScope.ts`).
struct PagesScope: Hashable, Sendable {
    enum Kind: String, CaseIterable, Sendable { case all, odd, even, every, ranges }
    var kind: Kind = .all
    var ranges = ""
    var every = 2
    var start = 1

    /// 1-based pages, or nil when the ranges cannot be read.
    func pages(pageCount: Int) -> [Int]? {
        guard pageCount > 0 else { return [] }
        switch kind {
        case .all: return Array(1...pageCount)
        case .odd: return Array(stride(from: 1, through: pageCount, by: 2))
        case .even: return pageCount >= 2 ? Array(stride(from: 2, through: pageCount, by: 2)) : []
        case .every:
            guard every >= 1, start >= 1 else { return nil }
            return start > pageCount ? [] : Array(stride(from: start, through: pageCount, by: every))
        case .ranges: return PagesSpecs.rangePages(ranges, pageCount: pageCount)
        }
    }
}

enum PagesSpecs {
    /// "1-3, 7, 10-" → 1-based pages without repeats, in the given order (`rangePages`). Nil if invalid/empty.
    static func rangePages(_ spec: String, pageCount: Int) -> [Int]? {
        guard !spec.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        var pages: [Int] = []
        var seen = Set<Int>()
        for token in spec.split(separator: ",", omittingEmptySubsequences: false) {
            guard let bound = parseBound(String(token), pageCount: pageCount) else { return nil }
            let step = bound.last >= bound.first ? 1 : -1
            for page in stride(from: bound.first, through: bound.last, by: step) where seen.insert(page).inserted {
                pages.append(page)
            }
        }
        return pages
    }

    /// Desktop `parse_page_ranges`: empty/"all" = every page; repeats kept. 0-based. Nil when invalid.
    static func pageIndices(_ spec: String?, pageCount: Int) -> [Int]? {
        let trimmed = (spec ?? "").trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty || trimmed.lowercased() == "all" { return Array(0..<pageCount) }
        var indices: [Int] = []
        for token in trimmed.split(separator: ",", omittingEmptySubsequences: false) {
            guard let bound = parseBound(String(token), pageCount: pageCount) else { return nil }
            let step = bound.last >= bound.first ? 1 : -1
            indices += stride(from: bound.first - 1, through: bound.last - 1, by: step)
        }
        return indices
    }

    /// Number of pages a merge range selects (`pagesInRanges`), nil when invalid.
    static func pagesInRanges(_ spec: String, pageCount: Int) -> Int? { pageIndices(spec, pageCount: pageCount)?.count }

    /// "1-3; 4-6; 7-" → groups of 0-based indices (`parse_split_groups`).
    static func splitGroups(_ spec: String, pageCount: Int) -> [[Int]]? {
        let parts = spec.split(separator: ";").map(String.init).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !parts.isEmpty else { return nil }
        var groups: [[Int]] = []
        for part in parts {
            guard let group = pageIndices(part, pageCount: pageCount) else { return nil }
            groups.append(group)
        }
        return groups
    }

    private static func parseBound(_ token: String, pageCount: Int?) -> (first: Int, last: Int)? {
        let trimmed = token.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let pieces = trimmed.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        let hasDash = pieces.count == 2
        let rawFirst = pieces[0], rawLast = hasDash ? pieces[1] : ""
        guard rawFirst.allSatisfy(\.isASCIIDigit), rawLast.allSatisfy(\.isASCIIDigit), !(rawFirst.isEmpty && rawLast.isEmpty) else { return nil }
        let first = rawFirst.isEmpty ? 1 : Int(rawFirst) ?? 0
        let last: Int
        if rawLast.isEmpty {
            guard let pageCount else { return nil }
            last = hasDash ? pageCount : first
        } else {
            last = Int(rawLast) ?? 0
        }
        guard first >= 1, last >= 1 else { return nil }
        if let pageCount, first > pageCount || last > pageCount { return nil }
        return (first, last)
    }

    /// "1, 2, 3, 5" from sorted 1-based pages (`pagesToRanges`).
    static func pagesToRanges(_ pages: [Int]) -> String {
        var parts: [String] = []
        var index = 0
        while index < pages.count {
            var end = index
            while end + 1 < pages.count && pages[end + 1] == pages[end] + 1 { end += 1 }
            parts.append(end == index ? "\(pages[index])" : "\(pages[index])-\(pages[end])")
            index = end + 1
        }
        return parts.joined(separator: ", ")
    }

    // MARK: Split parts

    struct SplitPart: Hashable { var label: String; var pages: Int? }

    /// Preview of "1-3; 4-6; 7-" (`splitParts`); nil when it cannot be read.
    static func splitParts(_ spec: String, pageCount: Int?) -> [SplitPart]? {
        if let pageCount, pageCount < 1 { return nil }
        let pieces = spec.split(separator: ";").map(String.init).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !pieces.isEmpty else { return nil }
        var parts: [SplitPart] = []
        for piece in pieces {
            var bounds: [(first: Int, last: Int?)] = []
            for range in piece.split(separator: ",", omittingEmptySubsequences: false) {
                let trimmed = range.trimmingCharacters(in: .whitespaces)
                if pageCount == nil, trimmed.hasSuffix("-"), let first = Int(trimmed.dropLast().trimmingCharacters(in: .whitespaces)), first >= 1 {
                    bounds.append((first, nil))
                    continue
                }
                guard let bound = parseBound(trimmed, pageCount: pageCount) else { return nil }
                bounds.append((bound.first, bound.last))
            }
            let first = bounds[0].first
            let last = bounds[bounds.count - 1].last
            let open = bounds.contains { $0.last == nil }
            let label = last == nil ? "\(first)-" : (first == last && bounds.count == 1 ? "\(first)" : "\(first)-\(last!)")
            let count = open ? nil : bounds.reduce(0) { $0 + abs(($1.last ?? $1.first) - $1.first) + 1 }
            parts.append(SplitPart(label: label, pages: count))
        }
        return parts
    }

    /// Part starts (1-based, >1) → "1-3; 4-6; 7-9".
    static func cutsToRanges(_ starts: [Int], pageCount: Int) -> String {
        let firsts = Array(Set([1] + starts.filter { $0 > 1 && $0 <= pageCount })).sorted()
        return firsts.enumerated().map { index, first in
            let last = index + 1 < firsts.count ? firsts[index + 1] - 1 : pageCount
            return first == last ? "\(first)" : "\(first)-\(last)"
        }.joined(separator: "; ")
    }

    /// Inverse of `cutsToRanges` when the spec is a plain consecutive partition; otherwise [].
    static func rangesToCuts(_ spec: String, pageCount: Int) -> [Int] {
        let pieces = spec.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        var starts: [Int] = []
        var next = 1
        for piece in pieces {
            guard !piece.contains(","), let bound = parseBound(piece, pageCount: pageCount), bound.first == next, bound.last >= bound.first else { return [] }
            if bound.first > 1 { starts.append(bound.first) }
            next = bound.last + 1
        }
        return next == pageCount + 1 ? starts : []
    }

    /// Plain text → a case-insensitive pattern that captures the rest of the line (`textSplitPattern`).
    static func textSplitPattern(_ query: String, regex: Bool) -> String {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return "" }
        if regex { return trimmed }
        return "(\(NSRegularExpression.escapedPattern(for: trimmed))[^\\n]*)"
    }

    // MARK: File names (`_naming.py`)

    static func sanitizeFileName(_ value: String) -> String {
        var text = value.replacingOccurrences(of: "[<>:\"/\\\\|?*\\x00-\\x1f]", with: "-", options: .regularExpression)
        text = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: "(?:\\s*-\\s*)+", with: "-", options: .regularExpression)
        text = text.replacingOccurrences(of: "(?:\\s*_\\s*){2,}", with: "_", options: .regularExpression)
        text = text.trimmingCharacters(in: CharacterSet(charactersIn: " ._-"))
        text = String(text.prefix(120))
        while text.utf8.count > 180 { text.removeLast() }
        while text.hasSuffix(" ") || text.hasSuffix(".") { text.removeLast() }
        return text.isEmpty ? "output" : text
    }

    static func renderName(_ pattern: String, values: [String: String]) -> String {
        var enriched = values
        let now = Date()
        let calendar = Calendar(identifier: .gregorian)
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: now)
        enriched["date"] = enriched["date"] ?? String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
        enriched["time"] = enriched["time"] ?? String(format: "%02d-%02d-%02d", parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0)
        enriched["year"] = enriched["year"] ?? String(parts.year ?? 0)
        var result = ""
        var rest = Substring(pattern)
        while let open = rest.firstIndex(of: "{") {
            result += rest[..<open]
            guard let close = rest[open...].firstIndex(of: "}") else { break }
            let token = String(rest[rest.index(after: open)..<close])
            if !token.isEmpty, !token.contains("{"), let value = enriched[token] {
                result += value
            } else {
                result += rest[open...close]
            }
            rest = rest[rest.index(after: close)...]
        }
        result += rest
        return sanitizeFileName(result)
    }

    static func uniqueName(_ name: String, taken: inout Set<String>) -> String {
        var candidate = name
        var counter = 2
        while taken.contains(candidate.lowercased()) {
            candidate = "\(name)-\(counter)"
            counter += 1
        }
        taken.insert(candidate.lowercased())
        return candidate
    }
}

private extension Character {
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}
