import CoreGraphics
import Foundation

// Studio design model — a faithful port of `apps/desktop/src/types/studio.ts` and
// `features/studio/model/design.ts`. Designs are read from and written to the desktop JSON shape
// (field names, optional keys, clamping) so `.vivedesign` projects interchange both ways.

enum StudioLimits {
    static let designVersion = 1
    static let minPageSide = 18.0
    static let maxPageSide = 14400.0
    static let minElementSide = 1.0
    static let maxElementsPerPage = 2000
    static let maxPages = 500
    static let maxPageName = 120
    static let maxGuidesPerPage = 200
    static let maxMarginMM = 500.0
    static let maxGradientStops = 32
    static let minDashGap = 0.25
    static let maxDashGap = 4.0
    static let minRadialRadius = 0.05
    static let maxRadialRadius = 3.0
    static let maxShadowOffset = 500.0
    static let maxShadowBlur = 200.0
    static let minArrowSize = 0.5
    static let maxArrowSize = 4.0
    static let maxCornerRadius = 10000.0
    static let minRunScale = 0.05
    static let maxRunScale = 40.0
    static let minWeight = 100
    static let maxWeight = 900
    static let maxListLevel = 8
    static let maxPalette = 24
    static let builtinPlaceholders = ["n", "date"]
}

enum StudioPageSize: String, CaseIterable, Identifiable {
    case a4, a4Landscape, a5, letter, letterLandscape, businessCard, square, story, presentation, poster
    var id: String { rawValue }
    var size: (width: Double, height: Double) {
        switch self {
        case .a4: (595.28, 841.89)
        case .a4Landscape: (841.89, 595.28)
        case .a5: (419.53, 595.28)
        case .letter: (612, 792)
        case .letterLandscape: (792, 612)
        case .businessCard: (252, 144)
        case .square: (810, 810)
        case .story: (810, 1440)
        case .presentation: (960, 540)
        case .poster: (841.89, 1190.55)
        }
    }
    /// Sizes offered on the start screen, in desktop order.
    static let start: [StudioPageSize] = [.a4, .a4Landscape, .a5, .letter, .square, .story, .presentation, .businessCard, .poster]
}

// MARK: - Value types

struct StudioGradientStop: Equatable, Hashable {
    var offset: Double
    var color: String
}

enum StudioFill: Equatable, Hashable {
    case none
    case solid(String)
    case linear(angle: Double, stops: [StudioGradientStop])
    case radial(stops: [StudioGradientStop], cx: Double?, cy: Double?, radius: Double?)

    var typeName: String {
        switch self {
        case .none: "none"
        case .solid: "solid"
        case .linear: "linear"
        case .radial: "radial"
        }
    }

    var colors: [String] {
        switch self {
        case .none: []
        case .solid(let c): [c]
        case .linear(_, let stops), .radial(let stops, _, _, _): stops.map(\.color)
        }
    }

    func mapColors(_ swap: (String) -> String) -> StudioFill {
        switch self {
        case .none: .none
        case .solid(let c): .solid(swap(c))
        case .linear(let a, let stops): .linear(angle: a, stops: stops.map { StudioGradientStop(offset: $0.offset, color: swap($0.color)) })
        case .radial(let stops, let cx, let cy, let r): .radial(stops: stops.map { StudioGradientStop(offset: $0.offset, color: swap($0.color)) }, cx: cx, cy: cy, radius: r)
        }
    }

    /// A representative colour (first stop / solid colour) for swatches.
    var leadColor: String? { colors.first }
}

enum StudioDash: String, CaseIterable { case solid, dashed, dotted, longDash, dashDot }
enum StudioLineCap: String, CaseIterable { case butt, round, square }
enum StudioLineJoin: String, CaseIterable { case miter, round, bevel }

struct StudioStroke: Equatable, Hashable {
    var color: String
    var width: Double
    var dash: StudioDash = .solid
    var cap: StudioLineCap? = nil
    var join: StudioLineJoin? = nil
    var gap: Double? = nil
}

struct StudioTextRun: Equatable, Hashable {
    var text: String
    var bold: Bool? = nil
    var italic: Bool? = nil
    var underline: Bool? = nil
    var strike: Bool? = nil
    var color: String? = nil
    var fontId: String? = nil
    var scale: Double? = nil
    /// `.some(nil)` is an explicit JSON `null` (reset to element weight on desktop).
    var weight: Int?? = nil
}

enum StudioTextCase: String, CaseIterable { case none, upper, lower, title }
enum StudioAutoSize: String, CaseIterable { case fixed, height, width, shrink }
enum StudioListKind: String, CaseIterable { case none, bullet, dash, check, decimal, alpha, roman }
enum StudioTextAlign: String, CaseIterable { case left, center, right, justify }
enum StudioVerticalAlign: String, CaseIterable { case top, middle, bottom }

struct StudioParagraph: Equatable, Hashable {
    var list: StudioListKind = .none
    var level: Int = 0
    static let plain = StudioParagraph()
}

struct StudioTextOutline: Equatable, Hashable { var color: String; var width: Double }
struct StudioTextShadow: Equatable, Hashable { var color: String; var x: Double; var y: Double; var opacity: Double }
struct StudioTextHighlight: Equatable, Hashable { var color: String; var padding: Double }

struct StudioDropShadow: Equatable, Hashable {
    var color: String
    var opacity: Double
    var x: Double
    var y: Double
    var blur: Double
    static let standard = StudioDropShadow(color: "#000000", opacity: 0.35, x: 4, y: 6, blur: 12)
}

enum StudioShapeKind: String, CaseIterable {
    case rect, ellipse, triangle, rightTriangle, diamond, pentagon, hexagon, octagon, star, burst, heart, arrow, chevron
    case parallelogram, trapezoid, cross, speech, line, arrowLine, cloud
    var isLine: Bool { self == .line || self == .arrowLine }
}

enum StudioArrowhead: String, CaseIterable { case none, arrow, openArrow, triangle, circle, square, bar }
enum StudioImageFit: String, CaseIterable { case cover, contain, stretch }
enum StudioImageMask: String, CaseIterable { case none, rounded, circle }
enum StudioQRLevel: String, CaseIterable { case L, M, Q, H }
enum StudioSvgSource: String, CaseIterable { case table, chart, formula, flowchart, `import` }

struct StudioCrop: Equatable, Hashable {
    var x: Double = 0
    var y: Double = 0
    var width: Double = 1
    var height: Double = 1
    var isWhole: Bool { x == 0 && y == 0 && width == 1 && height == 1 }
}

struct StudioImageFilters: Equatable, Hashable {
    var brightness: Double = 1
    var contrast: Double = 1
    var saturation: Double = 1
    var warmth: Double = 0
    var sepia: Double = 0
    var grayscale: Double = 0
    static let neutral = StudioImageFilters()
    var isNeutral: Bool { self == .neutral }
}

struct StudioText: Equatable, Hashable {
    var runs: [StudioTextRun] = [StudioTextRun(text: "")]
    var fontId: String? = nil
    var fontSize: Double = 24
    var color: String = "#1f2937"
    var bold = false
    var italic = false
    var underline = false
    var strike = false
    var weight: Int? = nil
    var align: StudioTextAlign = .left
    var verticalAlign: StudioVerticalAlign = .top
    var lineHeight: Double = 1.25
    var letterSpacing: Double = 0
    var textCase: StudioTextCase = .none
    var autoSize: StudioAutoSize = .fixed
    var paragraphs: [StudioParagraph] = [.plain]
    var outline: StudioTextOutline? = nil
    var shadow: StudioTextShadow? = nil
    var highlight: StudioTextHighlight? = nil
    var language: String? = nil

    var plainText: String { runs.map(\.text).joined() }
}

struct StudioShape: Equatable, Hashable {
    var shape: StudioShapeKind = .rect
    var fill: StudioFill = .solid("#3b82f6")
    var stroke: StudioStroke? = nil
    var cornerRadius: Double = 0
    var corners: [Double]? = nil
    var points: Int = 5
    var innerRatio: Double = 0.45
    var startArrow: StudioArrowhead = .none
    var endArrow: StudioArrowhead = .none
    var arrowSize: Double = 1
    var dropShadow: StudioDropShadow? = nil
}

struct StudioImage: Equatable, Hashable {
    var src: String
    var fit: StudioImageFit = .cover
    var crop = StudioCrop()
    var mask: StudioImageMask = .none
    var cornerRadius: Double = 0
    var stroke: StudioStroke? = nil
    var dropShadow: StudioDropShadow? = nil
    var filters: StudioImageFilters? = nil
}

struct StudioQR: Equatable, Hashable {
    var value: String
    var color: String = "#000000"
    var background: String? = "#ffffff"
    var errorLevel: StudioQRLevel = .M
    var dropShadow: StudioDropShadow? = nil
}

struct StudioVectorPath: Equatable, Hashable {
    var d: String
    var fill: StudioFill
    var stroke: StudioStroke?
    var evenOdd: Bool = false
    var opacity: Double = 1
}

struct StudioVector: Equatable, Hashable {
    var viewWidth: Double
    var viewHeight: Double
    var paths: [StudioVectorPath]
    var dropShadow: StudioDropShadow? = nil
}

struct StudioSVG: Equatable, Hashable {
    var svg: String
    var source: StudioSvgSource = .import
    var data: StudioJSONValue = .null
    var dropShadow: StudioDropShadow? = nil
    var colorMap: [String: String]? = nil
}

enum StudioContent: Equatable, Hashable {
    case text(StudioText)
    case shape(StudioShape)
    case image(StudioImage)
    case qr(StudioQR)
    case vector(StudioVector)
    case svg(StudioSVG)

    var kind: String {
        switch self {
        case .text: "text"
        case .shape: "shape"
        case .image: "image"
        case .qr: "qr"
        case .vector: "vector"
        case .svg: "svg"
        }
    }
}

struct StudioElement: Identifiable, Equatable, Hashable {
    var id: String
    var name: String = ""
    var x: Double
    var y: Double
    var width: Double
    var height: Double
    var rotation: Double = 0
    var opacity: Double = 1
    var locked = false
    var hidden = false
    var groupId: String? = nil
    var flipX = false
    var flipY = false
    var lockRatio: Bool? = nil
    var content: StudioContent

    var kind: String { content.kind }

    var text: StudioText? {
        get { if case .text(let v) = content { v } else { nil } }
        set { if let newValue { content = .text(newValue) } }
    }
    var shape: StudioShape? {
        get { if case .shape(let v) = content { v } else { nil } }
        set { if let newValue { content = .shape(newValue) } }
    }
    var image: StudioImage? {
        get { if case .image(let v) = content { v } else { nil } }
        set { if let newValue { content = .image(newValue) } }
    }
    var qr: StudioQR? {
        get { if case .qr(let v) = content { v } else { nil } }
        set { if let newValue { content = .qr(newValue) } }
    }
    var vector: StudioVector? {
        get { if case .vector(let v) = content { v } else { nil } }
        set { if let newValue { content = .vector(newValue) } }
    }
    var svg: StudioSVG? {
        get { if case .svg(let v) = content { v } else { nil } }
        set { if let newValue { content = .svg(newValue) } }
    }

    /// Text elements carry no drop shadow; every other kind does.
    var dropShadow: StudioDropShadow? {
        get {
            switch content {
            case .text: nil
            case .shape(let v): v.dropShadow
            case .image(let v): v.dropShadow
            case .qr(let v): v.dropShadow
            case .vector(let v): v.dropShadow
            case .svg(let v): v.dropShadow
            }
        }
        set {
            switch content {
            case .text: break
            case .shape(var v): v.dropShadow = newValue; content = .shape(v)
            case .image(var v): v.dropShadow = newValue; content = .image(v)
            case .qr(var v): v.dropShadow = newValue; content = .qr(v)
            case .vector(var v): v.dropShadow = newValue; content = .vector(v)
            case .svg(var v): v.dropShadow = newValue; content = .svg(v)
            }
        }
    }

    var frame: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}

struct StudioBackgroundImage: Equatable, Hashable {
    var src: String
    var fit: StudioImageFit = .cover
    var opacity: Double = 1
}

struct StudioBackground: Equatable, Hashable {
    var fill: StudioFill = .solid("#ffffff")
    var image: StudioBackgroundImage? = nil
    static let blank = StudioBackground()
}

enum StudioGuideAxis: String { case x, y }

struct StudioGuide: Equatable, Hashable {
    var axis: StudioGuideAxis
    var position: Double
}

struct StudioPage: Identifiable, Equatable, Hashable {
    var id: String
    var name: String = ""
    var width: Double
    var height: Double
    var background = StudioBackground.blank
    var elements: [StudioElement] = []
    var guides: [StudioGuide] = []

    func element(_ id: String) -> StudioElement? { elements.first { $0.id == id } }
    func index(of id: String) -> Int? { elements.firstIndex { $0.id == id } }
}

struct StudioDesign: Equatable, Hashable {
    var version = StudioLimits.designVersion
    var name: String
    var palette: [String] = []
    var pages: [StudioPage]
    var margins: Double = 0

    func page(_ id: String?) -> StudioPage? { pages.first { $0.id == id } ?? pages.first }
    func pageIndex(_ id: String?) -> Int { pages.firstIndex { $0.id == id } ?? 0 }
}

// MARK: - Arbitrary JSON (graphic `data`, unknown payloads kept verbatim)

enum StudioJSONValue: Equatable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([StudioJSONValue])
    case object([String: StudioJSONValue])

    init(_ any: Any?) {
        switch any {
        case nil, is NSNull: self = .null
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { self = .bool(n.boolValue) } else { self = .number(n.doubleValue) }
        case let s as String: self = .string(s)
        case let a as [Any]: self = .array(a.map { StudioJSONValue($0) })
        case let d as [String: Any]: self = .object(d.mapValues { StudioJSONValue($0) })
        default: self = .null
        }
    }

    var any: Any {
        switch self {
        case .null: NSNull()
        case .bool(let b): b
        case .number(let n): n
        case .string(let s): s
        case .array(let a): a.map(\.any)
        case .object(let o): o.mapValues(\.any)
        }
    }

    subscript(key: String) -> StudioJSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }
    var stringValue: String? { if case .string(let s) = self { s } else { nil } }
    var numberValue: Double? { if case .number(let n) = self { n } else { nil } }
    var arrayValue: [StudioJSONValue]? { if case .array(let a) = self { a } else { nil } }
    var boolValue: Bool? { if case .bool(let b) = self { b } else { nil } }
}

// MARK: - Factories

enum StudioFactory {
    static func newId() -> String { UUID().uuidString.lowercased() }

    static func clampSide(_ value: Double) -> Double {
        min(StudioLimits.maxPageSide, max(StudioLimits.minPageSide, value.isFinite ? value : StudioLimits.minPageSide))
    }

    static func page(width: Double, height: Double) -> StudioPage {
        StudioPage(id: newId(), width: clampSide(width), height: clampSide(height))
    }

    static func design(name: String = "", width: Double, height: Double) -> StudioDesign {
        StudioDesign(name: name, pages: [page(width: width, height: height)])
    }

    static func text(x: Double, y: Double, width: Double, height: Double, text: String, configure: (inout StudioText) -> Void = { _ in }) -> StudioElement {
        var value = StudioText(runs: [StudioTextRun(text: text)])
        configure(&value)
        value.paragraphs = StudioTypography.fitParagraphs(value.paragraphs, count: StudioTypography.paragraphCount(value.runs))
        return StudioElement(id: newId(), x: x, y: y, width: width, height: height, content: .text(value))
    }

    static func shape(_ kind: StudioShapeKind, x: Double, y: Double, width: Double, height: Double) -> StudioElement {
        let lineLike = kind.isLine
        let value = StudioShape(
            shape: kind,
            fill: lineLike ? .none : .solid("#3b82f6"),
            stroke: lineLike ? StudioStroke(color: "#1f2937", width: 2) : nil,
            points: kind == .star ? 5 : kind == .burst ? 16 : 6,
            innerRatio: kind == .burst ? 0.8 : 0.45,
            endArrow: kind == .arrowLine ? .triangle : .none
        )
        return StudioElement(id: newId(), x: x, y: y, width: width, height: height, content: .shape(value))
    }

    static func image(src: String, x: Double, y: Double, width: Double, height: Double) -> StudioElement {
        StudioElement(id: newId(), x: x, y: y, width: width, height: height, content: .image(StudioImage(src: src)))
    }

    static func vector(viewWidth: Double, viewHeight: Double, paths: [StudioVectorPath], x: Double, y: Double, width: Double, height: Double, name: String = "") -> StudioElement {
        StudioElement(id: newId(), name: name, x: x, y: y, width: width, height: height, content: .vector(StudioVector(viewWidth: viewWidth, viewHeight: viewHeight, paths: paths)))
    }

    static func qr(value: String, x: Double, y: Double, side: Double) -> StudioElement {
        StudioElement(id: newId(), x: x, y: y, width: side, height: side, content: .qr(StudioQR(value: value)))
    }

    static func svg(_ markup: String, source: StudioSvgSource = .import, data: StudioJSONValue = .null, x: Double, y: Double, width: Double, height: Double) -> StudioElement {
        StudioElement(id: newId(), x: x, y: y, width: width, height: height, content: .svg(StudioSVG(svg: markup, source: source, data: data)))
    }
}

// MARK: - Placeholders ({name} mail-merge fields)

enum StudioPlaceholders {
    /// `(?<!\{)\{([^{}]+)\}` — a single-braced field not preceded by another brace.
    static func names(in value: String) -> [String] {
        var found: [String] = []
        let chars = Array(value)
        var i = 0
        while i < chars.count {
            if chars[i] == "{" && (i == 0 || chars[i - 1] != "{") {
                var j = i + 1
                var ok = false
                while j < chars.count {
                    if chars[j] == "{" { break }
                    if chars[j] == "}" { ok = j > i + 1; break }
                    j += 1
                }
                if ok {
                    found.append(String(chars[(i + 1)..<j]))
                    i = j + 1
                    continue
                }
            }
            i += 1
        }
        return found
    }

    static func has(_ value: String) -> Bool { !names(in: value).isEmpty }

    static func fill(_ value: String, _ values: [String: String]) -> String {
        guard value.contains("{") else { return value }
        var result = ""
        let chars = Array(value)
        var i = 0
        while i < chars.count {
            if chars[i] == "{" && (i == 0 || chars[i - 1] != "{") {
                var j = i + 1
                var closed = false
                while j < chars.count {
                    if chars[j] == "{" { break }
                    if chars[j] == "}" { closed = j > i + 1; break }
                    j += 1
                }
                if closed {
                    let name = String(chars[(i + 1)..<j])
                    if let replacement = values[name] {
                        result += replacement
                    } else {
                        result += String(chars[i...j])
                    }
                    i = j + 1
                    continue
                }
            }
            result.append(chars[i])
            i += 1
        }
        return result
    }

    /// Custom fields used anywhere in the design (built-ins `n` and `date` excluded), in first-use order.
    static func fields(in design: StudioDesign) -> [String] {
        var seen: [String] = []
        func collect(_ value: String) {
            for raw in names(in: value) {
                let name = raw.trimmingCharacters(in: .whitespaces)
                if !name.isEmpty, !StudioLimits.builtinPlaceholders.contains(name), !seen.contains(name) { seen.append(name) }
            }
        }
        for page in design.pages {
            for element in page.elements {
                switch element.content {
                case .text(let t): collect(t.plainText)
                case .qr(let q): collect(q.value)
                case .svg(let s): StudioGraphics.texts(of: s).forEach(collect)
                default: break
                }
            }
        }
        return seen
    }
}

// MARK: - Text direction

enum StudioScript {
    /// Direction of the first strong letter (`textDirection` on desktop).
    static func direction(_ text: String) -> StudioDirection {
        for scalar in text.unicodeScalars where scalar.properties.isAlphabetic {
            return isRTL(scalar) ? .rtl : .ltr
        }
        return .ltr
    }

    static func isRTL(_ scalar: Unicode.Scalar) -> Bool {
        let v = scalar.value
        return (0x0590...0x08FF).contains(v) || (0xFB1D...0xFDFF).contains(v) || (0xFE70...0xFEFF).contains(v)
            || (0x07C0...0x07FF).contains(v) || (0x0780...0x07BF).contains(v)
    }
}

enum StudioDirection { case ltr, rtl }
