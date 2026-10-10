import CoreGraphics
import CoreText
import Foundation
import PDFKit
import Vision

/// "Make selectable" for scanned pages (desktop `ocr_searchable` / sidecar `_ocr_layer.py`): pages without
/// text are read with Vision and get an invisible text layer, so they look exactly the same but can be
/// searched, selected, copied and read aloud. Pages that already have text are left alone.
///
/// Each rebuilt page keeps the original content as vector drawing (`drawPDFPage`), its boxes, rotation and
/// annotations; only the invisible words are added on top.
enum TextLayerOCR {
    struct Result: Sendable {
        let url: URL
        let pagesDone: Int
    }

    /// A recognised word with its corners in PDF page space (unrotated user space).
    struct Word: Equatable {
        var text: String
        var bottomLeft: CGPoint
        var bottomRight: CGPoint
        var topLeft: CGPoint
        /// Followed by another word on the same line: an explicit space is drawn after it so text
        /// extraction keeps the words apart.
        var spaceAfter = false
    }

    static let renderDPI: CGFloat = 300
    private static let maxPixels: CGFloat = 5000

    /// Recognition languages Vision supports on this device (BCP 47, e.g. `en-US`).
    static func supportedLanguages() -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        return (try? request.supportedRecognitionLanguages()) ?? ["en-US"]
    }

    /// Languages to try first for an interface language, limited to what Vision supports.
    static func defaultLanguages(for locale: AppLocale, supported: [String] = supportedLanguages()) -> [String] {
        let preferred: [String] = switch locale {
        case .tr: ["tr-TR", "en-US"]
        case .en: ["en-US"]
        case .de: ["de-DE", "en-US"]
        case .fr: ["fr-FR", "en-US"]
        case .es: ["es-ES", "en-US"]
        case .it: ["it-IT", "en-US"]
        case .ptBR: ["pt-BR", "en-US"]
        case .ar: ["ar-SA", "en-US"]
        }
        let matched = preferred.compactMap { want in
            supported.first { $0.caseInsensitiveCompare(want) == .orderedSame }
                ?? supported.first { $0.lowercased().hasPrefix(String(want.prefix(2)).lowercased()) }
        }
        let unique = matched.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        return unique.isEmpty ? Array(supported.prefix(1)) : unique
    }

    /// Pages (zero-based) among `pages` (nil = all) that have no extractable text.
    static func pagesNeedingText(in pdf: PDFDocument, pages: [Int]?) -> [Int] {
        let candidates = pages ?? Array(0..<pdf.pageCount)
        return candidates.filter { index in
            guard let page = pdf.page(at: index) else { return false }
            return (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    /// Reads `source`, adds text layers to the scanned pages among `pages` and writes the result to a scratch
    /// file. `pagesDone` is 0 when every page already had text (the source is then returned unchanged).
    static func makeSearchable(source: URL, password: String?, pages: [Int]?, languages: [String],
                               progress: ProgressHandler? = nil) async throws -> Result {
        let pdf = try withSecurityScope(source) { () throws -> PDFDocument in
            guard let pdf = PDFDocument(url: source) else { throw EngineError(.INVALID_PDF) }
            if pdf.isLocked {
                guard let password, pdf.unlock(withPassword: password) else { throw EngineError(.NEEDS_PASSWORD) }
            }
            return pdf
        }
        let targets = pagesNeedingText(in: pdf, pages: pages)
        guard !targets.isEmpty else { return Result(url: source, pagesDone: 0) }
        let reporter = ProgressReporter(total: targets.count, progress)
        for (step, index) in targets.enumerated() {
            try reporter.step(step)
            guard let page = pdf.page(at: index), let cgPage = page.pageRef else { continue }
            let words = try recognize(cgPage, languages: languages)
            guard let rebuilt = rebuild(page: page, cgPage: cgPage, words: words) else { continue }
            pdf.removePage(at: index)
            pdf.insert(rebuilt, at: index)
        }
        try reporter.step(targets.count)
        let output = Workspace.scratch().appendingPathComponent(source.lastPathComponent)
        var options: [PDFDocumentWriteOption: Any] = [:]
        if let password, pdf.isEncrypted {
            options[.userPasswordOption] = password
            options[.ownerPasswordOption] = password
        }
        guard pdf.write(to: output, withOptions: options) else { throw EngineError.internalError("ocr-write") }
        return Result(url: output, pagesDone: targets.count)
    }

    // MARK: - Recognition

    /// Renders the visible page (rotation applied) and returns the words in page space.
    static func recognize(_ page: CGPDFPage, languages: [String]) throws -> [Word] {
        let box = page.getBoxRect(.cropBox)
        let quarter = (page.rotationAngle / 90) % 2 != 0
        let shown = quarter ? CGSize(width: box.height, height: box.width) : box.size
        let scale = min(renderDPI / 72, maxPixels / max(shown.width, shown.height, 1))
        let width = Int(shown.width * scale), height = Int(shown.height * scale)
        guard width > 0, height > 0,
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return [] }
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.scaleBy(x: scale, y: scale)
        // At the page's own size this transform only rotates and translates (it never scales up).
        let drawing = page.getDrawingTransform(.cropBox, rect: CGRect(origin: .zero, size: shown), rotate: 0, preserveAspectRatio: true)
        context.concatenate(drawing)
        context.drawPDFPage(page)
        guard let image = context.makeImage() else { return [] }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if !languages.isEmpty { request.recognitionLanguages = languages }
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        // Image pixels (y up, like the bitmap context) → page space.
        let toPage = CGAffineTransform(scaleX: scale, y: scale).inverted().concatenating(drawing.inverted())
        func point(_ normalized: CGPoint) -> CGPoint {
            CGPoint(x: normalized.x * CGFloat(width), y: normalized.y * CGFloat(height)).applying(toPage)
        }
        var words: [Word] = []
        for observation in request.results ?? [] {
            guard let candidate = observation.topCandidates(1).first else { continue }
            let text = candidate.string
            let first = words.count
            text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: .byWords) { word, range, _, _ in
                guard let word, let box = try? candidate.boundingBox(for: range) else { return }
                words.append(Word(text: word, bottomLeft: point(box.bottomLeft), bottomRight: point(box.bottomRight), topLeft: point(box.topLeft), spaceAfter: true))
            }
            if words.count > first { words[words.count - 1].spaceAfter = false }
        }
        return words
    }

    // MARK: - Writing

    /// A new page with the original drawn as vector content plus invisible `words`; keeps boxes, rotation
    /// and annotations of `page`.
    static func rebuild(page: PDFPage, cgPage: CGPDFPage, words: [Word]) -> PDFPage? {
        guard let data = textLayerPageData(cgPage: cgPage, words: words),
              let document = PDFDocument(data: data as Data), let rebuilt = document.page(at: 0) else { return nil }
        rebuilt.rotation = page.rotation
        for annotation in page.annotations {
            page.removeAnnotation(annotation)
            rebuilt.addAnnotation(annotation)
        }
        return rebuilt
    }

    /// One-page PDF: `cgPage` content in its own coordinates plus the invisible text.
    static func textLayerPageData(cgPage: CGPDFPage, words: [Word]) -> NSMutableData? {
        let data = NSMutableData()
        var media = cgPage.getBoxRect(.mediaBox)
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let context = CGContext(consumer: consumer, mediaBox: &media, nil) else { return nil }
        var boxes: [CFString: Any] = [kCGPDFContextMediaBox: NSData(bytes: &media, length: MemoryLayout<CGRect>.size)]
        for (key, box) in [(kCGPDFContextCropBox, CGPDFBox.cropBox), (kCGPDFContextTrimBox, .trimBox), (kCGPDFContextBleedBox, .bleedBox), (kCGPDFContextArtBox, .artBox)] {
            var rect = cgPage.getBoxRect(box)
            if rect != media { boxes[key] = NSData(bytes: &rect, length: MemoryLayout<CGRect>.size) }
        }
        context.beginPDFPage(boxes as CFDictionary)
        context.drawPDFPage(cgPage)
        drawInvisible(words, in: context)
        context.endPDFPage()
        context.closePDF()
        return data
    }

    static func drawInvisible(_ words: [Word], in context: CGContext) {
        context.saveGState()
        context.setTextDrawingMode(.invisible)
        for word in words where !word.text.isEmpty {
            let dx = word.bottomRight.x - word.bottomLeft.x, dy = word.bottomRight.y - word.bottomLeft.y
            let width = hypot(dx, dy)
            let height = hypot(word.topLeft.x - word.bottomLeft.x, word.topLeft.y - word.bottomLeft.y)
            guard width > 0.5, height > 0.5 else { continue }
            let font = CTFontCreateWithName("Helvetica" as CFString, height, nil)
            let attributes: [NSAttributedString.Key: Any] = [.init(kCTFontAttributeName as String): font]
            let bare = CTLineCreateWithAttributedString(NSAttributedString(string: word.text, attributes: attributes))
            let line = word.spaceAfter ? CTLineCreateWithAttributedString(NSAttributedString(string: word.text + " ", attributes: attributes)) : bare
            var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
            let natural = CGFloat(CTLineGetTypographicBounds(bare, &ascent, &descent, &leading))
            guard natural > 0 else { continue }
            context.saveGState()
            context.translateBy(x: word.bottomLeft.x, y: word.bottomLeft.y)
            context.rotate(by: atan2(dy, dx))
            // Squeeze the word to the recognised box so selection matches the picture underneath.
            context.scaleBy(x: width / natural, y: height / max(ascent + descent, 1))
            context.textMatrix = .identity
            context.textPosition = CGPoint(x: 0, y: descent)
            CTLineDraw(line, context)
            context.restoreGState()
        }
        context.restoreGState()
    }
}
