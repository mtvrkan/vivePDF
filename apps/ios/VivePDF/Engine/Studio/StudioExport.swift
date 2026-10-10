import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Export of designs to vector PDF (Core Graphics + Core Text), PNG and JPEG — `studio.render`.
enum StudioExport {
    enum Format: String, CaseIterable, Identifiable { case pdf, png, jpg; var id: String { rawValue } }

    static let maxOutputPages = 5000
    static let maxImagePixels: Double = 80_000_000
    static let dpiPresets = [72, 150, 300, 600]
    static let minDPI = 36, maxDPI = 600
    static let minQuality = 10, maxQuality = 100

    struct Settings {
        var format: Format = .pdf
        /// Raster resolution for PNG / JPEG.
        var dpi: Double = 150
        /// JPEG quality 1…100.
        var quality: Double = 92
        /// PNG with a transparent background where the page has none.
        var transparent = false
        /// Zero-based page indices to export (nil = all pages).
        var pages: [Int]? = nil
        /// Mail-merge rows; empty renders the design once.
        var rows: [[String: String]] = []
        /// Value for `{date}` (formatted by the caller).
        var date: String = ""
        var language: String = "en"
        /// PDF title metadata.
        var title: String = ""
        /// Embed the editable design inside the PDF (reopens in Studio like a project file).
        var embedDesign = false
        /// One PDF per merge row, named by `pattern` (e.g. "{name}").
        var split = false
        var pattern: String = "{n}"
    }

    struct Output {
        var files: [URL]
        var pageCount: Int
        var missingGlyphs: String
    }

    /// Chosen pages and their 1-based numbers (nil numbers when every page is exported).
    static func chosen(_ design: StudioDesign, _ pages: [Int]?) -> (StudioDesign, [Int]?) {
        let numbers = (pages ?? []).filter { $0 >= 0 && $0 < design.pages.count }
        if numbers.isEmpty || numbers == Array(0..<design.pages.count) { return (design, nil) }
        var subset = design
        subset.pages = numbers.map { design.pages[$0] }
        return (subset, numbers.map { $0 + 1 })
    }

    static func rowValues(_ row: [String: String], index: Int, date: String) -> [String: String] {
        var values = ["n": String(index + 1)]
        if !date.isEmpty { values["date"] = date }
        values.merge(row) { _, new in new }
        return values
    }

    /// Picture names (`pictureNames`): `stem.ext` for one image, `stem-<page or n>.ext` for several.
    static func pictureNames(stem: String, format: Format, pages: [Int], copies: Int) -> [String] {
        let total = pages.count * max(1, copies)
        if total == 1 { return ["\(stem).\(format.rawValue)"] }
        let labels = copies > 1 ? Array(1...total) : pages
        return labels.map { "\(stem)-\($0).\(format.rawValue)" }
    }

    // MARK: PDF

    private final class PDFWriter {
        let data = NSMutableData()
        let context: CGContext

        init?(title: String) {
            guard let consumer = CGDataConsumer(data: data as CFMutableData) else { return nil }
            var info: [CFString: Any] = [kCGPDFContextCreator: "vivePDF"]
            if !title.trimmingCharacters(in: .whitespaces).isEmpty { info[kCGPDFContextTitle] = title.trimmingCharacters(in: .whitespaces) }
            var box = CGRect(x: 0, y: 0, width: 595, height: 842)
            guard let context = CGContext(consumer: consumer, mediaBox: &box, info as CFDictionary) else { return nil }
            self.context = context
        }

        func page(_ page: StudioPage, options: StudioRenderer.Options) {
            var box = CGRect(x: 0, y: 0, width: page.width, height: page.height)
            let boxData = Data(bytes: &box, count: MemoryLayout<CGRect>.size)
            context.beginPDFPage([kCGPDFContextMediaBox: boxData] as CFDictionary)
            context.saveGState()
            context.translateBy(x: 0, y: page.height)
            context.scaleBy(x: 1, y: -1)
            StudioRenderer.draw(page: page, in: context, options: options)
            context.restoreGState()
            context.endPDFPage()
        }

        func finish() -> Data {
            context.closePDF()
            return data as Data
        }
    }

    private static func renderOptions(_ settings: Settings, values: [String: String], keepWhite: Bool) -> StudioRenderer.Options {
        var options = StudioRenderer.Options(language: settings.language, values: values, keepWhite: keepWhite)
        options.pdf = true
        return options
    }

    /// Vector PDF bytes for a design (CV and document flows, print).
    static func pdfData(_ design: StudioDesign, settings: Settings = Settings(), progress: ProgressHandler? = nil) throws -> Data {
        let (subset, _) = chosen(design, settings.pages)
        let rows = settings.rows.isEmpty ? [[:]] : settings.rows
        let total = rows.count * subset.pages.count
        guard total <= maxOutputPages else { throw EngineError(.INVALID_PARAMS, reason: "tooManyOutputPages") }
        guard let writer = PDFWriter(title: settings.title.isEmpty ? design.name : settings.title) else { throw EngineError.internalError("pdf") }
        let reporter = ProgressReporter(total: total, progress)
        var done = 0
        for (index, row) in rows.enumerated() {
            let values = settings.rows.isEmpty && settings.date.isEmpty ? [:] : rowValues(row, index: index, date: settings.date)
            for page in subset.pages {
                try reporter.step(done, t("progress.rendering"))
                writer.page(page, options: renderOptions(settings, values: values, keepWhite: false))
                done += 1
            }
        }
        var data = writer.finish()
        if settings.embedDesign {
            let archive = try StudioProject.archive(subset, thumbnail: Data())
            data = try StudioProject.embed(archive, into: data)
        }
        return data
    }

    // MARK: Export

    /// Renders `design` and writes the result: `output` is the PDF / image file (images get page
    /// numbers when there are several) or, for one PDF per row, the destination folder.
    static func export(_ design: StudioDesign, settings: Settings, output: URL, progress: ProgressHandler? = nil) throws -> Output {
        let (subset, numbers) = chosen(design, settings.pages)
        let glyphs = missingGlyphs(subset)
        if settings.split {
            guard !settings.rows.isEmpty else { throw EngineError(.INVALID_PARAMS, reason: "noRows") }
            Workspace.ensure(output)
            var taken = Set<String>()
            var files: [URL] = []
            let reporter = ProgressReporter(total: settings.rows.count, progress)
            for (index, row) in settings.rows.enumerated() {
                try reporter.step(index, t("progress.rendering"))
                let values = rowValues(row, index: index, date: settings.date)
                var one = settings
                one.rows = [row]
                one.split = false
                one.pages = nil
                guard let writer = PDFWriter(title: settings.title) else { throw EngineError.internalError("pdf") }
                for page in subset.pages { writer.page(page, options: renderOptions(settings, values: values, keepWhite: false)) }
                var data = writer.finish()
                if settings.embedDesign { data = try StudioProject.embed(try StudioProject.archive(subset, thumbnail: Data()), into: data) }
                let name = fileName(pattern: settings.pattern, values: values, taken: &taken)
                let target = Workspace.unique(name: name, ext: "pdf", in: output)
                try data.write(to: target, options: .atomic)
                files.append(target)
            }
            return Output(files: files, pageCount: files.count * subset.pages.count, missingGlyphs: glyphs)
        }
        if settings.format == .pdf {
            var whole = settings
            whole.pages = nil
            let data = try pdfData(subset, settings: whole, progress: { fraction, message in progress?(fraction * 0.92, message) })
            progress?(0.95, t("progress.saving"))
            try data.write(to: output, options: .atomic)
            let rows = max(1, settings.rows.count)
            return Output(files: [output], pageCount: rows * subset.pages.count, missingGlyphs: glyphs)
        }
        let rows = settings.rows.isEmpty ? [[:]] : settings.rows
        let pageNumbers = numbers ?? Array(1...max(1, subset.pages.count))
        let stem = output.deletingPathExtension().lastPathComponent
        let folder = output.deletingLastPathComponent()
        let names = pictureNames(stem: stem, format: settings.format, pages: pageNumbers, copies: rows.count)
        let transparent = settings.format == .png && settings.transparent
        let reporter = ProgressReporter(total: names.count, progress)
        var files: [URL] = []
        var done = 0
        for (index, row) in rows.enumerated() {
            let values = settings.rows.isEmpty && settings.date.isEmpty ? [:] : rowValues(row, index: index, date: settings.date)
            for page in subset.pages {
                try reporter.step(done, t("progress.rendering"))
                let area = page.width * page.height
                let scale = min(settings.dpi / 72, sqrt(maxImagePixels / max(area, 1)))
                var options = StudioRenderer.Options(language: settings.language, values: values, keepWhite: transparent)
                options.maxImagePixels = 0
                guard let image = StudioRenderer.image(page: page, scale: scale, options: options, opaque: !transparent) else { throw EngineError.internalError("render") }
                let type: UTType = settings.format == .png ? .png : .jpeg
                guard let data = StudioProject.encode(image, type: type, quality: settings.quality / 100, dpi: settings.dpi) else { throw EngineError.internalError("encode") }
                let target = folder.appendingPathComponent(names[min(done, names.count - 1)])
                try data.write(to: target, options: .atomic)
                files.append(target)
                done += 1
            }
        }
        return Output(files: files, pageCount: files.count, missingGlyphs: glyphs)
    }

    // MARK: Names

    /// `_naming.render_name` + `unique_name`: fills `{field}` placeholders, strips characters that
    /// are not allowed in file names and de-duplicates.
    static func fileName(pattern: String, values: [String: String], taken: inout Set<String>) -> String {
        var name = StudioPlaceholders.fill(pattern.isEmpty ? "{n}" : pattern, values)
        name = name.replacingOccurrences(of: "[\\\\/:*?\"<>|\\x00-\\x1f]", with: "_", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: " .")).trimmingCharacters(in: .whitespaces)
        if name.isEmpty { name = values["n"] ?? "design" }
        if name.count > 120 { name = String(name.prefix(120)) }
        var candidate = name
        var counter = 2
        while taken.contains(candidate.lowercased()) {
            candidate = "\(name) (\(counter))"
            counter += 1
        }
        taken.insert(candidate.lowercased())
        return candidate
    }

    // MARK: Missing glyphs

    /// Characters no resolved face can draw (reported after export like the desktop).
    static func missingGlyphs(_ design: StudioDesign) -> String {
        var missing: [Character] = []
        for page in design.pages {
            for element in page.elements {
                guard let text = element.text, !element.hidden else { continue }
                for run in text.runs {
                    let style = StudioTextLayout.runStyle(text, run)
                    let face = style.face
                    for char in run.text where !char.isWhitespace && !missing.contains(char) {
                        let value = String(char)
                        guard !face.hasGlyphs(value) else { continue }
                        // Core Text falls back to system fonts; only report what nothing can draw.
                        let fallback = CTFontCreateForString(face.font, value as CFString, CFRange(location: 0, length: (value as NSString).length))
                        var glyphs = [CGGlyph](repeating: 0, count: (value as NSString).length)
                        let units = Array(value.utf16)
                        if !CTFontGetGlyphsForCharacters(fallback, units, &glyphs, units.count) { missing.append(char) }
                    }
                }
            }
        }
        return String(missing)
    }
}

extension StudioDirection {
    var isRTL: Bool { self == .rtl }
}
