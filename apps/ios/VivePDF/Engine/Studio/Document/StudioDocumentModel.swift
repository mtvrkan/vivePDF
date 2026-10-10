import Foundation
import UniformTypeIdentifiers

// Studio documents (`.vivedoc`) — port of `features/studio/document/model.ts` and the desktop
// `StudioDocument` JSON: `{ version, kind: "document", name, settings, content }` where `content` is a
// TipTap / ProseMirror node tree (or, before first edit, an HTML string from a starter or import).

enum StudioDocPaper: String, CaseIterable, Identifiable {
    case a4, a5, b5, letter, legal
    var id: String { rawValue }
    var points: (width: Double, height: Double) {
        switch self {
        case .a4: (595, 842)
        case .a5: (420, 595)
        case .b5: (499, 709)
        case .letter: (612, 792)
        case .legal: (612, 1008)
        }
    }
}

enum StudioDocPageNumbers: String, CaseIterable, Identifiable { case none, center, right, outside; var id: String { rawValue } }
enum StudioDocAlign: String, CaseIterable, Identifiable { case left, center, right; var id: String { rawValue } }
enum StudioDocCoverStyle: String, CaseIterable, Identifiable { case classic, band, frame, minimal; var id: String { rawValue } }

struct StudioDocSettings: Equatable, Hashable {
    var paper: StudioDocPaper = .a4
    var landscape = false
    var marginMm: Double = 20
    var fontSize: Double = 11
    var lineHeight: Double = 1.4
    var accent = "#1f4e79"
    var header = ""
    var headerAlign: StudioDocAlign = .right
    var footer = ""
    var footerAlign: StudioDocAlign = .left
    var pageNumbers: StudioDocPageNumbers = .center
    var pageNumberFormat = "{n}"
    var furnitureOnFirst = true
    var toc = false
    var tocTitle = ""
    var tocDepth = 2
    var cover = false
    var coverStyle: StudioDocCoverStyle = .classic
    var title = ""
    var subtitle = ""
    var author = ""
    var date = ""
    var fontId = StudioDocument.defaultFont
    var headingFontId: String? = nil

    static let marginRange: ClosedRange<Double> = 5...50
    static let fontSizeRange: ClosedRange<Double> = 6...28
    static let lineHeightRange: ClosedRange<Double> = 1...3

    /// Page size in points (`pageSize`).
    var pageSize: (width: Double, height: Double) {
        let size = paper.points
        return landscape ? (size.height, size.width) : size
    }

    var marginPoints: Double { marginMm * StudioDocument.pointsPerMM }

    /// `normalizeSettings`: clamps every field like the desktop.
    static func normalized(_ value: Any?) -> StudioDocSettings {
        var s = StudioDocSettings()
        let source = value as? [String: Any] ?? [:]
        func clamp(_ key: String, _ range: ClosedRange<Double>, _ fallback: Double) -> Double {
            guard StudioJSON.isNumber(source[key]), let n = source[key] as? NSNumber else { return fallback }
            return min(range.upperBound, max(range.lowerBound, n.doubleValue))
        }
        func text(_ key: String, _ fallback: String, _ limit: Int) -> String {
            guard let v = source[key] as? String else { return fallback }
            return String(v.prefix(limit))
        }
        func font(_ key: String) -> String? {
            guard let v = source[key] as? String, !v.isEmpty, v.count <= 300 else { return nil }
            return v
        }
        s.paper = (source["paper"] as? String).flatMap(StudioDocPaper.init(rawValue:)) ?? .a4
        s.landscape = StudioJSON.bool(source["landscape"]) == true
        s.marginMm = clamp("marginMm", marginRange, 20)
        s.fontSize = clamp("fontSize", fontSizeRange, 11)
        s.lineHeight = clamp("lineHeight", lineHeightRange, 1.4)
        if let accent = source["accent"] as? String, StudioJSON.isColour(accent) { s.accent = accent }
        s.header = text("header", "", 200)
        s.headerAlign = (source["headerAlign"] as? String).flatMap(StudioDocAlign.init(rawValue:)) ?? .right
        s.footer = text("footer", "", 200)
        s.footerAlign = (source["footerAlign"] as? String).flatMap(StudioDocAlign.init(rawValue:)) ?? .left
        s.pageNumbers = (source["pageNumbers"] as? String).flatMap(StudioDocPageNumbers.init(rawValue:)) ?? .center
        let format = text("pageNumberFormat", "{n}", 40)
        s.pageNumberFormat = format.isEmpty ? "{n}" : format
        s.furnitureOnFirst = StudioJSON.bool(source["furnitureOnFirst"]) != false
        s.toc = StudioJSON.bool(source["toc"]) == true
        s.tocTitle = text("tocTitle", "", 100)
        if let depth = source["tocDepth"] as? NSNumber, StudioJSON.isNumber(depth), [1.0, 2.0, 3.0].contains(depth.doubleValue) { s.tocDepth = depth.intValue }
        s.cover = StudioJSON.bool(source["cover"]) == true
        s.coverStyle = (source["coverStyle"] as? String).flatMap(StudioDocCoverStyle.init(rawValue:)) ?? .classic
        s.title = text("title", "", 300)
        s.subtitle = text("subtitle", "", 300)
        s.author = text("author", "", 300)
        s.date = text("date", "", 80)
        s.fontId = font("fontId") ?? StudioDocument.defaultFont
        s.headingFontId = font("headingFontId")
        return s
    }

    /// Re-applies the desktop clamps after an edit (`setSettings` normalises the merged settings).
    func clamped() -> StudioDocSettings { Self.normalized(json) }

    var json: [String: Any] {
        [
            "paper": paper.rawValue, "landscape": landscape, "marginMm": marginMm, "fontSize": fontSize, "lineHeight": lineHeight,
            "accent": accent, "header": header, "headerAlign": headerAlign.rawValue, "footer": footer, "footerAlign": footerAlign.rawValue,
            "pageNumbers": pageNumbers.rawValue, "pageNumberFormat": pageNumberFormat, "furnitureOnFirst": furnitureOnFirst,
            "toc": toc, "tocTitle": tocTitle, "tocDepth": tocDepth, "cover": cover, "coverStyle": coverStyle.rawValue,
            "title": title, "subtitle": subtitle, "author": author, "date": date, "fontId": fontId,
            "headingFontId": headingFontId.map { $0 as Any } ?? NSNull(),
        ]
    }
}

/// A ProseMirror mark (`{ type, attrs? }`).
struct StudioDocMark: Equatable, Hashable {
    var type: String
    var attrs: [String: StudioJSONValue] = [:]

    func attr(_ name: String) -> StudioJSONValue? { attrs[name] }
    func string(_ name: String) -> String? { attrs[name]?.stringValue }
}

/// A ProseMirror node (`DocumentNode`). Attributes are kept verbatim so files round-trip.
struct StudioDocNode: Equatable, Hashable {
    var type: String
    var attrs: [String: StudioJSONValue]? = nil
    var content: [StudioDocNode]? = nil
    var marks: [StudioDocMark]? = nil
    var text: String? = nil

    func attr(_ name: String) -> StudioJSONValue? { attrs?[name] }
    func string(_ name: String) -> String? { attrs?[name]?.stringValue }
    func number(_ name: String) -> Double? {
        if let n = attrs?[name]?.numberValue { return n }
        if let s = attrs?[name]?.stringValue { return Double(s) }
        return nil
    }

    var plainText: String {
        if type == "text" { return text ?? "" }
        return (content ?? []).map(\.plainText).joined()
    }

    static func doc(_ content: [StudioDocNode] = []) -> StudioDocNode { StudioDocNode(type: "doc", content: content) }

    init(type: String, attrs: [String: StudioJSONValue]? = nil, content: [StudioDocNode]? = nil, marks: [StudioDocMark]? = nil, text: String? = nil) {
        self.type = type
        self.attrs = attrs
        self.content = content
        self.marks = marks
        self.text = text
    }

    /// Reads a node from JSON; nil when the value is not an object with a string `type`.
    init?(json value: Any?) {
        guard let object = value as? [String: Any], let type = object["type"] as? String else { return nil }
        self.type = type
        if let attrs = object["attrs"] as? [String: Any] { self.attrs = attrs.mapValues { StudioJSONValue($0) } }
        if let content = object["content"] as? [Any] { self.content = content.compactMap { StudioDocNode(json: $0) } }
        if let marks = object["marks"] as? [Any] {
            self.marks = marks.compactMap { item in
                guard let mark = item as? [String: Any], let type = mark["type"] as? String else { return nil }
                return StudioDocMark(type: type, attrs: (mark["attrs"] as? [String: Any] ?? [:]).mapValues { StudioJSONValue($0) })
            }
        }
        if let text = object["text"] as? String { self.text = text }
    }

    var json: [String: Any] {
        var object: [String: Any] = ["type": type]
        if let attrs { object["attrs"] = attrs.mapValues(\.any) }
        if let content { object["content"] = content.map(\.json) }
        if let marks {
            object["marks"] = marks.map { mark -> [String: Any] in
                mark.attrs.isEmpty ? ["type": mark.type] : ["type": mark.type, "attrs": mark.attrs.mapValues(\.any)]
            }
        }
        if let text { object["text"] = text }
        return object
    }
}

enum StudioDocContent: Equatable, Hashable {
    case node(StudioDocNode)
    /// Raw HTML (starters and imports) that the editor parses on first open.
    case html(String)

    var node: StudioDocNode? { if case .node(let n) = self { n } else { nil } }
}

struct StudioDocument: Equatable, Hashable {
    static let version = 1
    static let fileExtension = "vivedoc"
    static let defaultFont = "bundled:dejavu-sans"
    static let pointsPerMM = 72 / 25.4
    static let maxBytes = 120 * 1024 * 1024
    static let contentType = UTType(filenameExtension: "vivedoc") ?? .json

    var name: String
    var settings: StudioDocSettings
    var content: StudioDocContent

    init(name: String = "", settings: StudioDocSettings = StudioDocSettings(), content: StudioDocContent = .html("")) {
        self.name = name
        self.settings = settings
        self.content = content
    }

    /// `normalizeDocument`.
    init?(json value: Any?) {
        guard let source = value as? [String: Any], source["kind"] as? String == "document",
              StudioJSON.isNumber(source["version"]), let version = source["version"] as? NSNumber, version.doubleValue <= Double(Self.version) else { return nil }
        name = String((source["name"] as? String ?? "").prefix(200))
        settings = StudioDocSettings.normalized(source["settings"])
        if let html = source["content"] as? String { content = .html(html) } else if let node = StudioDocNode(json: source["content"]) { content = .node(node) } else { content = .html("") }
    }

    var json: [String: Any] {
        let body: Any = switch content {
        case .node(let node): node.json
        case .html(let html): html
        }
        return ["version": Self.version, "kind": "document", "name": name, "settings": settings.json, "content": body]
    }

    func data() throws -> Data {
        let data = try JSONSerialization.data(withJSONObject: json, options: [.withoutEscapingSlashes])
        guard data.count <= Self.maxBytes else { throw EngineError(.INVALID_PARAMS, reason: "documentFileTooLarge", detail: "\(Self.maxBytes / 1024 / 1024) MB") }
        return data
    }

    /// Reads `.vivedoc` bytes with the desktop's refusals (`studio.open_document`).
    static func read(_ data: Data) throws -> StudioDocument {
        guard data.count <= maxBytes else { throw EngineError(.INVALID_PARAMS, reason: "documentFileTooLarge") }
        guard let any = try? JSONSerialization.jsonObject(with: data), let object = any as? [String: Any], object["kind"] as? String == "document" else {
            throw EngineError(.INVALID_PARAMS, reason: "noDocument")
        }
        guard let version = object["version"] as? NSNumber, StudioJSON.isNumber(version), version.doubleValue == version.doubleValue.rounded() else {
            throw EngineError(.INVALID_PARAMS, reason: "noDocument")
        }
        guard version.intValue <= Self.version else { throw EngineError(.INVALID_PARAMS, reason: "newerDocument") }
        guard let document = StudioDocument(json: object) else { throw EngineError(.INVALID_PARAMS, reason: "noDocument") }
        return document
    }

    /// The content tree to render; string content (never opened in the editor) renders as an empty doc,
    /// exactly like `documentContent` on desktop.
    var renderNode: StudioDocNode { content.node ?? .doc() }
}

/// The open document plus where it lives on disk (nil until saved).
struct StudioDocumentFile: Identifiable, Equatable {
    let id = UUID()
    var document: StudioDocument
    var url: URL?

    init(document: StudioDocument, url: URL? = nil) {
        self.document = document
        self.url = url
    }

    /// Opens a `.vivedoc` file (security-scoped URLs from the Files app are fine).
    static func load(from url: URL) throws -> StudioDocumentFile {
        let data = try withSecurityScope(url) { () throws -> Data in
            guard FileManager.default.fileExists(atPath: url.path) else { throw EngineError(.FILE_NOT_FOUND, detail: url.lastPathComponent) }
            var coordError: NSError?
            var result: Result<Data, Error> = .failure(EngineError(.FILE_NOT_FOUND))
            NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &coordError) { readURL in
                result = Result { try Data(contentsOf: readURL) }
            }
            if let coordError { throw coordError }
            return try result.get()
        }
        return StudioDocumentFile(document: try StudioDocument.read(data), url: url)
    }

    static func == (lhs: StudioDocumentFile, rhs: StudioDocumentFile) -> Bool { lhs.id == rhs.id }
}
