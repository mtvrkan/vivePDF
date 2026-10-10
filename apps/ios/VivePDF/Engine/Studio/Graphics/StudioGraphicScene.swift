import CoreGraphics
import CoreText
import Foundation

/// A tiny display list the table / chart / flowchart renderers draw into. It paints with Core Graphics
/// (vector text through Core Text) and serialises to SVG with text as glyph outlines, like the desktop
/// engine's `get_svg_image(text_as_path=True)`, so the stored markup is self-contained.
final class StudioGraphicScene {
    static let lineHeight = 1.25

    enum Item {
        case fill(CGPath, color: String, opacity: Double, evenOdd: Bool)
        case stroke(CGPath, color: String, width: Double, opacity: Double, cap: CGLineCap, join: CGLineJoin)
        case text(String, x: Double, baseline: Double, size: Double, bold: Bool, color: String, opacity: Double, rotated: Bool)
    }

    let width: Double
    let height: Double
    let fontId: String
    private(set) var items: [Item] = []

    init(width: Double, height: Double, fontId: String) {
        self.width = width
        self.height = height
        self.fontId = fontId
    }

    // MARK: Fonts

    func face(bold: Bool) -> StudioFace {
        StudioFonts.shared.face(fontId, weight: bold ? StudioTypography.boldWeight : StudioTypography.regularWeight, italic: false)
    }

    private func line(_ text: String, size: Double, bold: Bool, color: CGColor? = nil) -> CTLine {
        var attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): face(bold: bold).font(size: size),
            NSAttributedString.Key(kCTKernAttributeName as String): 0,
            NSAttributedString.Key(kCTLigatureAttributeName as String): 0,
        ]
        if let color { attributes[NSAttributedString.Key(kCTForegroundColorAttributeName as String)] = color }
        return CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
    }

    /// `font.text_length`: advance width of `text`.
    func width(_ text: String, size: Double, bold: Bool = false) -> Double {
        guard !text.isEmpty else { return 0 }
        return Double(CTLineGetTypographicBounds(line(text, size: size, bold: bold), nil, nil, nil))
    }

    /// `baseline_offset`: distance from a line box top to its baseline (line height 1.25).
    func baselineOffset(size: Double, bold: Bool = false) -> Double {
        let f = face(bold: bold)
        return (size * Self.lineHeight - (f.ascender - f.descender) * size) / 2 + f.ascender * size
    }

    /// `wrap_cell` from `editor_table.py`: words onto lines no wider than `width`, breaking long words.
    func wrap(_ text: String, size: Double, width: Double, bold: Bool = false) -> [String] {
        var lines: [String] = []
        for paragraph in text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
            let words = paragraph.split(whereSeparator: { $0.isWhitespace }).map(String.init)
            if words.isEmpty { lines.append(""); continue }
            var current = ""
            for word in words {
                let candidate = current.isEmpty ? word : current + " " + word
                if self.width(candidate, size: size, bold: bold) <= width { current = candidate; continue }
                if !current.isEmpty { lines.append(current) }
                var pieces: [String] = []
                var piece = ""
                for ch in word {
                    if !piece.isEmpty && self.width(piece + String(ch), size: size, bold: bold) > width { pieces.append(piece); piece = String(ch) } else { piece.append(ch) }
                }
                if !piece.isEmpty { pieces.append(piece) }
                lines += pieces.dropLast()
                current = pieces.last ?? ""
            }
            lines.append(current)
        }
        while lines.count > 1 && lines.last == "" { lines.removeLast() }
        return lines.isEmpty ? [""] : lines
    }

    // MARK: Drawing

    func fillRect(_ rect: CGRect, _ color: String, opacity: Double = 1) {
        let r = rect.standardized
        guard r.width > 0, r.height > 0 else { return }
        items.append(.fill(CGPath(rect: r, transform: nil), color: color, opacity: opacity, evenOdd: false))
    }

    func strokeRect(_ rect: CGRect, _ color: String, width: Double, opacity: Double = 1) {
        items.append(.stroke(CGPath(rect: rect.standardized, transform: nil), color: color, width: width, opacity: opacity, cap: .butt, join: .miter))
    }

    func line(from a: CGPoint, to b: CGPoint, _ color: String, width: Double, opacity: Double = 1, cap: CGLineCap = .butt) {
        let path = CGMutablePath()
        path.move(to: a)
        path.addLine(to: b)
        items.append(.stroke(path, color: color, width: width, opacity: opacity, cap: cap, join: .miter))
    }

    func polygon(_ points: [CGPoint], fill: String?, stroke: String? = nil, width: Double = 0, fillOpacity: Double = 1, closed: Bool = true, round: Bool = true) {
        guard points.count >= 2 else { return }
        let path = CGMutablePath()
        path.addLines(between: points)
        if closed { path.closeSubpath() }
        if let fill { items.append(.fill(path, color: fill, opacity: fillOpacity, evenOdd: false)) }
        if let stroke, width > 0 { items.append(.stroke(path, color: stroke, width: width, opacity: 1, cap: round ? .round : .butt, join: round ? .round : .miter)) }
    }

    func path(_ path: CGPath, fill: String?, stroke: String?, width: Double, fillOpacity: Double = 1) {
        if let fill { items.append(.fill(path, color: fill, opacity: fillOpacity, evenOdd: false)) }
        if let stroke, width > 0 { items.append(.stroke(path, color: stroke, width: width, opacity: 1, cap: .butt, join: .miter)) }
    }

    func circle(_ centre: CGPoint, radius: Double, fill: String?, stroke: String? = nil, width: Double = 0) {
        path(CGPath(ellipseIn: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2), transform: nil), fill: fill, stroke: stroke, width: width)
    }

    /// Text whose line box top is at `top`; `align` anchors `x` at the left, centre or right edge.
    func text(_ value: String, x: Double, top: Double, size: Double, bold: Bool = false, align: StudioTableAlign = .left, color: String) {
        guard !value.isEmpty else { return }
        let w = width(value, size: size, bold: bold)
        let left = align == .center ? x - w / 2 : align == .right ? x - w : x
        items.append(.text(value, x: left, baseline: top + baselineOffset(size: size, bold: bold), size: size, bold: bold, color: color, opacity: 1, rotated: false))
    }

    /// Text at an explicit baseline.
    func text(_ value: String, x: Double, baseline: Double, size: Double, bold: Bool = false, color: String) {
        guard !value.isEmpty else { return }
        items.append(.text(value, x: x, baseline: baseline, size: size, bold: bold, color: color, opacity: 1, rotated: false))
    }

    /// Text turned 90° anticlockwise (axis titles), reading bottom to top, centred on `middle`.
    func uprightText(_ value: String, left: Double, middle: Double, size: Double, color: String) {
        guard !value.isEmpty else { return }
        let w = width(value, size: size)
        items.append(.text(value, x: left + baselineOffset(size: size), baseline: middle + w / 2, size: size, bold: false, color: color, opacity: 1, rotated: true))
    }

    // MARK: Output

    /// Paints the scene into `rect` (stretched like an SVG with `preserveAspectRatio="none"`).
    func draw(in rect: CGRect, context: CGContext) {
        guard width > 0, height > 0 else { return }
        context.saveGState()
        context.translateBy(x: rect.minX, y: rect.minY)
        context.scaleBy(x: rect.width / width, y: rect.height / height)
        for item in items {
            switch item {
            case .fill(let path, let color, let opacity, let evenOdd):
                context.setFillColor(Self.cgColor(color, opacity))
                context.addPath(path)
                context.fillPath(using: evenOdd ? .evenOdd : .winding)
            case .stroke(let path, let color, let width, let opacity, let cap, let join):
                context.setStrokeColor(Self.cgColor(color, opacity))
                context.setLineWidth(width)
                context.setLineCap(cap)
                context.setLineJoin(join)
                context.setLineDash(phase: 0, lengths: [])
                context.addPath(path)
                context.strokePath()
            case .text(let value, let x, let baseline, let size, let bold, let color, let opacity, let rotated):
                context.saveGState()
                context.translateBy(x: x, y: baseline)
                if rotated { context.rotate(by: -.pi / 2) }
                context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
                context.textPosition = .zero
                CTLineDraw(line(value, size: size, bold: bold, color: Self.cgColor(color, opacity)), context)
                context.restoreGState()
            }
        }
        context.restoreGState()
    }

    /// SVG markup (`width`/`height` in points, matching viewBox).
    func svg() -> String {
        var body = ""
        for item in items {
            switch item {
            case .fill(let path, let color, let opacity, let evenOdd):
                body += "<path d=\"\(Self.pathData(path))\" fill=\"\(color)\"\(opacity < 1 ? " fill-opacity=\"\(Self.num(opacity))\"" : "")\(evenOdd ? " fill-rule=\"evenodd\"" : "")/>\n"
            case .stroke(let path, let color, let width, let opacity, let cap, let join):
                let capName = cap == .round ? "round" : cap == .square ? "square" : "butt"
                let joinName = join == .round ? "round" : join == .bevel ? "bevel" : "miter"
                body += "<path d=\"\(Self.pathData(path))\" fill=\"none\" stroke=\"\(color)\" stroke-width=\"\(Self.num(width))\" stroke-linecap=\"\(capName)\" stroke-linejoin=\"\(joinName)\"\(opacity < 1 ? " stroke-opacity=\"\(Self.num(opacity))\"" : "")/>\n"
            case .text(let value, let x, let baseline, let size, let bold, let color, let opacity, let rotated):
                var transform = CGAffineTransform(translationX: x, y: baseline)
                if rotated { transform = transform.rotated(by: -.pi / 2) }
                let outline = glyphPath(value, size: size, bold: bold, transform: transform)
                if !outline.isEmpty {
                    body += "<path d=\"\(Self.pathData(outline))\" fill=\"\(color)\"\(opacity < 1 ? " fill-opacity=\"\(Self.num(opacity))\"" : "")/>\n"
                }
            }
        }
        let w = Self.num(width), h = Self.num(height)
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"\(w)\" height=\"\(h)\" viewBox=\"0 0 \(w) \(h)\">\n\(body)</svg>\n"
    }

    /// Glyph outlines of `text` in scene space (y down) placed by `transform` at the baseline origin.
    private func glyphPath(_ text: String, size: Double, bold: Bool, transform: CGAffineTransform) -> CGPath {
        let result = CGMutablePath()
        let ctLine = line(text, size: size, bold: bold)
        for run in (CTLineGetGlyphRuns(ctLine) as? [CTRun]) ?? [] {
            let count = CTRunGetGlyphCount(run)
            guard count > 0 else { continue }
            let attributes = CTRunGetAttributes(run) as NSDictionary
            let font = attributes[kCTFontAttributeName] as! CTFont // swiftlint:disable:this force_cast
            var glyphs = [CGGlyph](repeating: 0, count: count)
            var positions = [CGPoint](repeating: .zero, count: count)
            CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
            CTRunGetPositions(run, CFRange(location: 0, length: count), &positions)
            for i in 0..<count {
                var glyphTransform = CGAffineTransform(translationX: positions[i].x, y: positions[i].y).concatenating(CGAffineTransform(scaleX: 1, y: -1)).concatenating(transform)
                if let glyph = CTFontCreatePathForGlyph(font, glyphs[i], &glyphTransform) { result.addPath(glyph) }
            }
        }
        return result
    }

    static func cgColor(_ hex: String, _ alpha: Double) -> CGColor {
        let (r, g, b) = StudioColor.components(hex)
        return CGColor(srgbRed: r, green: g, blue: b, alpha: alpha)
    }

    static func num(_ v: Double) -> String {
        let rounded = (v * 1000).rounded() / 1000
        if rounded == rounded.rounded(), abs(rounded) < 1e12 { return String(Int64(rounded)) }
        var s = String(format: "%.3f", rounded)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s == "-0" ? "0" : s
    }

    static func pathData(_ path: CGPath) -> String {
        var parts: [String] = []
        path.applyWithBlock { pointer in
            let e = pointer.pointee
            let p = e.points
            func pt(_ i: Int) -> String { "\(num(p[i].x)) \(num(p[i].y))" }
            switch e.type {
            case .moveToPoint: parts.append("M\(pt(0))")
            case .addLineToPoint: parts.append("L\(pt(0))")
            case .addQuadCurveToPoint: parts.append("Q\(pt(0)) \(pt(1))")
            case .addCurveToPoint: parts.append("C\(pt(0)) \(pt(1)) \(pt(2))")
            case .closeSubpath: parts.append("Z")
            @unknown default: break
            }
        }
        return parts.joined(separator: " ")
    }
}

/// Rendering refusals (`chartTooSmall`, `tableTooTall`, …) mapped onto the desktop's `errors.reasons.*`.
struct StudioGraphicError: LocalizedError, Equatable {
    let reason: String
    var errorDescription: String? { EngineError(.INVALID_PARAMS, reason: reason).errorDescription }
}
