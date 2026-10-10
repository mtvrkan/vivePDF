import PDFKit
import SwiftUI
import UIKit

/// The annotate bar tools (`TOOLS` in `AnnotateBar.tsx`, plus iOS sticky notes, stamps and links).
enum AnnotateTool: String, CaseIterable, Identifiable {
    case select, area
    case highlight, underline, strikeout, squiggly
    case ink, eraser
    case square, circle, line, arrow
    case freeText, note, stamp, link
    var id: String { rawValue }

    var labelKey: String {
        switch self {
        case .select: "annotate.select"
        case .area: "annotate.areaSelect"
        case .highlight: "annotate.highlight"
        case .underline: "annotate.underline"
        case .strikeout: "annotate.strikeout"
        case .squiggly: "annotate.squiggly"
        case .ink: "annotate.ink"
        case .eraser: "annotate.eraser"
        case .square: "annotate.square"
        case .circle: "annotate.circle"
        case .line: "annotate.line"
        case .arrow: "annotate.arrow"
        case .freeText: "annotate.freeText"
        case .note: "viewer.comments.types.Text"
        case .stamp: "viewer.comments.types.Stamp"
        case .link: "viewer.overlay.link"
        }
    }

    var symbol: String {
        switch self {
        case .select: "cursorarrow"
        case .area: "rectangle.dashed"
        case .highlight: "highlighter"
        case .underline: "underline"
        case .strikeout: "strikethrough"
        case .squiggly: "scribble"
        case .ink: "pencil.tip"
        case .eraser: "eraser"
        case .square: "square"
        case .circle: "circle"
        case .line: "line.diagonal"
        case .arrow: "arrow.up.right"
        case .freeText: "character.textbox"
        case .note: "note.text"
        case .stamp: "seal"
        case .link: "link"
        }
    }

    /// Text-markup tools mark text dragged over (or the current selection).
    var isMarkup: Bool { [.highlight, .underline, .strikeout, .squiggly].contains(self) }
    /// Tools that draw with the finger/Pencil and therefore take over one-finger scrolling.
    var draws: Bool { ![.select].contains(self) }

    var showsStroke: Bool { [.ink, .square, .circle, .line, .arrow].contains(self) }
    var showsFill: Bool { [.square, .circle].contains(self) }
    var showsDash: Bool { [.square, .circle, .line, .arrow].contains(self) }
    var showsEndings: Bool { [.line, .arrow].contains(self) }
    var hasStyle: Bool { ![.select, .area, .eraser, .link].contains(self) }

    var subtype: PDFAnnotationSubtype? {
        switch self {
        case .highlight: .highlight
        case .underline: .underline
        case .strikeout: .strikeOut
        case .squiggly: PDFAnnotationSubtype(rawValue: "Squiggly")
        default: nil
        }
    }

    /// Tool matching an existing annotation (desktop `SUBTYPE_TOOLS`), used to read and patch its style.
    static func of(_ annotation: PDFAnnotation) -> AnnotateTool? {
        switch AnnotationKind.of(annotation) {
        case "Square": .square
        case "Circle": .circle
        case "Ink": .ink
        case "Line": annotation.endLineStyle != .none || annotation.startLineStyle != .none ? .arrow : .line
        case "PolyLine": .arrow
        case "FreeText": .freeText
        case "Highlight": .highlight
        case "Underline": .underline
        case "StrikeOut": .strikeout
        case "Squiggly": .squiggly
        case "Text": .note
        case "Stamp": .stamp
        case "Link": .link
        default: nil
        }
    }

    static let markupTools: [AnnotateTool] = [.highlight, .underline, .strikeout, .squiggly]
    static let drawTools: [AnnotateTool] = [.ink, .eraser, .square, .circle, .line, .arrow]
    static let insertTools: [AnnotateTool] = [.freeText, .note, .stamp, .link]
}

/// Annotation subtype names without the leading slash ("Highlight", "Ink"…).
enum AnnotationKind {
    static func of(_ annotation: PDFAnnotation) -> String {
        (annotation.type ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    /// Marks the annotate tools can select, move and delete (desktop `isMark`).
    static let marks: Set<String> = ["Square", "Circle", "Ink", "Line", "PolyLine", "FreeText", "Highlight", "Underline", "StrikeOut", "Squiggly", "Text", "Stamp"]

    static func isMark(_ annotation: PDFAnnotation, includeLinks: Bool = false) -> Bool {
        let kind = of(annotation)
        return marks.contains(kind) || (includeLinks && kind == "Link")
    }
}

/// Line endings offered by the desktop (`LINE_ENDING_OPTIONS`).
enum AnnotateLineEnding: String, CaseIterable, Identifiable {
    case none, openArrow, closedArrow, circle, square, diamond, butt
    var id: String { rawValue }

    var pdfStyle: PDFLineStyle {
        switch self {
        case .none: .none
        case .openArrow: .openArrow
        case .closedArrow: .closedArrow
        case .circle: .circle
        case .square: .square
        case .diamond: .diamond
        case .butt: .none
        }
    }

    var labelKey: String {
        switch self {
        case .none: "annotate.endNone"
        case .openArrow: "annotate.endOpenArrow"
        case .closedArrow: "annotate.endClosedArrow"
        case .circle: "annotate.endCircle"
        case .square: "annotate.endSquare"
        case .diamond: "annotate.endDiamond"
        case .butt: "annotate.endButt"
        }
    }

    static func from(_ style: PDFLineStyle) -> AnnotateLineEnding {
        switch style {
        case .openArrow: .openArrow
        case .closedArrow: .closedArrow
        case .circle: .circle
        case .square: .square
        case .diamond: .diamond
        default: .none
        }
    }
}

/// Stamp presets (`tools.security.stamp.presets.*`), drawn as a framed word.
enum AnnotateStamp: String, CaseIterable, Identifiable {
    case approved, draft, confidential, paid, copy, urgent, received, reviewed
    var id: String { rawValue }

    /// PDF standard stamp name written to `/Name` so other readers know the intent.
    var standardName: String {
        switch self {
        case .approved: "Approved"
        case .draft: "Draft"
        case .confidential: "Confidential"
        case .paid: "Final"
        case .copy: "AsIs"
        case .urgent: "TopSecret"
        case .received: "ForComment"
        case .reviewed: "Experimental"
        }
    }

    /// Text with `{date}` and `{name}` filled in, like the desktop stamp tool.
    func text(author: String, date: Date = Date()) -> String {
        let template = t("tools.security.stamp.presets.\(rawValue)")
        let day = DateFormatter.localizedString(from: date, dateStyle: .short, timeStyle: .none)
        return template.replacingOccurrences(of: "{date}", with: day).replacingOccurrences(of: "{name}", with: author)
            .trimmingCharacters(in: .whitespaces)
    }
}

/// Style of new marks or of the selected mark (desktop `StyleValues`).
struct AnnotateStyle: Equatable {
    var color: UIColor
    var fill: UIColor?
    var strokeWidth: CGFloat = 2
    var opacity: CGFloat = 1
    var dashed = false
    var startEnding: AnnotateLineEnding = .none
    var endEnding: AnnotateLineEnding = .none
    var fontSize: CGFloat = 14

    static let minStrokeWidth: CGFloat = 0.5
    static let maxStrokeWidth: CGFloat = 24
    static let strokeStep: CGFloat = 0.5
    static let dashPattern: [CGFloat] = [4, 3]

    /// `FALLBACK_COLORS` from `annotateStyle.ts`.
    static let presets: [String] = ["#FFD400", "#FF6B00", "#E5484D", "#D6409F", "#8E4EC6", "#3E63DD", "#0090FF", "#12A594", "#30A46C", "#000000"]

    static func defaults(for tool: AnnotateTool) -> AnnotateStyle {
        switch tool {
        case .highlight: AnnotateStyle(color: UIColor(annotateHex: "#FFD400"), opacity: 0.5)
        case .underline: AnnotateStyle(color: UIColor(annotateHex: "#0090FF"))
        case .strikeout: AnnotateStyle(color: UIColor(annotateHex: "#E5484D"))
        case .squiggly: AnnotateStyle(color: UIColor(annotateHex: "#30A46C"))
        case .ink: AnnotateStyle(color: UIColor(annotateHex: "#E5484D"), strokeWidth: 2)
        case .square, .circle: AnnotateStyle(color: UIColor(annotateHex: "#E5484D"), strokeWidth: 2)
        case .line: AnnotateStyle(color: UIColor(annotateHex: "#3E63DD"), strokeWidth: 2)
        case .arrow: AnnotateStyle(color: UIColor(annotateHex: "#3E63DD"), strokeWidth: 2, endEnding: .openArrow)
        case .freeText: AnnotateStyle(color: UIColor(annotateHex: "#000000"))
        case .note: AnnotateStyle(color: UIColor(annotateHex: "#FFD400"))
        case .stamp: AnnotateStyle(color: UIColor(annotateHex: "#E5484D"), strokeWidth: 2)
        default: AnnotateStyle(color: UIColor(annotateHex: "#E5484D"))
        }
    }

    /// Reads the style of an existing mark (desktop `styleValuesOf`).
    static func of(_ annotation: PDFAnnotation) -> AnnotateStyle? {
        guard let tool = AnnotateTool.of(annotation) else { return nil }
        var style = defaults(for: tool)
        let base = tool == .freeText ? (annotation.fontColor ?? annotation.color) : annotation.color
        var alpha: CGFloat = 1
        base.getRed(nil, green: nil, blue: nil, alpha: &alpha)
        style.color = base.withAlphaComponent(1)
        style.opacity = alpha
        if tool.showsFill {
            if let fill = annotation.interiorColor, fill.cgColor.alpha > 0 { style.fill = fill.withAlphaComponent(1) } else { style.fill = nil }
        }
        if tool.showsStroke, let width = annotation.border?.lineWidth { style.strokeWidth = width }
        if tool.showsDash { style.dashed = annotation.border?.style == .dashed }
        if tool.showsEndings {
            style.startEnding = .from(annotation.startLineStyle)
            style.endEnding = .from(annotation.endLineStyle)
            if let curve = annotation as? CurvedLineAnnotation {
                style.startEnding = curve.startEnding
                style.endEnding = curve.endEnding
            }
        }
        if tool == .freeText, let size = annotation.font?.pointSize { style.fontSize = size }
        return style
    }

    /// Writes the style onto an annotation (desktop `stylePatchFor`).
    func apply(to annotation: PDFAnnotation, tool: AnnotateTool) {
        let tinted = color.withAlphaComponent(opacity)
        switch tool {
        case .freeText:
            annotation.fontColor = tinted
            annotation.font = UIFont.systemFont(ofSize: fontSize)
        case .square, .circle:
            annotation.color = tinted
            annotation.interiorColor = fill?.withAlphaComponent(opacity)
        default:
            annotation.color = tinted
        }
        if tool.showsStroke || tool == .stamp {
            let border = annotation.border ?? PDFBorder()
            border.lineWidth = strokeWidth
            if tool.showsDash {
                border.style = dashed ? .dashed : .solid
                border.dashPattern = dashed ? Self.dashPattern : nil
            }
            annotation.border = border
        }
        if tool.showsEndings {
            if let curve = annotation as? CurvedLineAnnotation {
                curve.startEnding = startEnding
                curve.endEnding = endEnding
            } else {
                annotation.startLineStyle = startEnding.pdfStyle
                annotation.endLineStyle = endEnding.pdfStyle
            }
        }
    }
}

extension UIColor {
    /// `#RRGGBB` → colour (annotate presets).
    convenience init(annotateHex hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let value = UInt64(digits, radix: 16) ?? 0
        self.init(red: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255, blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }

    /// Opaque RGB comparison for "is this swatch selected".
    func annotateMatches(_ other: UIColor) -> Bool {
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        other.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        return abs(r1 - r2) < 0.01 && abs(g1 - g2) < 0.01 && abs(b1 - b2) < 0.01
    }
}

// MARK: - Custom-drawn annotations

/// PDFKit does not draw Squiggly, PolyLine or our framed stamps itself. These subclasses draw them; PDFKit
/// turns the drawing into an appearance stream (`/AP`) on save, so every reader shows them afterwards.

/// Squiggly text markup: a wavy line under each quad.
final class SquigglyAnnotation: PDFAnnotation {
    override func draw(with box: PDFDisplayBox, in context: CGContext) {
        guard let quads = quadrilateralPoints?.map(\.cgPointValue), quads.count >= 4 else { return }
        context.saveGState()
        context.setStrokeColor(color.cgColor)
        context.setLineWidth(1.2)
        context.setLineJoin(.round)
        for start in stride(from: 0, to: quads.count - 3, by: 4) {
            // Quad order: upper-left, upper-right, lower-left, lower-right (relative to bounds).
            let lowerLeft = quads[start + 2], lowerRight = quads[start + 3]
            let height = abs(quads[start].y - lowerLeft.y)
            let amplitude = max(1.2, height * 0.12)
            let origin = CGPoint(x: bounds.minX + lowerLeft.x, y: bounds.minY + lowerLeft.y + amplitude * 0.5)
            let end = CGPoint(x: bounds.minX + lowerRight.x, y: bounds.minY + lowerRight.y + amplitude * 0.5)
            let points = AnnotationGeometry.squiggle(from: origin, to: end, amplitude: amplitude)
            guard let first = points.first else { continue }
            context.move(to: first)
            points.dropFirst().forEach { context.addLine(to: $0) }
        }
        context.strokePath()
        context.restoreGState()
    }
}

/// A curved line/arrow (desktop turns a curved line into a PolyLine). Vertices are relative to `bounds`.
final class CurvedLineAnnotation: PDFAnnotation {
    var vertices: [CGPoint] = [] { didSet { writeVertices() } }
    var startEnding: AnnotateLineEnding = .none
    var endEnding: AnnotateLineEnding = .none

    convenience init(vertices pageVertices: [CGPoint], width: CGFloat) {
        let rect = AnnotationGeometry.boundsOf(pageVertices, padding: max(width * 3, 8))
        self.init(bounds: rect, forType: PDFAnnotationSubtype(rawValue: "PolyLine"), withProperties: nil)
        vertices = pageVertices.map { CGPoint(x: $0.x - rect.minX, y: $0.y - rect.minY) }
    }

    var pageVertices: [CGPoint] { vertices.map { CGPoint(x: $0.x + bounds.minX, y: $0.y + bounds.minY) } }

    private func writeVertices() {
        let flat = pageVertices.flatMap { [NSNumber(value: Double($0.x)), NSNumber(value: Double($0.y))] }
        _ = setValue(flat, forAnnotationKey: PDFAnnotationKey(rawValue: "/Vertices"))
    }

    override func draw(with box: PDFDisplayBox, in context: CGContext) {
        let points = pageVertices
        guard points.count >= 2, let first = points.first else { return }
        let width = border?.lineWidth ?? 2
        context.saveGState()
        context.setStrokeColor(color.cgColor)
        context.setFillColor(color.cgColor)
        context.setLineWidth(width)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        if border?.style == .dashed { context.setLineDash(phase: 0, lengths: AnnotateStyle.dashPattern.map { $0 * max(1, width / 2) }) }
        context.move(to: first)
        points.dropFirst().forEach { context.addLine(to: $0) }
        context.strokePath()
        context.setLineDash(phase: 0, lengths: [])
        drawEnding(endEnding, tip: points[points.count - 1], from: points[points.count - 2], width: width, in: context)
        drawEnding(startEnding, tip: points[0], from: points[1], width: width, in: context)
        context.restoreGState()
    }

    private func drawEnding(_ ending: AnnotateLineEnding, tip: CGPoint, from: CGPoint, width: CGFloat, in context: CGContext) {
        let angle = atan2(tip.y - from.y, tip.x - from.x)
        let size = max(6, width * 3)
        func point(_ a: CGFloat, _ r: CGFloat) -> CGPoint { CGPoint(x: tip.x + cos(a) * r, y: tip.y + sin(a) * r) }
        switch ending {
        case .none: return
        case .openArrow, .closedArrow:
            context.move(to: point(angle + .pi * 5 / 6, size))
            context.addLine(to: tip)
            context.addLine(to: point(angle - .pi * 5 / 6, size))
            if ending == .closedArrow { context.closePath(); context.fillPath() } else { context.strokePath() }
        case .circle:
            context.fillEllipse(in: CGRect(x: tip.x - size / 2, y: tip.y - size / 2, width: size, height: size))
        case .square:
            context.fill(CGRect(x: tip.x - size / 2, y: tip.y - size / 2, width: size, height: size))
        case .diamond:
            context.move(to: point(0, size / 2)); context.addLine(to: point(.pi / 2, size / 2))
            context.addLine(to: point(.pi, size / 2)); context.addLine(to: point(-.pi / 2, size / 2))
            context.closePath(); context.fillPath()
        case .butt:
            context.move(to: point(angle + .pi / 2, size / 2)); context.addLine(to: point(angle - .pi / 2, size / 2))
            context.strokePath()
        }
    }
}

/// A framed stamp word ("APPROVED", "RECEIVED 10.10.2026"…) in the chosen colour.
final class StampBoxAnnotation: PDFAnnotation {
    static func make(text: String, standardName: String, at point: CGPoint, color: UIColor) -> StampBoxAnnotation {
        let font = UIFont.systemFont(ofSize: 18, weight: .heavy)
        let size = (text as NSString).size(withAttributes: [.font: font])
        let rect = CGRect(x: point.x - (size.width + 24) / 2, y: point.y - (size.height + 14) / 2, width: size.width + 24, height: size.height + 14)
        let stamp = StampBoxAnnotation(bounds: rect, forType: .stamp, withProperties: nil)
        stamp.contents = text
        stamp.stampName = standardName
        stamp.color = color
        let border = PDFBorder()
        border.lineWidth = 2
        stamp.border = border
        return stamp
    }

    override func draw(with box: PDFDisplayBox, in context: CGContext) {
        let text = contents ?? ""
        let width = border?.lineWidth ?? 2
        let frame = bounds.insetBy(dx: width / 2 + 1, dy: width / 2 + 1)
        context.saveGState()
        context.setStrokeColor(color.cgColor)
        context.setLineWidth(width)
        context.addPath(UIBezierPath(roundedRect: frame, cornerRadius: 4).cgPath)
        context.strokePath()
        UIGraphicsPushContext(context)
        // PDF space is y-up; flip locally so UIKit text draws upright.
        context.translateBy(x: 0, y: bounds.minY * 2 + bounds.height)
        context.scaleBy(x: 1, y: -1)
        let fontSize = max(6, min(frame.height * 0.62, 40))
        var font = UIFont.systemFont(ofSize: fontSize, weight: .heavy)
        let measured = (text as NSString).size(withAttributes: [.font: font])
        if measured.width > frame.width - 8, measured.width > 0 {
            font = UIFont.systemFont(ofSize: fontSize * (frame.width - 8) / measured.width, weight: .heavy)
        }
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let size = (text as NSString).size(withAttributes: attributes)
        (text as NSString).draw(at: CGPoint(x: frame.midX - size.width / 2, y: frame.midY - size.height / 2), withAttributes: attributes)
        UIGraphicsPopContext()
        context.restoreGState()
    }
}

// MARK: - Snapshots (undo)

/// Everything the annotate tools can change on a mark, so a change can be undone exactly.
struct AnnotationSnapshot {
    var bounds: CGRect
    var color: UIColor
    var interiorColor: UIColor?
    var borderWidth: CGFloat?
    var borderStyle: PDFBorderStyle?
    var dashPattern: [Any]?
    var contents: String?
    var fontColor: UIColor?
    var font: UIFont?
    var paths: [UIBezierPath]?
    var startPoint: CGPoint
    var endPoint: CGPoint
    var startLineStyle: PDFLineStyle
    var endLineStyle: PDFLineStyle
    var quadPoints: [NSValue]?
    var vertices: [CGPoint]?
    var curveEndings: (AnnotateLineEnding, AnnotateLineEnding)?

    init(_ annotation: PDFAnnotation) {
        bounds = annotation.bounds
        color = annotation.color
        interiorColor = annotation.interiorColor
        borderWidth = annotation.border?.lineWidth
        borderStyle = annotation.border?.style
        dashPattern = annotation.border?.dashPattern
        contents = annotation.contents
        fontColor = annotation.fontColor
        font = annotation.font
        paths = annotation.paths?.map { $0.copy() as? UIBezierPath ?? $0 }
        let kind = AnnotationKind.of(annotation)
        startPoint = kind == "Line" ? annotation.startPoint : .zero
        endPoint = kind == "Line" ? annotation.endPoint : .zero
        startLineStyle = kind == "Line" ? annotation.startLineStyle : .none
        endLineStyle = kind == "Line" ? annotation.endLineStyle : .none
        quadPoints = annotation.quadrilateralPoints
        if let curve = annotation as? CurvedLineAnnotation {
            vertices = curve.vertices
            curveEndings = (curve.startEnding, curve.endEnding)
        }
    }

    func restore(_ annotation: PDFAnnotation) {
        annotation.bounds = bounds
        annotation.color = color
        annotation.interiorColor = interiorColor
        if let borderWidth {
            let border = annotation.border ?? PDFBorder()
            border.lineWidth = borderWidth
            if let borderStyle { border.style = borderStyle }
            border.dashPattern = dashPattern
            annotation.border = border
        }
        annotation.contents = contents
        if let fontColor { annotation.fontColor = fontColor }
        if let font { annotation.font = font }
        if let paths {
            annotation.paths?.forEach { annotation.remove($0) }
            paths.forEach { annotation.add($0.copy() as? UIBezierPath ?? $0) }
        }
        if AnnotationKind.of(annotation) == "Line" {
            annotation.startPoint = startPoint
            annotation.endPoint = endPoint
            annotation.startLineStyle = startLineStyle
            annotation.endLineStyle = endLineStyle
        }
        if let quadPoints { annotation.quadrilateralPoints = quadPoints }
        if let curve = annotation as? CurvedLineAnnotation {
            if let vertices { curve.vertices = vertices }
            if let curveEndings { curve.startEnding = curveEndings.0; curve.endEnding = curveEndings.1 }
        }
    }
}

// MARK: - Path helpers

extension UIBezierPath {
    /// End points of every segment (curves flattened to their end points), one array per subpath.
    var annotateStrokes: [[CGPoint]] {
        var strokes: [[CGPoint]] = []
        var current: [CGPoint] = []
        cgPath.applyWithBlock { element in
            let e = element.pointee
            switch e.type {
            case .moveToPoint:
                if !current.isEmpty { strokes.append(current) }
                current = [e.points[0]]
            case .addLineToPoint: current.append(e.points[0])
            case .addQuadCurveToPoint: current.append(e.points[1])
            case .addCurveToPoint: current.append(e.points[2])
            case .closeSubpath: if let first = current.first { current.append(first) }
            @unknown default: break
            }
        }
        if !current.isEmpty { strokes.append(current) }
        return strokes
    }

    static func annotateStroke(_ points: [CGPoint]) -> UIBezierPath {
        let path = UIBezierPath()
        guard let first = points.first else { return path }
        path.move(to: first)
        if points.count == 1 { path.addLine(to: CGPoint(x: first.x + 0.01, y: first.y)) }
        points.dropFirst().forEach { path.addLine(to: $0) }
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        return path
    }
}
