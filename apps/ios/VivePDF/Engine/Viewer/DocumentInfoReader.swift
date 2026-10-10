import CoreGraphics
import Foundation

/// Cheap document facts PDFKit does not expose (form fields, fonts), read with Core Graphics.
enum DocumentInfoReader {
    static func hasFormFields(_ document: CGPDFDocument) -> Bool {
        guard let catalog = document.catalog,
              let form = ViewerCGPDF.dictionary(catalog, "AcroForm"),
              let fields = ViewerCGPDF.array(form, "Fields") else { return false }
        return CGPDFArrayGetCount(fields) > 0
    }

    /// Base font names used by the pages (subset prefixes like `ABCDEF+` removed), sorted.
    /// Stops after `pageLimit` pages so huge files stay fast.
    static func fontNames(in document: CGPDFDocument, pageLimit: Int = 300) -> [String] {
        var names = Set<String>()
        let count = min(document.numberOfPages, pageLimit)
        guard count > 0 else { return [] }
        for number in 1...count {
            guard let page = document.page(at: number)?.dictionary,
                  let resources = ViewerCGPDF.dictionary(page, "Resources") else { continue }
            collect(resources, into: &names, depth: 0)
        }
        return names.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    private static func collect(_ resources: CGPDFDictionaryRef, into names: inout Set<String>, depth: Int) {
        guard depth < 4 else { return }
        if let fonts = ViewerCGPDF.dictionary(resources, "Font") {
            CGPDFDictionaryApplyBlock(fonts, { _, object, _ in
                if let font = ViewerCGPDF.dictionary(from: object), let base = ViewerCGPDF.name(font, "BaseFont") {
                    names.insert(cleaned(base))
                }
                return true
            }, nil)
        }
        // Fonts used inside form XObjects (common in generated PDFs).
        if let objects = ViewerCGPDF.dictionary(resources, "XObject") {
            var nested: [CGPDFDictionaryRef] = []
            CGPDFDictionaryApplyBlock(objects, { _, object, _ in
                var stream: CGPDFStreamRef?
                if CGPDFObjectGetValue(object, .stream, &stream), let stream, let dict = CGPDFStreamGetDictionary(stream),
                   ViewerCGPDF.name(dict, "Subtype") == "Form", let inner = ViewerCGPDF.dictionary(dict, "Resources") {
                    nested.append(inner)
                }
                return true
            }, nil)
            for inner in nested where inner != resources { collect(inner, into: &names, depth: depth + 1) }
        }
    }

    static func cleaned(_ name: String) -> String {
        if name.count > 7, name.dropFirst(6).first == "+", name.prefix(6).allSatisfy({ $0.isUppercase && $0.isLetter }) {
            return String(name.dropFirst(7))
        }
        return name
    }
}
