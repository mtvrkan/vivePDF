import CoreGraphics
import Foundation

// PDF object model ("COS", the classic name for the PDF object layer). Value types throughout: copying a
// dictionary or stream is cheap (copy-on-write) and mutations never leak into the document until written
// back with `CosDocument.update(_:_:)`. Types are prefixed `Cos` so they never shadow PDFKit names.

/// Indirect object reference `num gen R`.
struct CosRef: Hashable, Comparable, CustomStringConvertible, Sendable {
    var num: Int
    var gen: Int

    init(_ num: Int, _ gen: Int = 0) {
        self.num = num
        self.gen = gen
    }

    var description: String { "\(num) \(gen) R" }
    static func < (a: CosRef, b: CosRef) -> Bool { a.num == b.num ? a.gen < b.gen : a.num < b.num }
}

/// A PDF string: raw bytes plus whether it was written in hex form (`<…>`) so round trips keep the style.
struct CosString: Hashable, CustomStringConvertible, Sendable {
    var bytes: [UInt8]
    var isHex: Bool

    init(bytes: [UInt8], isHex: Bool = false) {
        self.bytes = bytes
        self.isHex = isHex
    }

    init<S: Sequence>(_ bytes: S, isHex: Bool = false) where S.Element == UInt8 {
        self.init(bytes: Array(bytes), isHex: isHex)
    }

    /// Encodes a *text string*: PDFDocEncoding when every character fits, otherwise UTF-16BE with BOM.
    init(text: String) {
        if let pdfDoc = PDFDocEncoding.encode(text) {
            self.init(bytes: pdfDoc)
        } else {
            var out: [UInt8] = [0xFE, 0xFF]
            for unit in text.utf16 { out.append(UInt8(unit >> 8)); out.append(UInt8(unit & 0xFF)) }
            self.init(bytes: out)
        }
    }

    /// Decodes as a *text string* (UTF-16BE/LE with BOM, UTF-8 with BOM, otherwise PDFDocEncoding).
    var text: String { PDFDocEncoding.decodeTextString(bytes) }

    /// Raw bytes as Data (e.g. signature `/Contents`, `/ID`).
    var data: Data { Data(bytes) }

    var description: String { isHex ? "<\(bytes.map { String(format: "%02X", $0) }.joined())>" : "(\(text))" }
}

/// Ordered dictionary with String keys (PDF names). Keeps insertion order so written output is stable.
struct CosDict: Hashable, Sequence, ExpressibleByDictionaryLiteral, CustomStringConvertible {
    private(set) var keys: [String] = []
    private var storage: [String: CosObject] = [:]

    init() {}

    init(dictionaryLiteral elements: (String, CosObject)...) {
        for (key, value) in elements { self[key] = value }
    }

    init<S: Sequence>(_ pairs: S) where S.Element == (String, CosObject) {
        for (key, value) in pairs { self[key] = value }
    }

    var count: Int { keys.count }
    var isEmpty: Bool { keys.isEmpty }

    /// Setting `nil` removes the key. Setting `.null` also removes it (a null value means "absent" in PDF).
    subscript(key: String) -> CosObject? {
        get { storage[key] }
        set {
            if let newValue, newValue != .null {
                if storage.updateValue(newValue, forKey: key) == nil { keys.append(key) }
            } else if storage.removeValue(forKey: key) != nil {
                keys.removeAll { $0 == key }
            }
        }
    }

    func contains(_ key: String) -> Bool { storage[key] != nil }

    @discardableResult
    mutating func removeValue(forKey key: String) -> CosObject? {
        let old = storage[key]
        self[key] = nil
        return old
    }

    func makeIterator() -> AnyIterator<(key: String, value: CosObject)> {
        var index = 0
        let keys = self.keys, storage = self.storage
        return AnyIterator {
            guard index < keys.count else { return nil }
            defer { index += 1 }
            return (keys[index], storage[keys[index]]!)
        }
    }

    // Direct (unresolved) typed accessors. Use `CosDocument.resolve` to follow references.
    func name(_ key: String) -> String? { storage[key]?.name }
    func int(_ key: String) -> Int? { storage[key]?.int }
    func number(_ key: String) -> Double? { storage[key]?.number }
    func bool(_ key: String) -> Bool? { storage[key]?.bool }
    func array(_ key: String) -> [CosObject]? { storage[key]?.array }
    func dict(_ key: String) -> CosDict? { storage[key]?.dict }
    func ref(_ key: String) -> CosRef? { storage[key]?.ref }
    func string(_ key: String) -> CosString? { storage[key]?.string }
    func text(_ key: String) -> String? { storage[key]?.text }

    /// `/Type` shortcut.
    var type: String? { name("Type") }

    static func == (a: CosDict, b: CosDict) -> Bool { a.storage == b.storage }
    func hash(into hasher: inout Hasher) { hasher.combine(storage) }

    var description: String { String(decoding: CosSerializer.serialize(.dict(self)), as: UTF8.self) }
}

/// A stream: dictionary plus the payload as stored in the file (after decryption, still filter-encoded).
/// Decoding is lazy — call `decoded()` when the content is needed.
struct CosStream: Hashable {
    var dict: CosDict
    /// Encoded bytes (what goes between `stream` and `endstream`). `/Length` is set by the writer.
    var rawData: Data

    init(dict: CosDict = CosDict(), rawData: Data) {
        self.dict = dict
        self.rawData = rawData
    }

    /// Builds a stream from *decoded* bytes, Flate-compressing when `compress` is true (and it helps).
    init(dict: CosDict = CosDict(), decoded data: Data, compress: Bool = true) {
        self.dict = dict
        self.rawData = data
        setDecodedData(data, compress: compress)
    }

    /// Filter names in order (`/Filter` may be a name or an array).
    var filters: [String] {
        switch dict["Filter"] {
        case .name(let n)?: return [n]
        case .array(let a)?: return a.compactMap { $0.name }
        default: return []
        }
    }

    /// `/DecodeParms` aligned with `filters` (nil entries where absent).
    var decodeParms: [CosDict?] {
        let count = filters.count
        switch dict["DecodeParms"] ?? dict["DP"] {
        case .dict(let d)?: return [d] + Array(repeating: nil, count: max(0, count - 1))
        case .array(let a)?: return (0..<count).map { $0 < a.count ? a[$0].dict : nil }
        default: return Array(repeating: nil, count: count)
        }
    }

    /// Fully decoded payload. Throws `CosError.unsupportedFilter` for image codecs (DCT, JPX, JBIG2, CCITT)
    /// — use `decoded(stoppingAtImageFilters:)` to get the codec bytes instead.
    func decoded() throws -> Data {
        let result = try CosFilters.decode(rawData, filters: filters, parms: decodeParms, stopAtImageFilter: false)
        return result.data
    }

    /// Decodes until the first image codec filter and returns its bytes plus the remaining filter
    /// (e.g. `("DCTDecode", parms)`) — for a JPEG this is the plain .jpg file.
    func decoded(stoppingAtImageFilters: Bool) throws -> CosFilters.PartialDecode {
        try CosFilters.decode(rawData, filters: filters, parms: decodeParms, stopAtImageFilter: stoppingAtImageFilters)
    }

    /// Replaces the payload with `data` (decoded bytes). Removes old filters/params; Flate-compresses if asked.
    mutating func setDecodedData(_ data: Data, compress: Bool = true) {
        dict["Filter"] = nil
        dict["DecodeParms"] = nil
        dict["DP"] = nil
        dict["DL"] = nil
        if compress, data.count > 32 {
            let packed = CosFilters.flateEncode(data)
            if packed.count < data.count {
                rawData = packed
                dict["Filter"] = .name("FlateDecode")
                dict["Length"] = .int(packed.count)
                return
            }
        }
        rawData = data
        dict["Length"] = .int(data.count)
    }

    /// Replaces the payload with already-encoded bytes and the given filter chain.
    mutating func setEncodedData(_ data: Data, filter: String?, decodeParms: CosDict? = nil) {
        rawData = data
        dict["Filter"] = filter.map { .name($0) }
        dict["DecodeParms"] = decodeParms.map { .dict($0) }
        dict["DP"] = nil
        dict["DL"] = nil
        dict["Length"] = .int(data.count)
    }
}

/// Any PDF object. Literal conveniences: integers, floats, booleans, arrays and dictionary literals build the
/// matching case, and **string literals build names** (`"Page"` → `/Page`); use `.text("…")` for text strings.
enum CosObject: Hashable, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral,
                ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, CustomStringConvertible {
    case null
    case bool(Bool)
    case int(Int)
    case real(Double)
    case string(CosString)
    case name(String)
    case array([CosObject])
    case dict(CosDict)
    case stream(CosStream)
    case ref(CosRef)

    init(integerLiteral value: Int) { self = .int(value) }
    init(floatLiteral value: Double) { self = .real(value) }
    init(booleanLiteral value: Bool) { self = .bool(value) }
    init(stringLiteral value: String) { self = .name(value) }
    init(arrayLiteral elements: CosObject...) { self = .array(elements) }
    init(dictionaryLiteral elements: (String, CosObject)...) { self = .dict(CosDict(elements)) }

    /// Text string (PDFDocEncoding or UTF-16BE as needed).
    static func text(_ value: String) -> CosObject { .string(CosString(text: value)) }
    /// Byte string, optionally hex-formatted.
    static func bytes(_ value: Data, hex: Bool = true) -> CosObject { .string(CosString(value, isHex: hex)) }
    /// Number that is written as an integer when integral.
    static func number(_ value: Double) -> CosObject {
        value.rounded() == value && abs(value) < 1e15 ? .int(Int(value)) : .real(value)
    }
    static func rect(_ r: CGRect) -> CosObject {
        [.number(r.minX), .number(r.minY), .number(r.maxX), .number(r.maxY)]
    }

    var isNull: Bool { if case .null = self { return true }; return false }
    var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
    /// Integer value; reals are truncated (PDF writers frequently emit `612.0` where ints are expected).
    var int: Int? {
        switch self {
        case .int(let i): return i
        case .real(let r) where r.isFinite && abs(r) < 9e18: return Int(r)
        default: return nil
        }
    }
    var number: Double? {
        switch self {
        case .int(let i): return Double(i)
        case .real(let r): return r
        default: return nil
        }
    }
    var string: CosString? { if case .string(let s) = self { return s }; return nil }
    /// Decoded text string.
    var text: String? { string?.text }
    var name: String? { if case .name(let n) = self { return n }; return nil }
    var array: [CosObject]? { if case .array(let a) = self { return a }; return nil }
    /// The dictionary of a dict *or* a stream.
    var dict: CosDict? {
        switch self {
        case .dict(let d): return d
        case .stream(let s): return s.dict
        default: return nil
        }
    }
    var stream: CosStream? { if case .stream(let s) = self { return s }; return nil }
    var ref: CosRef? { if case .ref(let r) = self { return r }; return nil }

    /// Rectangle from a 4-number array, normalised (`[x1 y1 x2 y2]` in any corner order).
    var rect: CGRect? {
        guard let a = array, a.count >= 4 else { return nil }
        let n = a.prefix(4).compactMap { $0.number }
        guard n.count == 4 else { return nil }
        return CGRect(x: min(n[0], n[2]), y: min(n[1], n[3]), width: abs(n[2] - n[0]), height: abs(n[3] - n[1]))
    }

    /// Dictionary/stream value lookup without resolving references.
    subscript(key: String) -> CosObject? { dict?[key] }
    /// Array element lookup (nil when out of range).
    subscript(index: Int) -> CosObject? {
        guard let a = array, index >= 0, index < a.count else { return nil }
        return a[index]
    }

    var description: String {
        if case .stream(let s) = self { return "\(s.dict) stream(\(s.rawData.count) bytes)" }
        return String(decoding: CosSerializer.serialize(self), as: UTF8.self)
    }
}

/// Errors thrown by the PDFCore layer. Map to `EngineError` at the engine boundary with `engineError`.
enum CosError: Error, Equatable, CustomStringConvertible {
    case notAPDF
    case malformed(String)
    case passwordRequired
    case invalidPassword
    case unsupportedEncryption(String)
    case unsupportedFilter(String)
    case decodeFailed(String)
    case missingObject(CosRef)
    case invalidArgument(String)
    case writeFailed(String)

    var description: String {
        switch self {
        case .notAPDF: return "not a PDF file"
        case .malformed(let s): return "malformed PDF: \(s)"
        case .passwordRequired: return "password required"
        case .invalidPassword: return "invalid password"
        case .unsupportedEncryption(let s): return "unsupported encryption: \(s)"
        case .unsupportedFilter(let s): return "unsupported filter: \(s)"
        case .decodeFailed(let s): return "decode failed: \(s)"
        case .missingObject(let r): return "missing object \(r)"
        case .invalidArgument(let s): return "invalid argument: \(s)"
        case .writeFailed(let s): return "write failed: \(s)"
        }
    }

    /// Equivalent shared engine error (localised in the UI).
    var engineError: EngineError {
        switch self {
        case .notAPDF, .malformed, .missingObject: return EngineError(.INVALID_PDF, detail: description)
        case .passwordRequired: return EngineError(.NEEDS_PASSWORD)
        case .invalidPassword: return EngineError(.NEEDS_PASSWORD, detail: description)
        case .unsupportedEncryption: return EngineError(.ENCRYPTED, detail: description)
        case .unsupportedFilter, .decodeFailed: return EngineError(.UNSUPPORTED, detail: description)
        case .invalidArgument: return EngineError(.INVALID_PARAMS, detail: description)
        case .writeFailed: return EngineError(.INTERNAL, detail: description)
        }
    }
}

// MARK: - Names

/// Name byte ⇄ String mapping. Names are byte sequences; valid UTF-8 decodes normally, any other byte is
/// mapped to the private-use scalar U+F700+byte so that writing restores the exact original bytes.
enum CosName {
    static func decode<C: Collection>(_ bytes: C) -> String where C.Element == UInt8 {
        var ascii = true
        for b in bytes where b >= 0x80 { ascii = false; break }
        if ascii { return String(decoding: bytes, as: UTF8.self) }
        if let s = String(bytes: Array(bytes), encoding: .utf8) { return s }
        var scalars = String.UnicodeScalarView()
        for b in bytes {
            scalars.append(b < 0x80 ? Unicode.Scalar(b) : Unicode.Scalar(0xF700 + UInt32(b))!)
        }
        return String(scalars)
    }

    static func encode(_ name: String) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(name.utf8.count)
        for scalar in name.unicodeScalars {
            if scalar.value >= 0xF780 && scalar.value <= 0xF7FF {
                out.append(UInt8(scalar.value - 0xF700))
            } else {
                out.append(contentsOf: Array(String(scalar).utf8))
            }
        }
        return out
    }
}

// MARK: - PDFDocEncoding

enum PDFDocEncoding {
    // 0x18–0x1F, 0x80–0xA0 and 0xAD differ from Latin-1.
    private static let high: [UInt8: UInt16] = [
        0x18: 0x02D8, 0x19: 0x02C7, 0x1A: 0x02C6, 0x1B: 0x02D9, 0x1C: 0x02DD, 0x1D: 0x02DB, 0x1E: 0x02DA, 0x1F: 0x02DC,
        0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026, 0x84: 0x2014, 0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044,
        0x88: 0x2039, 0x89: 0x203A, 0x8A: 0x2212, 0x8B: 0x2030, 0x8C: 0x201E, 0x8D: 0x201C, 0x8E: 0x201D, 0x8F: 0x2018,
        0x90: 0x2019, 0x91: 0x201A, 0x92: 0x2122, 0x93: 0xFB01, 0x94: 0xFB02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160,
        0x98: 0x0178, 0x99: 0x017D, 0x9A: 0x0131, 0x9B: 0x0142, 0x9C: 0x0153, 0x9D: 0x0161, 0x9E: 0x017E, 0xA0: 0x20AC,
    ]
    private static let reverse: [UInt16: UInt8] = Dictionary(uniqueKeysWithValues: high.map { ($0.value, $0.key) })

    /// Unicode scalar for a PDFDocEncoding byte (undefined bytes map to themselves).
    static func scalar(_ byte: UInt8) -> UInt16 { high[byte] ?? UInt16(byte) }

    static func decode<C: Collection>(_ bytes: C) -> String where C.Element == UInt8 {
        var s = String.UnicodeScalarView()
        for b in bytes { s.append(Unicode.Scalar(scalar(b)) ?? "\u{FFFD}") }
        return String(s)
    }

    /// nil when some character is not representable.
    static func encode(_ text: String) -> [UInt8]? {
        var out: [UInt8] = []
        out.reserveCapacity(text.unicodeScalars.count)
        for scalar in text.unicodeScalars {
            let v = scalar.value
            if v < 0x18 || (v >= 0x20 && v < 0x7F) || (v >= 0xA1 && v <= 0xFF && v != 0xAD) {
                out.append(UInt8(v))
            } else if v <= 0xFFFF, let b = reverse[UInt16(v)] {
                out.append(b)
            } else {
                return nil
            }
        }
        return out
    }

    static func decodeTextString(_ b: [UInt8]) -> String {
        if b.count >= 2, b[0] == 0xFE, b[1] == 0xFF { return utf16(b.dropFirst(2), bigEndian: true) }
        if b.count >= 2, b[0] == 0xFF, b[1] == 0xFE { return utf16(b.dropFirst(2), bigEndian: false) }
        if b.count >= 3, b[0] == 0xEF, b[1] == 0xBB, b[2] == 0xBF { return String(decoding: b.dropFirst(3), as: UTF8.self) }
        return decode(b)
    }

    static func utf16<C: Collection>(_ bytes: C, bigEndian: Bool) -> String where C.Element == UInt8 {
        var units: [UInt16] = []
        units.reserveCapacity(bytes.count / 2)
        var it = bytes.makeIterator()
        while let a = it.next() {
            let b = it.next() ?? 0
            units.append(bigEndian ? UInt16(a) << 8 | UInt16(b) : UInt16(b) << 8 | UInt16(a))
        }
        // Strip embedded language escape sequences (U+001B … U+001B).
        if units.contains(0x1B) {
            var cleaned: [UInt16] = []
            var inEscape = false
            for u in units {
                if u == 0x1B { inEscape.toggle(); continue }
                if !inEscape { cleaned.append(u) }
            }
            units = cleaned
        }
        return String(decoding: units, as: UTF16.self)
    }
}
