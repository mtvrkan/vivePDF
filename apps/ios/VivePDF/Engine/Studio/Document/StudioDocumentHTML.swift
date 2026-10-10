import Foundation

/// Port of `document/toHtml.ts`: the node tree → the HTML the PDF engine lays out, plus the image and
/// font tables it references (`vpimg-<n>` tokens, `f<n>` font families).
enum StudioDocHTML {
    static let pageBreak = "pageBreak"
    static let maxFonts = 16
    static let pxToPt = 0.75
    static let defaultHighlight = "#fef08a"

    struct Output: Equatable {
        var html: String
        var images: [String]
        var fonts: [String]
    }

    static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    static func isDataImage(_ src: String) -> Bool {
        src.range(of: "^data:image/(png|jpe?g|gif|webp|bmp);base64,", options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func isSafeLink(_ href: String) -> Bool {
        href.range(of: "^(https?:|mailto:|#)", options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// `fontSize`: "12pt" / "16px" → "12pt" (4…200 pt), else nil.
    static func fontSize(_ value: StudioJSONValue?) -> String? {
        guard let raw = value?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              raw.range(of: "^\\d{1,3}(\\.\\d+)?(pt|px)$", options: .regularExpression) != nil else { return nil }
        let unit = raw.suffix(2)
        guard let number = Double(raw.dropLast(2)) else { return nil }
        let points = unit == "px" ? number * pxToPt : number
        guard points >= 4 && points <= 200 else { return nil }
        return "\(StudioShapes.num((points * 10).rounded() / 10))pt"
    }

    final class Writer {
        var images: [String] = []
        var fonts: [String]
        var headings = 0

        init(fontId: String, headingFontId: String?) {
            fonts = [fontId, headingFontId ?? fontId]
        }

        func font(_ id: String) -> String? {
            if id == fonts[0] { return "f0" }
            if fonts.count > 2, let index = fonts[2...].firstIndex(of: id) { return "f\(index)" }
            if fonts.count >= StudioDocHTML.maxFonts { return nil }
            fonts.append(id)
            return "f\(fonts.count - 1)"
        }

        func image(_ src: String) -> String? {
            guard StudioDocHTML.isDataImage(src) else { return nil }
            if let index = images.firstIndex(of: src) { return "vpimg-\(index)" }
            images.append(src)
            return "vpimg-\(images.count - 1)"
        }
    }

    private static func styleMark(_ mark: StudioDocMark, _ writer: Writer) -> [String] {
        var styles: [String] = []
        if let color = mark.string("color"), StudioJSON.isColour(color) { styles.append("color:\(color)") }
        if let background = mark.string("backgroundColor"), StudioJSON.isColour(background) { styles.append("background-color:\(background)") }
        if let font = mark.string("fontId"), !font.isEmpty, let family = writer.font(font) { styles.append("font-family:\(family)") }
        if let size = fontSize(mark.attr("fontSize")) { styles.append("font-size:\(size)") }
        return styles
    }

    private static func wrap(_ text: String, _ mark: StudioDocMark, _ writer: Writer) -> String {
        switch mark.type {
        case "bold": return "<strong>\(text)</strong>"
        case "italic": return "<em>\(text)</em>"
        case "underline": return "<u>\(text)</u>"
        case "strike": return "<s>\(text)</s>"
        case "code": return "<code>\(text)</code>"
        case "subscript": return "<sub>\(text)</sub>"
        case "superscript": return "<sup>\(text)</sup>"
        case "link":
            guard let href = mark.string("href")?.trimmingCharacters(in: .whitespacesAndNewlines), isSafeLink(href) else { return text }
            return "<a href=\"\(escape(href))\">\(text)</a>"
        case "highlight":
            let color = mark.string("color").flatMap { StudioJSON.isColour($0) ? $0 : nil } ?? defaultHighlight
            return "<span style=\"background-color:\(color)\">\(text)</span>"
        case "textStyle":
            let styles = styleMark(mark, writer)
            return styles.isEmpty ? text : "<span style=\"\(styles.joined(separator: ";"))\">\(text)</span>"
        default: return text
        }
    }

    private static func blockStyle(_ node: StudioDocNode) -> String {
        guard let align = node.string("textAlign"), ["center", "right", "justify"].contains(align) else { return "" }
        return " style=\"text-align:\(align)\""
    }

    private static func direction(_ node: StudioDocNode) -> String {
        StudioScript.direction(node.plainText) == .rtl ? " dir=\"rtl\"" : ""
    }

    private static func children(_ node: StudioDocNode, _ writer: Writer) -> String {
        (node.content ?? []).map { write($0, writer) }.joined()
    }

    private static func cell(_ node: StudioDocNode, _ tag: String, _ writer: Writer) -> String {
        let spans = ["colspan", "rowspan"].map { name -> String in
            guard let value = node.number(name), value == value.rounded(), value > 1 else { return "" }
            return " \(name)=\"\(Int(value))\""
        }.joined()
        var width = ""
        if let first = node.attr("colwidth")?.arrayValue?.first?.numberValue { width = " style=\"width:\(Int((first * pxToPt).rounded()))pt\"" }
        return "<\(tag)\(spans)\(width)>\(children(node, writer))</\(tag)>"
    }

    private static func taskItem(_ node: StudioDocNode, _ writer: Writer) -> String {
        let box = "\(node.attr("checked")?.boolValue == true ? "&#9745;" : "&#9744;") "
        let inner = children(node, writer)
        if let range = inner.range(of: "^<p\\b[^>]*>", options: .regularExpression) {
            return "<li>\(inner[range])\(box)\(inner[range.upperBound...])</li>"
        }
        return "<li><p>\(box)</p>\(inner)</li>"
    }

    private static func image(_ node: StudioDocNode, _ writer: Writer) -> String {
        guard let src = node.string("src"), let token = writer.image(src) else { return "" }
        var size = ""
        if let width = node.number("width"), width.isFinite, width > 0 { size = " style=\"width:\(Int((width * pxToPt).rounded()))pt\"" }
        var label = ""
        if let alt = node.string("alt"), !alt.isEmpty { label = " alt=\"\(escape(alt))\"" }
        return "<p style=\"text-align:center\"><img src=\"\(token)\"\(size)\(label)></p>"
    }

    static func write(_ node: StudioDocNode, _ writer: Writer) -> String {
        switch node.type {
        case "doc": return children(node, writer)
        case "text": return (node.marks ?? []).reduce(escape(node.text ?? "")) { wrap($0, $1, writer) }
        case "paragraph":
            let inner = children(node, writer)
            return "<p\(blockStyle(node))\(direction(node))>\(inner.isEmpty ? "&nbsp;" : inner)</p>"
        case "heading":
            let level = min(6, max(1, Int(node.number("level") ?? 1)))
            writer.headings += 1
            return "<h\(level) id=\"h-\(writer.headings)\"\(blockStyle(node))\(direction(node))>\(children(node, writer))</h\(level)>"
        case "hardBreak": return "<br>"
        case "bulletList": return "<ul>\(children(node, writer))</ul>"
        case "orderedList":
            let start = node.number("start") ?? 1
            return "<ol\(start == start.rounded() && start > 1 ? " start=\"\(Int(start))\"" : "")>\(children(node, writer))</ol>"
        case "listItem": return "<li>\(children(node, writer))</li>"
        case "taskList": return "<ul class=\"tasks\">\(children(node, writer))</ul>"
        case "taskItem": return taskItem(node, writer)
        case "blockquote": return "<blockquote>\(children(node, writer))</blockquote>"
        case "codeBlock": return "<pre><code>\(escape(node.plainText))</code></pre>"
        case "horizontalRule": return "<hr>"
        case "image": return image(node, writer)
        case "table": return "<table>\(children(node, writer))</table>"
        case "tableRow": return "<tr>\(children(node, writer))</tr>"
        case "tableHeader": return cell(node, "th", writer)
        case "tableCell": return cell(node, "td", writer)
        case pageBreak: return "<div class=\"page-break\"></div>"
        default: return children(node, writer)
        }
    }

    /// `documentHtml`.
    static func document(_ content: StudioDocNode, settings: StudioDocSettings) -> Output {
        let writer = Writer(fontId: settings.fontId, headingFontId: settings.headingFontId)
        let html = write(content, writer)
        return Output(html: html, images: writer.images, fonts: writer.fonts)
    }

    // MARK: - Editor markup

    /// HTML for the in-app editor: the TipTap DOM shape (data attributes, task items, page breaks,
    /// embedded pictures) that `studio-doc-editor.js` parses back into the same node tree.
    static func editor(_ node: StudioDocNode, family: (String) -> String) -> String {
        func inner(_ n: StudioDocNode) -> String { (n.content ?? []).map { editor($0, family: family) }.joined() }
        func align(_ n: StudioDocNode) -> String {
            guard let a = n.string("textAlign"), ["left", "center", "right", "justify"].contains(a) else { return "" }
            return " style=\"text-align:\(a)\""
        }
        switch node.type {
        case "doc": return inner(node)
        case "text":
            return (node.marks ?? []).reduce(escape(node.text ?? "")) { text, mark in
                switch mark.type {
                case "bold": return "<strong>\(text)</strong>"
                case "italic": return "<em>\(text)</em>"
                case "underline": return "<u>\(text)</u>"
                case "strike": return "<s>\(text)</s>"
                case "code": return "<code>\(text)</code>"
                case "subscript": return "<sub>\(text)</sub>"
                case "superscript": return "<sup>\(text)</sup>"
                case "link": return "<a href=\"\(escape(mark.string("href") ?? ""))\">\(text)</a>"
                case "highlight":
                    let color = mark.string("color").flatMap { StudioJSON.isColour($0) ? $0 : nil } ?? defaultHighlight
                    return "<mark data-color=\"\(color)\" style=\"background-color:\(color)\">\(text)</mark>"
                case "textStyle":
                    var attrs = ""
                    var styles: [String] = []
                    if let c = mark.string("color"), StudioJSON.isColour(c) { styles.append("color:\(c)") }
                    if let b = mark.string("backgroundColor"), StudioJSON.isColour(b) { styles.append("background-color:\(b)") }
                    if let s = mark.string("fontSize"), !s.isEmpty { styles.append("font-size:\(escape(s))") }
                    if let f = mark.string("fontId"), !f.isEmpty {
                        attrs += " data-font-id=\"\(escape(f))\""
                        styles.append("font-family:\(family(f))")
                    }
                    if styles.isEmpty && attrs.isEmpty { return text }
                    return "<span\(attrs) style=\"\(styles.joined(separator: ";"))\">\(text)</span>"
                default: return text
                }
            }
        case "paragraph":
            let content = inner(node)
            return "<p\(align(node))>\(content.isEmpty ? "<br>" : content)</p>"
        case "heading":
            let level = min(4, max(1, Int(node.number("level") ?? 1)))
            let content = inner(node)
            return "<h\(level)\(align(node))>\(content.isEmpty ? "<br>" : content)</h\(level)>"
        case "hardBreak": return "<br>"
        case "bulletList": return "<ul>\(inner(node))</ul>"
        case "orderedList":
            let start = node.number("start") ?? 1
            return "<ol\(start != 1 ? " start=\"\(Int(start))\"" : "")>\(inner(node))</ol>"
        case "listItem": return "<li>\(inner(node))</li>"
        case "taskList": return "<ul data-type=\"taskList\">\(inner(node))</ul>"
        case "taskItem": return "<li data-type=\"taskItem\" data-checked=\"\(node.attr("checked")?.boolValue == true)\">\(inner(node))</li>"
        case "blockquote": return "<blockquote>\(inner(node))</blockquote>"
        case "codeBlock": return "<pre><code>\(escape(node.plainText))</code></pre>"
        case "horizontalRule": return "<hr>"
        case "image":
            guard let src = node.string("src") else { return "" }
            var attrs = "src=\"\(escape(src))\""
            if let alt = node.string("alt") { attrs += " alt=\"\(escape(alt))\"" }
            if let title = node.string("title") { attrs += " title=\"\(escape(title))\"" }
            if let width = node.number("width"), width > 0 { attrs += " width=\"\(Int(width.rounded()))\" style=\"width:\(Int(width.rounded()))px\"" }
            return "<img \(attrs)>"
        case "table": return "<table><tbody>\(inner(node))</tbody></table>"
        case "tableRow": return "<tr>\(inner(node))</tr>"
        case "tableHeader", "tableCell":
            let tag = node.type == "tableHeader" ? "th" : "td"
            var attrs = ""
            if let c = node.number("colspan"), c > 1 { attrs += " colspan=\"\(Int(c))\"" }
            if let r = node.number("rowspan"), r > 1 { attrs += " rowspan=\"\(Int(r))\"" }
            if let widths = node.attr("colwidth")?.arrayValue?.compactMap(\.numberValue), !widths.isEmpty {
                attrs += " data-colwidth=\"\(widths.map { String(Int($0)) }.joined(separator: ","))\""
            }
            let content = inner(node)
            return "<\(tag)\(attrs)>\(content.isEmpty ? "<p><br></p>" : content)</\(tag)>"
        case pageBreak: return "<div class=\"page-break\" data-page-break=\"\" contenteditable=\"false\"></div>"
        default: return inner(node)
        }
    }

    // MARK: - Imports (`studio.import_document`)

    static let importExtensions = ["md", "markdown", "txt", "text", "html", "htm"]

    /// `body_fragment`: the body of an HTML page without scripts, styles, frames and head tags.
    static func bodyFragment(_ document: String) -> String {
        var body = document
        if let match = document.range(of: "<body\\b[^>]*>([\\s\\S]*)</body\\s*>", options: [.regularExpression, .caseInsensitive]) {
            let found = String(document[match])
            if let open = found.range(of: "<body\\b[^>]*>", options: [.regularExpression, .caseInsensitive]),
               let close = found.range(of: "</body\\s*>", options: [.regularExpression, .caseInsensitive, .backwards]) {
                body = String(found[open.upperBound..<close.lowerBound])
            }
        }
        for tag in ["script", "style", "iframe", "object", "embed", "noscript", "head"] {
            body = body.replacingOccurrences(of: "<\(tag)\\b[\\s\\S]*?</\(tag)\\s*>", with: "", options: [.regularExpression, .caseInsensitive])
        }
        return body.replacingOccurrences(of: "<(meta|link|base)\\b[^>]*>", with: "", options: [.regularExpression, .caseInsensitive])
    }

    /// Drops `src` from pictures that point at the network or other files (`without_remote_pictures`).
    static func withoutRemotePictures(_ body: String) -> String {
        body.replacingOccurrences(of: "(<img\\b[^>]*?)\\ssrc\\s*=\\s*[\"'](?:https?:|file:)?//[^\"']*[\"']", with: "$1", options: [.regularExpression, .caseInsensitive])
    }

    /// Plain text → paragraphs separated by blank lines, single newlines as `<br>`.
    static func textHTML(_ text: String) -> String {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        let parts = normalized.components(separatedBy: try! NSRegularExpression(pattern: "\n\\s*\n"))
        return parts.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\n")) }.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .map { "<p>\($0.components(separatedBy: "\n").map(escape).joined(separator: "<br>"))</p>" }.joined()
    }

    /// Decodes text with BOMs, a declared charset, UTF-8, then Windows-1252 as a last resort.
    static func decode(_ data: Data, declared: String.Encoding? = nil) -> String {
        if data.starts(with: [0xEF, 0xBB, 0xBF]) { return String(decoding: data.dropFirst(3), as: UTF8.self) }
        if data.starts(with: [0xFF, 0xFE]) { return String(data: data, encoding: .utf16LittleEndian) ?? "" }
        if data.starts(with: [0xFE, 0xFF]) { return String(data: data, encoding: .utf16BigEndian) ?? "" }
        if let declared, let text = String(data: data, encoding: declared) { return text }
        if let text = String(data: data, encoding: .utf8) { return text }
        return String(data: data, encoding: .windowsCP1252) ?? String(decoding: data, as: UTF8.self)
    }

    private static func declaredCharset(_ data: Data) -> String.Encoding? {
        let head = String(decoding: data.prefix(4096), as: UTF8.self)
        guard let range = head.range(of: "charset\\s*=\\s*[\"']?([A-Za-z0-9_\\-]+)", options: [.regularExpression, .caseInsensitive]) else { return nil }
        let name = head[range].split(separator: "=").last.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\"' ")) } ?? ""
        let cf = CFStringConvertIANACharSetNameToEncoding(name as CFString)
        guard cf != kCFStringEncodingInvalidId else { return nil }
        return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
    }

    /// Converts a text, Markdown or HTML file into document HTML plus a title (first `<h1>` or the file name).
    static func importFile(_ url: URL) throws -> (html: String, title: String) {
        let ext = url.pathExtension.lowercased()
        guard importExtensions.contains(ext) else { throw EngineError(.INVALID_PARAMS, reason: "unsupportedType", detail: ext) }
        let data = try withSecurityScope(url) { try Data(contentsOf: url) }
        guard data.count <= 20 * 1024 * 1024 else { throw EngineError(.INVALID_PARAMS, reason: "sourceTooLarge") }
        let body: String
        switch ext {
        case "html", "htm": body = withoutRemotePictures(bodyFragment(decode(data, declared: declaredCharset(data))))
        case "md", "markdown": body = StudioMarkdown.html(decode(data))
        default: body = textHTML(decode(data))
        }
        // Only pictures already embedded as data URLs survive (local files next to the page are outside the sandbox).
        let cleaned = body.replacingOccurrences(of: "<img\\b(?![^>]*\\ssrc\\s*=\\s*[\"']data:image/)[^>]*>", with: "", options: [.regularExpression, .caseInsensitive])
        var title = url.deletingPathExtension().lastPathComponent
        if let range = cleaned.range(of: "<h1\\b[^>]*>[\\s\\S]*?</h1\\s*>", options: [.regularExpression, .caseInsensitive]) {
            let heading = String(cleaned[range]).replacingOccurrences(of: "<[^>]*>", with: " ", options: .regularExpression)
                .replacingOccurrences(of: "&nbsp;", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            let unescaped = unescape(heading)
            if !unescaped.isEmpty { title = unescaped }
        }
        return (cleaned, title)
    }

    static func unescape(_ value: String) -> String {
        var out = value
        for (entity, char) in [("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'"), ("&nbsp;", "\u{00A0}"), ("&amp;", "&")] {
            out = out.replacingOccurrences(of: entity, with: char)
        }
        return out
    }
}

private extension String {
    func components(separatedBy regex: NSRegularExpression) -> [String] {
        let ns = self as NSString
        var parts: [String] = []
        var last = 0
        for match in regex.matches(in: self, range: NSRange(location: 0, length: ns.length)) {
            parts.append(ns.substring(with: NSRange(location: last, length: match.range.location - last)))
            last = match.range.location + match.range.length
        }
        parts.append(ns.substring(from: last))
        return parts
    }
}
