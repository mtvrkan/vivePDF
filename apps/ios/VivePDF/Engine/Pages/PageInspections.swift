import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers
import Vision

/// Page checks used by the organizer's Select / Edit menus (`analyze.py`, `pages.find_text`,
/// `pages.detect_rotation`, duplicate detection) and page rendering for picture export.
enum PageInspections {
    // MARK: Rendering

    /// Renders a page (with its own rotation plus `extraRotation`) into an RGB bitmap at `dpi`.
    static func render(_ page: PDFPage, dpi: CGFloat, extraRotation: Int = 0, gray: Bool = false, maxSide: CGFloat = 12_000) -> CGImage? {
        let box = page.bounds(for: .cropBox)
        let rotation = OrganizerOps.rotated(page.rotation, by: extraRotation)
        let quarter = rotation % 180 != 0
        var scale = dpi / 72
        let longest = max(box.width, box.height) * scale
        if longest > maxSide { scale *= maxSide / longest }
        let width = Int(((quarter ? box.height : box.width) * scale).rounded()), height = Int(((quarter ? box.width : box.height) * scale).rounded())
        guard width > 0, height > 0 else { return nil }
        let space = gray ? CGColorSpaceCreateDeviceGray() : CGColorSpaceCreateDeviceRGB()
        let info = gray ? CGImageAlphaInfo.none.rawValue : CGImageAlphaInfo.noneSkipLast.rawValue
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: info) else { return nil }
        context.setFillColor(gray ? CGColor(gray: 1, alpha: 1) : CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        // Rotate about the centre, then map the crop box onto the bitmap.
        context.translateBy(x: CGFloat(width) / 2, y: CGFloat(height) / 2)
        context.rotate(by: -CGFloat(rotation) * .pi / 180)
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: -box.midX, y: -box.midY)
        let saved = page.rotation
        page.rotation = 0
        page.draw(with: .cropBox, to: context)
        page.rotation = saved
        return context.makeImage()
    }

    enum ImageFormat: String, CaseIterable, Sendable {
        case png, jpg, tiff, heic
        var type: UTType { switch self { case .png: .png; case .jpg: .jpeg; case .tiff: .tiff; case .heic: .heic } }
        var ext: String { rawValue }
        var lossy: Bool { self == .jpg || self == .heic }
    }

    static func encode(_ image: CGImage, format: ImageFormat, quality: Double, dpi: CGFloat, to url: URL) throws {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, format.type.identifier as CFString, 1, nil) else {
            throw EngineError(.UNSUPPORTED, detail: format.rawValue)
        }
        var properties: [CFString: Any] = [kCGImagePropertyDPIWidth: dpi, kCGImagePropertyDPIHeight: dpi]
        if format.lossy { properties[kCGImageDestinationLossyCompressionQuality] = quality / 100 }
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw EngineError.internalError("encode") }
    }

    /// Saves each tile as a picture named `<base>-<n>.<ext>` in `folder`.
    static func exportImages(sources: [PagesSource], tiles: [OrganizerTile], format: ImageFormat, dpi: CGFloat, quality: Double,
                             baseName: String, folder: URL, progress: ProgressHandler? = nil) throws -> [URL] {
        let access = PagesAssembler.ScopedAccess(sources.map(\.url))
        defer { withExtendedLifetime(access) {} }
        var documents: [String: PDFDocument] = [:]
        for source in sources where tiles.contains(where: { $0.sourceID == source.id }) {
            documents[source.id] = try PagesAssembler.open(source.url, password: source.password)
        }
        let width = max(3, String(tiles.count).count)
        var outputs: [URL] = []
        for (position, tile) in tiles.enumerated() {
            try Task.checkCancellation()
            progress?(Double(position) / Double(tiles.count), nil)
            let page: PDFPage
            switch tile.kind {
            case .page(let source, let index):
                guard let found = documents[source]?.page(at: index - 1) else { continue }
                page = found
            case .blank(let w, let h, let paper):
                page = try PagesAssembler.blankPage(size: CGSize(width: w, height: h), paper: paper)
            case .image(let url):
                page = try PagesAssembler.imagePage(url)
            }
            let holder = page.document == nil ? PagesAssembler.standalone(page) : nil
            guard let image = withExtendedLifetime(holder, { render(page, dpi: dpi, extraRotation: tile.rotate) }) else { continue }
            let name = "\(PagesSpecs.sanitizeFileName(baseName))-\(String(format: "%0\(width)d", position + 1))"
            let url = Workspace.unique(name: name, ext: format.ext, in: folder)
            try encode(image, format: format, quality: quality, dpi: dpi, to: url)
            outputs.append(url)
        }
        return outputs
    }

    // MARK: Blank & scanned

    static let leftBlankPhrases = ["intentionally left blank", "intentionally blank", "bilerek boş bırakılmıştır", "bilerek boş bırakıldı", "kasten boş bırakılmıştır"]

    static func meaninglessText(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return true }
        let folded = trimmed.lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return folded.count <= 80 && leftBlankPhrases.contains { folded.contains($0) }
    }

    /// Share of dark pixels inside a 4% margin, relative to the paper tone (`ink_share`).
    static func inkShare(_ page: PDFPage) -> Double {
        guard let image = render(page, dpi: 50, gray: true), let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return 1 }
        let width = image.width, height = image.height, row = image.bytesPerRow
        let marginRows = Int(Double(height) * 0.04), marginColumns = Int(Double(width) * 0.04)
        var values: [UInt8] = []
        values.reserveCapacity(width * height)
        for y in marginRows..<max(marginRows, height - marginRows) {
            for x in marginColumns..<max(marginColumns, width - marginColumns) { values.append(bytes[y * row + x]) }
        }
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        let paper = Double(sorted[min(sorted.count - 1, Int(Double(sorted.count - 1) * 0.9))])
        if paper < 128 { return 1 }
        let threshold = min(180, paper - 60)
        return Double(values.filter { Double($0) < threshold }.count) / Double(values.count)
    }

    /// Fraction of the page covered by placed images (walks the content stream's `cm`/`Do`).
    static func imageCoverage(_ page: PDFPage) -> Double {
        guard let cgPage = page.pageRef else { return 0 }
        let box = cgPage.getBoxRect(.cropBox)
        guard box.width > 0, box.height > 0 else { return 0 }
        final class State {
            var ctm = CGAffineTransform.identity
            var stack: [CGAffineTransform] = []
            var covered: [CGRect] = []
            var xobjects: CGPDFDictionaryRef?
        }
        let state = State()
        if let dictionary = cgPage.dictionary {
            var resources: CGPDFDictionaryRef?
            if CGPDFDictionaryGetDictionary(dictionary, "Resources", &resources), let resources {
                var xobjects: CGPDFDictionaryRef?
                if CGPDFDictionaryGetDictionary(resources, "XObject", &xobjects) { state.xobjects = xobjects }
            }
        }
        guard state.xobjects != nil, let table = CGPDFOperatorTableCreate() else { return 0 }
        CGPDFOperatorTableSetCallback(table, "q") { _, info in
            guard let info else { return }
            let state = Unmanaged<State>.fromOpaque(info).takeUnretainedValue()
            state.stack.append(state.ctm)
        }
        CGPDFOperatorTableSetCallback(table, "Q") { _, info in
            guard let info else { return }
            let state = Unmanaged<State>.fromOpaque(info).takeUnretainedValue()
            if let last = state.stack.popLast() { state.ctm = last }
        }
        CGPDFOperatorTableSetCallback(table, "cm") { scanner, info in
            guard let info else { return }
            let state = Unmanaged<State>.fromOpaque(info).takeUnretainedValue()
            var values = [CGPDFReal](repeating: 0, count: 6)
            for index in (0..<6).reversed() { guard CGPDFScannerPopNumber(scanner, &values[index]) else { return } }
            let matrix = CGAffineTransform(a: values[0], b: values[1], c: values[2], d: values[3], tx: values[4], ty: values[5])
            state.ctm = matrix.concatenating(state.ctm)
        }
        CGPDFOperatorTableSetCallback(table, "Do") { scanner, info in
            guard let info else { return }
            let state = Unmanaged<State>.fromOpaque(info).takeUnretainedValue()
            var name: UnsafePointer<CChar>?
            guard CGPDFScannerPopName(scanner, &name), let name, let xobjects = state.xobjects else { return }
            var stream: CGPDFStreamRef?
            guard CGPDFDictionaryGetStream(xobjects, name, &stream), let stream, let dict = CGPDFStreamGetDictionary(stream) else { return }
            var subtype: UnsafePointer<CChar>?
            if CGPDFDictionaryGetName(dict, "Subtype", &subtype), let subtype, String(cString: subtype) == "Image" {
                state.covered.append(CGRect(x: 0, y: 0, width: 1, height: 1).applying(state.ctm))
            }
        }
        let stream = CGPDFContentStreamCreateWithPage(cgPage)
        let scanner = CGPDFScannerCreate(stream, table, Unmanaged.passUnretained(state).toOpaque())
        CGPDFScannerScan(scanner)
        CGPDFScannerRelease(scanner)
        CGPDFContentStreamRelease(stream)
        CGPDFOperatorTableRelease(table)
        let area = state.covered.map { $0.intersection(box) }.filter { !$0.isNull }.map { $0.width * $0.height }.reduce(0, +)
        return min(area / (box.width * box.height), 1)
    }

    struct Analysis: Sendable { var blank: Set<Int> = []; var scanned: Set<Int> = [] }

    /// 1-based blank and scanned pages (`analyze_pages`).
    static func analyze(_ source: PagesSource, progress: ProgressHandler? = nil) throws -> Analysis {
        let access = PagesAssembler.ScopedAccess([source.url])
        defer { withExtendedLifetime(access) {} }
        let document = try PagesAssembler.open(source.url, password: source.password)
        var result = Analysis()
        for index in 0..<document.pageCount {
            try Task.checkCancellation()
            progress?(Double(index) / Double(max(document.pageCount, 1)), nil)
            guard let page = document.page(at: index) else { continue }
            let text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let coverage = imageCoverage(page)
            if text.count < 20 && coverage > 0.6 { result.scanned.insert(index + 1) }
            if meaninglessText(text) {
                let ink = inkShare(page)
                if (coverage < 0.02 && ink < 0.003) || (coverage > 0.6 && ink < 0.0002) { result.blank.insert(index + 1) }
            }
        }
        return result
    }

    // MARK: Text

    static func squashed(_ text: String) -> String {
        text.replacingOccurrences(of: "\u{00AD}", with: "").split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// 1-based pages containing `query` (`pages.find_text`).
    static func findText(_ source: PagesSource, query: String, matchCase: Bool, wholeWord: Bool, progress: ProgressHandler? = nil) throws -> [Int] {
        let needle = squashed(query)
        guard !needle.isEmpty else { throw EngineError(.INVALID_PARAMS, reason: "emptyQuery") }
        var pattern = NSRegularExpression.escapedPattern(for: matchCase ? needle : needle.lowercased())
        if wholeWord { pattern = "(?<!\\w)\(pattern)(?!\\w)" }
        let regex = try NSRegularExpression(pattern: pattern)
        let access = PagesAssembler.ScopedAccess([source.url])
        defer { withExtendedLifetime(access) {} }
        let document = try PagesAssembler.open(source.url, password: source.password)
        var found: [Int] = []
        for index in 0..<document.pageCount {
            try Task.checkCancellation()
            var text = squashed(document.page(at: index)?.string ?? "")
            if !matchCase { text = text.lowercased() }
            if regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil { found.append(index + 1) }
            progress?(Double(index + 1) / Double(document.pageCount), nil)
        }
        return found
    }

    // MARK: Bookmarks

    /// 1-based pages (after page 1) where a top-level bookmark starts a chapter.
    static func chapterStarts(_ source: PagesSource) throws -> Set<Int> {
        let access = PagesAssembler.ScopedAccess([source.url])
        defer { withExtendedLifetime(access) {} }
        let document = try PagesAssembler.open(source.url, password: source.password)
        let entries = PagesAssembler.outlineEntries(document)
        guard let top = entries.map(\.level).min() else { return [] }
        return Set(entries.filter { $0.level == top && $0.page > 0 }.map { $0.page + 1 })
    }

    // MARK: Orientation

    /// Clockwise turn that makes each page upright (1-based page → degrees), plus pages already upright.
    static func detectRotation(_ source: PagesSource, progress: ProgressHandler? = nil) throws -> (turns: [Int: Int], upright: Set<Int>) {
        let access = PagesAssembler.ScopedAccess([source.url])
        defer { withExtendedLifetime(access) {} }
        let document = try PagesAssembler.open(source.url, password: source.password)
        var turns: [Int: Int] = [:]
        var upright = Set<Int>()
        for index in 0..<document.pageCount {
            try Task.checkCancellation()
            progress?(Double(index) / Double(max(document.pageCount, 1)), nil)
            guard let page = document.page(at: index) else { continue }
            if let rotation = textRotation(page) {
                if rotation == 0 { upright.insert(index + 1) } else { turns[index + 1] = rotation }
            } else if imageCoverage(page) > 0.6, let rotation = ocrRotation(page), rotation != 0 {
                turns[index + 1] = rotation
            }
        }
        return (turns, upright)
    }

    /// Reading direction from character positions (`text_rotation`): needs a few lines of text.
    static func textRotation(_ page: PDFPage) -> Int? {
        guard let text = page.string, text.count >= 6 else { return nil }
        let characters = Array(text.utf16)
        var counts: [Int: Int] = [:]
        var lines = 0
        var run = 0
        var previous: CGRect?
        let limit = min(characters.count, 4000)
        for index in 0..<limit {
            let unit = characters[index]
            if unit == 10 || unit == 13 {
                if run >= 2 { lines += 1 }
                run = 0
                previous = nil
                continue
            }
            if unit == 32 { continue }
            let bounds = page.characterBounds(at: index)
            guard bounds.width > 0 || bounds.height > 0 else { continue }
            if let previous {
                let dx = bounds.midX - previous.midX, dy = bounds.midY - previous.midY
                let direction: Int
                if abs(dx) >= abs(dy) { direction = dx > 0 ? 0 : 180 } else { direction = dy > 0 ? 90 : 270 }
                counts[direction, default: 0] += 1
                run += 1
            }
            previous = bounds
        }
        if run >= 2 { lines += 1 }
        guard lines >= 3, let unrotated = counts.max(by: { $0.value < $1.value })?.key else { return nil }
        return ((unrotated - page.rotation) % 360 + 360) % 360
    }

    /// For scanned pages: OCR at each quarter turn and keep the one that reads best.
    static func ocrRotation(_ page: PDFPage) -> Int? {
        var best: (rotation: Int, score: Float) = (0, 0)
        for rotation in [0, 90, 180, 270] {
            guard let image = render(page, dpi: 72, extraRotation: rotation) else { continue }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .fast
            request.usesLanguageCorrection = false
            try? VNImageRequestHandler(cgImage: image).perform([request])
            let score = (request.results ?? []).reduce(Float(0)) { total, observation in
                total + (observation.topCandidates(1).first.map { $0.confidence * Float($0.string.count) } ?? 0)
            }
            if score > best.score { best = (rotation, score) }
        }
        return best.score > 0 ? best.rotation : nil
    }

    // MARK: Duplicates

    /// Groups identical pages across sources (`find_duplicate_pages`): text pages by normalised text,
    /// pictures and scans by a 16×16 visual fingerprint. Returns, per source, a group id for each page.
    static func duplicateGroups(_ sources: [URL: String?], order: [URL], progress: ProgressHandler? = nil) throws -> [[Int?]] {
        let access = PagesAssembler.ScopedAccess(order)
        defer { withExtendedLifetime(access) {} }
        struct Signature { var aspect: CGFloat; var text: String; var hash: [UInt8] }
        var signatures: [[Signature]] = []
        let total = order.count
        for (position, url) in order.enumerated() {
            try Task.checkCancellation()
            progress?(Double(position) / Double(max(total, 1)), nil)
            let pages: [PDFPage]
            var holder: PDFDocument?
            if PagesEngine.isImage(url) {
                let page = try PagesAssembler.imagePage(url)
                holder = PagesAssembler.standalone(page)
                pages = [page]
            } else {
                let document = try PagesAssembler.open(url, password: sources[url] ?? nil)
                pages = (0..<document.pageCount).compactMap { document.page(at: $0) }
                holder = document
            }
            signatures.append(pages.map { page in
                let size = page.bounds(for: .cropBox).size
                let words = (page.string ?? "").lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
                let text = words.count >= 4 ? words.joined(separator: " ") : ""
                return Signature(aspect: size.width / max(size.height, 1), text: text, hash: text.isEmpty ? fingerprint(page) : [])
            })
            withExtendedLifetime(holder) {}
        }
        var groups = signatures.map { [Int?](repeating: nil, count: $0.count) }
        var representatives: [(group: Int, signature: Signature)] = []
        var members: [Int: Int] = [:]
        var assigned: [[Int]] = signatures.map { [Int](repeating: -1, count: $0.count) }
        for (source, list) in signatures.enumerated() {
            for (index, signature) in list.enumerated() {
                let match = representatives.first { candidate in
                    abs(candidate.signature.aspect - signature.aspect) < 0.08 &&
                        (!signature.text.isEmpty ? candidate.signature.text == signature.text
                                                 : candidate.signature.text.isEmpty && hamming(candidate.signature.hash, signature.hash) <= 10)
                }
                let group = match?.group ?? representatives.count
                if match == nil { representatives.append((group, signature)) }
                assigned[source][index] = group
                members[group, default: 0] += 1
            }
        }
        for (source, list) in assigned.enumerated() {
            for (index, group) in list.enumerated() where (members[group] ?? 0) > 1 { groups[source][index] = group }
        }
        return groups
    }

    private static func fingerprint(_ page: PDFPage) -> [UInt8] {
        guard let image = render(page, dpi: 24, gray: true) else { return [] }
        let side = 16
        guard let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side, space: CGColorSpaceCreateDeviceGray(),
                                      bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return [] }
        context.interpolationQuality = .medium
        context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
        guard let data = context.data else { return [] }
        let pixels = Array(UnsafeBufferPointer(start: data.assumingMemoryBound(to: UInt8.self), count: side * side))
        let mean = pixels.reduce(0) { $0 + Int($1) } / pixels.count
        return pixels.map { Int($0) < mean ? 1 : 0 }
    }

    private static func hamming(_ a: [UInt8], _ b: [UInt8]) -> Int {
        guard a.count == b.count, !a.isEmpty else { return Int.max }
        return zip(a, b).filter { $0 != $1 }.count
    }
}
