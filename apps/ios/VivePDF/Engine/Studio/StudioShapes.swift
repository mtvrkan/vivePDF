import CoreGraphics
import Foundation

/// Port of `model/shapes.ts`: shape outlines as SVG path data (so vector elements stay byte-compatible
/// with the desktop) plus resolved fills/strokes for drawing.
enum StudioShapes {
    static let kappa = 0.5522847498

    typealias Point = (Double, Double)

    static func num(_ value: Double) -> String {
        let rounded = (value * 1000).rounded() / 1000
        if rounded == 0 { return "0" }
        if rounded == rounded.rounded() && abs(rounded) < 1e15 { return String(Int64(rounded)) }
        var s = String(rounded)
        if s.hasSuffix(".0") { s.removeLast(2) }
        return s
    }

    static func polygon(_ points: [Point]) -> String {
        points.enumerated().map { "\($0.offset == 0 ? "M" : "L")\(num($0.element.0)) \(num($0.element.1))" }.joined(separator: " ") + " Z"
    }

    private static func fitted(_ points: [Point], _ width: Double, _ height: Double) -> [Point] {
        let xs = points.map(\.0), ys = points.map(\.1)
        let left = xs.min() ?? 0, top = ys.min() ?? 0
        let spanX = ((xs.max() ?? 0) - left).nonZero, spanY = ((ys.max() ?? 0) - top).nonZero
        return points.map { (($0.0 - left) / spanX * width, ($0.1 - top) / spanY * height) }
    }

    private static func regular(_ sides: Int, _ start: Double) -> [Point] {
        (0..<sides).map { i in
            let angle = (start + 360 / Double(sides) * Double(i)) * .pi / 180
            return (cos(angle), sin(angle))
        }
    }

    private static func starPoints(_ points: Int, _ inner: Double) -> [Point] {
        let count = max(3, points)
        return (0..<(count * 2)).map { i in
            let radius = i % 2 == 1 ? inner : 1
            let angle = (-90 + 180 / Double(count) * Double(i)) * .pi / 180
            return (cos(angle) * radius, sin(angle) * radius)
        }
    }

    static func clampedCorners(_ width: Double, _ height: Double, _ radii: [Double]) -> [Double] {
        let limit = max(0, min(width, height) / 2)
        return (0..<4).map { i in max(0, min(i < radii.count && radii[i].isFinite ? radii[i] : 0, limit)) }
    }

    private static func corner(_ radius: Double, _ from: Point, _ control: Point, _ to: Point) -> [String] {
        guard radius > 0 else { return [] }
        let first = (from.0 + (control.0 - from.0) * kappa, from.1 + (control.1 - from.1) * kappa)
        let second = (to.0 + (control.0 - to.0) * kappa, to.1 + (control.1 - to.1) * kappa)
        return ["C\(num(first.0)) \(num(first.1)) \(num(second.0)) \(num(second.1)) \(num(to.0)) \(num(to.1))"]
    }

    static func cornerRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double, _ radii: [Double]) -> String {
        let c = clampedCorners(width, height, radii)
        let (tl, tr, br, bl) = (c[0], c[1], c[2], c[3])
        let right = x + width, bottom = y + height
        if tl <= 0 && tr <= 0 && br <= 0 && bl <= 0 { return polygon([(x, y), (right, y), (right, bottom), (x, bottom)]) }
        var parts = ["M\(num(x + tl)) \(num(y))", "L\(num(right - tr)) \(num(y))"]
        parts += corner(tr, (right - tr, y), (right, y), (right, y + tr))
        parts.append("L\(num(right)) \(num(bottom - br))")
        parts += corner(br, (right, bottom - br), (right, bottom), (right - br, bottom))
        parts.append("L\(num(x + bl)) \(num(bottom))")
        parts += corner(bl, (x + bl, bottom), (x, bottom), (x, bottom - bl))
        parts.append("L\(num(x)) \(num(y + tl))")
        parts += corner(tl, (x, y + tl), (x, y), (x + tl, y))
        parts.append("Z")
        return parts.joined(separator: " ")
    }

    static func roundedRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double, _ radius: Double) -> String {
        cornerRect(x, y, width, height, [radius, radius, radius, radius])
    }

    static func ellipse(_ cx: Double, _ cy: Double, _ rx: Double, _ ry: Double) -> String {
        let kx = rx * kappa, ky = ry * kappa
        return [
            "M\(num(cx)) \(num(cy - ry))",
            "C\(num(cx + kx)) \(num(cy - ry)) \(num(cx + rx)) \(num(cy - ky)) \(num(cx + rx)) \(num(cy))",
            "C\(num(cx + rx)) \(num(cy + ky)) \(num(cx + kx)) \(num(cy + ry)) \(num(cx)) \(num(cy + ry))",
            "C\(num(cx - kx)) \(num(cy + ry)) \(num(cx - rx)) \(num(cy + ky)) \(num(cx - rx)) \(num(cy))",
            "C\(num(cx - rx)) \(num(cy - ky)) \(num(cx - kx)) \(num(cy - ry)) \(num(cx)) \(num(cy - ry))",
            "Z",
        ].joined(separator: " ")
    }

    private static func heart(_ width: Double, _ height: Double) -> String {
        func x(_ v: Double) -> String { num(v / 100 * width) }
        func y(_ v: Double) -> String { num(v / 100 * height) }
        return [
            "M\(x(50)) \(y(100))",
            "C\(x(18)) \(y(76)) \(x(0)) \(y(56)) \(x(0)) \(y(30))",
            "C\(x(0)) \(y(12)) \(x(13)) \(y(0)) \(x(28)) \(y(0))",
            "C\(x(38)) \(y(0)) \(x(46)) \(y(6)) \(x(50)) \(y(15))",
            "C\(x(54)) \(y(6)) \(x(62)) \(y(0)) \(x(72)) \(y(0))",
            "C\(x(87)) \(y(0)) \(x(100)) \(y(12)) \(x(100)) \(y(30))",
            "C\(x(100)) \(y(56)) \(x(82)) \(y(76)) \(x(50)) \(y(100))",
            "Z",
        ].joined(separator: " ")
    }

    private static func speech(_ width: Double, _ height: Double, _ radius: Double) -> String {
        let body = height * 0.8
        let r = max(0, min(radius != 0 ? radius : min(width, body) * 0.15, width / 2, body / 2))
        let k = r * kappa
        return [
            "M\(num(r)) 0",
            "L\(num(width - r)) 0",
            "C\(num(width - r + k)) 0 \(num(width)) \(num(r - k)) \(num(width)) \(num(r))",
            "L\(num(width)) \(num(body - r))",
            "C\(num(width)) \(num(body - r + k)) \(num(width - r + k)) \(num(body)) \(num(width - r)) \(num(body))",
            "L\(num(width * 0.38)) \(num(body))",
            "L\(num(width * 0.18)) \(num(height))",
            "L\(num(width * 0.22)) \(num(body))",
            "L\(num(r)) \(num(body))",
            "C\(num(r - k)) \(num(body)) 0 \(num(body - r + k)) 0 \(num(body - r))",
            "L0 \(num(r))",
            "C0 \(num(r - k)) \(num(r - k)) 0 \(num(r)) 0",
            "Z",
        ].joined(separator: " ")
    }

    private typealias Circle = (Double, Double, Double)
    private static let cloudCircles: [Circle] = [(20, 40, 15), (36, 24, 17), (60, 18, 18), (80, 32, 15), (82, 47, 11), (60, 50, 12), (38, 50, 12)]

    private static func outerJoint(_ a: Circle, _ b: Circle, _ centre: Point) -> Point {
        let (x1, y1, r1) = a, (x2, y2, r2) = b
        let distance = hypot(x2 - x1, y2 - y1)
        let along = (distance * distance + r1 * r1 - r2 * r2) / (2 * distance)
        let reach = sqrt(max(0, r1 * r1 - along * along))
        let mid = (x1 + along * (x2 - x1) / distance, y1 + along * (y2 - y1) / distance)
        let offset = (-(y2 - y1) / distance * reach, (x2 - x1) / distance * reach)
        let candidates = [(mid.0 + offset.0, mid.1 + offset.1), (mid.0 - offset.0, mid.1 - offset.1)]
        return candidates.dropFirst().reduce(candidates[0]) { best, p in
            hypot(p.0 - centre.0, p.1 - centre.1) > hypot(best.0 - centre.0, best.1 - centre.1) ? p : best
        }
    }

    private static func arcCubics(_ c: Circle, _ from: Point, _ to: Point) -> [(Point, Point, Point, Point)] {
        let (x, y, r) = c
        let quarter = Double.pi / 2
        let start = atan2(from.1 - y, from.0 - x)
        var end = atan2(to.1 - y, to.0 - x)
        while end <= start { end += .pi * 2 }
        var cuts = [start]
        var step = Int(ceil(start / quarter + 1e-9))
        while Double(step) * quarter < end - 1e-9 { cuts.append(Double(step) * quarter); step += 1 }
        cuts.append(end)
        return (1..<cuts.count).map { i in
            let previous = cuts[i - 1], next = cuts[i]
            let handle = 4.0 / 3.0 * tan((next - previous) / 4) * r
            let first = (x + r * cos(previous), y + r * sin(previous))
            let last = (x + r * cos(next), y + r * sin(next))
            return (first, (first.0 - handle * sin(previous), first.1 + handle * cos(previous)), (last.0 + handle * sin(next), last.1 - handle * cos(next)), last)
        }
    }

    private static func cloud(_ width: Double, _ height: Double) -> String {
        let n = Double(cloudCircles.count)
        let centre = (cloudCircles.reduce(0) { $0 + $1.0 } / n, cloudCircles.reduce(0) { $0 + $1.1 } / n)
        let joints = cloudCircles.indices.map { outerJoint(cloudCircles[$0], cloudCircles[($0 + 1) % cloudCircles.count], centre) }
        let cubics = cloudCircles.indices.flatMap { arcCubics(cloudCircles[$0], joints[($0 + joints.count - 1) % joints.count], joints[$0]) }
        let ends = cubics.flatMap { [$0.0, $0.3] }
        let left = ends.map(\.0).min() ?? 0, top = ends.map(\.1).min() ?? 0
        let scaleX = width / ((ends.map(\.0).max() ?? 1) - left)
        let scaleY = height / ((ends.map(\.1).max() ?? 1) - top)
        func at(_ p: Point) -> String { "\(num(min(width, max(0, (p.0 - left) * scaleX)))) \(num(min(height, max(0, (p.1 - top) * scaleY))))" }
        return (["M\(at(cubics[0].0))"] + cubics.map { "C\(at($0.1)) \(at($0.2)) \(at($0.3))" } + ["Z"]).joined(separator: " ")
    }

    static func shapeD(_ shape: StudioShapeKind, _ w: Double, _ h: Double, cornerRadius: Double = 0, corners: [Double]? = nil, points: Int = 5, innerRatio: Double = 0.45) -> String {
        switch shape {
        case .rect: return corners.map { cornerRect(0, 0, w, h, $0) } ?? roundedRect(0, 0, w, h, cornerRadius)
        case .cloud: return cloud(w, h)
        case .ellipse: return ellipse(w / 2, h / 2, w / 2, h / 2)
        case .triangle: return polygon([(w / 2, 0), (w, h), (0, h)])
        case .rightTriangle: return polygon([(0, 0), (w, h), (0, h)])
        case .diamond: return polygon([(w / 2, 0), (w, h / 2), (w / 2, h), (0, h / 2)])
        case .pentagon: return polygon(fitted(regular(5, -90), w, h))
        case .hexagon: return polygon(fitted(regular(6, 0), w, h))
        case .octagon: return polygon(fitted(regular(8, 22.5), w, h))
        case .star, .burst: return polygon(fitted(starPoints(points, innerRatio), w, h))
        case .heart: return heart(w, h)
        case .arrow:
            let head = min(w * 0.45, h)
            return polygon([(0, h * 0.25), (w - head, h * 0.25), (w - head, 0), (w, h / 2), (w - head, h), (w - head, h * 0.75), (0, h * 0.75)])
        case .chevron:
            let depth = min(w * 0.4, h / 2)
            return polygon([(0, 0), (w - depth, 0), (w, h / 2), (w - depth, h), (0, h), (depth, h / 2)])
        case .parallelogram:
            let slant = min(w * 0.25, h * 0.6)
            return polygon([(slant, 0), (w, 0), (w - slant, h), (0, h)])
        case .trapezoid:
            let inset = w * 0.2
            return polygon([(inset, 0), (w - inset, 0), (w, h), (0, h)])
        case .cross:
            let tx = w / 3, ty = h / 3
            return polygon([(tx, 0), (2 * tx, 0), (2 * tx, ty), (w, ty), (w, 2 * ty), (2 * tx, 2 * ty), (2 * tx, h), (tx, h), (tx, 2 * ty), (0, 2 * ty), (0, ty), (tx, ty)])
        case .speech: return speech(w, h, cornerRadius)
        case .line, .arrowLine: return "M0 \(num(h / 2)) L\(num(w)) \(num(h / 2))"
        }
    }

    // MARK: Resolved paint

    enum RenderFill: Equatable {
        case solid(String)
        case linear(x1: Double, y1: Double, x2: Double, y2: Double, stops: [StudioGradientStop])
        case radial(cx: Double, cy: Double, r: Double, stops: [StudioGradientStop])
    }

    struct RenderStroke: Equatable {
        var color: String
        var width: Double
        var dash: [Double]
        var cap: StudioLineCap
        var join: StudioLineJoin
    }

    struct RenderPath: Equatable {
        var d: String
        var fill: RenderFill?
        var stroke: RenderStroke?
        var evenOdd = false
        var opacity = 1.0
    }

    static func linearGradientLine(_ angle: Double, _ width: Double, _ height: Double) -> (Double, Double, Double, Double) {
        let radians = angle * .pi / 180
        let dx = sin(radians), dy = -cos(radians)
        let length = abs(width * dx) + abs(height * dy)
        let cx = width / 2, cy = height / 2
        return (cx - dx * length / 2, cy - dy * length / 2, cx + dx * length / 2, cy + dy * length / 2)
    }

    static func sortedStops(_ stops: [StudioGradientStop]) -> [StudioGradientStop] {
        stops.enumerated().sorted { $0.element.offset != $1.element.offset ? $0.element.offset < $1.element.offset : $0.offset < $1.offset }.map(\.element)
    }

    static func renderFill(_ fill: StudioFill, _ width: Double, _ height: Double) -> RenderFill? {
        switch fill {
        case .none: return nil
        case .solid(let c): return .solid(c)
        case .linear(let angle, let stops):
            let (x1, y1, x2, y2) = linearGradientLine(angle, width, height)
            return .linear(x1: x1, y1: y1, x2: x2, y2: y2, stops: sortedStops(stops))
        case .radial(let stops, let cx, let cy, let radius):
            let r = hypot(width, height) / 2 * (radius ?? 1)
            return .radial(cx: width * (cx ?? 0.5), cy: height * (cy ?? 0.5), r: min(20000, max(0.01, r)), stops: sortedStops(stops))
        }
    }

    static func strokeCap(_ stroke: StudioStroke) -> StudioLineCap { stroke.cap ?? (stroke.dash == .dotted ? .round : .butt) }
    static func strokeJoin(_ stroke: StudioStroke) -> StudioLineJoin { stroke.join ?? (stroke.dash == .dotted ? .round : .miter) }

    private enum DashPiece { case on(Double), dot, off(Double) }

    private static func pattern(_ dash: StudioDash) -> [DashPiece] {
        switch dash {
        case .solid: []
        case .dashed: [.on(3), .off(2)]
        case .dotted: [.dot, .off(1)]
        case .longDash: [.on(7), .off(3)]
        case .dashDot: [.on(4), .off(2), .dot, .off(2)]
        }
    }

    static func dashArray(_ stroke: StudioStroke, _ cap: StudioLineCap) -> [Double] {
        guard stroke.dash != .solid else { return [] }
        let unit = stroke.width
        let capLength = cap == .butt ? 0 : unit
        let gap = stroke.gap ?? 1
        func length(_ v: Double) -> Double { min(2000, max(0, v)) }
        return pattern(stroke.dash).map {
            switch $0 {
            case .dot: capLength != 0 ? 0 : length(unit)
            case .on(let v): length(v * unit - capLength)
            case .off(let v): length(v * unit * gap + capLength)
            }
        }
    }

    static func renderStroke(_ stroke: StudioStroke?) -> RenderStroke? {
        guard let stroke, stroke.width > 0 else { return nil }
        let cap = strokeCap(stroke)
        return RenderStroke(color: stroke.color, width: stroke.width, dash: dashArray(stroke, cap), cap: cap, join: strokeJoin(stroke))
    }

    // MARK: Arrowheads / lines

    static func arrowheadLength(_ strokeWidth: Double, _ size: Double, _ available: Double) -> Double {
        max(0, min(available, max(strokeWidth * 3.5, 6) * size))
    }

    static func arrowhead(_ kind: StudioArrowhead, tipX: Double, mid: Double, direction: Double, length: Double, stroke: RenderStroke) -> (paths: [RenderPath], inset: Double) {
        func back(_ distance: Double, _ across: Double = 0) -> Point { (tipX - direction * distance, mid + across) }
        func at(_ p: Point) -> String { "\(num(p.0)) \(num(p.1))" }
        func solid(_ d: String) -> RenderPath { RenderPath(d: d, fill: .solid(stroke.color), stroke: nil) }
        let half = length / 2
        switch kind {
        case .none: return ([], 0)
        case .arrow: return ([solid(polygon([back(0), back(length, -half), back(length * 0.75), back(length, half)]))], length * 0.6)
        case .openArrow:
            let offset = stroke.width / 2 * (1 / sin(atan(0.5)))
            var s = stroke
            s.dash = []
            s.join = .miter
            return ([RenderPath(d: "M\(at(back(length + offset, -half))) L\(at(back(offset))) L\(at(back(length + offset, half)))", fill: nil, stroke: s)], offset)
        case .triangle: return ([solid(polygon([back(0), back(length, -half), back(length, half)]))], length * 0.8)
        case .circle: return ([solid(ellipse(tipX, mid, length * 0.4, length * 0.4))], 0)
        case .square:
            let side = length * 0.4
            return ([solid(polygon([(tipX - side, mid - side), (tipX + side, mid - side), (tipX + side, mid + side), (tipX - side, mid + side)]))], 0)
        case .bar:
            let t = max(stroke.width, 1) / 2
            return ([solid(polygon([(tipX - t, mid - half), (tipX + t, mid - half), (tipX + t, mid + half), (tipX - t, mid + half)]))], 0)
        }
    }

    static func linePaths(_ shape: StudioShape, width: Double, height: Double) -> [RenderPath] {
        guard let stroke = renderStroke(shape.stroke) else { return [] }
        let mid = height / 2
        let both = shape.startArrow != .none && shape.endArrow != .none
        let length = arrowheadLength(stroke.width, shape.arrowSize, both ? width / 2 : width)
        let start = arrowhead(shape.startArrow, tipX: 0, mid: mid, direction: -1, length: length, stroke: stroke)
        let end = arrowhead(shape.endArrow, tipX: width, mid: mid, direction: 1, length: length, stroke: stroke)
        let from = start.inset
        let to = max(from, width - end.inset)
        return [RenderPath(d: "M\(num(from)) \(num(mid)) L\(num(to)) \(num(mid))", fill: nil, stroke: stroke)] + start.paths + end.paths
    }

    static func shapePaths(_ shape: StudioShape, width: Double, height: Double) -> [RenderPath] {
        if shape.shape.isLine { return linePaths(shape, width: width, height: height) }
        let d = shapeD(shape.shape, width, height, cornerRadius: shape.cornerRadius, corners: shape.corners, points: shape.points, innerRatio: shape.innerRatio)
        let fill = renderFill(shape.fill, width, height)
        let stroke = renderStroke(shape.stroke)
        if fill == nil && stroke == nil { return [] }
        return [RenderPath(d: d, fill: fill, stroke: stroke)]
    }
}

private extension Double {
    var nonZero: Double { self == 0 ? 1 : self }
}
