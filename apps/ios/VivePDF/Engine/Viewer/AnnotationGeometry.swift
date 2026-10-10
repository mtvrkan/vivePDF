import CoreGraphics
import Foundation

/// Pure geometry behind the annotate tools: ink erasing (`inkErase.ts`), curved lines (`lineCurve.ts`)
/// and area hit tests (`markArea.ts`). Everything works in PDF page points.
enum AnnotationGeometry {
    typealias Stroke = [CGPoint]

    // MARK: - Ink eraser

    private static func lerp(_ from: CGPoint, _ to: CGPoint, _ t: CGFloat) -> CGPoint {
        CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
    }

    private static func isInside(_ point: CGPoint, _ center: CGPoint, _ radius: CGFloat) -> Bool {
        hypot(point.x - center.x, point.y - center.y) <= radius
    }

    /// Parameter span [enter, leave] of the segment that lies inside the eraser circle, if any.
    static func insideSpan(_ from: CGPoint, _ to: CGPoint, center: CGPoint, radius: CGFloat) -> (CGFloat, CGFloat)? {
        let dx = to.x - from.x, dy = to.y - from.y
        let fx = from.x - center.x, fy = from.y - center.y
        let a = dx * dx + dy * dy
        if a == 0 { return isInside(from, center, radius) ? (0, 1) : nil }
        let b = 2 * (fx * dx + fy * dy)
        let c = fx * fx + fy * fy - radius * radius
        let discriminant = b * b - 4 * a * c
        if discriminant <= 0 { return nil }
        let root = discriminant.squareRoot()
        let enter = max(0, (-b - root) / (2 * a))
        let leave = min(1, (-b + root) / (2 * a))
        return enter < leave ? (enter, leave) : nil
    }

    /// Cuts one stroke where the eraser circle touches it, returning the surviving runs (≥ 2 points each).
    static func eraseStroke(_ points: Stroke, center: CGPoint, radius: CGFloat) -> [Stroke] {
        if points.isEmpty { return [] }
        if points.count == 1 { return isInside(points[0], center, radius) ? [] : [points] }
        var runs: [Stroke] = []
        var run: Stroke = []
        func flush() {
            if run.count >= 2 { runs.append(run) }
            run = []
        }
        for index in 0..<(points.count - 1) {
            let from = points[index], to = points[index + 1]
            guard let (enter, leave) = insideSpan(from, to, center: center, radius: radius) else {
                if run.isEmpty { run.append(from) }
                run.append(to)
                continue
            }
            if enter > 0 {
                if run.isEmpty { run.append(from) }
                run.append(lerp(from, to, enter))
            }
            flush()
            if leave < 1 { run.append(contentsOf: [lerp(from, to, leave), to]) }
        }
        flush()
        return runs
    }

    static func eraseAt(_ strokes: [Stroke], center: CGPoint, radius: CGFloat) -> [Stroke] {
        strokes.flatMap { eraseStroke($0, center: center, radius: radius) }
    }

    /// Erases along a dragged path, sampling every half radius so fast swipes leave no gaps.
    static func eraseAlong(_ strokes: [Stroke], path: [CGPoint], radius: CGFloat) -> [Stroke] {
        guard let first = path.first else { return strokes }
        let step = max(radius / 2, 0.01)
        var result = eraseAt(strokes, center: first, radius: radius)
        for index in path.indices.dropFirst() {
            let from = path[index - 1], to = path[index]
            let samples = max(1, Int(ceil(hypot(to.x - from.x, to.y - from.y) / step)))
            for sample in 1...samples {
                result = eraseAt(result, center: lerp(from, to, CGFloat(sample) / CGFloat(samples)), radius: radius)
            }
        }
        return result
    }

    static func sameStrokes(_ a: [Stroke], _ b: [Stroke]) -> Bool { a == b }

    /// Bounding box of strokes padded by half the stroke width (nil when nothing is left).
    static func inkBounds(_ strokes: [Stroke], strokeWidth: CGFloat) -> CGRect? {
        let points = strokes.flatMap { $0 }
        guard !points.isEmpty else { return nil }
        return boundsOf(points, padding: strokeWidth / 2)
    }

    // MARK: - Curves

    static let curveSegments = 12
    static let minCurve: Double = -100
    static let maxCurve: Double = 100
    static let curveStep: Double = 5

    static func curveControlPoint(start: CGPoint, end: CGPoint, curve: Double) -> CGPoint {
        let mid = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
        let dx = end.x - start.x, dy = end.y - start.y
        let length = hypot(dx, dy)
        if length == 0 { return mid }
        let offset = CGFloat(curve / 100) * length
        return CGPoint(x: mid.x - (dy / length) * offset, y: mid.y + (dx / length) * offset)
    }

    /// Quadratic Bézier between the ends, flattened to `segments` pieces (a straight line for curve 0).
    static func curvedVertices(start: CGPoint, end: CGPoint, curve: Double, segments: Int = curveSegments) -> [CGPoint] {
        if curve == 0 { return [start, end] }
        let control = curveControlPoint(start: start, end: end, curve: curve)
        return (0...segments).map { step in
            let t = CGFloat(step) / CGFloat(segments), u = 1 - t
            return CGPoint(x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
                           y: u * u * start.y + 2 * u * t * control.y + t * t * end.y)
        }
    }

    /// Reads the curve amount back from flattened vertices (inverse of `curvedVertices`).
    static func curve(fromVertices vertices: [CGPoint]) -> Double {
        guard vertices.count >= 3, let start = vertices.first, let end = vertices.last else { return 0 }
        let middle = vertices[Int((Double(vertices.count - 1) / 2).rounded())]
        let dx = end.x - start.x, dy = end.y - start.y
        let length = hypot(dx, dy)
        if length == 0 { return 0 }
        let mid = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
        let offset = ((middle.x - mid.x) * (-dy / length) + (middle.y - mid.y) * (dx / length)) * 2
        return Double(offset / length * 100).rounded()
    }

    static func boundsOf(_ points: [CGPoint], padding: CGFloat = 0) -> CGRect {
        guard let first = points.first else { return .zero }
        var minX = first.x, minY = first.y, maxX = first.x, maxY = first.y
        for point in points {
            minX = min(minX, point.x); minY = min(minY, point.y)
            maxX = max(maxX, point.x); maxY = max(maxY, point.y)
        }
        return CGRect(x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2)
    }

    // MARK: - Area & resize

    /// Normalised rectangle between two drag points.
    static func area(from start: CGPoint, to end: CGPoint) -> CGRect {
        CGRect(x: min(start.x, end.x), y: min(start.y, end.y), width: abs(end.x - start.x), height: abs(end.y - start.y))
    }

    /// Affine map taking `old` onto `new` (used to scale ink paths, line ends and quads when resizing).
    static func transform(from old: CGRect, to new: CGRect) -> CGAffineTransform {
        let sx = old.width > 0 ? new.width / old.width : 1
        let sy = old.height > 0 ? new.height / old.height : 1
        return CGAffineTransform(translationX: new.minX, y: new.minY).scaledBy(x: sx, y: sy).translatedBy(x: -old.minX, y: -old.minY)
    }

    /// Resizes `rect` by dragging one of its eight handles (0 = bottom-left … counter-clockwise in PDF space),
    /// keeping a minimum size.
    static func resize(_ rect: CGRect, handle: ResizeHandle, by delta: CGVector, minimum: CGFloat = 6) -> CGRect {
        var minX = rect.minX, maxX = rect.maxX, minY = rect.minY, maxY = rect.maxY
        if handle.movesMinX { minX = min(minX + delta.dx, maxX - minimum) }
        if handle.movesMaxX { maxX = max(maxX + delta.dx, minX + minimum) }
        if handle.movesMinY { minY = min(minY + delta.dy, maxY - minimum) }
        if handle.movesMaxY { maxY = max(maxY + delta.dy, minY + minimum) }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    enum ResizeHandle: CaseIterable {
        case minXminY, midXminY, maxXminY, maxXmidY, maxXmaxY, midXmaxY, minXmaxY, minXmidY
        var movesMinX: Bool { [.minXminY, .minXmaxY, .minXmidY].contains(self) }
        var movesMaxX: Bool { [.maxXminY, .maxXmaxY, .maxXmidY].contains(self) }
        var movesMinY: Bool { [.minXminY, .midXminY, .maxXminY].contains(self) }
        var movesMaxY: Bool { [.minXmaxY, .midXmaxY, .maxXmaxY].contains(self) }

        func point(in rect: CGRect) -> CGPoint {
            let x: CGFloat = movesMinX ? rect.minX : movesMaxX ? rect.maxX : rect.midX
            let y: CGFloat = movesMinY ? rect.minY : movesMaxY ? rect.maxY : rect.midY
            return CGPoint(x: x, y: y)
        }
    }

    // MARK: - Squiggly

    /// Zig-zag points under a text line from `from` to `to` (squiggly underline), `amplitude` high.
    static func squiggle(from: CGPoint, to: CGPoint, amplitude: CGFloat) -> [CGPoint] {
        let length = hypot(to.x - from.x, to.y - from.y)
        guard length > 0 else { return [from] }
        let wave = max(amplitude * 2, 1)
        let steps = max(2, Int(length / wave))
        let ux = (to.x - from.x) / length, uy = (to.y - from.y) / length
        return (0...steps).map { index in
            let along = length * CGFloat(index) / CGFloat(steps)
            let off = index % 2 == 0 ? 0 : amplitude
            return CGPoint(x: from.x + ux * along - uy * off, y: from.y + uy * along + ux * off)
        }
    }
}
