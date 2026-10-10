import CoreGraphics
import CoreText
import Foundation
import ImageIO

// Story layout: the iOS replacement for MuPDF's `Story` (HTML+CSS → paginated PDF) used by the desktop
// create/book/file-to-PDF operations. Content is a flat list of `StoryItem`s (styled paragraphs, tables,
// images, rules, anchors, custom drawings) that `StoryPaginator` flows onto pages with Core Text, and
// `StoryRenderer` writes into a PDF context with page furniture, named destinations and links.
// Core Text does the shaping, bidi and font fallback (Arabic, CJK, emoji…) for every script.

enum StoryFontFamily: String, CaseIterable, Codable, Sendable {
    case sans, serif, mono
}

enum StoryFonts {
    /// The desktop's CSS families (`sans-serif`, `serif`, `monospace` in MuPDF = Helvetica, Times,
    /// Courier). These ship with iOS; Core Text cascades to system fonts for other scripts.
    static func font(_ family: StoryFontFamily, size: CGFloat, bold: Bool = false, italic: Bool = false) -> CTFont {
        let name: String = switch (family, bold, italic) {
        case (.sans, false, false): "Helvetica"
        case (.sans, true, false): "Helvetica-Bold"
        case (.sans, false, true): "Helvetica-Oblique"
        case (.sans, true, true): "Helvetica-BoldOblique"
        case (.serif, false, false): "TimesNewRomanPSMT"
        case (.serif, true, false): "TimesNewRomanPS-BoldMT"
        case (.serif, false, true): "TimesNewRomanPS-ItalicMT"
        case (.serif, true, true): "TimesNewRomanPS-BoldItalicMT"
        case (.mono, false, false): "Courier"
        case (.mono, true, false): "Courier-Bold"
        case (.mono, false, true): "Courier-Oblique"
        case (.mono, true, true): "Courier-BoldOblique"
        }
        return CTFontCreateWithName(name as CFString, size, nil)
    }
}

/// Hex colour helpers (`#1f4e79`).
enum StoryColor {
    static func hex(_ value: String, fallback: String = "#1a1a1a") -> CGColor {
        rgb(value).map { CGColor(red: $0.0, green: $0.1, blue: $0.2, alpha: 1) } ?? hex(fallback, fallback: "#000000")
    }

    static func rgb(_ value: String) -> (CGFloat, CGFloat, CGFloat)? {
        let text = value.trimmingCharacters(in: .whitespaces)
        guard text.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil, let number = UInt32(text.dropFirst(), radix: 16) else { return nil }
        return (CGFloat((number >> 16) & 0xFF) / 255, CGFloat((number >> 8) & 0xFF) / 255, CGFloat(number & 0xFF) / 255)
    }

    static func isValid(_ value: String) -> Bool { rgb(value) != nil }

    static func gray(_ value: CGFloat) -> CGColor { CGColor(red: value, green: value, blue: value, alpha: 1) }
    static let text = hex("#1a1a1a")
    static let white = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
}

/// Attribute keys understood by the layout.
enum StoryKey {
    static let font = NSAttributedString.Key(kCTFontAttributeName as String)
    static let color = NSAttributedString.Key(kCTForegroundColorAttributeName as String)
    static let paragraph = NSAttributedString.Key(kCTParagraphStyleAttributeName as String)
    static let kern = NSAttributedString.Key(kCTKernAttributeName as String)
    static let underline = NSAttributedString.Key(kCTUnderlineStyleAttributeName as String)
    /// "https://…", "mailto:…" or "#anchor" (internal destination).
    static let link = NSAttributedString.Key("vivepdf.link")
    static let strike = NSAttributedString.Key("vivepdf.strike")
    static let background = NSAttributedString.Key("vivepdf.background")
}

/// Text style for building attributed strings.
struct StoryTextStyle {
    var family: StoryFontFamily = .sans
    var size: CGFloat = 11
    var color: CGColor = StoryColor.text
    var bold = false
    var italic = false
    var lineHeight: CGFloat = 1.45
    var alignment: CTTextAlignment = .natural
    var firstLineIndent: CGFloat = 0
    var headIndent: CGFloat = 0
    var tabStop: CGFloat?
    var letterSpacing: CGFloat = 0

    func paragraphStyle() -> CTParagraphStyle {
        var alignment = self.alignment
        var lineHeight = size * self.lineHeight
        var first = firstLineIndent
        var head = headIndent
        var direction = CTWritingDirection.natural
        var breakMode = CTLineBreakMode.byWordWrapping
        var tabs: CFArray = (tabStop.map { [CTTextTabCreate(.natural, Double($0), nil)] } ?? []) as CFArray
        var tabInterval: CGFloat = 36
        return withUnsafeBytes(of: &alignment) { alignmentBytes in
            withUnsafeBytes(of: &lineHeight) { lineBytes in
                withUnsafeBytes(of: &first) { firstBytes in
                    withUnsafeBytes(of: &head) { headBytes in
                        withUnsafeBytes(of: &direction) { directionBytes in
                            withUnsafeBytes(of: &breakMode) { breakBytes in
                                withUnsafeBytes(of: &tabs) { tabBytes in
                                    withUnsafeBytes(of: &tabInterval) { intervalBytes in
                                        let settings = [
                                            CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: alignmentBytes.baseAddress!),
                                            CTParagraphStyleSetting(spec: .minimumLineHeight, valueSize: MemoryLayout<CGFloat>.size, value: lineBytes.baseAddress!),
                                            CTParagraphStyleSetting(spec: .maximumLineHeight, valueSize: MemoryLayout<CGFloat>.size, value: lineBytes.baseAddress!),
                                            CTParagraphStyleSetting(spec: .firstLineHeadIndent, valueSize: MemoryLayout<CGFloat>.size, value: firstBytes.baseAddress!),
                                            CTParagraphStyleSetting(spec: .headIndent, valueSize: MemoryLayout<CGFloat>.size, value: headBytes.baseAddress!),
                                            CTParagraphStyleSetting(spec: .baseWritingDirection, valueSize: MemoryLayout<CTWritingDirection>.size, value: directionBytes.baseAddress!),
                                            CTParagraphStyleSetting(spec: .lineBreakMode, valueSize: MemoryLayout<CTLineBreakMode>.size, value: breakBytes.baseAddress!),
                                            CTParagraphStyleSetting(spec: .tabStops, valueSize: MemoryLayout<CFArray>.size, value: tabBytes.baseAddress!),
                                            CTParagraphStyleSetting(spec: .defaultTabInterval, valueSize: MemoryLayout<CGFloat>.size, value: intervalBytes.baseAddress!),
                                        ]
                                        return CTParagraphStyleCreate(settings, settings.count)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    func attributes(bold: Bool? = nil, italic: Bool? = nil, family: StoryFontFamily? = nil, sizeScale: CGFloat = 1) -> [NSAttributedString.Key: Any] {
        var attributes: [NSAttributedString.Key: Any] = [
            StoryKey.font: StoryFonts.font(family ?? self.family, size: size * sizeScale, bold: bold ?? self.bold, italic: italic ?? self.italic),
            StoryKey.color: color,
            StoryKey.paragraph: paragraphStyle(),
        ]
        if letterSpacing != 0 { attributes[StoryKey.kern] = letterSpacing }
        return attributes
    }

    func string(_ text: String) -> NSAttributedString {
        NSAttributedString(string: text, attributes: attributes())
    }

    /// Builds styled text from Markdown inlines (bold, italic, code, links, line breaks).
    func string(_ inlines: [MDInline], codeBackground: CGColor? = nil) -> NSAttributedString {
        let out = NSMutableAttributedString()
        for inline in inlines {
            var attributes = self.attributes(bold: bold || inline.bold, italic: italic || inline.italic)
            let text: String
            switch inline.kind {
            case .text(let value): text = value
            case .code(let value):
                text = value
                attributes = self.attributes(bold: bold || inline.bold, italic: italic || inline.italic, family: .mono, sizeScale: 0.88)
                if let codeBackground { attributes[StoryKey.background] = codeBackground }
            case .lineBreak: text = "\u{2028}"
            case .image(_, let alt): text = alt
            }
            if let link = inline.link, !link.isEmpty {
                attributes[StoryKey.link] = link
                attributes[StoryKey.color] = StoryColor.hex("#1f4e9a")
                attributes[StoryKey.underline] = CTUnderlineStyle.single.rawValue
            }
            if inline.strike { attributes[StoryKey.strike] = true }
            out.append(NSAttributedString(string: text, attributes: attributes))
        }
        return out
    }
}

/// Box decoration and vertical rhythm of one text item (the CSS box of a `<p>`, `<h2>`, `<pre>`…).
struct StoryBox {
    var spaceBefore: CGFloat = 0
    var spaceAfter: CGFloat = 0
    var leadingInset: CGFloat = 0
    var trailingInset: CGFloat = 0
    var padding: CGFloat = 0
    var horizontalPadding: CGFloat?
    var background: CGColor?
    var leadingRule: (width: CGFloat, color: CGColor)?
    var bottomRule: (width: CGFloat, color: CGColor, gap: CGFloat)?
    var keepWithNext = false
    var breakBefore = false
    /// Records `anchor` → page index where the box starts (chapter titles, sections).
    var anchor: String?
    /// Explicit width (e.g. a signature block at 40 % of the line) aligned to the trailing side.
    var widthFraction: CGFloat?
}

struct StoryTable {
    var rows: [[NSAttributedString]]
    var headerRows = 0
    var columnFractions: [CGFloat]?
    var border: (width: CGFloat, color: CGColor)? = (0.5, StoryColor.gray(0.6))
    var paddingX: CGFloat = 4
    var paddingY: CGFloat = 2
    var spaceAfter: CGFloat = 6
    var fullWidth = false
    var verticalAlignBottom = false
    /// Cells with a link target make the whole cell clickable ("#anchor" or URL).
    var cellLinks: [[String?]]?
    var rowSpaceBefore: [CGFloat]?
    var cellBackground: CGColor?
}

enum StoryItem {
    case text(NSAttributedString, StoryBox)
    case table(StoryTable)
    case image(CGImage, maxWidth: CGFloat?, maxHeight: CGFloat?, centered: Bool, box: StoryBox)
    case rule(width: CGFloat, color: CGColor, box: StoryBox)
    case space(CGFloat)
    case pageBreak
    case anchor(String)
    /// A fixed-height drawing (signature lines, separators). Rect is in top-left page coordinates.
    case drawing(height: CGFloat, box: StoryBox, draw: (CGContext, CGRect, StoryCanvas) -> Void)
}

/// Converts top-left layout coordinates (y down) to the PDF context (y up).
struct StoryCanvas {
    let pageSize: CGSize
    func cg(_ rect: CGRect) -> CGRect { CGRect(x: rect.minX, y: pageSize.height - rect.maxY, width: rect.width, height: rect.height) }
    func cg(_ point: CGPoint) -> CGPoint { CGPoint(x: point.x, y: pageSize.height - point.y) }
}

// MARK: - Pagination

final class StoryPage {
    var ops: [(CGContext, StoryCanvas) -> Void] = []
    var anchors: [String: CGFloat] = [:]
}

/// Flows story items onto pages of `pageSize` inside `frame` (top-left coordinates).
final class StoryPaginator {
    let pageSize: CGSize
    let frame: CGRect
    private(set) var pages: [StoryPage] = []
    /// Anchor → (page index, y in top-left coordinates).
    private(set) var anchors: [String: (page: Int, y: CGFloat)] = [:]
    private var cursor: CGFloat = 0
    private var pendingSpace: CGFloat = 0
    private var pageHasContent = false
    var maxPages = 5000
    var checkCancelled: () throws -> Void = { try Task.checkCancellation() }

    init(pageSize: CGSize, frame: CGRect) {
        self.pageSize = pageSize
        self.frame = frame
        newPage()
    }

    private var current: StoryPage { pages[pages.count - 1] }
    private var remaining: CGFloat { frame.maxY - cursor }

    func newPage() {
        pages.append(StoryPage())
        cursor = frame.minY
        pendingSpace = 0
        pageHasContent = false
    }

    private func ensurePageLimit() throws {
        try checkCancelled()
        if pages.count > maxPages { throw EngineError(.INVALID_PARAMS, reason: "tooManyPages", detail: "\(maxPages)") }
    }

    /// Collapses margins like CSS: the gap between two boxes is the larger of the two margins.
    private func applySpace(_ before: CGFloat) {
        guard pageHasContent else { pendingSpace = 0; return }
        cursor += max(pendingSpace, before)
        pendingSpace = 0
    }

    private func mark(_ anchor: String?) {
        guard let anchor, anchors[anchor] == nil else { return }
        anchors[anchor] = (pages.count - 1, cursor)
        current.anchors[anchor] = cursor
    }

    func layout(_ items: [StoryItem]) throws {
        for (position, item) in items.enumerated() {
            try ensurePageLimit()
            switch item {
            case .pageBreak:
                if pageHasContent { newPage() }
            case .space(let height):
                if pageHasContent { pendingSpace = max(pendingSpace, 0); cursor += height }
                else { cursor += height; pageHasContent = true }
            case .anchor(let name):
                mark(name)
            case .text(let string, let box):
                let following = position + 1 < items.count ? items[position + 1] : nil
                try placeText(string, box: box, next: following)
            case .table(let table):
                try placeTable(table)
            case .image(let image, let maxWidth, let maxHeight, let centered, let box):
                try placeImage(image, maxWidth: maxWidth, maxHeight: maxHeight, centered: centered, box: box)
            case .rule(let width, let color, let box):
                if box.breakBefore && pageHasContent { newPage() }
                applySpace(box.spaceBefore)
                if remaining < width { newPage() }
                let y = cursor + width / 2
                let x0 = frame.minX + box.leadingInset, x1 = frame.maxX - box.trailingInset
                current.ops.append { context, canvas in
                    context.setStrokeColor(color)
                    context.setLineWidth(width)
                    context.move(to: canvas.cg(CGPoint(x: x0, y: y)))
                    context.addLine(to: canvas.cg(CGPoint(x: x1, y: y)))
                    context.strokePath()
                }
                cursor += width
                pageHasContent = true
                pendingSpace = box.spaceAfter
            case .drawing(let height, let box, let draw):
                if box.breakBefore && pageHasContent { newPage() }
                applySpace(box.spaceBefore)
                if remaining < height && pageHasContent { newPage() }
                mark(box.anchor)
                let width = frame.width - box.leadingInset - box.trailingInset
                let boxWidth = box.widthFraction.map { width * $0 } ?? width
                let rect = CGRect(x: frame.minX + box.leadingInset + (width - boxWidth), y: cursor, width: boxWidth, height: height)
                current.ops.append { context, canvas in draw(context, rect, canvas) }
                cursor += height
                pageHasContent = true
                pendingSpace = box.spaceAfter
            }
        }
    }

    // MARK: Text

    /// Height a text needs at `width` (whole string).
    static func measure(_ string: NSAttributedString, width: CGFloat) -> CGFloat {
        guard string.length > 0 else { return 0 }
        let setter = CTFramesetterCreateWithAttributedString(string)
        let size = CTFramesetterSuggestFrameSizeWithConstraints(setter, CFRange(location: 0, length: 0), nil, CGSize(width: width, height: .greatestFiniteMagnitude), nil)
        return ceil(size.height)
    }

    /// Width of the longest unbreakable line (single-line natural width).
    static func naturalWidth(_ string: NSAttributedString) -> CGFloat {
        guard string.length > 0 else { return 0 }
        var widest: CGFloat = 0
        for paragraph in string.string.components(separatedBy: CharacterSet(charactersIn: "\n\u{2028}")) where !paragraph.isEmpty {
            let range = (string.string as NSString).range(of: paragraph)
            let line = CTLineCreateWithAttributedString(string.attributedSubstring(from: range))
            widest = max(widest, CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil)))
        }
        return ceil(widest)
    }

    private func placeText(_ string: NSAttributedString, box: StoryBox, next: StoryItem?) throws {
        if box.breakBefore && pageHasContent { newPage() }
        applySpace(box.spaceBefore)
        let fullWidth = frame.width - box.leadingInset - box.trailingInset
        let outerWidth = box.widthFraction.map { fullWidth * $0 } ?? fullWidth
        let outerX = frame.minX + box.leadingInset + (fullWidth - outerWidth)
        let ruleWidth = box.leadingRule?.width ?? 0
        let padX = box.horizontalPadding ?? box.padding
        let textX = outerX + ruleWidth + padX
        let textWidth = max(10, outerWidth - ruleWidth - 2 * padX)
        let setter = CTFramesetterCreateWithAttributedString(string)
        let total = string.length
        guard total > 0 else { mark(box.anchor); return }

        if box.keepWithNext, pageHasContent {
            let own = StoryPaginator.measure(string, width: textWidth) + 2 * box.padding
            var following: CGFloat = 0
            if case .text(let nextString, _) = next {
                let font = nextString.length > 0 ? nextString.attribute(StoryKey.font, at: 0, effectiveRange: nil) : nil
                let size = font.map { CTFontGetSize($0 as! CTFont) } ?? 11
                following = size * 1.45 * 2
            }
            if own + following > remaining && own < frame.height { newPage() }
        }

        var location = 0
        var first = true
        while location < total {
            try ensurePageLimit()
            let top = cursor + (first ? box.padding : 0)
            let available = frame.maxY - top
            var fitted = fit(setter, location: location, width: textWidth, height: available)
            if fitted.length == 0 {
                if pageHasContent {
                    newPage()
                    continue
                }
                // A single line taller than the page: lay it out in an unbounded frame and let it clip.
                fitted = fit(setter, location: location, width: textWidth, height: frame.height * 4)
                if fitted.length == 0 { break }
                fitted.height = min(fitted.height, frame.height)
            }
            let isLast = location + fitted.length >= total
            let chunkTop = cursor
            let chunkBottom = top + fitted.height + (isLast ? box.padding : 0)
            if first { mark(box.anchor) }
            let textRect = CGRect(x: textX, y: top, width: textWidth, height: fitted.height)
            let frameRef = fitted.frame
            let background = box.background
            let rule = box.leadingRule
            current.ops.append { context, canvas in
                let outer = CGRect(x: outerX, y: chunkTop, width: outerWidth, height: chunkBottom - chunkTop)
                if let background {
                    context.setFillColor(background)
                    context.fill(canvas.cg(outer))
                }
                if let rule {
                    context.setFillColor(rule.color)
                    context.fill(canvas.cg(CGRect(x: outer.minX, y: outer.minY, width: rule.width, height: outer.height)))
                }
                StoryPaginator.draw(frameRef, in: textRect, context: context, canvas: canvas)
            }
            cursor = chunkBottom
            pageHasContent = true
            location += fitted.length
            first = false
            if !isLast { newPage() }
        }
        if let bottom = box.bottomRule {
            let y = cursor + bottom.gap + bottom.width / 2
            let x0 = outerX, x1 = outerX + outerWidth
            current.ops.append { context, canvas in
                context.setStrokeColor(bottom.color)
                context.setLineWidth(bottom.width)
                context.move(to: canvas.cg(CGPoint(x: x0, y: y)))
                context.addLine(to: canvas.cg(CGPoint(x: x1, y: y)))
                context.strokePath()
            }
            cursor = y + bottom.width / 2
        }
        pendingSpace = box.spaceAfter
    }

    private struct Fitted {
        var frame: CTFrame
        var length: Int
        var height: CGFloat
    }

    private func fit(_ setter: CTFramesetter, location: Int, width: CGFloat, height: CGFloat) -> Fitted {
        let rect = CGRect(x: 0, y: 0, width: width, height: max(0, height))
        let path = CGPath(rect: rect, transform: nil)
        let frame = CTFramesetterCreateFrame(setter, CFRange(location: location, length: 0), path, nil)
        let visible = CTFrameGetVisibleStringRange(frame)
        let lines = CTFrameGetLines(frame) as! [CTLine]
        guard visible.length > 0, let last = lines.last else { return Fitted(frame: frame, length: 0, height: 0) }
        var origins = [CGPoint](repeating: .zero, count: lines.count)
        CTFrameGetLineOrigins(frame, CFRange(location: 0, length: 0), &origins)
        var descent: CGFloat = 0
        CTLineGetTypographicBounds(last, nil, &descent, nil)
        // Origins are relative to the frame's bottom; the used height runs down to the last descent.
        let used = rect.height - origins[origins.count - 1].y + descent
        let lineHeight = StoryPaginator.lineBoxHeight(last)
        return Fitted(frame: frame, length: visible.length, height: ceil(max(used, rect.height - origins[origins.count - 1].y + lineHeight * 0.3)))
    }

    private static func lineBoxHeight(_ line: CTLine) -> CGFloat {
        var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
        CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
        return ascent + descent
    }

    /// Draws a frame laid out at origin (0,0) into `rect` (top-left coordinates), plus link annotations,
    /// strike-through and inline code backgrounds.
    static func draw(_ frame: CTFrame, in rect: CGRect, context: CGContext, canvas: StoryCanvas) {
        let path = CTFrameGetPath(frame).boundingBox
        let target = canvas.cg(rect)
        // The frame was laid out in a box whose top is `path.maxY`; align that with the target's top.
        let dx = target.minX - path.minX
        let dy = target.maxY - path.maxY
        context.saveGState()
        context.textMatrix = .identity
        context.translateBy(x: dx, y: dy)
        let lines = CTFrameGetLines(frame) as! [CTLine]
        var origins = [CGPoint](repeating: .zero, count: lines.count)
        CTFrameGetLineOrigins(frame, CFRange(location: 0, length: 0), &origins)
        var decorations: [(CGRect, [NSAttributedString.Key: Any])] = []
        for (index, line) in lines.enumerated() {
            let origin = CGPoint(x: path.minX + origins[index].x, y: path.minY + origins[index].y)
            for run in CTLineGetGlyphRuns(line) as! [CTRun] {
                let attributes = CTRunGetAttributes(run) as NSDictionary as? [NSAttributedString.Key: Any] ?? [:]
                guard attributes[StoryKey.link] != nil || attributes[StoryKey.strike] != nil || attributes[StoryKey.background] != nil else { continue }
                var ascent: CGFloat = 0, descent: CGFloat = 0
                let width = CGFloat(CTRunGetTypographicBounds(run, CFRange(location: 0, length: 0), &ascent, &descent, nil))
                let range = CTRunGetStringRange(run)
                let offset = CTLineGetOffsetForStringIndex(line, range.location, nil)
                let runRect = CGRect(x: origin.x + offset, y: origin.y - descent, width: width, height: ascent + descent)
                decorations.append((runRect, attributes))
            }
        }
        for (runRect, attributes) in decorations {
            if let background = attributes[StoryKey.background] {
                context.setFillColor(background as! CGColor)
                context.fill(runRect.insetBy(dx: -1, dy: 0))
            }
        }
        for (index, line) in lines.enumerated() {
            context.textPosition = CGPoint(x: path.minX + origins[index].x, y: path.minY + origins[index].y)
            CTLineDraw(line, context)
        }
        for (runRect, attributes) in decorations {
            if attributes[StoryKey.strike] != nil {
                let color = attributes[StoryKey.color].map { $0 as! CGColor } ?? StoryColor.text
                context.setStrokeColor(color)
                context.setLineWidth(0.6)
                context.move(to: CGPoint(x: runRect.minX, y: runRect.midY))
                context.addLine(to: CGPoint(x: runRect.maxX, y: runRect.midY))
                context.strokePath()
            }
        }
        context.restoreGState()
        for (runRect, attributes) in decorations {
            guard let link = attributes[StoryKey.link] as? String else { continue }
            let pageRect = runRect.offsetBy(dx: dx, dy: dy)
            StoryRenderer.addLink(link, rect: pageRect, context: context)
        }
    }

    // MARK: Tables

    private func columnWidths(_ table: StoryTable, width: CGFloat, columns: Int) -> [CGFloat] {
        if let fractions = table.columnFractions, fractions.count == columns {
            let sum = max(fractions.reduce(0, +), 0.0001)
            return fractions.map { width * $0 / sum }
        }
        var natural = [CGFloat](repeating: 0, count: columns)
        var minimum = [CGFloat](repeating: 12, count: columns)
        for row in table.rows {
            for (column, cell) in row.prefix(columns).enumerated() {
                natural[column] = max(natural[column], StoryPaginator.naturalWidth(cell) + 2 * table.paddingX + 1)
                let longestWord = cell.string.split(whereSeparator: \.isWhitespace).map(String.init).max { $0.count < $1.count } ?? ""
                if !longestWord.isEmpty, cell.length > 0 {
                    let attributes = cell.attributes(at: 0, effectiveRange: nil)
                    let word = NSAttributedString(string: longestWord, attributes: attributes)
                    minimum[column] = max(minimum[column], min(StoryPaginator.naturalWidth(word) + 2 * table.paddingX + 1, width / CGFloat(columns) * 1.5))
                }
            }
        }
        let total = natural.reduce(0, +)
        if total <= width && !table.fullWidth { return natural }
        if total <= width {
            let extra = (width - total) / CGFloat(columns)
            return natural.map { $0 + extra }
        }
        // Shrink the flexible part of each column proportionally to its natural width.
        let minTotal = minimum.reduce(0, +)
        if minTotal >= width { return minimum.map { $0 * width / minTotal } }
        let flexible = natural.enumerated().map { max(0, $0.element - minimum[$0.offset]) }
        let flexTotal = max(flexible.reduce(0, +), 0.0001)
        let room = width - minTotal
        return minimum.enumerated().map { $0.element + flexible[$0.offset] / flexTotal * room }
    }

    private func placeTable(_ table: StoryTable) throws {
        let columns = table.rows.map(\.count).max() ?? 0
        guard columns > 0 else { return }
        applySpace(0)
        let widths = columnWidths(table, width: frame.width, columns: columns)
        let tableWidth = widths.reduce(0, +)
        for (rowIndex, row) in table.rows.enumerated() {
            try ensurePageLimit()
            if let spaces = table.rowSpaceBefore, rowIndex < spaces.count { cursor += spaces[rowIndex] }
            var heights: [CGFloat] = []
            for (column, cell) in row.enumerated() where column < columns {
                heights.append(StoryPaginator.measure(cell, width: max(4, widths[column] - 2 * table.paddingX)))
            }
            let rowHeight = min((heights.max() ?? 0) + 2 * table.paddingY, frame.height)
            if rowHeight > remaining && pageHasContent { newPage() }
            let top = cursor
            var x = frame.minX
            var cellRects: [CGRect] = []
            for column in 0..<columns {
                cellRects.append(CGRect(x: x, y: top, width: widths[column], height: rowHeight))
                x += widths[column]
            }
            let border = table.border
            let isHeader = rowIndex < table.headerRows
            let background = table.cellBackground
            let links = table.cellLinks.flatMap { rowIndex < $0.count ? $0[rowIndex] : nil }
            let cells = row
            let padX = table.paddingX, padY = table.paddingY
            let bottomAlign = table.verticalAlignBottom
            current.ops.append { context, canvas in
                for (column, rect) in cellRects.enumerated() {
                    if isHeader, let background {
                        context.setFillColor(background)
                        context.fill(canvas.cg(rect))
                    }
                    if column < cells.count, cells[column].length > 0 {
                        let inner = rect.insetBy(dx: padX, dy: padY)
                        let height = StoryPaginator.measure(cells[column], width: max(4, inner.width))
                        let y = bottomAlign ? inner.maxY - height : inner.minY
                        let setter = CTFramesetterCreateWithAttributedString(cells[column])
                        let framePath = CGPath(rect: CGRect(x: 0, y: 0, width: max(4, inner.width), height: height + 2), transform: nil)
                        let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), framePath, nil)
                        StoryPaginator.draw(frame, in: CGRect(x: inner.minX, y: y, width: max(4, inner.width), height: height + 2), context: context, canvas: canvas)
                    }
                    if let border {
                        context.setStrokeColor(border.color)
                        context.setLineWidth(border.width)
                        context.stroke(canvas.cg(rect))
                    }
                    if let links, column < links.count, let link = links[column] {
                        StoryRenderer.addLink(link, rect: canvas.cg(rect), context: context)
                    }
                }
            }
            _ = tableWidth
            cursor = top + rowHeight
            pageHasContent = true
        }
        pendingSpace = table.spaceAfter
    }

    // MARK: Images

    private func placeImage(_ image: CGImage, maxWidth: CGFloat?, maxHeight: CGFloat?, centered: Bool, box: StoryBox) throws {
        if box.breakBefore && pageHasContent { newPage() }
        applySpace(box.spaceBefore)
        let available = frame.width - box.leadingInset - box.trailingInset
        var width = CGFloat(image.width) * 0.75
        var height = CGFloat(image.height) * 0.75
        let limitWidth = min(available, maxWidth ?? available)
        let limitHeight = min(frame.height, maxHeight ?? frame.height)
        let scale = min(1, limitWidth / max(width, 1), limitHeight / max(height, 1))
        width *= scale
        height *= scale
        if height > remaining && pageHasContent { newPage() }
        mark(box.anchor)
        let x = frame.minX + box.leadingInset + (centered ? (available - width) / 2 : 0)
        let rect = CGRect(x: x, y: cursor, width: width, height: height)
        current.ops.append { context, canvas in
            context.interpolationQuality = .high
            context.draw(image, in: canvas.cg(rect))
        }
        cursor += height
        pageHasContent = true
        pendingSpace = box.spaceAfter
    }
}

// MARK: - Rendering

struct StoryMetadata {
    var title = ""
    var author = ""
    var subject = ""
    var creator = "vivePDF"
}

enum StoryRenderer {
    static func addLink(_ link: String, rect: CGRect, context: CGContext) {
        if link.hasPrefix("#") {
            context.setDestination(String(link.dropFirst()) as CFString, for: rect)
        } else if let url = URL(string: link), let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) {
            context.setURL(url as CFURL, for: rect)
        }
    }

    static func auxiliaryInfo(_ metadata: StoryMetadata) -> CFDictionary {
        var info: [CFString: Any] = [kCGPDFContextCreator: metadata.creator]
        if !metadata.title.isEmpty { info[kCGPDFContextTitle] = metadata.title }
        if !metadata.author.isEmpty { info[kCGPDFContextAuthor] = metadata.author }
        if !metadata.subject.isEmpty { info[kCGPDFContextSubject] = metadata.subject }
        return info as CFDictionary
    }

    /// Writes the pages to `url`. `before` draws behind the content of a page (covers, paper), `after`
    /// draws page furniture with the page index and total.
    static func write(pages: [StoryPage], pageSize: CGSize, to url: URL, metadata: StoryMetadata,
                      before: ((CGContext, StoryCanvas, Int) -> Void)? = nil,
                      after: ((CGContext, StoryCanvas, Int, Int) -> Void)? = nil) throws {
        var box = CGRect(origin: .zero, size: pageSize)
        guard let context = CGContext(url as CFURL, mediaBox: &box, auxiliaryInfo(metadata)) else { throw EngineError.internalError("pdf context") }
        let canvas = StoryCanvas(pageSize: pageSize)
        for (index, page) in pages.enumerated() {
            try Task.checkCancellation()
            context.beginPDFPage([kCGPDFContextMediaBox: NSData(bytes: &box, length: MemoryLayout<CGRect>.size)] as CFDictionary)
            before?(context, canvas, index)
            for (name, y) in page.anchors {
                context.addDestination(name as CFString, at: CGPoint(x: 0, y: pageSize.height - y + 14))
            }
            for op in page.ops { op(context, canvas) }
            after?(context, canvas, index, pages.count)
            context.endPDFPage()
        }
        context.closePDF()
    }

    /// Draws a single line of text in `rect` (top-left coordinates) with the given alignment.
    static func drawLine(_ text: String, style: StoryTextStyle, in rect: CGRect, alignment: CTTextAlignment, context: CGContext, canvas: StoryCanvas) {
        guard !text.isEmpty else { return }
        var aligned = style
        aligned.alignment = alignment
        aligned.lineHeight = 1.2
        let string = aligned.string(text)
        let setter = CTFramesetterCreateWithAttributedString(string)
        let height = StoryPaginator.measure(string, width: rect.width)
        let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), CGPath(rect: CGRect(x: 0, y: 0, width: rect.width, height: height + 2), transform: nil), nil)
        let top = rect.minY + max(0, (rect.height - height) / 2)
        StoryPaginator.draw(frame, in: CGRect(x: rect.minX, y: top, width: rect.width, height: height + 2), context: context, canvas: canvas)
    }

    /// Lays out an attributed string inside `rect` (top-left), vertically centred, shrinking nothing.
    static func drawText(_ string: NSAttributedString, in rect: CGRect, verticalCenter: Bool = true, bottom: Bool = false, context: CGContext, canvas: StoryCanvas) {
        guard string.length > 0 else { return }
        let height = min(StoryPaginator.measure(string, width: rect.width), rect.height)
        let setter = CTFramesetterCreateWithAttributedString(string)
        let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), CGPath(rect: CGRect(x: 0, y: 0, width: rect.width, height: height + 2), transform: nil), nil)
        let top = bottom ? rect.maxY - height : (verticalCenter ? rect.minY + max(0, (rect.height - height) / 2) : rect.minY)
        StoryPaginator.draw(frame, in: CGRect(x: rect.minX, y: top, width: rect.width, height: height + 2), context: context, canvas: canvas)
    }
}

// MARK: - Images

enum StoryImages {
    /// Loads a picture applying its EXIF orientation (logos, cover photos, Markdown images).
    static func load(_ url: URL, maxPixels: Int = 2400) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return load(source, maxPixels: maxPixels)
    }

    static func load(data: Data, maxPixels: Int = 2400) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return load(source, maxPixels: maxPixels)
    }

    private static func load(_ source: CGImageSource, maxPixels: Int) -> CGImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    /// Draws `image` to cover `rect` (cropping the overflow), like CSS `object-fit: cover`.
    static func drawCover(_ image: CGImage, in rect: CGRect, context: CGContext) {
        let scale = max(rect.width / CGFloat(image.width), rect.height / CGFloat(image.height))
        let size = CGSize(width: CGFloat(image.width) * scale, height: CGFloat(image.height) * scale)
        context.saveGState()
        context.clip(to: rect)
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height))
        context.restoreGState()
    }

    /// Draws `image` inside `rect` keeping its aspect ratio, aligned leading/centre/trailing.
    static func drawFit(_ image: CGImage, in rect: CGRect, align: CTTextAlignment = .center, context: CGContext) {
        let scale = min(rect.width / CGFloat(image.width), rect.height / CGFloat(image.height))
        let size = CGSize(width: CGFloat(image.width) * scale, height: CGFloat(image.height) * scale)
        let x: CGFloat = switch align {
        case .left: rect.minX
        case .right: rect.maxX - size.width
        default: rect.midX - size.width / 2
        }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: x, y: rect.midY - size.height / 2, width: size.width, height: size.height))
    }
}
