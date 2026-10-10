import CoreGraphics
import Foundation

/// Lines and dots of a ruled paper page, in points with the origin at the top-left (`paper_marks`).
struct PagesPaperMarks {
    enum LineKind { case rule, guide, margin }
    struct Line { var x0, y0, x1, y1: Double; var kind: LineKind }
    var lines: [Line] = []
    var dots: [CGPoint] = []
    var dotRadius: Double = 0

    static let mm = 72 / 25.4
    static let insetMM = 10.0
    static let marginOffsetMM = 20.0
    static let maxMarks = 40_000
    static let ruleWidth: CGFloat = 0.5
    static let guideWidth: CGFloat = 0.4
    static let marginWidth: CGFloat = 0.7
    static let marginColor = (r: 0.87, g: 0.4, b: 0.4)
    private static let epsilon = 1e-6

    init(width: Double, height: Double, pattern: PagesPaperPattern) {
        let step = pattern.spacing * Self.mm
        let inset = Self.insetMM * Self.mm
        let left = inset, top = inset, right = width - inset, bottom = height - inset
        dotRadius = min(1.2, max(0.5, step * 0.05))
        guard right - left >= step, bottom - top >= step, step > 0 else { return }
        func count(_ length: Double, _ step: Double) -> Int { max(0, Int((length / step + Self.epsilon).rounded(.down))) }
        func banded(lines: Int, gap: Double) -> [Double] {
            let band = Double(lines - 1) * step
            var rows: [Double] = []
            var y = top + step
            while y + band <= bottom + Self.epsilon {
                rows += (0..<lines).map { y + Double($0) * step }
                y += band + gap
            }
            return rows
        }
        func lattice() -> (columns: Int, rows: Int, x0: Double, y0: Double) {
            let columns = count(right - left, step), rows = count(bottom - top, step)
            return (columns, rows, (width - Double(columns) * step) / 2, (height - Double(rows) * step) / 2)
        }
        switch pattern.style {
        case .lined:
            let rows = count(bottom - top, step)
            if rows >= 1 { for index in 1...rows { lines.append(Line(x0: left, y0: top + Double(index) * step, x1: right, y1: top + Double(index) * step, kind: .rule)) } }
            let x = left + Self.marginOffsetMM * Self.mm
            if pattern.margin && x < right { lines.append(Line(x0: x, y0: top, x1: x, y1: bottom, kind: .margin)) }
        case .grid:
            let l = lattice()
            guard l.columns > 0, l.rows > 0 else { return }
            for column in 0...l.columns {
                let x = l.x0 + Double(column) * step
                lines.append(Line(x0: x, y0: l.y0, x1: x, y1: l.y0 + Double(l.rows) * step, kind: .rule))
            }
            for row in 0...l.rows {
                let y = l.y0 + Double(row) * step
                lines.append(Line(x0: l.x0, y0: y, x1: l.x0 + Double(l.columns) * step, y1: y, kind: .rule))
            }
        case .dots:
            let l = lattice()
            for row in 0...l.rows { for column in 0...l.columns { dots.append(CGPoint(x: l.x0 + Double(column) * step, y: l.y0 + Double(row) * step)) } }
        case .isometric:
            let rowHeight = step * 3.0.squareRoot() / 2
            let columns = count(right - left, step), rows = count(bottom - top, rowHeight)
            let x0 = (width - Double(columns) * step) / 2, y0 = (height - Double(rows) * rowHeight) / 2
            for row in 0...rows {
                let odd = row % 2 == 1
                let shift = odd ? step / 2 : 0
                for column in 0..<(odd ? columns : columns + 1) {
                    dots.append(CGPoint(x: x0 + Double(column) * step + shift, y: y0 + Double(row) * rowHeight))
                }
            }
        case .handwriting:
            for (index, y) in banded(lines: 4, gap: 2 * step).enumerated() {
                lines.append(Line(x0: left, y0: y, x1: right, y1: y, kind: index % 4 == 1 || index % 4 == 2 ? .guide : .rule))
            }
        case .staff:
            for y in banded(lines: 5, gap: 6 * step) { lines.append(Line(x0: left, y0: y, x1: right, y1: y, kind: .rule)) }
        }
    }

    var isTooDense: Bool { lines.count + dots.count > Self.maxMarks }

    /// Parses `#rrggbb` into 0…1 components (fallback: the default blue-grey).
    static func rgb(_ hex: String) -> (r: CGFloat, g: CGFloat, b: CGFloat) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return (0.608, 0.706, 0.816) }
        return (CGFloat((value >> 16) & 0xff) / 255, CGFloat((value >> 8) & 0xff) / 255, CGFloat(value & 0xff) / 255)
    }

    /// Strokes the pattern into `context`, whose user space is the page with a top-left origin (y down).
    /// `scale` thickens hairlines in small previews.
    func draw(in context: CGContext, color: String, lineScale: CGFloat = 1) {
        let colour = Self.rgb(color)
        context.saveGState()
        context.setLineCap(.butt)
        func stroke(_ kind: LineKind, width: CGFloat, r: CGFloat, g: CGFloat, b: CGFloat, dashed: Bool = false) {
            let chosen = lines.filter { $0.kind == kind }
            guard !chosen.isEmpty else { return }
            context.beginPath()
            for line in chosen {
                context.move(to: CGPoint(x: line.x0, y: line.y0))
                context.addLine(to: CGPoint(x: line.x1, y: line.y1))
            }
            context.setStrokeColor(red: r, green: g, blue: b, alpha: 1)
            context.setLineWidth(width * lineScale)
            context.setLineDash(phase: 0, lengths: dashed ? [2 * lineScale, 2 * lineScale] : [])
            context.strokePath()
        }
        stroke(.rule, width: Self.ruleWidth, r: colour.r, g: colour.g, b: colour.b)
        stroke(.guide, width: Self.guideWidth, r: colour.r, g: colour.g, b: colour.b, dashed: true)
        stroke(.margin, width: Self.marginWidth, r: Self.marginColor.r, g: Self.marginColor.g, b: Self.marginColor.b)
        if !dots.isEmpty {
            context.setFillColor(red: colour.r, green: colour.g, blue: colour.b, alpha: 1)
            let radius = max(dotRadius, Double(lineScale) * 0.5)
            for dot in dots { context.addEllipse(in: CGRect(x: dot.x - radius, y: dot.y - radius, width: radius * 2, height: radius * 2)) }
            context.fillPath()
        }
        context.restoreGState()
    }
}
