import CoreGraphics
import Foundation

/// Presentation drawings (desktop `presentationStore.ts`, `drawingGeometry.ts`, `drawingGestures.ts`,
/// `pageJump.ts`). Points are normalised to the slide: x by its width, y by its height, origin top-left,
/// so drawings survive rotation, zoom and the external display's different size. Widths and font sizes
/// are fractions of the slide width.
struct PresentationStroke: Identifiable, Equatable, Codable {
    enum Kind: String, Codable, CaseIterable {
        case pen, highlighter, line, arrow, rect, ellipse, text
    }

    var id: String
    var kind: Kind
    /// `#RRGGBB`.
    var color: String
    var width: CGFloat
    var points: [CGPoint]
    var opacity: CGFloat?
    var text: String?
    var fontSize: CGFloat?
    /// Text block size (normalised).
    var size: CGSize?

    var isFreehand: Bool { kind == .pen || kind == .highlighter }

    static func makeID(_ prefix: String = "stroke") -> String {
        "\(prefix)-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6))"
    }
}

/// Tools of the presentation bar (`PRESENTATION_TOOLS`).
enum PresentationTool: String, CaseIterable, Identifiable, Codable {
    case pointer, laser, pen, highlighter, shape, text, select, eraser, spotlight, magnifier
    var id: String { rawValue }
    var labelKey: String { "presentation.tools.\(rawValue)" }

    var symbol: String {
        switch self {
        case .pointer: "cursorarrow"
        case .laser: "sparkle"
        case .pen: "pencil.tip"
        case .highlighter: "highlighter"
        case .shape: "square.on.circle"
        case .text: "textformat"
        case .select: "cursorarrow.click.2"
        case .eraser: "eraser"
        case .spotlight: "light.max"
        case .magnifier: "magnifyingglass"
        }
    }

    /// Tools that put ink on the slide (`BOARD_TOOLS` + text).
    var draws: Bool { self == .pen || self == .highlighter || self == .shape || self == .text || self == .eraser || self == .select }
    var hasStyleOptions: Bool { self != .pointer && self != .eraser && self != .select }
    var usesInkColor: Bool { self == .pen || self == .highlighter || self == .shape || self == .text }
    /// Tools that follow the finger instead of letting it swipe between slides.
    var tracksPointer: Bool { self == .laser || self == .spotlight || self == .magnifier }
}

enum PresentationShape: String, CaseIterable, Identifiable, Codable {
    case line, arrow, rect, ellipse
    var id: String { rawValue }
    var labelKey: String { "presentation.shapes.\(rawValue)" }
    var symbol: String {
        switch self {
        case .line: "line.diagonal"
        case .arrow: "arrow.up.right"
        case .rect: "rectangle"
        case .ellipse: "circle"
        }
    }
    var strokeKind: PresentationStroke.Kind {
        switch self {
        case .line: .line
        case .arrow: .arrow
        case .rect: .rect
        case .ellipse: .ellipse
        }
    }
}

enum PresentationGeometry {
    static let ellipseSegments = 48
    static let minPieceLength: CGFloat = 0.002
    static let highlighterAlpha: CGFloat = 0.45
    static let snapAngle = CGFloat.pi / 4
    static let minShapePoints: CGFloat = 3
    static let textLineHeight: CGFloat = 1.25

    static let penColors = ["#E5484D", "#FF6B00", "#FFD400", "#30A46C", "#12A594", "#3E63DD", "#8E4EC6", "#E93D82", "#A1662F", "#8B8D98", "#FFFFFF", "#000000"]
    static let laserColors = ["#E5484D", "#30A46C", "#3E63DD", "#FFD400"]
    static let laserSizes: [CGFloat] = [6, 8, 12, 16]
    static let spotlightSizes: [CGFloat] = [110, 180, 260, 340]
    static let spotlightDims: [CGFloat] = [0.5, 0.65, 0.78, 0.9]
    static let magnifierSizes: [CGFloat] = [160, 220, 300, 380]
    static let magnifierZooms: [CGFloat] = [1.5, 2, 2.5, 3, 4]
    static let penWidthRange: ClosedRange<CGFloat> = 1...24
    static let highlighterWidthRange: ClosedRange<CGFloat> = 4...48
    static let opacityRange: ClosedRange<CGFloat> = 0.1...1
    static let textSizeRange: ClosedRange<CGFloat> = 12...96

    static func distanceToSegment(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = b.x - a.x, dy = b.y - a.y
        let lengthSq = dx * dx + dy * dy
        if lengthSq == 0 { return hypot(p.x - a.x, p.y - a.y) }
        let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
        return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }

    private static func corners(_ stroke: PresentationStroke) -> (x0: CGFloat, y0: CGFloat, x1: CGFloat, y1: CGFloat) {
        let start = stroke.points.first ?? .zero
        let end = stroke.points.count > 1 ? stroke.points[1] : start
        return (min(start.x, end.x), min(start.y, end.y), max(start.x, end.x), max(start.y, end.y))
    }

    static func ellipsePoints(_ stroke: PresentationStroke) -> [CGPoint] {
        let c = corners(stroke)
        let cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2
        let rx = (c.x1 - c.x0) / 2, ry = (c.y1 - c.y0) / 2
        return (0...ellipseSegments).map { index in
            let angle = CGFloat(index) / CGFloat(ellipseSegments) * .pi * 2
            return CGPoint(x: cx + rx * cos(angle), y: cy + ry * sin(angle))
        }
    }

    static func rectCorners(_ stroke: PresentationStroke) -> [CGPoint] {
        let start = stroke.points.first ?? .zero
        let end = stroke.points.count > 1 ? stroke.points[1] : start
        return [start, CGPoint(x: end.x, y: start.y), end, CGPoint(x: start.x, y: end.y), start]
    }

    /// The polylines that make up a drawing (for hit tests, bounds and rendering).
    static func outline(_ stroke: PresentationStroke) -> [[CGPoint]] {
        switch stroke.kind {
        case .pen, .highlighter: return [stroke.points]
        case .line, .arrow: return stroke.points.count > 1 ? [Array(stroke.points.prefix(2))] : []
        case .rect:
            let c = corners(stroke)
            return [[CGPoint(x: c.x0, y: c.y0), CGPoint(x: c.x1, y: c.y0), CGPoint(x: c.x1, y: c.y1), CGPoint(x: c.x0, y: c.y1), CGPoint(x: c.x0, y: c.y0)]]
        case .ellipse: return [ellipsePoints(stroke)]
        case .text: return []
        }
    }

    /// Bounds in a surface of `scale` (pass the slide size for points, `(1,1)` for normalised units).
    static func bounds(_ stroke: PresentationStroke, scale: CGSize = CGSize(width: 1, height: 1)) -> CGRect {
        if stroke.kind == .text {
            let anchor = stroke.points.first ?? .zero
            let size = stroke.size ?? .zero
            return CGRect(x: anchor.x * scale.width, y: anchor.y * scale.height, width: size.width * scale.width, height: size.height * scale.height)
        }
        let pad = stroke.width * scale.width / 2
        let all = outline(stroke).flatMap { $0 } + stroke.points
        guard !all.isEmpty else { return .zero }
        let xs = all.map { $0.x * scale.width }, ys = all.map { $0.y * scale.height }
        return CGRect(x: xs.min()! - pad, y: ys.min()! - pad, width: xs.max()! - xs.min()! + pad * 2, height: ys.max()! - ys.min()! + pad * 2)
    }

    private static func insideEllipse(_ stroke: PresentationStroke, _ point: CGPoint, _ scale: CGSize) -> Bool {
        let c = corners(stroke)
        let rx = (c.x1 - c.x0) / 2 * scale.width, ry = (c.y1 - c.y0) / 2 * scale.height
        guard rx > 0, ry > 0 else { return false }
        let dx = point.x - (c.x0 + c.x1) / 2 * scale.width
        let dy = point.y - (c.y0 + c.y1) / 2 * scale.height
        return dx * dx / (rx * rx) + dy * dy / (ry * ry) <= 1
    }

    /// `point` is normalised; `tolerance` is in the units of `scale`.
    static func hits(_ stroke: PresentationStroke, _ point: CGPoint, tolerance: CGFloat, scale: CGSize = CGSize(width: 1, height: 1), filled: Bool = false) -> Bool {
        let p = CGPoint(x: point.x * scale.width, y: point.y * scale.height)
        if stroke.kind == .text { return bounds(stroke, scale: scale).insetBy(dx: -tolerance, dy: -tolerance).contains(p) }
        if filled && stroke.kind == .rect && bounds(stroke, scale: scale).contains(p) { return true }
        if filled && stroke.kind == .ellipse && insideEllipse(stroke, p, scale) { return true }
        let threshold = tolerance + stroke.width * scale.width / 2
        for line in outline(stroke) {
            let points = line.map { CGPoint(x: $0.x * scale.width, y: $0.y * scale.height) }
            if points.count == 1, hypot(points[0].x - p.x, points[0].y - p.y) <= threshold { return true }
            for index in points.indices.dropLast() where distanceToSegment(p, points[index], points[index + 1]) <= threshold { return true }
        }
        return false
    }

    static func topDrawing(in strokes: [PresentationStroke], at point: CGPoint, tolerance: CGFloat, scale: CGSize) -> PresentationStroke? {
        strokes.last { hits($0, point, tolerance: tolerance, scale: scale, filled: true) }
    }

    static func translated(_ stroke: PresentationStroke, dx: CGFloat, dy: CGFloat) -> PresentationStroke {
        var copy = stroke
        copy.points = stroke.points.map { CGPoint(x: $0.x + dx, y: $0.y + dy) }
        return copy
    }

    // MARK: Erasing (desktop `eraseFromStroke`)

    private static func outsideSpans(_ a: CGPoint, _ b: CGPoint, _ center: CGPoint, _ radius: CGFloat) -> [(CGFloat, CGFloat)] {
        let dx = b.x - a.x, dy = b.y - a.y
        let fx = a.x - center.x, fy = a.y - center.y
        let qa = dx * dx + dy * dy
        let qc = fx * fx + fy * fy - radius * radius
        if qa == 0 { return qc > 0 ? [(0, 1)] : [] }
        let qb = 2 * (fx * dx + fy * dy)
        let disc = qb * qb - 4 * qa * qc
        if disc <= 0 { return [(0, 1)] }
        let root = disc.squareRoot()
        let enter = (-qb - root) / (2 * qa)
        let leave = (-qb + root) / (2 * qa)
        if leave <= 0 || enter >= 1 { return [(0, 1)] }
        var spans: [(CGFloat, CGFloat)] = []
        if enter > 0 { spans.append((0, enter)) }
        if leave < 1 { spans.append((leave, 1)) }
        return spans
    }

    private static func point(_ a: CGPoint, _ b: CGPoint, _ t: CGFloat) -> CGPoint {
        if t == 0 { return a }
        if t == 1 { return b }
        return CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    }

    private static func length(_ points: [CGPoint]) -> CGFloat {
        zip(points, points.dropFirst()).reduce(0) { $0 + hypot($1.1.x - $1.0.x, $1.1.y - $1.0.y) }
    }

    private static func strokeHit(_ stroke: PresentationStroke, _ p: CGPoint, _ radius: CGFloat) -> Bool {
        let threshold = radius + stroke.width / 2
        for index in stroke.points.indices.dropLast() where distanceToSegment(p, stroke.points[index], stroke.points[index + 1]) <= threshold { return true }
        return stroke.points.count == 1 && hypot(stroke.points[0].x - p.x, stroke.points[0].y - p.y) <= threshold
    }

    /// Erases around `point` (normalised). Freehand strokes split into pieces; shapes and text vanish whole.
    /// Returns nil when the stroke is untouched.
    static func erase(_ stroke: PresentationStroke, at p: CGPoint, radius: CGFloat) -> [PresentationStroke]? {
        guard stroke.isFreehand else { return hits(stroke, p, tolerance: radius) ? [] : nil }
        guard strokeHit(stroke, p, radius) else { return nil }
        guard stroke.points.count >= 2 else { return [] }
        let threshold = radius + stroke.width / 2
        var pieces: [[CGPoint]] = []
        var open = false
        for index in stroke.points.indices.dropLast() {
            let a = stroke.points[index], b = stroke.points[index + 1]
            let spans = outsideSpans(a, b, p, threshold)
            if spans.isEmpty { open = false }
            for (start, end) in spans {
                if start > 0 || !open {
                    pieces.append([point(a, b, start)])
                    open = true
                }
                pieces[pieces.count - 1].append(point(a, b, end))
                if end < 1 { open = false }
            }
        }
        return pieces.enumerated()
            .filter { $0.element.count > 1 && length($0.element) >= minPieceLength }
            .map { index, points in
                var piece = stroke
                piece.id = "\(stroke.id)~\(index)"
                piece.points = points
                return piece
            }
    }

    // MARK: Drawing gestures (`drawingGestures.ts`)

    /// Snaps lines to 45° and shapes to squares/circles (Shift on desktop, a second finger on iPad).
    static func constrainedEnd(_ kind: PresentationStroke.Kind, start: CGPoint, point: CGPoint, surface: CGSize) -> CGPoint {
        let dx = (point.x - start.x) * surface.width
        let dy = (point.y - start.y) * surface.height
        if kind == .line || kind == .arrow {
            let length = hypot(dx, dy)
            let angle = (atan2(dy, dx) / snapAngle).rounded() * snapAngle
            return CGPoint(x: start.x + cos(angle) * length / surface.width, y: start.y + sin(angle) * length / surface.height)
        }
        let side = max(abs(dx), abs(dy))
        return CGPoint(x: start.x + (dx < 0 ? -side : side) / surface.width, y: start.y + (dy < 0 ? -side : side) / surface.height)
    }

    static func isKept(_ stroke: PresentationStroke, surface: CGSize) -> Bool {
        if stroke.isFreehand { return stroke.points.count > 1 }
        if stroke.kind == .text { return !(stroke.text ?? "").isEmpty }
        guard stroke.points.count > 1 else { return false }
        let start = stroke.points[0], end = stroke.points[1]
        return hypot((end.x - start.x) * surface.width, (end.y - start.y) * surface.height) >= minShapePoints
    }

    static func arrowHeadLength(lineWidth: CGFloat) -> CGFloat { max(10, lineWidth * 4) }

    /// Colours too dark to read on the black board turn white (`readableOnDark`).
    static func readableOnDark(_ hex: String) -> String {
        guard let rgb = rgb(hex) else { return hex }
        let linear = [rgb.r, rgb.g, rgb.b].map { $0 <= 0.03928 ? $0 / 12.92 : pow(($0 + 0.055) / 1.055, 2.4) }
        let luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
        return luminance < 0.18 ? "#FFFFFF" : hex
    }

    static func rgb(_ hex: String) -> (r: CGFloat, g: CGFloat, b: CGFloat)? {
        var text = hex.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let value = Int(text, radix: 16) else { return nil }
        return (CGFloat((value >> 16) & 255) / 255, CGFloat((value >> 8) & 255) / 255, CGFloat(value & 255) / 255)
    }

    static func hex(r: CGFloat, g: CGFloat, b: CGFloat) -> String {
        func byte(_ v: CGFloat) -> Int { Int((max(0, min(1, v)) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", byte(r), byte(g), byte(b))
    }

    // MARK: Timer & page jump

    /// `mm:ss`, or `hh:mm:ss` past an hour (`formatElapsed`).
    static func formatElapsed(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        let hours = total / 3600, minutes = (total % 3600) / 60, secs = total % 60
        return hours > 0 ? String(format: "%02d:%02d:%02d", hours, minutes, secs) : String(format: "%02d:%02d", minutes, secs)
    }

    /// Typed-digits page jump (`pageJump.ts`): leading zeros dropped, at most six digits.
    static func appendJumpDigit(_ buffer: String, _ digit: Character) -> String {
        guard digit.isASCII, digit.isNumber else { return buffer }
        var next = buffer + String(digit)
        while next.count > 1 && next.hasPrefix("0") { next.removeFirst() }
        return String(next.prefix(6))
    }

    /// Zero-based page for a typed buffer, clamped to the document.
    static func resolveJump(_ buffer: String, pageCount: Int) -> Int? {
        guard let value = Int(buffer), value >= 1, pageCount > 0 else { return nil }
        return min(value, pageCount) - 1
    }
}
