import CoreGraphics
import Foundation

/// SVG path data → absolute M/L/C/Q/Z segments (port of `model/svgPath.ts`) and Core Graphics paths.
enum StudioPath {
    enum Segment: Equatable {
        case move(CGPoint)
        case line(CGPoint)
        case cubic(CGPoint, CGPoint, CGPoint)
        case quad(CGPoint, CGPoint)
        case close
    }

    private struct Scanner {
        let bytes: [UInt8]
        var index = 0

        init(_ text: String) { bytes = Array(text.utf8) }

        mutating func skip() {
            while index < bytes.count, bytes[index] == 32 || bytes[index] == 44 || bytes[index] == 9 || bytes[index] == 10 || bytes[index] == 13 || bytes[index] == 12 { index += 1 }
        }

        mutating func done() -> Bool { skip(); return index >= bytes.count }

        mutating func command() -> UInt8? {
            skip()
            guard index < bytes.count else { return nil }
            let c = bytes[index]
            if "MmLlHhVvCcSsQqTtAaZz".utf8.contains(c) { index += 1; return c }
            return nil
        }

        mutating func number() throws -> Double {
            skip()
            let start = index
            if index < bytes.count, bytes[index] == 43 || bytes[index] == 45 { index += 1 }
            var digits = false
            while index < bytes.count, (48...57).contains(bytes[index]) { index += 1; digits = true }
            if index < bytes.count, bytes[index] == 46 {
                index += 1
                while index < bytes.count, (48...57).contains(bytes[index]) { index += 1; digits = true }
            }
            guard digits else { index = start; throw StudioPathError.malformed }
            if index < bytes.count, bytes[index] == 101 || bytes[index] == 69 {
                let mark = index
                index += 1
                if index < bytes.count, bytes[index] == 43 || bytes[index] == 45 { index += 1 }
                var exp = false
                while index < bytes.count, (48...57).contains(bytes[index]) { index += 1; exp = true }
                if !exp { index = mark }
            }
            guard let value = Double(String(decoding: bytes[start..<index], as: UTF8.self)) else { throw StudioPathError.malformed }
            return value
        }

        mutating func flag() throws -> Double {
            skip()
            guard index < bytes.count, bytes[index] == 48 || bytes[index] == 49 else { throw StudioPathError.malformed }
            index += 1
            return bytes[index - 1] == 49 ? 1 : 0
        }
    }

    enum StudioPathError: Error { case malformed }

    private static let argumentCount: [UInt8: Int] = [77: 2, 76: 2, 72: 1, 86: 1, 67: 6, 83: 4, 81: 4, 84: 2, 65: 7, 90: 0]

    static func arcToCubics(_ from: CGPoint, _ rxIn: Double, _ ryIn: Double, _ angleDegrees: Double, _ large: Double, _ sweep: Double, _ to: CGPoint) -> [(CGPoint, CGPoint, CGPoint)] {
        var rx = abs(rxIn), ry = abs(ryIn)
        if from == to || rx == 0 || ry == 0 { return [] }
        let phi = angleDegrees * .pi / 180
        let c = cos(phi), s = sin(phi)
        let dx = (from.x - to.x) / 2, dy = (from.y - to.y) / 2
        let x1 = c * dx + s * dy, y1 = -s * dx + c * dy
        let lambda = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
        let factor = (large == sweep ? -1.0 : 1.0) * sqrt(max(0, numerator / denominator))
        let cxp = factor * rx * y1 / ry, cyp = -factor * ry * x1 / rx
        let cx = c * cxp - s * cyp + (from.x + to.x) / 2
        let cy = s * cxp + c * cyp + (from.y + to.y) / 2
        func angle(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double { atan2(ux * vy - uy * vx, ux * vx + uy * vy) }
        let sx = (x1 - cxp) / rx, sy = (y1 - cyp) / ry
        let start = angle(1, 0, sx, sy)
        var delta = angle(sx, sy, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
        if sweep == 0 && delta > 0 { delta -= 2 * .pi }
        if sweep != 0 && delta < 0 { delta += 2 * .pi }
        let count = max(1, Int(ceil(abs(delta) / (.pi / 2) - 1e-9)))
        let step = delta / Double(count)
        let k = 4.0 / 3.0 * tan(step / 4)
        func point(_ theta: Double) -> CGPoint {
            let ex = cos(theta) * rx, ey = sin(theta) * ry
            return CGPoint(x: c * ex - s * ey + cx, y: s * ex + c * ey + cy)
        }
        func derivative(_ theta: Double) -> CGPoint {
            let ex = -sin(theta) * rx * k, ey = cos(theta) * ry * k
            return CGPoint(x: c * ex - s * ey, y: s * ex + c * ey)
        }
        return (0..<count).map { i in
            let a = start + step * Double(i), b = a + step
            let p0 = point(a)
            let p3 = i == count - 1 ? to : point(b)
            let d0 = derivative(a), d3 = derivative(b)
            return (CGPoint(x: p0.x + d0.x, y: p0.y + d0.y), CGPoint(x: p3.x - d3.x, y: p3.y - d3.y), p3)
        }
    }

    /// Parses path data into absolute segments. Throws on malformed data (like the desktop).
    static func segments(_ data: String) throws -> [Segment] {
        var scanner = Scanner(data)
        var out: [Segment] = []
        var current = CGPoint.zero, start = CGPoint.zero
        var lastCubic: CGPoint?, lastQuad: CGPoint?
        var command: UInt8?
        while !scanner.done() {
            if let next = scanner.command() { command = next } else if command == nil || command == 90 || command == 122 { throw StudioPathError.malformed }
            guard let cmd = command else { break }
            let upper = cmd >= 97 ? cmd - 32 : cmd
            let relative = cmd != upper
            func base(_ p: CGPoint) -> CGPoint { relative ? CGPoint(x: p.x + current.x, y: p.y + current.y) : p }
            if upper == 90 {
                if !out.isEmpty { out.append(.close) }
                current = start
                lastCubic = nil; lastQuad = nil
                continue
            }
            if out.isEmpty && upper != 77 { throw StudioPathError.malformed }
            var values: [Double] = []
            if upper == 65 {
                values = [try scanner.number(), try scanner.number(), try scanner.number(), try scanner.flag(), try scanner.flag(), try scanner.number(), try scanner.number()]
            } else {
                for _ in 0..<(argumentCount[upper] ?? 0) { values.append(try scanner.number()) }
            }
            var cubic: CGPoint?, quad: CGPoint?
            switch upper {
            case 77:
                current = base(CGPoint(x: values[0], y: values[1]))
                start = current
                out.append(.move(current))
                command = relative ? 108 : 76
            case 76:
                current = base(CGPoint(x: values[0], y: values[1]))
                out.append(.line(current))
            case 72:
                current = CGPoint(x: relative ? current.x + values[0] : values[0], y: current.y)
                out.append(.line(current))
            case 86:
                current = CGPoint(x: current.x, y: relative ? current.y + values[0] : values[0])
                out.append(.line(current))
            case 67, 83:
                let first: CGPoint = upper == 67 ? base(CGPoint(x: values[0], y: values[1])) : lastCubic.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let rest = upper == 67 ? Array(values.dropFirst(2)) : values
                let second = base(CGPoint(x: rest[0], y: rest[1]))
                let end = base(CGPoint(x: rest[2], y: rest[3]))
                out.append(.cubic(first, second, end))
                cubic = second
                current = end
            case 81, 84:
                let control: CGPoint = upper == 81 ? base(CGPoint(x: values[0], y: values[1])) : lastQuad.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let end = upper == 81 ? base(CGPoint(x: values[2], y: values[3])) : base(CGPoint(x: values[0], y: values[1]))
                out.append(.quad(control, end))
                quad = control
                current = end
            case 65:
                let end = base(CGPoint(x: values[5], y: values[6]))
                let curves = arcToCubics(current, values[0], values[1], values[2], values[3], values[4], end)
                if curves.isEmpty && end != current { out.append(.line(end)) }
                for (c1, c2, p) in curves { out.append(.cubic(c1, c2, p)) }
                current = end
            default: break
            }
            lastCubic = cubic
            lastQuad = quad
        }
        return out
    }

    static func string(_ segments: [Segment]) -> String {
        func p(_ point: CGPoint) -> String { "\(StudioShapes.num(point.x)) \(StudioShapes.num(point.y))" }
        return segments.map {
            switch $0 {
            case .move(let a): "M\(p(a))"
            case .line(let a): "L\(p(a))"
            case .cubic(let a, let b, let c): "C\(p(a)) \(p(b)) \(p(c))"
            case .quad(let a, let b): "Q\(p(a)) \(p(b))"
            case .close: "Z"
            }
        }.joined(separator: " ")
    }

    /// `normalizePathData`: absolute, arc-free path data in desktop number formatting.
    static func normalize(_ data: String) throws -> String { string(try segments(data)) }

    private static let cache = NSCache<NSString, CGPath>()

    /// Core Graphics path for path data (cached; malformed data draws what parsed before the error).
    static func cgPath(_ data: String) -> CGPath {
        if let hit = cache.object(forKey: data as NSString) { return hit }
        let path = CGMutablePath()
        let list = (try? segments(data)) ?? partialSegments(data)
        var open = false
        for segment in list {
            switch segment {
            case .move(let p): path.move(to: p); open = true
            case .line(let p): if open { path.addLine(to: p) }
            case .cubic(let a, let b, let c): if open { path.addCurve(to: c, control1: a, control2: b) }
            case .quad(let a, let b): if open { path.addQuadCurve(to: b, control: a) }
            case .close: if open { path.closeSubpath() }
            }
        }
        cache.setObject(path, forKey: data as NSString)
        return path
    }

    private static func partialSegments(_ data: String) -> [Segment] {
        // Browsers render a path up to its first error; do the same.
        var end = data.endIndex
        while end > data.startIndex {
            end = data.index(before: end)
            if let list = try? segments(String(data[..<end])) { return list }
        }
        return []
    }

    // MARK: SVG primitives (icons)

    static func ellipticRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double, _ rxIn: Double, _ ryIn: Double) -> String {
        let num = StudioShapes.num
        let rx = max(0, min(rxIn, width / 2)), ry = max(0, min(ryIn, height / 2))
        let right = x + width, bottom = y + height
        if rx <= 0 || ry <= 0 { return "M\(num(x)) \(num(y)) L\(num(right)) \(num(y)) L\(num(right)) \(num(bottom)) L\(num(x)) \(num(bottom)) Z" }
        let kx = rx * StudioShapes.kappa, ky = ry * StudioShapes.kappa
        return [
            "M\(num(x + rx)) \(num(y))",
            "L\(num(right - rx)) \(num(y))",
            "C\(num(right - rx + kx)) \(num(y)) \(num(right)) \(num(y + ry - ky)) \(num(right)) \(num(y + ry))",
            "L\(num(right)) \(num(bottom - ry))",
            "C\(num(right)) \(num(bottom - ry + ky)) \(num(right - rx + kx)) \(num(bottom)) \(num(right - rx)) \(num(bottom))",
            "L\(num(x + rx)) \(num(bottom))",
            "C\(num(x + rx - kx)) \(num(bottom)) \(num(x)) \(num(bottom - ry + ky)) \(num(x)) \(num(bottom - ry))",
            "L\(num(x)) \(num(y + ry))",
            "C\(num(x)) \(num(y + ry - ky)) \(num(x + rx - kx)) \(num(y)) \(num(x + rx)) \(num(y))",
            "Z",
        ].joined(separator: " ")
    }

    private static func attribute(_ attrs: [String: String], _ name: String, _ fallback: Double = 0) -> Double {
        guard let raw = attrs[name] else { return fallback }
        let scanner = Foundation.Scanner(string: raw)
        return scanner.scanDouble() ?? fallback
    }

    private static func pointList(_ value: String?) -> [CGPoint] {
        guard let value else { return [] }
        var numbers: [Double] = []
        let regex = try? NSRegularExpression(pattern: "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?")
        let ns = value as NSString
        regex?.enumerateMatches(in: value, range: NSRange(location: 0, length: ns.length)) { match, _, _ in
            if let match, let d = Double(ns.substring(with: match.range)) { numbers.append(d) }
        }
        return stride(from: 0, to: numbers.count - 1, by: 2).map { CGPoint(x: numbers[$0], y: numbers[$0 + 1]) }
    }

    /// `primitivePath`: one SVG shape element as path data.
    static func primitive(_ tag: String, _ attrs: [String: String]) -> String {
        let num = StudioShapes.num
        switch tag {
        case "path": return (try? normalize(attrs["d"] ?? "")) ?? ""
        case "circle":
            let r = attribute(attrs, "r")
            return r > 0 ? StudioShapes.ellipse(attribute(attrs, "cx"), attribute(attrs, "cy"), r, r) : ""
        case "ellipse":
            let rx = attribute(attrs, "rx"), ry = attribute(attrs, "ry")
            return rx > 0 && ry > 0 ? StudioShapes.ellipse(attribute(attrs, "cx"), attribute(attrs, "cy"), rx, ry) : ""
        case "rect":
            let w = attribute(attrs, "width"), h = attribute(attrs, "height")
            guard w > 0, h > 0 else { return "" }
            let rx = attrs["rx"] != nil ? attribute(attrs, "rx") : attribute(attrs, "ry")
            let ry = attrs["ry"] != nil ? attribute(attrs, "ry") : rx
            return ellipticRect(attribute(attrs, "x"), attribute(attrs, "y"), w, h, rx, ry)
        case "line":
            return "M\(num(attribute(attrs, "x1"))) \(num(attribute(attrs, "y1"))) L\(num(attribute(attrs, "x2"))) \(num(attribute(attrs, "y2")))"
        case "polyline", "polygon":
            let points = pointList(attrs["points"])
            guard points.count >= 2 else { return "" }
            let line = points.enumerated().map { "\($0.offset == 0 ? "M" : "L")\(num($0.element.x)) \(num($0.element.y))" }.joined(separator: " ")
            return tag == "polygon" ? line + " Z" : line
        default: return ""
        }
    }
}
