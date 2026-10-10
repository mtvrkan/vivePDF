import CoreGraphics
import CoreText
import Foundation

/// Text layout for Studio text boxes — a port of the engine's `_studio_text_layout.py` (word wrapping,
/// broken long words, CSS half-leading line boxes, list markers, justify, shrink-to-fit) measured with
/// Core Text. Kerning and ligatures are off, as on the desktop canvas, so both platforms agree.
enum StudioTextLayout {
    static let minShrinkSize = 4.0
    static let shrinkStep = 0.5
    static let fitTolerance = 0.01
    static let unbounded = 1e9

    struct Style: Hashable {
        var fontId: String?
        var weight: Int
        var italic: Bool
        var underline: Bool
        var strike: Bool
        var color: String
        var size: Double

        var face: StudioFace { StudioFonts.shared.face(fontId, weight: weight, italic: italic) }
    }

    struct Atom {
        var text: String
        var style: Style
        var space: Bool
    }

    struct Paragraph {
        var kind: StudioListKind
        var level: Int
        var pieces: [(String, Style)]
        var marker: String?
        var markerStyle: Style
    }

    private struct Line {
        var atoms: [Atom]
        var wrapped: Bool
        var indent: Double
        var marker: Atom?
    }

    /// A laid-out line: visible atoms in logical order with their measured widths.
    struct LaidLine {
        var atoms: [Atom]
        var widths: [Double]
        /// Left edge of the line content (after alignment), in box coordinates.
        var x: Double
        var baseline: Double
        var natural: Double
        /// Extra advance per space character (justify).
        var extra: Double
        var marker: (text: String, x: Double, style: Style, width: Double)?
        var above: Double
        var below: Double
    }

    struct Result {
        var lines: [LaidLine]
        /// Effective font scale after shrink-to-fit (1 = as designed).
        var scale: Double
        var spacing: Double
        var direction: StudioDirection
        var totalHeight: Double
        /// Widest line including list indent (auto-width boxes).
        var naturalWidth: Double
        var bands: [CGRect]
        var isEmpty: Bool { lines.allSatisfy { $0.atoms.isEmpty && $0.marker == nil } }
    }

    // MARK: Paragraphs (`_studio_text_paragraphs.py`)

    static func runStyle(_ text: StudioText, _ run: StudioTextRun) -> Style {
        let bold = run.bold ?? text.bold
        let explicit: Int? = run.weight ?? text.weight
        return Style(
            fontId: run.fontId ?? text.fontId,
            weight: explicit ?? (bold ? StudioTypography.boldWeight : StudioTypography.regularWeight),
            italic: run.italic ?? text.italic,
            underline: run.underline ?? text.underline,
            strike: run.strike ?? text.strike,
            color: run.color ?? text.color,
            size: min(1000, (run.scale ?? 1) * text.fontSize)
        )
    }

    private static func baseStyle(_ text: StudioText) -> Style {
        Style(fontId: text.fontId, weight: text.weight ?? StudioTypography.regularWeight, italic: false, underline: false, strike: false, color: text.color, size: text.fontSize)
    }

    private static func lines(of text: String) -> [String] {
        text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
    }

    static func paragraphs(_ text: StudioText, values: [String: String], language: String) -> [Paragraph] {
        func attributes(_ index: Int) -> (StudioListKind, Int) {
            index < text.paragraphs.count ? (text.paragraphs[index].list, text.paragraphs[index].level) : (.none, 0)
        }
        var split: [((StudioListKind, Int), [(String, Style)])] = [(attributes(0), [])]
        for run in text.runs {
            let style = runStyle(text, run)
            for (index, part) in lines(of: run.text).enumerated() {
                if index > 0 { split.append((attributes(split.count), [])) }
                if !part.isEmpty { split[split.count - 1].1.append((part, style)) }
            }
        }
        if !values.isEmpty {
            var filled: [((StudioListKind, Int), [(String, Style)])] = []
            for (attrs, pieces) in split {
                var current: [((StudioListKind, Int), [(String, Style)])] = [(attrs, [])]
                for (part, style) in pieces {
                    for (index, chunk) in lines(of: StudioPlaceholders.fill(part, values)).enumerated() {
                        if index > 0 { current.append((attrs, [])) }
                        if !chunk.isEmpty { current[current.count - 1].1.append((chunk, style)) }
                    }
                }
                filled += current
            }
            split = filled
        }
        var markers = StudioTypography.listMarkers(split.map { StudioParagraph(list: $0.0.0, level: $0.0.1) })
        if split.count > 1, split.last?.1.isEmpty == true {
            split.removeLast()
            markers.removeLast()
        }
        var texts: [String] = []
        for (_, pieces) in split {
            texts += pieces.map(\.0)
            texts.append("\n")
        }
        var cased = StudioTypography.caseTexts(texts, text.textCase, text.language ?? language).makeIterator()
        var result: [Paragraph] = []
        for (index, ((kind, level), pieces)) in split.enumerated() {
            let styled = pieces.map { (cased.next() ?? $0.0, $0.1) }
            _ = cased.next()
            let first = pieces.first?.1 ?? baseStyle(text)
            let markerStyle = kind == .check
                ? Style(fontId: StudioTypography.defaultFontId, weight: StudioTypography.regularWeight, italic: false, underline: false, strike: false, color: first.color, size: text.fontSize)
                : Style(fontId: first.fontId, weight: first.weight, italic: false, underline: false, strike: false, color: first.color, size: text.fontSize)
            result.append(Paragraph(kind: kind, level: level, pieces: styled, marker: markers[index], markerStyle: markerStyle))
        }
        return result
    }

    // MARK: Measuring

    final class Measurer {
        private var cache: [String: Double] = [:]

        func advance(_ text: String, _ face: StudioFace, _ size: Double) -> Double {
            let key = "\(ObjectIdentifier(face).hashValue)|\(size)|\(text)"
            if let hit = cache[key] { return hit }
            let value = StudioTextLayout.measure(text, font: face.font(size: size))
            cache[key] = value
            return value
        }
    }

    static func attributes(font: CTFont, color: CGColor? = nil, kern: Double = 0) -> [NSAttributedString.Key: Any] {
        var attrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTKernAttributeName as String): kern,
            NSAttributedString.Key(kCTLigatureAttributeName as String): 0,
        ]
        if let color { attrs[NSAttributedString.Key(kCTForegroundColorAttributeName as String)] = color }
        return attrs
    }

    static func measure(_ text: String, font: CTFont) -> Double {
        guard !text.isEmpty else { return 0 }
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes(font: font)))
        return CTLineGetTypographicBounds(line, nil, nil, nil)
    }

    private static func width(_ m: Measurer, _ atom: Atom, _ scale: Double, _ spacing: Double) -> Double {
        let text = atom.text.replacingOccurrences(of: "\t", with: " ")
        return m.advance(text, atom.style.face, atom.style.size * scale) + spacing * Double(text.unicodeScalars.count)
    }

    // MARK: Wrapping

    private static func atoms(_ pieces: [(String, Style)]) -> [Atom] {
        var out: [Atom] = []
        for (text, style) in pieces {
            var current = ""
            var currentSpace: Bool?
            for char in text {
                let space = char == " " || char == "\t"
                if char == "\n" {
                    if !current.isEmpty { out.append(Atom(text: current, style: style, space: currentSpace ?? false)) }
                    current = ""; currentSpace = nil
                    continue
                }
                if currentSpace != nil && currentSpace != space {
                    out.append(Atom(text: current, style: style, space: currentSpace!))
                    current = ""
                }
                current.append(char)
                currentSpace = space
            }
            if !current.isEmpty { out.append(Atom(text: current, style: style, space: currentSpace ?? false)) }
        }
        return out
    }

    private static func words(_ atoms: [Atom]) -> [(Bool, [Atom])] {
        var tokens: [(Bool, [Atom])] = []
        for atom in atoms {
            if let last = tokens.last, last.0 == atom.space { tokens[tokens.count - 1].1.append(atom) } else { tokens.append((atom.space, [atom])) }
        }
        return tokens
    }

    private static func splitWord(_ m: Measurer, _ word: [Atom], _ scale: Double, _ spacing: Double, _ width: Double) -> [[Atom]] {
        var chunks: [[Atom]] = []
        var current: [Atom] = []
        var used = 0.0
        for atom in word {
            for char in atom.text {
                let piece = Atom(text: String(char), style: atom.style, space: false)
                let advance = StudioTextLayout.width(m, piece, scale, spacing)
                if !current.isEmpty && used + advance > width + fitTolerance {
                    chunks.append(current)
                    current = []
                    used = 0
                }
                if let last = current.last, last.style == atom.style { current[current.count - 1].text.append(char) } else { current.append(piece) }
                used += advance
            }
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }

    private static func wrap(_ m: Measurer, _ atoms: [Atom], _ scale: Double, _ spacing: Double, _ width: Double) -> ([[Atom]], [Bool], Bool) {
        var lines: [[Atom]] = []
        var wrapped: [Bool] = []
        var broke = false
        var current: [Atom] = []
        var used = 0.0
        var pending: [Atom] = []
        var pendingWidth = 0.0
        for (space, token) in words(atoms) {
            var token = token
            var tokenWidth = token.reduce(0) { $0 + StudioTextLayout.width(m, $1, scale, spacing) }
            if space {
                pending += token
                pendingWidth += tokenWidth
                continue
            }
            if !current.isEmpty && used + pendingWidth + tokenWidth > width + fitTolerance {
                lines.append(current + pending)
                wrapped.append(true)
                current = []
                used = 0
            } else if !current.isEmpty || !pending.isEmpty {
                current += pending
                used += pendingWidth
            }
            pending = []
            pendingWidth = 0
            if tokenWidth > width + fitTolerance {
                broke = true
                let chunks = splitWord(m, token, scale, spacing, width)
                for chunk in chunks.dropLast() {
                    lines.append(current + chunk)
                    wrapped.append(true)
                    current = []
                    used = 0
                }
                token = chunks.last ?? []
                tokenWidth = token.reduce(0) { $0 + StudioTextLayout.width(m, $1, scale, spacing) }
            }
            current += token
            used += tokenWidth
        }
        lines.append(current + pending)
        wrapped.append(false)
        return (lines, wrapped, broke)
    }

    private static func trimmed(_ atoms: [Atom]) -> [Atom] {
        var end = atoms.count
        while end > 0 && atoms[end - 1].space { end -= 1 }
        return Array(atoms[..<end])
    }

    private static func halfLeading(_ face: StudioFace, _ size: Double, _ lineHeight: Double) -> (Double, Double) {
        let leading = (lineHeight * size - (face.ascender - face.descender) * size) / 2
        return (face.ascender * size + leading, -face.descender * size + leading)
    }

    // MARK: Layout

    struct Box {
        var width: Double
        var height: Double
    }

    private struct CacheKey: Hashable {
        let text: StudioText
        let width: Double
        let height: Double
        let values: [String: String]
        let language: String
        let revision: Int
    }

    private final class CacheBox { let result: Result; init(_ r: Result) { result = r } }
    private static let cache: NSCache<StudioCacheKey, CacheBox> = {
        let c = NSCache<StudioCacheKey, CacheBox>()
        c.countLimit = 600
        return c
    }()

    /// Lays out `text` in a `width` × `height` box (box-local coordinates, y down).
    static func layout(_ text: StudioText, width: Double, height: Double, values: [String: String] = [:], language: String) -> Result {
        let key = StudioCacheKey(CacheKey(text: text, width: width, height: height, values: values, language: language, revision: StudioFonts.shared.revision))
        if let hit = cache.object(forKey: key) { return hit.result }
        let result = compute(text, width: width, height: height, values: values, language: language)
        cache.setObject(CacheBox(result), forKey: key)
        return result
    }

    private static func compute(_ item: StudioText, width boxWidth: Double, height boxHeight: Double, values: [String: String], language: String) -> Result {
        let m = Measurer()
        let paragraphs = self.paragraphs(item, values: values, language: language)
        let autoWidth = item.autoSize == .width
        let shrink = item.autoSize == .shrink
        let floor = min(minShrinkSize, item.fontSize)
        let strut = StudioFonts.shared.face(item.fontId, weight: StudioTypography.regularWeight, italic: false)
        var size = item.fontSize
        var scale = 1.0
        var built: [Line] = []
        var metrics: [(Double, Double)] = []
        var total = 0.0
        while true {
            scale = size / item.fontSize
            let body = item.fontSize * scale
            let spacing = item.letterSpacing * item.fontSize * scale
            built = []
            var broke = false
            for paragraph in paragraphs {
                let listed = paragraph.kind != .none
                let indent = listed ? Double(paragraph.level + 1) * StudioTypography.listIndentEm * body : 0
                let available = autoWidth ? unbounded : max(1, boxWidth - indent)
                let (rows, wrapped, split) = wrap(m, atoms(paragraph.pieces), scale, spacing, available)
                broke = broke || split
                for (index, row) in rows.enumerated() {
                    let marker = index == 0 ? paragraph.marker.map { Atom(text: $0, style: paragraph.markerStyle, space: false) } : nil
                    built.append(Line(atoms: row, wrapped: wrapped[index], indent: indent, marker: marker))
                }
            }
            metrics = built.map { line in
                var (above, below) = halfLeading(strut, body, item.lineHeight)
                var boxes = line.atoms.map { ($0.style.face, $0.style.size * scale) }
                if let marker = line.marker { boxes.append((marker.style.face, body)) }
                for (face, s) in boxes {
                    let (top, bottom) = halfLeading(face, s, item.lineHeight)
                    above = max(above, top)
                    below = max(below, bottom)
                }
                return (above, below)
            }
            total = metrics.reduce(0) { $0 + $1.0 + $1.1 }
            let fits = !broke && total <= boxHeight + fitTolerance
            if !shrink || fits || size <= floor { break }
            size = max(floor, size - shrinkStep)
        }
        let spacing = item.letterSpacing * item.fontSize * scale
        let body = item.fontSize * scale
        let hang = StudioTypography.listIndentEm * body
        let direction = StudioScript.direction(paragraphs.map { $0.pieces.map(\.0).joined() }.joined(separator: "\n"))
        let rtl = direction == .rtl
        var top: Double = switch item.verticalAlign {
        case .top: 0
        case .middle: (boxHeight - total) / 2
        case .bottom: boxHeight - total
        }
        var laid: [LaidLine] = []
        var bands: [CGRect] = []
        var naturalWidth = 0.0
        for (line, (above, below)) in zip(built, metrics) {
            let baseline = top + above
            let visible = trimmed(line.atoms)
            let widths = visible.map { width(m, $0, scale, spacing) }
            let natural = widths.reduce(0, +)
            let spaces = visible.filter(\.space).reduce(0) { $0 + $1.text.unicodeScalars.count }
            let room = boxWidth - line.indent
            naturalWidth = max(naturalWidth, natural + line.indent)
            var x = rtl ? 0 : line.indent
            var extra = 0.0
            switch item.align {
            case .center: x += (room - natural) / 2
            case .right: x += room - natural
            case .justify:
                if line.wrapped && spaces > 0 { extra = max(0, (room - natural) / Double(spaces)) } else if rtl { x += room - natural }
            case .left: break
            }
            let lineWidth = natural + extra * Double(spaces)
            var marker: (String, Double, Style, Double)?
            if let atom = line.marker {
                let markerWidth = m.advance(atom.text, atom.style.face, body) + spacing * Double(atom.text.unicodeScalars.count)
                let start = rtl ? x + lineWidth + hang - markerWidth : x - hang
                marker = (atom.text, start, atom.style, markerWidth)
            }
            if item.highlight != nil {
                var spans: [(Double, Double, Style, Double)] = []
                if let marker { spans.append((marker.1, marker.1 + marker.3, marker.2, body)) }
                var cursor = x
                for (atom, w) in zip(visible, widths) {
                    if atom.space { cursor += w + extra * Double(atom.text.unicodeScalars.count); continue }
                    spans.append((cursor, cursor + w, atom.style, atom.style.size * scale))
                    cursor += w
                }
                if !spans.isEmpty {
                    let left = spans.map(\.0).min() ?? 0, right = spans.map(\.1).max() ?? 0
                    let ascent = spans.map { $0.2.face.ascender * $0.3 }.max() ?? 0
                    let descent = spans.map { -$0.2.face.descender * $0.3 }.max() ?? 0
                    bands.append(CGRect(x: left, y: baseline - ascent, width: right - left, height: ascent + descent))
                }
            }
            laid.append(LaidLine(atoms: visible, widths: widths, x: x, baseline: baseline, natural: natural, extra: extra, marker: marker.map { (text: $0.0, x: $0.1, style: $0.2, width: $0.3) }, above: above, below: below))
            top += above + below
        }
        return Result(lines: laid, scale: scale, spacing: spacing, direction: direction, totalHeight: total, naturalWidth: naturalWidth, bands: bands)
    }

    // MARK: Auto-fit boxes (`fitTextBox`)

    /// Natural size of the text (height for "height" boxes, width and height for "width" boxes).
    static func naturalSize(_ text: StudioText, width: Double, language: String) -> CGSize {
        var probe = text
        if probe.autoSize == .shrink { probe.autoSize = .fixed }
        let result = layout(probe, width: width, height: unbounded, language: language)
        return CGSize(width: result.naturalWidth, height: result.totalHeight)
    }

    /// New frame for an auto-sizing text box whose content changed, keeping the anchor the desktop keeps
    /// (alignment side horizontally, centre vertically, rotation respected). Nil when nothing changes.
    static func fittedFrame(_ element: StudioElement, language: String) -> CGRect? {
        guard let text = element.text, text.autoSize == .height || text.autoSize == .width else { return nil }
        let natural = naturalSize(text, width: element.width, language: language)
        let width = text.autoSize == .width ? max(StudioLimits.minElementSide, ceil(natural.width * 100) / 100) : element.width
        let height = max(StudioLimits.minElementSide, ceil(natural.height * 100) / 100)
        if abs(width - element.width) < 0.25 && abs(height - element.height) < 0.25 { return nil }
        let anchor: Double = switch text.align {
        case .left, .justify: 0
        case .center: 0.5
        case .right: 1
        }
        let angle = element.rotation * .pi / 180
        let shiftX = (0.5 - anchor) * (width - element.width)
        let shiftY = 0.5 * (height - element.height)
        let cx = element.x + element.width / 2 + cos(angle) * shiftX - sin(angle) * shiftY
        let cy = element.y + element.height / 2 + sin(angle) * shiftX + cos(angle) * shiftY
        return CGRect(x: cx - width / 2, y: cy - height / 2, width: width, height: height)
    }
}

/// Wraps any Hashable for NSCache keys.
final class StudioCacheKey: NSObject {
    let value: AnyHashable
    init<T: Hashable>(_ value: T) { self.value = AnyHashable(value) }
    override var hash: Int { value.hashValue }
    override func isEqual(_ object: Any?) -> Bool { (object as? StudioCacheKey)?.value == value }
}
