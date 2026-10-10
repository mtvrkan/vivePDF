import CoreGraphics
import Foundation
import PDFKit
import Vision

/// "Read pages without text with OCR" for the text exports: the desktop runs Tesseract; here Vision
/// recognises the rendered page and its observations become text lines with positions and sizes.
enum OCRReader {
    /// Languages offered to Vision: the interface language first, then the other app languages.
    static var languages: [String] {
        let preferred = L10n.shared.locale.rawValue
        let all = ["tr-TR", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "pt-BR", "ar-SA"]
        let supported = Set((try? VNRecognizeTextRequest().supportedRecognitionLanguages()) ?? all)
        let ordered = all.filter { $0.hasPrefix(preferred.prefix(2)) } + all.filter { !$0.hasPrefix(preferred.prefix(2)) }
        return ordered.filter { supported.contains($0) }
    }

    static var available: Bool { !languages.isEmpty }

    static func lines(_ page: PDFPage, dpi: CGFloat = 200) throws -> [TextLine] {
        let size = PDFPageReader.displaySize(page)
        let resolution = PageRenderer.safeDPI(size, dpi: dpi, maxSide: 6000)
        guard let image = PageRenderer.render(page, dpi: resolution) else { return [] }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = languages
        if #available(iOS 16.0, macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let observations = request.results ?? []
        let spans: [TextSpan] = observations.compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            let rect = CGRect(x: box.minX * size.width, y: (1 - box.maxY) * size.height, width: box.width * size.width, height: box.height * size.height)
            return TextSpan(text: candidate.string, rect: rect, fontName: "Helvetica", size: max(4, rect.height * 0.8),
                            bold: false, italic: false, monospace: false, color: (0, 0, 0))
        }
        return PDFPageReader.group(spans)
    }
}
