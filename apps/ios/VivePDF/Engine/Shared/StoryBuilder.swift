import CoreGraphics
import CoreText
import Foundation

/// The CSS of a desktop template expressed as layout parameters (see `create._base_rules`).
struct StoryTheme {
    var family: StoryFontFamily = .sans
    var size: CGFloat = 11
    var color: CGColor = StoryColor.text
    var lineHeight: CGFloat = 1.45
    var paragraphSpacing: CGFloat?
    var justify = false
    /// First-line indent of body paragraphs (`text-indent`), not applied to short-line blocks.
    var paragraphIndent: CGFloat = 0
    var headingScales: [CGFloat] = [1.9, 1.35, 1.15, 1, 1, 1]
    var headingColor: [Int: CGColor] = [:]
    var headingSpace: [Int: (before: CGFloat, after: CGFloat)] = [:]
    var headingAlignment: [Int: CTTextAlignment] = [:]
    var headingRule: [Int: (width: CGFloat, color: CGColor)] = [:]
    var headingBreakBefore: Set<Int> = []
    var quoteRule: (width: CGFloat, color: CGColor) = (2, StoryColor.hex("#cccccc"))
    var quoteBackground: CGColor?
    var quoteColor: CGColor = StoryColor.hex("#444444")
    var codeBackground: CGColor = StoryColor.hex("#f3f4f6")
    var tableBorder: (width: CGFloat, color: CGColor) = (0.5, StoryColor.hex("#999999"))
    /// Folder for relative Markdown image paths; remote pictures are never fetched.
    var baseURL: URL?
    var imageMaxHeight: CGFloat?
    /// Gives an anchor id to a heading (level, plain title) — book sections, TOC targets.
    var anchor: ((Int, String) -> String?)?

    var spacing: CGFloat { paragraphSpacing ?? size * 0.6 }

    func text(bold: Bool = false, italic: Bool = false, size: CGFloat? = nil, color: CGColor? = nil, alignment: CTTextAlignment? = nil) -> StoryTextStyle {
        StoryTextStyle(family: family, size: size ?? self.size, color: color ?? self.color, bold: bold, italic: italic,
                       lineHeight: lineHeight, alignment: alignment ?? (justify ? .justified : .natural))
    }
}

/// Turns parsed Markdown / structured text into story items with a theme.
enum StoryBuilder {
    static func items(_ blocks: [MDBlock], theme: StoryTheme) -> [StoryItem] {
        var out: [StoryItem] = []
        append(blocks, theme: theme, indent: 0, into: &out)
        return out
    }

    private static func append(_ blocks: [MDBlock], theme: StoryTheme, indent: CGFloat, into out: inout [StoryItem]) {
        for block in blocks { append(block, theme: theme, indent: indent, into: &out) }
    }

    static func headingStyle(_ level: Int, theme: StoryTheme) -> StoryTextStyle {
        let scale = theme.headingScales[max(0, min(5, level - 1))]
        var style = theme.text(bold: true, size: theme.size * scale, color: theme.headingColor[level] ?? theme.color, alignment: theme.headingAlignment[level] ?? .natural)
        style.lineHeight = 1.25
        return style
    }

    private static func append(_ block: MDBlock, theme: StoryTheme, indent: CGFloat, into out: inout [StoryItem]) {
        switch block {
        case .heading(let level, let inlines):
            let style = headingStyle(level, theme: theme)
            let space = theme.headingSpace[level] ?? defaultHeadingSpace(level, size: theme.size)
            var box = StoryBox(spaceBefore: space.before, spaceAfter: space.after, leadingInset: indent, keepWithNext: true)
            if let rule = theme.headingRule[level] {
                box.leadingRule = rule
                box.horizontalPadding = 6
            }
            box.breakBefore = theme.headingBreakBefore.contains(level)
            box.anchor = theme.anchor?(level, inlines.plainText)
            out.append(.text(style.string(inlines), box))

        case .paragraph(let inlines, let lines):
            if inlines.count == 1, case .image(let source, _) = inlines[0].kind {
                if let image = loadImage(source, theme: theme) {
                    out.append(.image(image, maxWidth: nil, maxHeight: theme.imageMaxHeight, centered: false,
                                      box: StoryBox(spaceBefore: 0, spaceAfter: theme.spacing, leadingInset: indent)))
                }
                return
            }
            var style = theme.text()
            if !lines { style.firstLineIndent = theme.paragraphIndent }
            if lines, style.alignment == .justified { style.alignment = .natural }
            let string = style.string(withoutImages(inlines, theme: theme, into: &out), codeBackground: theme.codeBackground)
            out.append(.text(string, StoryBox(spaceBefore: 0, spaceAfter: theme.spacing, leadingInset: indent)))

        case .list(let ordered, let start, let items):
            let hang: CGFloat = max(16, theme.size * 1.6)
            for (position, item) in items.enumerated() {
                let marker = ordered ? "\(start + position)." : (indent > 0 ? "◦" : "•")
                var first = true
                for child in item {
                    if first, case .paragraph(let inlines, _) = child {
                        var style = theme.text()
                        if style.alignment == .justified { style.alignment = .natural }
                        style.firstLineIndent = 0
                        style.headIndent = hang
                        style.tabStop = hang
                        let string = NSMutableAttributedString(attributedString: style.string(marker + "\t"))
                        string.append(style.string(inlines, codeBackground: theme.codeBackground))
                        out.append(.text(string, StoryBox(spaceBefore: 0, spaceAfter: 2, leadingInset: indent)))
                    } else if first {
                        var style = theme.text()
                        style.headIndent = hang
                        style.tabStop = hang
                        out.append(.text(style.string(marker + "\t"), StoryBox(spaceBefore: 0, spaceAfter: 0, leadingInset: indent)))
                        append(child, theme: theme, indent: indent + hang, into: &out)
                    } else {
                        append(child, theme: theme, indent: indent + hang, into: &out)
                    }
                    first = false
                }
            }
            out.append(.space(max(0, theme.spacing - 2)))

        case .code(let code):
            var style = StoryTextStyle(family: .mono, size: theme.size * 0.88, color: theme.color, lineHeight: 1.3, alignment: .left)
            style.alignment = .left
            let string = style.string(code.isEmpty ? " " : code)
            out.append(.text(string, StoryBox(spaceBefore: 0, spaceAfter: theme.spacing, leadingInset: indent, padding: 6, background: theme.codeBackground)))

        case .quote(let children):
            var quoteTheme = theme
            quoteTheme.color = theme.quoteColor
            var inner: [StoryItem] = []
            append(children, theme: quoteTheme, indent: 0, into: &inner)
            for item in inner {
                if case .text(let string, var box) = item {
                    box.leadingInset += indent
                    box.leadingRule = theme.quoteRule
                    box.horizontalPadding = theme.quoteBackground == nil ? 8 : 8
                    box.background = theme.quoteBackground
                    if theme.quoteBackground != nil { box.padding = 4 }
                    out.append(.text(string, box))
                } else {
                    out.append(item)
                }
            }

        case .table(let header, let aligns, let rows):
            func cell(_ inlines: [MDInline], column: Int, bold: Bool) -> NSAttributedString {
                let align = column < aligns.count ? aligns[column] : .none
                var style = theme.text(bold: bold, alignment: align == .center ? .center : align == .right ? .right : .natural)
                style.lineHeight = 1.3
                return style.string(inlines, codeBackground: theme.codeBackground)
            }
            var table = StoryTable(rows: [header.enumerated().map { cell($0.element, column: $0.offset, bold: true) }]
                + rows.map { $0.enumerated().map { cell($0.element, column: $0.offset, bold: false) } })
            table.headerRows = 1
            table.border = theme.tableBorder
            table.spaceAfter = theme.spacing
            out.append(.table(table))

        case .rule:
            out.append(.rule(width: 0.75, color: StoryColor.hex("#bbbbbb"), box: StoryBox(spaceBefore: theme.size * 0.6, spaceAfter: theme.size * 0.6, leadingInset: indent)))

        case .html(let html):
            let text = XMLText.plain(html)
            if !text.isEmpty {
                out.append(.text(theme.text().string(text), StoryBox(spaceBefore: 0, spaceAfter: theme.spacing, leadingInset: indent)))
            }
        }
    }

    static func defaultHeadingSpace(_ level: Int, size: CGFloat) -> (before: CGFloat, after: CGFloat) {
        switch level {
        case 1: (0, 6)
        case 2: (size, 4)
        case 3: (size * 0.8, 3)
        default: (size * 0.8, 2)
        }
    }

    /// Inline images inside running text are pulled out after the paragraph (Core Text cannot flow them).
    private static func withoutImages(_ inlines: [MDInline], theme: StoryTheme, into out: inout [StoryItem]) -> [MDInline] {
        inlines.map { inline in
            guard case .image(_, let alt) = inline.kind else { return inline }
            var copy = inline
            copy.kind = .text(alt)
            return copy
        }
    }

    private static func loadImage(_ source: String, theme: StoryTheme) -> CGImage? {
        let lower = source.lowercased()
        if lower.hasPrefix("http:") || lower.hasPrefix("https:") || lower.hasPrefix("//") { return nil }
        if lower.hasPrefix("data:image/"), let comma = source.firstIndex(of: ","), source[..<comma].contains(";base64"),
           let data = Data(base64Encoded: String(source[source.index(after: comma)...]), options: .ignoreUnknownCharacters) {
            return StoryImages.load(data: data)
        }
        guard let base = theme.baseURL else { return nil }
        let decoded = source.removingPercentEncoding ?? source
        let url = decoded.hasPrefix("/") ? URL(fileURLWithPath: decoded) : base.appendingPathComponent(decoded)
        let resolved = url.standardizedFileURL
        // Only pictures inside the source folder: a Markdown file must not read arbitrary files.
        guard resolved.path.hasPrefix(base.standardizedFileURL.path) else { return nil }
        return StoryImages.load(resolved)
    }
}
