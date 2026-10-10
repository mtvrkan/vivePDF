import CoreGraphics
import Foundation

/// Walks a page's content stream with `CGPDFScanner`, tracking the current transformation matrix, to
/// find where pictures are drawn and which thin lines/rectangles could be table rulings. Form XObjects
/// are entered recursively. Coordinates are PDF page space (y up).
final class PDFContentScanner {
    struct Image {
        var rect: CGRect
        var key: Int
        var stream: CGPDFStreamRef?
    }

    struct Result {
        var images: [Image] = []
        var rulings: [CGRect] = []
    }

    private var ctm = CGAffineTransform.identity
    private var stack: [(CGAffineTransform, CGFloat)] = []
    private var lineWidth: CGFloat = 1
    private var path: [[CGPoint]] = []
    private var rects: [CGRect] = []
    private var result = Result()
    private var depth = 0
    /// Forms currently being entered (guards against self-referencing forms).
    private var visitedForms = Set<Int>()
    private static let maxRulings = 6000

    static func scan(_ page: CGPDFPage) -> Result {
        let scanner = PDFContentScanner()
        let stream = CGPDFContentStreamCreateWithPage(page)
        scanner.run(stream)
        return scanner.result
    }

    private static let table: CGPDFOperatorTableRef = {
        let table = CGPDFOperatorTableCreate()!
        func state(_ info: UnsafeMutableRawPointer?) -> PDFContentScanner { Unmanaged<PDFContentScanner>.fromOpaque(info!).takeUnretainedValue() }
        CGPDFOperatorTableSetCallback(table, "q") { _, info in let s = state(info); s.stack.append((s.ctm, s.lineWidth)) }
        CGPDFOperatorTableSetCallback(table, "Q") { _, info in let s = state(info); if let top = s.stack.popLast() { s.ctm = top.0; s.lineWidth = top.1 } }
        CGPDFOperatorTableSetCallback(table, "cm") { scanner, info in
            let s = state(info)
            guard let n = popNumbers(scanner, 6) else { return }
            s.ctm = CGAffineTransform(a: n[0], b: n[1], c: n[2], d: n[3], tx: n[4], ty: n[5]).concatenating(s.ctm)
        }
        CGPDFOperatorTableSetCallback(table, "w") { scanner, info in if let n = popNumbers(scanner, 1) { state(info).lineWidth = n[0] } }
        CGPDFOperatorTableSetCallback(table, "m") { scanner, info in
            let s = state(info)
            guard let n = popNumbers(scanner, 2) else { return }
            s.path.append([CGPoint(x: n[0], y: n[1]).applying(s.ctm)])
        }
        CGPDFOperatorTableSetCallback(table, "l") { scanner, info in
            let s = state(info)
            guard let n = popNumbers(scanner, 2) else { return }
            if s.path.isEmpty { s.path.append([]) }
            s.path[s.path.count - 1].append(CGPoint(x: n[0], y: n[1]).applying(s.ctm))
        }
        CGPDFOperatorTableSetCallback(table, "re") { scanner, info in
            let s = state(info)
            guard let n = popNumbers(scanner, 4) else { return }
            s.rects.append(CGRect(x: n[0], y: n[1], width: n[2], height: n[3]).applying(s.ctm).standardized)
        }
        for op in ["c", "v", "y"] {
            // Curves make a path non-rectilinear; drop it from ruling candidates.
            CGPDFOperatorTableSetCallback(table, op) { _, info in state(info).path.append([]) }
        }
        for op in ["S", "s"] { CGPDFOperatorTableSetCallback(table, op) { _, info in state(info).finish(stroke: true, fill: false) } }
        for op in ["f", "F", "f*"] { CGPDFOperatorTableSetCallback(table, op) { _, info in state(info).finish(stroke: false, fill: true) } }
        for op in ["B", "B*", "b", "b*"] { CGPDFOperatorTableSetCallback(table, op) { _, info in state(info).finish(stroke: true, fill: true) } }
        CGPDFOperatorTableSetCallback(table, "n") { _, info in let s = state(info); s.path = []; s.rects = [] }
        CGPDFOperatorTableSetCallback(table, "Do") { scanner, info in state(info).drawObject(scanner) }
        CGPDFOperatorTableSetCallback(table, "EI") { _, info in
            let s = state(info)
            let rect = CGRect(x: 0, y: 0, width: 1, height: 1).applying(s.ctm).standardized
            s.result.images.append(Image(rect: rect, key: 0, stream: nil))
        }
        return table
    }()

    private static func popNumbers(_ scanner: CGPDFScannerRef, _ count: Int) -> [CGFloat]? {
        var values = [CGFloat](repeating: 0, count: count)
        for index in stride(from: count - 1, through: 0, by: -1) {
            var value: CGPDFReal = 0
            guard CGPDFScannerPopNumber(scanner, &value) else { return nil }
            values[index] = value
        }
        return values
    }

    private func run(_ stream: CGPDFContentStreamRef) {
        let info = Unmanaged.passUnretained(self).toOpaque()
        let scanner = CGPDFScannerCreate(stream, Self.table, info)
        CGPDFScannerScan(scanner)
        CGPDFScannerRelease(scanner)
    }

    private func finish(stroke: Bool, fill: Bool) {
        defer { path = []; rects = [] }
        guard result.rulings.count < Self.maxRulings else { return }
        let width = max(lineWidth * max(abs(ctm.a), abs(ctm.d), 0.01), 0.1)
        if stroke {
            for rect in rects {
                // A stroked rectangle contributes its four edges.
                result.rulings.append(CGRect(x: rect.minX, y: rect.minY - width / 2, width: rect.width, height: width))
                result.rulings.append(CGRect(x: rect.minX, y: rect.maxY - width / 2, width: rect.width, height: width))
                result.rulings.append(CGRect(x: rect.minX - width / 2, y: rect.minY, width: width, height: rect.height))
                result.rulings.append(CGRect(x: rect.maxX - width / 2, y: rect.minY, width: width, height: rect.height))
            }
            for subpath in path where subpath.count >= 2 {
                for (a, b) in zip(subpath, subpath.dropFirst()) {
                    if abs(a.y - b.y) < 0.5 {
                        result.rulings.append(CGRect(x: min(a.x, b.x), y: a.y - width / 2, width: abs(a.x - b.x), height: width))
                    } else if abs(a.x - b.x) < 0.5 {
                        result.rulings.append(CGRect(x: a.x - width / 2, y: min(a.y, b.y), width: width, height: abs(a.y - b.y)))
                    }
                }
            }
        }
        if fill && !stroke {
            // Hairline filled rectangles are drawn rules (common in generated PDFs).
            for rect in rects where (rect.height <= 3 && rect.width > 3) || (rect.width <= 3 && rect.height > 3) {
                result.rulings.append(rect)
            }
        }
    }

    private func drawObject(_ scanner: CGPDFScannerRef) {
        var namePointer: UnsafePointer<CChar>?
        guard CGPDFScannerPopName(scanner, &namePointer), let namePointer else { return }
        let content = CGPDFScannerGetContentStream(scanner)
        guard let object = CGPDFContentStreamGetResource(content, "XObject", namePointer) else { return }
        var stream: CGPDFStreamRef?
        guard CGPDFObjectGetValue(object, .stream, &stream), let stream, let dictionary = CGPDFStreamGetDictionary(stream) else { return }
        var subtype: UnsafePointer<CChar>?
        CGPDFDictionaryGetName(dictionary, "Subtype", &subtype)
        let kind = subtype.map { String(cString: $0) } ?? ""
        let key = Int(bitPattern: UnsafeRawPointer(stream))
        if kind == "Image" {
            let rect = CGRect(x: 0, y: 0, width: 1, height: 1).applying(ctm).standardized
            result.images.append(Image(rect: rect, key: key, stream: stream))
        } else if kind == "Form", depth < 8, !visitedForms.contains(key) {
            depth += 1
            visitedForms.insert(key)
            let saved = (ctm, lineWidth, stack)
            var matrix: CGPDFArrayRef?
            if CGPDFDictionaryGetArray(dictionary, "Matrix", &matrix), let matrix, CGPDFArrayGetCount(matrix) == 6 {
                var values = [CGFloat](repeating: 0, count: 6)
                for index in 0..<6 { var value: CGPDFReal = 0; CGPDFArrayGetNumber(matrix, index, &value); values[index] = value }
                ctm = CGAffineTransform(a: values[0], b: values[1], c: values[2], d: values[3], tx: values[4], ty: values[5]).concatenating(ctm)
            }
            var resources: CGPDFDictionaryRef?
            CGPDFDictionaryGetDictionary(dictionary, "Resources", &resources)
            // Forms without their own resources inherit the parent's: an empty dictionary makes lookups
            // fall back to the parent content stream.
            let child = CGPDFContentStreamCreateWithStream(stream, resources ?? Self.empty, content)
            run(child)
            CGPDFContentStreamRelease(child)
            (ctm, lineWidth, stack) = saved
            depth -= 1
            visitedForms.remove(key)
        }
    }

    private static let empty: CGPDFDictionaryRef = {
        let pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 1 1]/Resources<<>>>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
        let document = CGPDFDocument(CGDataProvider(data: Data(pdf.utf8) as CFData)!)!
        let page = document.page(at: 1)!.dictionary!
        var resources: CGPDFDictionaryRef?
        CGPDFDictionaryGetDictionary(page, "Resources", &resources)
        emptyDocument = document
        return resources!
    }()

    private static var emptyDocument: CGPDFDocument?
}
