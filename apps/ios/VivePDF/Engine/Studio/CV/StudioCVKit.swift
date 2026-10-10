import Foundation

/// The pieces of `templates/kit.ts`, `ornaments/*` and `cv/cvIcons.ts` the CV layouts are built from,
/// kept local so CV pages are identical to the desktop's element for element.
enum StudioCVKit {
    enum Font {
        static let inter = "library:inter"
        static let montserrat = "library:montserrat"
        static let poppins = "library:poppins"
        static let raleway = "library:raleway"
        static let nunito = "library:nunito"
        static let josefin = "library:josefin-sans"
        static let oswald = "library:oswald"
        static let lora = "library:lora"
        static let baskerville = "library:libre-baskerville"
        static let cormorant = "library:cormorant-garamond"
        static let garamond = "library:eb-garamond"
        static let sourceSerif = "library:source-serif-4"
        static let playfair = "library:playfair-display"
    }

    struct TextOptions {
        var font: String? = nil
        var size: Double = 14
        var color = "#1f2937"
        var bold = false
        var italic = false
        var align: StudioTextAlign = .left
        var valign: StudioVerticalAlign = .top
        var spacing: Double = 0
        var upper = false
        var lineHeight: Double = 1.3
        var shrink = false
        var rotation: Double = 0
    }

    /// `kit.text`: grows a box whose lines need more room, keeping middle/bottom anchored text in place.
    static func text(_ x: Double, _ y: Double, _ width: Double, _ height: Double, _ value: String, _ o: TextOptions) -> StudioElement {
        let lines = Double(value.components(separatedBy: "\n").count)
        let extra = ceil(lines * o.size * o.lineHeight) - height
        var top = y, boxHeight = height
        if extra > 0 && !(o.valign == .top && o.rotation != 0) {
            top = o.valign == .middle ? y - extra / 2 : o.valign == .bottom ? y - extra : y
            boxHeight = height + extra
        }
        var element = StudioFactory.text(x: x, y: top, width: width, height: boxHeight, text: value) { t in
            t.fontId = o.font ?? Font.inter
            t.fontSize = o.size
            t.color = o.color
            t.bold = o.bold
            t.italic = o.italic
            t.align = o.align
            t.verticalAlign = o.valign
            t.letterSpacing = ((o.spacing / o.size) * 1000).rounded() / 1000
            t.textCase = o.upper ? .upper : .none
            t.lineHeight = o.lineHeight
            t.autoSize = o.shrink ? .shrink : .fixed
        }
        element.rotation = o.rotation
        return element
    }

    static func solid(_ color: String) -> StudioFill { .solid(color) }

    static func linear(_ angle: Double, _ from: String, _ to: String) -> StudioFill {
        .linear(angle: angle, stops: [StudioGradientStop(offset: 0, color: from), StudioGradientStop(offset: 1, color: to)])
    }

    static func gradient(_ angle: Double, _ colors: [String]) -> StudioFill {
        let last = Double(max(1, colors.count - 1))
        return .linear(angle: angle, stops: colors.enumerated().map { StudioGradientStop(offset: ((Double($0.offset) / last) * 1000).rounded() / 1000, color: $0.element) })
    }

    static let goldFoil = ["#7a5a1c", "#c9a24a", "#f6e3a1", "#d4af5a", "#8a6a24"]

    static func foilGold(_ angle: Double = 120) -> StudioFill { gradient(angle, goldFoil) }

    static func box(_ kind: StudioShapeKind, _ x: Double, _ y: Double, _ width: Double, _ height: Double, _ fill: StudioFill, stroke: StudioStroke? = nil, radius: Double = 0) -> StudioElement {
        var element = StudioFactory.shape(kind, x: x, y: y, width: width, height: height)
        if var s = element.shape {
            s.fill = fill
            s.stroke = stroke
            s.cornerRadius = radius
            element.content = .shape(s)
        }
        return element
    }

    static func rule(_ x: Double, _ y: Double, _ width: Double, _ color: String, _ weight: Double = 1) -> StudioElement {
        var element = StudioFactory.shape(.line, x: x, y: y - 4, width: width, height: 8)
        if var s = element.shape {
            s.fill = .none
            s.stroke = StudioStroke(color: color, width: weight)
            element.content = .shape(s)
        }
        return element
    }

    static func photo(_ x: Double, _ y: Double, _ width: Double, _ height: Double, mask: StudioImageMask) -> StudioElement {
        var element = StudioFactory.image(src: "", x: x, y: y, width: width, height: height)
        if var image = element.image {
            image.mask = mask
            image.cornerRadius = mask == .rounded ? 12 : 0
            element.content = .image(image)
        }
        return element
    }

    static func photoSlot(_ x: Double, _ y: Double, _ width: Double, _ height: Double, _ backing: String, mask: StudioImageMask) -> [StudioElement] {
        let shape = mask == .circle ? box(.ellipse, x, y, width, height, solid(backing)) : box(.rect, x, y, width, height, solid(backing), radius: mask == .rounded ? 12 : 0)
        return [shape, photo(x, y, width, height, mask: mask)]
    }

    /// `mix`: linear blend of two hex colours.
    static func mix(_ from: String, _ to: String, _ amount: Double) -> String {
        let a = StudioColor.rgb255(from), b = StudioColor.rgb255(to)
        func blend(_ x: Int, _ y: Int) -> String { String(format: "%02x", Int((Double(x) + Double(y - x) * amount).rounded())) }
        return "#" + blend(a.0, b.0) + blend(a.1, b.1) + blend(a.2, b.2)
    }

    // MARK: Ornaments used by the CV designs (`ornaments/*.ts`)

    struct Art { var viewWidth: Double; var viewHeight: Double; var paths: [StudioVectorPath] }
    typealias Point = (Double, Double)

    private enum Op { case move(Point), line(Point), cubic(Point, Point, Point), close }

    private static func d(_ ops: [Op]) -> String {
        let n = StudioShapes.num
        return ops.map { op -> String in
            switch op {
            case .move(let p): "M\(n(p.0)) \(n(p.1))"
            case .line(let p): "L\(n(p.0)) \(n(p.1))"
            case .cubic(let a, let b, let c): "C\(n(a.0)) \(n(a.1)) \(n(b.0)) \(n(b.1)) \(n(c.0)) \(n(c.1))"
            case .close: "Z"
            }
        }.joined(separator: " ")
    }

    private static func path(_ ops: [Op], _ fill: StudioFill, _ stroke: StudioStroke? = nil, opacity: Double = 1) -> StudioVectorPath {
        StudioVectorPath(d: d(ops), fill: fill, stroke: stroke, evenOdd: false, opacity: opacity)
    }

    private static func line(_ color: String, _ width: Double) -> StudioStroke { StudioStroke(color: color, width: width) }

    private static func polyline(_ points: [Point], closed: Bool = false) -> [Op] {
        var ops = points.enumerated().map { $0.offset == 0 ? Op.move($0.element) : Op.line($0.element) }
        if closed { ops.append(.close) }
        return ops
    }

    private static func smooth(_ points: [Point], closed: Bool = false, tension: Double = 1) -> [Op] {
        if points.count < 3 { return polyline(points, closed: closed) }
        let count = points.count
        func at(_ i: Int) -> Point { closed ? points[((i % count) + count) % count] : points[max(0, min(count - 1, i))] }
        var ops: [Op] = [.move(points[0])]
        let last = closed ? count : count - 1
        for i in 0..<last {
            let p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
            let c1 = (p1.0 + (p2.0 - p0.0) / 6 * tension, p1.1 + (p2.1 - p0.1) / 6 * tension)
            let c2 = (p2.0 - (p3.0 - p1.0) / 6 * tension, p2.1 - (p3.1 - p1.1) / 6 * tension)
            ops.append(.cubic(c1, c2, p2))
        }
        if closed { ops.append(.close) }
        return ops
    }

    private static func circle(_ cx: Double, _ cy: Double, _ r: Double) -> [Op] {
        let k = r * StudioShapes.kappa
        return [
            .move((cx + r, cy)),
            .cubic((cx + r, cy + k), (cx + k, cy + r), (cx, cy + r)),
            .cubic((cx - k, cy + r), (cx - r, cy + k), (cx - r, cy)),
            .cubic((cx - r, cy - k), (cx - k, cy - r), (cx, cy - r)),
            .cubic((cx + k, cy - r), (cx + r, cy - k), (cx + r, cy)),
            .close,
        ]
    }

    private static func polar(_ cx: Double, _ cy: Double, _ r: Double, _ angle: Double) -> Point { (cx + r * cos(angle), cy + r * sin(angle)) }

    private static func mirrored(_ ops: [Op], _ width: Double, _ height: Double, horizontal: Bool, vertical: Bool) -> [Op] {
        func map(_ p: Point) -> Point { (horizontal ? width - p.0 : p.0, vertical ? height - p.1 : p.1) }
        return ops.map {
            switch $0 {
            case .move(let p): .move(map(p))
            case .line(let p): .line(map(p))
            case .cubic(let a, let b, let c): .cubic(map(a), map(b), map(c))
            case .close: .close
            }
        }
    }

    /// The desktop's xorshift32 `seeded` generator (same sequence, so shapes match).
    private struct Seeded {
        var state: UInt32
        init(_ seed: UInt32) { state = seed == 0 ? 1 : seed }
        mutating func next() -> Double {
            state ^= state << 13
            state ^= state >> 17
            state ^= state << 5
            return Double(state) / 4294967296
        }
    }

    private static func lighter(_ color: String, _ amount: Double = 0.35) -> String { mix(color, "#ffffff", amount) }

    private static func flourishDivider(_ primary: String, _ secondary: String) -> Art {
        let right: [Point] = [(150, 20), (166, 10), (186, 9), (198, 18), (194, 29), (182, 30), (178, 22), (186, 18)]
        let tail: [Point] = [(190, 24), (230, 21), (270, 20), (298, 20)]
        let half = smooth(right) + smooth(tail)
        return Art(viewWidth: 300, viewHeight: 40, paths: [path(half + mirrored(half, 300, 0, horizontal: true, vertical: false), .none, line(primary, 1.3)), path(circle(150, 20, 3.4), .solid(secondary))])
    }

    private static func blob(_ primary: String, _ secondary: String) -> Art {
        var random = Seeded(3)
        let points: [Point] = (0..<9).map { i in polar(100, 100, 70 + random.next() * 26, Double(i) / 9 * .pi * 2) }
        return Art(viewWidth: 200, viewHeight: 200, paths: [path(smooth(points, closed: true), .linear(angle: 45, stops: [StudioGradientStop(offset: 0, color: primary), StudioGradientStop(offset: 1, color: secondary)]))])
    }

    private static func halftone(_ primary: String, _ secondary: String, _ width: Double, _ height: Double) -> Art {
        let step = max(min(width, height) / 34, sqrt(width * height / 1100))
        var main: [Op] = [], echo: [Op] = []
        let far = hypot(width, height)
        var row = 0
        while step / 2 + Double(row) * step * 0.866 <= height - step / 2 {
            let y = step / 2 + Double(row) * step * 0.866
            var x = step / 2 + (row % 2 == 1 ? step / 2 : 0)
            while x <= width - step / 2 {
                let big = step * 0.46 * (1 - hypot(width - x, height - y) / (far * 0.72))
                if big > step * 0.05 { main += circle(x, y, big) }
                let small = step * 0.36 * (1 - hypot(x, y) / (far * 0.32))
                if small > step * 0.05 { echo += circle(x, y, small) }
                x += step
            }
            row += 1
        }
        return Art(viewWidth: width, viewHeight: height, paths: [path(main, .solid(primary), opacity: 0.18), path(echo, .solid(secondary), opacity: 0.24)])
    }

    private static func diagonalHatch(_ primary: String, _ secondary: String, _ width: Double, _ height: Double) -> Art {
        let step = min(width, height) / 42
        var fine: [Op] = [], bold: [Op] = []
        var index = 0
        var c = -height + step
        while c < width {
            let from = max(0, c), to = min(width, c + height)
            if to - from > 0.5 {
                let ops: [Op] = [.move((from, from - c)), .line((to, to - c))]
                if index % 6 == 0 { bold += ops } else { fine += ops }
            }
            index += 1
            c += step
        }
        return Art(viewWidth: width, viewHeight: height, paths: [path(fine, .none, line(primary, 0.5), opacity: 0.28), path(bold, .none, line(secondary, 1.2), opacity: 0.4)])
    }

    private static func clippedRuns(_ points: [Point], _ width: Double, _ height: Double) -> [Op] {
        var ops: [Op] = []
        var drawing = false
        for p in points {
            guard p.0 >= 0, p.0 <= width, p.1 >= 0, p.1 <= height else { drawing = false; continue }
            ops.append(drawing ? .line(p) : .move(p))
            drawing = true
        }
        return ops
    }

    private static func topographic(_ primary: String, _ secondary: String, _ width: Double, _ height: Double) -> Art {
        let short = min(width, height)
        var fine: [Op] = [], index: [Op] = []
        let centres: [Point] = [(width * 0.86, height * 0.22), (width * 0.1, height * 0.92)]
        for (centre, point) in centres.enumerated() {
            for ring in 1...12 {
                let base = short * 0.06 * Double(ring)
                let points: [Point] = (0...240).map { step in
                    let angle = Double(step) / 240 * .pi * 2
                    let radius = base * (1 + 0.1 * sin(3 * angle + Double(ring) * 0.5 + Double(centre)) + 0.05 * sin(7 * angle - Double(ring) * 0.3))
                    return polar(point.0, point.1, radius, angle)
                }
                if ring % 4 == 0 { index += clippedRuns(points, width, height) } else { fine += clippedRuns(points, width, height) }
            }
        }
        return Art(viewWidth: width, viewHeight: height, paths: [path(fine, .none, line(primary, 0.6), opacity: 0.32), path(index, .none, line(secondary, 1), opacity: 0.5)])
    }

    private static func triangleTiles(_ primary: String, _ secondary: String, _ width: Double, _ height: Double) -> Art {
        let side = min(width, height) / 5
        let rise = side * 0.866
        var random = Seeded(11)
        let tones = [lighter(primary, 0.9), lighter(primary, 0.82), lighter(primary, 0.74), lighter(secondary, 0.78)]
        var groups: [[Op]] = tones.map { _ in [] }
        func clamp(_ p: Point) -> Point { (min(width, max(0, p.0)), min(height, max(0, p.1))) }
        var row = 0
        while Double(row) * rise < height {
            let top = Double(row) * rise, bottom = top + rise
            var column = -2
            while Double(column) * (side / 2) - side < width {
                let left = Double(column) * (side / 2) - (row % 2 == 1 ? side / 2 : 0)
                let up = (column + row) % 2 == 0
                let corners: [Point] = up ? [(left, bottom), (left + side / 2, top), (left + side, bottom)] : [(left, top), (left + side, top), (left + side / 2, bottom)]
                let clamped = corners.map(clamp)
                let (a, b, c) = (clamped[0], clamped[1], clamped[2])
                let area = abs((b.0 - a.0) * (c.1 - a.1) - (c.0 - a.0) * (b.1 - a.1)) / 2
                column += 1
                if area < 1 { continue }
                groups[Int(random.next() * Double(tones.count))] += polyline(clamped, closed: true)
            }
            row += 1
        }
        return Art(viewWidth: width, viewHeight: height, paths: groups.enumerated().map { path($0.element, .solid(tones[$0.offset])) })
    }

    /// `kit.art`: an ornament placed in a box (page-filling patterns are built at the box size).
    static func art(_ id: String, primary: String, secondary: String, _ x: Double, _ y: Double, _ width: Double, _ height: Double, opacity: Double = 1) -> StudioElement {
        let built: Art
        switch id {
        case "flourishDivider": built = flourishDivider(primary, secondary)
        case "blob": built = blob(primary, secondary)
        case "halftone": built = halftone(primary, secondary, width, height)
        case "topographic": built = topographic(primary, secondary, width, height)
        case "triangleTiles": built = triangleTiles(primary, secondary, width, height)
        default: built = diagonalHatch(primary, secondary, width, height)
        }
        var element = StudioFactory.vector(viewWidth: built.viewWidth, viewHeight: built.viewHeight, paths: built.paths, x: x, y: y, width: width, height: height, name: id)
        element.opacity = opacity
        return element
    }

    // MARK: Contact icons (`cvIcons.ts`, Lucide drawings)

    private static let link: [(String, [String: String])] = [
        ("path", ["d": "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"]),
        ("path", ["d": "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"]),
    ]

    static func iconNode(_ kind: StudioCVContactKind) -> [(String, [String: String])] {
        switch kind {
        case .email: [("path", ["d": "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"]), ("rect", ["x": "2", "y": "4", "width": "20", "height": "16", "rx": "2"])]
        case .phone: [("path", ["d": "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"])]
        case .website: [("circle", ["cx": "12", "cy": "12", "r": "10"]), ("path", ["d": "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"]), ("path", ["d": "M2 12h20"])]
        case .location: [("path", ["d": "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"]), ("circle", ["cx": "12", "cy": "10", "r": "3"])]
        case .linkedin: [("path", ["d": "M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"]), ("rect", ["width": "4", "height": "12", "x": "2", "y": "9"]), ("circle", ["cx": "4", "cy": "4", "r": "2"])]
        case .github: [("path", ["d": "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"]), ("path", ["d": "M9 18c-4.51 2-5-2-7-2"])]
        case .other: link
        }
    }

    /// `iconArt` + `contactIcon`: a 24×24 Lucide outline drawn with round 2pt strokes.
    static func contactIcon(_ kind: StudioCVContactKind, color: String, _ x: Double, _ y: Double, _ side: Double) -> StudioElement {
        let stroke = StudioStroke(color: color, width: 2, dash: .solid, cap: .round, join: .round)
        var outlines: [String] = []
        var filled: [String] = []
        for (tag, attrs) in iconNode(kind) {
            let d = StudioPath.primitive(tag, attrs)
            guard !d.isEmpty else { continue }
            let fill = attrs["fill"]?.trimmingCharacters(in: .whitespaces).lowercased()
            if let fill, fill != "none", fill != "transparent" { filled.append(d) } else { outlines.append(d) }
        }
        var paths: [StudioVectorPath] = []
        if !outlines.isEmpty { paths.append(StudioVectorPath(d: outlines.joined(separator: " "), fill: .none, stroke: stroke)) }
        for d in filled { paths.append(StudioVectorPath(d: d, fill: .solid(color), stroke: stroke)) }
        return StudioFactory.vector(viewWidth: 24, viewHeight: 24, paths: paths, x: x, y: y, width: side, height: side, name: kind.rawValue)
    }
}
