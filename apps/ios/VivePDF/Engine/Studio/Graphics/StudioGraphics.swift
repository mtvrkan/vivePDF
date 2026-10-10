import CoreGraphics
import Foundation

/// Tables, charts, flowcharts and formulas stored in `svg` elements (`graphics/graphicData.ts`,
/// `graphicColors.ts`, `graphicSync.ts`, `graphicEditor.ts`). Rendering is synchronous and native:
/// data edits re-render the stored SVG markup immediately, and the canvas / PDF draw from the data.
enum StudioGraphics {
    static let chartFrame = (minWidth: 120.0, maxWidth: 1200.0, minHeight: 80.0, maxHeight: 1200.0, minFont: 4.0, maxFont: 36.0)

    static func graphic(_ svg: StudioSVG) -> StudioGraphic? { StudioGraphic(svg) }
    static func graphic(of element: StudioElement) -> StudioGraphic? { element.svg.flatMap(graphic) }

    /// `keepsRatio`: flowcharts and formulas resize proportionally.
    static func keepsRatio(_ element: StudioElement) -> Bool {
        switch graphic(of: element) {
        case .flowchart, .formula: true
        default: false
        }
    }

    // MARK: Texts & colours

    /// Texts inside the graphic data (placeholders, find & replace) — table cells, like the desktop.
    static func texts(of svg: StudioSVG) -> [String] {
        if case .table(let t)? = graphic(svg) { return t.cells.flatMap { $0 } }
        return []
    }

    /// Replaces table cell texts (find & replace); nil when nothing changed or not a table.
    static func replacingTexts(_ svg: StudioSVG, width: Double, _ change: (String) -> String) -> StudioSVG? {
        guard case .table(var t)? = graphic(svg) else { return nil }
        let next = t.cells.map { $0.map(change) }
        guard next != t.cells else { return nil }
        t.cells = next
        var result = svg
        result.data = t.json
        return result
    }

    private static func seriesColors(_ s: StudioChartSettings) -> [String] {
        if s.type.isRound { return [] }
        let count = max(0, (s.cells.first?.count ?? 1) - 1)
        return (0..<count).map { $0 < s.colors.count ? s.colors[$0] : s.palette.color($0) }
    }

    private static func tableColors(_ t: StudioTableData) -> [String] {
        let cells = t.styles.flatMap { $0.flatMap { [$0.fill, $0.color].compactMap { $0 } } }
        return [t.color, t.borderColor, t.headerFill, t.stripes ? t.stripeFill : nil].compactMap { $0 } + cells
    }

    /// Colours used by the graphic, or nil when the element is plain imported SVG.
    static func colors(of svg: StudioSVG) -> [String]? {
        switch graphic(svg) {
        case .table(let t)?: return tableColors(t)
        case .chart(let s, _)?: return seriesColors(s) + [s.color]
        case .flowchart(let s, _, _)?: return [s.color, s.stroke, s.fill].compactMap { $0 }
        case .formula(let f)?: return [f.color]
        case nil: return nil
        }
    }

    /// Recolours graphic data (and its markup); nil when the element is plain imported SVG.
    static func swapColors(_ svg: StudioSVG, _ swap: (String) -> String) -> StudioSVG? {
        guard let g = graphic(svg) else { return nil }
        let before = colors(of: svg) ?? []
        let after = before.map(swap)
        guard zip(before, after).contains(where: { $0.0.lowercased() != $0.1.lowercased() }) else { return svg }
        var result = svg
        switch g {
        case .table(var t):
            t.color = swap(t.color)
            t.borderColor = swap(t.borderColor)
            t.headerFill = t.headerFill.map(swap)
            t.stripeFill = t.stripeFill.map(swap)
            t.styles = t.styles.map { $0.map { var s = $0; s.fill = s.fill.map(swap); s.color = s.color.map(swap); return s } }
            result.data = t.json
        case .chart(var s, let rendered):
            if !s.type.isRound { s.colors = seriesColors(s).map(swap) }
            s.color = swap(s.color)
            result.data = StudioGraphic.chart(s, rendered: rendered).data
        case .flowchart(var s, let rendered, let layout):
            s.color = swap(s.color); s.stroke = swap(s.stroke); s.fill = s.fill.map(swap)
            result.data = StudioGraphic.flowchart(s, rendered: rendered, layout: layout).data
        case .formula(var f):
            f.color = swap(f.color)
            result.svg = StudioFormulaMarkup.svg(f)
            result.data = StudioGraphic.formula(f).data
        }
        return result
    }

    // MARK: Specs & render keys

    static func chartFrame(width: Double, height: Double) -> (width: Double, height: Double, scale: Double) {
        let f = chartFrame
        let down = max(1, width / f.maxWidth, height / f.maxHeight)
        let up = min(1, width / f.minWidth, height / f.minHeight)
        let scale = down > 1 ? down : up
        return (min(f.maxWidth, max(f.minWidth, width / scale)), min(f.maxHeight, max(f.minHeight, height / scale)), scale)
    }

    static func chartSpec(_ s: StudioChartSettings, width: Double, height: Double) -> StudioChartSpec? {
        let frame = chartFrame(width: width, height: height)
        var sized = s
        sized.width = frame.width
        sized.height = frame.height
        sized.fontSize = min(chartFrame.maxFont, max(chartFrame.minFont, s.fontSize / frame.scale))
        let data = sized.data()
        return data.blank ? nil : data.spec
    }

    static func key(table spec: StudioTableSpec) -> String { key(kind: "table", spec.keyJSON) }

    static func key(chart s: StudioChartSpec) -> String {
        key(kind: "chart", .object([
            ("type", .string(s.type.rawValue)), ("categories", .array(s.categories.map { .string($0) })),
            ("series", .array(s.series.map { .object([("name", .string($0.name)), ("color", .string($0.color)), ("values", .array($0.values.map { $0.map { .number($0) } ?? .null }))]) })),
            ("title", .string(s.title)), ("categoryTitle", .string(s.categoryTitle)), ("valueTitle", .string(s.valueTitle)),
            ("legend", .bool(s.legend)), ("legendPosition", .string(s.legendPosition.rawValue)), ("grid", .bool(s.grid)), ("valueLabels", .bool(s.valueLabels)),
            ("stacked", .bool(s.stacked)), ("width", .number(s.width)), ("height", .number(s.height)), ("fontSize", .number(s.fontSize)),
            ("fontId", .string(s.fontId)), ("color", .string(s.color)), ("palette", .array(s.palette.map { .string($0) })),
            ("decimal", .string(s.decimal)), ("bins", s.bins.map { .number(Double($0)) } ?? .null),
        ]))
    }

    static func key(flowchart settings: StudioFlowchartSettings) -> String {
        let s = settings.spec
        return key(kind: "flowchart", .object([
            ("nodes", .array(s.nodes.map { .object([("id", .string($0.id)), ("shape", .string($0.shape.rawValue)), ("text", .string($0.text))]) })),
            ("edges", .array(s.edges.map { .object([("source", .string($0.source)), ("target", .string($0.target)), ("label", .string($0.label))]) })),
            ("direction", .string(s.direction.rawValue)), ("fontSize", .number(s.fontSize)), ("fontId", .string(s.fontId)),
            ("color", .string(s.color)), ("stroke", .string(s.stroke)), ("fill", s.fill.map { .string($0) } ?? .null),
        ]))
    }

    private static func key(kind: String, _ spec: StudioOrderedJSON) -> String {
        StudioOrderedJSON.hash(StudioOrderedJSON.object([("kind", .string(kind)), ("spec", spec)]).stringified)
    }

    /// `stretchSvg`: the stored markup always fills the element box.
    static func stretch(_ svg: String) -> String {
        guard let range = svg.range(of: "<svg\\b[^>]*>", options: .regularExpression) else { return svg }
        var tag = String(svg[range])
        if tag.range(of: "\\spreserveAspectRatio=", options: .regularExpression) != nil {
            tag = tag.replacingOccurrences(of: "\\spreserveAspectRatio=\"[^\"]*\"", with: " preserveAspectRatio=\"none\"", options: .regularExpression)
        } else {
            tag = tag.replacingOccurrences(of: "^<svg\\b", with: "<svg preserveAspectRatio=\"none\"", options: .regularExpression)
        }
        var out = svg
        out.replaceSubrange(range, with: tag)
        return out
    }

    // MARK: Rendering

    /// Brings the stored markup (and the table height / flowchart size) up to date with the data —
    /// `graphicSync` + `withRendered`. Returns the element unchanged when it is already current.
    static func rerender(_ element: StudioElement) throws -> StudioElement {
        guard var svg = element.svg, let g = graphic(svg) else { return element }
        var next = element
        switch g {
        case .table(var t):
            let spec = StudioTableSpec(t, width: element.width)
            let k = key(table: spec)
            guard k != t.rendered else { return element }
            let result = try StudioTableRenderer.render(spec)
            svg.svg = stretch(result.scene.svg())
            if result.scene.width > 0 { next.height = result.scene.height * element.width / result.scene.width }
            t.rendered = k
            t.layout = StudioTableLayout(width: result.scene.width, height: result.scene.height, rows: result.rowHeights, columns: result.columnWidths)
            svg.data = t.json
        case .chart(let s, let rendered):
            guard let spec = chartSpec(s, width: element.width, height: element.height) else { return element }
            let k = key(chart: spec)
            guard k != rendered else { return element }
            svg.svg = stretch(try StudioChartRenderer.render(spec).svg())
            svg.data = StudioGraphic.chart(s, rendered: k).data
        case .flowchart(let s, let rendered, let layout):
            guard !s.isBlank else { return element }
            let k = key(flowchart: s)
            guard k != rendered else { return element }
            let scene = try StudioFlowchartRenderer.render(s)
            let scale = layout.map { element.width / Double($0.width) } ?? element.width / scene.width
            svg.svg = stretch(scene.svg())
            next.width = scene.width * scale
            next.height = scene.height * scale
            svg.data = StudioGraphic.flowchart(s, rendered: k, layout: CGSize(width: scene.width, height: scene.height)).data
        case .formula:
            return element
        }
        next.content = .svg(svg)
        return next
    }

    /// Replaces the graphic data and re-renders; keeps the old markup if rendering is refused.
    static func updating(_ element: StudioElement, to graphic: StudioGraphic) -> StudioElement {
        guard var svg = element.svg else { return element }
        svg.data = graphic.data
        if case .formula(let f) = graphic { svg.svg = StudioFormulaMarkup.svg(f) }
        var next = element
        next.content = .svg(svg)
        return (try? rerender(next)) ?? next
    }

    private static let cache = NSCache<NSString, Box>()
    private final class Box { let scene: StudioGraphicScene; init(_ s: StudioGraphicScene) { scene = s } }

    private static func cached(_ key: String, _ make: () throws -> StudioGraphicScene) -> StudioGraphicScene? {
        if let hit = cache.object(forKey: key as NSString) { return hit.scene }
        guard let scene = try? make() else { return nil }
        cache.setObject(Box(scene), forKey: key as NSString)
        return scene
    }

    /// Draws a table/chart/flowchart/formula natively; false for plain imported SVG. The context is in
    /// element space; `values` fill `{field}` placeholders in table cells (mail merge).
    static func draw(_ svg: StudioSVG, in rect: CGRect, context: CGContext, values: [String: String]) -> Bool {
        guard let g = graphic(svg) else { return false }
        let fallback = { StudioSVGRenderer.draw(svg.svg, in: rect, context: context) }
        let revision = StudioFonts.shared.revision
        switch g {
        case .table(var t):
            let filled = !values.isEmpty && t.cells.contains { $0.contains { StudioPlaceholders.has($0) } }
            if filled { t.cells = t.cells.map { $0.map { StudioPlaceholders.fill($0, values) } } }
            let spec = StudioTableSpec(t, width: rect.width)
            guard let scene = cached("t|\(revision)|\(key(table: spec))", { try StudioTableRenderer.render(spec).scene }) else { fallback(); return true }
            if filled {
                // `_fitted`: keep the element's aspect, shrinking a taller merged table to fit.
                let wanted = scene.width * rect.height / max(rect.width, 0.0001)
                let scale = min(1, wanted / scene.height)
                let placedWidth = scene.width * scale
                let sx = rect.width / scene.width, sy = rect.height / wanted
                let target = CGRect(x: rect.minX + (scene.width - placedWidth) / 2 * sx, y: rect.minY, width: placedWidth * sx, height: scene.height * scale * sy)
                scene.draw(in: target, context: context)
            } else {
                scene.draw(in: rect, context: context)
            }
        case .chart(let s, _):
            guard let spec = chartSpec(s, width: rect.width, height: rect.height),
                  let scene = cached("c|\(revision)|\(key(chart: spec))", { try StudioChartRenderer.render(spec) }) else { fallback(); return true }
            scene.draw(in: rect, context: context)
        case .flowchart(let s, _, _):
            guard !s.isBlank, let scene = cached("f|\(revision)|\(key(flowchart: s))", { try StudioFlowchartRenderer.render(s) }) else { fallback(); return true }
            scene.draw(in: rect, context: context)
        case .formula(let f):
            StudioSVGRenderer.draw(StudioFormulaMarkup.svg(f), in: rect, context: context)
        }
        return true
    }

    // MARK: Creation (graphicEditor.ts / GraphicEditorHost.tsx)

    static func centred(page: CGSize, width: Double, height: Double) -> CGPoint {
        CGPoint(x: (page.width - width) / 2, y: (page.height - height) / 2)
    }

    static func element(_ source: StudioSvgSource, svg: String, frame: CGRect, data: StudioJSONValue) -> StudioElement {
        StudioFactory.svg(stretch(svg), source: source, data: data, x: frame.minX, y: frame.minY, width: frame.width, height: frame.height)
    }

    /// `insertTable`: a blank rows × columns table centred on the page.
    static func newTable(rows: Int, columns: Int, page: CGSize, look: StudioTableLook? = nil) throws -> StudioElement {
        var data = StudioTableData.create(rows: rows, columns: columns, look: look ?? StudioTableStyleId.classic.look)
        let width = min(page.width * 0.8, max(200, Double(columns) * 90))
        let spec = StudioTableSpec(data, width: width)
        let result = try StudioTableRenderer.render(spec)
        let height = result.scene.height * width / result.scene.width
        data.rendered = key(table: spec)
        data.layout = StudioTableLayout(width: result.scene.width, height: result.scene.height, rows: result.rowHeights, columns: result.columnWidths)
        let origin = centred(page: page, width: width, height: height)
        return element(.table, svg: result.scene.svg(), frame: CGRect(x: origin.x, y: origin.y, width: width, height: height), data: data.json)
    }

    /// Default box for a new chart (`chartBox`).
    static func chartBox(page: CGSize) -> CGSize {
        let width = min(page.width * 0.7, 480)
        return CGSize(width: width, height: min(width * 2 / 3, page.height * 0.7))
    }

    /// Inserts or updates a chart from dialog settings (font size in frame units, like ChartDialog).
    static func chartElement(_ settings: StudioChartSettings, box: CGSize, page: CGSize, editing: StudioElement?) throws -> StudioElement {
        guard let spec = chartSpec(settings, width: box.width, height: box.height) else { throw StudioGraphicError(reason: "chartNoData") }
        let svg = try StudioChartRenderer.render(spec).svg()
        let data = StudioGraphic.chart(settings, rendered: key(chart: spec)).data
        if var existing = editing, var s = existing.svg {
            s.svg = stretch(svg)
            s.data = data
            existing.content = .svg(s)
            return existing
        }
        let origin = centred(page: page, width: box.width, height: box.height)
        return element(.chart, svg: svg, frame: CGRect(origin: origin, size: box), data: data)
    }

    static func flowchartElement(_ settings: StudioFlowchartSettings, page: CGSize, editing: StudioElement?) throws -> StudioElement {
        let scene = try StudioFlowchartRenderer.render(settings)
        let layout = CGSize(width: scene.width, height: scene.height)
        let data = StudioGraphic.flowchart(settings, rendered: key(flowchart: settings), layout: layout).data
        if var existing = editing, var s = existing.svg {
            var previous = scene.width
            if case .flowchart(_, _, let l?)? = graphic(s) { previous = l.width }
            let scale = existing.width / previous
            s.svg = stretch(scene.svg())
            s.data = data
            existing.width = scene.width * scale
            existing.height = scene.height * scale
            existing.content = .svg(s)
            return existing
        }
        let scale = min(1, page.width * 0.8 / scene.width, page.height * 0.8 / scene.height)
        let w = scene.width * scale, h = scene.height * scale
        return element(.flowchart, svg: scene.svg(), frame: CGRect(origin: centred(page: page, width: w, height: h), size: CGSize(width: w, height: h)), data: data)
    }

    static func formulaElement(_ formula: StudioFormulaSource, size: Double, page: CGSize, editing: StudioElement?) -> StudioElement {
        let box = formula.box(size: size)
        let data = StudioGraphic.formula(formula).data
        if var existing = editing, var s = existing.svg {
            s.svg = StudioFormulaMarkup.svg(formula)
            s.data = data
            existing.width = box.width
            existing.height = box.height
            existing.content = .svg(s)
            return existing
        }
        return StudioFactory.svg(StudioFormulaMarkup.svg(formula), source: .formula, data: data, x: centred(page: page, width: box.width, height: box.height).x,
                                 y: centred(page: page, width: box.width, height: box.height).y, width: box.width, height: box.height)
    }
}
