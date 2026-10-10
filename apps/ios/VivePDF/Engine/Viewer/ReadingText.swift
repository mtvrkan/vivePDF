import Foundation
import NaturalLanguage

/// A sentence to speak: its text (whitespace collapsed) and where it sits in the page's original text,
/// so it can be highlighted on the page (`PDFPage.selection(for:)`) and in the reading view.
struct SpokenSentence: Equatable {
    let text: String
    /// UTF-16 range in the original page string.
    let range: NSRange
}

/// Whitespace-collapsed text that remembers where each UTF-16 unit came from in the original string.
struct NormalizedText {
    let text: String
    /// Original UTF-16 offset of each UTF-16 unit of `text`.
    let origins: [Int]
    /// Original UTF-16 end offset (exclusive) of each UTF-16 unit of `text`.
    let originEnds: [Int]

    /// Collapses every whitespace run to one space and trims (desktop `normalizePageText`).
    init(_ original: String) {
        var out = String.UnicodeScalarView()
        var origins: [Int] = []
        var ends: [Int] = []
        var offset = 0
        var pendingSpace: Int?
        for scalar in original.unicodeScalars {
            let width = scalar.utf16.count
            if scalar.properties.isWhitespace {
                if pendingSpace == nil && !out.isEmpty { pendingSpace = offset }
            } else {
                if let space = pendingSpace {
                    out.append(" ")
                    origins.append(space)
                    ends.append(space + 1)
                    pendingSpace = nil
                }
                out.append(scalar)
                for _ in 0..<width {
                    origins.append(offset)
                    ends.append(offset + width)
                }
            }
            offset += width
        }
        text = String(out)
        self.origins = origins
        originEnds = ends
    }

    /// Maps a range of `text` back to the original string.
    func originalRange(_ range: NSRange) -> NSRange {
        guard range.length > 0, range.location < origins.count else { return NSRange(location: NSNotFound, length: 0) }
        let start = origins[range.location]
        let end = originEnds[min(range.location + range.length, originEnds.count) - 1]
        return NSRange(location: start, length: max(0, end - start))
    }
}

/// Sentence splitting for read aloud (desktop `splitSentences` + `locateSentences`), using NLTokenizer so it
/// works for every script (Arabic, CJK…), with long sentences cut on word boundaries (`SENTENCE_MAX_CHARS`).
enum SentenceSplitter {
    static let maxChars = 400

    static func sentences(in original: String, maxChars: Int = maxChars) -> [SpokenSentence] {
        let normalized = NormalizedText(original)
        let text = normalized.text
        guard !text.isEmpty else { return [] }
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text
        let ns = text as NSString
        var ranges: [NSRange] = []
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            var nsRange = NSRange(range, in: text)
            // Trim surrounding spaces so highlights hug the words.
            while nsRange.length > 0, ns.character(at: nsRange.location) == 32 { nsRange.location += 1; nsRange.length -= 1 }
            while nsRange.length > 0, ns.character(at: nsRange.location + nsRange.length - 1) == 32 { nsRange.length -= 1 }
            guard nsRange.length > 0 else { return true }
            // "Dr. Smith" is one sentence (desktop ABBREVIATIONS).
            if let previous = ranges.last, endsWithAbbreviation(ns.substring(with: previous)) {
                ranges[ranges.count - 1] = NSRange(location: previous.location, length: nsRange.location + nsRange.length - previous.location)
            } else {
                ranges.append(nsRange)
            }
            return true
        }
        return ranges.flatMap { cap($0, in: ns, maxChars: maxChars) }.map {
            SpokenSentence(text: joinHyphenation(ns.substring(with: $0)), range: normalized.originalRange($0))
        }
    }

    /// "exam- ple" (a word hyphenated across lines) is spoken as "example".
    static func joinHyphenation(_ text: String) -> String {
        text.replacingOccurrences(of: "(\\p{L})- (\\p{Ll})", with: "$1$2", options: .regularExpression)
    }

    static let abbreviations: Set<String> = ["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs", "etc", "eg", "ie",
                                             "no", "st", "vol", "fig", "cf", "approx", "sn", "sy", "dt", "op"]

    static func endsWithAbbreviation(_ sentence: String) -> Bool {
        guard sentence.hasSuffix(".") else { return false }
        let word = sentence.dropLast().split(whereSeparator: { !$0.isLetter }).last.map { $0.lowercased() } ?? ""
        return abbreviations.contains(word) && sentence.dropLast().last?.isLetter == true
    }

    /// Splits an over-long range into chunks of at most `maxChars`, breaking at spaces.
    static func cap(_ range: NSRange, in text: NSString, maxChars: Int) -> [NSRange] {
        guard range.length > maxChars else { return [range] }
        var pieces: [NSRange] = []
        var start = range.location
        let end = range.location + range.length
        while end - start > maxChars {
            var cut = start + maxChars
            while cut > start, text.character(at: cut) != 32 { cut -= 1 }
            if cut == start { cut = start + maxChars }
            pieces.append(NSRange(location: start, length: cut - start))
            start = cut
            while start < end, text.character(at: start) == 32 { start += 1 }
        }
        if start < end { pieces.append(NSRange(location: start, length: end - start)) }
        return pieces
    }
}

/// One reflowed paragraph of the reading view, with the original offsets of its characters so the sentence
/// being read aloud can be highlighted (desktop `readingParagraphs`).
struct ReadingParagraph: Equatable {
    let text: String
    /// Original UTF-16 offset of each UTF-16 unit of `text`.
    let origins: [Int]

    /// UTF-16 ranges of `text` that come from `original` (for highlighting).
    func ranges(overlapping original: NSRange) -> [NSRange] {
        var result: [NSRange] = []
        var runStart: Int?
        let lower = original.location, upper = original.location + original.length
        for (index, origin) in origins.enumerated() {
            let inside = origin >= lower && origin < upper
            if inside, runStart == nil { runStart = index }
            if !inside, let start = runStart { result.append(NSRange(location: start, length: index - start)); runStart = nil }
        }
        if let start = runStart { result.append(NSRange(location: start, length: origins.count - start)) }
        return result
    }
}

enum ReadingLayout {
    /// Reflows a page's extracted text: blank lines separate paragraphs; single line breaks inside a
    /// paragraph become spaces unless the line ends a clause or the next line is a bullet / indented;
    /// words hyphenated across lines are joined ("exam-\nple" → "example").
    static func paragraphs(from original: String) -> [ReadingParagraph] {
        let units = Array(original.utf16)
        var paragraphs: [ReadingParagraph] = []
        var buffer: [UInt16] = []
        var origins: [Int] = []

        func flush() {
            while let last = buffer.last, isSpace(last) { buffer.removeLast(); origins.removeLast() }
            if !buffer.isEmpty {
                paragraphs.append(ReadingParagraph(text: String(utf16CodeUnits: buffer, count: buffer.count), origins: origins))
            }
            buffer.removeAll()
            origins.removeAll()
        }

        var index = 0
        while index < units.count {
            let unit = units[index]
            if unit == 10 || unit == 13 {
                // Collect the whole line-break run.
                var newlines = 0
                var next = index
                while next < units.count, isSpace(units[next]) || units[next] == 10 || units[next] == 13 {
                    if units[next] == 10 || (units[next] == 13 && (next + 1 >= units.count || units[next + 1] != 10)) { newlines += 1 }
                    next += 1
                }
                if newlines >= 2 || next >= units.count {
                    flush()
                } else {
                    let previous = buffer.last
                    let following = next < units.count ? units[next] : 32
                    let nextIndented = next > index + 1 && units[index + 1] != 10 && isSpace(units[index + 1])
                    if let previous, previous == 45 /* - */, buffer.count >= 2, isLetter(buffer[buffer.count - 2]), isLowercaseLetter(following) {
                        buffer.removeLast()
                        origins.removeLast()
                    } else if let previous, [46, 58, 59, 33, 63].contains(previous) || following == 0x2022 || nextIndented {
                        // Line ends a clause or the next line is a bullet / indented: keep the line break.
                        while let last = buffer.last, isSpace(last) { buffer.removeLast(); origins.removeLast() }
                        buffer.append(10)
                        origins.append(index)
                    } else if !buffer.isEmpty {
                        buffer.append(32)
                        origins.append(index)
                    }
                }
                index = next
                continue
            }
            if isSpace(unit) {
                if let last = buffer.last, !isSpace(last) { buffer.append(32); origins.append(index) }
            } else {
                buffer.append(unit)
                origins.append(index)
            }
            index += 1
        }
        flush()
        return paragraphs
    }

    private static func isSpace(_ unit: UInt16) -> Bool { unit == 32 || unit == 9 || unit == 0xA0 || unit == 12 }
    private static func isLetter(_ unit: UInt16) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return scalar.properties.isAlphabetic
    }
    private static func isLowercaseLetter(_ unit: UInt16) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return scalar.properties.isLowercase
    }
}

/// A speech voice reduced to what the chooser needs (testable without AVFoundation).
struct VoiceInfo: Equatable, Identifiable {
    let id: String
    let name: String
    /// BCP-47 tag, e.g. "en-US", "ar-001".
    let language: String
    /// 1 default, 2 enhanced, 3 premium.
    let quality: Int
}

enum VoiceChooser {
    /// Language code of a BCP-47 tag ("pt-BR" → "pt").
    static func baseLanguage(_ tag: String) -> String {
        String(tag.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first ?? "")
    }

    /// Best voice for a language: same language, preferring the reader's region, then higher quality,
    /// then name. Nil when no installed voice speaks the language.
    static func best(for language: String, among voices: [VoiceInfo], preferredRegion: String? = nil) -> VoiceInfo? {
        let base = baseLanguage(language)
        let wantedTag = language.lowercased().replacingOccurrences(of: "_", with: "-")
        let candidates = voices.filter { baseLanguage($0.language) == base }
        return candidates.max { a, b in
            score(a, wantedTag: wantedTag, region: preferredRegion) < score(b, wantedTag: wantedTag, region: preferredRegion)
                || (score(a, wantedTag: wantedTag, region: preferredRegion) == score(b, wantedTag: wantedTag, region: preferredRegion) && a.name > b.name)
        }
    }

    private static func score(_ voice: VoiceInfo, wantedTag: String, region: String?) -> Int {
        let tag = voice.language.lowercased()
        var value = voice.quality * 10
        if tag == wantedTag { value += 100 }
        if let region, tag.hasSuffix("-" + region.lowercased()) { value += 50 }
        return value
    }

    /// Voices grouped by base language, the reader's language first, then alphabetically by display name.
    static func grouped(_ voices: [VoiceInfo], firstLanguage: String, name: (String) -> String) -> [(language: String, voices: [VoiceInfo])] {
        let groups = Dictionary(grouping: voices) { baseLanguage($0.language) }
        let first = baseLanguage(firstLanguage)
        return groups.keys
            .sorted { a, b in
                if (a == first) != (b == first) { return a == first }
                return name(a).localizedCaseInsensitiveCompare(name(b)) == .orderedAscending
            }
            .map { key in (key, groups[key]!.sorted { ($0.quality, $1.name) > ($1.quality, $0.name) }) }
    }
}

/// Google Translate web fallback (desktop `translateUrl`).
enum TranslateWeb {
    static let maxChars = 5000

    static func url(for text: String, target: String) -> URL? {
        var components = URLComponents(string: "https://translate.google.com/")
        let clipped = String(text.prefix(1800))
        components?.queryItems = [
            URLQueryItem(name: "sl", value: "auto"),
            URLQueryItem(name: "tl", value: target),
            URLQueryItem(name: "text", value: clipped),
            URLQueryItem(name: "op", value: "translate"),
        ]
        return components?.url
    }
}
