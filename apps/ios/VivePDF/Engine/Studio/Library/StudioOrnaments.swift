import Foundation

/// Decorative vector art (frames, seals, dividers, accents, patterns) — a line-for-line port of
/// `ornaments/geometry.ts`, `paint.ts`, `ornaments.ts` and `premiumOrnaments.ts`, producing the same
/// path data as the desktop for the same colours and size.
enum StudioOrnaments {
    typealias Point = (Double, Double)

    struct Segment {
        var op: Character
        var points: [Point]
    }

    struct Colors: Equatable {
        var primary: String
        var secondary: String
    }

    struct Art {
        var viewWidth: Double
        var viewHeight: Double
        var paths: [StudioVectorPath]
    }

    enum Category: String, CaseIterable, Identifiable {
        case frames, seals, dividers, accents, patterns
        var id: String { rawValue }
        var labelKey: String { "studio.ornaments.categories.\(rawValue)" }
    }

    struct Ornament: Identifiable {
        let id: String
        let category: Category
        let fitsPage: Bool
        let size: (width: Double, height: Double)
        let build: (Colors, (width: Double, height: Double)) -> Art
        var labelKey: String { "studio.ornaments.items.\(id)" }
    }

    static let defaultColors = Colors(primary: "#1f4e8c", secondary: "#c9a227")

    static func paletteColors(_ palette: [String]) -> Colors {
        Colors(primary: palette.first ?? defaultColors.primary, secondary: palette.count > 1 ? palette[1] : defaultColors.secondary)
    }

    // MARK: Number formatting (JavaScript semantics)

    /// `num` from shapes.ts with JavaScript `Math.round` (half towards +∞) and `String(number)`.
    static func num(_ value: Double) -> String {
        var rounded = (value * 1000 + 0.5).rounded(.down) / 1000
        if rounded == 0 { rounded = 0 }
        if rounded == rounded.rounded(.towardZero), abs(rounded) < 1e15 { return String(Int64(rounded)) }
        return "\(rounded)"
    }

    static func jsRound(_ value: Double) -> Double { (value + 0.5).rounded(.down) }

    // MARK: Geometry

    static let kappa = 0.5522847498
    static let tau = Double.pi * 2

    static func toD(_ segments: [Segment]) -> String {
        segments.map { s in
            s.op == "Z" ? "Z" : "\(s.op)" + s.points.map { "\(num($0.0)) \(num($0.1))" }.joined(separator: " ")
        }.joined(separator: " ")
    }

    static func mapPoints(_ segments: [Segment], _ map: (Point) -> Point) -> [Segment] {
        segments.map { Segment(op: $0.op, points: $0.points.map(map)) }
    }

    static func polyline(_ points: [Point], _ closed: Bool = false) -> [Segment] {
        let segments = points.enumerated().map { Segment(op: $0.offset == 0 ? "M" : "L", points: [$0.element]) }
        return closed ? segments + [Segment(op: "Z", points: [])] : segments
    }

    static func smooth(_ points: [Point], _ closed: Bool = false, _ tension: Double = 1) -> [Segment] {
        if points.count < 3 { return polyline(points, closed) }
        let count = points.count
        func at(_ i: Int) -> Point { closed ? points[((i % count) + count) % count] : points[max(0, min(count - 1, i))] }
        var segments = [Segment(op: "M", points: [points[0]])]
        let last = closed ? count : count - 1
        for i in 0..<last {
            let p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
            let c1 = (p1.0 + (p2.0 - p0.0) / 6 * tension, p1.1 + (p2.1 - p0.1) / 6 * tension)
            let c2 = (p2.0 - (p3.0 - p1.0) / 6 * tension, p2.1 - (p3.1 - p1.1) / 6 * tension)
            segments.append(Segment(op: "C", points: [c1, c2, p2]))
        }
        return closed ? segments + [Segment(op: "Z", points: [])] : segments
    }

    static func circle(_ cx: Double, _ cy: Double, _ r: Double) -> [Segment] {
        let k = r * kappa
        return [
            Segment(op: "M", points: [(cx + r, cy)]),
            Segment(op: "C", points: [(cx + r, cy + k), (cx + k, cy + r), (cx, cy + r)]),
            Segment(op: "C", points: [(cx - k, cy + r), (cx - r, cy + k), (cx - r, cy)]),
            Segment(op: "C", points: [(cx - r, cy - k), (cx - k, cy - r), (cx, cy - r)]),
            Segment(op: "C", points: [(cx + k, cy - r), (cx + r, cy - k), (cx + r, cy)]),
            Segment(op: "Z", points: []),
        ]
    }

    static func polar(_ cx: Double, _ cy: Double, _ r: Double, _ angle: Double) -> Point { (cx + r * cos(angle), cy + r * sin(angle)) }

    static func rotateAround(_ c: Point, _ angle: Double) -> (Point) -> Point {
        let co = cos(angle), si = sin(angle)
        return { p in (c.0 + (p.0 - c.0) * co - (p.1 - c.1) * si, c.1 + (p.0 - c.0) * si + (p.1 - c.1) * co) }
    }

    static func sampled(_ count: Int, _ closed: Bool = true, _ at: (Double) -> Point) -> [Segment] {
        let n = closed ? count : count + 1
        return polyline((0..<n).map { at(Double($0) / Double(count)) }, closed)
    }

    static func arc(_ cx: Double, _ cy: Double, _ r: Double, _ from: Double, _ to: Double) -> [Segment] {
        let steps = max(1, Int(ceil(abs(to - from) / (Double.pi / 2))))
        let step = (to - from) / Double(steps)
        let handle = 4.0 / 3.0 * tan(step / 4) * r
        var segments = [Segment(op: "M", points: [polar(cx, cy, r, from)])]
        for i in 0..<steps {
            let a = from + step * Double(i)
            let b = a + step
            let start = polar(cx, cy, r, a), end = polar(cx, cy, r, b)
            segments.append(Segment(op: "C", points: [(start.0 - handle * sin(a), start.1 + handle * cos(a)), (end.0 + handle * sin(b), end.1 - handle * cos(b)), end]))
        }
        return segments
    }

    /// xorshift32, bit-identical to the desktop generator.
    static func seeded(_ seed: UInt32) -> () -> Double {
        var state: UInt32 = seed == 0 ? 1 : seed
        return {
            state ^= state << 13
            state ^= state >> 17
            state ^= state << 5
            return Double(state) / 4294967296
        }
    }

    static func roundedRectangleAt(_ x: Double, _ y: Double, _ width: Double, _ height: Double, _ radius: Double) -> (Double) -> (point: Point, normal: Point) {
        let r = max(0, min(radius, width / 2, height / 2))
        let straightX = width - 2 * r, straightY = height - 2 * r
        let quarter = Double.pi / 2 * r
        let lengths = [straightX, quarter, straightY, quarter, straightX, quarter, straightY, quarter]
        let total = lengths.reduce(0, +)
        return { s in
            let m = s.truncatingRemainder(dividingBy: 1)
            var rest = (m + 1).truncatingRemainder(dividingBy: 1) * total
            var part = 0
            while part < lengths.count - 1 && rest > lengths[part] {
                rest -= lengths[part]
                part += 1
            }
            func corner(_ cx: Double, _ cy: Double, _ start: Double) -> (point: Point, normal: Point) {
                let angle = start + (r != 0 ? rest / r : 0)
                return (polar(cx, cy, r, angle), (-cos(angle), -sin(angle)))
            }
            switch part {
            case 0: return ((x + r + rest, y), (0, 1))
            case 1: return corner(x + width - r, y + r, -Double.pi / 2)
            case 2: return ((x + width, y + r + rest), (-1, 0))
            case 3: return corner(x + width - r, y + height - r, 0)
            case 4: return ((x + width - r - rest, y + height), (0, -1))
            case 5: return corner(x + r, y + height - r, Double.pi / 2)
            case 6: return ((x, y + height - r - rest), (1, 0))
            default: return corner(x + r, y + r, Double.pi)
            }
        }
    }

    static func perimeter(_ width: Double, _ height: Double, _ radius: Double) -> Double {
        let r = max(0, min(radius, width / 2, height / 2))
        return 2 * (width - 2 * r) + 2 * (height - 2 * r) + 2 * Double.pi * r
    }

    // MARK: Paint

    static func mix(_ from: String, _ to: String, _ amount: Double) -> String {
        let a = StudioColor.rgb255(from), b = StudioColor.rgb255(to)
        let pairs = [(a.0, b.0), (a.1, b.1), (a.2, b.2)]
        return "#" + pairs.map { String(format: "%02x", Int(jsRound(Double($0.0) + Double($0.1 - $0.0) * amount))) }.joined()
    }

    static func darker(_ c: String, _ amount: Double = 0.28) -> String { mix(c, "#000000", amount) }
    static func lighter(_ c: String, _ amount: Double = 0.35) -> String { mix(c, "#ffffff", amount) }
    static func solid(_ c: String) -> StudioFill { .solid(c) }
    static let none = StudioFill.none
    static func line(_ c: String, _ width: Double, _ dash: StudioDash = .solid) -> StudioStroke { StudioStroke(color: c, width: width, dash: dash) }
    static func linear(_ angle: Double, _ from: String, _ to: String) -> StudioFill {
        .linear(angle: angle, stops: [StudioGradientStop(offset: 0, color: from), StudioGradientStop(offset: 1, color: to)])
    }
    static func radial(_ inner: String, _ outer: String) -> StudioFill {
        .radial(stops: [StudioGradientStop(offset: 0, color: inner), StudioGradientStop(offset: 1, color: outer)], cx: nil, cy: nil, radius: nil)
    }

    static func shape(_ segments: [Segment], _ fill: StudioFill, _ stroke: StudioStroke? = nil, opacity: Double = 1) -> StudioVectorPath {
        StudioVectorPath(d: toD(segments), fill: fill, stroke: stroke, evenOdd: false, opacity: opacity)
    }

    static func rectangle(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> [Segment] {
        polyline([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], true)
    }

    static func mirrored(_ segments: [Segment], _ width: Double, _ height: Double, _ horizontal: Bool, _ vertical: Bool) -> [Segment] {
        mapPoints(segments) { (horizontal ? width - $0.0 : $0.0, vertical ? height - $0.1 : $0.1) }
    }

    static func fourCorners(_ piece: [Segment], _ width: Double, _ height: Double) -> [Segment] {
        piece + mirrored(piece, width, height, true, false) + mirrored(piece, width, height, false, true) + mirrored(piece, width, height, true, true)
    }

    // MARK: Catalogue

    static let pageSize: (width: Double, height: Double) = (842, 595)

    static let all: [Ornament] = [
        Ornament(id: "guillocheFrame", category: .frames, fitsPage: true, size: pageSize, build: guillocheFrame),
        Ornament(id: "doubleFrame", category: .frames, fitsPage: true, size: pageSize, build: doubleFrame),
        Ornament(id: "ornateFrame", category: .frames, fitsPage: true, size: pageSize, build: ornateFrame),
        Ornament(id: "decoFrame", category: .frames, fitsPage: true, size: pageSize, build: decoFrame),
        Ornament(id: "guillocheRosette", category: .seals, fitsPage: false, size: (200, 200), build: { c, _ in guillocheRosette(c) }),
        Ornament(id: "starSeal", category: .seals, fitsPage: false, size: (200, 200), build: { c, _ in starSeal(c) }),
        Ornament(id: "ribbonSeal", category: .seals, fitsPage: false, size: (200, 250), build: { c, _ in ribbonSeal(c) }),
        Ornament(id: "scallopSeal", category: .seals, fitsPage: false, size: (200, 200), build: { c, _ in scallopSeal(c) }),
        Ornament(id: "laurel", category: .seals, fitsPage: false, size: (220, 210), build: { c, _ in laurel(c) }),
        Ornament(id: "shield", category: .seals, fitsPage: false, size: (160, 200), build: { c, _ in shield(c) }),
        Ornament(id: "ribbonBanner", category: .dividers, fitsPage: false, size: (340, 80), build: { c, _ in ribbonBanner(c) }),
        Ornament(id: "diamondDivider", category: .dividers, fitsPage: false, size: (300, 20), build: { c, _ in diamondDivider(c) }),
        Ornament(id: "flourishDivider", category: .dividers, fitsPage: false, size: (300, 40), build: { c, _ in flourishDivider(c) }),
        Ornament(id: "dotsDivider", category: .dividers, fitsPage: false, size: (300, 20), build: { c, _ in dotsDivider(c) }),
        Ornament(id: "cornerTriangles", category: .accents, fitsPage: false, size: (200, 200), build: { c, _ in cornerTriangles(c) }),
        Ornament(id: "waves", category: .accents, fitsPage: false, size: (600, 140), build: { c, _ in waves(c) }),
        Ornament(id: "confetti", category: .accents, fitsPage: false, size: (300, 200), build: { c, _ in confetti(c) }),
        Ornament(id: "blob", category: .accents, fitsPage: false, size: (200, 200), build: { c, _ in blob(c) }),
        Ornament(id: "arcRings", category: .accents, fitsPage: false, size: (200, 200), build: { c, _ in arcRings(c) }),
        Ornament(id: "nouveauFrame", category: .frames, fitsPage: true, size: pageSize, build: nouveauFrame),
        Ornament(id: "gemFrame", category: .frames, fitsPage: true, size: pageSize, build: gemFrame),
        Ornament(id: "guillocheBorder", category: .frames, fitsPage: true, size: pageSize, build: guillocheBorder),
        Ornament(id: "waxSeal", category: .seals, fitsPage: false, size: (200, 200), build: { c, _ in waxSeal(c) }),
        Ornament(id: "decoFan", category: .accents, fitsPage: false, size: (240, 130), build: { c, _ in decoFan(c) }),
        Ornament(id: "botanicalSprig", category: .accents, fitsPage: false, size: (120, 240), build: { c, _ in botanicalSprig(c) }),
        Ornament(id: "brushStroke", category: .accents, fitsPage: false, size: (400, 90), build: { c, _ in brushStroke(c) }),
        Ornament(id: "paperCurl", category: .accents, fitsPage: false, size: (160, 160), build: { c, _ in paperCurl(c) }),
        Ornament(id: "ribbonCorner", category: .accents, fitsPage: false, size: (200, 200), build: { c, _ in ribbonCorner(c) }),
        Ornament(id: "halftone", category: .patterns, fitsPage: true, size: pageSize, build: halftone),
        Ornament(id: "diagonalHatch", category: .patterns, fitsPage: true, size: pageSize, build: diagonalHatch),
        Ornament(id: "topographic", category: .patterns, fitsPage: true, size: pageSize, build: topographic),
        Ornament(id: "triangleTiles", category: .patterns, fitsPage: true, size: pageSize, build: triangleTiles),
        Ornament(id: "honeycomb", category: .patterns, fitsPage: true, size: pageSize, build: honeycomb),
        Ornament(id: "marble", category: .patterns, fitsPage: true, size: pageSize, build: marble),
        Ornament(id: "sunburst", category: .patterns, fitsPage: true, size: pageSize, build: sunburst),
    ]

    static func ornament(_ id: String) -> Ornament? { all.first { $0.id == id } }

    /// Builds an ornament as a vector element: page-filling art covers the page, the rest is centred
    /// at 40 % of the page's shorter side (`addOrnament` in ElementsPanel.tsx).
    static func element(_ item: Ornament, colors: Colors, pageWidth: Double, pageHeight: Double, name: String) -> StudioElement {
        if item.fitsPage {
            let art = item.build(colors, (pageWidth, pageHeight))
            return StudioFactory.vector(viewWidth: art.viewWidth, viewHeight: art.viewHeight, paths: art.paths, x: 0, y: 0, width: pageWidth, height: pageHeight, name: name)
        }
        let scale = min(pageWidth, pageHeight) * 0.4 / max(item.size.width, item.size.height)
        let w = item.size.width * scale, h = item.size.height * scale
        let art = item.build(colors, item.size)
        return StudioFactory.vector(viewWidth: art.viewWidth, viewHeight: art.viewHeight, paths: art.paths, x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h, name: name)
    }

    // MARK: Classic ornaments

    static func guillocheRosette(_ colors: Colors) -> Art {
        var paths: [StudioVectorPath] = []
        let rings: [(radius: Double, depth: Double, waves: Int, layers: Int, width: Double)] = [(70, 13, 18, 6, 0.55), (43, 8, 12, 5, 0.5)]
        for ring in rings {
            for layer in 0..<ring.layers {
                let shift = tau / Double(ring.waves) * (Double(layer) / Double(ring.layers))
                let curve = sampled(ring.waves * 40) { t in polar(100, 100, ring.radius + ring.depth * cos(Double(ring.waves) * (t * tau - shift)), t * tau) }
                paths.append(shape(curve, none, line(layer % 2 == 1 ? colors.secondary : colors.primary, ring.width)))
            }
        }
        paths.append(shape(circle(100, 100, 88), none, line(colors.primary, 1.4)))
        paths.append(shape(circle(100, 100, 30), none, line(colors.primary, 0.9)))
        return Art(viewWidth: 200, viewHeight: 200, paths: paths)
    }

    static func guillocheFrame(_ colors: Colors, _ size: (width: Double, height: Double)) -> Art {
        let (width, height) = size
        let short = min(width, height)
        let margin = short * 0.04, band = short * 0.045
        let mx = margin + band / 2, my = margin + band / 2, mw = width - 2 * margin - band, mh = height - 2 * margin - band
        let along = roundedRectangleAt(mx, my, mw, mh, band)
        let length = perimeter(mw, mh, band)
        let waves = max(8, Int(jsRound(length / (band * 1.3))))
        var paths: [StudioVectorPath] = []
        let layers = 4
        for layer in 0..<layers {
            let shift = tau * Double(layer) / Double(layers)
            let curve = sampled(waves * 18) { t -> Point in
                let (point, normal) = along(t)
                let offset = band / 2 * 0.92 * sin(Double(waves) * tau * t + shift)
                return (point.0 + normal.0 * offset, point.1 + normal.1 * offset)
            }
            paths.append(shape(curve, none, line(layer % 2 == 1 ? colors.secondary : colors.primary, 0.5)))
        }
        let outer = rectangle(margin, margin, width - 2 * margin, height - 2 * margin)
        let inner = rectangle(margin + band, margin + band, width - 2 * (margin + band), height - 2 * (margin + band))
        let hairline = rectangle(margin + band + 5, margin + band + 5, width - 2 * (margin + band + 5), height - 2 * (margin + band + 5))
        paths += [shape(outer, none, line(colors.primary, 1.6)), shape(inner, none, line(colors.primary, 0.9)), shape(hairline, none, line(colors.secondary, 0.4))]
        return Art(viewWidth: width, viewHeight: height, paths: paths)
    }

    static func doubleFrame(_ colors: Colors, _ size: (width: Double, height: Double)) -> Art {
        let (width, height) = size
        let margin = min(width, height) * 0.035
        let gap = 7.0
        func diamond(_ cx: Double, _ cy: Double, _ r: Double) -> [Segment] { polyline([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], true) }
        let inner = margin + gap
        let corners = fourCorners(diamond(inner, inner, 6), width, height)
        return Art(viewWidth: width, viewHeight: height, paths: [
            shape(rectangle(margin, margin, width - 2 * margin, height - 2 * margin), none, line(colors.primary, 4)),
            shape(rectangle(inner, inner, width - 2 * inner, height - 2 * inner), none, line(colors.primary, 1)),
            shape(corners, solid(colors.secondary)),
        ])
    }

    static func flourishPiece(_ scale: Double, _ offset: Double) -> [Segment] {
        let curl: [Point] = [(92, 4), (52, 3), (22, 7), (9, 20), (10, 36), (22, 44), (34, 38), (34, 26), (25, 22), (19, 28)]
        let leafPoints: [Point] = [(40, 12), (52, 10), (62, 16), (52, 20), (40, 12)]
        let transform: (Point) -> Point = { (offset + $0.0 * scale, offset + $0.1 * scale) }
        let swap: (Point) -> Point = { ($0.1, $0.0) }
        return mapPoints(smooth(curl), transform) + mapPoints(smooth(curl.map(swap)), transform) + mapPoints(smooth(leafPoints, true), transform)
            + mapPoints(smooth(leafPoints.map(swap), true), transform) + mapPoints(circle(5, 5, 3.2), transform)
    }

    static func ornateFrame(_ colors: Colors, _ size: (width: Double, height: Double)) -> Art {
        let (width, height) = size
        let short = min(width, height)
        let margin = short * 0.045
        let scale = short * 0.2 / 92
        let corners = fourCorners(flourishPiece(scale, margin + 8), width, height)
        return Art(viewWidth: width, viewHeight: height, paths: [
            shape(rectangle(margin, margin, width - 2 * margin, height - 2 * margin), none, line(colors.primary, 1.2)),
            shape(rectangle(margin + 4, margin + 4, width - 2 * margin - 8, height - 2 * margin - 8), none, line(colors.primary, 0.4)),
            shape(corners, none, line(colors.secondary, 1.3)),
        ])
    }

    static func decoFrame(_ colors: Colors, _ size: (width: Double, height: Double)) -> Art {
        let (width, height) = size
        let margin = min(width, height) * 0.05
        let arm = min(width, height) * 0.14
        let step = 7.0
        let piece = polyline([(margin, margin + arm), (margin, margin), (margin + arm, margin)])
            + polyline([(margin + step, margin + arm * 0.75), (margin + step, margin + step), (margin + arm * 0.75, margin + step)])
            + polyline([(margin + 2 * step, margin + arm * 0.5), (margin + 2 * step, margin + 2 * step), (margin + arm * 0.5, margin + 2 * step)])
        let squares = fourCorners(rectangle(margin + 3 * step, margin + 3 * step, 5, 5), width, height)
        let inset = margin + step * 1.5
        return Art(viewWidth: width, viewHeight: height, paths: [
            shape(fourCorners(piece, width, height), none, line(colors.primary, 1.6)),
            shape(squares, solid(colors.secondary)),
            shape(rectangle(inset, inset, width - 2 * inset, height - 2 * inset), none, line(colors.primary, 0.5)),
        ])
    }

    static func starburst(_ cx: Double, _ cy: Double, _ outer: Double, _ inner: Double, _ points: Int) -> [Segment] {
        var corners: [Point] = []
        for i in 0..<(points * 2) { corners.append(polar(cx, cy, i % 2 == 1 ? inner : outer, Double(i) * Double.pi / Double(points) - Double.pi / 2)) }
        return polyline(corners, true)
    }

    static func starSeal(_ colors: Colors) -> Art {
        Art(viewWidth: 200, viewHeight: 200, paths: [
            shape(starburst(100, 100, 98, 87, 36), linear(135, lighter(colors.primary, 0.2), darker(colors.primary, 0.2))),
            shape(circle(100, 100, 74), none, line(colors.secondary, 1.6)),
            shape(circle(100, 100, 68), none, line(colors.secondary, 0.8, .dotted)),
        ])
    }

    static func ribbonSeal(_ colors: Colors) -> Art {
        let tail: [Point] = [(74, 150), (104, 162), (92, 248), (76, 230), (56, 242)]
        let left = polyline(tail, true)
        let rightTail = mirrored(left, 200, 0, true, false)
        return Art(viewWidth: 200, viewHeight: 250, paths: [shape(left, solid(darker(colors.primary, 0.15))), shape(rightTail, solid(darker(colors.primary, 0.3)))] + starSeal(colors).paths)
    }

    static func scallopSeal(_ colors: Colors) -> Art {
        let edge: [Point] = (0..<96).map { i in
            let angle = Double(i) / 96 * tau
            return polar(100, 100, 92 + 5 * cos(24 * angle), angle)
        }
        return Art(viewWidth: 200, viewHeight: 200, paths: [
            shape(smooth(edge, true), radial(lighter(colors.primary, 0.15), darker(colors.primary, 0.1))),
            shape(circle(100, 100, 76), none, line(colors.secondary, 1.5)),
            shape(circle(100, 100, 71), none, line(colors.secondary, 0.6)),
        ])
    }

    static func ribbonBanner(_ colors: Colors) -> Art {
        let leftEnd = polyline([(0, 24), (44, 24), (44, 76), (0, 76), (14, 50)], true)
        let leftFold = polyline([(28, 62), (44, 62), (44, 76)], true)
        return Art(viewWidth: 340, viewHeight: 80, paths: [
            shape(leftEnd + mirrored(leftEnd, 340, 0, true, false), solid(darker(colors.primary, 0.18))),
            shape(leftFold + mirrored(leftFold, 340, 0, true, false), solid(darker(colors.primary, 0.45))),
            shape(rectangle(28, 8, 284, 54), linear(180, lighter(colors.primary, 0.12), colors.primary)),
        ])
    }

    static func classicLeaf(_ base: Point, _ angle: Double, _ length: Double) -> [Segment] {
        let width = length * 0.36
        let local = [
            Segment(op: "M", points: [(0, 0)]),
            Segment(op: "C", points: [(length * 0.3, -width), (length * 0.75, -width * 0.8), (length, 0)]),
            Segment(op: "C", points: [(length * 0.75, width * 0.8), (length * 0.3, width), (0, 0)]),
            Segment(op: "Z", points: []),
        ]
        return mapPoints(local) { (base.0 + $0.0 * cos(angle) - $0.1 * sin(angle), base.1 + $0.0 * sin(angle) + $0.1 * cos(angle)) }
    }

    static func laurel(_ colors: Colors) -> Art {
        let cx = 110.0, cy = 108.0, radius = 84.0
        let from = 100 * Double.pi / 180, to = 250 * Double.pi / 180
        var leaves: [Segment] = []
        let count = 13
        for i in 0..<count {
            let t = Double(i) / Double(count - 1)
            let angle = from + (to - from) * t
            let base = polar(cx, cy, radius, angle)
            let tangent = angle + Double.pi / 2
            let length = 22 - 9 * abs(t - 0.45)
            leaves += classicLeaf(base, tangent + 0.55, length) + classicLeaf(base, tangent - 0.55, length * 0.86)
        }
        let stem = arc(cx, cy, radius, from, to)
        func mirror(_ s: [Segment]) -> [Segment] { mirrored(s, 220, 0, true, false) }
        return Art(viewWidth: 220, viewHeight: 210, paths: [shape(stem + mirror(stem), none, line(darker(colors.primary, 0.2), 1.6)), shape(leaves + mirror(leaves), solid(colors.primary))])
    }

    static func diamondDivider(_ colors: Colors) -> Art {
        func diamond(_ cx: Double, _ r: Double) -> [Segment] { polyline([(cx, 10 - r), (cx + r, 10), (cx, 10 + r), (cx - r, 10)], true) }
        return Art(viewWidth: 300, viewHeight: 20, paths: [
            shape(polyline([(0, 10), (128, 10)]) + polyline([(172, 10), (300, 10)]), none, line(colors.primary, 1)),
            shape(diamond(150, 8), solid(colors.primary)),
            shape(diamond(136, 3.5) + diamond(164, 3.5), solid(colors.secondary)),
        ])
    }

    static func flourishDivider(_ colors: Colors) -> Art {
        let right: [Point] = [(150, 20), (166, 10), (186, 9), (198, 18), (194, 29), (182, 30), (178, 22), (186, 18)]
        let tail: [Point] = [(190, 24), (230, 21), (270, 20), (298, 20)]
        let half = smooth(right) + smooth(tail)
        return Art(viewWidth: 300, viewHeight: 40, paths: [shape(half + mirrored(half, 300, 0, true, false), none, line(colors.primary, 1.3)), shape(circle(150, 20, 3.4), solid(colors.secondary))])
    }

    static func dotsDivider(_ colors: Colors) -> Art {
        var dots: [Segment] = []
        for (i, r) in [5, 3.6, 2.6, 1.8, 1.2].enumerated() {
            let gap = 16 * Double(i)
            dots += circle(150 + gap, 10, r)
            if i > 0 { dots += circle(150 - gap, 10, r) }
        }
        return Art(viewWidth: 300, viewHeight: 20, paths: [shape(dots, solid(colors.primary))])
    }

    static func cornerTriangles(_ colors: Colors) -> Art {
        func triangle(_ s: Double) -> [Segment] { polyline([(0, 0), (s, 0), (0, s)], true) }
        return Art(viewWidth: 200, viewHeight: 200, paths: [
            shape(triangle(200), solid(lighter(colors.primary, 0.7))),
            shape(triangle(150), linear(135, colors.primary, lighter(colors.primary, 0.3))),
            shape(triangle(78), solid(colors.secondary)),
        ])
    }

    static func waves(_ colors: Colors) -> Art {
        func band(_ base: Double, _ amplitude: Double, _ length: Double, _ phase: Double) -> [Segment] {
            let points: [Point] = (0..<49).map { i in
                let x = Double(i) / 48 * 600
                return (x, base + amplitude * sin(x / length * tau + phase))
            }
            return smooth(points) + [Segment(op: "L", points: [(600, 140)]), Segment(op: "L", points: [(0, 140)]), Segment(op: "Z", points: [])]
        }
        return Art(viewWidth: 600, viewHeight: 140, paths: [
            shape(band(40, 14, 320, 0.4), solid(lighter(colors.primary, 0.6))),
            shape(band(66, 16, 260, 2.1), solid(lighter(colors.primary, 0.25))),
            shape(band(96, 12, 380, 4), linear(90, colors.primary, darker(colors.primary, 0.25))),
        ])
    }

    static func confetti(_ colors: Colors) -> Art {
        let random = seeded(7)
        var first: [Segment] = [], second: [Segment] = []
        for i in 0..<42 {
            let x = 6 + random() * 288
            let y = 6 + random() * 188
            let kind = i % 3
            var pieces: [Segment]
            if kind == 0 {
                pieces = circle(x, y, 1.8 + random() * 2.4)
            } else if kind == 1 {
                let rect = rectangle(x - 5, y - 1.6, 10, 3.2)
                pieces = mapPoints(rect, rotateAround((x, y), random() * Double.pi))
            } else {
                let tri = polyline([(x, y - 4), (x + 4, y + 3), (x - 4, y + 3)], true)
                pieces = mapPoints(tri, rotateAround((x, y), random() * Double.pi))
            }
            if i % 2 == 1 { first += pieces } else { second += pieces }
        }
        return Art(viewWidth: 300, viewHeight: 200, paths: [shape(first, solid(colors.primary)), shape(second, solid(colors.secondary))])
    }

    static func blob(_ colors: Colors) -> Art {
        let random = seeded(3)
        let points: [Point] = (0..<9).map { i in polar(100, 100, 70 + random() * 26, Double(i) / 9 * tau) }
        return Art(viewWidth: 200, viewHeight: 200, paths: [shape(smooth(points, true), linear(45, colors.primary, colors.secondary))])
    }

    static func arcRings(_ colors: Colors) -> Art {
        Art(viewWidth: 200, viewHeight: 200, paths: [
            shape(arc(100, 100, 92, Double.pi * 0.75, Double.pi * 2.0), none, line(colors.primary, 7)),
            shape(arc(100, 100, 72, Double.pi * 1.1, Double.pi * 2.4), none, line(colors.secondary, 4)),
            shape(arc(100, 100, 55, Double.pi * 0.4, Double.pi * 1.6), none, line(colors.primary, 2)),
        ])
    }

    static func shield(_ colors: Colors) -> Art {
        func outline(_ inset: Double) -> [Segment] {
            [
                Segment(op: "M", points: [(10 + inset, 12 + inset)]),
                Segment(op: "L", points: [(150 - inset, 12 + inset)]),
                Segment(op: "L", points: [(150 - inset, 92)]),
                Segment(op: "C", points: [(150 - inset, 146 - inset * 0.5), (100, 176 - inset), (80, 190 - inset * 1.4)]),
                Segment(op: "C", points: [(60, 176 - inset), (10 + inset, 146 - inset * 0.5), (10 + inset, 92)]),
                Segment(op: "Z", points: []),
            ]
        }
        return Art(viewWidth: 160, viewHeight: 200, paths: [shape(outline(0), linear(180, lighter(colors.primary, 0.1), darker(colors.primary, 0.2))), shape(outline(9), none, line(colors.secondary, 1.4))])
    }
}
