import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// `.vivedesign` project files (a ZIP with `design.json`, `thumbnail.jpg` and content-addressed image
/// assets — `_studio_project.py`), designs embedded in exported PDFs, the autosaved draft and the
/// recent-designs list.
enum StudioProject {
    static let format = "vivedesign"
    static let version = 1
    static let fileExtension = "vivedesign"
    static let assetPrefix = "vivepdf-asset:"
    static let catalogKey = "VivePDFDesign"
    static let maxDesignJSON = 20 * 1024 * 1024
    static let maxAssetBytes = 200 * 1024 * 1024
    static let maxProjectBytes = 512 * 1024 * 1024
    static let assetExtensions: Set<String> = ["png", "jpg", "jpeg", "jfif", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif", "img"]
    static let thumbnailSide: CGFloat = 320

    static var assetsFolder: URL { Workspace.supportFolder("studio-assets") }
    static var imagesFolder: URL { Workspace.supportFolder("studio-images") }
    static var studioFolder: URL { Workspace.supportFolder("studio") }

    static func refusal(_ reason: String) -> EngineError { EngineError(.INVALID_PARAMS, reason: reason) }

    // MARK: JSON string replacement

    static func replacingStrings(_ value: Any, _ mapping: [String: String]) -> Any {
        switch value {
        case let s as String: return mapping[s] ?? s
        case let a as [Any]: return a.map { replacingStrings($0, mapping) }
        case let d as [String: Any]: return d.mapValues { replacingStrings($0, mapping) }
        default: return value
        }
    }

    // MARK: Build

    struct Saved {
        let data: Data
        let thumbnail: Data
    }

    static func assetExtension(_ path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        return assetExtensions.contains(ext) ? ext : "img"
    }

    static func archive(_ design: StudioDesign, thumbnail: Data) throws -> Data {
        var mapping: [String: String] = [:]
        var entries: [StudioZip.Entry] = []
        var total = 0
        var names = Set<String>()
        for path in StudioEdit.imagePaths(design) {
            let url = URL(fileURLWithPath: path)
            guard let data = try? Data(contentsOf: url) else { throw EngineError(.FILE_NOT_FOUND, reason: "missingImage", detail: url.lastPathComponent) }
            total += data.count
            guard data.count <= maxAssetBytes, total <= maxProjectBytes else { throw refusal("projectTooLarge") }
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            let name = "assets/\(digest).\(assetExtension(path))"
            mapping[path] = assetPrefix + name
            if names.insert(name).inserted { entries.append(StudioZip.Entry(name: name, data: data, compress: false)) }
        }
        let document: [String: Any] = ["format": format, "version": version, "design": replacingStrings(StudioJSON.encode(design), mapping)]
        let payload = try JSONSerialization.data(withJSONObject: document, options: [.withoutEscapingSlashes])
        guard payload.count <= maxDesignJSON else { throw refusal("projectTooLarge") }
        var all = [StudioZip.Entry(name: "design.json", data: payload, compress: true)]
        if !thumbnail.isEmpty { all.append(StudioZip.Entry(name: "thumbnail.jpg", data: thumbnail, compress: false)) }
        return try StudioZip.archive(all + entries)
    }

    static func thumbnailJPEG(_ page: StudioPage, language: String, side: CGFloat = thumbnailSide) -> Data {
        guard let image = StudioRenderer.thumbnail(page: page, side: side, language: language) else { return Data() }
        return encode(image, type: .jpeg, quality: 0.8) ?? Data()
    }

    static func encode(_ image: CGImage, type: UTType, quality: Double = 0.9, dpi: Double? = nil) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else { return nil }
        var props: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: quality]
        if let dpi { props[kCGImagePropertyDPIWidth] = dpi; props[kCGImagePropertyDPIHeight] = dpi }
        CGImageDestinationAddImage(destination, image, props as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }

    /// Writes a project file (coordinated for files outside the app) and returns its thumbnail.
    @discardableResult
    static func save(_ design: StudioDesign, to url: URL, language: String) throws -> Data {
        let thumbnail = design.pages.first.map { thumbnailJPEG($0, language: language) } ?? Data()
        let data = try archive(design, thumbnail: thumbnail)
        try withSecurityScope(url) {
            var coordError: NSError?
            var writeError: Error?
            NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { target in
                do { try data.write(to: target, options: .atomic) } catch { writeError = error }
            }
            if let error = coordError ?? writeError { throw error }
        }
        return thumbnail
    }

    // MARK: Read

    struct Opened {
        var design: StudioDesign
        var thumbnail: Data
        /// "project" for `.vivedesign`, "pdf" for a design embedded in a PDF (save goes elsewhere).
        var source: String
    }

    static func read(archive data: Data, name: String) throws -> (Any, Data) {
        let listing: [StudioZip.Listing]
        do { listing = try StudioZip.list(data) } catch { throw refusal("notProject") }
        guard listing.count <= 2002 else { throw refusal("projectTooLarge") }
        guard let entry = listing.first(where: { $0.name == "design.json" }) else { throw refusal("notProject") }
        let json: Any
        do { json = try JSONSerialization.jsonObject(with: try StudioZip.read(data, entry, limit: maxDesignJSON)) } catch { throw refusal("notProject") }
        guard let document = json as? [String: Any], document["format"] as? String == format else { throw refusal("notProject") }
        guard let v = document["version"] as? Int, let design = document["design"] as? [String: Any] else { throw refusal("notProject") }
        guard v <= version else { throw refusal("newerProject") }
        var mapping: [String: String] = [:]
        var total = 0
        for item in listing where item.name.hasPrefix("assets/") {
            let file = String(item.name.dropFirst(7))
            let parts = file.split(separator: ".")
            guard parts.count == 2, parts[0].count == 64, parts[0].allSatisfy(\.isHexDigit), assetExtensions.contains(String(parts[1])) else { continue }
            total += item.size
            guard total <= maxProjectBytes else { throw refusal("projectTooLarge") }
            let target = assetsFolder.appendingPathComponent(file)
            mapping[assetPrefix + item.name] = target.path
            if (try? target.resourceValues(forKeys: [.fileSizeKey]).fileSize) == item.size { continue }
            guard let bytes = try? StudioZip.read(data, item, limit: maxAssetBytes) else { continue }
            let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            guard digest == String(parts[0]) else { continue }
            try? bytes.write(to: target, options: .atomic)
        }
        var thumbnail = Data()
        if let thumb = listing.first(where: { $0.name == "thumbnail.jpg" }) { thumbnail = (try? StudioZip.read(data, thumb, limit: 2 * 1024 * 1024)) ?? Data() }
        return (replacingStrings(design, mapping), thumbnail)
    }

    /// Opens a `.vivedesign` project or a PDF exported with an embedded design.
    static func open(_ url: URL, password: String? = nil) throws -> Opened {
        let data: Data = try withSecurityScope(url) {
            var coordError: NSError?
            var result: Data?
            var readError: Error?
            NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &coordError) { readURL in
                do { result = try Data(contentsOf: readURL, options: .mappedIfSafe) } catch { readError = error }
            }
            if let error = coordError ?? readError { throw error }
            return result ?? Data()
        }
        guard data.count <= maxProjectBytes * 2 else { throw refusal("projectTooLarge") }
        let raw: Any
        let thumbnail: Data
        let source: String
        if data.starts(with: Data("%PDF".utf8)) {
            guard let archive = try embeddedArchive(data, password: password) else { throw refusal("noDesign") }
            (raw, thumbnail) = try read(archive: archive, name: url.lastPathComponent)
            source = "pdf"
        } else {
            (raw, thumbnail) = try read(archive: data, name: url.lastPathComponent)
            source = "project"
        }
        guard let design = StudioJSON.design(raw) else { throw refusal("notProject") }
        return Opened(design: design, thumbnail: thumbnail, source: source)
    }

    // MARK: PDF embedding

    static func embeddedArchive(_ pdf: Data, password: String?) throws -> Data? {
        guard let provider = CGDataProvider(data: pdf as CFData), let document = CGPDFDocument(provider) else { throw EngineError(.INVALID_PDF) }
        if document.isEncrypted, !document.isUnlocked {
            guard let password, document.unlockWithPassword(password) else { throw EngineError(.NEEDS_PASSWORD) }
        }
        guard let catalog = document.catalog else { return nil }
        var stream: CGPDFStreamRef?
        guard CGPDFDictionaryGetStream(catalog, catalogKey, &stream), let stream else { return nil }
        var format = CGPDFDataFormat.raw
        guard let data = CGPDFStreamCopyData(stream, &format) as Data? else { return nil }
        return data
    }

    /// True when the PDF carries an editable Studio design (`studio.design_of`).
    static func hasDesign(_ url: URL) -> Bool {
        guard let data = try? withSecurityScope(url, { try Data(contentsOf: url, options: .mappedIfSafe) }), data.starts(with: Data("%PDF".utf8)),
              let provider = CGDataProvider(data: data as CFData), let document = CGPDFDocument(provider), document.isUnlocked, let catalog = document.catalog else { return false }
        var stream: CGPDFStreamRef?
        return CGPDFDictionaryGetStream(catalog, catalogKey, &stream)
    }

    /// Appends the archive to a Core Graphics PDF as an incremental update: a raw stream object linked
    /// from the catalog under `/VivePDFDesign`, exactly where the desktop looks for it.
    static func embed(_ archive: Data, into pdf: Data) throws -> Data {
        let text = String(decoding: pdf.suffix(4096), as: UTF8.self)
        guard let startRange = text.range(of: "startxref", options: .backwards) else { throw EngineError.internalError("startxref") }
        let tail = text[startRange.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        guard let previous = Int(tail.split(whereSeparator: \.isNewline).first ?? "") else { throw EngineError.internalError("xref") }
        guard let trailerRange = text.range(of: "trailer", options: .backwards) else { throw EngineError.internalError("trailer") }
        let trailer = String(text[trailerRange.upperBound..<startRange.lowerBound])
        func ref(_ key: String) -> (Int, Int)? {
            guard let r = trailer.range(of: "/\(key) ") else { return nil }
            let parts = trailer[r.upperBound...].split(separator: " ", maxSplits: 3)
            guard parts.count >= 2, let a = Int(parts[0]), let b = Int(parts[1].prefix { $0.isNumber }) else { return nil }
            return (a, b)
        }
        guard let sizeRange = trailer.range(of: "/Size "), let size = Int(trailer[sizeRange.upperBound...].prefix { $0.isNumber }),
              let root = ref("Root") else { throw EngineError.internalError("trailer") }
        let info = ref("Info")
        var idEntry = ""
        if let idRange = trailer.range(of: "/ID"), let close = trailer.range(of: "]", range: idRange.upperBound..<trailer.endIndex) {
            idEntry = String(trailer[idRange.lowerBound..<close.upperBound])
        }
        // Locate the catalog body through the classic xref table.
        let whole = String(decoding: pdf, as: UTF8.self)
        guard let catalogRange = whole.range(of: "\n\(root.0) \(root.1) obj", options: .backwards) ?? whole.range(of: "\r\(root.0) \(root.1) obj", options: .backwards),
              let end = whole.range(of: "endobj", range: catalogRange.upperBound..<whole.endIndex) else { throw EngineError.internalError("catalog") }
        var body = String(whole[catalogRange.upperBound..<end.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard body.hasSuffix(">>") else { throw EngineError.internalError("catalog") }
        body.removeLast(2)
        let streamNumber = size
        var out = pdf
        if out.last != 0x0A { out.append(0x0A) }
        let streamOffset = out.count
        out.append(Data("\(streamNumber) 0 obj\n<< /Type /\(catalogKey) /Version \(version) /Length \(archive.count) >>\nstream\n".utf8))
        out.append(archive)
        out.append(Data("\nendstream\nendobj\n".utf8))
        let catalogOffset = out.count
        out.append(Data("\(root.0) \(root.1) obj\n\(body) /\(catalogKey) \(streamNumber) 0 R >>\nendobj\n".utf8))
        let xrefOffset = out.count
        func entry(_ offset: Int, _ generation: Int) -> String { String(format: "%010d %05d n \n", offset, generation) }
        var xref = "xref\n0 1\n0000000000 65535 f \n\(root.0) 1\n" + entry(catalogOffset, root.1) + "\(streamNumber) 1\n" + entry(streamOffset, 0)
        xref += "trailer\n<< /Size \(streamNumber + 1) /Root \(root.0) \(root.1) R"
        if let info { xref += " /Info \(info.0) \(info.1) R" }
        if !idEntry.isEmpty { xref += " \(idEntry)" }
        xref += " /Prev \(previous) >>\nstartxref\n\(xrefOffset)\n%%EOF\n"
        out.append(Data(xref.utf8))
        return out
    }

    // MARK: Images

    /// Copies a picked image into the app (content-addressed like `studio.save_image`); HEIC becomes
    /// JPEG so projects open on the desktop.
    static func importImage(_ url: URL) throws -> (path: String, size: CGSize) {
        let data = try withSecurityScope(url) { try Data(contentsOf: url) }
        return try importImage(data: data)
    }

    static func importImage(data input: Data) throws -> (path: String, size: CGSize) {
        guard input.count <= 150 * 1024 * 1024, let source = CGImageSourceCreateWithData(input as CFData, nil), let type = CGImageSourceGetType(source) as String? else {
            throw EngineError(.INVALID_PARAMS, reason: "imageUnreadable")
        }
        var data = input
        var ext: String
        switch type {
        case UTType.png.identifier: ext = "png"
        case UTType.jpeg.identifier: ext = "jpg"
        case UTType.gif.identifier: ext = "gif"
        case UTType.bmp.identifier: ext = "bmp"
        case UTType.tiff.identifier: ext = "tif"
        case UTType.webP.identifier: ext = "webp"
        default:
            guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw EngineError(.INVALID_PARAMS, reason: "imageUnreadable") }
            let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
            let orientation = (props?[kCGImagePropertyOrientation] as? UInt32) ?? 1
            let out = NSMutableData()
            guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { throw EngineError(.INVALID_PARAMS, reason: "imageUnreadable") }
            CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.92, kCGImagePropertyOrientation: orientation] as CFDictionary)
            CGImageDestinationFinalize(dest)
            data = out as Data
            ext = "jpg"
        }
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined().prefix(32)
        let target = imagesFolder.appendingPathComponent("\(digest).\(ext)")
        if (try? target.resourceValues(forKeys: [.fileSizeKey]).fileSize) != data.count { try data.write(to: target, options: .atomic) }
        let size = StudioRenderer.imageSize(target.path) ?? CGSize(width: 400, height: 300)
        return (target.path, size)
    }

    /// Paths that the design references but that are missing on this device.
    static func missingImages(_ design: StudioDesign) -> [String] {
        StudioEdit.imagePaths(design).filter { !FileManager.default.fileExists(atPath: $0) }
    }

    // MARK: Draft

    struct Draft {
        var design: StudioDesign
        var fileURL: URL?
        var savedAt: Date
    }

    static var draftURL: URL { studioFolder.appendingPathComponent("draft.json") }

    static func saveDraft(_ design: StudioDesign, fileURL: URL?) {
        var body: [String: Any] = ["format": "vivedraft", "version": 1, "savedAt": Int(Date().timeIntervalSince1970 * 1000), "design": StudioJSON.encode(design)]
        body["filePath"] = fileURL?.path ?? NSNull()
        if let bookmark = fileURL.flatMap({ try? $0.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) }) {
            body["bookmark"] = bookmark.base64EncodedString()
        }
        guard let data = try? JSONSerialization.data(withJSONObject: body), data.count <= 7 * 1024 * 1024 else { return }
        try? data.write(to: draftURL, options: .atomic)
    }

    static func loadDraft() -> Draft? {
        guard let data = try? Data(contentsOf: draftURL), let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              body["format"] as? String == "vivedraft", (body["version"] as? Int ?? 99) <= 1, let design = StudioJSON.design(body["design"]) else { return nil }
        var url: URL?
        if let mark = (body["bookmark"] as? String).flatMap({ Data(base64Encoded: $0) }) {
            var stale = false
            url = try? URL(resolvingBookmarkData: mark, bookmarkDataIsStale: &stale)
        }
        if url == nil, let path = body["filePath"] as? String, FileManager.default.fileExists(atPath: path) { url = URL(fileURLWithPath: path) }
        let saved = Date(timeIntervalSince1970: Double(body["savedAt"] as? Int ?? 0) / 1000)
        return Draft(design: design, fileURL: url, savedAt: saved)
    }

    static func clearDraft() { try? FileManager.default.removeItem(at: draftURL) }
}

/// Recently saved / opened designs (`recentDesigns.ts`), with bookmarks for files outside the app.
struct StudioRecentDesign: Codable, Identifiable, Hashable {
    var id: String { path }
    var path: String
    var name: String
    var savedAt: Date
    var width: Double
    var height: Double
    var thumbnail: Data
    var bookmark: Data?

    func resolve() -> URL? {
        if let bookmark {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: bookmark, bookmarkDataIsStale: &stale) { return url }
        }
        return FileManager.default.fileExists(atPath: path) ? URL(fileURLWithPath: path) : nil
    }
}

enum StudioRecents {
    static let key = "vivepdf.studioRecent"
    static let limit = 12

    static func load() -> [StudioRecentDesign] {
        guard let data = UserDefaults.standard.data(forKey: key), let list = try? JSONDecoder().decode([StudioRecentDesign].self, from: data) else { return [] }
        return Array(list.prefix(limit))
    }

    static func add(_ design: StudioDesign, url: URL, thumbnail: Data) {
        let first = design.pages.first
        let bookmark = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        let item = StudioRecentDesign(path: url.path, name: design.name.isEmpty ? url.deletingPathExtension().lastPathComponent : design.name, savedAt: Date(),
                                      width: first?.width ?? 595, height: first?.height ?? 842, thumbnail: thumbnail, bookmark: bookmark)
        let list = [item] + load().filter { $0.path != url.path }
        persist(Array(list.prefix(limit)))
    }

    static func remove(_ path: String) { persist(load().filter { $0.path != path }) }

    private static func persist(_ list: [StudioRecentDesign]) {
        if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: key) }
    }
}
