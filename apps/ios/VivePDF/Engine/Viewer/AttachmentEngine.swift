import CoreGraphics
import Foundation
import PDFKit

/// One file embedded in a PDF: an entry of the `/EmbeddedFiles` name tree or a `FileAttachment` annotation.
struct PDFAttachmentInfo: Identifiable, Hashable, Sendable {
    enum Kind: String, Sendable { case embedded, annotation }

    /// Stable id: the name-tree key, or `annot-<page>-<index>` for annotation attachments.
    let id: String
    let kind: Kind
    /// Name-tree key (what the desktop engine calls `name`).
    let name: String
    /// File name shown to the reader (`/UF`, else `/F`, else the key).
    let fileName: String
    let description: String?
    /// Uncompressed size in bytes (`/Params /Size`, else the decoded stream length).
    let size: Int64
    let mimeType: String?
    let created: Date?
    let modified: Date?
    /// Page of an annotation attachment (zero-based).
    let pageIndex: Int?
}

/// Reads and extracts embedded files with Core Graphics' PDF parser (PDFKit has no attachment API).
/// Mirrors the sidecar `attachments` ops: list, extract one / all. Adding and removing files needs a raw
/// PDF writer (see `apps/ios/parity/viewer.md`).
enum AttachmentEngine {
    /// Attachments are capped like the desktop app (`viewer.attachments.tooLarge`).
    static let maxBytes: Int64 = 200 * 1024 * 1024

    /// Adding and removing embedded files rewrites the name tree, which needs the raw PDF writer.
    static let canWrite = false

    /// Embeds `files` into a copy of `source` and returns the copy.
    static func add(_ files: [URL], to source: URL) throws -> URL {
        // TODO: write through Engine/PDFCore once its document writer lands (name tree + filespec + stream).
        throw EngineError(.UNSUPPORTED)
    }

    /// Removes the name-tree entries `names` from a copy of `source` and returns the copy.
    static func remove(_ names: [String], from source: URL) throws -> URL {
        // TODO: write through Engine/PDFCore once its document writer lands.
        throw EngineError(.UNSUPPORTED)
    }

    static func list(in document: CGPDFDocument) -> [PDFAttachmentInfo] {
        var result: [PDFAttachmentInfo] = []
        if let catalog = document.catalog,
           let names = ViewerCGPDF.dictionary(catalog, "Names"),
           let tree = ViewerCGPDF.dictionary(names, "EmbeddedFiles") {
            var seen = Set<String>()
            ViewerCGPDF.walkNameTree(tree) { key, object in
                guard let spec = ViewerCGPDF.dictionary(from: object), !seen.contains(key) else { return }
                seen.insert(key)
                result.append(info(spec: spec, id: key, name: key, kind: .embedded, page: nil, fallbackDescription: nil))
            }
        }
        for pageNumber in 1...max(document.numberOfPages, 1) where document.numberOfPages > 0 {
            guard let page = document.page(at: pageNumber)?.dictionary, let annots = ViewerCGPDF.array(page, "Annots") else { continue }
            for index in 0..<CGPDFArrayGetCount(annots) {
                guard let annot = ViewerCGPDF.dictionary(annots, index),
                      ViewerCGPDF.name(annot, "Subtype") == "FileAttachment",
                      let spec = ViewerCGPDF.dictionary(annot, "FS") else { continue }
                let id = "annot-\(pageNumber - 1)-\(index)"
                result.append(info(spec: spec, id: id, name: id, kind: .annotation, page: pageNumber - 1,
                                   fallbackDescription: ViewerCGPDF.text(annot, "Contents")))
            }
        }
        return result
    }

    static func list(in pdf: PDFDocument) -> [PDFAttachmentInfo] {
        guard let document = pdf.documentRef else { return [] }
        return list(in: document)
    }

    /// The decoded bytes of one attachment.
    static func data(of attachment: PDFAttachmentInfo, in document: CGPDFDocument) throws -> Data {
        guard let spec = filespec(for: attachment, in: document),
              let stream = embeddedStream(spec) else { throw EngineError(.FILE_NOT_FOUND, reason: nil, detail: attachment.fileName) }
        var format = CGPDFDataFormat.raw
        guard let data = CGPDFStreamCopyData(stream, &format) as Data? else { throw EngineError.internalError("attachment") }
        return data
    }

    /// Writes attachments into `folder` with collision-free names and returns the files.
    static func extract(_ attachments: [PDFAttachmentInfo], from document: CGPDFDocument, to folder: URL) throws -> [URL] {
        var outputs: [URL] = []
        for attachment in attachments {
            let data = try data(of: attachment, in: document)
            let safe = sanitized(attachment.fileName)
            let ext = (safe as NSString).pathExtension
            let base = (safe as NSString).deletingPathExtension
            let target = Workspace.unique(name: base.isEmpty ? "attachment" : base, ext: ext, in: folder)
            let finalURL = ext.isEmpty ? target.deletingPathExtension() : target
            try data.write(to: finalURL, options: .atomic)
            outputs.append(finalURL)
        }
        return outputs
    }

    /// Strips path separators and control characters an attachment name could smuggle in.
    static func sanitized(_ name: String) -> String {
        let last = name.split(whereSeparator: { $0 == "/" || $0 == "\\" || $0 == ":" }).last.map(String.init) ?? name
        let cleaned = last.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
        let text = String(String.UnicodeScalarView(cleaned)).trimmingCharacters(in: .whitespaces)
        return text.isEmpty || text == "." || text == ".." ? "attachment" : text
    }

    // MARK: - Private

    private static func info(spec: CGPDFDictionaryRef, id: String, name: String, kind: PDFAttachmentInfo.Kind, page: Int?, fallbackDescription: String?) -> PDFAttachmentInfo {
        let fileName = ViewerCGPDF.text(spec, "UF") ?? ViewerCGPDF.text(spec, "F") ?? name
        var size: Int64 = -1
        var mime: String?
        var created: Date?
        var modified: Date?
        if let stream = embeddedStream(spec), let streamDict = CGPDFStreamGetDictionary(stream) {
            mime = ViewerCGPDF.name(streamDict, "Subtype")
            if let params = ViewerCGPDF.dictionary(streamDict, "Params") {
                if let value = ViewerCGPDF.integer(params, "Size") { size = Int64(value) }
                created = ViewerCGPDF.date(params, "CreationDate")
                modified = ViewerCGPDF.date(params, "ModDate")
            }
            if size < 0 {
                var format = CGPDFDataFormat.raw
                size = Int64((CGPDFStreamCopyData(stream, &format) as Data?)?.count ?? 0)
            }
        }
        let description = ViewerCGPDF.text(spec, "Desc") ?? fallbackDescription
        return PDFAttachmentInfo(id: id, kind: kind, name: name, fileName: sanitized(fileName),
                                 description: description?.isEmpty == true ? nil : description,
                                 size: max(size, 0), mimeType: mime, created: created, modified: modified, pageIndex: page)
    }

    private static func embeddedStream(_ spec: CGPDFDictionaryRef) -> CGPDFStreamRef? {
        guard let ef = ViewerCGPDF.dictionary(spec, "EF") else { return nil }
        for key in ["UF", "F", "Unix", "DOS", "Mac"] {
            if let stream = ViewerCGPDF.stream(ef, key) { return stream }
        }
        return nil
    }

    private static func filespec(for attachment: PDFAttachmentInfo, in document: CGPDFDocument) -> CGPDFDictionaryRef? {
        switch attachment.kind {
        case .embedded:
            guard let catalog = document.catalog,
                  let names = ViewerCGPDF.dictionary(catalog, "Names"),
                  let tree = ViewerCGPDF.dictionary(names, "EmbeddedFiles") else { return nil }
            var found: CGPDFDictionaryRef?
            ViewerCGPDF.walkNameTree(tree) { key, object in
                if found == nil, key == attachment.name { found = ViewerCGPDF.dictionary(from: object) }
            }
            return found
        case .annotation:
            let parts = attachment.id.split(separator: "-")
            guard parts.count == 3, let page = Int(parts[1]), let index = Int(parts[2]),
                  let dict = document.page(at: page + 1)?.dictionary,
                  let annots = ViewerCGPDF.array(dict, "Annots"),
                  let annot = ViewerCGPDF.dictionary(annots, index) else { return nil }
            return ViewerCGPDF.dictionary(annot, "FS")
        }
    }
}

/// Small typed accessors over Core Graphics' C PDF object API, shared by the viewer engines.
enum ViewerCGPDF {
    static func dictionary(_ dict: CGPDFDictionaryRef, _ key: String) -> CGPDFDictionaryRef? {
        var value: CGPDFDictionaryRef?
        return CGPDFDictionaryGetDictionary(dict, key, &value) ? value : nil
    }

    static func dictionary(_ array: CGPDFArrayRef, _ index: Int) -> CGPDFDictionaryRef? {
        var value: CGPDFDictionaryRef?
        return CGPDFArrayGetDictionary(array, index, &value) ? value : nil
    }

    static func dictionary(from object: CGPDFObjectRef) -> CGPDFDictionaryRef? {
        var value: CGPDFDictionaryRef?
        return CGPDFObjectGetValue(object, .dictionary, &value) ? value : nil
    }

    static func array(_ dict: CGPDFDictionaryRef, _ key: String) -> CGPDFArrayRef? {
        var value: CGPDFArrayRef?
        return CGPDFDictionaryGetArray(dict, key, &value) ? value : nil
    }

    static func array(_ array: CGPDFArrayRef, _ index: Int) -> CGPDFArrayRef? {
        var value: CGPDFArrayRef?
        return CGPDFArrayGetArray(array, index, &value) ? value : nil
    }

    static func stream(_ dict: CGPDFDictionaryRef, _ key: String) -> CGPDFStreamRef? {
        var value: CGPDFStreamRef?
        return CGPDFDictionaryGetStream(dict, key, &value) ? value : nil
    }

    static func name(_ dict: CGPDFDictionaryRef, _ key: String) -> String? {
        var value: UnsafePointer<CChar>?
        guard CGPDFDictionaryGetName(dict, key, &value), let value else { return nil }
        return String(cString: value)
    }

    static func integer(_ dict: CGPDFDictionaryRef, _ key: String) -> Int? {
        var value: CGPDFInteger = 0
        if CGPDFDictionaryGetInteger(dict, key, &value) { return Int(value) }
        var real: CGPDFReal = 0
        return CGPDFDictionaryGetNumber(dict, key, &real) ? Int(real) : nil
    }

    static func number(_ array: CGPDFArrayRef, _ index: Int) -> Double? {
        var real: CGPDFReal = 0
        return CGPDFArrayGetNumber(array, index, &real) ? Double(real) : nil
    }

    static func text(_ dict: CGPDFDictionaryRef, _ key: String) -> String? {
        var value: CGPDFStringRef?
        guard CGPDFDictionaryGetString(dict, key, &value), let value else { return nil }
        return CGPDFStringCopyTextString(value) as String?
    }

    static func text(_ array: CGPDFArrayRef, _ index: Int) -> String? {
        var value: CGPDFStringRef?
        guard CGPDFArrayGetString(array, index, &value), let value else { return nil }
        return CGPDFStringCopyTextString(value) as String?
    }

    static func bytes(_ dict: CGPDFDictionaryRef, _ key: String) -> Data? {
        var value: CGPDFStringRef?
        guard CGPDFDictionaryGetString(dict, key, &value), let value, let pointer = CGPDFStringGetBytePtr(value) else { return nil }
        return Data(bytes: pointer, count: CGPDFStringGetLength(value))
    }

    static func date(_ dict: CGPDFDictionaryRef, _ key: String) -> Date? {
        var value: CGPDFStringRef?
        guard CGPDFDictionaryGetString(dict, key, &value), let value else { return nil }
        return CGPDFStringCopyDate(value) as Date?
    }

    /// Visits every leaf `(key, value)` of a name tree (`/Names` pairs, recursing into `/Kids`).
    static func walkNameTree(_ node: CGPDFDictionaryRef, depth: Int = 0, _ visit: (String, CGPDFObjectRef) -> Void) {
        guard depth < 32 else { return }
        if let names = array(node, "Names") {
            var index = 0
            let count = CGPDFArrayGetCount(names)
            while index + 1 < count {
                var object: CGPDFObjectRef?
                if let key = text(names, index), CGPDFArrayGetObject(names, index + 1, &object), let object {
                    visit(key, object)
                }
                index += 2
            }
        }
        if let kids = array(node, "Kids") {
            for index in 0..<CGPDFArrayGetCount(kids) {
                if let kid = dictionary(kids, index) { walkNameTree(kid, depth: depth + 1, visit) }
            }
        }
    }
}
