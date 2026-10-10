import Foundation

/// Port of `model/typography.ts` + `_studio_text_paragraphs.py`: weights, letter case, list markers and
/// paragraph splitting shared by the canvas, the layout engine and the editor.
enum StudioTypography {
    static let defaultFontId = "bundled:dejavu-sans"
    static let listIndentEm = 1.6
    static let regularWeight = 400
    static let boldWeight = 700
    static let boldFrom = 600
    static let checkMark = "✓"

    static func weightOf(bold: Bool, weight: Int?) -> Int { weight ?? (bold ? boldWeight : regularWeight) }

    // MARK: Case

    private static func dotless(_ language: String) -> Bool {
        let base = language.split(separator: "-").first.map { $0.lowercased() } ?? ""
        return base == "tr" || base == "az"
    }

    static func upper(_ char: Character, _ language: String) -> String {
        if char == "i" && dotless(language) { return "İ" }
        return String(char).uppercased()
    }

    static func lower(_ char: Character, _ language: String) -> String {
        if dotless(language) {
            if char == "I" { return "ı" }
            if char == "İ" { return "i" }
        }
        return String(char).lowercased()
    }

    private static func isLetter(_ char: Character) -> Bool { char.unicodeScalars.first?.properties.isAlphabetic == true && char.isLetter }

    private static func insideWord(_ char: Character?) -> Bool {
        guard let char else { return false }
        if char == "'" || char == "’" || char == "ʼ" { return true }
        return char.isLetter || char.isNumber || char.unicodeScalars.first.map { $0.properties.generalCategory == .nonspacingMark || $0.properties.generalCategory == .spacingMark || $0.properties.generalCategory == .enclosingMark } == true
    }

    /// Applies text case across consecutive texts (title case looks at the previous character across runs).
    static func caseTexts(_ texts: [String], _ mode: StudioTextCase, _ language: String) -> [String] {
        guard mode != .none else { return texts }
        var previous: Character? = nil
        return texts.map { text in
            var result = ""
            for char in text {
                switch mode {
                case .upper: result += upper(char, language)
                case .lower: result += lower(char, language)
                default: result += isLetter(char) && !insideWord(previous) ? upper(char, language) : String(char)
                }
                previous = char
            }
            return result
        }
    }

    static func caseText(_ text: String, _ mode: StudioTextCase, _ language: String) -> String { caseTexts([text], mode, language)[0] }

    // MARK: Lists

    private static func alpha(_ count: Int) -> String {
        var value = count
        var label = ""
        while value > 0 {
            value -= 1
            label = String(UnicodeScalar(UInt8(97 + value % 26))) + label
            value /= 26
        }
        return label
    }

    private static let romanTable: [(Int, String)] = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]

    private static func roman(_ count: Int) -> String {
        var value = count
        var label = ""
        for (amount, symbol) in romanTable {
            while value >= amount { label += symbol; value -= amount }
        }
        return label
    }

    static func markerText(_ kind: StudioListKind, _ count: Int) -> String? {
        switch kind {
        case .none: nil
        case .bullet: "•"
        case .dash: "–"
        case .check: checkMark
        case .decimal: "\(count)."
        case .alpha: "\(alpha(count)))"
        case .roman: "\(roman(count))."
        }
    }

    static func listMarkers(_ paragraphs: [StudioParagraph]) -> [String?] {
        var counters: [(StudioListKind, Int)] = []
        return paragraphs.map { paragraph in
            guard paragraph.list != .none else { counters.removeAll(); return nil }
            let level = paragraph.level
            if counters.count > level + 1 { counters.removeLast(counters.count - level - 1) }
            while counters.count <= level { counters.append((.none, 0)) }
            let current = counters[level]
            let count = current.0 == paragraph.list ? current.1 + 1 : 1
            counters[level] = (paragraph.list, count)
            return markerText(paragraph.list, count)
        }
    }

    static func paragraphCount(_ runs: [StudioTextRun]) -> Int {
        1 + runs.reduce(0) { $0 + $1.text.filter { $0 == "\n" }.count }
    }

    static func paragraphAt(_ paragraphs: [StudioParagraph], _ index: Int) -> StudioParagraph {
        index < paragraphs.count ? paragraphs[index] : .plain
    }

    static func fitParagraphs(_ paragraphs: [StudioParagraph], count: Int) -> [StudioParagraph] {
        if paragraphs.count == count { return paragraphs }
        return (0..<max(0, count)).map { paragraphAt(paragraphs, $0) }
    }

    // MARK: Run style

    struct RunStyle: Equatable, Hashable {
        var bold: Bool
        var italic: Bool
        var underline: Bool
        var strike: Bool
        var color: String
        var fontId: String
        var scale: Double
        var weight: Int?

        var resolvedWeight: Int { StudioTypography.weightOf(bold: bold, weight: weight) }
    }

    static func runStyle(_ text: StudioText, _ run: StudioTextRun) -> RunStyle {
        RunStyle(
            bold: run.bold ?? text.bold,
            italic: run.italic ?? text.italic,
            underline: run.underline ?? text.underline,
            strike: run.strike ?? text.strike,
            color: run.color ?? text.color,
            fontId: run.fontId ?? text.fontId ?? defaultFontId,
            scale: run.scale ?? 1,
            weight: run.weight ?? text.weight
        )
    }

    /// Builds the minimal run for `style` relative to the element defaults (`runOf` in richText.ts).
    static func run(_ text: StudioText, _ value: String, _ style: RunStyle) -> StudioTextRun {
        let base = runStyle(text, StudioTextRun(text: ""))
        var run = StudioTextRun(text: value)
        if style.bold != base.bold { run.bold = style.bold }
        if style.italic != base.italic { run.italic = style.italic }
        if style.underline != base.underline { run.underline = style.underline }
        if style.strike != base.strike { run.strike = style.strike }
        if style.color != base.color { run.color = style.color }
        if style.fontId != base.fontId { run.fontId = style.fontId }
        if style.scale != 1 { run.scale = style.scale }
        if style.weight != base.weight { run.weight = .some(style.weight) }
        return run
    }

    /// Merges neighbouring runs with the same effective style (`compactRuns`).
    static func compactRuns(_ text: StudioText, _ runs: [StudioTextRun]) -> [StudioTextRun] {
        var merged: [(String, RunStyle)] = []
        for run in runs where !run.text.isEmpty {
            let style = runStyle(text, run)
            if let last = merged.last, last.1 == style { merged[merged.count - 1].0 += run.text } else { merged.append((run.text, style)) }
        }
        if merged.isEmpty { return [StudioTextRun(text: "")] }
        return merged.map { run(text, $0.0, $0.1) }
    }

    // MARK: Paragraph split

    struct Paragraph {
        var paragraph: StudioParagraph
        var runs: [StudioTextRun]
        var marker: String?
        var text: String { runs.map(\.text).joined() }
    }

    static func splitParagraphs(_ runs: [StudioTextRun], _ paragraphs: [StudioParagraph], fill: ((String) -> String)? = nil) -> [Paragraph] {
        var split: [(StudioParagraph, [StudioTextRun])] = [(paragraphAt(paragraphs, 0), [])]
        for run in runs {
            for (index, part) in run.text.components(separatedBy: "\n").enumerated() {
                if index > 0 { split.append((paragraphAt(paragraphs, split.count), [])) }
                if !part.isEmpty { var r = run; r.text = part; split[split.count - 1].1.append(r) }
            }
        }
        if let fill {
            var filled: [(StudioParagraph, [StudioTextRun])] = []
            for entry in split {
                var pieces: [(StudioParagraph, [StudioTextRun])] = [(entry.0, [])]
                for run in entry.1 {
                    let value = fill(run.text).replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
                    for (index, part) in value.components(separatedBy: "\n").enumerated() {
                        if index > 0 { pieces.append((entry.0, [])) }
                        if !part.isEmpty { var r = run; r.text = part; pieces[pieces.count - 1].1.append(r) }
                    }
                }
                filled += pieces
            }
            split = filled
        }
        let markers = listMarkers(split.map(\.0))
        return split.enumerated().map { Paragraph(paragraph: $1.0, runs: $1.1, marker: markers[$0]) }
    }

    /// Drops a trailing empty paragraph (a final newline adds no line when displayed).
    static func visibleParagraphs(_ list: [Paragraph]) -> [Paragraph] {
        if list.count > 1, let last = list.last, last.text.isEmpty { return Array(list.dropLast()) }
        return list
    }
}
