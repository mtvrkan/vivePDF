import Foundation
import PDFKit
import UIKit

/// One annotation to import, from XFDF (`<highlight page=… rect=…>`) or FDF (an annotation dictionary).
/// Values use PDF page coordinates, like the files.
struct CommentSpec {
    var subtype: String
    var pageIndex: Int
    var rect: CGRect
    var name = ""
    var title: String?
    var subject: String?
    var contents: String?
    var modified: String?
    var created: String?
    var color: [Double]?
    var interior: [Double]?
    var flags: Int?
    var opacity: Double?
    var borderWidth: Double?
    var borderStyle: String?
    var dashes: [Double] = []
    var state: String?
    var stateModel: String?
    var icon: String?
    var quads: [Double] = []
    var line: [Double]?
    var endings: (String, String)?
    var ink: [[Double]] = []
    var vertices: [Double] = []
    var defaultAppearance: String?
    var inReplyTo: String?

    init(subtype: String, pageIndex: Int, rect: CGRect) {
        self.subtype = subtype
        self.pageIndex = pageIndex
        self.rect = rect
    }

    /// From an FDF annotation dictionary (`/Page` holds the zero-based page index).
    init?(pdfDictionary body: [String: CommentPDFValue]) {
        guard let subtype = body["Subtype"]?.nameValue, CommentExchange.subtypeTags[subtype] != nil,
              case .int(let page)? = body["Page"], page >= 0,
              let rectValues = body["Rect"]?.numbers, rectValues.count == 4 else { return nil }
        self.init(subtype: subtype, pageIndex: page, rect: CommentExchange.rect(rectValues))
        name = body["NM"]?.text ?? ""
        title = body["T"]?.text
        subject = body["Subj"]?.text
        contents = body["Contents"]?.text
        modified = body["M"]?.text
        created = body["CreationDate"]?.text
        color = body["C"]?.numbers
        interior = body["IC"]?.numbers
        if case .int(let value)? = body["F"] { flags = value }
        opacity = body["CA"]?.number
        if let border = body["BS"]?.dictionary {
            borderWidth = border["W"]?.number
            borderStyle = border["S"]?.nameValue
            dashes = border["D"]?.numbers ?? []
        }
        state = body["State"]?.text
        stateModel = body["StateModel"]?.text
        icon = body["Name"]?.nameValue
        quads = body["QuadPoints"]?.numbers ?? []
        line = body["L"]?.numbers
        if case .array(let ends)? = body["LE"], ends.count == 2 {
            endings = (ends[0].nameValue ?? "None", ends[1].nameValue ?? "None")
        }
        if case .array(let strokes)? = body["InkList"] { ink = strokes.compactMap(\.numbers) }
        vertices = body["Vertices"]?.numbers ?? []
        defaultAppearance = body["DA"]?.text
    }
}

/// XFDF / FDF comment exchange and the Markdown / CSV summaries (sidecar `comments_xfdf.py`, `comments.py`).
enum CommentExchange {
    static let namespace = "http://ns.adobe.com/xfdf/"
    static let maxBytes = 64 * 1024 * 1024
    static let duplicateTolerance: CGFloat = 1

    /// PDF subtype → XFDF element name.
    static let subtypeTags: [String: String] = [
        "Text": "text", "Highlight": "highlight", "Underline": "underline", "StrikeOut": "strikeout",
        "Squiggly": "squiggly", "Ink": "ink", "Square": "square", "Circle": "circle", "Line": "line",
        "Polygon": "polygon", "PolyLine": "polyline", "FreeText": "freetext", "Stamp": "stamp", "Caret": "caret",
    ]
    static let tagSubtypes: [String: String] = Dictionary(uniqueKeysWithValues: subtypeTags.map { ($1, $0) })
    static let markupTags: Set<String> = ["highlight", "underline", "strikeout", "squiggly"]
    static let borderStyles: [String: String] = ["S": "solid", "D": "dash", "B": "bevelled", "I": "inset", "U": "underline"]
    static let flagNames: [(Int, String)] = [
        (1, "invisible"), (2, "hidden"), (4, "print"), (8, "nozoom"), (16, "norotate"),
        (32, "noview"), (64, "readonly"), (128, "locked"), (256, "togglenoview"), (512, "lockedcontents"),
    ]

    static func rect(_ values: [Double]) -> CGRect {
        CGRect(x: min(values[0], values[2]), y: min(values[1], values[3]), width: abs(values[2] - values[0]), height: abs(values[3] - values[1]))
    }

    // MARK: - Choosing what to export

    /// Names to export: the given records plus their review-state replies (desktop "companions").
    static func exportNames(_ records: [CommentRecord], collection: CommentCollection) -> (names: [String], counted: Int) {
        let chosen = Set(records.map(\.id))
        var names = records.map(\.id)
        for (name, node) in collection.nodes where !chosen.contains(name) {
            if let parent = node.parent, chosen.contains(parent), CommentThreads.isStateReply(node.annotation) { names.append(name) }
        }
        return (names, records.count)
    }

    // MARK: - XFDF export

    static func exportXFDF(_ pdf: PDFDocument, names: [String], sourceName: String, password: String? = nil) throws -> Data {
        guard let snapshot = CommentRawSnapshot(pdf, password: password) else { throw EngineError(.INVALID_PDF) }
        let wanted = Set(names)
        var xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        xml += "<xfdf xmlns=\"\(namespace)\" xml:space=\"preserve\">\n"
        xml += "  <f href=\"\(escape(sourceName))\" />\n"
        xml += "  <annots>\n"
        for entry in snapshot.entries where wanted.contains(entry.name) {
            if let element = element(for: entry) { xml += element }
        }
        xml += "  </annots>\n</xfdf>\n"
        return Data(xml.utf8)
    }

    private static func element(for entry: CommentRawEntry) -> String? {
        guard let tag = subtypeTags[entry.subtype], let rect = entry.raw["Rect"]?.numbers, rect.count == 4 else { return nil }
        let raw = entry.raw
        var attributes: [(String, String)] = [("page", "\(entry.pageIndex)"), ("rect", joined(rect)), ("name", entry.name)]
        func add(_ key: String, _ value: String?) { if let value, !value.isEmpty { attributes.append((key, value)) } }
        add("title", raw["T"]?.text)
        add("subject", raw["Subj"]?.text)
        add("date", raw["M"]?.text)
        add("creationdate", raw["CreationDate"]?.text)
        add("color", hexColor(raw["C"]?.numbers))
        add("interior-color", hexColor(raw["IC"]?.numbers))
        if case .int(let flags)? = raw["F"] { add("flags", flagNames.filter { flags & $0.0 != 0 }.map(\.1).joined(separator: ",")) }
        if let opacity = raw["CA"]?.number { add("opacity", CommentPDFWriter.format(opacity)) }
        if let border = raw["BS"]?.dictionary {
            if let width = border["W"]?.number { add("width", CommentPDFWriter.format(width)) }
            add("style", border["S"]?.nameValue.flatMap { borderStyles[$0] })
            if let dashes = border["D"]?.numbers, !dashes.isEmpty { add("dashes", joined(dashes)) }
        }
        if let effect = raw["BE"]?.dictionary, effect["S"]?.nameValue == "C" {
            attributes.removeAll { $0.0 == "style" }
            add("style", "cloudy")
            if let intensity = effect["I"]?.number { add("intensity", CommentPDFWriter.format(intensity)) }
        }
        add("state", raw["State"]?.text)
        add("statemodel", raw["StateModel"]?.text)
        add("icon", raw["Name"]?.nameValue)
        add("inreplyto", entry.parentName)
        if markupTags.contains(tag), let quads = raw["QuadPoints"]?.numbers, !quads.isEmpty { add("coords", joined(quads)) }
        if tag == "line", let points = raw["L"]?.numbers, points.count == 4 {
            add("start", joined(Array(points[0..<2])))
            add("end", joined(Array(points[2..<4])))
        }
        if tag == "line" || tag == "polyline", case .array(let ends)? = raw["LE"], ends.count == 2 {
            add("head", ends[0].nameValue)
            add("tail", ends[1].nameValue)
        }
        var children = ""
        if tag == "ink", case .array(let strokes)? = raw["InkList"] {
            children += "      <inklist>\n"
            for stroke in strokes.compactMap(\.numbers) { children += "        <gesture>\(pairs(stroke))</gesture>\n" }
            children += "      </inklist>\n"
        }
        if tag == "polygon" || tag == "polyline", let vertices = raw["Vertices"]?.numbers, !vertices.isEmpty {
            children += "      <vertices>\(pairs(vertices))</vertices>\n"
        }
        if tag == "freetext", let appearance = raw["DA"]?.text, !appearance.isEmpty {
            children += "      <defaultappearance>\(escape(appearance))</defaultappearance>\n"
        }
        if let contents = raw["Contents"]?.text, !contents.isEmpty {
            children += "      <contents>\(escape(contents))</contents>\n"
        }
        if tag == "stamp", let appearance = raw["AP"], let encoded = appearanceText(appearance) {
            children += "      <appearance>\(encoded)</appearance>\n"
        }
        let head = "    <\(tag) " + attributes.map { "\($0.0)=\"\(escape($0.1))\"" }.joined(separator: " ")
        return children.isEmpty ? head + " />\n" : head + ">\n" + children + "    </\(tag)>\n"
    }

    /// The stamp appearance as base64 of Acrobat's `<DICT KEY="AP">…` XML (sidecar `_appearance_text`).
    static func appearanceText(_ appearance: CommentPDFValue) -> String? {
        guard case .dict(let entries) = appearance, !entries.isEmpty else { return nil }
        var xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" ?><DICT KEY=\"AP\">"
        for key in entries.keys.sorted() { xml += appearanceNode(key, entries[key] ?? .null) }
        xml += "</DICT>"
        return Data(xml.utf8).base64EncodedString()
    }

    private static func appearanceNode(_ key: String?, _ value: CommentPDFValue) -> String {
        let keyAttribute = key.map { " KEY=\"\(escape($0))\"" } ?? ""
        switch value {
        case .stream(let dict, let data, let filtered):
            var xml = "<STREAM\(keyAttribute)>"
            for name in dict.keys.sorted() where name != "Length" && !(filtered && (name == "Filter" || name == "DecodeParms")) {
                xml += appearanceNode(name, dict[name] ?? .null)
            }
            xml += "<INT KEY=\"Length\" VAL=\"\(data.count)\"/>"
            let printable = data.allSatisfy { (32..<127).contains($0) || $0 == 9 || $0 == 10 || $0 == 13 }
            if filtered && printable {
                xml += "<DATA MODE=\"FILTERED\" ENCODING=\"ASCII\">\(escape(String(decoding: data, as: UTF8.self)))</DATA>"
            } else {
                xml += "<DATA MODE=\"\(filtered ? "FILTERED" : "RAW")\" ENCODING=\"HEX\">\(data.map { String(format: "%02X", $0) }.joined())</DATA>"
            }
            return xml + "</STREAM>"
        case .dict(let dict):
            return "<DICT\(keyAttribute)>" + dict.keys.sorted().map { appearanceNode($0, dict[$0] ?? .null) }.joined() + "</DICT>"
        case .array(let items):
            return "<ARRAY\(keyAttribute)>" + items.map { appearanceNode(nil, $0) }.joined() + "</ARRAY>"
        case .bool(let flag): return "<BOOL\(keyAttribute) VAL=\"\(flag)\"/>"
        case .name(let name): return "<NAME\(keyAttribute) VAL=\"\(escape(name))\"/>"
        case .string(let data):
            if data.allSatisfy({ (32..<127).contains($0) }) {
                return "<STRING\(keyAttribute) VAL=\"\(escape(String(decoding: data, as: UTF8.self)))\"/>"
            }
            return "<STRING\(keyAttribute) VAL=\"\(data.map { String(format: "%02X", $0) }.joined())\" ENCODING=\"HEX\"/>"
        case .int(let number): return "<INT\(keyAttribute) VAL=\"\(number)\"/>"
        case .real(let number): return "<FIXED\(keyAttribute) VAL=\"\(CommentPDFWriter.format(number))\"/>"
        case .null, .ref: return "<NULL\(keyAttribute)/>"
        }
    }

    // MARK: - XFDF import

    /// Parses XFDF into specs. Rejects DOCTYPE declarations (entity expansion) and oversized files.
    static func xfdfSpecs(from data: Data) throws -> (specs: [CommentSpec], skipped: Int) {
        guard data.count <= maxBytes else { throw EngineError(.INVALID_PARAMS, reason: "commentFileTooLarge") }
        if let head = String(data: data.prefix(4096), encoding: .utf8) ?? String(data: data.prefix(4096), encoding: .isoLatin1),
           head.range(of: "<!DOCTYPE", options: .caseInsensitive) != nil {
            throw EngineError(.INVALID_PARAMS, reason: "commentFileDoctype")
        }
        let tree = XFDFTreeBuilder()
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = tree
        guard parser.parse(), let root = tree.root, root.name == "xfdf" else {
            throw EngineError(.INVALID_PARAMS, reason: "notXfdf")
        }
        guard let annots = root.child("annots") else { return ([], 0) }
        var specs: [CommentSpec] = []
        var skipped = 0
        for element in annots.children {
            if let spec = spec(from: element) { specs.append(spec) } else { skipped += 1 }
        }
        return (specs, skipped)
    }

    static func numbers(_ text: String?) -> [Double] {
        guard let text, let regex = try? NSRegularExpression(pattern: "-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?") else { return [] }
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap {
            Range($0.range, in: text).flatMap { Double(text[$0]) }
        }
    }

    private static func spec(from element: XFDFNode) -> CommentSpec? {
        guard let subtype = tagSubtypes[element.name] else { return nil }
        let rectValues = numbers(element.attributes["rect"])
        let page = numbers(element.attributes["page"]).first.map { Int($0) } ?? -1
        guard rectValues.count == 4, page >= 0 else { return nil }
        var spec = CommentSpec(subtype: subtype, pageIndex: page, rect: rect(rectValues))
        let attr = element.attributes
        spec.name = attr["name"] ?? ""
        spec.title = attr["title"]
        spec.subject = attr["subject"]
        spec.modified = attr["date"]
        spec.created = attr["creationdate"]
        spec.state = attr["state"]
        spec.stateModel = attr["statemodel"]
        spec.inReplyTo = attr["inreplyto"]
        spec.contents = element.child("contents")?.text ?? element.child("contents-richtext")?.text
        spec.color = pdfColor(attr["color"])
        spec.interior = pdfColor(attr["interior-color"])
        if let flags = attr["flags"] {
            let lookup = Dictionary(uniqueKeysWithValues: flagNames.map { ($1, $0) })
            spec.flags = flags.split(separator: ",").reduce(0) { $0 | (lookup[$1.trimmingCharacters(in: .whitespaces).lowercased()] ?? 0) }
        }
        spec.opacity = numbers(attr["opacity"]).first.map { max(0, min(1, $0)) }
        spec.borderWidth = numbers(attr["width"]).first.map { max(0, $0) }
        let style = (attr["style"] ?? "").lowercased()
        spec.borderStyle = borderStyles.first { $0.value == style }?.key
        spec.dashes = Array(numbers(attr["dashes"]).map { max(0, $0) }.prefix(8))
        if spec.borderStyle == nil, !spec.dashes.isEmpty, style != "cloudy" { spec.borderStyle = "D" }
        spec.icon = attr["icon"].map { $0.filter { $0.isLetter || $0.isNumber || "_.-".contains($0) } }
        if markupTags.contains(element.name) {
            var quads = numbers(attr["coords"])
            if quads.count < 8 {
                let r = rectValues
                quads = [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]]
            }
            spec.quads = Array(quads.prefix(quads.count / 8 * 8))
        }
        if element.name == "line" {
            let start = numbers(attr["start"]), end = numbers(attr["end"])
            guard start.count == 2, end.count == 2 else { return nil }
            spec.line = start + end
        }
        if element.name == "line" || element.name == "polyline", attr["head"] != nil || attr["tail"] != nil {
            spec.endings = (attr["head"] ?? "None", attr["tail"] ?? "None")
        }
        if element.name == "ink" {
            spec.ink = (element.child("inklist")?.children ?? []).filter { $0.name == "gesture" }.map { numbers($0.text) }
                .map { Array($0.prefix($0.count / 2 * 2)) }.filter { $0.count >= 2 }
            guard !spec.ink.isEmpty else { return nil }
        }
        if element.name == "polygon" || element.name == "polyline" {
            let vertices = numbers(element.child("vertices")?.text)
            guard vertices.count >= 4 else { return nil }
            spec.vertices = Array(vertices.prefix(vertices.count / 2 * 2))
        }
        if element.name == "freetext" { spec.defaultAppearance = element.child("defaultappearance")?.text ?? "/Helv 12 Tf 0 g" }
        return spec
    }

    static func pdfColor(_ value: String?) -> [Double]? {
        guard var text = value?.trimmingCharacters(in: .whitespaces) else { return nil }
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let number = Int(text, radix: 16) else { return nil }
        return [Double((number >> 16) & 0xFF) / 255, Double((number >> 8) & 0xFF) / 255, Double(number & 0xFF) / 255]
    }

    static func hexColor(_ values: [Double]?) -> String? {
        guard let values, values.count >= 3 else { return nil }
        return "#" + values.prefix(3).map { String(format: "%02X", Int((max(0, min(1, $0)) * 255).rounded())) }.joined()
    }

    // MARK: - Importing specs into the document

    struct ImportResult {
        var imported: [PDFAnnotation] = []
        var skipped = 0
        var duplicates = 0
    }

    /// Adds the specs' annotations to `pdf` (in memory), skipping ones already present (same name, page,
    /// type and rectangle within 1 pt) and linking replies by name.
    static func importSpecs(_ specs: [CommentSpec], skipped initiallySkipped: Int = 0, into pdf: PDFDocument) -> ImportResult {
        CommentThreads.ensureNames(pdf)
        var known: [String: (page: Int, subtype: String, rect: CGRect)] = [:]
        for index in 0..<pdf.pageCount {
            for annotation in pdf.page(at: index)?.annotations ?? [] {
                if let name = annotation.commentName { known[name] = (index, annotation.subtypeName, annotation.bounds) }
            }
        }
        var result = ImportResult(skipped: initiallySkipped)
        var usedNames = Set(known.keys)
        for spec in specs {
            guard spec.pageIndex < pdf.pageCount, let page = pdf.page(at: spec.pageIndex) else { result.skipped += 1; continue }
            if !spec.name.isEmpty, let match = known[spec.name], match.page == spec.pageIndex, match.subtype == spec.subtype,
               abs(match.rect.minX - spec.rect.minX) <= duplicateTolerance, abs(match.rect.minY - spec.rect.minY) <= duplicateTolerance,
               abs(match.rect.maxX - spec.rect.maxX) <= duplicateTolerance, abs(match.rect.maxY - spec.rect.maxY) <= duplicateTolerance {
                result.duplicates += 1
                continue
            }
            guard let annotation = makeAnnotation(spec) else { result.skipped += 1; continue }
            var name = spec.name.isEmpty ? "vivepdf-\(UUID().uuidString.lowercased())" : spec.name
            if usedNames.contains(name) { name += "-\(UUID().uuidString.prefix(6).lowercased())" }
            usedNames.insert(name)
            annotation.commentName = name
            if let parent = spec.inReplyTo, !parent.isEmpty, parent != name {
                annotation.setValue(parent, forAnnotationKey: commentReplyKey)
            }
            page.addAnnotation(annotation)
            result.imported.append(annotation)
        }
        return result
    }

    /// Builds a PDFKit annotation from a spec. PDFKit stores geometry relative to the annotation bounds.
    static func makeAnnotation(_ spec: CommentSpec) -> PDFAnnotation? {
        var bounds = spec.rect
        if bounds.width < 1 { bounds.size.width = 1 }
        if bounds.height < 1 { bounds.size.height = 1 }
        let annotation = PDFAnnotation(bounds: bounds, forType: PDFAnnotationSubtype(rawValue: spec.subtype), withProperties: nil)
        let origin = bounds.origin
        func local(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x - origin.x, y: y - origin.y) }
        annotation.contents = spec.contents
        if let title = spec.title { annotation.userName = title }
        if let subject = spec.subject { annotation.setString(subject, for: "Subj") }
        if let modified = spec.modified {
            annotation.modificationDate = CommentThreads.parseDate(modified)
        }
        if let created = spec.created { annotation.setString(created, for: "CreationDate") }
        if let state = spec.state { annotation.setString(state, for: "State") }
        if let model = spec.stateModel { annotation.setString(model, for: "StateModel") }
        let alpha = CGFloat(spec.opacity ?? 1)
        if let color = spec.color, color.count >= 3 {
            annotation.color = UIColor(red: color[0], green: color[1], blue: color[2], alpha: alpha)
        } else if spec.subtype == "Text" || spec.subtype == "FreeText" {
            annotation.color = spec.subtype == "FreeText" ? .clear : .systemYellow
        }
        if let interior = spec.interior, interior.count >= 3 {
            annotation.interiorColor = UIColor(red: interior[0], green: interior[1], blue: interior[2], alpha: alpha)
        }
        if spec.borderWidth != nil || spec.borderStyle != nil {
            let border = PDFBorder()
            border.lineWidth = CGFloat(spec.borderWidth ?? 1)
            switch spec.borderStyle {
            case "D": border.style = .dashed
            case "B": border.style = .beveled
            case "I": border.style = .inset
            case "U": border.style = .underline
            default: border.style = .solid
            }
            if !spec.dashes.isEmpty { border.dashPattern = spec.dashes.map { NSNumber(value: $0) } }
            annotation.border = border
        }
        if let icon = spec.icon {
            if spec.subtype == "Text" { annotation.iconType = textIcon(icon) }
            if spec.subtype == "Stamp" { annotation.stampName = icon }
        }
        switch spec.subtype {
        case "Highlight", "Underline", "StrikeOut", "Squiggly":
            var points: [NSValue] = []
            var index = 0
            while index + 1 < spec.quads.count {
                points.append(NSValue(cgPoint: local(spec.quads[index], spec.quads[index + 1])))
                index += 2
            }
            annotation.quadrilateralPoints = points
        case "Line":
            guard let line = spec.line, line.count == 4 else { return nil }
            annotation.startPoint = local(line[0], line[1])
            annotation.endPoint = local(line[2], line[3])
        case "Ink":
            for stroke in spec.ink {
                let path = UIBezierPath()
                var index = 0
                while index + 1 < stroke.count {
                    let point = local(stroke[index], stroke[index + 1])
                    if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                    index += 2
                }
                annotation.add(path)
            }
        case "Polygon", "PolyLine":
            annotation.setValue(spec.vertices.map { NSNumber(value: $0) }, forAnnotationKey: PDFAnnotationKey(rawValue: "/Vertices"))
        case "FreeText":
            let (size, color) = parseDefaultAppearance(spec.defaultAppearance)
            annotation.font = UIFont.systemFont(ofSize: size)
            annotation.fontColor = color
        default: break
        }
        if let (head, tail) = spec.endings {
            annotation.startLineStyle = lineStyle(head)
            annotation.endLineStyle = lineStyle(tail)
        }
        let flags = spec.flags ?? 4
        annotation.setValue(NSNumber(value: flags), forAnnotationKey: .flags)
        if flags & (1 | 2 | 32) != 0 { annotation.shouldDisplay = false }
        if flags & 4 == 0 { annotation.shouldPrint = false }
        return annotation
    }

    static func lineStyle(_ name: String) -> PDFLineStyle {
        switch name {
        case "Square": .square
        case "Circle": .circle
        case "Diamond": .diamond
        case "OpenArrow": .openArrow
        case "ClosedArrow": .closedArrow
        default: .none
        }
    }

    static func textIcon(_ name: String) -> PDFTextAnnotationIconType {
        switch name {
        case "Comment": .comment
        case "Key": .key
        case "Help": .help
        case "NewParagraph": .newParagraph
        case "Paragraph": .paragraph
        case "Insert": .insert
        default: .note
        }
    }

    /// "/Helv 12 Tf 0 0 1 rg" → (12, blue).
    static func parseDefaultAppearance(_ text: String?) -> (CGFloat, UIColor) {
        let tokens = (text ?? "").split(whereSeparator: \.isWhitespace).map(String.init)
        var size: CGFloat = 12
        var color = UIColor.black
        for (index, token) in tokens.enumerated() {
            if token == "Tf", index >= 1, let value = Double(tokens[index - 1]), value > 0 { size = CGFloat(value) }
            if token == "g", index >= 1, let gray = Double(tokens[index - 1]) { color = UIColor(white: gray, alpha: 1) }
            if token == "rg", index >= 3, let r = Double(tokens[index - 3]), let g = Double(tokens[index - 2]), let b = Double(tokens[index - 1]) {
                color = UIColor(red: r, green: g, blue: b, alpha: 1)
            }
        }
        return (size, color)
    }

    /// Reads an XFDF or FDF file (sniffed by `%FDF`) and imports it.
    static func importFile(_ data: Data, into pdf: PDFDocument) throws -> ImportResult {
        guard data.count <= maxBytes else { throw EngineError(.INVALID_PARAMS, reason: "commentFileTooLarge") }
        let trimmed = data.drop { [0xEF, 0xBB, 0xBF, 0x20, 0x09, 0x0D, 0x0A].contains($0) }
        let specs: [CommentSpec]
        var skipped = 0
        if trimmed.starts(with: Array("%FDF".utf8)) {
            (specs, skipped) = try CommentFDF.specs(from: data)
        } else {
            (specs, skipped) = try xfdfSpecs(from: data)
        }
        let result = importSpecs(specs, skipped: skipped, into: pdf)
        if result.imported.isEmpty && result.duplicates > 0 {
            throw EngineError(.INVALID_PARAMS, reason: "commentsAlreadyPresent")
        }
        if result.imported.isEmpty { throw EngineError(.INVALID_PARAMS, reason: "noCommentsToImport") }
        return result
    }

    // MARK: - Summaries

    /// Markdown notes (desktop `markdown_summary`): the marked text as a quotation under its printed page.
    static func markdown(name: String, records: [CommentRecord], pageLabel: String, typeLabel: (String) -> String, labels: (Int) -> String) -> String {
        var lines = ["# \(markdownText(name))", ""]
        var currentPage: Int?
        let sorted = records.sorted {
            ($0.pageIndex, -$0.rect.maxY, $0.rect.minX) < ($1.pageIndex, -$1.rect.maxY, $1.rect.minX)
        }
        for record in sorted {
            if record.pageIndex != currentPage {
                currentPage = record.pageIndex
                lines += ["## \(markdownText(pageLabel)) \(markdownText(labels(record.pageIndex)))", ""]
            }
            if !record.quote.isEmpty { lines += ["> \(markdownText(record.quote))", ""] }
            let content = record.content.trimmingCharacters(in: .whitespacesAndNewlines)
                .components(separatedBy: .newlines).map { markdownText($0.trimmingCharacters(in: .whitespaces)) }
            if content.contains(where: { !$0.isEmpty }) { lines += [content.joined(separator: "  \n"), ""] }
            let meta = [typeLabel(record.type), record.author, CommentThreads.isoText(record.created), record.resolved ? "✓" : ""]
                .filter { !$0.isEmpty }.joined(separator: " · ")
            if !meta.isEmpty { lines += ["*\(markdownText(meta))*", ""] }
        }
        if currentPage == nil { lines += ["—", ""] }
        var text = lines.joined(separator: "\n")
        while text.hasSuffix("\n") { text.removeLast() }
        return text + "\n"
    }

    static func markdownText(_ text: String) -> String {
        var escaped = ""
        for character in text {
            if "\\`*_[]<>|".contains(character) { escaped.append("\\") }
            escaped.append(character)
        }
        // Escape block markers at line starts (#, >, +, -, "1.").
        guard let regex = try? NSRegularExpression(pattern: "^(\\s*)([#>+-]|\\d+\\.)", options: .anchorsMatchLines) else { return escaped }
        var result = escaped
        for match in regex.matches(in: escaped, range: NSRange(escaped.startIndex..., in: escaped)).reversed() {
            guard let markerRange = Range(match.range(at: 2), in: result) else { continue }
            let marker = String(result[markerRange])
            result.replaceSubrange(markerRange, with: marker.hasSuffix(".") ? String(marker.dropLast()) + "\\." : "\\" + marker)
        }
        return result
    }

    /// Semicolon CSV with a BOM, formula-like cells defused (desktop CSV export).
    static func csv(records: [CommentRecord], typeLabel: (String) -> String) -> Data {
        var rows = [["page", "type", "author", "created", "modified", "subject", "content", "resolved", "quote"]]
        for record in records {
            rows.append(["\(record.pageIndex + 1)", inert(typeLabel(record.type)), inert(record.author),
                         CommentThreads.isoText(record.created), CommentThreads.isoText(record.modified),
                         inert(record.subject), inert(record.content), record.resolved ? "yes" : "no", inert(record.quote)])
        }
        let text = rows.map { $0.map(csvField).joined(separator: ";") }.joined(separator: "\r\n") + "\r\n"
        return Data([0xEF, 0xBB, 0xBF]) + Data(text.utf8)
    }

    static func inert(_ value: String) -> String {
        guard let first = value.first, "=+-@\t\r".contains(first) else { return value }
        if value.trimmingCharacters(in: .whitespaces).range(of: "^[+-]?(\\d[\\d.,\\s]*)?\\d%?$", options: .regularExpression) != nil { return value }
        return "'" + value
    }

    private static func csvField(_ value: String) -> String {
        guard value.contains(where: { $0 == ";" || $0 == "\"" || $0 == "\n" || $0 == "\r" }) else { return value }
        return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    // MARK: - Small helpers

    static func joined(_ values: [Double]) -> String { values.map(CommentPDFWriter.format).joined(separator: ",") }

    static func pairs(_ values: [Double]) -> String {
        stride(from: 0, to: values.count - 1, by: 2).map { "\(CommentPDFWriter.format(values[$0])),\(CommentPDFWriter.format(values[$0 + 1]))" }
            .joined(separator: ";")
    }

    static func escape(_ text: String) -> String {
        var out = ""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "&": out += "&amp;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            case "\"": out += "&quot;"
            case "\r": out += "&#13;"
            default:
                // XML 1.0 forbids most control characters.
                if scalar.value < 0x20 && scalar != "\n" && scalar != "\t" { continue }
                out.unicodeScalars.append(scalar)
            }
        }
        return out
    }
}

// MARK: - Minimal XML tree for XFDF

final class XFDFNode {
    let name: String
    let attributes: [String: String]
    var children: [XFDFNode] = []
    var text = ""

    init(name: String, attributes: [String: String]) {
        self.name = name
        self.attributes = attributes
    }

    func child(_ name: String) -> XFDFNode? { children.first { $0.name == name } }
}

final class XFDFTreeBuilder: NSObject, XMLParserDelegate {
    private(set) var root: XFDFNode?
    private var stack: [XFDFNode] = []
    private var count = 0

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        count += 1
        if count > 2_000_000 { parser.abortParsing(); return }
        let local = (elementName.split(separator: ":").last.map(String.init) ?? elementName).lowercased()
        var lowered: [String: String] = [:]
        for (key, value) in attributes { lowered[(key.split(separator: ":").last.map(String.init) ?? key).lowercased()] = value }
        let node = XFDFNode(name: local, attributes: lowered)
        if let parent = stack.last { parent.children.append(node) } else { root = node }
        stack.append(node)
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        guard let node = stack.popLast() else { return }
        // Rich text bodies (<contents-richtext><body><p>…) fold their text into the parent.
        if let parent = stack.last, !node.text.isEmpty, node.name != "contents", node.name != "gesture",
           node.name != "vertices", node.name != "defaultappearance", node.name != "appearance" {
            if parent.name != "annots" && parent.name != "inklist" { parent.text += node.text }
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        stack.last?.text += string
    }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        stack.last?.text += String(decoding: CDATABlock, as: UTF8.self)
    }
}
