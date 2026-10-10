import CoreGraphics
import Foundation

/// `TableSpec` (`graphicData.tableSpec`) and its renderer (`editor_table.py`).
struct StudioTableSpec: Equatable {
    var cells: [[String]]
    var columnWidths: [Double]
    var align: [StudioTableAlign]
    var width: Double
    var fontSize: Double
    var fontId: String
    var header: Bool
    var border: StudioTableBorder
    var color: String
    var borderColor: String
    var headerFill: String?
    var stripes: Bool
    var stripeFill: String?
    var borderWidth: Double?
    var cellStyles: [[StudioTableCellStyle]]?

    static let frame = (min: 40.0, max: 2000.0)

    static func scale(width: Double) -> Double {
        if width > frame.max { return width / frame.max }
        if width < frame.min { return width / frame.min }
        return 1
    }

    init(_ data: StudioTableData, width: Double) {
        let scale = Self.scale(width: width)
        let styled = data.styles.contains { $0.contains { !$0.isEmpty } }
        cells = data.cells
        columnWidths = data.columns.map { max($0, 0.0001) }
        align = data.align
        self.width = min(Self.frame.max, max(Self.frame.min, width / scale))
        fontSize = min(StudioTableData.maxFont, max(StudioTableData.minFont, data.fontSize / scale))
        fontId = data.fontId
        header = data.header
        border = data.border
        color = data.color
        borderColor = data.borderColor
        headerFill = data.headerFill
        stripes = data.stripes
        stripeFill = data.stripeFill
        borderWidth = min(StudioTableData.maxBorderWidth, max(0.05, data.borderWidth / scale))
        cellStyles = styled ? data.styles : nil
    }

    func style(_ r: Int, _ c: Int) -> StudioTableCellStyle? { cellStyles.flatMap { $0.indices.contains(r) && $0[r].indices.contains(c) ? $0[r][c] : nil } }
    func isBold(_ r: Int, _ c: Int) -> Bool { style(r, c)?.bold ?? (header && r == 0) }
    func alignOf(_ r: Int, _ c: Int) -> StudioTableAlign { style(r, c)?.align ?? (align.indices.contains(c) ? align[c] : .left) }

    /// Ordered JSON for the desktop's render key.
    var keyJSON: StudioOrderedJSON {
        .object([
            ("cells", .array(cells.map { .array($0.map { .string($0) }) })),
            ("columnWidths", .array(columnWidths.map { .number($0) })),
            ("align", .array(align.map { .string($0.rawValue) })),
            ("width", .number(width)), ("fontSize", .number(fontSize)), ("fontId", .string(fontId)), ("header", .bool(header)),
            ("border", .string(border.rawValue)), ("color", .string(color)), ("borderColor", .string(borderColor)),
            ("headerFill", headerFill.map { .string($0) } ?? .null), ("stripes", .bool(stripes)), ("stripeFill", stripeFill.map { .string($0) } ?? .null),
            ("borderWidth", borderWidth.map { .number($0) } ?? .null),
            ("cellStyles", cellStyles.map { rows in .array(rows.map { .array($0.map { s in
                var pairs: [(String, StudioOrderedJSON)] = []
                if let f = s.fill { pairs.append(("fill", .string(f))) }
                if let c = s.color { pairs.append(("color", .string(c))) }
                if let a = s.align { pairs.append(("align", .string(a.rawValue))) }
                if let b = s.bold { pairs.append(("bold", .bool(b))) }
                return .object(pairs)
            }) }) } ?? .null),
        ])
    }
}

enum StudioTableRenderer {
    static let padding = 0.4
    static let maxHeight = 14400.0

    struct Result {
        var scene: StudioGraphicScene
        var rowHeights: [Double]
        var columnWidths: [Double]
    }

    private static func stripeColour(_ spec: StudioTableSpec) -> String {
        if let s = spec.stripeFill { return s }
        guard let h = spec.headerFill else { return StudioColor.hex(0.94, 0.94, 0.95) }
        let (r, g, b) = StudioColor.components(h)
        return StudioColor.hex(1 - (1 - r) * 0.4, 1 - (1 - g) * 0.4, 1 - (1 - b) * 0.4)
    }

    static func render(_ spec: StudioTableSpec) throws -> Result {
        let total = spec.columnWidths.reduce(0, +)
        let widths = spec.columnWidths.map { spec.width * $0 / total }
        let pad = spec.fontSize * padding
        let step = spec.fontSize * StudioGraphicScene.lineHeight
        let measure = StudioGraphicScene(width: spec.width, height: 1, fontId: spec.fontId)
        var lines: [[[String]]] = []
        var heights: [Double] = []
        for (r, row) in spec.cells.enumerated() {
            let wrapped = row.enumerated().map { c, text in
                measure.wrap(text, size: spec.fontSize, width: max(1, (c < widths.count ? widths[c] : 0) - 2 * pad), bold: spec.isBold(r, c))
            }
            lines.append(wrapped)
            heights.append(Double(wrapped.map(\.count).max() ?? 1) * step + 2 * pad)
        }
        let height = heights.reduce(0, +)
        if height > maxHeight { throw StudioGraphicError(reason: "tableTooTall") }
        let scene = StudioGraphicScene(width: spec.width, height: height, fontId: spec.fontId)
        // Fills
        var top = 0.0
        for (r, h) in heights.enumerated() {
            var fill: String?
            if spec.header && r == 0, let hf = spec.headerFill { fill = hf } else if spec.stripes && (r - (spec.header ? 1 : 0)) % 2 == 1 { fill = stripeColour(spec) }
            if let fill { scene.fillRect(CGRect(x: 0, y: top, width: spec.width, height: h), fill) }
            var left = 0.0
            for (c, w) in widths.enumerated() {
                if let f = spec.style(r, c)?.fill { scene.fillRect(CGRect(x: left, y: top, width: w, height: h), f) }
                left += w
            }
            top += h
        }
        // Borders
        if spec.border != .none {
            let lineWidth = spec.borderWidth ?? max(0.5, spec.fontSize / 16)
            let ys = heights.reduce(into: [0.0]) { $0.append($0.last! + $1) }
            let xs = widths.reduce(into: [0.0]) { $0.append($0.last! + $1) }
            var horizontal: [Double] = [], vertical: [Double] = []
            switch spec.border {
            case .all: horizontal = ys; vertical = xs
            case .horizontal: horizontal = ys
            default:
                horizontal = [0, height] + (spec.header && ys.count > 2 ? [ys[1]] : [])
                vertical = [0, spec.width]
            }
            for y in horizontal { scene.line(from: CGPoint(x: 0, y: y), to: CGPoint(x: spec.width, y: y), spec.borderColor, width: lineWidth) }
            for x in vertical { scene.line(from: CGPoint(x: x, y: 0), to: CGPoint(x: x, y: height), spec.borderColor, width: lineWidth) }
        }
        // Text
        top = 0
        for (r, row) in lines.enumerated() {
            var left = 0.0
            for (c, cell) in row.enumerated() {
                let bold = spec.isBold(r, c)
                let colour = spec.style(r, c)?.color ?? spec.color
                let w = widths[c]
                let spare = heights[r] - 2 * pad - Double(cell.count) * step
                let middle = max(0, spare / 2)
                let offset = scene.baselineOffset(size: spec.fontSize, bold: bold)
                for (i, text) in cell.enumerated() where !text.isEmpty {
                    let advance = scene.width(text, size: spec.fontSize, bold: bold)
                    let x: Double = switch spec.alignOf(r, c) {
                    case .center: left + (w - advance) / 2
                    case .right: left + w - pad - advance
                    case .left: left + pad
                    }
                    scene.text(text, x: x, baseline: top + pad + middle + Double(i) * step + offset, size: spec.fontSize, bold: bold, color: colour)
                }
                left += w
            }
            top += heights[r]
        }
        return Result(scene: scene, rowHeights: heights, columnWidths: widths)
    }
}

// MARK: - JS-compatible JSON for render keys

/// JSON value with key order preserved, serialised like `JSON.stringify` (for `renderKeyOf`).
indirect enum StudioOrderedJSON {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([StudioOrderedJSON])
    case object([(String, StudioOrderedJSON)])

    var stringified: String {
        switch self {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .number(let n): return Self.jsNumber(n)
        case .string(let s): return Self.quote(s)
        case .array(let a): return "[" + a.map(\.stringified).joined(separator: ",") + "]"
        case .object(let o): return "{" + o.map { Self.quote($0.0) + ":" + $0.1.stringified }.joined(separator: ",") + "}"
        }
    }

    static func jsNumber(_ n: Double) -> String {
        guard n.isFinite else { return "null" }
        if n == n.rounded(), abs(n) < 1e21 { return String(format: "%.0f", n) == "-0" ? "0" : String(format: "%.0f", n) }
        var s = "\(n)"
        if let e = s.firstIndex(of: "e") {
            var mantissa = String(s[..<e]), exponent = String(s[s.index(after: e)...])
            if mantissa.hasSuffix(".0") { mantissa.removeLast(2) }
            var sign = "+"
            if exponent.hasPrefix("-") { sign = "-"; exponent.removeFirst() } else if exponent.hasPrefix("+") { exponent.removeFirst() }
            while exponent.hasPrefix("0") && exponent.count > 1 { exponent.removeFirst() }
            s = mantissa + "e" + sign + exponent
        }
        return s
    }

    static func quote(_ s: String) -> String {
        var out = "\""
        for unit in s.unicodeScalars {
            switch unit {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{8}": out += "\\b"
            case "\u{c}": out += "\\f"
            default:
                if unit.value < 0x20 { out += String(format: "\\u%04x", unit.value) } else { out.unicodeScalars.append(unit) }
            }
        }
        return out + "\""
    }

    /// `hashText` from graphicData.ts (cyrb53-style, base 36).
    static func hash(_ value: String) -> String {
        var first: UInt32 = 0xdeadbeef
        var second: UInt32 = 0x41c6ce57
        for code in value.utf16 {
            first = (first ^ UInt32(code)) &* 2654435761
            second = (second ^ UInt32(code)) &* 1597334677
        }
        first = ((first ^ (first >> 16)) &* 2246822507) ^ ((second ^ (second >> 13)) &* 3266489909)
        second = ((second ^ (second >> 16)) &* 2246822507) ^ ((first ^ (first >> 13)) &* 3266489909)
        let combined = UInt64(4294967296) * UInt64(2097151 & second) + UInt64(first)
        return String(combined, radix: 36)
    }
}
