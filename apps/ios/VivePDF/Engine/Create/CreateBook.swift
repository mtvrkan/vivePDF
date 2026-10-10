import CoreGraphics
import CoreText
import Foundation

struct CreateBookOptions: Sendable {
    static let papers = ["a5", "b5", "a4", "letter"]
    static let maxChapters = 200
    static let maxTotalBytes: Int64 = 60 * 1024 * 1024

    var chapters: [URL]
    var title = ""
    var subtitle = ""
    var author = ""
    var date = ""
    var cover = true
    var coverStyle: CoverDesign.Style = .classic
    var coverImage: URL?
    var toc = true
    var tocTitle = "Contents"
    /// 1 = chapters only, 2 = chapters and sections.
    var tocDepth = 2
    var chapterLabel = ""
    var runningHeader = true
    var pageNumbers = true
    var font: StoryFontFamily = .serif
    var fontSize: CGFloat = 11
    var marginMM: CGFloat = 18
    var accent = CreateEngine.defaultAccent
    var paper = "a5"
    var output: URL
}

/// A chapter file read and split into title, sections and body (`create_book._chapter`).
struct BookChapter {
    struct Section { let anchor: String; let title: String }
    let anchor: String
    var title: String
    var blocks: [MDBlock]
    var sections: [Section] = []

    /// "03_the-road" → "the-road"; underscores become spaces.
    static func title(fromFileName url: URL) -> String {
        let stem = url.deletingPathExtension().lastPathComponent
        let name = stem.replacingOccurrences(of: #"^\d+[\s._-]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "_", with: " ").trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? stem : name
    }

    /// Shifts heading levels so the highest becomes level 2 (the chapter title is the only h1).
    static func shiftHeadings(_ blocks: [MDBlock]) -> [MDBlock] {
        func levels(_ blocks: [MDBlock]) -> [Int] {
            blocks.flatMap { block -> [Int] in
                switch block {
                case .heading(let level, _): [level]
                case .quote(let children): levels(children)
                case .list(_, _, let items): items.flatMap(levels)
                default: []
                }
            }
        }
        guard let top = levels(blocks).min() else { return blocks }
        let delta = 2 - top
        func shifted(_ blocks: [MDBlock]) -> [MDBlock] {
            blocks.map { block in
                switch block {
                case .heading(let level, let inlines): .heading(level: min(6, max(2, level + delta)), inlines)
                case .quote(let children): .quote(shifted(children))
                case .list(let ordered, let start, let items): .list(ordered: ordered, start: start, items: items.map(shifted))
                default: block
                }
            }
        }
        return shifted(blocks)
    }

    static func read(_ url: URL, index: Int) throws -> BookChapter {
        let (text, markdown) = try withSecurityScope(url) { try CreateEngine.readTextFile(url) }
        var blocks = markdown ? MarkdownParser.parse(text) : MarkdownParser.plainText(text)
        var title = ""
        if case .heading(1, let inlines) = blocks.first {
            title = inlines.plainText.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            blocks.removeFirst()
        }
        var chapter = BookChapter(anchor: "c\(index)", title: title.isEmpty ? Self.title(fromFileName: url) : title, blocks: shiftHeadings(blocks))
        for case .heading(2, let inlines) in chapter.blocks {
            chapter.sections.append(Section(anchor: "c\(index)s\(chapter.sections.count + 1)", title: inlines.plainText))
        }
        return chapter
    }
}

extension CreateEngine {
    static func createBook(_ options: CreateBookOptions, progress: ProgressHandler?) async throws -> JobResult {
        let title = options.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { throw EngineError(.INVALID_PARAMS, reason: "noTitle") }
        guard !options.chapters.isEmpty, options.chapters.count <= CreateBookOptions.maxChapters else { throw EngineError.invalid("chapters") }
        let total = options.chapters.reduce(Int64(0)) { sum, url in sum + withSecurityScope(url) { Workspace.fileSize(url) } }
        if total > CreateBookOptions.maxTotalBytes { throw EngineError(.INVALID_PARAMS, reason: "sourceTooLarge") }
        progress?(0.05, t("progress.converting"))
        var chapters: [BookChapter] = []
        for (index, url) in options.chapters.enumerated() {
            try Task.checkCancellation()
            chapters.append(try BookChapter.read(url, index: index + 1))
        }
        var photo: CGImage?
        if options.cover && options.coverStyle == .photo {
            guard let url = options.coverImage else { throw EngineError(.INVALID_PARAMS, reason: "noCoverImage") }
            photo = withSecurityScope(url) { StoryImages.load(url, maxPixels: 2400) }
            if photo == nil { throw EngineError(.INVALID_PARAMS, reason: "badImage") }
        }
        progress?(0.15, t("progress.converting"))
        let pageSize = paperSize(options.paper)
        let margin = options.marginMM * pointsPerMM
        let frame = CGRect(x: margin, y: margin, width: pageSize.width - 2 * margin, height: pageSize.height - 2 * margin)
        let offset = options.cover ? 1 : 0

        // Lay out until the contents page numbers stop moving (the contents length can shift pages).
        var known: [String: Int] = [:]
        var paginator = StoryPaginator(pageSize: pageSize, frame: frame)
        for _ in 0..<4 {
            try Task.checkCancellation()
            paginator = StoryPaginator(pageSize: pageSize, frame: frame)
            try paginator.layout(bookItems(options, chapters: chapters, pages: known, offset: offset))
            let found = paginator.anchors.mapValues { $0.page + 1 }
            if found == known { break }
            known = found
        }
        progress?(0.8, t("progress.saving"))

        var pages = paginator.pages
        if options.cover {
            let design = CoverDesign(style: options.coverStyle, title: title, subtitle: options.subtitle, author: options.author,
                                     date: options.date, accent: options.accent, font: options.font, photo: photo)
            let page = StoryPage()
            page.ops.append { context, canvas in try? CoverDesigner.draw(design, context: context, canvas: canvas) }
            pages.insert(page, at: 0)
        }
        let openings = Set(chapters.compactMap { known[$0.anchor] })
        let starts = chapters.compactMap { chapter in known[chapter.anchor].map { ($0, chapter.title) } }.sorted { $0.0 < $1.0 }
        let family = options.font
        let runningHeader = options.runningHeader, pageNumbers = options.pageNumbers
        let temp = Workspace.scratch().appendingPathComponent("book.pdf")
        try StoryRenderer.write(pages: pages, pageSize: pageSize, to: temp,
                                metadata: StoryMetadata(title: title, author: options.author.trimmingCharacters(in: .whitespaces), subject: options.subtitle.trimmingCharacters(in: .whitespaces)),
                                after: { context, canvas, index, _ in
            guard index >= offset else { return }
            let storyPage = index - offset + 1
            let style = StoryTextStyle(family: family, size: PageFurniture.fontSize, color: StoryColor.hex("#666666"))
            let width = pageSize.width - 2 * margin
            if runningHeader, !openings.contains(storyPage), let chapter = starts.last(where: { $0.0 <= storyPage }) {
                let top = max(4, margin / 2 - PageFurniture.bandHeight / 2)
                StoryRenderer.drawLine(chapter.1, style: style, in: CGRect(x: margin, y: top, width: width, height: PageFurniture.bandHeight), alignment: .right, context: context, canvas: canvas)
            }
            if pageNumbers {
                let bottom = min(pageSize.height - 4, pageSize.height - margin / 2 + PageFurniture.bandHeight / 2)
                StoryRenderer.drawLine("\(index + 1)", style: style, in: CGRect(x: margin, y: bottom - PageFurniture.bandHeight, width: width, height: PageFurniture.bandHeight), alignment: .center, context: context, canvas: canvas)
            }
        })

        // Bookmarks: contents, chapters and their sections.
        var outline: [PDFOutlineWriter.Entry] = []
        if options.toc { outline.append(.init(level: 1, title: options.tocTitle.trimmingCharacters(in: .whitespaces).isEmpty ? "Contents" : options.tocTitle, page: offset)) }
        for chapter in chapters {
            guard let page = known[chapter.anchor] else { continue }
            outline.append(.init(level: 1, title: chapter.title, page: page - 1 + offset))
            for section in chapter.sections {
                if let sectionPage = known[section.anchor] { outline.append(.init(level: 2, title: section.title, page: sectionPage - 1 + offset)) }
            }
        }
        try PDFOutlineWriter.write(outline, source: temp, to: options.output)
        return JobResult(outputs: [options.output], summary: t("tools.create.resultCaption", ["count": pages.count]))
    }

    static func bookTheme(_ options: CreateBookOptions) -> StoryTheme {
        let size = options.fontSize
        let accent = StoryColor.hex(StoryColor.isValid(options.accent) ? options.accent : defaultAccent)
        var theme = StoryTheme(family: options.font, size: size)
        theme.lineHeight = 1.5
        theme.justify = true
        theme.paragraphSpacing = size * 0.55
        theme.headingScales = [2, 1.3, 1.12, 1, 1, 1]
        theme.headingColor = [2: accent]
        theme.headingSpace = [2: (size * 1.2, 4), 3: (size, 3), 4: (size * 0.8, 2), 5: (size * 0.8, 2), 6: (size * 0.8, 2)]
        return theme
    }

    private static func bookItems(_ options: CreateBookOptions, chapters: [BookChapter], pages: [String: Int], offset: Int) -> [StoryItem] {
        let size = options.fontSize
        let accent = StoryColor.hex(StoryColor.isValid(options.accent) ? options.accent : defaultAccent)
        let theme = bookTheme(options)
        var items: [StoryItem] = []
        if !options.cover {
            var front: [StoryItem] = []
            let title = options.title.trimmingCharacters(in: .whitespaces)
            if !title.isEmpty {
                var style = theme.text(bold: true, size: size * 2.4, color: accent, alignment: .natural)
                style.lineHeight = 1.25
                front.append(.text(style.string(title), StoryBox(spaceAfter: 6)))
            }
            for (value, colour, scale) in [(options.subtitle, StoryColor.hex("#444444"), 1.3), (options.author, StoryColor.hex("#555555"), 1.0)] {
                let trimmed = value.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty {
                    front.append(.text(theme.text(size: size * scale, color: colour, alignment: .natural).string(trimmed), StoryBox(spaceAfter: size * 0.55)))
                }
            }
            if !front.isEmpty {
                items.append(.space(size * 3))
                items += front
                items.append(.space(size * 2))
            }
        }
        if options.toc {
            var heading = theme.text(bold: true, size: size * 1.7, alignment: .natural)
            heading.lineHeight = 1.25
            items.append(.text(heading.string(options.tocTitle.trimmingCharacters(in: .whitespaces).isEmpty ? "Contents" : options.tocTitle), StoryBox(spaceAfter: size)))
            var rows: [[NSAttributedString]] = []
            var links: [[String?]] = []
            var spaces: [CGFloat] = []
            func number(_ anchor: String) -> String { pages[anchor].map { String($0 + offset) } ?? "000" }
            for chapter in chapters {
                var bold = theme.text(bold: true, alignment: .natural)
                bold.lineHeight = 1.3
                var right = theme.text(bold: true, alignment: .right)
                right.lineHeight = 1.3
                rows.append([bold.string(chapter.title), right.string(number(chapter.anchor))])
                links.append(["#\(chapter.anchor)", "#\(chapter.anchor)"])
                spaces.append(5)
                guard options.tocDepth >= 2 else { continue }
                for section in chapter.sections {
                    var plain = theme.text(color: StoryColor.hex("#333333"), alignment: .natural)
                    plain.lineHeight = 1.3
                    plain.headIndent = 12
                    plain.firstLineIndent = 12
                    var numberStyle = theme.text(color: StoryColor.hex("#333333"), alignment: .right)
                    numberStyle.lineHeight = 1.3
                    rows.append([plain.string(section.title), numberStyle.string(number(section.anchor))])
                    links.append(["#\(section.anchor)", "#\(section.anchor)"])
                    spaces.append(0)
                }
            }
            var table = StoryTable(rows: rows, columnFractions: [0.88, 0.12])
            table.border = nil
            table.paddingX = 0
            table.paddingY = 2
            table.verticalAlignBottom = true
            table.cellLinks = links
            table.rowSpaceBefore = spaces
            items.append(.table(table))
        }
        let leads = !items.isEmpty
        for (position, chapter) in chapters.enumerated() {
            let numberText = options.chapterLabel.replacingOccurrences(of: "{n}", with: "\(position + 1)").trimmingCharacters(in: .whitespaces)
            let breaks = leads || position > 0
            var opening: [StoryItem] = []
            if !numberText.isEmpty {
                var label = theme.text(size: size * 0.95, color: accent, alignment: .natural)
                label.letterSpacing = 1
                opening.append(.text(label.string(numberText), StoryBox(spaceAfter: 4, keepWithNext: true)))
            }
            var titleStyle = theme.text(bold: true, size: size * 2, alignment: .natural)
            titleStyle.lineHeight = 1.2
            opening.append(.text(titleStyle.string(chapter.title), StoryBox(spaceAfter: size * 2, keepWithNext: true, anchor: chapter.anchor)))
            if breaks { items.append(.pageBreak) }
            items.append(.space(size * 5))
            items += opening
            var chapterTheme = theme
            var sectionIndex = 0
            let sections = chapter.sections
            chapterTheme.anchor = { level, _ in
                guard level == 2, sectionIndex < sections.count else { return nil }
                defer { sectionIndex += 1 }
                return sections[sectionIndex].anchor
            }
            chapterTheme.baseURL = options.chapters[position].deletingLastPathComponent()
            items += StoryBuilder.items(chapter.blocks, theme: chapterTheme)
        }
        return items
    }
}
