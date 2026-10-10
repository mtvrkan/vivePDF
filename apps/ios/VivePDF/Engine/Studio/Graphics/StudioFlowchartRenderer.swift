import CoreGraphics
import Foundation

/// Port of `editor_flowchart.py`: layered layout (back edges, longest-path layers, barycentre ordering),
/// orthogonal routes with lanes for back / skipping arrows, then shapes, arrows and labels.
enum StudioFlowchartRenderer {
    static let textWidth = 11.0, padding = 0.8, minWidth = 6.0, minHeight = 2.4, slant = 0.9
    static let layerGap = 2.6, nodeGap = 2.2, laneGap = 1.4, arrow = 0.55, sweeps = 4, labelScale = 0.85, margin = 0.8
    static let maxSide = 14400.0

    final class Node {
        let spec: StudioFlowStep
        let lines: [String]
        var width: Double, height: Double
        var layer = 0
        var order = 0.0
        var x = 0.0, y = 0.0
        init(_ spec: StudioFlowStep, _ lines: [String], _ w: Double, _ h: Double) { self.spec = spec; self.lines = lines; width = w; height = h }
        var box: CGRect { CGRect(x: x - width / 2, y: y - height / 2, width: width, height: height) }
    }

    struct Route { var points: [CGPoint]; var label: String; var back = false }

    static func render(_ settings: StudioFlowchartSettings) throws -> StudioGraphicScene {
        let spec = settings.spec
        guard !spec.isBlank else { throw StudioGraphicError(reason: "flowchartEmpty") }
        let size = spec.fontSize
        let measure = StudioGraphicScene(width: 1, height: 1, fontId: spec.fontId)
        let step = size * StudioGraphicScene.lineHeight
        let pad = size * padding
        var nodes: [String: Node] = [:]
        for n in spec.nodes {
            let lines = measure.wrap(n.text, size: size, width: size * textWidth)
            let tw = lines.map { measure.width($0, size: size) }.max() ?? 0
            let th = Double(lines.count) * step
            var w = max(size * minWidth, tw + 2 * pad), h = max(size * minHeight, th + 2 * pad)
            switch n.shape {
            case .terminal: w += h * 0.5
            case .io: w += size * slant * 2
            case .decision: w = 2 * (tw + pad); h = 2 * (th + pad * 0.6)
            case .connector: w = max(size * minHeight, tw + 2 * pad, th + 2 * pad); h = w
            case .process: break
            }
            nodes[n.id] = Node(n, lines, w, h)
        }
        // Back edges (iterative DFS)
        var outgoing: [String: [(Int, String)]] = [:]
        for n in spec.nodes { outgoing[n.id] = [] }
        for (i, e) in spec.edges.enumerated() { outgoing[e.source, default: []].append((i, e.target)) }
        var state: [String: Int] = [:]
        var back = Set<Int>()
        for n in spec.nodes where state[n.id] == nil {
            var stack: [(String, Int)] = [(n.id, 0)]
            state[n.id] = 1
            while !stack.isEmpty {
                let (current, cursor) = stack[stack.count - 1]
                let children = outgoing[current] ?? []
                var advanced = false
                var index = cursor
                while index < children.count {
                    let (edge, target) = children[index]
                    index += 1
                    if state[target] == 1 { back.insert(edge) } else if state[target] == nil {
                        state[target] = 1
                        stack[stack.count - 1].1 = index
                        stack.append((target, 0))
                        advanced = true
                        break
                    }
                }
                if !advanced { state[current] = 2; stack.removeLast() }
            }
        }
        // Layers
        let forward = spec.edges.enumerated().filter { !back.contains($0.offset) }.map(\.element)
        for _ in 0..<nodes.count {
            var changed = false
            for e in forward {
                let wanted = nodes[e.source]!.layer + 1
                if nodes[e.target]!.layer < wanted { nodes[e.target]!.layer = wanted; changed = true }
            }
            if !changed { break }
        }
        // Order
        let count = (nodes.values.map(\.layer).max() ?? 0) + 1
        var layers: [[Node]] = Array(repeating: [], count: count)
        for (position, n) in spec.nodes.enumerated() {
            let node = nodes[n.id]!
            node.order = Double(position)
            layers[node.layer].append(node)
        }
        var neighbours: [String: [String]] = [:]
        for e in spec.edges { neighbours[e.source, default: []].append(e.target); neighbours[e.target, default: []].append(e.source) }
        for sweep in 0..<sweeps {
            let sequence: [Int] = sweep % 2 == 0 ? Array(stride(from: 1, to: count, by: 1)) : Array(stride(from: count - 2, through: 0, by: -1))
            for index in sequence {
                let reference = sweep % 2 == 0 ? index - 1 : index + 1
                for node in layers[index] {
                    let linked = (neighbours[node.spec.id] ?? []).compactMap { nodes[$0] }.filter { $0.layer == reference }.map(\.order)
                    if !linked.isEmpty { node.order = linked.reduce(0, +) / Double(linked.count) }
                }
                layers[index] = stableSorted(layers[index]) { $0.order < $1.order }
                for (p, node) in layers[index].enumerated() { node.order = Double(p) }
            }
        }
        // Gap
        var gap = size * layerGap
        if spec.direction == .right {
            let widest = spec.edges.map { measure.width($0.label.trimmingCharacters(in: .whitespaces), size: size * labelScale) }.max() ?? 0
            gap = max(gap, widest + size * 2.4)
        }
        // Place
        let down = spec.direction == .down
        func along(_ n: Node) -> Double { down ? n.height : n.width }
        func across(_ n: Node) -> Double { down ? n.width : n.height }
        let spans = layers.map { l in l.reduce(0) { $0 + across($1) } + size * nodeGap * Double(l.count - 1) }
        let widest = spans.max() ?? 0
        var main = 0.0
        for (layer, span) in zip(layers, spans) {
            let depth = layer.map(along).max() ?? 0
            var cross = (widest - span) / 2
            for node in layer {
                let cm = main + depth / 2, cc = cross + across(node) / 2
                if down { node.x = cc; node.y = cm } else { node.x = cm; node.y = cc }
                cross += across(node) + size * nodeGap
            }
            main += depth + gap
        }
        // Routes
        func anchor(_ n: Node, _ side: String) -> CGPoint {
            let b = n.box
            switch side {
            case "top": return CGPoint(x: n.x, y: b.minY)
            case "bottom": return CGPoint(x: n.x, y: b.maxY)
            case "left": return CGPoint(x: b.minX, y: n.y)
            default: return CGPoint(x: b.maxX, y: n.y)
            }
        }
        func forwardRoute(_ s: Node, _ t: Node) -> [CGPoint] {
            if down {
                if s.spec.shape == .decision && abs(t.x - s.x) > s.width / 2 {
                    let start = anchor(s, t.x > s.x ? "right" : "left"), end = anchor(t, "top")
                    return [start, CGPoint(x: end.x, y: start.y), end]
                }
                let start = anchor(s, "bottom"), end = anchor(t, "top")
                if abs(start.x - end.x) < 0.5 { return [start, end] }
                let turn = end.y - gap / 2
                return [start, CGPoint(x: start.x, y: turn), CGPoint(x: end.x, y: turn), end]
            }
            if s.spec.shape == .decision && abs(t.y - s.y) > s.height / 2 {
                let start = anchor(s, t.y > s.y ? "bottom" : "top"), end = anchor(t, "left")
                return [start, CGPoint(x: start.x, y: end.y), end]
            }
            let start = anchor(s, "right"), end = anchor(t, "left")
            if abs(start.y - end.y) < 0.5 { return [start, end] }
            let turn = end.x - gap / 2
            return [start, CGPoint(x: turn, y: start.y), CGPoint(x: turn, y: end.y), end]
        }
        let all = Array(nodes.values)
        func backRoute(_ s: Node, _ t: Node, _ lane: Int) -> [CGPoint] {
            let reach = size * laneGap * Double(lane + 1)
            if down {
                let edge = (all.map { $0.box.maxX }.max() ?? 0) + reach
                let start = anchor(s, "right"), end = anchor(t, "right")
                return [start, CGPoint(x: edge, y: start.y), CGPoint(x: edge, y: end.y), end]
            }
            let edge = (all.map { $0.box.maxY }.max() ?? 0) + reach
            let start = anchor(s, "bottom"), end = anchor(t, "bottom")
            return [start, CGPoint(x: start.x, y: edge), CGPoint(x: end.x, y: edge), end]
        }
        func skipRoute(_ s: Node, _ t: Node, _ lane: Int) -> [CGPoint] {
            let reach = size * laneGap * Double(lane + 1)
            if down {
                let edge = (all.map { $0.box.minX }.min() ?? 0) - reach
                let start = anchor(s, "left"), end = anchor(t, "left")
                return [start, CGPoint(x: edge, y: start.y), CGPoint(x: edge, y: end.y), end]
            }
            let edge = (all.map { $0.box.minY }.min() ?? 0) - reach
            let start = anchor(s, "top"), end = anchor(t, "top")
            return [start, CGPoint(x: start.x, y: edge), CGPoint(x: end.x, y: edge), end]
        }
        func crosses(_ points: [CGPoint], _ ends: (Node, Node)) -> Bool {
            for node in all where node !== ends.0 && node !== ends.1 {
                let b = node.box
                for (p, q) in zip(points, points.dropFirst()) {
                    let l = min(p.x, q.x), r = max(p.x, q.x), tp = min(p.y, q.y), bt = max(p.y, q.y)
                    if l < b.maxX && r > b.minX && tp < b.maxY && bt > b.minY { return true }
                }
            }
            return false
        }
        var routes: [Route] = []
        var lane = 0, skip = 0
        for (i, e) in spec.edges.enumerated() {
            let s = nodes[e.source]!, t = nodes[e.target]!
            if back.contains(i) || t.layer <= s.layer {
                routes.append(Route(points: backRoute(s, t, lane), label: e.label, back: true))
                lane += 1
                continue
            }
            var points = forwardRoute(s, t)
            if crosses(points, (s, t)) { points = skipRoute(s, t, skip); skip += 1 }
            routes.append(Route(points: points, label: e.label))
        }
        // Bounds
        func labelBox(_ route: Route) -> CGRect {
            let small = size * labelScale
            let w = measure.width(route.label.trimmingCharacters(in: .whitespaces), size: small)
            let h = small * StudioGraphicScene.lineHeight
            let g = size * 0.3
            let segments = Array(zip(route.points, route.points.dropFirst()))
            func roomy(_ s: (CGPoint, CGPoint)) -> Bool {
                abs(s.1.x - s.0.x) >= abs(s.1.y - s.0.y) ? abs(s.1.x - s.0.x) >= w + 4 * g : abs(s.1.y - s.0.y) >= h + 2 * g
            }
            let (p0, p1) = segments.first(where: roomy) ?? segments[0]
            let left: Double, top: Double
            if abs(p1.x - p0.x) >= abs(p1.y - p0.y) {
                left = p1.x >= p0.x ? p0.x + 2 * g : p0.x - 2 * g - w
                top = p0.y - g - h
            } else {
                left = p0.x + g
                top = p1.y >= p0.y ? p0.y + g : p0.y - g - h
            }
            return CGRect(x: left, y: top, width: w, height: h)
        }
        var xs: [Double] = [], ys: [Double] = []
        for n in all { xs += [n.box.minX, n.box.maxX]; ys += [n.box.minY, n.box.maxY] }
        for r in routes {
            xs += r.points.map(\.x); ys += r.points.map(\.y)
            if !r.label.trimmingCharacters(in: .whitespaces).isEmpty { let lb = labelBox(r); xs += [lb.minX, lb.maxX]; ys += [lb.minY, lb.maxY] }
        }
        let m = size * margin
        let minX = xs.min() ?? 0, minY = ys.min() ?? 0
        let width = (xs.max() ?? 0) - minX + 2 * m, height = (ys.max() ?? 0) - minY + 2 * m
        if width > maxSide || height > maxSide { throw StudioGraphicError(reason: "flowchartTooLarge") }
        let dx = m - minX, dy = m - minY
        for n in all { n.x += dx; n.y += dy }
        routes = routes.map { var r = $0; r.points = r.points.map { CGPoint(x: $0.x + dx, y: $0.y + dy) }; return r }
        // Draw
        let scene = StudioGraphicScene(width: width, height: height, fontId: spec.fontId)
        let strokeWidth = max(0.75, size / 12)
        for r in routes {
            scene.polygon(r.points, fill: nil, stroke: spec.stroke, width: strokeWidth, closed: false, round: false)
            let p0 = r.points[r.points.count - 2], p1 = r.points[r.points.count - 1]
            let length = max(1e-6, hypot(p1.x - p0.x, p1.y - p0.y))
            let ux = (p1.x - p0.x) / length, uy = (p1.y - p0.y) / length
            let head = size * arrow
            let base = CGPoint(x: p1.x - ux * head, y: p1.y - uy * head)
            let wing = CGPoint(x: -uy * head * 0.55, y: ux * head * 0.55)
            scene.polygon([p1, CGPoint(x: base.x + wing.x, y: base.y + wing.y), CGPoint(x: base.x - wing.x, y: base.y - wing.y)], fill: spec.stroke, stroke: spec.stroke, width: 0.1, round: false)
        }
        for n in spec.nodes.compactMap({ nodes[$0.id] }) {
            let b = n.box
            let path: CGPath
            switch n.spec.shape {
            case .process: path = CGPath(rect: b, transform: nil)
            case .terminal:
                let r = min(b.width, b.height) / 2
                path = CGPath(roundedRect: b, cornerWidth: r, cornerHeight: r, transform: nil)
            case .decision:
                let p = CGMutablePath()
                p.addLines(between: [CGPoint(x: n.x, y: b.minY), CGPoint(x: b.maxX, y: n.y), CGPoint(x: n.x, y: b.maxY), CGPoint(x: b.minX, y: n.y)])
                p.closeSubpath()
                path = p
            case .io:
                let sl = size * slant
                let p = CGMutablePath()
                p.addLines(between: [CGPoint(x: b.minX + sl, y: b.minY), CGPoint(x: b.maxX, y: b.minY), CGPoint(x: b.maxX - sl, y: b.maxY), CGPoint(x: b.minX, y: b.maxY)])
                p.closeSubpath()
                path = p
            case .connector: path = CGPath(ellipseIn: b, transform: nil)
            }
            scene.path(path, fill: spec.fill, stroke: spec.stroke, width: strokeWidth)
            let top = n.y - Double(n.lines.count) * step / 2
            for (i, line) in n.lines.enumerated() where !line.isEmpty {
                let advance = scene.width(line, size: size)
                scene.text(line, x: n.x - advance / 2, top: top + Double(i) * step, size: size, color: spec.color)
            }
        }
        for r in routes where !r.label.trimmingCharacters(in: .whitespaces).isEmpty {
            let lb = labelBox(r)
            scene.text(r.label.trimmingCharacters(in: .whitespaces), x: lb.minX, top: lb.minY, size: size * labelScale, color: spec.color)
        }
        return scene
    }

    private static func stableSorted<T>(_ items: [T], by less: (T, T) -> Bool) -> [T] {
        items.enumerated().sorted { less($0.element, $1.element) || (!less($1.element, $0.element) && $0.offset < $1.offset) }.map(\.element)
    }
}
