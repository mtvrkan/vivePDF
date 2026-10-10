import CoreGraphics
import CryptoKit
import Foundation
import PDFKit

/// A signature form field and what its value says (desktop `SignatureInfo`, reduced to what can be read
/// and checked on device).
struct SignatureFieldInfo: Identifiable, Hashable, Sendable {
    enum Integrity: String, Sendable {
        /// The digest of the signed byte ranges matches the CMS `messageDigest` attribute.
        case intact
        /// The digest does not match, or the byte ranges are malformed.
        case broken
        /// Could not be checked (unknown digest, encrypted file, unreadable signature container).
        case unknown
    }

    /// Desktop `coverageLevels`: whole file, or only the revision it signed (content added later).
    enum Coverage: String, Sendable {
        case entireFile = "ENTIRE_FILE"
        case entireRevision = "ENTIRE_REVISION"
        case unknown = "UNKNOWN"
    }

    var id: String { fieldName }
    let fieldName: String
    let isSigned: Bool
    let isTimestamp: Bool
    let signer: String?
    let signedAt: Date?
    let reason: String?
    let location: String?
    let contactInfo: String?
    let subFilter: String?
    let pageIndex: Int?
    /// Certifying (DocMDP) signature and its permission level 1…3.
    let certified: Bool
    let permission: Int?
    var integrity: Integrity = .unknown
    var coverage: Coverage = .unknown
}

enum SignaturesSummary: String, Sendable {
    case valid, attention, invalid
    var messageKey: String { "viewer.messages.signatures.\(rawValue)" }
}

/// Lists signature fields with Core Graphics and checks their integrity against the file bytes:
/// the SHA digest over `/ByteRange` must equal the `messageDigest` signed attribute of the CMS container.
/// Certificate trust is not evaluated on device (no CMS verifier on iOS), so a signature is at best
/// "needs attention" — the same verdict the desktop gives to untrusted certificates.
enum SignatureInspector {
    static func fields(in pdf: PDFDocument) -> [SignatureFieldInfo] {
        guard let document = pdf.documentRef else { return [] }
        return fields(in: document, fileData: nil)
    }

    /// Fields plus integrity, reading the bytes of the saved file.
    static func verifiedFields(in pdf: PDFDocument, fileURL: URL) -> [SignatureFieldInfo] {
        guard let document = pdf.documentRef else { return [] }
        let data = pdf.isEncrypted ? nil : (try? Data(contentsOf: fileURL, options: .mappedIfSafe))
        return fields(in: document, fileData: data)
    }

    static func fields(in document: CGPDFDocument, fileData: Data?) -> [SignatureFieldInfo] {
        guard let catalog = document.catalog,
              let form = ViewerCGPDF.dictionary(catalog, "AcroForm"),
              let roots = ViewerCGPDF.array(form, "Fields") else { return [] }
        let certifying = ViewerCGPDF.dictionary(catalog, "Perms").flatMap { ViewerCGPDF.dictionary($0, "DocMDP") }
        let pages = pageIndex(of: document)
        var result: [SignatureFieldInfo] = []

        func visit(_ field: CGPDFDictionaryRef, parentName: String?, inheritedType: String?, depth: Int) {
            guard depth < 32 else { return }
            let partial = ViewerCGPDF.text(field, "T")
            let fullName = [parentName, partial].compactMap { $0 }.joined(separator: ".")
            let type = ViewerCGPDF.name(field, "FT") ?? inheritedType
            if let kids = ViewerCGPDF.array(field, "Kids") {
                var hasFieldKids = false
                for index in 0..<CGPDFArrayGetCount(kids) {
                    guard let kid = ViewerCGPDF.dictionary(kids, index) else { continue }
                    if ViewerCGPDF.text(kid, "T") != nil { hasFieldKids = true; visit(kid, parentName: fullName.isEmpty ? nil : fullName, inheritedType: type, depth: depth + 1) }
                }
                if hasFieldKids { return }
            }
            guard type == "Sig" else { return }
            var widgetPage = pages[field]
            if widgetPage == nil, let kids = ViewerCGPDF.array(field, "Kids") {
                for index in 0..<CGPDFArrayGetCount(kids) {
                    if let kid = ViewerCGPDF.dictionary(kids, index), let page = pages[kid] { widgetPage = page; break }
                }
            }
            let value = ViewerCGPDF.dictionary(field, "V")
            var info = SignatureFieldInfo(
                fieldName: fullName.isEmpty ? "Signature\(result.count + 1)" : fullName,
                isSigned: value != nil,
                isTimestamp: value.flatMap { ViewerCGPDF.name($0, "Type") } == "DocTimeStamp",
                signer: value.flatMap { ViewerCGPDF.text($0, "Name") },
                signedAt: value.flatMap { ViewerCGPDF.date($0, "M") },
                reason: value.flatMap { ViewerCGPDF.text($0, "Reason") },
                location: value.flatMap { ViewerCGPDF.text($0, "Location") },
                contactInfo: value.flatMap { ViewerCGPDF.text($0, "ContactInfo") },
                subFilter: value.flatMap { ViewerCGPDF.name($0, "SubFilter") },
                pageIndex: widgetPage,
                certified: value != nil && value == certifying,
                permission: value.flatMap(permissionLevel))
            if let value, let fileData {
                let check = verify(value: value, file: fileData)
                info.integrity = check.integrity
                info.coverage = check.coverage
            }
            result.append(info)
        }
        for index in 0..<CGPDFArrayGetCount(roots) {
            if let field = ViewerCGPDF.dictionary(roots, index) { visit(field, parentName: nil, inheritedType: nil, depth: 0) }
        }
        return result
    }

    /// Banner verdict for the signed fields (nil when the document carries no signature).
    static func status(of fields: [SignatureFieldInfo]) -> SignaturesSummary? {
        let signed = fields.filter(\.isSigned)
        guard !signed.isEmpty else { return nil }
        if signed.contains(where: { $0.integrity == .broken }) { return .invalid }
        // Trust can't be established on device, so intact signatures still need the reader's attention.
        return .attention
    }

    // MARK: - Integrity

    static func verify(value: CGPDFDictionaryRef, file: Data) -> (integrity: SignatureFieldInfo.Integrity, coverage: SignatureFieldInfo.Coverage) {
        guard let rangeArray = ViewerCGPDF.array(value, "ByteRange"),
              let contents = ViewerCGPDF.bytes(value, "Contents") else { return (.unknown, .unknown) }
        let numbers = (0..<CGPDFArrayGetCount(rangeArray)).compactMap { ViewerCGPDF.number(rangeArray, $0) }.map { Int($0) }
        return verify(byteRange: numbers, contents: contents, file: file)
    }

    static func verify(byteRange numbers: [Int], contents: Data, file: Data) -> (integrity: SignatureFieldInfo.Integrity, coverage: SignatureFieldInfo.Coverage) {
        guard numbers.count >= 4, numbers.count % 2 == 0 else { return (.broken, .unknown) }
        var signed = Data()
        var end = 0
        var index = 0
        while index < numbers.count {
            let start = numbers[index], length = numbers[index + 1]
            guard start >= 0, length >= 0, start + length <= file.count else { return (.broken, .unknown) }
            signed.append(file.subdata(in: start..<(start + length)))
            end = max(end, start + length)
            index += 2
        }
        let coverage: SignatureFieldInfo.Coverage = numbers[0] == 0 && end == trimmedLength(file) ? .entireFile : .entireRevision
        guard let expected = messageDigest(in: contents) else { return (.unknown, coverage) }
        let actual: Data
        switch expected.count {
        case 20: actual = Data(Insecure.SHA1.hash(data: signed))
        case 32: actual = Data(SHA256.hash(data: signed))
        case 48: actual = Data(SHA384.hash(data: signed))
        case 64: actual = Data(SHA512.hash(data: signed))
        default: return (.unknown, coverage)
        }
        return (actual == expected ? .intact : .broken, coverage)
    }

    /// File length without trailing whitespace (some writers append a newline after `%%EOF`).
    private static func trimmedLength(_ file: Data) -> Int {
        var count = file.count
        while count > 0, [0x0A, 0x0D, 0x20, 0x00].contains(file[file.startIndex + count - 1]) { count -= 1 }
        return count
    }

    /// Finds the `messageDigest` signed attribute (OID 1.2.840.113549.1.9.4) in a DER CMS container:
    /// `SEQUENCE { OID, SET { OCTET STRING digest } }`.
    static func messageDigest(in cms: Data) -> Data? {
        let oid: [UInt8] = [0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x04]
        let bytes = [UInt8](cms)
        guard bytes.count > oid.count + 4 else { return nil }
        var position = 0
        while position + oid.count < bytes.count {
            if bytes[position] == oid[0], Array(bytes[position..<(position + oid.count)]) == oid {
                var cursor = position + oid.count
                guard cursor < bytes.count, bytes[cursor] == 0x31, let setLength = derLength(bytes, &cursor), setLength > 0 else { return nil }
                guard cursor < bytes.count, bytes[cursor] == 0x04, let length = derLength(bytes, &cursor),
                      cursor + length <= bytes.count else { return nil }
                return Data(bytes[cursor..<(cursor + length)])
            }
            position += 1
        }
        return nil
    }

    /// Reads a DER length after the tag at `cursor`; leaves `cursor` on the first content byte.
    private static func derLength(_ bytes: [UInt8], _ cursor: inout Int) -> Int? {
        cursor += 1
        guard cursor < bytes.count else { return nil }
        let first = bytes[cursor]
        cursor += 1
        if first & 0x80 == 0 { return Int(first) }
        let count = Int(first & 0x7F)
        guard count > 0, count <= 4, cursor + count <= bytes.count else { return nil }
        var value = 0
        for _ in 0..<count { value = (value << 8) | Int(bytes[cursor]); cursor += 1 }
        return value
    }

    // MARK: - Helpers

    private static func permissionLevel(_ value: CGPDFDictionaryRef) -> Int? {
        guard let references = ViewerCGPDF.array(value, "Reference") else { return nil }
        for index in 0..<CGPDFArrayGetCount(references) {
            guard let reference = ViewerCGPDF.dictionary(references, index),
                  ViewerCGPDF.name(reference, "TransformMethod") == "DocMDP" else { continue }
            return ViewerCGPDF.dictionary(reference, "TransformParams").flatMap { ViewerCGPDF.integer($0, "P") } ?? 2
        }
        return nil
    }

    /// Widget dictionary → zero-based page index, from every page's `/Annots`.
    private static func pageIndex(of document: CGPDFDocument) -> [CGPDFDictionaryRef: Int] {
        var map: [CGPDFDictionaryRef: Int] = [:]
        guard document.numberOfPages > 0 else { return map }
        for number in 1...document.numberOfPages {
            guard let page = document.page(at: number)?.dictionary, let annots = ViewerCGPDF.array(page, "Annots") else { continue }
            for index in 0..<CGPDFArrayGetCount(annots) {
                if let annot = ViewerCGPDF.dictionary(annots, index), ViewerCGPDF.name(annot, "Subtype") == "Widget" { map[annot] = number - 1 }
            }
        }
        return map
    }
}
