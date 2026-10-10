import CoreGraphics
import CoreText
import Foundation
import ImageIO
import PDFKit

/// Builds documents page by page on PDFKit, carrying what PDFKit loses when pages move between
/// documents: bookmarks (remapped to the new page positions), internal links, page labels, metadata
/// and password protection.
enum PagesAssembler {
    // MARK: Opening

    /// Opens (and unlocks) a PDF. Callers keep security-scoped access for the document's lifetime.
    static func open(_ url: URL, password: String?) throws -> PDFDocument {
        guard let document = PDFDocument(url: url) else {
            throw EngineError(FileManager.default.fileExists(atPath: url.path) ? .INVALID_PDF : .FILE_NOT_FOUND)
        }
        if document.isLocked {
            guard let password, document.unlock(withPassword: password) else { throw EngineError(.NEEDS_PASSWORD) }
        }
        return document
    }

    /// Starts security-scoped access to several URLs and stops it when released.
    final class ScopedAccess {
        private var urls: [URL] = []
        init(_ candidates: [URL]) {
            for url in Set(candidates) where url.startAccessingSecurityScopedResource() { urls.append(url) }
        }
        deinit { urls.forEach { $0.stopAccessingSecurityScopedResource() } }
    }

    // MARK: Assembly

    /// A document built from tiles plus where each output page came from.
    struct Assembly {
        let document: PDFDocument
        /// Per output page: (source id, 0-based source page) or nil for blank/image pages.
        var origins: [(source: String, index: Int)?]
        /// First output position of each source page (where bookmarks and links point).
        var firstPosition: [String: [Int: Int]]
        /// Per output page, the source page (0-based) and point each link annotation pointed at, in order.
        var linkTargets: [Int: [(page: Int?, point: CGPoint)]] = [:]
    }

    static func assemble(_ tiles: [OrganizerTile], sources: [String: PDFDocument], progress: ProgressHandler? = nil,
                         share: ClosedRange<Double> = 0...0.8) throws -> Assembly {
        let result = PDFDocument()
        var origins: [(source: String, index: Int)?] = []
        var firstPosition: [String: [Int: Int]] = [:]
        var linkTargets: [Int: [(page: Int?, point: CGPoint)]] = [:]
        for (position, tile) in tiles.enumerated() {
            try Task.checkCancellation()
            if position % 10 == 0 {
                progress?(share.lowerBound + (share.upperBound - share.lowerBound) * Double(position) / Double(max(tiles.count, 1)), nil)
            }
            let page: PDFPage
            switch tile.kind {
            case .page(let sourceID, let index):
                guard let source = sources[sourceID], index >= 1, index <= source.pageCount, let original = source.page(at: index - 1),
                      let copy = original.copy() as? PDFPage else {
                    throw EngineError.invalid("page \(position + 1)")
                }
                page = copy
                origins.append((sourceID, index - 1))
                // Copies lose track of link targets, so read them from the original page.
                let links = original.annotations.filter { $0.type == "Link" }
                if !links.isEmpty {
                    linkTargets[position] = links.map { link in
                        let destination = link.destination ?? (link.action as? PDFActionGoTo)?.destination
                        let target = destination?.page.map { source.index(for: $0) }
                        return (target == NSNotFound ? nil : target, destination?.point ?? .zero)
                    }
                }
                if firstPosition[sourceID]?[index - 1] == nil { firstPosition[sourceID, default: [:]][index - 1] = position }
            case .blank(let width, let height, let paper):
                page = try blankPage(size: CGSize(width: width, height: height), paper: paper)
                origins.append(nil)
            case .image(let url):
                page = try imagePage(url)
                origins.append(nil)
            }
            if tile.rotate != 0 { page.rotation = OrganizerOps.rotated(page.rotation, by: tile.rotate) }
            result.insert(page, at: result.pageCount)
        }
        let assembly = Assembly(document: result, origins: origins, firstPosition: firstPosition, linkTargets: linkTargets)
        rebuildLinks(assembly)
        return assembly
    }

    /// Points internal links at the copied pages; drops links whose target page was left out.
    static func rebuildLinks(_ assembly: Assembly) {
        for (position, targets) in assembly.linkTargets {
            guard let origin = assembly.origins[position], let page = assembly.document.page(at: position) else { continue }
            let links = page.annotations.filter { $0.type == "Link" }
            guard links.count == targets.count else { continue }
            for (annotation, target) in zip(links, targets) {
                let isInternal = annotation.destination != nil || annotation.action is PDFActionGoTo
                guard isInternal else { continue }
                guard let targetIndex = target.page, let mapped = assembly.firstPosition[origin.source]?[targetIndex],
                      let newPage = assembly.document.page(at: mapped) else {
                    page.removeAnnotation(annotation)
                    continue
                }
                // A stale /Dest would win over a new action, so replace whichever form the link used.
                let moved = PDFDestination(page: newPage, at: target.point)
                if annotation.destination != nil { annotation.destination = moved } else { annotation.action = PDFActionGoTo(destination: moved) }
            }
        }
    }

    /// A one-page PDF drawn with Core Graphics (top-left origin), returned as a page to insert.
    static func drawnPage(size: CGSize, draw: (CGContext) -> Void) throws -> PDFPage {
        let data = NSMutableData()
        var box = CGRect(origin: .zero, size: size)
        guard let consumer = CGDataConsumer(data: data as CFMutableData), let context = CGContext(consumer: consumer, mediaBox: &box, nil) else {
            throw EngineError.internalError("pdf context")
        }
        context.beginPDFPage(nil)
        context.translateBy(x: 0, y: size.height)
        context.scaleBy(x: 1, y: -1)
        draw(context)
        context.endPDFPage()
        context.closePDF()
        guard let document = PDFDocument(data: data as Data), let page = document.page(at: 0) else { throw EngineError.internalError("pdf page") }
        return page
    }

    /// Keeps a drawn page attached to a document so it can be rendered on its own.
    static func standalone(_ page: PDFPage) -> PDFDocument {
        let holder = PDFDocument()
        holder.insert(page, at: 0)
        return holder
    }

    static func blankPage(size: CGSize, paper: PagesPaperPattern?) throws -> PDFPage {
        let safe = CGSize(width: min(max(size.width, 3), 14_400), height: min(max(size.height, 3), 14_400))
        var marks: PagesPaperMarks?
        if let paper {
            let made = PagesPaperMarks(width: safe.width, height: safe.height, pattern: paper)
            if made.isTooDense { throw EngineError(.INVALID_PARAMS, reason: "paperTooDense") }
            marks = made
        }
        return try drawnPage(size: safe) { context in
            if let marks, let paper { marks.draw(in: context, color: paper.color) }
        }
    }

    /// Image → page sized like the desktop (fits A4 either way, never upscaled), EXIF orientation applied.
    static func imagePage(_ url: URL) throws -> PDFPage {
        guard let image = orientedImage(url) else { throw EngineError(.INVALID_PARAMS, reason: "pictureUnreadable", detail: url.lastPathComponent) }
        let size = OrganizerOps.imagePageSize(pixels: CGSize(width: image.width, height: image.height))
        return try drawnPage(size: size) { context in
            context.saveGState()
            context.translateBy(x: 0, y: size.height)
            context.scaleBy(x: 1, y: -1)
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(origin: .zero, size: size))
            context.restoreGState()
        }
    }

    static func orientedImage(_ url: URL, maxPixels: Int? = nil) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let width = properties?[kCGImagePropertyPixelWidth] as? Int ?? 0
        let height = properties?[kCGImagePropertyPixelHeight] as? Int ?? 0
        let longest = maxPixels ?? max(width, height, 1)
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                        kCGImageSourceThumbnailMaxPixelSize: longest, kCGImageSourceShouldCacheImmediately: true]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    // MARK: Bookmarks

    struct OutlineEntry {
        var level: Int
        var title: String
        /// 0-based source page.
        var page: Int
        var point: CGPoint
        var isOpen: Bool
    }

    /// Depth-first list of a document's bookmarks with their target pages.
    static func outlineEntries(_ document: PDFDocument) -> [OutlineEntry] {
        guard let root = document.outlineRoot else { return [] }
        var entries: [OutlineEntry] = []
        func walk(_ node: PDFOutline, level: Int) {
            for index in 0..<node.numberOfChildren {
                guard let child = node.child(at: index) else { continue }
                let destination = child.destination ?? (child.action as? PDFActionGoTo)?.destination
                if let destination, let page = destination.page {
                    let pageIndex = document.index(for: page)
                    if pageIndex != NSNotFound {
                        entries.append(OutlineEntry(level: level, title: child.label ?? "", page: pageIndex, point: destination.point, isOpen: child.isOpen))
                    }
                }
                walk(child, level: level + 1)
            }
        }
        walk(root, level: 1)
        return entries
    }

    /// Builds an outline tree from (level, title, output page) entries, repairing level jumps.
    static func setOutline(_ document: PDFDocument, entries: [(level: Int, title: String, position: Int, point: CGPoint, isOpen: Bool)]) {
        guard !entries.isEmpty else {
            if document.outlineRoot != nil { document.outlineRoot = PDFOutline() }
            return
        }
        let root = PDFOutline()
        var stack: [PDFOutline] = [root]
        for entry in entries {
            guard let page = document.page(at: entry.position) else { continue }
            let level = max(1, min(entry.level, stack.count))
            while stack.count > level { stack.removeLast() }
            let item = PDFOutline()
            item.label = entry.title
            let point = entry.point.x.isFinite && entry.point.y.isFinite ? entry.point : CGPoint(x: 0, y: page.bounds(for: .mediaBox).maxY)
            item.destination = PDFDestination(page: page, at: point)
            let parent = stack[stack.count - 1]
            parent.insertChild(item, at: parent.numberOfChildren)
            item.isOpen = entry.isOpen
            stack.append(item)
        }
        document.outlineRoot = root
    }

    /// Carries every source's bookmarks to the first output position of their target page, sorted by position.
    static func carryOutlines(_ assembly: Assembly, sourceOrder: [String], sources: [String: PDFDocument]) {
        var entries: [(level: Int, title: String, position: Int, point: CGPoint, isOpen: Bool)] = []
        for id in sourceOrder {
            guard let source = sources[id] else { continue }
            for entry in outlineEntries(source) {
                guard let position = assembly.firstPosition[id]?[entry.page] else { continue }
                entries.append((entry.level, entry.title, position, entry.point, entry.isOpen))
            }
        }
        let sorted = entries.enumerated().sorted { ($0.element.position, $0.offset) < ($1.element.position, $1.offset) }.map(\.element)
        setOutline(assembly.document, entries: sorted)
    }

    /// Bookmarks of `source` for the pages `indices` (0-based, in output order), keeping their original order.
    static func remappedOutline(_ source: PDFDocument, indices: [Int], offset: Int = 0, levelShift: Int = 0) -> [(level: Int, title: String, position: Int, point: CGPoint, isOpen: Bool)] {
        var positionOf: [Int: Int] = [:]
        for (position, index) in indices.enumerated() where positionOf[index] == nil { positionOf[index] = position }
        return outlineEntries(source).compactMap { entry in
            positionOf[entry.page].map { (entry.level + levelShift, entry.title, $0 + offset, entry.point, entry.isOpen) }
        }
    }

    // MARK: Labels

    /// Output label rules from the sources' own labels, or nil when no source has labels.
    static func carriedLabels(_ assembly: Assembly, sourceParts: [String: [PageLabelsIO.Part]]) -> [PageLabelRule]? {
        guard sourceParts.values.contains(where: { !$0.isEmpty }) else { return nil }
        let parts = assembly.origins.enumerated().map { position, origin -> PageLabelsIO.Part in
            if let origin, let found = sourceParts[origin.source], origin.index < found.count { return found[origin.index] }
            return .plain(position)
        }
        return PageLabelsIO.rules(parts)
    }

    // MARK: Writing

    /// Writes `document` to `url` (replacing it), then page labels and protection.
    /// `labels == nil` leaves labels alone; an empty array removes them.
    @discardableResult
    static func write(_ document: PDFDocument, to url: URL, labels: [PageLabelRule]? = nil, password: String? = nil,
                      attributes: [AnyHashable: Any]? = nil) throws -> Int {
        try Task.checkCancellation()
        if let attributes {
            var merged = document.documentAttributes ?? [:]
            for (key, value) in attributes { merged[key] = value }
            document.documentAttributes = merged
        }
        let scratch = Workspace.scratch()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let plain = scratch.appendingPathComponent("plain.pdf")
        guard document.write(to: plain) else { throw EngineError.internalError("write") }
        if let labels { try PageLabelsIO.write(labels, to: plain) }
        let final: URL
        if let password, !password.isEmpty {
            guard let reopened = PDFDocument(url: plain) else { throw EngineError.internalError("reopen") }
            final = scratch.appendingPathComponent("protected.pdf")
            guard reopened.write(to: final, withOptions: [.userPasswordOption: password, .ownerPasswordOption: password]) else {
                throw EngineError.internalError("write")
            }
        } else {
            final = plain
        }
        let fm = FileManager.default
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if fm.fileExists(atPath: url.path) { try fm.removeItem(at: url) }
        try fm.moveItem(at: final, to: url)
        return document.pageCount
    }

    /// Document info worth keeping on a rebuilt document (title, author…).
    static func carriedAttributes(_ source: PDFDocument) -> [AnyHashable: Any] {
        var attributes = source.documentAttributes ?? [:]
        attributes.removeValue(forKey: PDFDocumentAttribute.creationDateAttribute)
        attributes.removeValue(forKey: PDFDocumentAttribute.modificationDateAttribute)
        attributes[PDFDocumentAttribute.modificationDateAttribute] = Date()
        return attributes
    }

    // MARK: Contents page

    struct ContentsEntry { var title: String; var target: Int }

    static let contentsMargin: CGFloat = 56, contentsTitleSize: CGFloat = 18, contentsTitleGap: CGFloat = 36
    static let contentsEntrySize: CGFloat = 11, contentsLineHeight: CGFloat = 20, contentsNumberGap: CGFloat = 12

    static func contentsPerPage(height: CGFloat) -> Int {
        max(1, Int((height - 2 * contentsMargin - contentsTitleSize - contentsTitleGap) / contentsLineHeight))
    }

    static func contentsPageCount(entries: Int, height: CGFloat) -> Int {
        max(1, Int((Double(entries) / Double(contentsPerPage(height: height))).rounded(.up)))
    }

    /// Draws contents pages (title, file names, leaders, page numbers) and links each line to its target.
    static func contentsPages(size: CGSize, title: String, entries: [ContentsEntry], numberOf: (Int) -> String, targetPage: (Int) -> PDFPage?) throws -> [PDFPage] {
        let perPage = contentsPerPage(height: size.height)
        let count = contentsPageCount(entries: entries.count, height: size.height)
        let titleFont = CTFontCreateWithName("Helvetica-Bold" as CFString, contentsTitleSize, nil)
        let entryFont = CTFontCreateWithName("Helvetica" as CFString, contentsEntrySize, nil)
        func line(_ text: String, font: CTFont) -> CTLine {
            CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [kCTFontAttributeName as NSAttributedString.Key: font]))
        }
        func width(_ line: CTLine) -> CGFloat { CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil)) }
        var pages: [PDFPage] = []
        for sheet in 0..<count {
            let chunk = Array(entries.dropFirst(sheet * perPage).prefix(perPage))
            var links: [(CGRect, Int)] = []
            let page = try drawnPage(size: size) { context in
                func show(_ ctLine: CTLine, x: CGFloat, baseline: CGFloat) {
                    context.saveGState()
                    context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
                    context.textPosition = CGPoint(x: x, y: baseline)
                    CTLineDraw(ctLine, context)
                    context.restoreGState()
                }
                context.setFillColor(gray: 0, alpha: 1)
                show(line(title, font: titleFont), x: contentsMargin, baseline: contentsMargin + contentsTitleSize)
                let top = contentsMargin + contentsTitleSize + contentsTitleGap
                for (row, entry) in chunk.enumerated() {
                    let baseline = top + CGFloat(row) * contentsLineHeight
                    let numberLine = line(numberOf(entry.target), font: entryFont)
                    let numberX = size.width - contentsMargin - width(numberLine)
                    let room = numberX - contentsMargin - 2 * contentsNumberGap
                    var shown = entry.title
                    var titleLine = line(shown, font: entryFont)
                    while width(titleLine) > room, !shown.isEmpty {
                        shown.removeLast()
                        titleLine = line(shown.trimmingCharacters(in: .whitespaces) + "…", font: entryFont)
                    }
                    show(titleLine, x: contentsMargin, baseline: baseline)
                    show(numberLine, x: numberX, baseline: baseline)
                    let leaderStart = contentsMargin + width(titleLine) + contentsNumberGap / 2
                    let leaderEnd = numberX - contentsNumberGap / 2
                    if leaderEnd > leaderStart {
                        context.saveGState()
                        context.setStrokeColor(gray: 0.6, alpha: 1)
                        context.setLineWidth(0.6)
                        context.setLineDash(phase: 0, lengths: [1, 3])
                        context.move(to: CGPoint(x: leaderStart, y: baseline))
                        context.addLine(to: CGPoint(x: leaderEnd, y: baseline))
                        context.strokePath()
                        context.restoreGState()
                    }
                    // Link rectangles in PDF space (bottom-left origin).
                    links.append((CGRect(x: contentsMargin, y: size.height - baseline - 4, width: size.width - 2 * contentsMargin, height: contentsLineHeight - 2), entry.target))
                }
            }
            for (rect, target) in links {
                guard let destinationPage = targetPage(target) else { continue }
                let link = PDFAnnotation(bounds: rect, forType: .link, withProperties: nil)
                link.action = PDFActionGoTo(destination: PDFDestination(page: destinationPage, at: CGPoint(x: 0, y: destinationPage.bounds(for: .mediaBox).maxY)))
                link.border = PDFBorder()
                link.border?.lineWidth = 0
                page.addAnnotation(link)
            }
            pages.append(page)
        }
        return pages
    }
}
