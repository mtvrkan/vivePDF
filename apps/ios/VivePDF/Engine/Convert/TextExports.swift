import CoreGraphics
import Foundation
import PDFKit

/// A styled piece of a paragraph after joining its lines.
struct InlineRun {
    var text: String
    var bold: Bool
    var italic: Bool
    var mono: Bool
    var link: String?
    var size: CGFloat
    var color: String
    var fontName: String
}

extension TextBlock {
    /// The paragraph as styled runs: lines joined with spaces (hyphenation undone), equal styles merged.
    var runs: [InlineRun] {
        var out: [InlineRun] = []
        for (lineIndex, line) in lines.enumerated() {
            var spans = line.spans
            if let last = spans.indices.last { spans[last].text = spans[last].text.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression) }
            if lineIndex > 0, let previous = out.last {
                if previous.text.hasSuffix("-"), previous.text.count > 1, let first = line.text.trimmingCharacters(in: .whitespaces).first, first.isLowercase {
                    out[out.count - 1].text.removeLast()
                } else if !previous.text.hasSuffix(" ") {
                    out[out.count - 1].text += " "
                }
            }
            for span in spans where !span.text.isEmpty {
                let run = InlineRun(text: lineIndex > 0 && out.last?.text.hasSuffix(" ") == true ? span.text.replacingOccurrences(of: #"^\s+"#, with: "", options: .regularExpression) : span.text,
                                    bold: span.bold, italic: span.italic, mono: span.monospace, link: span.link, size: span.size, color: span.hexColor, fontName: span.fontName)
                if var last = out.last, last.bold == run.bold, last.italic == run.italic, last.mono == run.mono, last.link == run.link,
                   last.color == run.color, abs(last.size - run.size) < 0.6 {
                    last.text += run.text
                    out[out.count - 1] = last
                } else {
                    out.append(run)
                }
            }
        }
        if let first = out.indices.first { out[first].text = out[first].text.replacingOccurrences(of: #"^\s+"#, with: "", options: .regularExpression) }
        return out.filter { !$0.text.isEmpty }
    }
}

extension ConvertEngine {
    struct TextOptions: Sendable {
        var layout = false
        var ocr = false
        var output: URL
    }

    // MARK: Plain text

    static func toText(_ source: PDFSource, _ options: TextOptions, progress: ProgressHandler?) async throws -> JobResult {
        let document = try open(source)
        let indices = try indices(source, document)
        let (pages, recognised) = try readPages(document, indices: indices, ocr: options.ocr, graphics: false, progress: progress, band: 0...0.95)
        var chunks: [String] = []
        var textless: [Int] = []
        for page in pages {
            let text = options.layout ? layoutText(page) : plainText(page)
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { textless.append(page.index + 1) }
            chunks.append(text.isEmpty || text.hasSuffix("\n") ? text : text + "\n")
        }
        try chunks.joined(separator: "\u{000C}").write(to: options.output, atomically: true, encoding: .utf8)
        var report = ConvertReport(count: 1, label: "files")
        report.textless = (textless, "textlessFile")
        report.ocrPages = recognised
        return report.result([options.output])
    }

    /// Lines in reading order, a blank line between paragraphs, table rows tab-separated.
    static func plainText(_ page: PageContent) -> String {
        var parts: [String] = []
        for element in PageLayout.elements(page, tables: PageLayout.tables(page, borderless: false), images: false) {
            switch element {
            case .paragraph(let block): parts.append(block.lines.map { $0.text.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n"))
            case .table(let table): parts.append(table.rows.map { $0.map { ($0 ?? "").replacingOccurrences(of: "\n", with: " ") }.joined(separator: "\t") }.joined(separator: "\n"))
            case .image: break
            }
        }
        return parts.joined(separator: "\n\n")
    }

    /// Text placed on a character grid so columns and indentation survive (`page_layout` on desktop).
    static func layoutText(_ page: PageContent) -> String {
        let spans = page.lines.flatMap(\.spans).filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !spans.isEmpty else { return "" }
        let widths = spans.map { $0.rect.width / CGFloat(max($0.text.count, 1)) }.sorted()
        let cell = max(widths[widths.count / 2], 2)
        let lines = page.lines.sorted { $0.rect.minY < $1.rect.minY }
        var rows: [(y: CGFloat, spans: [TextSpan])] = []
        for line in lines {
            if let last = rows.last, abs(last.y - line.rect.midY) < line.rect.height * 0.5 {
                rows[rows.count - 1].spans += line.spans
            } else {
                rows.append((line.rect.midY, line.spans))
            }
        }
        let lineHeight = max(page.bodySize * 1.2, 4)
        var output: [String] = []
        var previousY: CGFloat?
        for row in rows {
            if let previousY {
                let blank = Int(((row.y - previousY) / lineHeight).rounded()) - 1
                if blank > 0 { output += Array(repeating: "", count: min(blank, 3)) }
            }
            previousY = row.y
            var characters: [Character] = []
            for span in row.spans.sorted(by: { $0.rect.minX < $1.rect.minX }) {
                let column = max(0, Int((span.rect.minX / cell).rounded()))
                if characters.count < column { characters += Array(repeating: " ", count: column - characters.count) }
                else if !characters.isEmpty && characters.last != " " && !span.text.hasPrefix(" ") { characters.append(" ") }
                characters += Array(span.text)
            }
            output.append(String(characters).replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression))
        }
        return output.joined(separator: "\n")
    }

    // MARK: Markdown

    enum MarkdownPictures: String, Sendable { case none, files, embed }

    struct MarkdownOptions: Sendable {
        var pictures: MarkdownPictures = .none
        var ocr = false
        var output: URL
    }

    static func markdownEscape(_ text: String) -> String {
        var out = ""
        for character in text {
            if "\\`*_[]".contains(character) { out.append("\\") }
            if character == "<" { out += "&lt;"; continue }
            out.append(character)
        }
        return out
    }

    static func markdownInline(_ runs: [InlineRun]) -> String {
        runs.map { run in
            let core = run.text.trimmingCharacters(in: .whitespaces)
            guard !core.isEmpty else { return run.text }
            let lead = run.text.hasPrefix(" ") ? " " : "", tail = run.text.hasSuffix(" ") ? " " : ""
            var text = run.mono ? "`\(core.replacingOccurrences(of: "`", with: "'"))`" : markdownEscape(core)
            if run.bold && run.italic { text = "***\(text)***" } else if run.bold { text = "**\(text)**" } else if run.italic { text = "*\(text)*" }
            if let link = run.link { text = "[\(text)](\(link.replacingOccurrences(of: " ", with: "%20").replacingOccurrences(of: ")", with: "%29")))" }
            return lead + text + tail
        }.joined()
    }

    static func toMarkdown(_ source: PDFSource, _ options: MarkdownOptions, progress: ProgressHandler?) async throws -> JobResult {
        let document = try open(source)
        let indices = try indices(source, document)
        let (pages, recognised) = try readPages(document, indices: indices, ocr: options.ocr, progress: progress, band: 0...0.9)
        let body = bodySize(pages)
        let folderName = "\(stem(options.output))-images"
        let folder = options.output.deletingLastPathComponent().appendingPathComponent(folderName, isDirectory: true)
        var pictureCount = 0
        var savedPictures = false
        var parts: [String] = []
        var textless: [Int] = []
        for page in pages {
            if !page.hasText { textless.append(page.index + 1) }
            let keepPictures = options.pictures != .none && !recognised.contains(page.index + 1)
            var number = 0
            for element in PageLayout.elements(page, tables: PageLayout.tables(page, borderless: false), images: keepPictures) {
                switch element {
                case .paragraph(let block):
                    let runs = block.runs
                    if let level = PageLayout.headingLevel(block, body: body) {
                        parts.append(String(repeating: "#", count: level) + " " + markdownEscape(block.text))
                    } else if let marker = PageLayout.listMarker(block.text) {
                        var inline = markdownInline(runs).trimmingCharacters(in: .whitespaces)
                        let markerEscaped = markdownEscape(marker.marker)
                        if inline.hasPrefix(markerEscaped) { inline = String(inline.dropFirst(markerEscaped.count)).trimmingCharacters(in: .whitespaces) }
                        else if inline.hasPrefix(marker.marker) { inline = String(inline.dropFirst(marker.marker.count)).trimmingCharacters(in: .whitespaces) }
                        parts.append((marker.ordered ? "1. " : "- ") + inline)
                    } else {
                        parts.append(markdownInline(runs))
                    }
                case .table(let table):
                    parts.append(markdownTable(table))
                case .image(let image):
                    guard let pdfPage = document.page(at: page.index),
                          let picture = PageRenderer.render(pdfPage, dpi: PageRenderer.safeDPI(image.rect.size, dpi: 150), clip: image.rect),
                          let png = ImageEncoder.data([picture], format: .png) else { continue }
                    number += 1
                    pictureCount += 1
                    if options.pictures == .embed {
                        parts.append("![](data:image/png;base64,\(png.base64EncodedString()))")
                    } else {
                        let name = String(format: "page-%04d-%02d.png", page.index + 1, number)
                        Workspace.ensure(folder)
                        try png.write(to: folder.appendingPathComponent(name))
                        savedPictures = true
                        parts.append("![](\(folderName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? folderName)/\(name))")
                    }
                }
            }
        }
        // Consecutive list items stay together; other blocks are separated by a blank line.
        var markdown = ""
        for (index, part) in parts.enumerated() {
            if index > 0 {
                let previousItem = parts[index - 1].hasPrefix("- ") || parts[index - 1].hasPrefix("1. ")
                let item = part.hasPrefix("- ") || part.hasPrefix("1. ")
                markdown += previousItem && item ? "\n" : "\n\n"
            }
            markdown += part
        }
        try TextCodec.xmlSafe(markdown + "\n").write(to: options.output, atomically: true, encoding: .utf8)
        var report = ConvertReport(count: 1, label: "files")
        report.textless = (textless, "textlessPages")
        report.ocrPages = recognised
        if pictureCount > 0 { report.pictures = (pictureCount, savedPictures ? folderName : nil) }
        return report.result(savedPictures ? [options.output, folder] : [options.output])
    }

    static func markdownTable(_ table: DetectedTable) -> String {
        let rows = table.rows.map { row in row.map { cell in
            markdownEscape(cell ?? "").replacingOccurrences(of: "|", with: "\\|").replacingOccurrences(of: "\n", with: "<br>")
        } }
        guard let header = rows.first else { return "" }
        var lines = ["| " + header.joined(separator: " | ") + " |", "|" + Array(repeating: "---|", count: header.count).joined()]
        lines += rows.dropFirst().map { "| " + $0.joined(separator: " | ") + " |" }
        return lines.joined(separator: "\n")
    }

    // MARK: HTML

    static func htmlInline(_ runs: [InlineRun]) -> String {
        runs.map { run in
            var text = XMLText.escape(run.text, quotes: false)
            if run.mono { text = "<code>\(text)</code>" }
            if run.italic { text = "<i>\(text)</i>" }
            if run.bold { text = "<b>\(text)</b>" }
            if let link = run.link { text = "<a href=\"\(XMLText.escape(link))\">\(text)</a>" }
            return text
        }.joined()
    }

    /// One page as HTML/XHTML fragments (headings by size, lists, tables, pictures through `picture`).
    static func pageHTML(_ page: PageContent, body: CGFloat, images: Bool, picture: (PlacedImage) -> String?) -> String {
        var html: [String] = []
        var openList: String?
        func closeList() { if let tag = openList { html.append("</\(tag)>"); openList = nil } }
        for element in PageLayout.elements(page, tables: PageLayout.tables(page, borderless: false), images: images) {
            switch element {
            case .paragraph(let block):
                let direction = block.rtl ? " dir=\"rtl\"" : ""
                if let level = PageLayout.headingLevel(block, body: body) {
                    closeList()
                    html.append("<h\(level)\(direction)>\(XMLText.escape(block.text, quotes: false))</h\(level)>")
                } else if let marker = PageLayout.listMarker(block.text) {
                    let tag = marker.ordered ? "ol" : "ul"
                    if openList != tag { closeList(); html.append("<\(tag)>"); openList = tag }
                    var inline = htmlInline(block.runs)
                    let escaped = XMLText.escape(marker.marker, quotes: false)
                    if let range = inline.range(of: escaped), inline[..<range.lowerBound].allSatisfy({ $0 == " " || $0 == "<" || $0.isLetter || $0 == ">" || $0 == "/" }) {
                        inline.removeSubrange(range)
                    }
                    html.append("<li\(direction)>\(inline.trimmingCharacters(in: .whitespaces))</li>")
                } else {
                    closeList()
                    html.append("<p\(direction)>\(htmlInline(block.runs))</p>")
                }
            case .table(let table):
                closeList()
                var rows: [String] = []
                for row in 0..<table.rowCount {
                    var cells: [String] = []
                    for column in 0..<table.columnCount {
                        if let merge = table.merge(at: row, column), merge.r0 != row || merge.c0 != column { continue }
                        var attributes = ""
                        if let merge = table.merge(at: row, column) {
                            if merge.c1 > merge.c0 { attributes += " colspan=\"\(merge.c1 - merge.c0 + 1)\"" }
                            if merge.r1 > merge.r0 { attributes += " rowspan=\"\(merge.r1 - merge.r0 + 1)\"" }
                        }
                        let text = XMLText.escape(table.text(row, column), quotes: false).replacingOccurrences(of: "\n", with: "<br/>")
                        cells.append("<td\(attributes)>\(text)</td>")
                    }
                    rows.append("<tr>\(cells.joined())</tr>")
                }
                html.append("<table>\(rows.joined())</table>")
            case .image(let image):
                closeList()
                if let tag = picture(image) { html.append(tag) }
            }
        }
        closeList()
        return html.joined(separator: "\n")
    }

    static func languageTag(_ document: PDFDocument) -> String? {
        guard let catalog = document.documentRef?.catalog else { return nil }
        var string: CGPDFStringRef?
        guard CGPDFDictionaryGetString(catalog, "Lang", &string), let string, let value = CGPDFStringCopyTextString(string) as String? else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        return trimmed.range(of: #"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$"#, options: .regularExpression) != nil ? trimmed : nil
    }

    static func toHTML(_ source: PDFSource, ocr: Bool, output: URL, progress: ProgressHandler?) async throws -> JobResult {
        let document = try open(source)
        let indices = try indices(source, document)
        let (pages, recognised) = try readPages(document, indices: indices, ocr: ocr, progress: progress, band: 0...0.9)
        let body = bodySize(pages)
        var sections: [String] = []
        var textless: [Int] = []
        for page in pages {
            if !page.hasText { textless.append(page.index + 1) }
            let images = !recognised.contains(page.index + 1)
            let html = pageHTML(page, body: body, images: images) { image in
                guard let pdfPage = document.page(at: page.index),
                      let picture = PageRenderer.render(pdfPage, dpi: PageRenderer.safeDPI(image.rect.size, dpi: 150), clip: image.rect),
                      let encoded = ImageEncoder.documentPicture(picture) else { return nil }
                return "<img src=\"data:\(encoded.mime);base64,\(encoded.data.base64EncodedString())\" alt=\"\" width=\"\(Int(image.rect.width.rounded()))\"/>"
            }
            sections.append("<section class=\"page\" data-page=\"\(page.index + 1)\">\(html)</section>")
        }
        let title = XMLText.escape(title(document, source: source.url), quotes: false)
        let opening = languageTag(document).map { "<html lang=\"\(XMLText.escape($0))\">" } ?? "<html>"
        let html = "<!doctype html>\(opening)<head><meta charset=\"utf-8\"><title>\(title)</title>"
            + "<style>body{font-family:sans-serif;max-width:52em;margin:2em auto;padding:0 1em}"
            + ".page{border-bottom:1px solid #ddd;padding:1em 0}img{max-width:100%;height:auto}"
            + "table{border-collapse:collapse}td{border:1px solid #bbb;padding:2px 6px;vertical-align:top}</style>"
            + "</head><body>" + sections.joined() + "</body></html>"
        try html.write(to: output, atomically: true, encoding: .utf8)
        var report = ConvertReport(count: 1, label: "files")
        report.textless = (textless, "textlessFile")
        report.ocrPages = recognised
        return report.result([output])
    }
}
