import CoreGraphics
import Foundation

/// Port of `editor_chart.py` + `editor_chart_stats.py`: column, bar, line, area, pie, doughnut,
/// scatter, histogram, box and dot plots drawn into a `StudioGraphicScene`.
enum StudioChartRenderer {
    static let gridColour = StudioColor.hex(0.86, 0.87, 0.89)
    static let axisColour = StudioColor.hex(0.42, 0.45, 0.5)
    static let white = "#ffffff"
    static let lh = StudioGraphicScene.lineHeight

    struct Ticks {
        var low: Double, high: Double, step: Double, decimals: Int
        var values: [Double] {
            let count = Int(((high - low) / step).rounded())
            return (0...max(0, count)).map { low + Double($0) * step }
        }
    }

    final class Box {
        var left: Double, top: Double, right: Double, bottom: Double
        init(_ l: Double, _ t: Double, _ r: Double, _ b: Double) { left = l; top = t; right = r; bottom = b }
        var width: Double { right - left }
        var height: Double { bottom - top }
    }

    final class Canvas {
        let scene: StudioGraphicScene
        let spec: StudioChartSpec
        init(_ scene: StudioGraphicScene, _ spec: StudioChartSpec) { self.scene = scene; self.spec = spec }
        var size: Double { spec.fontSize }
        var line: Double { spec.fontSize * lh }
        func width(_ text: String, _ size: Double? = nil, bold: Bool = false) -> Double { scene.width(text, size: size ?? self.size, bold: bold) }
        func text(_ x: Double, _ top: Double, _ value: String, size: Double? = nil, bold: Bool = false, align: StudioTableAlign = .left, colour: String? = nil) {
            scene.text(value, x: x, top: top, size: size ?? self.size, bold: bold, align: align, color: colour ?? spec.color)
        }
        func fitted(_ text: String, _ width: Double, _ lines: Int = 1, bold: Bool = false) -> [String] {
            let wrapped = scene.wrap(text, size: size, width: max(1, width), bold: bold)
            if wrapped.count <= lines { return wrapped }
            var kept = Array(wrapped.prefix(lines))
            var last = kept[kept.count - 1]
            while !last.isEmpty && self.width(last + "…", bold: bold) > width { last.removeLast() }
            kept[kept.count - 1] = last.trimmingCharacters(in: .whitespaces) + "…"
            return kept
        }
        func rect(_ r: CGRect, _ colour: String, _ opacity: Double = 1) { scene.fillRect(r, colour, opacity: opacity) }
        func dot(_ c: CGPoint, _ radius: Double, _ colour: String) { scene.circle(c, radius: radius, fill: colour, stroke: white, width: radius * 0.35) }
    }

    static func refuse(_ reason: String) -> StudioGraphicError { StudioGraphicError(reason: reason) }

    static func niceTicks(_ lowIn: Double, _ highIn: Double, _ target: Double = 5) -> Ticks {
        var low = lowIn, high = highIn
        if high - low < 1e-12 {
            let spread = abs(high) * 0.1 == 0 ? 1.0 : abs(high) * 0.1
            low -= spread; high += spread
        }
        let raw = (high - low) / target
        let magnitude = pow(10, floor(log10(raw)))
        let multiple = [1, 2, 2.5, 5, 10].first { $0 * magnitude >= raw * 0.999 } ?? 10
        let step = multiple * magnitude
        let start = floor(low / step + 1e-9) * step
        let end = ceil(high / step - 1e-9) * step
        let decimals = max(0, -Int(floor(log10(magnitude) + 1e-9)) + (multiple == 2.5 ? 1 : 0))
        return Ticks(low: start, high: end, step: step, decimals: decimals)
    }

    static func formatNumber(_ v: Double, _ decimals: Int, _ decimal: String) -> String {
        var text = String(format: "%.\(decimals)f", v)
        if Double(text) == 0 { text = text.trimmingCharacters(in: CharacterSet(charactersIn: "-")) }
        return text.replacingOccurrences(of: ".", with: decimal)
    }

    static func plainNumber(_ v: Double, _ decimal: String) -> String {
        var text = String(format: "%.3f", v)
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        if text == "-0" || text.isEmpty { text = "0" }
        return text.replacingOccurrences(of: ".", with: decimal)
    }

    static func percentText(_ share: Double, _ decimal: String) -> String {
        var text = String(format: "%.1f", share * 100)
        if text.hasSuffix(".0") { text.removeLast(2) }
        return text.replacingOccurrences(of: ".", with: decimal)
    }

    static func render(_ spec: StudioChartSpec) throws -> StudioGraphicScene {
        if spec.series.allSatisfy({ $0.values.allSatisfy { $0 == nil } }) { throw refuse("chartNoData") }
        let scene = StudioGraphicScene(width: spec.width, height: spec.height, fontId: spec.fontId)
        let canvas = Canvas(scene, spec)
        let pad = spec.fontSize * 0.6
        let box = Box(pad, pad, spec.width - pad, spec.height - pad)
        drawTitle(canvas, box)
        drawLegend(canvas, box)
        switch spec.type {
        case .pie, .doughnut: try drawPie(canvas, box)
        case .scatter: try drawScatter(canvas, box)
        case .histogram: try drawHistogram(canvas, box)
        case .box: try drawBoxPlot(canvas, box)
        case .dotplot: try drawDotPlot(canvas, box)
        default: try drawCategoryChart(canvas, box)
        }
        return scene
    }

    // MARK: Title & legend

    static func drawTitle(_ c: Canvas, _ box: Box) {
        let title = c.spec.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        let size = c.size * 1.25
        for line in c.scene.wrap(title, size: size, width: box.width, bold: true).prefix(2) {
            c.text(box.left + box.width / 2, box.top, line, size: size, bold: true, align: .center)
            box.top += size * lh
        }
        box.top += c.size * 0.4
    }

    static func legendEntries(_ spec: StudioChartSpec) -> [(String, String)] {
        guard spec.legend else { return [] }
        if spec.type.isRound {
            let values = spec.series[0].values
            return spec.categories.enumerated().compactMap { i, name in
                guard i < values.count, let v = values[i], v > 0, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
                return (name, spec.palette[i % spec.palette.count])
            }
        }
        return spec.series.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }.map { ($0.name, $0.color) }
    }

    static func drawLegend(_ c: Canvas, _ box: Box) {
        let entries = legendEntries(c.spec)
        guard !entries.isEmpty else { return }
        let swatch = c.size * 0.75, gap = c.size * 0.4
        if c.spec.legendPosition == .left || c.spec.legendPosition == .right {
            let limit = box.width * 0.35
            let labels = entries.map { c.fitted($0.0, max(1, limit - swatch - gap))[0] }
            let width = min(limit, swatch + gap + (labels.map { c.width($0) }.max() ?? 0))
            var shown = Array(zip(labels, entries.map(\.1)))
            shown = Array(shown.prefix(max(1, Int(box.height / c.line))))
            var top = box.top + (box.height - Double(shown.count) * c.line) / 2
            let left = c.spec.legendPosition == .right ? box.right - width : box.left
            for (label, colour) in shown {
                let squareTop = top + (c.line - swatch) / 2
                c.rect(CGRect(x: left, y: squareTop, width: swatch, height: swatch), colour)
                c.text(left + swatch + gap, top, label)
                top += c.line
            }
            if c.spec.legendPosition == .right { box.right = left - c.size * 0.8 } else { box.left = left + width + c.size * 0.8 }
            return
        }
        let spacing = c.size * 1.2
        let items = entries.map { name, colour -> (String, String, Double) in
            let label = c.fitted(name, box.width - swatch - gap)[0]
            return (label, colour, swatch + gap + c.width(label))
        }
        var rows: [[(String, String, Double)]] = [[]]
        var used = 0.0
        for item in items {
            var needed = item.2 + (rows[rows.count - 1].isEmpty ? 0 : spacing)
            if !rows[rows.count - 1].isEmpty && used + needed > box.width { rows.append([]); used = 0; needed = item.2 }
            rows[rows.count - 1].append(item)
            used += needed
        }
        var top: Double
        if c.spec.legendPosition == .top {
            top = box.top
            box.top = top + Double(rows.count) * c.line + c.size * 0.5
        } else {
            top = box.bottom - Double(rows.count) * c.line
            box.bottom = top - c.size * 0.5
        }
        for row in rows {
            let total = row.reduce(0) { $0 + $1.2 } + spacing * Double(row.count - 1)
            var x = box.left + (box.width - total) / 2
            for (label, colour, width) in row {
                let squareTop = top + (c.line - swatch) / 2
                c.rect(CGRect(x: x, y: squareTop, width: swatch, height: swatch), colour)
                c.text(x + swatch + gap, top, label)
                x += width + spacing
            }
            top += c.line
        }
    }

    // MARK: Axes

    static func labelStride(_ slot: Double, _ c: Canvas, _ labels: [String]) -> Int {
        let widest = labels.map { c.width($0) }.max() ?? 0
        let wanted = min(widest, c.size * 3)
        var stride = 1
        while slot * Double(stride) < wanted && stride < labels.count { stride += 1 }
        return stride
    }

    static func drawValueGrid(_ c: Canvas, _ plot: Box, _ ticks: Ticks, _ position: (Double) -> Double, vertical: Bool) {
        for value in ticks.values {
            let at = position(value)
            let text = formatNumber(value, ticks.decimals, c.spec.decimal)
            if vertical {
                if c.spec.grid { c.scene.line(from: CGPoint(x: plot.left, y: at), to: CGPoint(x: plot.right, y: at), gridColour, width: 0.5) }
                c.text(plot.left - c.size * 0.4, at - c.line / 2, text, align: .right, colour: axisColour)
            } else {
                if c.spec.grid { c.scene.line(from: CGPoint(x: at, y: plot.top), to: CGPoint(x: at, y: plot.bottom), gridColour, width: 0.5) }
                c.text(at, plot.bottom + c.size * 0.3, text, align: .center, colour: axisColour)
            }
        }
    }

    static func tickLabelWidth(_ c: Canvas, _ ticks: Ticks) -> Double {
        ticks.values.map { c.width(formatNumber($0, ticks.decimals, c.spec.decimal)) }.max() ?? 0
    }

    static func drawAxisTitles(_ c: Canvas, _ box: Box, upright: String, across: String) {
        let gap = c.size * 0.4
        let up = upright.trimmingCharacters(in: .whitespaces), ac = across.trimmingCharacters(in: .whitespaces)
        if !up.isEmpty {
            c.scene.uprightText(up, left: box.left, middle: box.top + box.height / 2, size: c.size, color: c.spec.color)
            box.left += c.line + gap
        }
        if !ac.isEmpty {
            c.text(box.left + box.width / 2, box.bottom - c.line, ac, align: .center)
            box.bottom -= c.line + gap
        }
    }

    static func valueRange(_ spec: StudioChartSpec, stacked: Bool) -> (Double, Double) {
        if stacked {
            let (pos, neg) = stacks(spec)
            return (min(0, neg.min() ?? 0), max(0, pos.max() ?? 0))
        }
        let present = spec.series.flatMap { $0.values.compactMap { $0 } }
        let low = present.min() ?? 0, high = present.max() ?? 0
        if spec.type == .line && low > 0 && low > high * 0.5 { return (low, high) }
        if spec.type == .line && high < 0 && high < low * 0.5 { return (low, high) }
        return (min(0, low), max(0, high))
    }

    static func stacks(_ spec: StudioChartSpec) -> ([Double], [Double]) {
        var pos = Array(repeating: 0.0, count: spec.categories.count), neg = pos
        for s in spec.series { for (i, v) in s.values.enumerated() { guard let v else { continue }; if v >= 0 { pos[i] += v } else { neg[i] += v } } }
        return (pos, neg)
    }

    static func drawCategoryChart(_ c: Canvas, _ box: Box) throws {
        let spec = c.spec
        let horizontal = spec.type == .bar
        let stacked = spec.stacked && spec.type.isStackable
        let (low, high) = valueRange(spec, stacked: stacked)
        let ticks = niceTicks(low, high)
        let count = Double(spec.categories.count)
        let size = c.size, gap = size * 0.4
        if horizontal { drawAxisTitles(c, box, upright: spec.categoryTitle, across: spec.valueTitle) } else { drawAxisTitles(c, box, upright: spec.valueTitle, across: spec.categoryTitle) }
        let plot: Box
        if horizontal {
            let labelWidth = min((spec.categories.map { c.width($0) }.max() ?? 0) + 1, box.width * 0.3)
            let tickHalf = tickLabelWidth(c, ticks) / 2
            plot = Box(box.left + labelWidth + gap, box.top + size * 0.2, box.right - tickHalf, box.bottom - c.line - size * 0.3)
        } else {
            let plotLeft = box.left + tickLabelWidth(c, ticks) + gap
            let slot = (box.right - plotLeft) / count
            let stride = labelStride(slot, c, spec.categories)
            let labelLines = spec.categories.map { c.fitted($0, slot * Double(stride) * 0.95, 2).count }.max() ?? 1
            plot = Box(plotLeft, box.top + c.line / 2, box.right, box.bottom - Double(labelLines) * c.line - size * 0.3)
        }
        if plot.width < size || plot.height < size { throw refuse("chartTooSmall") }
        let span = ticks.high - ticks.low
        let valueAt: (Double) -> Double = { v in
            let share = (v - ticks.low) / span
            return horizontal ? plot.left + share * plot.width : plot.bottom - share * plot.height
        }
        drawValueGrid(c, plot, ticks, valueAt, vertical: !horizontal)
        let slot = (horizontal ? plot.height : plot.width) / count
        let slotStart: (Int) -> Double = { i in horizontal ? plot.top + Double(i) * slot : plot.left + Double(i) * slot }
        let stride = horizontal ? 1 : labelStride(slot, c, spec.categories)
        for (i, label) in spec.categories.enumerated() where i % stride == 0 {
            if horizontal {
                let lines = c.fitted(label, plot.left - box.left - gap, 2)
                let top = slotStart(i) + (slot - Double(lines.count) * c.line) / 2
                for (n, line) in lines.enumerated() { c.text(plot.left - gap, top + Double(n) * c.line, line, align: .right) }
            } else {
                let lines = c.fitted(label, slot * Double(stride) * 0.95, 2)
                let middle = slotStart(i) + slot / 2
                for (n, line) in lines.enumerated() { c.text(middle, plot.bottom + size * 0.3 + Double(n) * c.line, line, align: .center) }
            }
        }
        let zero = valueAt(min(max(0, ticks.low), ticks.high))
        if spec.type == .line || spec.type == .area {
            drawLines(c, slot, slotStart, valueAt, stacked)
        } else {
            drawBars(c, slot, slotStart, valueAt, stacked, horizontal, horizontal ? plot.left : plot.bottom)
        }
        if horizontal { c.scene.line(from: CGPoint(x: zero, y: plot.top), to: CGPoint(x: zero, y: plot.bottom), axisColour, width: 0.75) } else { c.scene.line(from: CGPoint(x: plot.left, y: zero), to: CGPoint(x: plot.right, y: zero), axisColour, width: 0.75) }
    }

    static func barRect(_ horizontal: Bool, _ along: Double, _ across: Double, _ start: Double, _ end: Double) -> CGRect {
        horizontal ? CGRect(x: start, y: along, width: end - start, height: across) : CGRect(x: along, y: end, width: across, height: start - end)
    }

    static func drawBars(_ c: Canvas, _ slot: Double, _ slotStart: (Int) -> Double, _ valueAt: (Double) -> Double, _ stacked: Bool, _ horizontal: Bool, _ floor: Double) {
        let spec = c.spec
        let group = slot * 0.72
        let across = stacked ? group : group / Double(spec.series.count)
        let small = c.size * 0.85
        var positive = Array(repeating: 0.0, count: spec.categories.count), negative = positive
        for (si, series) in spec.series.enumerated() {
            for (i, value) in series.values.enumerated() {
                guard let value else { continue }
                var along = slotStart(i) + (slot - group) / 2
                let base: Double, top: Double
                if stacked {
                    base = value >= 0 ? positive[i] : negative[i]
                    top = base + value
                    if value >= 0 { positive[i] = top } else { negative[i] = top }
                } else {
                    along += Double(si) * across
                    base = 0; top = value
                }
                let start = valueAt(base), end = valueAt(top)
                c.rect(barRect(horizontal, along, across, start, end), series.color)
                guard spec.valueLabels else { continue }
                let text = plainNumber(value, spec.decimal)
                let centre = along + across / 2
                if stacked {
                    if abs(end - start) < c.line { continue }
                    let middle = (start + end) / 2
                    if horizontal { c.text(middle, centre - small * lh / 2, text, size: small, align: .center) } else { c.text(centre, middle - small * lh / 2, text, size: small, align: .center) }
                    continue
                }
                if horizontal {
                    var outward = value >= 0
                    if !outward && end - c.size * 0.25 - c.width(text, small) < floor { outward = true }
                    let x = end + (outward ? c.size * 0.25 : -c.size * 0.25)
                    c.text(x, centre - small * lh / 2, text, size: small, align: outward ? .left : .right)
                } else {
                    var y = value >= 0 ? end - small * lh : end
                    if value < 0 && y + small * lh > floor { y = end - small * lh }
                    c.text(centre, y, text, size: small, align: .center)
                }
            }
        }
    }

    static func drawLines(_ c: Canvas, _ slot: Double, _ slotStart: (Int) -> Double, _ valueAt: (Double) -> Double, _ stacked: Bool) {
        let spec = c.spec
        let weight = max(1, c.size / 7)
        let small = c.size * 0.85
        var running = Array(repeating: 0.0, count: spec.categories.count)
        for series in spec.series {
            var points: [CGPoint?] = []
            var lower: [CGPoint] = []
            for (i, value) in series.values.enumerated() {
                let x = slotStart(i) + slot / 2
                if spec.type == .area {
                    let base = stacked ? running[i] : 0
                    let top = base + (value ?? 0)
                    if stacked { running[i] = top }
                    points.append(CGPoint(x: x, y: valueAt(top)))
                    lower.append(CGPoint(x: x, y: valueAt(base)))
                } else {
                    points.append(value.map { CGPoint(x: x, y: valueAt($0)) })
                }
            }
            if spec.type == .area { c.scene.polygon(points.compactMap { $0 } + lower.reversed(), fill: series.color, fillOpacity: 0.35) }
            var run: [CGPoint] = []
            for point in points + [nil] {
                guard let point else {
                    if run.count > 1 { c.scene.polygon(run, fill: nil, stroke: series.color, width: weight, closed: false) }
                    run = []
                    continue
                }
                run.append(point)
            }
            for (i, point) in points.enumerated() {
                guard let point, let value = series.values[i] else { continue }
                if spec.type == .line { c.dot(point, weight * 1.7, series.color) }
                if spec.valueLabels { c.text(point.x, point.y - small * lh - weight, plainNumber(value, spec.decimal), size: small, align: .center) }
            }
        }
    }

    static func drawScatter(_ c: Canvas, _ box: Box) throws {
        let spec = c.spec
        var xs: [Double] = []
        for category in spec.categories {
            guard let v = StudioChartSettings.parseNumber(category) else { throw refuse("scatterNeedsNumbers") }
            xs.append(v)
        }
        let ys = spec.series.flatMap { $0.values.compactMap { $0 } }
        let xTicks = niceTicks(xs.min() ?? 0, xs.max() ?? 0), yTicks = niceTicks(ys.min() ?? 0, ys.max() ?? 0)
        let size = c.size, gap = size * 0.4
        drawAxisTitles(c, box, upright: spec.valueTitle, across: spec.categoryTitle)
        let plot = Box(box.left + tickLabelWidth(c, yTicks) + gap, box.top + c.line / 2, box.right - tickLabelWidth(c, xTicks) / 2, box.bottom - c.line - size * 0.3)
        if plot.width < size || plot.height < size { throw refuse("chartTooSmall") }
        let xAt: (Double) -> Double = { plot.left + ($0 - xTicks.low) / (xTicks.high - xTicks.low) * plot.width }
        let yAt: (Double) -> Double = { plot.bottom - ($0 - yTicks.low) / (yTicks.high - yTicks.low) * plot.height }
        drawValueGrid(c, plot, yTicks, yAt, vertical: true)
        drawValueGrid(c, plot, xTicks, xAt, vertical: false)
        c.scene.line(from: CGPoint(x: plot.left, y: plot.bottom), to: CGPoint(x: plot.right, y: plot.bottom), axisColour, width: 0.75)
        c.scene.line(from: CGPoint(x: plot.left, y: plot.top), to: CGPoint(x: plot.left, y: plot.bottom), axisColour, width: 0.75)
        let radius = max(1.5, size * 0.28), small = size * 0.85
        for series in spec.series {
            for (x, value) in zip(xs, series.values) {
                guard let value else { continue }
                let centre = CGPoint(x: xAt(x), y: yAt(value))
                c.dot(centre, radius, series.color)
                if spec.valueLabels { c.text(centre.x, centre.y - small * lh - radius, plainNumber(value, spec.decimal), size: small, align: .center) }
            }
        }
    }

    static func arc(_ centre: CGPoint, _ radius: Double, _ start: Double, _ end: Double) -> [CGPoint] {
        let steps = max(2, Int(ceil((end - start) * 180 / .pi / 2)))
        return (0...steps).map { s in
            let a = start + (end - start) * Double(s) / Double(steps)
            return CGPoint(x: centre.x + radius * cos(a), y: centre.y + radius * sin(a))
        }
    }

    static func drawPie(_ c: Canvas, _ box: Box) throws {
        let spec = c.spec
        let values = spec.series[0].values.map { ($0 ?? 0) > 0 ? $0! : 0 }
        let total = values.reduce(0, +)
        guard total > 0 else { throw refuse("pieNeedsPositive") }
        let outside = spec.valueLabels && !spec.legend
        let labels = zip(spec.categories, values).map { outside ? "\($0.0) \(percentText($0.1 / total, spec.decimal))%" : "" }
        let reach = labels.map { c.width($0) }.max() ?? 0
        let marginX = outside ? reach + c.size : 0, marginY = outside ? c.line : 0
        let radius = min(box.width / 2 - marginX, box.height / 2 - marginY)
        if radius < c.size { throw refuse("chartTooSmall") }
        let centre = CGPoint(x: box.left + box.width / 2, y: box.top + box.height / 2)
        let hole = spec.type == .doughnut ? radius * 0.55 : 0
        let small = c.size * 0.85
        var angle = -Double.pi / 2
        for (i, value) in values.enumerated() where value > 0 {
            let sweep = value / total * 2 * .pi
            let colour = spec.palette[i % spec.palette.count]
            let outer = arc(centre, radius, angle, angle + sweep)
            let inner = hole > 0 ? Array(arc(centre, hole, angle, angle + sweep).reversed()) : [centre]
            let separator = value < total ? white : nil
            c.scene.polygon(outer + inner, fill: colour, stroke: separator, width: separator == nil ? 0 : 1)
            let middle = angle + sweep / 2
            if spec.valueLabels {
                let share = percentText(value / total, spec.decimal) + "%"
                if outside {
                    let anchor = radius + c.size * 0.5
                    c.text(centre.x + anchor * cos(middle), centre.y + anchor * sin(middle) - c.line / 2, labels[i], align: cos(middle) >= 0 ? .left : .right)
                } else if sweep > 0.25 {
                    let distance = hole > 0 ? (radius + hole) / 2 : radius * 0.62
                    let (r, g, b) = StudioColor.components(colour)
                    let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
                    c.text(centre.x + distance * cos(middle), centre.y + distance * sin(middle) - small * lh / 2, share, size: small, align: .center, colour: lum > 0.6 ? StudioColor.hex(0.1, 0.1, 0.1) : white)
                }
            }
            angle += sweep
        }
    }

    // MARK: Statistics (editor_chart_stats.py)

    static func samples(_ spec: StudioChartSpec) -> [[Double]] { spec.series.map { $0.values.compactMap { $0 } } }

    static func niceWidth(_ raw: Double) -> Double {
        let magnitude = pow(10, floor(log10(raw)))
        return [1, 2, 2.5, 5, 10].map { $0 * magnitude }.min { abs(log($0 / raw)) < abs(log($1 / raw)) } ?? raw
    }

    struct Bins {
        var start: Double, width: Double, count: Int
        var edges: [Double] { (0...count).map { start + Double($0) * width } }
        func index(_ v: Double) -> Int { min(count - 1, max(0, Int(floor((v - start) / width + 1e-9)))) }
    }

    static func histogramBins(_ values: [Double], _ bins: Int?) -> Bins {
        let low = values.min() ?? 0, high = values.max() ?? 0
        if high - low < 1e-12 { return Bins(start: low - 0.5, width: 1, count: 1) }
        if let bins, bins > 0 { return Bins(start: low, width: (high - low) / Double(bins), count: bins) }
        let wanted = min(30, Int(ceil(log2(Double(values.count)) + 1)))
        let width = niceWidth((high - low) / Double(wanted))
        let start = floor(low / width + 1e-9) * width
        return Bins(start: start, width: width, count: max(1, Int(ceil((high - start) / width - 1e-9))))
    }

    static func quantile(_ ordered: [Double], _ share: Double) -> Double {
        let position = Double(ordered.count - 1) * share
        let below = Int(floor(position)), above = min(below + 1, ordered.count - 1)
        return ordered[below] + (ordered[above] - ordered[below]) * (position - Double(below))
    }

    static func countTicks(_ highest: Int) -> Ticks {
        let ticks = niceTicks(0, Double(max(1, highest)))
        if ticks.step < 1 { return Ticks(low: 0, high: Double(max(1, highest)), step: 1, decimals: 0) }
        return Ticks(low: 0, high: ticks.high, step: ticks.step, decimals: 0)
    }

    static func plotBox(_ c: Canvas, _ box: Box, _ leftTicks: Ticks?, _ bottomLabels: Int) throws -> Box {
        let size = c.size, gap = size * 0.4
        let left = box.left + (leftTicks.map { tickLabelWidth(c, $0) + gap } ?? size * 0.5)
        let plot = Box(left, box.top + c.line / 2, box.right - size, box.bottom - Double(bottomLabels) * c.line - size * 0.3)
        if plot.width < size || plot.height < size { throw refuse("chartTooSmall") }
        return plot
    }

    static func edgeLabels(_ c: Canvas, _ plot: Box, _ positions: [(Double, String)]) {
        let widest = positions.map { c.width($0.1) }.max() ?? 0
        let spacing = positions.count > 1 ? plot.width / Double(positions.count - 1) : plot.width
        let stride = max(1, Int(ceil((widest + c.size) / max(spacing, 1e-6))))
        for (i, (at, text)) in positions.enumerated() where i % stride == 0 { c.text(at, plot.bottom + c.size * 0.3, text, align: .center) }
    }

    static func drawHistogram(_ c: Canvas, _ box: Box) throws {
        let spec = c.spec
        let s = samples(spec)
        let bins = histogramBins(s.flatMap { $0 }, spec.bins)
        var counts = s.map { _ in Array(repeating: 0, count: bins.count) }
        for (si, values) in s.enumerated() { for v in values { counts[si][bins.index(v)] += 1 } }
        let ticks = countTicks(counts.map { $0.max() ?? 0 }.max() ?? 0)
        drawAxisTitles(c, box, upright: spec.valueTitle, across: spec.categoryTitle)
        let plot = try plotBox(c, box, ticks, 1)
        let yAt: (Double) -> Double = { plot.bottom - ($0 - ticks.low) / (ticks.high - ticks.low) * plot.height }
        drawValueGrid(c, plot, ticks, yAt, vertical: true)
        let slot = plot.width / Double(bins.count), across = slot / Double(s.count)
        let small = c.size * 0.85
        for (si, series) in spec.series.enumerated() {
            for (bi, count) in counts[si].enumerated() where count > 0 {
                let left = plot.left + Double(bi) * slot + Double(si) * across
                let rect = CGRect(x: left, y: yAt(Double(count)), width: across, height: plot.bottom - yAt(Double(count)))
                c.rect(rect, series.color)
                c.scene.strokeRect(rect, white, width: 0.5)
                if spec.valueLabels { c.text(left + across / 2, rect.minY - small * lh, String(count), size: small, align: .center) }
            }
        }
        let decimals = bins.width < 1 ? max(0, -Int(floor(log10(bins.width) + 1e-9))) : 0
        edgeLabels(c, plot, bins.edges.enumerated().map { (plot.left + Double($0.offset) * slot, String(format: "%.\(decimals)f", $0.element).replacingOccurrences(of: ".", with: spec.decimal)) })
        c.scene.line(from: CGPoint(x: plot.left, y: plot.bottom), to: CGPoint(x: plot.right, y: plot.bottom), axisColour, width: 0.75)
    }

    static func drawBoxPlot(_ c: Canvas, _ box: Box) throws {
        let spec = c.spec
        let s = samples(spec)
        let present = s.flatMap { $0 }
        let ticks = niceTicks(present.min() ?? 0, present.max() ?? 0)
        drawAxisTitles(c, box, upright: spec.valueTitle, across: spec.categoryTitle)
        let names = spec.series.map { $0.name.trimmingCharacters(in: .whitespaces) }
        let plot = try plotBox(c, box, ticks, names.contains { !$0.isEmpty } ? 1 : 0)
        let yAt: (Double) -> Double = { plot.bottom - ($0 - ticks.low) / (ticks.high - ticks.low) * plot.height }
        drawValueGrid(c, plot, ticks, yAt, vertical: true)
        let slot = plot.width / Double(s.count)
        let weight = max(0.75, c.size / 12), small = c.size * 0.85
        for (i, (series, values)) in zip(spec.series, s).enumerated() {
            let middle = plot.left + slot * (Double(i) + 0.5)
            if !names[i].isEmpty { c.text(middle, plot.bottom + c.size * 0.3, c.fitted(names[i], slot * 0.95)[0], align: .center) }
            guard !values.isEmpty else { continue }
            let ordered = values.sorted()
            let q1 = quantile(ordered, 0.25), median = quantile(ordered, 0.5), q3 = quantile(ordered, 0.75)
            let reachV = (q3 - q1) * 1.5
            let inside = ordered.filter { $0 >= q1 - reachV && $0 <= q3 + reachV }
            let outliers = ordered.filter { $0 < q1 - reachV || $0 > q3 + reachV }
            let half = slot * 0.5 / 2, cap = half * 0.5
            let rect = CGRect(x: middle - half, y: yAt(q3), width: half * 2, height: yAt(q1) - yAt(q3))
            c.rect(rect, series.color, 0.3)
            c.scene.strokeRect(rect, series.color, width: weight)
            for (end, edge) in [(inside.last ?? q3, q3), (inside.first ?? q1, q1)] {
                c.scene.line(from: CGPoint(x: middle, y: yAt(edge)), to: CGPoint(x: middle, y: yAt(end)), series.color, width: weight)
                c.scene.line(from: CGPoint(x: middle - cap, y: yAt(end)), to: CGPoint(x: middle + cap, y: yAt(end)), series.color, width: weight)
            }
            let at = yAt(median)
            c.scene.line(from: CGPoint(x: middle - half, y: at), to: CGPoint(x: middle + half, y: at), series.color, width: weight * 2)
            for v in outliers { c.dot(CGPoint(x: middle, y: yAt(v)), max(1.5, c.size * 0.22), series.color) }
            if spec.valueLabels { c.text(middle + half + c.size * 0.25, at - small * lh / 2, plainNumber(median, spec.decimal), size: small) }
        }
        c.scene.line(from: CGPoint(x: plot.left, y: plot.bottom), to: CGPoint(x: plot.right, y: plot.bottom), axisColour, width: 0.75)
    }

    static func dotColumns(_ points: [(Double, Int)], _ origin: Double, _ diameter: Double) -> [(Double, [Int])] {
        var order: [Int] = []
        var buckets: [Int: (Double, [Int])] = [:]
        for (x, si) in points {
            let bucket = Int(((x - origin) / diameter).rounded(.toNearestOrEven))
            if buckets[bucket] == nil { buckets[bucket] = (x, []); order.append(bucket) }
            buckets[bucket]!.1.append(si)
        }
        return order.compactMap { buckets[$0] }
    }

    static func drawDotPlot(_ c: Canvas, _ box: Box) throws {
        let spec = c.spec
        let s = samples(spec)
        let present = s.flatMap { $0 }
        let ticks = niceTicks(present.min() ?? 0, present.max() ?? 0)
        drawAxisTitles(c, box, upright: "", across: spec.categoryTitle)
        let plot = try plotBox(c, box, nil, 1)
        plot.left += tickLabelWidth(c, ticks) / 2
        plot.right -= tickLabelWidth(c, ticks) / 2 - c.size
        let xAt: (Double) -> Double = { plot.left + ($0 - ticks.low) / (ticks.high - ticks.low) * plot.width }
        var points: [(Double, Int)] = []
        for (si, values) in s.enumerated() { for v in values { points.append((xAt(v), si)) } }
        points.sort { a, b in a.0 != b.0 ? a.0 < b.0 : a.1 < b.1 }
        var radius = c.size * 0.35
        for _ in 0..<3 {
            let columns = dotColumns(points, plot.left, 2 * radius)
            let fitted = plot.height / (2 * Double(columns.map { $0.1.count }.max() ?? 1) + 0.4)
            if fitted >= radius { break }
            radius = max(0.8, fitted)
        }
        let columns = dotColumns(points, plot.left, 2 * radius)
        drawValueGrid(c, plot, ticks, xAt, vertical: false)
        c.scene.line(from: CGPoint(x: plot.left, y: plot.bottom), to: CGPoint(x: plot.right, y: plot.bottom), axisColour, width: 0.75)
        for (x, stack) in columns {
            for (level, si) in stack.enumerated() {
                c.scene.circle(CGPoint(x: x, y: plot.bottom - radius * (2 * Double(level) + 1.2)), radius: radius, fill: spec.series[si].color)
            }
        }
    }
}
