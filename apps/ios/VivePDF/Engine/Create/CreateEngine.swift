import CoreGraphics
import CoreText
import Foundation

/// Create tool engine: documents from text/Markdown with templates, documents from a table (mail
/// merge), printable paper and books. Mirrors `create.py`, `create_bulk.py`, `create_paper.py`,
/// `create_book.py` and `cover.py`, rendered with Core Text into a PDF context.
enum CreateEngine {
    static let pointsPerMM: CGFloat = 72 / 25.4
    static let defaultAccent = "#1f4e79"
    static let textExtensions = ["txt", "text", "md", "markdown"]
    static let logoExtensions = ["png", "jpg", "jpeg", "heic", "heif", "webp"]
    static let maxSourceBytes = 20 * 1024 * 1024

    /// Paper sizes in points (portrait), as PyMuPDF's `paper_rect`.
    static func paperSize(_ name: String, landscape: Bool = false) -> CGSize {
        let size: CGSize = switch name {
        case "letter": CGSize(width: 612, height: 792)
        case "a5": CGSize(width: 420, height: 595)
        case "a3": CGSize(width: 842, height: 1191)
        case "b5": CGSize(width: 499, height: 709)
        default: CGSize(width: 595, height: 842)
        }
        return landscape ? CGSize(width: size.height, height: size.width) : size
    }

    struct PageFurniture {
        var family: StoryFontFamily
        var header = ""
        var footer = ""
        var pageNumbers = true
        var format = "{page} / {total}"
        var margin: CGFloat
        var skipFirst = false

        static let fontSize: CGFloat = 8.5
        static let bandHeight: CGFloat = 18

        func draw(_ context: CGContext, _ canvas: StoryCanvas, index: Int, total: Int) {
            if skipFirst && index == 0 { return }
            let size = canvas.pageSize
            let style = StoryTextStyle(family: family, size: Self.fontSize, color: StoryColor.hex("#666666"))
            let top = max(4, margin / 2 - Self.bandHeight / 2)
            let bottom = min(size.height - 4, size.height - margin / 2 + Self.bandHeight / 2)
            let width = size.width - 2 * margin
            if !header.trimmingCharacters(in: .whitespaces).isEmpty {
                StoryRenderer.drawLine(header, style: style, in: CGRect(x: margin, y: top, width: width, height: Self.bandHeight), alignment: .right, context: context, canvas: canvas)
            }
            let footerRect = CGRect(x: margin, y: bottom - Self.bandHeight, width: width, height: Self.bandHeight)
            if !footer.trimmingCharacters(in: .whitespaces).isEmpty {
                StoryRenderer.drawLine(footer, style: style, in: footerRect, alignment: .left, context: context, canvas: canvas)
            }
            if pageNumbers {
                let number = skipFirst ? index : index + 1
                let count = skipFirst ? total - 1 : total
                let label = format.replacingOccurrences(of: "{page}", with: "\(number)").replacingOccurrences(of: "{total}", with: "\(count)")
                let hasFooter = !footer.trimmingCharacters(in: .whitespaces).isEmpty
                StoryRenderer.drawLine(label, style: style, in: footerRect, alignment: hasFooter ? .right : .center, context: context, canvas: canvas)
            }
        }
    }

    // MARK: - Reading sources

    static func readTextFile(_ url: URL) throws -> (text: String, markdown: Bool) {
        let ext = url.pathExtension.lowercased()
        guard textExtensions.contains(ext) else { throw EngineError(.INVALID_PARAMS, reason: "unsupportedType", detail: ".\(ext)") }
        guard FileManager.default.fileExists(atPath: url.path) else { throw EngineError(.FILE_NOT_FOUND, detail: url.lastPathComponent) }
        if Workspace.fileSize(url) > Int64(maxSourceBytes) { throw EngineError(.INVALID_PARAMS, reason: "sourceTooLarge") }
        guard let data = try? Data(contentsOf: url) else { throw EngineError(.FILE_NOT_FOUND, detail: url.lastPathComponent) }
        return (TextCodec.decode(data), ext == "md" || ext == "markdown")
    }

    static func loadLogo(_ url: URL?) throws -> CGImage? {
        guard let url else { return nil }
        guard FileManager.default.fileExists(atPath: url.path) else { throw EngineError(.FILE_NOT_FOUND, detail: url.lastPathComponent) }
        guard let image = StoryImages.load(url, maxPixels: 1200) else { throw EngineError(.INVALID_PARAMS, reason: "badImage", detail: url.lastPathComponent) }
        return image
    }
}

// MARK: - Single document

struct CreateDocumentOptions: Sendable {
    enum Template: String, CaseIterable, Sendable {
        case report, letter, petition, assignment, minutes, lectureNotes, booklet

        static let serif: Set<Template> = [.petition, .assignment, .booklet]
        var isFormal: Bool { self == .letter || self == .petition || self == .minutes }
    }

    var source: URL?
    var text: String?
    var template: Template = .report
    var title = ""
    var author = ""
    var date = ""
    var font: StoryFontFamily = .sans
    var fontSize: CGFloat = 11
    var marginMM: CGFloat = 20
    var accent = CreateEngine.defaultAccent
    var logo: URL?
    var header = ""
    var footer = ""
    var pageNumbers = true
    var pageNumberFormat = "{page} / {total}"
    var paper = "a4"
    var output: URL

    /// Font / paper / size a template switches to when chosen (`templateDefaults` on desktop).
    static func defaults(for template: Template, paper: String) -> (font: StoryFontFamily, paper: String, fontSize: CGFloat) {
        let font: StoryFontFamily = Template.serif.contains(template) ? .serif : .sans
        let size: CGFloat = template == .lectureNotes ? 10.5 : template == .booklet ? 10 : 11
        if template == .booklet { return (font, "a5", size) }
        return (font, paper == "a5" ? "a4" : paper, size)
    }
}

extension CreateEngine {
    static func createDocument(_ options: CreateDocumentOptions, progress: ProgressHandler?) async throws -> JobResult {
        progress?(0.1, t("progress.converting"))
        let text: String
        let markdown: Bool
        if let source = options.source {
            (text, markdown) = try withSecurityScope(source) { try readTextFile(source) }
        } else {
            guard let typed = options.text, !typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw EngineError(.INVALID_PARAMS, reason: "noContent")
            }
            text = typed
            markdown = MarkdownParser.looksLikeMarkdown(typed)
        }
        let logo = try options.logo.map { url in try withSecurityScope(url) { try loadLogo(url) } } ?? nil
        let blocks = markdown ? MarkdownParser.parse(text) : MarkdownParser.plainText(text)
        let pageSize = paperSize(options.paper)
        let margin = options.marginMM * pointsPerMM
        let frame = CGRect(x: margin, y: margin, width: pageSize.width - 2 * margin, height: pageSize.height - 2 * margin)
        let theme = documentTheme(options, baseURL: options.source?.deletingLastPathComponent())
        let items = DocumentTemplates.items(options, body: StoryBuilder.items(blocks, theme: theme), theme: theme, logo: logo)
        let paginator = StoryPaginator(pageSize: pageSize, frame: frame)
        try paginator.layout(items)
        try Task.checkCancellation()
        progress?(0.8, t("progress.saving"))
        let furniture = PageFurniture(family: options.font, header: options.header, footer: options.footer, pageNumbers: options.pageNumbers,
                                      format: options.pageNumberFormat, margin: margin, skipFirst: options.template == .booklet && paginator.pages.count > 1)
        try StoryRenderer.write(pages: paginator.pages, pageSize: pageSize, to: options.output,
                                metadata: StoryMetadata(title: options.title.trimmingCharacters(in: .whitespaces), author: options.author.trimmingCharacters(in: .whitespaces)),
                                after: { context, canvas, index, total in furniture.draw(context, canvas, index: index, total: total) })
        let count = paginator.pages.count
        return JobResult(outputs: [options.output], summary: t("tools.create.resultCaption", ["count": count]))
    }

    static func documentTheme(_ options: CreateDocumentOptions, baseURL: URL?) -> StoryTheme {
        let accent = StoryColor.hex(StoryColor.isValid(options.accent) ? options.accent : defaultAccent)
        var theme = StoryTheme(family: options.font, size: options.fontSize)
        theme.baseURL = baseURL
        let heading = options.template.isFormal ? StoryColor.text : accent
        theme.headingColor = [2: heading]
        switch options.template {
        case .assignment:
            theme.justify = true
        case .petition:
            theme.justify = true
            theme.paragraphIndent = 24
        case .lectureNotes:
            theme.headingRule = [2: (3, accent)]
            theme.quoteBackground = StoryColor.hex("#fff7e0")
            theme.quoteRule = (3, accent)
            theme.quoteColor = StoryColor.text
        case .booklet:
            theme.headingBreakBefore = [1]
        default:
            break
        }
        return theme
    }
}

/// The seven desktop templates (`_document_html` + `_template_rules`).
enum DocumentTemplates {
    static func items(_ options: CreateDocumentOptions, body: [StoryItem], theme: StoryTheme, logo: CGImage?) -> [StoryItem] {
        let size = options.fontSize
        let accent = StoryColor.hex(StoryColor.isValid(options.accent) ? options.accent : CreateEngine.defaultAccent)
        let title = options.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let author = options.author.trimmingCharacters(in: .whitespacesAndNewlines)
        let date = options.date.trimmingCharacters(in: .whitespacesAndNewlines)
        let meta = StoryColor.hex("#555555")

        func logoItem(centered: Bool) -> [StoryItem] {
            guard let logo else { return [] }
            return [.image(logo, maxWidth: 160, maxHeight: 48, centered: centered, box: StoryBox(spaceAfter: 8))]
        }
        func titleItem(_ alignment: CTTextAlignment = .natural, color: CGColor? = nil, scale: CGFloat = 1.9, after: CGFloat = 6) -> [StoryItem] {
            guard !title.isEmpty else { return [] }
            var style = theme.text(bold: true, size: size * scale, color: color ?? theme.color, alignment: alignment)
            style.lineHeight = 1.25
            return [.text(style.string(title), StoryBox(spaceAfter: after, keepWithNext: true))]
        }
        func metaItem(_ values: [String], alignment: CTTextAlignment = .natural) -> [StoryItem] {
            let shown = values.filter { !$0.isEmpty }
            guard !shown.isEmpty else { return [] }
            return [.text(theme.text(color: meta, alignment: alignment).string(shown.joined(separator: " · ")), StoryBox(spaceAfter: 4))]
        }
        func line(_ value: String, alignment: CTTextAlignment = .natural, bold: Bool = false, before: CGFloat = 0, after: CGFloat = 0) -> [StoryItem] {
            guard !value.isEmpty else { return [] }
            return [.text(theme.text(bold: bold, alignment: alignment).string(value), StoryBox(spaceBefore: before, spaceAfter: max(after, theme.spacing)))]
        }
        func signSpace(_ width: CGFloat? = nil) -> StoryItem {
            .drawing(height: 39, box: StoryBox(spaceAfter: 3, widthFraction: width)) { context, rect, canvas in
                context.setStrokeColor(StoryColor.hex("#333333"))
                context.setLineWidth(0.6)
                context.move(to: canvas.cg(CGPoint(x: rect.minX, y: rect.minY + 36)))
                context.addLine(to: canvas.cg(CGPoint(x: rect.maxX, y: rect.minY + 36)))
                context.strokePath()
            }
        }

        switch options.template {
        case .report:
            var head = logoItem(centered: false) + titleItem(color: accent) + metaItem([author, date])
            if let last = head.popLast() {
                if case .text(let string, var box) = last {
                    box.bottomRule = (1.5, accent, 6)
                    box.spaceAfter = 12
                    head.append(.text(string, box))
                } else {
                    head.append(last)
                    head.append(.rule(width: 1.5, color: accent, box: StoryBox(spaceBefore: 6, spaceAfter: 12)))
                }
            }
            return head + body

        case .assignment:
            var head = logoItem(centered: true) + titleItem(.center) + metaItem([author], alignment: .center) + metaItem([date], alignment: .center)
            head.append(.space(18))
            return head + body

        case .letter:
            var head = logoItem(centered: false)
            if !author.isEmpty {
                var style = theme.text(alignment: .right)
                style.alignment = .right
                head.append(.text(style.string(author), StoryBox(spaceAfter: theme.spacing)))
            }
            head += line(date, alignment: .right, after: 18)
            head += line(title, bold: true, after: 12)
            return head + body + line(author, before: 24)

        case .petition:
            var head = logoItem(centered: false) + line(date, alignment: .right, after: 18)
            head += titleItem(.center, scale: 1.2, after: 18)
            var tail: [StoryItem] = []
            if !author.isEmpty {
                tail.append(.space(24))
                tail.append(signSpace(0.4))
                var style = theme.text(alignment: .center)
                style.alignment = .center
                tail.append(.text(style.string(author), StoryBox(widthFraction: 0.4)))
            }
            return head + body + tail

        case .minutes:
            var head = logoItem(centered: true) + titleItem(.center) + metaItem([date], alignment: .center)
            head.append(.space(14))
            return head + body + signers(author, theme: theme)

        case .lectureNotes:
            var head = logoItem(centered: false) + titleItem() + metaItem([author, date])
            head = head.map { item in
                guard case .text(let string, var box) = item else { return item }
                box.leadingRule = (4, accent)
                box.horizontalPadding = 8
                return .text(string, box)
            }
            head.append(.space(12))
            return head + body

        case .booklet:
            var cover: [StoryItem] = [.space(120)]
            cover += logoItem(centered: true)
            cover += titleItem(.center, color: accent, scale: 2.4)
            cover += metaItem([author], alignment: .center) + metaItem([date], alignment: .center)
            cover.append(.pageBreak)
            // The first chapter heading must not add a second break right after the cover.
            var flowing = body
            if let index = flowing.firstIndex(where: { if case .text = $0 { return true } else { return false } }),
               case .text(let string, var box) = flowing[index] {
                box.breakBefore = false
                flowing[index] = .text(string, box)
            }
            return cover + flowing
        }
    }

    /// Minutes: a signature line for every attendee, three per row.
    static func signers(_ attendees: String, theme: StoryTheme) -> [StoryItem] {
        let names = attendees.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard !names.isEmpty else { return [] }
        var items: [StoryItem] = [.space(28)]
        for start in stride(from: 0, to: names.count, by: 3) {
            let row = Array(names[start..<min(start + 3, names.count)])
            let style = theme.text(alignment: .center)
            items.append(.drawing(height: 36 + 3 + theme.size * 1.45 + 14, box: StoryBox()) { context, rect, canvas in
                let cell = rect.width / 3
                for (column, name) in row.enumerated() {
                    let x = rect.minX + CGFloat(column) * cell + 8
                    let width = cell - 16
                    context.setStrokeColor(StoryColor.hex("#333333"))
                    context.setLineWidth(0.6)
                    context.move(to: canvas.cg(CGPoint(x: x, y: rect.minY + 36)))
                    context.addLine(to: canvas.cg(CGPoint(x: x + width, y: rect.minY + 36)))
                    context.strokePath()
                    var centered = style
                    centered.alignment = .center
                    StoryRenderer.drawText(centered.string(name), in: CGRect(x: x, y: rect.minY + 39, width: width, height: theme.size * 1.45 + 4), verticalCenter: false, context: context, canvas: canvas)
                }
            })
        }
        return items
    }
}
