import Foundation

/// `studio.import_svg` / `_svg.clean_svg_markup`: reads an SVG file, refuses document types and
/// entities, drops scripts and embedded documents, event handlers and external references, and makes
/// sure the root has an absolute width and height.
enum StudioSVGImport {
    static let maxBytes = 4_000_000
    private static let dropped: Set<String> = ["script", "foreignObject", "iframe", "audio", "video"]

    private final class Element {
        let qualifiedName: String
        var attributes: [(String, String)]
        var content: [Content] = []
        init(_ name: String, _ attributes: [(String, String)]) { qualifiedName = name; self.attributes = attributes }
        var localName: String { qualifiedName.split(separator: ":").last.map(String.init) ?? qualifiedName }
        func attribute(_ key: String) -> String? { attributes.first { $0.0 == key }?.1 }
        func set(_ key: String, _ value: String) {
            if let i = attributes.firstIndex(where: { $0.0 == key }) { attributes[i].1 = value } else { attributes.append((key, value)) }
        }
    }

    private enum Content { case element(Element), text(String) }

    private final class Builder: NSObject, XMLParserDelegate {
        var stack: [Element] = []
        var root: Element?
        var order: [String] = []

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
            // XMLParser loses attribute order; keep namespace declarations first for readability.
            let attrs = attributeDict.sorted { ($0.key.hasPrefix("xmlns") ? 0 : 1, $0.key) < ($1.key.hasPrefix("xmlns") ? 0 : 1, $1.key) }.map { ($0.key, $0.value) }
            let element = Element(qName ?? elementName, attrs)
            if let parent = stack.last { parent.content.append(.element(element)) } else { root = element }
            stack.append(element)
        }

        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) { _ = stack.popLast() }
        func parser(_ parser: XMLParser, foundCharacters string: String) { stack.last?.content.append(.text(string)) }
        func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) { if let s = String(data: CDATABlock, encoding: .utf8) { stack.last?.content.append(.text(s)) } }
    }

    private static let externalURL = try! NSRegularExpression(pattern: "url\\(\\s*(?!['\"]?\\s*#)[^)]*\\)", options: .caseInsensitive)
    private static let importRule = try! NSRegularExpression(pattern: "@import[^;]*;?", options: .caseInsensitive)

    private static func scrub(_ value: String) -> String {
        var out = importRule.stringByReplacingMatches(in: value, range: NSRange(value.startIndex..., in: value), withTemplate: "")
        out = externalURL.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out), withTemplate: "none")
        return out
    }

    private static func keptReference(_ element: String, _ value: String) -> Bool {
        let target = value.trimmingCharacters(in: .whitespaces)
        if target.hasPrefix("#") || target.range(of: "^data:image/(png|jpe?g|gif|bmp|webp);", options: [.regularExpression, .caseInsensitive]) != nil { return true }
        return element == "a" && target.range(of: "^(https?:|mailto:)", options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func clean(_ element: Element) {
        let name = element.localName
        element.attributes = element.attributes.compactMap { key, value in
            let local = key.split(separator: ":").last.map(String.init) ?? key
            if local == "href" { return keptReference(name, value) ? (key, value) : nil }
            if local.lowercased().hasPrefix("on") { return nil }
            if value.lowercased().contains("url(") || value.lowercased().contains("@import") { return (key, scrub(value)) }
            return (key, value)
        }
        element.content = element.content.compactMap { item in
            switch item {
            case .element(let child):
                if dropped.contains(child.localName) { return nil }
                clean(child)
                return .element(child)
            case .text(let text):
                return name == "style" ? .text(scrub(text)) : .text(text)
            }
        }
    }

    private static func escape(_ s: String, attribute: Bool) -> String {
        var out = s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        if attribute { out = out.replacingOccurrences(of: "\"", with: "&quot;") }
        return out
    }

    private static func serialize(_ e: Element) -> String {
        var s = "<\(e.qualifiedName)"
        for (k, v) in e.attributes { s += " \(k)=\"\(escape(v, attribute: true))\"" }
        if e.content.isEmpty { return s + "/>" }
        s += ">"
        for item in e.content {
            switch item {
            case .element(let child): s += serialize(child)
            case .text(let t): s += escape(t, attribute: false)
            }
        }
        return s + "</\(e.qualifiedName)>"
    }

    private static let absoluteLength = try! NSRegularExpression(pattern: "^\\s*\\d+(\\.\\d+)?\\s*(px|pt|pc|mm|cm|in)?\\s*$")

    private static func isAbsolute(_ v: String?) -> Bool {
        guard let v else { return false }
        return absoluteLength.firstMatch(in: v, range: NSRange(v.startIndex..., in: v)) != nil
    }

    /// Cleans SVG `data` (named `name` for messages).
    static func clean(data: Data, name: String) throws -> (svg: String, width: Double, height: Double) {
        guard data.count <= maxBytes else { throw EngineError(.INVALID_PARAMS, reason: "svgTooLarge") }
        if let head = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1),
           head.range(of: "<!\\s*(DOCTYPE|ENTITY)", options: [.regularExpression, .caseInsensitive]) != nil {
            throw EngineError(.INVALID_PARAMS, reason: "svgDoctype")
        }
        let builder = Builder()
        let parser = XMLParser(data: data)
        parser.delegate = builder
        parser.shouldResolveExternalEntities = false
        guard parser.parse(), let root = builder.root, root.localName == "svg" else { throw EngineError(.INVALID_PARAMS, reason: "notSvg", detail: name) }
        clean(root)
        if !(isAbsolute(root.attribute("width")) && isAbsolute(root.attribute("height"))) {
            guard let view = StudioSVGRenderer.viewBox(root.attribute("viewBox")?.replacingOccurrences(of: ",", with: " ")) else { throw EngineError(.INVALID_PARAMS, reason: "notSvg", detail: name) }
            root.set("width", StudioGraphicScene.num(view.width))
            root.set("height", StudioGraphicScene.num(view.height))
        }
        if root.attribute("xmlns") == nil, !root.qualifiedName.contains(":") { root.attributes.insert(("xmlns", "http://www.w3.org/2000/svg"), at: 0) }
        let markup = serialize(root)
        guard markup.utf8.count <= maxBytes else { throw EngineError(.INVALID_PARAMS, reason: "svgTooLarge") }
        let width = StudioSVGRenderer.numbers(root.attribute("width") ?? "").first ?? 0
        let height = StudioSVGRenderer.numbers(root.attribute("height") ?? "").first ?? 0
        return (markup, width, height)
    }

    static func load(url: URL) throws -> (svg: String, width: Double, height: Double) {
        let data = try withSecurityScope(url) { () throws -> Data in
            if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > maxBytes { throw EngineError(.INVALID_PARAMS, reason: "svgTooLarge") }
            return try Data(contentsOf: url)
        }
        return try clean(data: data, name: url.lastPathComponent)
    }
}
