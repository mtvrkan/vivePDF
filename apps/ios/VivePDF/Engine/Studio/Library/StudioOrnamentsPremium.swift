import Foundation

/// `premiumOrnaments.ts`: page frames, patterns and richer accents.
extension StudioOrnaments {
    typealias Size = (width: Double, height: Double)

    private static func inside(_ p: Point, _ size: Size) -> Bool { p.0 >= 0 && p.0 <= size.width && p.1 >= 0 && p.1 <= size.height }

    private static func clamp(_ p: Point, _ size: Size) -> Point { (min(size.width, max(0, p.0)), min(size.height, max(0, p.1))) }

    private static func clippedRuns(_ points: [Point], _ size: Size) -> [Segment] {
        var segments: [Segment] = []
        var drawing = false
        for point in points {
            if !inside(point, size) { drawing = false; continue }
            segments.append(Segment(op: drawing ? "L" : "M", points: [point]))
            drawing = true
        }
        return segments
    }

    static func leaf(_ base: Point, _ angle: Double, _ length: Double, _ width: Double) -> [Segment] {
        let axis = (cos(angle), sin(angle))
        let normal = (-axis.1, axis.0)
        func at(_ along: Double, _ across: Double) -> Point { (base.0 + axis.0 * along + normal.0 * across, base.1 + axis.1 * along + normal.1 * across) }
        return [
            Segment(op: "M", points: [base]),
            Segment(op: "C", points: [at(length * 0.3, width), at(length * 0.72, width * 0.8), at(length, 0)]),
            Segment(op: "C", points: [at(length * 0.72, -width * 0.8), at(length * 0.3, -width), base]),
            Segment(op: "Z", points: []),
        ]
    }

    static func halftone(_ colors: Colors, _ size: Size) -> Art {
        let (width, height) = size
        let step = max(min(width, height) / 34, sqrt(width * height / 1100))
        var main: [Segment] = [], echo: [Segment] = []
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
        return Art(viewWidth: width, viewHeight: height, paths: [shape(main, solid(colors.primary), nil, opacity: 0.18), shape(echo, solid(colors.secondary), nil, opacity: 0.24)])
    }

    static func diagonalHatch(_ colors: Colors, _ size: Size) -> Art {
        let (width, height) = size
        let step = min(width, height) / 42
        var fine: [Segment] = [], bold: [Segment] = []
        var index = 0
        var c = -height + step
        while c < width {
            let from = max(0, c), to = min(width, c + height)
            if to - from > 0.5 {
                let pair = [Segment(op: "M", points: [(from, from - c)]), Segment(op: "L", points: [(to, to - c)])]
                if index % 6 == 0 { bold += pair } else { fine += pair }
            }
            index += 1
            c += step
        }
        return Art(viewWidth: width, viewHeight: height, paths: [shape(fine, none, line(colors.primary, 0.5), opacity: 0.28), shape(bold, none, line(colors.secondary, 1.2), opacity: 0.4)])
    }

    static func topographic(_ colors: Colors, _ size: Size) -> Art {
        let (width, height) = size
        let short = min(width, height)
        var fine: [Segment] = [], index: [Segment] = []
        let centres: [Point] = [(width * 0.86, height * 0.22), (width * 0.1, height * 0.92)]
        for (centre, c) in centres.enumerated() {
            for ring in 1...12 {
                let base = short * 0.06 * Double(ring)
                let points: [Point] = (0..<241).map { step in
                    let angle = Double(step) / 240 * tau
                    let radius = base * (1 + 0.1 * sin(3 * angle + Double(ring) * 0.5 + Double(centre)) + 0.05 * sin(7 * angle - Double(ring) * 0.3))
                    return polar(c.0, c.1, radius, angle)
                }
                if ring % 4 == 0 { index += clippedRuns(points, size) } else { fine += clippedRuns(points, size) }
            }
        }
        return Art(viewWidth: width, viewHeight: height, paths: [shape(fine, none, line(colors.primary, 0.6), opacity: 0.32), shape(index, none, line(colors.secondary, 1), opacity: 0.5)])
    }

    static func triangleTiles(_ colors: Colors, _ size: Size) -> Art {
        let (width, height) = size
        let side = min(width, height) / 5
        let rise = side * 0.866
        let random = seeded(11)
        let tones = [lighter(colors.primary, 0.9), lighter(colors.primary, 0.82), lighter(colors.primary, 0.74), lighter(colors.secondary, 0.78)]
        var groups: [[Segment]] = tones.map { _ in [] }
        var row = 0
        while Double(row) * rise < height {
            let top = Double(row) * rise, bottom = top + rise
            var column = -2
            while Double(column) * (side / 2) - side < width {
                let left = Double(column) * (side / 2) - (row % 2 == 1 ? side / 2 : 0)
                let up = (column + row) % 2 == 0
                let corners: [Point] = up ? [(left, bottom), (left + side / 2, top), (left + side, bottom)] : [(left, top), (left + side, top), (left + side / 2, bottom)]
                let clamped = corners.map { clamp($0, size) }
                let a = clamped[0], b = clamped[1], c = clamped[2]
                let area = abs((b.0 - a.0) * (c.1 - a.1) - (c.0 - a.0) * (b.1 - a.1)) / 2
                if area >= 1 {
                    groups[Int((random() * Double(tones.count)).rounded(.down))] += polyline(clamped, true)
                }
                column += 1
            }
            row += 1
        }
        return Art(viewWidth: width, viewHeight: height, paths: groups.enumerated().map { shape($0.element, solid(tones[$0.offset])) })
    }

    static func honeycomb(_ colors: Colors, _ size: Size) -> Art {
        let (width, height) = size
        let radius = min(width, height) / 14
        let rows = sqrt(3) * radius
        var bands: [[Segment]] = [[], [], []]
        var column = 0
        while Double(column) * radius * 1.5 <= width + radius {
            let cx = Double(column) * radius * 1.5
            var row = -1
            while Double(row) * rows <= height + rows {
                defer { row += 1 }
                let cy = Double(row) * rows + (column % 2 == 1 ? rows / 2 : 0)
                let reach = cx / width
                if reach < 0.35 { continue }
                let band = reach > 0.75 ? 0 : reach > 0.55 ? 1 : 2
                let points = (0..<7).map { polar(cx, cy, radius * 0.94, Double($0) / 6 * tau) }
                bands[band] += clippedRuns(points, size)
            }
            column += 1
        }
        let opacities = [0.42, 0.26, 0.12]
        return Art(viewWidth: width, viewHeight: height, paths: bands.enumerated().map {
            shape($0.element, none, line($0.offset == 0 ? colors.secondary : colors.primary, 0.9), opacity: opacities[$0.offset])
        })
    }

    static func marble(_ colors: Colors, _ size: Size) -> Art {
        let (width, height) = size
        var paths: [StudioVectorPath] = []
        let wide = height * 0.05, narrow = height * 0.025
        for vein in 0..<9 {
            let v = Double(vein)
            let base = height * (0.1 + v * 0.1)
            let points: [Point] = (0..<61).map { step in
                let x = Double(step) / 60 * width
                let y = base + wide * sin(x / width * tau * 0.9 + v * 0.7) + narrow * sin(x / width * tau * 2.3 + v * 1.9)
                return clamp((x, y), size)
            }
            let kind = vein % 3
            paths.append(shape(smooth(points), none, line(kind == 0 ? colors.secondary : lighter(colors.primary, 0.45), kind == 0 ? 2.2 : kind == 1 ? 0.9 : 0.45), opacity: 0.55))
        }
        return Art(viewWidth: width, viewHeight: height, paths: paths)
    }

    private static func edgePoint(_ cx: Double, _ cy: Double, _ angle: Double, _ size: Size) -> Point {
        let dx = cos(angle), dy = sin(angle)
        var reach = Double.infinity
        if dx > 1e-9 { reach = min(reach, (size.width - cx) / dx) }
        if dx < -1e-9 { reach = min(reach, -cx / dx) }
        if dy > 1e-9 { reach = min(reach, (size.height - cy) / dy) }
        if dy < -1e-9 { reach = min(reach, -cy / dy) }
        return (cx + dx * reach, cy + dy * reach)
    }

    static func sunburst(_ colors: Colors, _ size: Size) -> Art {
        let (width, height) = size
        let cx = width / 2, cy = height * 0.62
        let count = 32
        func turn(_ a: Double) -> Double { (a.truncatingRemainder(dividingBy: tau) + tau).truncatingRemainder(dividingBy: tau) }
        let corners: [Point] = [(0, 0), (width, 0), (width, height), (0, height)]
        var rays: [Segment] = []
        for ray in stride(from: 0, to: count, by: 2) {
            let from = Double(ray) / Double(count) * tau
            let span = tau / Double(count)
            var entries: [(index: Int, corner: Point, offset: Double)] = []
            for (index, corner) in corners.enumerated() {
                let offset = turn(atan2(corner.1 - cy, corner.0 - cx) - from)
                if offset > 0 && offset < span { entries.append((index, corner, offset)) }
            }
            entries.sort { $0.offset != $1.offset ? $0.offset < $1.offset : $0.index < $1.index }
            let inner: [Point] = entries.map { $0.corner }
            let start: [Point] = [(cx, cy), edgePoint(cx, cy, from, size)]
            let end: [Point] = [edgePoint(cx, cy, from + span, size)]
            rays += polyline(start + inner + end, true)
        }
        let glow = min(width, height) * 0.16
        return Art(viewWidth: width, viewHeight: height, paths: [
            shape(rays, solid(lighter(colors.primary, 0.78)), nil, opacity: 0.55),
            shape(circle(cx, cy, glow), radial(lighter(colors.secondary, 0.35), lighter(colors.secondary, 0.85)), nil, opacity: 0.7),
        ])
    }

    static func decoFan(_ colors: Colors) -> Art {
        let cx = 120.0, cy = 124.0
        func half(_ radius: Double) -> [Segment] { arc(cx, cy, radius, Double.pi, tau) + [Segment(op: "L", points: [(cx, cy)]), Segment(op: "Z", points: [])] }
        var rays: [Segment] = []
        for i in 1..<10 {
            let angle = Double.pi + Double(i) / 10 * Double.pi
            rays += [Segment(op: "M", points: [polar(cx, cy, 40, angle)]), Segment(op: "L", points: [polar(cx, cy, 114, angle)])]
        }
        return Art(viewWidth: 240, viewHeight: 130, paths: [
            shape(half(116), linear(90, lighter(colors.secondary, 0.25), darker(colors.secondary, 0.12))),
            shape(arc(cx, cy, 96, Double.pi, tau) + arc(cx, cy, 76, Double.pi, tau) + arc(cx, cy, 116, Double.pi, tau), none, line(colors.primary, 1.2)),
            shape(rays, none, line(colors.primary, 0.9)),
            shape(half(36), solid(colors.primary)),
            shape(half(24), none, line(lighter(colors.secondary, 0.4), 1)),
        ])
    }

    static func botanicalSprig(_ colors: Colors) -> Art {
        let stem: [Point] = [(60, 234), (56, 180), (63, 122), (57, 64), (61, 34)]
        func along(_ t: Double) -> Point {
            let scaled = t * Double(stem.count - 1)
            let index = min(stem.count - 2, Int(scaled.rounded(.down)))
            let local = scaled - Double(index)
            return (stem[index].0 + (stem[index + 1].0 - stem[index].0) * local, stem[index].1 + (stem[index + 1].1 - stem[index].1) * local)
        }
        var leaves: [Segment] = [], veins: [Segment] = []
        for i in 0..<7 {
            let t = 0.16 + Double(i) * 0.115
            let side: Double = i % 2 == 1 ? 1 : -1
            let length = 44 - Double(i) * 3.2
            let angle = -Double.pi / 2 + side * (Double.pi / 4.2)
            let base = along(t)
            leaves += leaf(base, angle, length, length * 0.3)
            veins += [Segment(op: "M", points: [base]), Segment(op: "L", points: [(base.0 + cos(angle) * length * 0.85, base.1 + sin(angle) * length * 0.85)])]
        }
        leaves += leaf(along(0.97), -Double.pi / 2, 20, 7)
        return Art(viewWidth: 120, viewHeight: 240, paths: [
            shape(smooth(stem), none, line(darker(colors.primary, 0.1), 2)),
            shape(leaves, linear(135, lighter(colors.primary, 0.3), colors.primary)),
            shape(veins, none, line(lighter(colors.primary, 0.55), 0.6)),
        ])
    }

    static func brushStroke(_ colors: Colors) -> Art {
        let random = seeded(23)
        let count = 48
        var top: [Point] = [], bottom: [Point] = []
        for i in 0...count {
            let u = Double(i) / Double(count)
            let x = 8 + u * 384
            let body = pow(sin(Double.pi * u), 0.35)
            let centre = 45 + sin(u * Double.pi * 1.4) * 4
            top.append((x, centre - (26 * body + (random() - 0.5) * 5 * body)))
            bottom.append((x, centre + (26 * body + (random() - 0.5) * 5 * body)))
        }
        var streaks: [Segment] = []
        for i in 0..<5 {
            let y = 30 + Double(i) * 7.5 + random() * 2
            let from = 40 + random() * 60
            let to = 300 + random() * 70
            streaks += [Segment(op: "M", points: [(from, y)]), Segment(op: "L", points: [(to, y + (random() - 0.5) * 3)])]
        }
        return Art(viewWidth: 400, viewHeight: 90, paths: [
            shape(polyline(top + bottom.reversed(), true), solid(colors.secondary)),
            shape(streaks, none, line(darker(colors.secondary, 0.18), 1.4), opacity: 0.35),
        ])
    }

    static func paperCurl(_ colors: Colors) -> Art {
        let revealed = polyline([(160, 62), (160, 160), (62, 160)], true)
        let flap = [
            Segment(op: "M", points: [(160, 62)]),
            Segment(op: "C", points: [(138, 84), (120, 96), (100, 100)]),
            Segment(op: "C", points: [(96, 120), (84, 138), (62, 160)]),
            Segment(op: "C", points: [(96, 140), (140, 96), (160, 62)]),
            Segment(op: "Z", points: []),
        ]
        let shadow = [
            Segment(op: "M", points: [(160, 70)]),
            Segment(op: "C", points: [(132, 98), (112, 112), (104, 106)]),
            Segment(op: "C", points: [(112, 112), (98, 132), (70, 160)]),
            Segment(op: "L", points: [(160, 160)]),
            Segment(op: "Z", points: []),
        ]
        return Art(viewWidth: 160, viewHeight: 160, paths: [
            shape(revealed, solid(colors.primary)),
            shape(shadow, solid(darker(colors.primary, 0.5)), nil, opacity: 0.3),
            shape(flap, linear(135, lighter(colors.primary, 0.92), lighter(colors.primary, 0.6))),
        ])
    }

    static func ribbonCorner(_ colors: Colors) -> Art {
        let band = polyline([(86, 0), (140, 0), (0, 140), (0, 86)], true)
        let stitches = [
            Segment(op: "M", points: [(93, 0)]), Segment(op: "L", points: [(0, 93)]),
            Segment(op: "M", points: [(133, 0)]), Segment(op: "L", points: [(0, 133)]),
        ]
        let folds = polyline([(140, 0), (154, 0), (140, 12)], true) + polyline([(0, 140), (0, 154), (12, 140)], true)
        return Art(viewWidth: 200, viewHeight: 200, paths: [
            shape(folds, solid(darker(colors.secondary, 0.4))),
            shape(band, linear(45, lighter(colors.secondary, 0.2), darker(colors.secondary, 0.15))),
            shape(stitches, none, line(lighter(colors.secondary, 0.55), 0.9, .dashed)),
        ])
    }

    static func waxSeal(_ colors: Colors) -> Art {
        let random = seeded(5)
        let edge = (0..<26).map { polar(100, 100, 84 + random() * 9, Double($0) / 26 * tau) }
        let star: [Point] = (0..<16).map { polar(100, 100, $0 % 2 == 1 ? 11 : 27, Double($0) / 16 * tau - Double.pi / 2) }
        return Art(viewWidth: 200, viewHeight: 200, paths: [
            shape(smooth(edge, true), radial(lighter(colors.primary, 0.18), darker(colors.primary, 0.3))),
            shape(circle(100, 100, 62), none, line(darker(colors.primary, 0.4), 3)),
            shape(circle(100, 100, 57), radial(lighter(colors.primary, 0.12), darker(colors.primary, 0.15))),
            shape(polyline(star, true), solid(darker(colors.primary, 0.35))),
            shape(arc(100, 100, 73, Double.pi * 1.08, Double.pi * 1.46), none, line(lighter(colors.primary, 0.55), 3), opacity: 0.6),
        ])
    }

    static func nouveauFrame(_ colors: Colors, _ size: Size) -> Art {
        let (width, height) = size
        let short = min(width, height)
        let margin = short * 0.045
        let reach = short * 0.17
        let whip = smooth([
            (margin + 2, margin + reach), (margin + reach * 0.1, margin + reach * 0.5), (margin + reach * 0.3, margin + reach * 0.3),
            (margin + reach * 0.5, margin + reach * 0.1), (margin + reach, margin + 2),
        ])
        let centre = (margin + reach * 0.26, margin + reach * 0.26)
        let spiral = sampled(80, false) { t in
            let radius = reach * 0.16 * (1 - t * 0.85)
            return polar(centre.0, centre.1, radius, Double.pi * 1.25 + t * tau * 1.6)
        }
        let leaves = leaf((margin + reach, margin + 2), 0.3, reach * 0.22, reach * 0.06) + leaf((margin + 2, margin + reach), Double.pi / 2 - 0.3, reach * 0.22, reach * 0.06)
        let arch = arc(width / 2, margin, reach * 0.34, 0, Double.pi)
        let gem = circle(width / 2, margin + reach * 0.34, 2.6)
        let outer = rectangle(margin, margin, width - 2 * margin, height - 2 * margin)
        let inner = rectangle(margin + 7, margin + 7, width - 2 * (margin + 7), height - 2 * (margin + 7))
        return Art(viewWidth: width, viewHeight: height, paths: [
            shape(outer, none, line(colors.primary, 0.9)),
            shape(inner, none, line(colors.primary, 0.4)),
            shape(fourCorners(whip + spiral, width, height), none, line(colors.secondary, 1.4)),
            shape(fourCorners(leaves, width, height), solid(colors.secondary)),
            shape(arch + mirrored(arch, width, height, false, true), none, line(colors.secondary, 1)),
            shape(gem + mirrored(gem, width, height, false, true), solid(colors.primary)),
        ])
    }

    static func gemFrame(_ colors: Colors, _ size: Size) -> Art {
        let (width, height) = size
        let margin = min(width, height) * 0.04
        let gap = 6.0
        let corner = margin + gap / 2
        let radius = min(9, corner)
        func facet(_ a: Point, _ b: Point) -> [Segment] {
            fourCorners(polyline([(corner, corner), (corner + a.0 * radius, corner + a.1 * radius), (corner + b.0 * radius, corner + b.1 * radius)], true), width, height)
        }
        let dots = circle(width / 2, corner, 2.2) + circle(width / 2, height - corner, 2.2) + circle(corner, height / 2, 2.2) + circle(width - corner, height / 2, 2.2)
        return Art(viewWidth: width, viewHeight: height, paths: [
            shape(rectangle(margin, margin, width - 2 * margin, height - 2 * margin), none, line(colors.primary, 0.7)),
            shape(rectangle(margin + gap, margin + gap, width - 2 * (margin + gap), height - 2 * (margin + gap)), none, line(colors.primary, 0.35)),
            shape(facet((0, -1), (1, 0)), solid(lighter(colors.secondary, 0.45))),
            shape(facet((1, 0), (0, 1)), solid(colors.secondary)),
            shape(facet((0, 1), (-1, 0)), solid(darker(colors.secondary, 0.28))),
            shape(facet((-1, 0), (0, -1)), solid(lighter(colors.secondary, 0.18))),
            shape(dots, solid(colors.secondary)),
        ])
    }

    static func guillocheBorder(_ colors: Colors, _ size: Size) -> Art {
        let (width, height) = size
        let short = min(width, height)
        let margin = short * 0.05, band = short * 0.05
        let mx = margin + band / 2, my = margin + band / 2, mw = width - 2 * margin - band, mh = height - 2 * margin - band
        let along = roundedRectangleAt(mx, my, mw, mh, band * 0.6)
        let length = perimeter(mw, mh, band * 0.6)
        let waves = min(700, max(12, Int(jsRound(length / (band * 0.7)))))
        var paths: [StudioVectorPath] = []
        for layer in 0..<6 {
            let shift = tau * Double(layer) / 6
            let depth = layer % 2 == 1 ? 0.62 : 0.9
            let curve = sampled(min(waves * 16, 7000)) { t -> Point in
                let (point, normal) = along(t)
                let offset = band / 2 * depth * sin(Double(waves) * tau * t + shift)
                return (point.0 + normal.0 * offset, point.1 + normal.1 * offset)
            }
            paths.append(shape(curve, none, line(layer % 2 == 1 ? colors.secondary : colors.primary, 0.42)))
        }
        let rc = margin + band / 2
        var rosette: [Segment] = []
        for layer in 0..<3 {
            rosette += sampled(160) { t in polar(rc, rc, band * (0.62 + 0.18 * cos(10 * (t * tau) + Double(layer))), t * tau) }
        }
        paths += [
            shape(rectangle(margin, margin, width - 2 * margin, height - 2 * margin), none, line(colors.primary, 1.3)),
            shape(rectangle(margin + band, margin + band, width - 2 * (margin + band), height - 2 * (margin + band)), none, line(colors.primary, 0.8)),
            shape(fourCorners(circle(rc, rc, band * 0.86), width, height), solid(lighter(colors.secondary, 0.82))),
            shape(fourCorners(rosette, width, height), none, line(colors.secondary, 0.5)),
        ]
        return Art(viewWidth: width, viewHeight: height, paths: paths)
    }
}
