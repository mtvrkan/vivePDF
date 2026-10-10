import CoreGraphics
import Foundation
import PDFKit

/// A PDF to convert: file, optional password and a desktop-style page range ("1-3, 5"; empty = all).
struct PDFSource: Sendable {
    var url: URL
    var password: String?
    var pages = ""
}

/// What a conversion reports back besides its files (`ConvertOutcome` on desktop).
struct ConvertReport: Sendable {
    var count = 0
    /// `tools.convert.count.<label>`: files, tables, slides, images, pages, chapters.
    var label = "files"
    var skipped = 0
    var textless: (pages: [Int], key: String)?
    var ocrPages: [Int] = []
    var reducedPages: [Int] = []
    var textPages: [Int] = []
    var noTables = false
    var headerFooterMoved = false
    var pictures: (count: Int, folder: String?)?
    var failed: [(name: String, message: String)] = []

    /// Desktop result notices, already localised.
    var notices: [String] {
        var lines: [String] = []
        if !failed.isEmpty {
            lines.append(t("tools.convert.failedFiles", ["total": failed.count]))
            lines += failed.map { "\($0.name) · \($0.message)" }
        }
        if !reducedPages.isEmpty { lines.append(t("tools.convert.reducedPages", ["count": reducedPages.count, "pages": ConvertEngine.pageList(reducedPages)])) }
        if noTables { lines.append(t("tools.convert.noTablesFound")) }
        if !textPages.isEmpty {
            lines.append(t("tools.convert.textSheet", ["count": textPages.count, "pages": ConvertEngine.pageList(textPages), "sheet": t("tools.convert.sheetLabels.text")]))
        }
        if !ocrPages.isEmpty { lines.append(t("tools.convert.ocrPages", ["count": ocrPages.count, "pages": ConvertEngine.pageList(ocrPages)])) }
        if headerFooterMoved { lines.append(t("tools.convert.headerFooterMoved")) }
        if let pictures {
            lines.append(pictures.folder.map { t("tools.convert.picturesSaved", ["count": pictures.count, "folder": $0]) }
                ?? t("tools.convert.picturesEmbedded", ["count": pictures.count]))
        }
        if let textless, !textless.pages.isEmpty {
            lines.append(t("tools.convert.\(textless.key)", ["count": textless.pages.count, "pages": ConvertEngine.pageList(textless.pages)]))
        }
        return lines
    }

    func result(_ outputs: [URL]) -> JobResult {
        let bytes = outputs.reduce(Int64(0)) { total, url in total + ConvertEngine.size(of: url) }
        var parts = ["\(NumberFormatter.localizedString(from: NSNumber(value: count), number: .decimal)) \(t("tools.convert.count.\(label)"))", Workspace.formatBytes(bytes)]
        if skipped > 0 { parts.append(t("tools.convert.skipped", ["count": skipped])) }
        let notes = notices
        return JobResult(outputs: outputs, summary: parts.joined(separator: " · "), report: notes.isEmpty ? nil : notes.joined(separator: "\n"))
    }
}

/// Convert tool engine: PDF → Word/Excel/PowerPoint/images/text/Markdown/HTML/EPUB and
/// images/Office/text/SVG/web pages → PDF. Pure Core Graphics / PDFKit / ImageIO / Vision code;
/// WebKit rendering lives in `WebRenderer+UIKit.swift`.
enum ConvertEngine {
    // MARK: Source handling

    static func open(_ source: PDFSource) throws -> PDFDocument {
        guard let document = PDFDocument(url: source.url) else {
            throw FileManager.default.fileExists(atPath: source.url.path) ? EngineError(.INVALID_PDF) : EngineError(.FILE_NOT_FOUND, detail: source.url.lastPathComponent)
        }
        if document.isLocked {
            guard let password = source.password, document.unlock(withPassword: password) else { throw EngineError(.NEEDS_PASSWORD) }
        }
        return document
    }

    static func indices(_ source: PDFSource, _ document: PDFDocument) throws -> [Int] {
        guard document.pageCount > 0 else { throw EngineError(.INVALID_PDF) }
        guard let parsed = PageRanges.parse(source.pages, pageCount: document.pageCount), !parsed.isEmpty else {
            throw EngineError(.INVALID_PARAMS, reason: "badRange")
        }
        var seen = Set<Int>()
        return parsed.filter { seen.insert($0).inserted }
    }

    static func size(of url: URL) -> Int64 {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { return 0 }
        guard isDirectory.boolValue else { return Workspace.fileSize(url) }
        let files = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey])?.compactMap { $0 as? URL } ?? []
        return files.reduce(0) { $0 + Workspace.fileSize($1) }
    }

    /// "1-3, 5" from one-based page numbers (`pageList` on desktop).
    static func pageList(_ pages: [Int]) -> String { PageRanges.format(pages.map { $0 - 1 }) }

    static func stem(_ url: URL) -> String { url.deletingPathExtension().lastPathComponent }

    static func title(_ document: PDFDocument, source: URL) -> String {
        let title = (document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? stem(source) : title
    }

    static func author(_ document: PDFDocument) -> String {
        (document.documentAttributes?[PDFDocumentAttribute.authorAttribute] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    /// Reads the text layout of the chosen pages, recognising textless pages with Vision when asked.
    static func readPages(_ document: PDFDocument, indices: [Int], ocr: Bool = false, graphics: Bool = true,
                          progress: ProgressHandler?, band: ClosedRange<Double> = 0...0.8) throws -> (pages: [PageContent], ocrPages: [Int]) {
        var pages: [PageContent] = []
        var recognised: [Int] = []
        for (position, index) in indices.enumerated() {
            try Task.checkCancellation()
            progress?(band.lowerBound + (band.upperBound - band.lowerBound) * Double(position) / Double(max(indices.count, 1)),
                      t("progress.convertingPages", ["current": position + 1, "total": indices.count]))
            guard let page = document.page(at: index) else { continue }
            var content = PDFPageReader.content(page, index: index, scanGraphics: graphics)
            if ocr && !content.hasText {
                let lines = try OCRReader.lines(page)
                if !lines.isEmpty {
                    content.lines = lines
                    // A scan's single picture is the page itself; keep pictures out of text exports.
                    content.images = []
                    recognised.append(index + 1)
                }
            }
            pages.append(content)
        }
        return (pages, recognised)
    }

    /// The most common text size across pages (`body_size` on desktop).
    static func bodySize(_ pages: [PageContent]) -> CGFloat {
        var weights: [CGFloat: Int] = [:]
        for page in pages { for line in page.lines { for span in line.spans { weights[(span.size * 2).rounded() / 2, default: 0] += span.text.count } } }
        return weights.max { $0.value < $1.value }?.key ?? 11
    }

    // MARK: - PDF → images

    struct ImagesOptions: Sendable {
        var format: ImageEncoder.Format = .png
        var dpi: CGFloat = 150
        var quality: Double = 88
        var single = false
        var transparent = false
        var gray = false
        var archive = false
        var outputDirectory: URL
    }

    static func toImages(_ source: PDFSource, _ options: ImagesOptions, progress: ProgressHandler?) async throws -> JobResult {
        let document = try open(source)
        let indices = try indices(source, document)
        let base = MergeFields.sanitize(stem(source.url))
        let digits = String(document.pageCount).count
        let transparent = options.transparent && options.format.supportsAlpha
        let quality = options.quality / 100
        Workspace.ensure(options.outputDirectory)
        var report = ConvertReport(label: "images")
        var outputs: [URL] = []
        let reporter = ProgressReporter(total: indices.count, progress)

        func renderPage(_ index: Int, maxSide: Int = PageRenderer.maxSide) throws -> (CGImage, CGFloat) {
            guard let page = document.page(at: index) else { throw EngineError(.INVALID_PDF) }
            let size = PDFPageReader.displaySize(page)
            let dpi = PageRenderer.safeDPI(size, dpi: options.dpi, maxSide: maxSide)
            if dpi < options.dpi { report.reducedPages.append(index + 1) }
            guard let image = PageRenderer.render(page, dpi: dpi, gray: options.gray, transparent: transparent) else { throw EngineError.internalError("render") }
            return (image, dpi)
        }

        if options.single {
            let target = Workspace.unique(name: base, ext: options.format.rawValue, in: options.outputDirectory)
            if options.format == .tiff {
                var images: [CGImage] = []
                for (position, index) in indices.enumerated() {
                    try reporter.step(position, t("progress.rendering", ["current": position + 1, "total": indices.count]))
                    images.append(try renderPage(index).0)
                }
                progress?(0.95, t("progress.saving"))
                try ImageEncoder.write(images, format: .tiff, dpi: options.dpi, to: target)
            } else {
                // Stack the pages top to bottom in one tall picture.
                var parts: [CGImage] = []
                for (position, index) in indices.enumerated() {
                    try reporter.step(position, t("progress.rendering", ["current": position + 1, "total": indices.count]))
                    parts.append(try renderPage(index).0)
                }
                let width = parts.map(\.width).max() ?? 1
                let height = parts.reduce(0) { $0 + $1.height }
                guard width <= PageRenderer.maxSide, height <= 65_000, width * height <= 250_000_000 else {
                    throw EngineError(.INVALID_PARAMS, reason: "imageTooLarge")
                }
                let space = options.gray && !transparent ? CGColorSpaceCreateDeviceGray() : CGColorSpace(name: CGColorSpace.sRGB)!
                let info = transparent ? CGImageAlphaInfo.premultipliedLast.rawValue : (options.gray ? CGImageAlphaInfo.none.rawValue : CGImageAlphaInfo.noneSkipLast.rawValue)
                guard let canvas = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: info) else {
                    throw EngineError(.INVALID_PARAMS, reason: "imageTooLarge")
                }
                if !transparent {
                    canvas.setFillColor(CGColor(gray: 1, alpha: 1))
                    canvas.fill(CGRect(x: 0, y: 0, width: width, height: height))
                }
                var top = 0
                for part in parts {
                    canvas.draw(part, in: CGRect(x: (width - part.width) / 2, y: height - top - part.height, width: part.width, height: part.height))
                    top += part.height
                }
                guard let joined = canvas.makeImage() else { throw EngineError.internalError("join") }
                progress?(0.95, t("progress.saving"))
                try ImageEncoder.write([joined], format: options.format, quality: quality, dpi: options.dpi, to: target)
            }
            report.count = 1
            return report.result([target])
        }

        let staging = options.archive ? Workspace.scratch() : options.outputDirectory
        var written: [URL] = []
        do {
            for (position, index) in indices.enumerated() {
                try reporter.step(position, t("progress.rendering", ["current": position + 1, "total": indices.count]))
                let (image, dpi) = try renderPage(index)
                let name = "\(base)-\(String(format: "%0\(digits)d", index + 1))"
                let target = options.archive ? staging.appendingPathComponent("\(name).\(options.format.rawValue)")
                    : Workspace.unique(name: name, ext: options.format.rawValue, in: staging)
                try ImageEncoder.write([image], format: options.format, quality: quality, dpi: dpi, to: target)
                written.append(target)
            }
        } catch {
            if !options.archive { written.forEach { try? FileManager.default.removeItem(at: $0) } }
            throw error
        }
        if options.archive {
            progress?(0.95, t("progress.saving"))
            let target = Workspace.unique(name: base, ext: "zip", in: options.outputDirectory)
            let zip = try ZipWriter(url: target)
            for file in written { try zip.add(file.lastPathComponent, contentsOf: file, compress: false) }
            try zip.finish()
            outputs = [target]
            report.count = indices.count
        } else {
            outputs = written
            report.count = written.count
        }
        return report.result(outputs)
    }

    // MARK: - Extract embedded images

    static func extractImages(_ source: PDFSource, outputDirectory: URL, minSize: Int = 64, progress: ProgressHandler?) async throws -> JobResult {
        let document = try open(source)
        let indices = try indices(source, document)
        let base = MergeFields.sanitize(stem(source.url))
        let digits = String(document.pageCount).count
        Workspace.ensure(outputDirectory)
        var seen = Set<Int>()
        var outputs: [URL] = []
        var skipped = 0
        let reporter = ProgressReporter(total: indices.count, progress)
        for (position, index) in indices.enumerated() {
            try reporter.step(position, t("progress.extracting", ["current": position + 1, "total": indices.count]))
            guard let page = document.page(at: index), let reference = page.pageRef else { continue }
            let scan = PDFContentScanner.scan(reference)
            var number = 0
            for image in scan.images {
                guard let stream = image.stream else { continue }
                if image.key != 0 && !seen.insert(image.key).inserted { continue }
                number += 1
                guard let extracted = PDFImageExtractor.extract(stream) else { skipped += 1; continue }
                if extracted.width < minSize || extracted.height < minSize { skipped += 1; continue }
                let name = "\(base)-\(String(format: "%0\(digits)d", index + 1))-\(String(format: "%02d", number))"
                let target = Workspace.unique(name: name, ext: extracted.ext, in: outputDirectory)
                try extracted.data.write(to: target)
                outputs.append(target)
            }
        }
        var report = ConvertReport(count: outputs.count, label: "images")
        report.skipped = 0
        _ = skipped
        return report.result(outputs)
    }
}
