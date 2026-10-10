import CoreGraphics
import Foundation

// Graphic data stored in `svg` elements (`graphics/graphicData.ts`, `tableModel.ts`, the viewer's
// `chartModel.ts` / `flowchartModel.ts` / `formulaSvg.ts`). JSON shapes match the desktop exactly.

// MARK: - JSON helpers

enum StudioGraphicJSON {
    static func record(_ v: StudioJSONValue?) -> [String: StudioJSONValue]? {
        if case .object(let o)? = v { return o }
        return nil
    }

    static func finite(_ v: StudioJSONValue?, _ fallback: Double, _ lo: Double, _ hi: Double) -> Double {
        guard case .number(let n)? = v, n.isFinite else { return fallback }
        return min(hi, max(lo, n))
    }

    static func text(_ v: StudioJSONValue?, _ limit: Int) -> String {
        guard case .string(let s)? = v else { return "" }
        return s.count > limit ? String(s.prefix(limit)) : s
    }

    static func colour(_ v: StudioJSONValue?, _ fallback: String) -> String {
        if case .string(let s)? = v, StudioJSON.isColour(s) { return s.lowercased() }
        return fallback
    }

    static func optionalColour(_ v: StudioJSONValue?) -> String? {
        if case .string(let s)? = v, StudioJSON.isColour(s) { return s.lowercased() }
        return nil
    }

    static func bool(_ v: StudioJSONValue?) -> Bool? {
        if case .bool(let b)? = v { return b }
        return nil
    }

    static func oneOf<T: RawRepresentable>(_ v: StudioJSONValue?, _ fallback: T) -> T where T.RawValue == String {
        if case .string(let s)? = v, let value = T(rawValue: s) { return value }
        return fallback
    }

    static func string(_ s: String?) -> StudioJSONValue { s.map { .string($0) } ?? .null }
}

// MARK: - Table

enum StudioTableAlign: String, CaseIterable, Hashable { case left, center, right }
enum StudioTableBorder: String, CaseIterable, Hashable { case all, horizontal, outer, none }

struct StudioTableCellStyle: Equatable, Hashable {
    var fill: String?
    var color: String?
    var align: StudioTableAlign?
    var bold: Bool?
    var isEmpty: Bool { fill == nil && color == nil && align == nil && bold == nil }
}

struct StudioTableLayout: Equatable, Hashable {
    var width: Double
    var height: Double
    var rows: [Double]
    var columns: [Double]
}

struct StudioTableLook: Equatable {
    var header: Bool
    var stripes: Bool
    var stripeFill: String?
    var border: StudioTableBorder
    var borderColor: String
    var borderWidth: Double
    var color: String
    var headerFill: String?
}

enum StudioTableStyleId: String, CaseIterable, Identifiable {
    case classic, blue, green, warm, minimal, plain
    var id: String { rawValue }
    var look: StudioTableLook {
        switch self {
        case .classic: StudioTableLook(header: true, stripes: false, stripeFill: nil, border: .all, borderColor: "#404040", borderWidth: 0.75, color: "#111111", headerFill: "#e5e7eb")
        case .blue: StudioTableLook(header: true, stripes: true, stripeFill: "#eff6ff", border: .all, borderColor: "#1e3a8a", borderWidth: 0.75, color: "#0f172a", headerFill: "#bfdbfe")
        case .green: StudioTableLook(header: true, stripes: true, stripeFill: "#f0fdf4", border: .horizontal, borderColor: "#166534", borderWidth: 0.75, color: "#052e16", headerFill: "#bbf7d0")
        case .warm: StudioTableLook(header: true, stripes: true, stripeFill: "#fff7ed", border: .outer, borderColor: "#9a3412", borderWidth: 1, color: "#1c1917", headerFill: "#fed7aa")
        case .minimal: StudioTableLook(header: true, stripes: false, stripeFill: nil, border: .horizontal, borderColor: "#9ca3af", borderWidth: 0.5, color: "#111111", headerFill: nil)
        case .plain: StudioTableLook(header: false, stripes: false, stripeFill: nil, border: .none, borderColor: "#111111", borderWidth: 0.75, color: "#111111", headerFill: nil)
        }
    }
}

struct StudioCellRef: Equatable, Hashable { var row: Int; var column: Int }

struct StudioCellRange: Equatable, Hashable {
    var anchor: StudioCellRef
    var focus: StudioCellRef
    var top: Int { min(anchor.row, focus.row) }
    var bottom: Int { max(anchor.row, focus.row) }
    var left: Int { min(anchor.column, focus.column) }
    var right: Int { max(anchor.column, focus.column) }
    func contains(_ c: StudioCellRef) -> Bool { c.row >= top && c.row <= bottom && c.column >= left && c.column <= right }
    static func cell(_ row: Int, _ column: Int) -> StudioCellRange { StudioCellRange(anchor: StudioCellRef(row: row, column: column), focus: StudioCellRef(row: row, column: column)) }
}

struct StudioTableData: Equatable, Hashable {
    static let limits = (rows: 60, columns: 20, cellChars: 2000)
    static let minColumnWidth = 12.0
    static let minFont = 4.0
    static let maxFont = 72.0
    static let maxBorderWidth = 20.0
    static let defaultFontId = "bundled:dejavu-sans"

    var cells: [[String]]
    var styles: [[StudioTableCellStyle]]
    var columns: [Double]
    var align: [StudioTableAlign]
    var header: Bool
    var stripes: Bool
    var stripeFill: String?
    var border: StudioTableBorder
    var borderColor: String
    var borderWidth: Double
    var color: String
    var headerFill: String?
    var fontSize: Double
    var fontId: String
    var rendered: String = ""
    var layout: StudioTableLayout? = nil

    var columnCount: Int { cells.first?.count ?? 0 }

    static func create(rows: Int, columns: Int, look: StudioTableLook = StudioTableStyleId.classic.look, fontSize: Double = 12, fontId: String = defaultFontId) -> StudioTableData {
        let r = max(1, min(limits.rows, rows)), c = max(1, min(limits.columns, columns))
        return StudioTableData(
            cells: Array(repeating: Array(repeating: "", count: c), count: r),
            styles: Array(repeating: Array(repeating: StudioTableCellStyle(), count: c), count: r),
            columns: Array(repeating: 1 / Double(c), count: c),
            align: Array(repeating: .left, count: c),
            header: look.header, stripes: look.stripes, stripeFill: look.stripeFill, border: look.border,
            borderColor: look.borderColor, borderWidth: look.borderWidth, color: look.color, headerFill: look.headerFill,
            fontSize: fontSize, fontId: fontId
        )
    }

    mutating func apply(_ look: StudioTableLook) {
        header = look.header; stripes = look.stripes; stripeFill = look.stripeFill; border = look.border
        borderColor = look.borderColor; borderWidth = look.borderWidth; color = look.color; headerFill = look.headerFill
    }

    var matchingStyle: StudioTableStyleId? {
        StudioTableStyleId.allCases.first { id in
            let l = id.look
            return l.header == header && l.stripes == stripes && l.stripeFill == stripeFill && l.border == border && l.borderColor == borderColor && l.borderWidth == borderWidth && l.color == color && l.headerFill == headerFill
        }
    }

    static func normalizeColumns(_ columns: [Double]) -> [Double] {
        let safe = columns.map { $0.isFinite && $0 > 0 ? $0 : 0 }
        let total = safe.reduce(0, +)
        guard total > 0 else { return Array(repeating: 1 / Double(max(1, columns.count)), count: columns.count) }
        let floor = 1 / Double(columns.count) / 4
        let scaled = safe.map { $0 > 0 ? $0 / total : floor }
        let scaledTotal = scaled.reduce(0, +)
        return scaled.map { $0 / scaledTotal }
    }

    mutating func setText(_ cell: StudioCellRef, _ text: String) {
        guard cells.indices.contains(cell.row), cells[cell.row].indices.contains(cell.column) else { return }
        cells[cell.row][cell.column] = String(text.prefix(Self.limits.cellChars))
    }

    mutating func insertRow(at: Int) {
        guard cells.count < Self.limits.rows else { return }
        let index = max(0, min(cells.count, at))
        let source = index > 0 ? index - 1 : 0
        let template: [StudioTableCellStyle]? = header && source == 0 ? nil : styles[source]
        cells.insert(Array(repeating: "", count: columnCount), at: index)
        styles.insert(template ?? Array(repeating: StudioTableCellStyle(), count: columnCount), at: index)
    }

    mutating func removeRow(_ row: Int) {
        guard cells.count > 1, cells.indices.contains(row) else { return }
        cells.remove(at: row)
        styles.remove(at: row)
    }

    mutating func insertColumn(at: Int) {
        let count = columnCount
        guard count < Self.limits.columns else { return }
        let index = max(0, min(count, at))
        let source = min(index, count - 1)
        var nextColumns = columns
        nextColumns.insert(1 / Double(count), at: index)
        align.insert(align.indices.contains(source) ? align[source] : .left, at: index)
        cells = cells.map { var r = $0; r.insert("", at: index); return r }
        styles = styles.map { var r = $0; r.insert(r.indices.contains(source) ? r[source] : StudioTableCellStyle(), at: index); return r }
        columns = Self.normalizeColumns(nextColumns)
    }

    mutating func removeColumn(_ column: Int) {
        guard columnCount > 1, column >= 0, column < columnCount else { return }
        cells = cells.map { var r = $0; r.remove(at: column); return r }
        styles = styles.map { var r = $0; r.remove(at: column); return r }
        var nextColumns = columns
        nextColumns.remove(at: column)
        align.remove(at: column)
        columns = Self.normalizeColumns(nextColumns)
    }

    /// `setColumnWidth`: returns the new total table width.
    mutating func setColumnWidth(_ column: Int, _ width: Double, tableWidth: Double) -> Double {
        guard columns.indices.contains(column), tableWidth > 0 else { return tableWidth }
        var widths = columns.map { $0 * tableWidth }
        widths[column] = max(Self.minColumnWidth, width)
        let total = widths.reduce(0, +)
        columns = Self.normalizeColumns(widths)
        return total
    }

    mutating func moveColumnBorder(_ border: Int, delta: Double, tableWidth: Double) {
        guard border >= 0, border < columns.count - 1, tableWidth > 0 else { return }
        var widths = columns.map { $0 * tableWidth }
        let pair = widths[border] + widths[border + 1]
        let minimum = min(Self.minColumnWidth, pair / 2)
        let left = max(minimum, min(pair - minimum, widths[border] + delta))
        widths[border] = left
        widths[border + 1] = pair - left
        columns = Self.normalizeColumns(widths)
    }

    mutating func distributeColumns() { columns = Array(repeating: 1 / Double(max(1, columns.count)), count: columns.count) }

    mutating func paste(_ grid: [[String]], at: StudioCellRef) {
        let wide = grid.map(\.count).max() ?? 0
        while cells.count < min(Self.limits.rows, at.row + grid.count) { insertRow(at: cells.count) }
        while columnCount < min(Self.limits.columns, at.column + wide) { insertColumn(at: columnCount) }
        for r in cells.indices {
            for c in cells[r].indices {
                let gr = r - at.row, gc = c - at.column
                if gr >= 0, gr < grid.count, gc >= 0, gc < grid[gr].count { cells[r][c] = String(grid[gr][gc].prefix(Self.limits.cellChars)) }
            }
        }
    }

    func clamp(_ range: StudioCellRange) -> StudioCellRange {
        let lastRow = cells.count - 1, lastColumn = columnCount - 1
        func fit(_ c: StudioCellRef) -> StudioCellRef { StudioCellRef(row: max(0, min(lastRow, c.row)), column: max(0, min(lastColumn, c.column))) }
        return StudioCellRange(anchor: fit(range.anchor), focus: fit(range.focus))
    }

    /// Applies a style patch to the range; `.some(nil)` clears a property.
    mutating func style(_ range: StudioCellRange, fill: String?? = nil, color: String?? = nil, align newAlign: StudioTableAlign?? = nil, bold: Bool?? = nil) {
        for r in styles.indices {
            for c in styles[r].indices where range.contains(StudioCellRef(row: r, column: c)) {
                if let fill { styles[r][c].fill = fill }
                if let color { styles[r][c].color = color }
                if let newAlign { styles[r][c].align = newAlign }
                if let bold { styles[r][c].bold = bold }
            }
        }
    }

    mutating func clear(_ range: StudioCellRange) {
        for r in cells.indices { for c in cells[r].indices where range.contains(StudioCellRef(row: r, column: c)) { cells[r][c] = "" } }
    }

    func rangeStyle(_ range: StudioCellRange) -> StudioTableCellStyle {
        styles.indices.contains(range.top) && styles[range.top].indices.contains(range.left) ? styles[range.top][range.left] : StudioTableCellStyle()
    }

    func cellAlign(_ c: StudioCellRef) -> StudioTableAlign { style(at: c)?.align ?? (align.indices.contains(c.column) ? align[c.column] : .left) }
    func cellBold(_ c: StudioCellRef) -> Bool { style(at: c)?.bold ?? (header && c.row == 0) }
    func cellColor(_ c: StudioCellRef) -> String { style(at: c)?.color ?? color }
    func cellFill(_ c: StudioCellRef) -> String? {
        if let own = style(at: c)?.fill { return own }
        if header && c.row == 0 { return headerFill }
        if stripes && (c.row - (header ? 1 : 0)) % 2 == 1 { return stripeFill }
        return nil
    }

    private func style(at c: StudioCellRef) -> StudioTableCellStyle? {
        styles.indices.contains(c.row) && styles[c.row].indices.contains(c.column) ? styles[c.row][c.column] : nil
    }

    /// Cell edges inside an element of `width` × `height` (TableCanvasEditor geometry).
    func geometry(width: Double, height: Double) -> (columns: [Double], rows: [Double]) {
        func edges(_ sizes: [Double]) -> [Double] { sizes.reduce(into: [0.0]) { $0.append($0.last! + $1) } }
        let cols = edges(columns.map { $0 * width })
        if let layout, layout.rows.count == cells.count, layout.height > 0 {
            let scale = height / layout.height
            return (cols, edges(layout.rows.map { $0 * scale }))
        }
        return (cols, edges(cells.map { _ in height / Double(max(1, cells.count)) }))
    }

    // MARK: JSON

    init(cells: [[String]], styles: [[StudioTableCellStyle]], columns: [Double], align: [StudioTableAlign], header: Bool, stripes: Bool, stripeFill: String?, border: StudioTableBorder, borderColor: String, borderWidth: Double, color: String, headerFill: String?, fontSize: Double, fontId: String, rendered: String = "", layout: StudioTableLayout? = nil) {
        self.cells = cells; self.styles = styles; self.columns = columns; self.align = align; self.header = header; self.stripes = stripes
        self.stripeFill = stripeFill; self.border = border; self.borderColor = borderColor; self.borderWidth = borderWidth; self.color = color
        self.headerFill = headerFill; self.fontSize = fontSize; self.fontId = fontId; self.rendered = rendered; self.layout = layout
    }

    init?(json: StudioJSONValue) {
        typealias J = StudioGraphicJSON
        guard let raw = J.record(json), raw["kind"]?.stringValue == "table", let rowsRaw = raw["cells"]?.arrayValue, !rowsRaw.isEmpty else { return nil }
        let rows = rowsRaw.prefix(Self.limits.rows).map { row -> [String] in
            (row.arrayValue ?? []).prefix(Self.limits.columns).map { $0.stringValue.map { String($0.prefix(Self.limits.cellChars)) } ?? "" }
        }
        let count = max(1, rows.map(\.count).max() ?? 1)
        cells = rows.map { $0 + Array(repeating: "", count: count - $0.count) }
        let rawStyles = raw["styles"]?.arrayValue ?? []
        styles = cells.indices.map { r in
            let row = r < rawStyles.count ? (rawStyles[r].arrayValue ?? []) : []
            return (0..<count).map { c in
                guard c < row.count, let s = J.record(row[c]) else { return StudioTableCellStyle() }
                return StudioTableCellStyle(fill: J.optionalColour(s["fill"]), color: J.optionalColour(s["color"]),
                                            align: s["align"]?.stringValue.flatMap(StudioTableAlign.init(rawValue:)), bold: J.bool(s["bold"]))
            }
        }
        let rawColumns = raw["columns"]?.arrayValue ?? []
        columns = Self.normalizeColumns((0..<count).map { $0 < rawColumns.count ? (rawColumns[$0].numberValue ?? 0) : 0 })
        let rawAlign = raw["align"]?.arrayValue ?? []
        align = (0..<count).map { $0 < rawAlign.count ? J.oneOf(rawAlign[$0], StudioTableAlign.left) : .left }
        let look = StudioTableStyleId.classic.look
        header = J.bool(raw["header"]) ?? look.header
        stripes = J.bool(raw["stripes"]) ?? look.stripes
        stripeFill = J.optionalColour(raw["stripeFill"])
        border = J.oneOf(raw["border"], look.border)
        borderColor = J.colour(raw["borderColor"], look.borderColor)
        borderWidth = J.finite(raw["borderWidth"], look.borderWidth, 0.1, Self.maxBorderWidth)
        color = J.colour(raw["color"], look.color)
        headerFill = J.optionalColour(raw["headerFill"])
        fontSize = J.finite(raw["fontSize"], 12, Self.minFont, Self.maxFont * 20)
        let font = raw["fontId"]?.stringValue ?? ""
        fontId = font.isEmpty ? Self.defaultFontId : String(font.prefix(1024))
        rendered = J.text(raw["rendered"], 64)
        layout = nil
        if let l = J.record(raw["layout"]) {
            func list(_ v: StudioJSONValue?, _ n: Int) -> [Double]? {
                guard let a = v?.arrayValue, a.count == n else { return nil }
                let nums = a.compactMap(\.numberValue)
                return nums.count == n && nums.allSatisfy { $0.isFinite && $0 >= 0 } ? nums : nil
            }
            let w = J.finite(l["width"], 0, 0, 100000), h = J.finite(l["height"], 0, 0, 100000)
            if let r = list(l["rows"], cells.count), let c = list(l["columns"], count), w > 0, h > 0 { layout = StudioTableLayout(width: w, height: h, rows: r, columns: c) }
        }
    }

    var json: StudioJSONValue {
        var o: [String: StudioJSONValue] = [
            "kind": .string("table"),
            "cells": .array(cells.map { .array($0.map { .string($0) }) }),
            "styles": .array(styles.map { .array($0.map { s in
                var d: [String: StudioJSONValue] = [:]
                if let f = s.fill { d["fill"] = .string(f) }
                if let c = s.color { d["color"] = .string(c) }
                if let a = s.align { d["align"] = .string(a.rawValue) }
                if let b = s.bold { d["bold"] = .bool(b) }
                return .object(d)
            }) }),
            "columns": .array(columns.map { .number($0) }),
            "align": .array(align.map { .string($0.rawValue) }),
            "header": .bool(header), "stripes": .bool(stripes), "stripeFill": StudioGraphicJSON.string(stripeFill),
            "border": .string(border.rawValue), "borderColor": .string(borderColor), "borderWidth": .number(borderWidth),
            "color": .string(color), "headerFill": StudioGraphicJSON.string(headerFill), "fontSize": .number(fontSize),
            "fontId": .string(fontId), "rendered": .string(rendered), "layout": .null,
        ]
        if let layout {
            o["layout"] = .object(["width": .number(layout.width), "height": .number(layout.height), "rows": .array(layout.rows.map { .number($0) }), "columns": .array(layout.columns.map { .number($0) })])
        }
        return .object(o)
    }
}

// MARK: - Chart

enum StudioChartType: String, CaseIterable, Identifiable, Hashable {
    case column, bar, line, area, pie, doughnut, scatter, histogram, box, dotplot
    var id: String { rawValue }
    var isRound: Bool { self == .pie || self == .doughnut }
    var isStackable: Bool { self == .column || self == .bar || self == .area }
    var isSample: Bool { self == .histogram || self == .box || self == .dotplot }
    var symbol: String {
        switch self {
        case .column: "chart.bar.fill"
        case .bar: "chart.bar.xaxis"
        case .line: "chart.xyaxis.line"
        case .area: "chart.line.uptrend.xyaxis"
        case .pie: "chart.pie.fill"
        case .doughnut: "circle.dashed"
        case .scatter: "chart.dots.scatter"
        case .histogram: "chart.bar.doc.horizontal"
        case .box: "rectangle.split.3x1"
        case .dotplot: "circle.grid.3x3"
        }
    }
}

enum StudioLegendPosition: String, CaseIterable, Identifiable, Hashable { case bottom, top, right, left; var id: String { rawValue } }

enum StudioChartPalette: String, CaseIterable, Identifiable, Hashable {
    case vivid, ocean, sunset, forest, pastel, grey
    var id: String { rawValue }
    var colors: [String] {
        switch self {
        case .vivid: ["#2563eb", "#f97316", "#16a34a", "#dc2626", "#9333ea", "#0891b2", "#ca8a04", "#db2777"]
        case .ocean: ["#0369a1", "#14b8a6", "#1e3a8a", "#38bdf8", "#0e7490", "#5eead4", "#0c4a6e", "#0284c7"]
        case .sunset: ["#c2410c", "#fbbf24", "#be185d", "#f97316", "#7c2d12", "#fb923c", "#e11d48", "#9f1239"]
        case .forest: ["#15803d", "#a16207", "#84cc16", "#14532d", "#65a30d", "#22c55e", "#4d7c0f", "#166534"]
        case .pastel: ["#93c5fd", "#fdba74", "#86efac", "#fca5a5", "#c4b5fd", "#67e8f9", "#fde68a", "#f9a8d4"]
        case .grey: ["#1f2937", "#6b7280", "#9ca3af", "#374151", "#d1d5db", "#4b5563", "#111827", "#e5e7eb"]
        }
    }
    func color(_ index: Int) -> String { colors[index % colors.count] }
}

struct StudioChartSettings: Equatable, Hashable {
    static let limits = (rows: 101, columns: 9, cellChars: 200, minColumns: 2)
    static let maxBins = 30

    var type: StudioChartType = .column
    var cells: [[String]]
    var colors: [String]
    var palette: StudioChartPalette = .vivid
    var title = ""
    var categoryTitle = ""
    var valueTitle = ""
    var legend = true
    var legendPosition: StudioLegendPosition = .bottom
    var grid = true
    var valueLabels = false
    var stacked = false
    var width = 360.0
    var height = 240.0
    var fontSize = 10.0
    var fontId = "bundled:dejavu-sans"
    var color = "#1f2937"
    var decimal = "."
    var bins = 0.0

    static func sample(type: StudioChartType, series: (Int) -> String, category: (Int) -> String, decimal: String) -> StudioChartSettings {
        let cells = [["", series(1), series(2)], [category(1), "4", "2"], [category(2), "6", "3"], [category(3), "5", "4"], [category(4), "8", "5"]]
        var s = StudioChartSettings(type: type, cells: cells, colors: [])
        s.colors = (0..<2).map { s.palette.color($0) }
        s.decimal = decimal
        return s
    }

    /// The user's decimal separator for a locale.
    static func decimal(for locale: Locale) -> String { (locale.decimalSeparator ?? ".") == "," ? "," : "." }

    mutating func applyPalette(_ p: StudioChartPalette) {
        palette = p
        colors = colors.indices.map { p.color($0) }
    }

    mutating func resizeColors() {
        let wanted = max(0, (cells.first?.count ?? 1) - 1)
        if colors.count > wanted { colors = Array(colors.prefix(wanted)) }
        while colors.count < wanted { colors.append(palette.color(colors.count)) }
    }

    mutating func addRow() { guard cells.count < Self.limits.rows else { return }; cells.append(Array(repeating: "", count: cells.first?.count ?? 2)) }
    mutating func removeRow(_ r: Int) { guard cells.count > 1, cells.indices.contains(r) else { return }; cells.remove(at: r) }
    mutating func addColumn() {
        guard (cells.first?.count ?? 0) < Self.limits.columns else { return }
        cells = cells.map { $0 + [""] }
        colors.append(palette.color(colors.count))
    }
    mutating func removeColumn(_ c: Int) {
        guard (cells.first?.count ?? 0) > Self.limits.minColumns, c > 0 else { return }
        cells = cells.map { var r = $0; if r.indices.contains(c) { r.remove(at: c) }; return r }
        if colors.indices.contains(c - 1) { colors.remove(at: c - 1) }
    }
    mutating func setCell(_ r: Int, _ c: Int, _ text: String) {
        guard cells.indices.contains(r), cells[r].indices.contains(c) else { return }
        cells[r][c] = String(text.prefix(Self.limits.cellChars))
    }

    init(type: StudioChartType = .column, cells: [[String]], colors: [String]) {
        self.type = type
        self.cells = cells
        self.colors = colors
    }

    init?(json: StudioJSONValue?) {
        typealias J = StudioGraphicJSON
        guard let raw = J.record(json), let rowsRaw = raw["cells"]?.arrayValue, !rowsRaw.isEmpty else { return nil }
        let rows = rowsRaw.prefix(101).map { ($0.arrayValue ?? []).prefix(9).map { J.text($0, 200) } }
        let count = max(2, rows.map(\.count).max() ?? 2)
        cells = rows.map { $0 + Array(repeating: "", count: count - $0.count) }
        palette = J.oneOf(raw["palette"], StudioChartPalette.vivid)
        let rawColors = raw["colors"]?.arrayValue ?? []
        colors = (0..<(count - 1)).map { $0 < rawColors.count ? J.colour(rawColors[$0], "#2563eb") : "#2563eb" }
        type = J.oneOf(raw["type"], StudioChartType.column)
        title = J.text(raw["title"], 300)
        categoryTitle = J.text(raw["categoryTitle"], 200)
        valueTitle = J.text(raw["valueTitle"], 200)
        legend = J.bool(raw["legend"]) ?? true
        legendPosition = J.oneOf(raw["legendPosition"], StudioLegendPosition.bottom)
        grid = J.bool(raw["grid"]) ?? true
        valueLabels = J.bool(raw["valueLabels"]) ?? false
        stacked = J.bool(raw["stacked"]) ?? false
        width = J.finite(raw["width"], 360, 1, 100000)
        height = J.finite(raw["height"], 240, 1, 100000)
        fontSize = J.finite(raw["fontSize"], 10, 1, 1000)
        let font = raw["fontId"]?.stringValue ?? ""
        fontId = font.isEmpty ? "bundled:dejavu-sans" : String(font.prefix(1024))
        color = J.colour(raw["color"], "#1f2937")
        decimal = raw["decimal"]?.stringValue == "," ? "," : "."
        bins = J.finite(raw["bins"], 0, 0, 30)
    }

    var json: StudioJSONValue {
        .object([
            "type": .string(type.rawValue), "cells": .array(cells.map { .array($0.map { .string($0) }) }), "colors": .array(colors.map { .string($0) }),
            "palette": .string(palette.rawValue), "title": .string(title), "categoryTitle": .string(categoryTitle), "valueTitle": .string(valueTitle),
            "legend": .bool(legend), "legendPosition": .string(legendPosition.rawValue), "grid": .bool(grid), "valueLabels": .bool(valueLabels),
            "stacked": .bool(stacked), "width": .number(width), "height": .number(height), "fontSize": .number(fontSize), "fontId": .string(fontId),
            "color": .string(color), "decimal": .string(decimal), "bins": .number(bins),
        ])
    }

    /// `parseChartNumber`: accepts grouping separators and either decimal mark.
    static func parseNumber(_ text: String) -> Double? {
        var cleaned = text.split(whereSeparator: \.isWhitespace).joined().replacingOccurrences(of: "−", with: "-")
        guard !cleaned.isEmpty else { return nil }
        let comma = cleaned.lastIndex(of: ","), dot = cleaned.lastIndex(of: ".")
        if let comma, let dot {
            let separator: Character = comma > dot ? "," : "."
            let grouping = separator == "," ? "." : ","
            cleaned = cleaned.replacingOccurrences(of: grouping, with: "")
            if let i = cleaned.firstIndex(of: separator) { cleaned.replaceSubrange(i...i, with: ".") }
        } else if comma != nil {
            cleaned = cleaned.split(separator: ",", omittingEmptySubsequences: false).count == 2 ? cleaned.replacingOccurrences(of: ",", with: ".") : cleaned.replacingOccurrences(of: ",", with: "")
        } else if cleaned.split(separator: ".", omittingEmptySubsequences: false).count > 2 {
            cleaned = cleaned.replacingOccurrences(of: ".", with: "")
        }
        guard cleaned.range(of: "^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$", options: .regularExpression) != nil, let v = Double(cleaned), v.isFinite else { return nil }
        return v
    }

    struct Series: Equatable { var name: String; var color: String; var values: [Double?] }

    /// `chartData`: the render spec, invalid cell keys ("row:column") and whether nothing can be drawn.
    func data() -> (spec: StudioChartSpec, invalid: Set<String>, blank: Bool) {
        var invalid = Set<String>()
        let header = cells.first ?? []
        let body = cells.dropFirst().enumerated().map { ($0.element, $0.offset + 1) }
        let rows = body.filter { $0.0.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
        let columns = header.indices.filter { c in c > 0 && (!header[c].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || rows.contains { c < $0.0.count && !$0.0[c].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) }
        let series = columns.map { c -> Series in
            Series(name: header[c].trimmingCharacters(in: .whitespacesAndNewlines),
                   color: c - 1 < colors.count ? colors[c - 1] : palette.color(c - 1),
                   values: rows.map { row, number in
                       let text = c < row.count ? row[c].trimmingCharacters(in: .whitespacesAndNewlines) : ""
                       if text.isEmpty { return nil }
                       let v = Self.parseNumber(text)
                       if v == nil { invalid.insert("\(number):\(c)") }
                       return v
                   })
        }
        if type == .scatter { for (row, number) in rows where Self.parseNumber(row.first ?? "") == nil { invalid.insert("\(number):0") } }
        let blank = rows.isEmpty || series.isEmpty || series.allSatisfy { $0.values.allSatisfy { $0 == nil } }
        let spec = StudioChartSpec(
            type: type, categories: rows.map { ($0.0.first ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }, series: series,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines), categoryTitle: categoryTitle.trimmingCharacters(in: .whitespacesAndNewlines),
            valueTitle: valueTitle.trimmingCharacters(in: .whitespacesAndNewlines), legend: legend, legendPosition: legendPosition, grid: grid,
            valueLabels: valueLabels, stacked: stacked && type.isStackable, width: width, height: height, fontSize: fontSize, fontId: fontId,
            color: color, palette: palette.colors, decimal: decimal, bins: type == .histogram && bins > 0 ? Int(bins) : nil
        )
        return (spec, invalid, blank)
    }
}

/// `ChartSpec` handed to the renderer.
struct StudioChartSpec: Equatable {
    var type: StudioChartType
    var categories: [String]
    var series: [StudioChartSettings.Series]
    var title: String
    var categoryTitle: String
    var valueTitle: String
    var legend: Bool
    var legendPosition: StudioLegendPosition
    var grid: Bool
    var valueLabels: Bool
    var stacked: Bool
    var width: Double
    var height: Double
    var fontSize: Double
    var fontId: String
    var color: String
    var palette: [String]
    var decimal: String
    var bins: Int?
}

// MARK: - Flowchart

enum StudioFlowShape: String, CaseIterable, Identifiable, Hashable { case process, terminal, decision, io, connector; var id: String { rawValue } }
enum StudioFlowDirection: String, CaseIterable, Identifiable, Hashable { case down, right; var id: String { rawValue } }

struct StudioFlowStep: Equatable, Hashable, Identifiable { var id: String; var shape: StudioFlowShape = .process; var text = "" }
struct StudioFlowArrow: Equatable, Hashable { var source: String; var target: String; var label = "" }

struct StudioFlowchartSettings: Equatable, Hashable {
    static let limits = (nodes: 40, edges: 80, nodeChars: 300, labelChars: 60)
    var nodes: [StudioFlowStep]
    var edges: [StudioFlowArrow]
    var direction: StudioFlowDirection = .down
    var fontSize = 10.0
    var fontId = "bundled:dejavu-sans"
    var color = "#111111"
    var stroke = "#1f2937"
    var fill: String? = "#eef2ff"

    static func sample(start: String, step: String, end: String) -> StudioFlowchartSettings {
        StudioFlowchartSettings(nodes: [StudioFlowStep(id: "n1", shape: .terminal, text: start), StudioFlowStep(id: "n2", shape: .process, text: step), StudioFlowStep(id: "n3", shape: .terminal, text: end)],
                                edges: [StudioFlowArrow(source: "n1", target: "n2"), StudioFlowArrow(source: "n2", target: "n3")])
    }

    func freshId() -> String {
        let taken = Set(nodes.map(\.id))
        var number = nodes.count + 1
        while taken.contains("n\(number)") { number += 1 }
        return "n\(number)"
    }

    mutating func addStep() {
        guard nodes.count < Self.limits.nodes else { return }
        let id = freshId()
        if let last = nodes.last, edges.count < Self.limits.edges { edges.append(StudioFlowArrow(source: last.id, target: id)) }
        nodes.append(StudioFlowStep(id: id))
    }

    mutating func removeStep(_ id: String) {
        guard nodes.count > 1 else { return }
        nodes.removeAll { $0.id == id }
        edges.removeAll { $0.source == id || $0.target == id }
    }

    mutating func addArrow() {
        guard edges.count < Self.limits.edges, nodes.count >= 2 else { return }
        edges.append(StudioFlowArrow(source: nodes[nodes.count - 2].id, target: nodes[nodes.count - 1].id))
    }

    var validArrows: [StudioFlowArrow] {
        let ids = Set(nodes.map(\.id))
        var seen = Set<String>()
        return edges.filter { e in
            let key = "\(e.source)>\(e.target)"
            guard e.source != e.target, ids.contains(e.source), ids.contains(e.target), !seen.contains(key) else { return false }
            seen.insert(key)
            return true
        }
    }

    var isBlank: Bool { nodes.allSatisfy { $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }

    var spec: StudioFlowchartSettings {
        var s = self
        s.edges = validArrows.map { StudioFlowArrow(source: $0.source, target: $0.target, label: $0.label.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return s
    }

    init(nodes: [StudioFlowStep], edges: [StudioFlowArrow]) {
        self.nodes = nodes
        self.edges = edges
    }

    init?(json: StudioJSONValue?) {
        typealias J = StudioGraphicJSON
        guard let raw = J.record(json), let rawNodes = raw["nodes"]?.arrayValue, !rawNodes.isEmpty else { return nil }
        nodes = rawNodes.prefix(Self.limits.nodes).compactMap { J.record($0) }.compactMap { n in
            guard let id = n["id"]?.stringValue, !id.isEmpty, id.count <= 40 else { return nil }
            return StudioFlowStep(id: id, shape: J.oneOf(n["shape"], StudioFlowShape.process), text: J.text(n["text"], Self.limits.nodeChars))
        }
        guard !nodes.isEmpty else { return nil }
        edges = (raw["edges"]?.arrayValue ?? []).prefix(Self.limits.edges).compactMap { J.record($0) }.compactMap { e in
            guard let s = e["source"]?.stringValue, let t = e["target"]?.stringValue else { return nil }
            return StudioFlowArrow(source: s, target: t, label: J.text(e["label"], Self.limits.labelChars))
        }
        direction = J.oneOf(raw["direction"], StudioFlowDirection.down)
        fontSize = J.finite(raw["fontSize"], 10, 4, 36)
        let font = raw["fontId"]?.stringValue ?? ""
        fontId = font.isEmpty ? "bundled:dejavu-sans" : String(font.prefix(1024))
        color = J.colour(raw["color"], "#111111")
        stroke = J.colour(raw["stroke"], "#1f2937")
        fill = raw["fill"] == .null ? nil : J.colour(raw["fill"], "#eef2ff")
    }

    var json: StudioJSONValue {
        .object([
            "nodes": .array(nodes.map { .object(["id": .string($0.id), "shape": .string($0.shape.rawValue), "text": .string($0.text)]) }),
            "edges": .array(edges.map { .object(["source": .string($0.source), "target": .string($0.target), "label": .string($0.label)]) }),
            "direction": .string(direction.rawValue), "fontSize": .number(fontSize), "fontId": .string(fontId), "color": .string(color),
            "stroke": .string(stroke), "fill": StudioGraphicJSON.string(fill),
        ])
    }
}

// MARK: - Formula

struct StudioFormulaSource: Equatable, Hashable {
    static let defaultColor = "#111111"
    static let defaultSize = 18.0
    static let minSize = 6.0
    static let maxSize = 144.0

    var latex: String
    var svg: String
    var color: String
    var emWidth: Double
    var emHeight: Double

    init(latex: String, svg: String, color: String, emWidth: Double, emHeight: Double) {
        self.latex = latex; self.svg = svg; self.color = color; self.emWidth = emWidth; self.emHeight = emHeight
    }

    init?(json: StudioJSONValue?) {
        typealias J = StudioGraphicJSON
        guard let raw = J.record(json), let latex = raw["latex"]?.stringValue, let svg = raw["svg"]?.stringValue, svg.hasPrefix("<svg") else { return nil }
        let w = J.finite(raw["emWidth"], 0, 0, 100000), h = J.finite(raw["emHeight"], 0, 0, 100000)
        guard w > 0, h > 0 else { return nil }
        self.latex = String(latex.prefix(20000)); self.svg = svg; color = J.colour(raw["color"], Self.defaultColor); emWidth = w; emHeight = h
    }

    var json: StudioJSONValue {
        .object(["latex": .string(latex), "svg": .string(svg), "color": .string(color), "emWidth": .number(emWidth), "emHeight": .number(emHeight)])
    }

    static func clampSize(_ v: Double) -> Double { v.isFinite ? min(maxSize, max(minSize, v)).rounded() : defaultSize }
    func size(forWidth width: Double) -> Double { emWidth <= 0 ? Self.defaultSize : Self.clampSize(width / emWidth) }
    func box(size: Double) -> CGSize { CGSize(width: emWidth * size, height: emHeight * size) }
}

// MARK: - Graphic

enum StudioGraphic: Equatable {
    case table(StudioTableData)
    case chart(StudioChartSettings, rendered: String)
    case flowchart(StudioFlowchartSettings, rendered: String, layout: CGSize?)
    case formula(StudioFormulaSource)

    var kind: StudioSvgSource {
        switch self {
        case .table: .table
        case .chart: .chart
        case .flowchart: .flowchart
        case .formula: .formula
        }
    }

    init?(_ svg: StudioSVG) {
        typealias J = StudioGraphicJSON
        guard let raw = J.record(svg.data) else { return nil }
        switch svg.source {
        case .table:
            guard let t = StudioTableData(json: svg.data) else { return nil }
            self = .table(t)
        case .chart:
            guard let s = StudioChartSettings(json: raw["settings"]) else { return nil }
            self = .chart(s, rendered: J.text(raw["rendered"], 64))
        case .flowchart:
            guard let s = StudioFlowchartSettings(json: raw["settings"]) else { return nil }
            var size: CGSize?
            if let l = J.record(raw["layout"]) {
                let w = J.finite(l["width"], 0, 0, 100000), h = J.finite(l["height"], 0, 0, 100000)
                if w > 0, h > 0 { size = CGSize(width: w, height: h) }
            }
            self = .flowchart(s, rendered: J.text(raw["rendered"], 64), layout: size)
        case .formula:
            guard let f = StudioFormulaSource(json: raw["formula"]) else { return nil }
            self = .formula(f)
        case .import:
            return nil
        }
    }

    var data: StudioJSONValue {
        switch self {
        case .table(let t): return t.json
        case .chart(let s, let rendered): return .object(["kind": .string("chart"), "settings": s.json, "rendered": .string(rendered)])
        case .flowchart(let s, let rendered, let layout):
            return .object(["kind": .string("flowchart"), "settings": s.json, "rendered": .string(rendered),
                            "layout": layout.map { .object(["width": .number($0.width), "height": .number($0.height)]) } ?? .null])
        case .formula(let f): return .object(["kind": .string("formula"), "formula": f.json])
        }
    }
}
