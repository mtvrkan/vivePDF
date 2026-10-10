import CoreText
import Foundation
import ImageIO
import PDFKit
import UIKit
import UniformTypeIdentifiers
import WebKit

/// Lays a Studio document out as a paginated PDF (port of `_studio_document.layout_document`).
///
/// The desktop flows the HTML with PyMuPDF's Story engine; on iOS WebKit paginates the same HTML and CSS
/// through `UIPrintPageRenderer`. Like the desktop's `write_stabilized_with_links`, layout runs twice when
/// the document has headings: the first pass finds on which page every heading lands (through invisible,
/// absolutely positioned markers) so the second pass can print the table of contents page numbers.
/// The cover, header/footer furniture, bookmarks, contents links and metadata are then added exactly as
/// the Python does. CSS lengths are written in px because WebKit prints one CSS pixel per PDF point.
@MainActor
enum StudioDocRenderer {
    static let maxPages = 5000
    static let furnitureSize = 8.5
    static let furnitureHeight = 16.0
    static let furnitureColour = "#666666"

    struct Heading: Equatable { var level: Int; var anchor: String; var title: String }

    /// Renders `document` to PDF bytes. `tocTitle` is the translated default contents title.
    static func render(_ document: StudioDocument, tocTitle: String, progress: ProgressHandler? = nil) async throws -> (data: Data, pageCount: Int) {
        let settings = document.settings
        let output = StudioDocHTML.document(document.renderNode, settings: settings)
        progress?(0.1, nil)
        let images = try output.images.enumerated().map { try preparedImage($1, index: $0) }
        try Task.checkCancellation()
        var body = clean(output.html, imageCount: images.count)
        if body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { body = "<p></p>" }
        body = substitute(images: images, in: body)
        body = pointsToPixels(body)
        let entries = headings(body, depth: settings.tocDepth)
        let outline = headings(body, depth: 3)
        let title = document.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? (outline.first?.title ?? "") : document.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let offset = settings.cover ? 1 : 0
        var layout = settings
        if layout.tocTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { layout.tocTitle = tocTitle }
        let fonts = output.fonts.isEmpty ? [StudioDocument.defaultFont] : output.fonts
        let css = fontCSS(fonts) + baseCSS(layout, headingFont: fonts.count > 1)
        let size = settings.pageSize
        let paper = CGRect(x: 0, y: 0, width: size.width, height: size.height)
        let margin = settings.marginPoints
        let printable = paper.insetBy(dx: margin, dy: margin)

        let printer = StudioDocPrinter(paper: paper, printable: printable)
        // Pass 1: where do headings (and contents rows) land?
        var anchors: [String: (page: Int, y: CGFloat)] = [:]
        var tocRows: [String: (page: Int, rect: CGRect)] = [:]
        if !outline.isEmpty || !entries.isEmpty {
            let marked = markHeadings(body)
            let toc = tocHTML(layout, entries, pages: [:], offset: offset, markers: true)
            let probe = try await printer.pdf(page(css: css, body: toc + marked), progress: progress, from: 0.15, to: 0.45)
            try Task.checkCancellation()
            if let pdf = PDFDocument(data: probe) {
                anchors = locate(markers: outline.map(\.anchor) + entries.map(\.anchor), prefix: "VPHM", in: pdf)
                tocRows = locateRows(entries.map(\.anchor), in: pdf, width: printable.width, left: printable.minX)
            }
        }
        // Pass 2: the real thing.
        let pages = anchors.mapValues(\.page)
        let toc = tocHTML(layout, entries, pages: pages.mapValues { $0 + 1 }, offset: offset, markers: false)
        let cover: ((CGContext, CGRect) -> Void)? = settings.cover ? { context, rect in
            StudioDocCover.draw(settings: settings, title: title, in: context, rect: rect)
        } : nil
        let bodyFont = fonts[0]
        let data = try await printer.pdf(page(css: css, body: toc + body), progress: progress, from: 0.5, to: 0.85, cover: cover) { context, index, total in
            drawFurniture(settings: settings, fontId: bodyFont, index: index, total: total, offset: offset, context: context, paper: paper)
        }
        progress?(0.9, nil)
        guard let pdf = PDFDocument(data: data) else { throw EngineError.internalError("document pdf") }
        addOutline(pdf, outline, anchors: anchors, offset: offset)
        addContentsLinks(pdf, entries, rows: tocRows, anchors: anchors, offset: offset)
        pdf.documentAttributes = [
            PDFDocumentAttribute.titleAttribute: settings.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? title : settings.title.trimmingCharacters(in: .whitespacesAndNewlines),
            PDFDocumentAttribute.subjectAttribute: settings.subtitle.trimmingCharacters(in: .whitespacesAndNewlines),
            PDFDocumentAttribute.authorAttribute: settings.author.trimmingCharacters(in: .whitespacesAndNewlines),
            PDFDocumentAttribute.creatorAttribute: "vivePDF",
        ]
        guard let final = pdf.dataRepresentation() else { throw EngineError.internalError("document pdf") }
        progress?(1, nil)
        return (final, pdf.pageCount)
    }

    // MARK: HTML assembly

    /// Images are re-encoded like `picture_bytes` (longest side ≤ 2400 px, JPEG 88 unless transparent).
    static func preparedImage(_ source: String, index: Int) throws -> String {
        guard StudioDocHTML.isDataImage(source), let comma = source.firstIndex(of: ","),
              let data = Data(base64Encoded: String(source[source.index(after: comma)...]), options: .ignoreUnknownCharacters) else {
            throw EngineError(.INVALID_PARAMS, reason: "badImage", detail: "\(index + 1)")
        }
        guard let encoded = StudioDocImages.encode(data) else { throw EngineError(.INVALID_PARAMS, reason: "imageUnreadable", detail: "\(index + 1)") }
        return encoded.src
    }

    /// `clean_html`: keeps only `vpimg-<n>` pictures and safe links.
    static func clean(_ source: String, imageCount: Int) -> String {
        var body = StudioDocHTML.bodyFragment(source)
        body = replace(in: body, pattern: "<img\\b[^>]*>") { tag in
            guard let range = tag.range(of: "\\ssrc\\s*=\\s*([\"'])vpimg-(\\d+)\\1", options: .regularExpression) else { return "" }
            let digits = tag[range].filter(\.isNumber)
            return (Int(digits) ?? Int.max) < imageCount ? tag : ""
        }
        return replace(in: body, pattern: "(<a\\b[^>]*?)\\shref\\s*=\\s*([\"'])(.*?)\\2") { match in
            guard let hrefRange = match.range(of: "\\shref\\s*=", options: .regularExpression) else { return match }
            let value = match[hrefRange.upperBound...].trimmingCharacters(in: CharacterSet(charactersIn: " \"'"))
            return StudioDocHTML.isSafeLink(StudioDocHTML.unescape(value).trimmingCharacters(in: .whitespaces)) ? match : String(match[..<hrefRange.lowerBound])
        }
    }

    static func substitute(images: [String], in body: String) -> String {
        replace(in: body, pattern: "src=\"vpimg-(\\d+)\"") { match in
            let digits = Int(match.filter(\.isNumber)) ?? 0
            return digits < images.count ? "src=\"\(images[digits])\"" : match
        }
    }

    /// Inline `pt` lengths inside style attributes become px (one CSS pixel prints as one point).
    static func pointsToPixels(_ body: String) -> String {
        replace(in: body, pattern: "style=\"[^\"]*\"") { $0.replacingOccurrences(of: "(\\d+(?:\\.\\d+)?)pt\\b", with: "$1px", options: .regularExpression) }
    }

    static func headings(_ body: String, depth: Int) -> [Heading] {
        guard let regex = try? NSRegularExpression(pattern: "<h([1-6])\\b[^>]*?\\sid\\s*=\\s*[\"'](h-\\d+)[\"'][^>]*>([\\s\\S]*?)</h\\1\\s*>", options: [.caseInsensitive]) else { return [] }
        let ns = body as NSString
        return regex.matches(in: body, range: NSRange(location: 0, length: ns.length)).compactMap { match in
            let level = Int(ns.substring(with: match.range(at: 1))) ?? 1
            let raw = ns.substring(with: match.range(at: 3)).replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
            let title = StudioDocHTML.unescape(raw).replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
            guard level <= depth, !title.isEmpty else { return nil }
            return Heading(level: level, anchor: ns.substring(with: match.range(at: 2)), title: title)
        }
    }

    private static func marker(_ prefix: String, _ anchor: String) -> String { "\(prefix)\(anchor.filter(\.isNumber))Z" }

    private static func markerSpan(_ text: String) -> String {
        "<span style=\"position:absolute;font-size:1px;line-height:1px;color:rgba(0,0,0,0.01)\">\(text)</span>"
    }

    static func markHeadings(_ body: String) -> String {
        replace(in: body, pattern: "<h([1-6])\\b[^>]*?\\sid\\s*=\\s*[\"'](h-\\d+)[\"'][^>]*>") { tag in
            guard let range = tag.range(of: "h-\\d+", options: .regularExpression) else { return tag }
            return tag + markerSpan(marker("VPHM", String(tag[range])))
        }
    }

    static func tocHTML(_ settings: StudioDocSettings, _ entries: [Heading], pages: [String: Int], offset: Int, markers: Bool) -> String {
        guard settings.toc, !entries.isEmpty else { return "" }
        let rows = entries.map { entry -> String in
            let probe = markers ? markerSpan(marker("VPTM", entry.anchor)) : ""
            return "<tr class=\"toc-\(entry.level)\"><td><div class=\"toc-entry\">\(probe)<a href=\"#\(entry.anchor)\">\(StudioDocHTML.escape(entry.title))</a></div></td><td class=\"toc-page\">\((pages[entry.anchor] ?? 0) + offset)</td></tr>"
        }.joined()
        let title = StudioDocHTML.escape(settings.tocTitle.trimmingCharacters(in: .whitespacesAndNewlines))
        let heading = title.isEmpty ? "" : "<p class=\"toc-title\">\(title)</p>"
        return "\(heading)<table class=\"toc\">\(rows)</table><div class=\"page-break\"></div>"
    }

    static func fontCSS(_ fonts: [String]) -> String {
        fonts.enumerated().map { StudioDocFonts.rules($1, cssFamily: "f\($0)") }.joined()
    }

    private static func f1(_ value: Double) -> String { String(format: "%.1f", value) }

    /// `_base_css` with px for pt.
    static func baseCSS(_ settings: StudioDocSettings, headingFont: Bool) -> String {
        let size = settings.fontSize
        let accent = settings.accent
        let headingFamily = headingFont ? "font-family:f1;" : ""
        return [
            "html,body{margin:0;padding:0;}",
            "body{font-family:f0;font-size:\(f1(size))px;line-height:\(settings.lineHeight);color:#1a1a1a;-webkit-print-color-adjust:exact;}",
            "p{margin:0 0 \(f1(size * 0.6))px 0;}",
            "h1,h2,h3,h4,h5,h6{\(headingFamily)color:\(accent);line-height:1.2;}",
            "h1{font-size:\(f1(size * 2))px;margin:\(f1(size))px 0 \(f1(size * 0.6))px 0;}",
            "h2{font-size:\(f1(size * 1.55))px;margin:\(f1(size))px 0 \(f1(size * 0.5))px 0;}",
            "h3{font-size:\(f1(size * 1.25))px;margin:\(f1(size * 0.8))px 0 \(f1(size * 0.4))px 0;}",
            "h4,h5,h6{font-size:\(f1(size * 1.08))px;margin:\(f1(size * 0.7))px 0 3px 0;}",
            "ul,ol{margin:0 0 6px 0;padding-left:18px;}",
            "li{margin:0 0 2px 0;}",
            "li p{margin:0;}",
            "ul.tasks{list-style-type:none;padding-left:2px;}",
            "blockquote{margin:0 0 8px 0;padding-left:10px;border-left:2px solid #cccccc;color:#444444;}",
            "pre{font-family:monospace;font-size:\(f1(size * 0.88))px;border-left:2px solid #d1d5db;padding:2px 0 2px 8px;white-space:pre-wrap;margin:0 0 8px 0;}",
            "code{font-family:monospace;}",
            "table{border-collapse:collapse;width:100%;margin:0 0 8px 0;}",
            "td,th{border:0.5px solid #999999;padding:3px 5px;vertical-align:top;}",
            "th{font-weight:bold;border-bottom:1px solid #666666;}",
            "hr{border:none;border-top:0.75px solid #bbbbbb;margin:8px 0;}",
            "img{max-width:100%;}",
            "a{color:\(accent);}",
            ".page-break{page-break-before:always;break-before:page;}",
            ".toc-title{font-size:\(f1(size * 1.7))px;margin:0 0 \(f1(size))px 0;}",
            ".toc{width:100%;border:none;}",
            ".toc td{border:none;padding:2px 0;vertical-align:bottom;}",
            ".toc a{color:#1a1a1a;text-decoration:none;}",
            ".toc-page{text-align:right;width:12%;}",
            ".toc-1 td{font-weight:bold;padding-top:4px;}",
            ".toc-2 .toc-entry{margin-left:12px;}",
            ".toc-3 .toc-entry{margin-left:24px;}",
            ".toc-entry{position:relative;}",
        ].joined()
    }

    static func page(css: String, body: String) -> String {
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><style>\(css)</style></head><body>\(body)</body></html>"
    }

    // MARK: Locating headings

    private static func locate(markers anchors: [String], prefix: String, in pdf: PDFDocument) -> [String: (page: Int, y: CGFloat)] {
        var found: [String: (page: Int, y: CGFloat)] = [:]
        for anchor in Set(anchors) {
            guard let selection = pdf.findString(marker(prefix, anchor), withOptions: []).first, let page = selection.pages.first else { continue }
            let bounds = selection.bounds(for: page)
            found[anchor] = (pdf.index(for: page), bounds.maxY)
        }
        return found
    }

    private static func locateRows(_ anchors: [String], in pdf: PDFDocument, width: CGFloat, left: CGFloat) -> [String: (page: Int, rect: CGRect)] {
        var rows: [String: (page: Int, rect: CGRect)] = [:]
        for anchor in anchors {
            guard let selection = pdf.findString(marker("VPTM", anchor), withOptions: []).first, let page = selection.pages.first else { continue }
            let bounds = selection.bounds(for: page)
            rows[anchor] = (pdf.index(for: page), CGRect(x: left, y: bounds.maxY - 14, width: width, height: 16))
        }
        return rows
    }

    private static func addOutline(_ pdf: PDFDocument, _ outline: [Heading], anchors: [String: (page: Int, y: CGFloat)], offset: Int) {
        let root = PDFOutline()
        var stack: [(level: Int, item: PDFOutline)] = [(0, root)]
        var previous = 0
        for entry in outline {
            guard let anchor = anchors[entry.anchor], let page = pdf.page(at: anchor.page + offset) else { continue }
            let level = min(entry.level, previous + 1)
            previous = level
            let item = PDFOutline()
            item.label = entry.title
            item.destination = PDFDestination(page: page, at: CGPoint(x: 0, y: anchor.y + 12))
            while let last = stack.last, last.level >= level { stack.removeLast() }
            let parent = stack.last?.item ?? root
            parent.insertChild(item, at: parent.numberOfChildren)
            stack.append((level, item))
        }
        if root.numberOfChildren > 0 { pdf.outlineRoot = root }
    }

    private static func addContentsLinks(_ pdf: PDFDocument, _ entries: [Heading], rows: [String: (page: Int, rect: CGRect)], anchors: [String: (page: Int, y: CGFloat)], offset: Int) {
        for entry in entries {
            guard let row = rows[entry.anchor], let target = anchors[entry.anchor],
                  let page = pdf.page(at: row.page + offset), let destination = pdf.page(at: target.page + offset) else { continue }
            let link = PDFAnnotation(bounds: row.rect, forType: .link, withProperties: nil)
            link.destination = PDFDestination(page: destination, at: CGPoint(x: 0, y: target.y + 12))
            link.border = PDFBorder()
            link.border?.lineWidth = 0
            page.addAnnotation(link)
        }
    }

    // MARK: Furniture

    private static func numberAlign(_ settings: StudioDocSettings, _ pageNumber: Int) -> StudioDocAlign {
        switch settings.pageNumbers {
        case .outside: pageNumber % 2 == 1 ? .right : .left
        case .right: .right
        default: .center
        }
    }

    /// `_bottom_line`: footer text and page number, joined with a middle dot when they share a side.
    static func bottomLine(_ settings: StudioDocSettings, pageNumber: Int, total: Int) -> [(StudioDocAlign, String)] {
        var order: [StudioDocAlign] = []
        var parts: [StudioDocAlign: [String]] = [:]
        func add(_ align: StudioDocAlign, _ text: String) {
            if parts[align] == nil { order.append(align) }
            parts[align, default: []].append(text)
        }
        let footer = settings.footer.trimmingCharacters(in: .whitespacesAndNewlines)
        if !footer.isEmpty { add(settings.footerAlign, footer) }
        if settings.pageNumbers != .none {
            add(numberAlign(settings, pageNumber), settings.pageNumberFormat.replacingOccurrences(of: "{n}", with: "\(pageNumber)").replacingOccurrences(of: "{total}", with: "\(total)"))
        }
        return order.map { ($0, parts[$0]!.joined(separator: "  \u{00B7}  ")) }
    }

    static func drawFurniture(settings: StudioDocSettings, fontId: String, index: Int, total: Int, offset: Int, context: CGContext, paper: CGRect) {
        guard index >= offset, index != offset || settings.furnitureOnFirst else { return }
        let margin = settings.marginPoints
        let top = max(4.0, margin / 2 - furnitureHeight / 2)
        let bottom = min(paper.height - 4.0, paper.height - margin / 2 + furnitureHeight / 2)
        var boxes: [(Double, StudioDocAlign, String)] = []
        let header = settings.header.trimmingCharacters(in: .whitespacesAndNewlines)
        if !header.isEmpty { boxes.append((top, settings.headerAlign, header)) }
        boxes += bottomLine(settings, pageNumber: index + 1, total: total).map { (bottom - furnitureHeight, $0.0, $0.1) }
        let font = StudioFonts.shared.face(fontId, weight: 400, italic: false).font(size: furnitureSize)
        for (y, align, text) in boxes {
            let rect = CGRect(x: margin, y: y, width: paper.width - margin * 2, height: furnitureHeight)
            StudioDocText.draw(StudioDocText.paragraph(text, font: font, color: furnitureColour, align: align.textAlignment), in: rect, context: context, vertical: .top)
        }
    }
}

extension StudioDocAlign {
    var textAlignment: CTTextAlignment {
        switch self {
        case .left: .left
        case .center: .center
        case .right: .right
        }
    }
}

/// Small regex replacement helper.
private func replace(in text: String, pattern: String, _ transform: (String) -> String) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return text }
    let ns = text as NSString
    var result = ""
    var last = 0
    for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        result += ns.substring(with: NSRange(location: last, length: match.range.location - last))
        result += transform(ns.substring(with: match.range))
        last = match.range.location + match.range.length
    }
    return result + ns.substring(from: last)
}

// MARK: - WebKit pagination

/// Loads HTML into an off-screen web view and prints it page by page into a PDF.
@MainActor
final class StudioDocPrinter: NSObject, WKNavigationDelegate {
    let paper: CGRect
    let printable: CGRect
    private var webView: WKWebView?
    private var loaded: CheckedContinuation<Void, Error>?

    init(paper: CGRect, printable: CGRect) {
        self.paper = paper
        self.printable = printable
    }

    private func load(_ html: String) async throws -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.suppressesIncrementalRendering = true
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: printable.width, height: printable.height), configuration: configuration)
        view.navigationDelegate = self
        webView = view
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            loaded = continuation
            view.loadHTMLString(html, baseURL: nil)
        }
        _ = try? await view.callAsyncJavaScript("await document.fonts.ready; await Promise.all(Array.from(document.images).map(i => i.decode().catch(() => null))); return 1", contentWorld: .page)
        return view
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in self.loaded?.resume(); self.loaded = nil }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in self.loaded?.resume(throwing: error); self.loaded = nil }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in self.loaded?.resume(throwing: error); self.loaded = nil }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        navigationAction.navigationType == .other ? .allow : .cancel
    }

    /// Prints `html`; `cover` draws an extra first page, `decorate` runs after every page is drawn.
    func pdf(_ html: String, progress: ProgressHandler?, from: Double, to: Double, cover: ((CGContext, CGRect) -> Void)? = nil,
             decorate: ((CGContext, Int, Int) -> Void)? = nil) async throws -> Data {
        let view = try await load(html)
        defer { webView = nil }
        let renderer = UIPrintPageRenderer()
        renderer.addPrintFormatter(view.viewPrintFormatter(), startingAtPageAt: 0)
        renderer.setValue(NSValue(cgRect: paper), forKey: "paperRect")
        renderer.setValue(NSValue(cgRect: printable), forKey: "printableRect")
        let count = renderer.numberOfPages
        guard count <= StudioDocRenderer.maxPages else {
            throw EngineError(.INVALID_PARAMS, reason: "tooManyPages", detail: "\(StudioDocRenderer.maxPages)")
        }
        let total = count + (cover == nil ? 0 : 1)
        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, paper, nil)
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: count))
        var index = 0
        if let cover, let context = UIGraphicsGetCurrentContext() {
            UIGraphicsBeginPDFPage()
            cover(context, paper)
            index += 1
        }
        for page in 0..<count {
            if Task.isCancelled { break }
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: page, in: paper)
            if let context = UIGraphicsGetCurrentContext() { decorate?(context, index, total) }
            index += 1
            progress?(from + (to - from) * Double(page + 1) / Double(max(1, count)), nil)
            if page % 8 == 7 { await Task.yield() }
        }
        UIGraphicsEndPDFContext()
        try Task.checkCancellation()
        return data as Data
    }
}

// MARK: - Text drawing (cover and furniture)

enum StudioDocText {
    enum Vertical { case top, center, bottom }

    static func color(_ hex: String) -> CGColor {
        let (r, g, b) = StudioColor.components(hex)
        return CGColor(red: r, green: g, blue: b, alpha: 1)
    }

    static func paragraph(_ text: String, font: CTFont, color hex: String, align: CTTextAlignment, lineHeight: Double = 1.25, tracking: Double = 0) -> NSAttributedString {
        var alignment = align
        var line = CGFloat(Double(CTFontGetSize(font)) * lineHeight)
        let settings = [
            CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: &alignment),
            CTParagraphStyleSetting(spec: .minimumLineHeight, valueSize: MemoryLayout<CGFloat>.size, value: &line),
            CTParagraphStyleSetting(spec: .maximumLineHeight, valueSize: MemoryLayout<CGFloat>.size, value: &line),
        ]
        let style = CTParagraphStyleCreate(settings, settings.count)
        var attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color(hex),
            NSAttributedString.Key(kCTParagraphStyleAttributeName as String): style,
        ]
        if tracking != 0 { attributes[NSAttributedString.Key(kCTKernAttributeName as String)] = tracking }
        return NSAttributedString(string: text, attributes: attributes)
    }

    static func height(_ text: NSAttributedString, width: CGFloat) -> CGFloat {
        let setter = CTFramesetterCreateWithAttributedString(text)
        return CTFramesetterSuggestFrameSizeWithConstraints(setter, CFRange(location: 0, length: text.length), nil, CGSize(width: width, height: .greatestFiniteMagnitude), nil).height
    }

    /// Draws `text` inside `rect` of a y-down context, aligned to the top, middle or bottom.
    static func draw(_ text: NSAttributedString, in rect: CGRect, context: CGContext, vertical: Vertical) {
        guard text.length > 0 else { return }
        let used = min(rect.height + 1000, ceil(height(text, width: rect.width)))
        let top: CGFloat = switch vertical {
        case .top: rect.minY
        case .center: rect.minY + max(0, (rect.height - used) / 2)
        case .bottom: rect.maxY - min(used, rect.height)
        }
        let frameRect = CGRect(x: rect.minX, y: top, width: rect.width, height: max(used, 1) + 2)
        context.saveGState()
        context.textMatrix = .identity
        context.translateBy(x: 0, y: frameRect.maxY)
        context.scaleBy(x: 1, y: -1)
        let path = CGPath(rect: CGRect(x: frameRect.minX, y: 0, width: frameRect.width, height: frameRect.height), transform: nil)
        let setter = CTFramesetterCreateWithAttributedString(text)
        let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), path, nil)
        CTFrameDraw(frame, context)
        context.restoreGState()
    }
}

// MARK: - Cover (port of ops/cover.py styles used by documents)

enum StudioDocCover {
    private struct Block { var text: String; var size: Double; var bold: Bool; var color: String; var tracking: Double = 0; var gap = false }

    static func draw(settings: StudioDocSettings, title rawTitle: String, in context: CGContext, rect page: CGRect) {
        let scale = min(page.width, page.height) / 595
        func size(_ points: Double) -> Double { (points * scale * 10).rounded() / 10 }
        let accent = StudioJSON.isColour(settings.accent) ? settings.accent : "#1f4e79"
        let serif = settings.coverStyle == .classic || settings.coverStyle == .frame
        func font(_ s: Double, bold: Bool) -> CTFont {
            let name = serif ? (bold ? "TimesNewRomanPS-BoldMT" : "TimesNewRomanPSMT") : (bold ? "Helvetica-Bold" : "Helvetica")
            return CTFontCreateWithName(name as CFString, CGFloat(s), nil)
        }
        func area(_ l: Double, _ t: Double, _ r: Double, _ b: Double) -> CGRect {
            CGRect(x: page.width * l, y: page.height * t, width: page.width * (r - l), height: page.height * (b - t))
        }
        let title = settings.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? rawTitle : settings.title.trimmingCharacters(in: .whitespacesAndNewlines)
        func text(_ value: String, _ s: Double, bold: Bool = false, color: String = "#1a1a1a") -> [Block] {
            value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? [] : [Block(text: value, size: size(s), bold: bold, color: color)]
        }
        func gap(_ s: Double) -> [Block] { [Block(text: "\u{00A0}", size: size(s), bold: false, color: "#1a1a1a", gap: true)] }
        func put(_ blocks: [Block], _ rect: CGRect, align: CTTextAlignment, vertical: StudioDocText.Vertical, colour override: String? = nil) {
            guard blocks.contains(where: { !$0.gap }) else { return }
            let joined = NSMutableAttributedString()
            for (index, block) in blocks.enumerated() {
                let value = (index == blocks.count - 1 ? block.text : block.text + "\n")
                joined.append(StudioDocText.paragraph(value, font: font(block.size, bold: block.bold), color: override ?? block.color, align: align, tracking: block.tracking))
            }
            StudioDocText.draw(joined, in: rect, context: context, vertical: vertical)
        }
        func people(_ s: Double = 13) -> [Block] {
            text(settings.author, s, bold: true) + text(settings.date, s - 2, color: "#555555")
        }
        func line(_ from: CGPoint, _ to: CGPoint, width: Double) {
            context.saveGState()
            context.setStrokeColor(StudioDocText.color(accent))
            context.setLineWidth(width)
            context.move(to: from)
            context.addLine(to: to)
            context.strokePath()
            context.restoreGState()
        }
        context.saveGState()
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(page)
        context.restoreGState()
        switch settings.coverStyle {
        case .classic:
            put(gap(18) + text(title, 32, bold: true, color: accent) + gap(8) + text(settings.subtitle, 16, color: "#555555"), area(0.12, 0.24, 0.88, 0.62), align: .center, vertical: .center)
            let middle = page.width / 2, y = page.height * 0.66
            line(CGPoint(x: middle - size(60), y: y), CGPoint(x: middle + size(60), y: y), width: size(2))
            put(people(), area(0.12, 0.7, 0.88, 0.92), align: .center, vertical: .center)
        case .band:
            context.setFillColor(StudioDocText.color(accent))
            context.fill(area(0, 0, 1, 0.42))
            put(gap(10) + text(title, 34, bold: true) + gap(6) + text(settings.subtitle, 15), area(0.1, 0.06, 0.9, 0.38), align: .left, vertical: .bottom, colour: "#ffffff")
            put(people(), area(0.1, 0.62, 0.9, 0.92), align: .left, vertical: .bottom)
        case .frame:
            let inset = size(28)
            let outer = page.insetBy(dx: inset, dy: inset)
            context.setStrokeColor(StudioDocText.color(accent))
            context.setLineWidth(size(2.5))
            context.stroke(outer)
            let step = size(6)
            context.setLineWidth(size(0.7))
            context.stroke(outer.insetBy(dx: step, dy: step))
            put(text(title, 28, bold: true, color: accent) + gap(8) + text(settings.subtitle, 15), area(0.14, 0.34, 0.86, 0.62), align: .center, vertical: .center)
            put(people(), area(0.14, 0.66, 0.86, 0.9), align: .center, vertical: .center)
        case .minimal:
            let left = page.width * 0.1
            line(CGPoint(x: left - size(14), y: page.height * 0.08), CGPoint(x: left - size(14), y: page.height * 0.92), width: size(3))
            put(text(settings.date, 11, color: "#555555"), area(0.55, 0.08, 0.9, 0.2), align: .right, vertical: .top)
            put(gap(8) + text(title, 40, bold: true) + gap(8) + text(settings.subtitle, 16, color: "#555555"), area(0.1, 0.3, 0.9, 0.7), align: .left, vertical: .bottom)
            put(text(settings.author, 13, bold: true), area(0.1, 0.74, 0.9, 0.92), align: .left, vertical: .bottom)
        }
    }
}

// MARK: - Pictures

enum StudioDocImages {
    struct Encoded { var src: String; var width: Int; var height: Int }

    /// `encoded_picture`: orientation applied, longest side ≤ 2400 px, PNG when transparent else JPEG 88.
    static func encode(_ data: Data) -> Encoded? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0 else { return nil }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
        let pixelWidth = (properties[kCGImagePropertyPixelWidth] as? Int) ?? 0
        let pixelHeight = (properties[kCGImagePropertyPixelHeight] as? Int) ?? 0
        let longest = max(pixelWidth, pixelHeight)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, min(2400, longest > 0 ? longest : 2400)),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let alpha = image.alphaInfo
        let transparent = !(alpha == .none || alpha == .noneSkipFirst || alpha == .noneSkipLast) && (properties[kCGImagePropertyHasAlpha] as? Bool ?? true)
        let output = NSMutableData()
        let type = transparent ? UTType.png.identifier : UTType.jpeg.identifier
        guard let destination = CGImageDestinationCreateWithData(output, type as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, transparent ? nil : [kCGImageDestinationLossyCompressionQuality: 0.88] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        let src = "data:image/\(transparent ? "png" : "jpeg");base64,\((output as Data).base64EncodedString())"
        return Encoded(src: src, width: image.width, height: image.height)
    }
}
