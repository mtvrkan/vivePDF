import CoreText
import Foundation

/// Text heights for CV layout (`domMeasure` / `estimateMeasure` in `cvRender.ts` / `cvSample.ts`).
/// The real measure wraps with Core Text advances of the resolved face — like the browser box the
/// desktop measures: words wrap at spaces, over-long words break anywhere, each line is
/// `lineHeight × size` tall.
enum StudioCVMeasure {
    typealias Measure = (StudioElement) -> Double

    private static var cache: [String: Double] = [:]
    private static let lock = NSLock()

    static func clear() {
        lock.lock()
        cache.removeAll()
        lock.unlock()
    }

    /// Measures with real fonts in `language` (case rules).
    static func real(language: String) -> Measure {
        { element in measure(element, language: language) }
    }

    static func measure(_ element: StudioElement, language: String) -> Double {
        guard let text = element.text else { return 0 }
        let key = [language, text.fontId ?? "", "\(text.fontSize)", "\(text.bold)", "\(text.italic)", text.textCase.rawValue, "\(text.letterSpacing)", "\(text.lineHeight)", "\(Int((element.width * 10).rounded()))", "\(StudioFonts.shared.revision)", text.plainText].joined(separator: "|")
        lock.lock()
        if let hit = cache[key] { lock.unlock(); return hit }
        lock.unlock()
        let face = StudioFonts.shared.face(text.fontId, weight: StudioTypography.weightOf(bold: text.bold, weight: text.weight), italic: text.italic)
        let font = face.font(size: text.fontSize)
        let spacing = text.letterSpacing * text.fontSize
        let cased = StudioTypography.caseText(text.plainText, text.textCase, text.language ?? language)
        var lines = 0
        for paragraph in cased.components(separatedBy: "\n") {
            lines += wrappedLines(paragraph, width: element.width, font: font, spacing: spacing)
        }
        let height = Double(max(1, lines)) * text.fontSize * text.lineHeight
        lock.lock()
        if cache.count > 4000 { cache.removeAll() }
        cache[key] = height
        lock.unlock()
        return height
    }

    static func advance(_ text: String, font: CTFont, spacing: Double) -> Double {
        guard !text.isEmpty else { return 0 }
        let attributes: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): font, NSAttributedString.Key(kCTKernAttributeName as String): spacing, NSAttributedString.Key(kCTLigatureAttributeName as String): 0]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
        return CTLineGetTypographicBounds(line, nil, nil, nil)
    }

    private static func wrappedLines(_ paragraph: String, width: Double, font: CTFont, spacing: Double) -> Int {
        let words = paragraph.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        guard paragraph.contains(where: { !$0.isWhitespace }) else { return 1 }
        let space = advance(" ", font: font, spacing: spacing)
        var lines = 1
        var used = 0.0
        var pending = 0.0
        for word in words {
            if word.isEmpty { pending += space; continue }
            var w = advance(word, font: font, spacing: spacing)
            if used > 0 && used + pending + w > width + 0.01 {
                lines += 1
                used = 0
            } else if used > 0 {
                used += pending
            }
            pending = space
            if w > width + 0.01 {
                // break-word: split the word into pieces that fit.
                var piece = ""
                for char in word {
                    let next = advance(piece + String(char), font: font, spacing: spacing)
                    if !piece.isEmpty && used + next > width + 0.01 {
                        lines += 1
                        used = 0
                        piece = String(char)
                    } else {
                        piece.append(char)
                    }
                }
                w = advance(piece, font: font, spacing: spacing)
            }
            used += w
        }
        return lines
    }

    /// Glyph-count estimate used for design thumbnails (`estimateMeasure`).
    static let estimate: Measure = { element in
        guard let text = element.text else { return 0 }
        let size = text.fontSize
        let glyph = size * 0.53 * (text.bold ? 1.07 : 1) * (text.textCase == .upper ? 1.18 : 1) + text.letterSpacing * size
        let perLine = max(1, Int(floor(element.width / glyph)))
        let lines = text.plainText.components(separatedBy: "\n").reduce(0) { $0 + estimatedLines($1, perLine) }
        return Double(lines) * size * text.lineHeight + 2
    }

    private static func estimatedLines(_ paragraph: String, _ perLine: Int) -> Int {
        guard !paragraph.cvTrimmed.isEmpty else { return 1 }
        var lines = 1
        var used = 0
        for word in paragraph.split(whereSeparator: \.isWhitespace) {
            let length = word.utf16.count
            if used == 0 {
                lines += max(0, length - 1) / perLine
                used = length % perLine == 0 ? perLine : length % perLine
            } else if used + 1 + length <= perLine {
                used += 1 + length
            } else {
                lines += 1 + max(0, length - 1) / perLine
                used = length % perLine == 0 ? perLine : length % perLine
            }
        }
        return lines
    }
}
