import CoreGraphics
import CoreText
import Foundation
import PDFKit
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// A run of text with one style, in display coordinates (top-left origin, points, page rotation applied).
struct TextSpan {
    var text: String
    var rect: CGRect
    var fontName: String
    var size: CGFloat
    var bold: Bool
    var italic: Bool
    var monospace: Bool
    var color: (r: CGFloat, g: CGFloat, b: CGFloat)
    var link: String?

    var hexColor: String {
        String(format: "%02X%02X%02X", Int((color.r * 255).rounded()), Int((color.g * 255).rounded()), Int((color.b * 255).rounded()))
    }

    func sameStyle(_ other: TextSpan) -> Bool {
        fontName == other.fontName && abs(size - other.size) < 0.6 && bold == other.bold && italic == other.italic
            && hexColor == other.hexColor && link == other.link
    }
}

/// One visual line: spans in reading order (right-to-left for RTL lines).
struct TextLine {
    var spans: [TextSpan]
    var rect: CGRect
    var rtl: Bool

    var text: String { spans.map(\.text).joined() }
    /// Dominant font size (by characters).
    var size: CGFloat {
        var weights: [CGFloat: Int] = [:]
        for span in spans { weights[(span.size * 2).rounded() / 2, default: 0] += span.text.count }
        return weights.max { $0.value < $1.value }?.key ?? 11
    }
    var bold: Bool { let total = spans.reduce(0) { $0 + $1.text.count }; return spans.filter(\.bold).reduce(0) { $0 + $1.text.count } * 2 > total }
}

/// A picture drawn on the page (image XObject or inline image), in display coordinates.
struct PlacedImage {
    var rect: CGRect
    /// Identity of the image object (pointer of its stream) for de-duplication; 0 for inline images.
    var key: Int
    var stream: CGPDFStreamRef?
}

/// Everything the converters need to know about one page.
struct PageContent {
    var index: Int
    var size: CGSize
    var lines: [TextLine]
    var images: [PlacedImage]
    /// Thin horizontal/vertical strokes and filled hairline rectangles (table rulings), display coordinates.
    var rulings: [CGRect]
    /// URI links on the page (display coordinates).
    var links: [(rect: CGRect, url: String)]
    var hasText: Bool { lines.contains { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty } }

    /// The most common font size of the page text.
    var bodySize: CGFloat {
        var weights: [CGFloat: Int] = [:]
        for line in lines { for span in line.spans { weights[(span.size * 2).rounded() / 2, default: 0] += span.text.count } }
        return weights.max { $0.value < $1.value }?.key ?? 11
    }
}

enum PDFPageReader {
    // MARK: Page geometry

    /// Maps page space to display space (rotated, crop box at origin, y down).
    static func displayTransform(_ page: PDFPage) -> (CGAffineTransform, CGSize) {
        let crop = page.bounds(for: .cropBox)
        let rotation = ((page.rotation % 360) + 360) % 360
        let size = rotation % 180 == 0 ? crop.size : CGSize(width: crop.height, height: crop.width)
        // Page space → unrotated top-left space.
        var transform = CGAffineTransform(translationX: -crop.minX, y: -crop.minY)
        // Rotate clockwise by `rotation` around the origin, then move back into positive quadrant (y up).
        switch rotation {
        case 90: transform = transform.concatenating(CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: crop.width))
        case 180: transform = transform.concatenating(CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: crop.width, ty: crop.height))
        case 270: transform = transform.concatenating(CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: crop.height, ty: 0))
        default: break
        }
        // Flip to y down.
        transform = transform.concatenating(CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: size.height))
        return (transform, size)
    }

    static func displaySize(_ page: PDFPage) -> CGSize { displayTransform(page).1 }

    // MARK: Text

    private static func isRTL(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x0590...0x08FF, 0xFB1D...0xFDFF, 0xFE70...0xFEFF, 0x10800...0x10FFF, 0x1E800...0x1EFFF: true
        default: false
        }
    }

    static func hasRTL(_ text: String) -> Bool { text.unicodeScalars.contains(where: isRTL) }

    /// Arabic presentation forms (what many PDFs store) back to regular letters.
    static func normalized(_ text: String) -> String {
        guard text.unicodeScalars.contains(where: { (0xFB50...0xFDFF).contains($0.value) || (0xFE70...0xFEFF).contains($0.value) || (0xFB00...0xFB06).contains($0.value) }) else { return text }
        return text.precomposedStringWithCompatibilityMapping
    }

    private struct FontInfo {
        var name: String
        var size: CGFloat
        var bold: Bool
        var italic: Bool
        var mono: Bool
    }

    private static func fontInfo(_ value: Any?) -> FontInfo {
        guard let value, CFGetTypeID(value as CFTypeRef) == CTFontGetTypeID() else { return FontInfo(name: "Helvetica", size: 11, bold: false, italic: false, mono: false) }
        let font = value as! CTFont
        let name = CTFontCopyPostScriptName(font) as String
        let traits = CTFontGetSymbolicTraits(font)
        let lower = name.lowercased()
        let bold = traits.contains(.traitBold) || lower.contains("bold") || lower.contains("black") || lower.contains("heavy") || lower.contains("semibold")
        let italic = traits.contains(.traitItalic) || lower.contains("italic") || lower.contains("oblique")
        let mono = traits.contains(.traitMonoSpace) || lower.contains("courier") || lower.contains("mono") || lower.contains("consol")
        return FontInfo(name: name, size: CTFontGetSize(font), bold: bold, italic: italic, mono: mono)
    }

    private static func rgb(_ value: Any?) -> (CGFloat, CGFloat, CGFloat) {
        guard let value else { return (0, 0, 0) }
        var cg: CGColor?
        if CFGetTypeID(value as CFTypeRef) == CGColor.typeID {
            cg = (value as! CGColor)
        } else {
            #if canImport(UIKit)
            cg = (value as? UIColor)?.cgColor
            #else
            cg = (value as? NSColor)?.cgColor
            #endif
        }
        guard let color = cg, let converted = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil),
              let components = converted.components, components.count >= 3 else { return (0, 0, 0) }
        return (components[0], components[1], components[2])
    }

    /// Lines of a page with styled spans, grouped by baseline and ordered left→right (or right→left).
    static func lines(_ page: PDFPage) -> [TextLine] {
        guard let attributed = page.attributedString, attributed.length > 0 else { return [] }
        let (transform, _) = displayTransform(page)
        let ns = attributed.string as NSString
        let pageLength = (page.string as NSString?)?.length ?? ns.length
        let usesBounds = pageLength == ns.length

        struct Glyph { var text: String; var rect: CGRect; var info: FontInfo; var color: (CGFloat, CGFloat, CGFloat) }
        var glyphs: [Glyph] = []
        glyphs.reserveCapacity(ns.length)
        attributed.enumerateAttributes(in: NSRange(location: 0, length: ns.length)) { attributes, range, _ in
            let info = fontInfo(attributes[.font])
            let color = rgb(attributes[.foregroundColor])
            var index = range.location
            while index < range.location + range.length {
                let composed = ns.rangeOfComposedCharacterSequence(at: index)
                let character = ns.substring(with: composed)
                defer { index = composed.location + composed.length }
                if character == "\n" || character == "\r" || character == "\r\n" { glyphs.append(Glyph(text: "\n", rect: .null, info: info, color: color)); continue }
                var rect = usesBounds ? page.characterBounds(at: composed.location) : .null
                if !rect.isNull { rect = rect.applying(transform).standardized }
                glyphs.append(Glyph(text: character, rect: rect, info: info, color: color))
            }
        }

        // Spans: consecutive glyphs with one style on one baseline without a gap.
        var spans: [TextSpan] = []
        var current: TextSpan?
        var advancing: [Bool] = []   // per span: did x increase along content order?
        var lastRect: CGRect = .null
        var increasing = 0, decreasing = 0
        func close() {
            if var span = current, !span.text.isEmpty {
                if hasRTL(span.text) && increasing > decreasing {
                    // Visual-order storage: reverse to logical order.
                    span.text = String(span.text.reversed())
                }
                span.text = normalized(span.text)
                spans.append(span)
                advancing.append(increasing >= decreasing)
            }
            current = nil
            increasing = 0
            decreasing = 0
            lastRect = .null
        }
        for glyph in glyphs {
            if glyph.text == "\n" { close(); continue }
            let empty = glyph.rect.isNull || (glyph.rect.width <= 0.01 && glyph.rect.height <= 0.01)
            if glyph.text.trimmingCharacters(in: .whitespaces).isEmpty {
                if current != nil, !empty, !lastRect.isNull, abs(glyph.rect.midY - lastRect.midY) > max(glyph.rect.height, lastRect.height) * 0.6 { close(); continue }
                current?.text += " "
                if !empty, var span = current { span.rect = span.rect.union(glyph.rect); current = span; lastRect = glyph.rect }
                continue
            }
            if empty {
                current?.text += glyph.text
                continue
            }
            let size = glyph.info.size > 0 ? glyph.info.size : glyph.rect.height
            if var span = current {
                let sameStyle = span.fontName == glyph.info.name && abs(span.size - size) < 0.6 && span.color == glyph.color
                let sameLine = abs(glyph.rect.midY - lastRect.midY) <= max(min(glyph.rect.height, lastRect.height) * 0.5, 1)
                let gap = glyph.rect.minX > lastRect.maxX ? glyph.rect.minX - lastRect.maxX : lastRect.minX - glyph.rect.maxX
                let near = gap < max(size * 0.6, 2)
                if sameStyle && sameLine && near {
                    if glyph.rect.midX >= lastRect.midX { increasing += 1 } else { decreasing += 1 }
                    if gap > size * 0.18 && !span.text.hasSuffix(" ") && !hasRTL(glyph.text) { span.text += " " }
                    span.text += glyph.text
                    span.rect = span.rect.union(glyph.rect)
                    current = span
                    lastRect = glyph.rect
                    continue
                }
                if sameLine && near && !span.text.hasSuffix(" ") && gap > size * 0.18 { current?.text += " " }
                close()
            }
            current = TextSpan(text: glyph.text, rect: glyph.rect, fontName: glyph.info.name, size: size, bold: glyph.info.bold,
                               italic: glyph.info.italic, monospace: glyph.info.mono, color: glyph.color)
            lastRect = glyph.rect
        }
        close()
        return group(spans)
    }

    /// Groups spans into lines by vertical overlap; splits a line where a wide gap separates columns.
    static func group(_ spans: [TextSpan]) -> [TextLine] {
        let sorted = spans.filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty || $0.rect.width > 0 }
            .sorted { $0.rect.midY < $1.rect.midY }
        var rows: [[TextSpan]] = []
        var rowRects: [CGRect] = []
        for span in sorted {
            if let index = rowRects.indices.last(where: { index in
                let row = rowRects[index]
                let overlap = min(row.maxY, span.rect.maxY) - max(row.minY, span.rect.minY)
                return overlap > min(row.height, span.rect.height) * 0.5
            }), rowRects.count - index <= 3 {
                rows[index].append(span)
                rowRects[index] = rowRects[index].union(span.rect)
            } else {
                rows.append([span])
                rowRects.append(span.rect)
            }
        }
        var lines: [TextLine] = []
        for row in rows {
            let ordered = row.sorted { $0.rect.minX < $1.rect.minX }
            // Split at wide gaps (columns, table cells far apart).
            var pieces: [[TextSpan]] = [[]]
            for span in ordered {
                if let last = pieces[pieces.count - 1].last {
                    let gap = span.rect.minX - last.rect.maxX
                    if gap > max(span.size, last.size) * 2.2 { pieces.append([]) }
                }
                pieces[pieces.count - 1].append(span)
            }
            for piece in pieces where !piece.isEmpty {
                let text = piece.map(\.text).joined()
                let rtlCount = text.unicodeScalars.filter(isRTL).count
                let letters = text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count
                let rtl = rtlCount * 2 > max(letters, 1)
                var spans = rtl ? piece.reversed() : piece
                // Make sure words of adjacent spans are separated.
                for index in spans.indices.dropFirst() {
                    let previous = spans[index - 1], span = spans[index]
                    let gap = rtl ? previous.rect.minX - span.rect.maxX : span.rect.minX - previous.rect.maxX
                    if gap > min(span.size, previous.size) * 0.18 && !previous.text.hasSuffix(" ") && !span.text.hasPrefix(" ") {
                        spans[index - 1].text += " "
                    }
                }
                let rect = piece.reduce(CGRect.null) { $0.union($1.rect) }
                lines.append(TextLine(spans: spans, rect: rect, rtl: rtl))
            }
        }
        return lines.sorted { abs($0.rect.minY - $1.rect.minY) > 2 ? $0.rect.minY < $1.rect.minY : $0.rect.minX < $1.rect.minX }
    }

    // MARK: Whole page

    static func content(_ page: PDFPage, index: Int, scanGraphics: Bool = true) -> PageContent {
        let (transform, size) = displayTransform(page)
        var lines = self.lines(page)
        var links: [(CGRect, String)] = []
        for annotation in page.annotations {
            guard let url = (annotation.action as? PDFActionURL)?.url ?? annotation.url else { continue }
            let scheme = url.scheme?.lowercased() ?? ""
            guard ["http", "https", "mailto"].contains(scheme) else { continue }
            links.append((annotation.bounds.applying(transform).standardized, url.absoluteString))
        }
        if !links.isEmpty {
            for (lineIndex, line) in lines.enumerated() {
                for (spanIndex, span) in line.spans.enumerated() {
                    if let match = links.first(where: { $0.0.insetBy(dx: -1, dy: -1).contains(CGPoint(x: span.rect.midX, y: span.rect.midY)) }) {
                        lines[lineIndex].spans[spanIndex].link = match.1
                    }
                }
            }
        }
        var images: [PlacedImage] = []
        var rulings: [CGRect] = []
        if scanGraphics, let reference = page.pageRef {
            let scan = PDFContentScanner.scan(reference)
            images = scan.images.map { PlacedImage(rect: $0.rect.applying(transform).standardized, key: $0.key, stream: $0.stream) }
                .filter { $0.rect.intersects(CGRect(origin: .zero, size: size)) }
            rulings = scan.rulings.map { $0.applying(transform).standardized }
        }
        return PageContent(index: index, size: size, lines: lines, images: images, rulings: rulings, links: links)
    }
}
