import CoreGraphics
import Foundation
import PDFKit

/// A PDF object value, detached from any file. Used to read annotation dictionaries out of the in-memory
/// document (through Core Graphics' `CGPDF*`), to write FDF files and to parse them back.
indirect enum CommentPDFValue: Equatable {
    case null
    case bool(Bool)
    case int(Int)
    case real(Double)
    case name(String)
    case string(Data)
    case array([CommentPDFValue])
    case dict([String: CommentPDFValue])
    /// `filtered` = `data` is already decoded (no /Filter applies).
    case stream([String: CommentPDFValue], Data, filtered: Bool)
    /// Indirect reference (only in parsed FDF files and in written output).
    case ref(Int)

    var number: Double? {
        switch self {
        case .int(let value): Double(value)
        case .real(let value): value
        default: nil
        }
    }

    var numbers: [Double]? {
        guard case .array(let items) = self else { return nil }
        let values = items.compactMap(\.number)
        return values.count == items.count ? values : nil
    }

    var text: String? {
        guard case .string(let data) = self else { return nil }
        return CommentPDFValue.decodeText(data)
    }

    var nameValue: String? {
        if case .name(let value) = self { return value }
        return nil
    }

    var dictionary: [String: CommentPDFValue]? {
        if case .dict(let value) = self { return value }
        return nil
    }

    static func text(_ string: String) -> CommentPDFValue { .string(encodeText(string)) }

    /// PDF text strings: UTF-16BE with BOM, or PDFDocEncoding (≈ Latin-1 for printable text).
    static func decodeText(_ data: Data) -> String {
        if data.count >= 2, data[data.startIndex] == 0xFE, data[data.startIndex + 1] == 0xFF {
            return String(data: data.dropFirst(2), encoding: .utf16BigEndian) ?? ""
        }
        if data.count >= 3, data.starts(with: [0xEF, 0xBB, 0xBF]) {
            return String(data: data.dropFirst(3), encoding: .utf8) ?? ""
        }
        return String(data: data, encoding: .isoLatin1) ?? ""
    }

    static func encodeText(_ string: String) -> Data {
        if string.unicodeScalars.allSatisfy({ $0.value < 128 }) { return Data(string.utf8) }
        var data = Data([0xFE, 0xFF])
        data.append(string.data(using: .utf16BigEndian) ?? Data())
        return data
    }
}

// MARK: - Reading Core Graphics objects

/// Converts `CGPDF` objects into `CommentPDFValue`, guarding against cycles and huge graphs.
struct CommentCGReader {
    /// Keys never copied out of an annotation (page links, parents, actions…), as in the desktop sidecar.
    static let droppedKeys: Set<String> = ["P", "Page", "Popup", "Parent", "IRT", "A", "AA", "StructParent", "OC"]
    static let maxObjects = 4000

    private var budget = CommentCGReader.maxObjects
    private var path: Set<UnsafeRawPointer> = []

    mutating func value(_ object: CGPDFObjectRef) -> CommentPDFValue? {
        budget -= 1
        guard budget >= 0 else { return nil }
        switch CGPDFObjectGetType(object) {
        case .null: return .null
        case .boolean:
            var value: CGPDFBoolean = 0
            return CGPDFObjectGetValue(object, .boolean, &value) ? .bool(value != 0) : nil
        case .integer:
            var value: CGPDFInteger = 0
            return CGPDFObjectGetValue(object, .integer, &value) ? .int(value) : nil
        case .real:
            var value: CGPDFReal = 0
            return CGPDFObjectGetValue(object, .real, &value) ? .real(Double(value)) : nil
        case .name:
            var pointer: UnsafePointer<CChar>?
            guard CGPDFObjectGetValue(object, .name, &pointer), let pointer else { return nil }
            return .name(String(cString: pointer))
        case .string:
            var string: CGPDFStringRef?
            guard CGPDFObjectGetValue(object, .string, &string), let string else { return nil }
            return .string(Self.data(of: string))
        case .array:
            var array: CGPDFArrayRef?
            guard CGPDFObjectGetValue(object, .array, &array), let array else { return nil }
            return self.array(array)
        case .dictionary:
            var dict: CGPDFDictionaryRef?
            guard CGPDFObjectGetValue(object, .dictionary, &dict), let dict else { return nil }
            return dictionary(dict)
        case .stream:
            var stream: CGPDFStreamRef?
            guard CGPDFObjectGetValue(object, .stream, &stream), let stream else { return nil }
            return self.stream(stream)
        @unknown default: return nil
        }
    }

    mutating func array(_ array: CGPDFArrayRef) -> CommentPDFValue {
        var items: [CommentPDFValue] = []
        for index in 0..<CGPDFArrayGetCount(array) {
            var object: CGPDFObjectRef?
            if CGPDFArrayGetObject(array, index, &object), let object { items.append(value(object) ?? .null) }
        }
        return .array(items)
    }

    /// Reads a dictionary. Pages (`/Type /Page`) and dictionaries already on the path become `null`.
    mutating func dictionary(_ dict: CGPDFDictionaryRef, dropping dropped: Set<String> = []) -> CommentPDFValue {
        let key = unsafeBitCast(dict, to: UnsafeRawPointer.self)
        if path.contains(key) || Self.isPage(dict) { return .null }
        path.insert(key)
        defer { path.remove(key) }
        var entries: [String: CommentPDFValue] = [:]
        for (name, object) in Self.entries(of: dict) where !dropped.contains(name) && !name.hasPrefix("AAPL:") {
            if let converted = value(object) { entries[name] = converted }
        }
        return .dict(entries)
    }

    mutating func stream(_ stream: CGPDFStreamRef) -> CommentPDFValue? {
        guard let dict = CGPDFStreamGetDictionary(stream), case .dict(var entries) = dictionary(dict) else { return nil }
        var format = CGPDFDataFormat.raw
        guard let data = CGPDFStreamCopyData(stream, &format) as Data? else { return nil }
        if format == .raw {
            // Core Graphics hands out decoded bytes: the filters no longer apply.
            entries.removeValue(forKey: "Filter")
            entries.removeValue(forKey: "DecodeParms")
            entries["Length"] = .int(data.count)
            return .stream(entries, data, filtered: true)
        }
        entries["Length"] = .int(data.count)
        return .stream(entries, data, filtered: false)
    }

    static func isPage(_ dict: CGPDFDictionaryRef) -> Bool {
        var type: UnsafePointer<CChar>?
        return CGPDFDictionaryGetName(dict, "Type", &type) && type.map { String(cString: $0) } == "Page"
    }

    static func entries(of dict: CGPDFDictionaryRef) -> [(String, CGPDFObjectRef)] {
        var result: [(String, CGPDFObjectRef)] = []
        withUnsafeMutablePointer(to: &result) { pointer in
            CGPDFDictionaryApplyBlock(dict, { key, object, info in
                info?.assumingMemoryBound(to: [(String, CGPDFObjectRef)].self).pointee.append((String(cString: key), object))
                return true
            }, pointer)
        }
        return result
    }

    static func data(of string: CGPDFStringRef) -> Data {
        guard let bytes = CGPDFStringGetBytePtr(string) else { return Data() }
        return Data(bytes: bytes, count: CGPDFStringGetLength(string))
    }

    static func string(_ dict: CGPDFDictionaryRef, _ key: String) -> String? {
        var string: CGPDFStringRef?
        guard CGPDFDictionaryGetString(dict, key, &string), let string else { return nil }
        return CommentPDFValue.decodeText(data(of: string))
    }

    static func name(_ dict: CGPDFDictionaryRef, _ key: String) -> String? {
        var name: UnsafePointer<CChar>?
        guard CGPDFDictionaryGetName(dict, key, &name), let name else { return nil }
        return String(cString: name)
    }
}

// MARK: - Writing PDF syntax

enum CommentPDFWriter {
    static func serialize(_ value: CommentPDFValue) -> Data {
        var out = Data()
        write(value, into: &out)
        return out
    }

    static func write(_ value: CommentPDFValue, into out: inout Data) {
        switch value {
        case .null: out.append(contentsOf: Array("null".utf8))
        case .bool(let flag): out.append(contentsOf: Array((flag ? "true" : "false").utf8))
        case .int(let number): out.append(contentsOf: Array(String(number).utf8))
        case .real(let number): out.append(contentsOf: Array(format(number).utf8))
        case .name(let name): out.append(contentsOf: Array(("/" + escapeName(name)).utf8))
        case .string(let data): out.append(literal(data))
        case .ref(let number): out.append(contentsOf: Array("\(number) 0 R".utf8))
        case .array(let items):
            out.append(UInt8(ascii: "["))
            for (index, item) in items.enumerated() {
                if index > 0 { out.append(UInt8(ascii: " ")) }
                write(item, into: &out)
            }
            out.append(UInt8(ascii: "]"))
        case .dict(let entries):
            writeDict(entries, into: &out)
        case .stream(let entries, let data, _):
            var dict = entries
            dict["Length"] = .int(data.count)
            writeDict(dict, into: &out)
            out.append(contentsOf: Array("\nstream\n".utf8))
            out.append(data)
            out.append(contentsOf: Array("\nendstream".utf8))
        }
    }

    private static func writeDict(_ entries: [String: CommentPDFValue], into out: inout Data) {
        out.append(contentsOf: Array("<<".utf8))
        for key in entries.keys.sorted() {
            guard let item = entries[key] else { continue }
            out.append(contentsOf: Array(" /\(escapeName(key)) ".utf8))
            write(item, into: &out)
        }
        out.append(contentsOf: Array(" >>".utf8))
    }

    /// Numbers like the sidecar's `_format`: up to four decimals, no trailing zeros.
    static func format(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        var text = String(format: "%.4f", value)
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        return text == "-0" || text.isEmpty ? "0" : text
    }

    static func escapeName(_ name: String) -> String {
        var out = ""
        for byte in name.utf8 {
            let scalar = Character(Unicode.Scalar(byte))
            if byte < 33 || byte > 126 || "#()<>[]{}/%".contains(scalar) {
                out += String(format: "#%02X", byte)
            } else {
                out.append(scalar)
            }
        }
        return out
    }

    static func literal(_ data: Data) -> Data {
        var out = Data([UInt8(ascii: "(")])
        for byte in data {
            switch byte {
            case UInt8(ascii: "("), UInt8(ascii: ")"), UInt8(ascii: "\\"):
                out.append(UInt8(ascii: "\\")); out.append(byte)
            case 10: out.append(contentsOf: Array("\\n".utf8))
            case 13: out.append(contentsOf: Array("\\r".utf8))
            default: out.append(byte)
            }
        }
        out.append(UInt8(ascii: ")"))
        return out
    }
}

// MARK: - Parsing PDF / FDF syntax

/// A small, defensive parser for the object syntax used by FDF files (`n 0 obj … endobj`, trailer).
struct CommentPDFParser {
    let bytes: [UInt8]
    var position = 0
    private var depth = 0

    init(_ data: Data) { bytes = [UInt8](data) }

    static func isWhite(_ byte: UInt8) -> Bool { byte == 0 || byte == 9 || byte == 10 || byte == 12 || byte == 13 || byte == 32 }
    static func isDelimiter(_ byte: UInt8) -> Bool { "()<>[]{}/%".utf8.contains(byte) }

    mutating func skipSpace() {
        while position < bytes.count {
            if Self.isWhite(bytes[position]) { position += 1; continue }
            if bytes[position] == UInt8(ascii: "%") {
                while position < bytes.count, bytes[position] != 10, bytes[position] != 13 { position += 1 }
                continue
            }
            break
        }
    }

    mutating func keyword() -> String? {
        skipSpace()
        let start = position
        while position < bytes.count, !Self.isWhite(bytes[position]), !Self.isDelimiter(bytes[position]) { position += 1 }
        guard position > start else { return nil }
        return String(decoding: bytes[start..<position], as: UTF8.self)
    }

    mutating func value() -> CommentPDFValue? {
        depth += 1
        defer { depth -= 1 }
        guard depth < 200 else { return nil }
        skipSpace()
        guard position < bytes.count else { return nil }
        let byte = bytes[position]
        switch byte {
        case UInt8(ascii: "/"):
            position += 1
            let start = position
            while position < bytes.count, !Self.isWhite(bytes[position]), !Self.isDelimiter(bytes[position]) { position += 1 }
            return .name(Self.unescapeName(String(decoding: bytes[start..<position], as: UTF8.self)))
        case UInt8(ascii: "("):
            return .string(literalString())
        case UInt8(ascii: "<"):
            if position + 1 < bytes.count, bytes[position + 1] == UInt8(ascii: "<") {
                position += 2
                return dictionaryOrStream()
            }
            return .string(hexString())
        case UInt8(ascii: "["):
            position += 1
            var items: [CommentPDFValue] = []
            while true {
                skipSpace()
                guard position < bytes.count else { return .array(items) }
                if bytes[position] == UInt8(ascii: "]") { position += 1; return .array(items) }
                guard let item = value() else { return nil }
                items.append(item)
            }
        default:
            guard let word = keyword() else { position += 1; return nil }
            switch word {
            case "true": return .bool(true)
            case "false": return .bool(false)
            case "null": return .null
            default:
                if let number = Int(word) {
                    // `n g R` reference?
                    let save = position
                    if let generation = keyword(), Int(generation) != nil, keyword() == "R" { return .ref(number) }
                    position = save
                    return .int(number)
                }
                if let number = Double(word) { return .real(number) }
                return nil
            }
        }
    }

    private mutating func dictionaryOrStream() -> CommentPDFValue? {
        var entries: [String: CommentPDFValue] = [:]
        while true {
            skipSpace()
            guard position < bytes.count else { return .dict(entries) }
            if bytes[position] == UInt8(ascii: ">") {
                position = min(bytes.count, position + 2)
                break
            }
            guard case .name(let key)? = value() else { return nil }
            guard let item = value() else { return nil }
            entries[key] = item
        }
        // Stream?
        let save = position
        skipSpace()
        if keyword() == "stream" {
            if position < bytes.count, bytes[position] == 13 { position += 1 }
            if position < bytes.count, bytes[position] == 10 { position += 1 }
            let start = position
            var end: Int
            if case .int(let length)? = entries["Length"], length >= 0, start + length <= bytes.count {
                end = start + length
            } else {
                end = Self.find(Array("endstream".utf8), in: bytes, from: start) ?? bytes.count
            }
            position = min(bytes.count, (Self.find(Array("endstream".utf8), in: bytes, from: end) ?? end) + 9)
            if entries["Length"] == nil {
                while end > start, bytes[end - 1] == 10 || bytes[end - 1] == 13 { end -= 1 }
            }
            let data = Data(bytes[start..<end])
            let filtered = entries["Filter"] == nil
            return .stream(entries, data, filtered: filtered)
        }
        position = save
        return .dict(entries)
    }

    private mutating func literalString() -> Data {
        position += 1
        var out = Data()
        var nesting = 1
        while position < bytes.count {
            let byte = bytes[position]
            position += 1
            if byte == UInt8(ascii: "\\"), position < bytes.count {
                let next = bytes[position]
                position += 1
                switch next {
                case UInt8(ascii: "n"): out.append(10)
                case UInt8(ascii: "r"): out.append(13)
                case UInt8(ascii: "t"): out.append(9)
                case UInt8(ascii: "b"): out.append(8)
                case UInt8(ascii: "f"): out.append(12)
                case 13: if position < bytes.count, bytes[position] == 10 { position += 1 }
                case 10: break
                case UInt8(ascii: "0")...UInt8(ascii: "7"):
                    var value = Int(next - UInt8(ascii: "0"))
                    for _ in 0..<2 where position < bytes.count && (UInt8(ascii: "0")...UInt8(ascii: "7")).contains(bytes[position]) {
                        value = value * 8 + Int(bytes[position] - UInt8(ascii: "0"))
                        position += 1
                    }
                    out.append(UInt8(value & 0xFF))
                default: out.append(next)
                }
                continue
            }
            if byte == UInt8(ascii: "(") { nesting += 1 }
            if byte == UInt8(ascii: ")") {
                nesting -= 1
                if nesting == 0 { break }
            }
            out.append(byte)
        }
        return out
    }

    private mutating func hexString() -> Data {
        position += 1
        var digits: [UInt8] = []
        while position < bytes.count, bytes[position] != UInt8(ascii: ">") {
            let byte = bytes[position]
            if let value = Self.hexValue(byte) { digits.append(value) }
            position += 1
        }
        position += 1
        if digits.count % 2 == 1 { digits.append(0) }
        return Data(stride(from: 0, to: digits.count, by: 2).map { digits[$0] << 4 | digits[$0 + 1] })
    }

    static func hexValue(_ byte: UInt8) -> UInt8? {
        switch byte {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): byte - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): byte - UInt8(ascii: "a") + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): byte - UInt8(ascii: "A") + 10
        default: nil
        }
    }

    static func unescapeName(_ name: String) -> String {
        guard name.contains("#") else { return name }
        var bytes: [UInt8] = []
        var iterator = Array(name.utf8)[...]
        while let byte = iterator.popFirst() {
            if byte == UInt8(ascii: "#"), iterator.count >= 2,
               let high = hexValue(iterator[iterator.startIndex]), let low = hexValue(iterator[iterator.startIndex + 1]) {
                bytes.append(high << 4 | low)
                iterator = iterator.dropFirst(2)
            } else {
                bytes.append(byte)
            }
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    static func find(_ needle: [UInt8], in haystack: [UInt8], from start: Int) -> Int? {
        guard !needle.isEmpty, haystack.count >= needle.count, start <= haystack.count - needle.count else { return nil }
        var index = start
        while index <= haystack.count - needle.count {
            if haystack[index] == needle[0], Array(haystack[index..<index + needle.count]) == needle { return index }
            index += 1
        }
        return nil
    }

    /// Every `n g obj … endobj` in the file plus the trailer's /Root object number.
    static func objects(in data: Data) -> (objects: [Int: CommentPDFValue], root: Int?) {
        var parser = CommentPDFParser(data)
        var objects: [Int: CommentPDFValue] = [:]
        var root: Int?
        let tokens = parser.bytes
        var index = 0
        let objKey = Array(" obj".utf8)
        while let found = find(objKey, in: tokens, from: index), objects.count < CommentCGReader.maxObjects * 50 {
            // Walk back over "n g".
            var start = found
            var fields = 0
            var cursor = found - 1
            while cursor >= 0, fields < 2 {
                while cursor >= 0, isWhite(tokens[cursor]) { cursor -= 1 }
                let end = cursor
                while cursor >= 0, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(tokens[cursor]) { cursor -= 1 }
                if end == cursor { break }
                fields += 1
                start = cursor + 1
            }
            index = found + objKey.count
            guard fields == 2, let number = Int(String(decoding: tokens[start..<(tokens[start...].firstIndex(where: isWhite) ?? start)], as: UTF8.self)) else { continue }
            parser.position = index
            if let value = parser.value() { objects[number] = value }
            index = max(index, parser.position)
        }
        if let trailer = find(Array("trailer".utf8), in: tokens, from: 0) {
            parser.position = trailer + 7
            if case .dict(let dict)? = parser.value(), case .ref(let number)? = dict["Root"] { root = number }
        }
        return (objects, root)
    }
}

// MARK: - FDF export / import

/// FDF comment exchange (Acrobat's older format; it can carry custom stamp pictures).
enum CommentFDF {
    /// Writes the given annotations (by `/NM`) to an FDF file, mirroring the sidecar's `write_fdf`.
    static func export(_ pdf: PDFDocument, names: [String], sourceName: String, to target: URL) throws -> Int {
        guard let snapshot = CommentRawSnapshot(pdf) else { throw EngineError(.INVALID_PDF) }
        let wanted = Set(names)
        let selected = snapshot.entries.filter { wanted.contains($0.name) && CommentExchange.subtypeTags[$0.subtype] != nil }
        var numbers: [String: Int] = [:]
        for (offset, entry) in selected.enumerated() { numbers[entry.name] = offset + 2 }
        var bodies: [Int: Data] = [:]
        var next = selected.count + 2

        // Streams must be indirect objects; everything else stays inline.
        func externalize(_ value: CommentPDFValue) -> CommentPDFValue {
            switch value {
            case .stream(let dict, let data, let filtered):
                let number = next
                next += 1
                let inner = dict.mapValues(externalize)
                bodies[number] = CommentPDFWriter.serialize(.stream(inner, data, filtered: filtered))
                return .ref(number)
            case .dict(let dict): return .dict(dict.mapValues(externalize))
            case .array(let items): return .array(items.map(externalize))
            default: return value
            }
        }

        var written: [Int] = []
        for entry in selected {
            guard let number = numbers[entry.name] else { continue }
            var body = entry.raw.mapValues(externalize)
            body["Type"] = .name("Annot")
            body["Page"] = .int(entry.pageIndex)
            body["NM"] = .text(entry.name)
            if let parent = entry.parentName, let parentNumber = numbers[parent] { body["IRT"] = .ref(parentNumber) }
            bodies[number] = CommentPDFWriter.serialize(.dict(body))
            written.append(number)
        }
        let catalog: CommentPDFValue = .dict(["FDF": .dict(["F": .text(sourceName), "Annots": .array(written.map { .ref($0) })])])
        bodies[1] = CommentPDFWriter.serialize(catalog)
        var out = Data("%FDF-1.2\n".utf8)
        out.append(contentsOf: [0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])
        for number in bodies.keys.sorted() {
            out.append(Data("\(number) 0 obj\n".utf8))
            out.append(bodies[number] ?? Data())
            out.append(Data("\nendobj\n".utf8))
        }
        out.append(Data("trailer\n<< /Root 1 0 R >>\n%%EOF\n".utf8))
        try out.write(to: target, options: .atomic)
        return written.count
    }

    /// Parses an FDF file into importable comment specs (references resolved, replies by object number).
    static func specs(from data: Data) throws -> (specs: [CommentSpec], skipped: Int) {
        let (objects, root) = CommentPDFParser.objects(in: data)
        func resolve(_ value: CommentPDFValue?, _ seen: Set<Int> = []) -> CommentPDFValue? {
            guard case .ref(let number)? = value else { return value }
            guard !seen.contains(number) else { return nil }
            return resolve(objects[number], seen.union([number]))
        }
        var catalog = root.flatMap { objects[$0] }?.dictionary
        if catalog?["FDF"] == nil {
            catalog = objects.keys.sorted().compactMap { objects[$0]?.dictionary }.first { $0["FDF"] != nil }
        }
        guard let fdf = resolve(catalog?["FDF"])?.dictionary else {
            throw EngineError(.INVALID_PARAMS, reason: "notFdf")
        }
        guard case .array(let annots)? = resolve(fdf["Annots"]) else { return ([], 0) }
        // Object number → annotation name, so /IRT references become names.
        var nameOf: [Int: String] = [:]
        var specs: [CommentSpec] = []
        var skipped = 0
        var pendingParents: [(Int, Int)] = []
        for (position, entry) in annots.enumerated() {
            var objectNumber: Int?
            if case .ref(let number) = entry { objectNumber = number }
            guard var body = resolve(entry)?.dictionary else { skipped += 1; continue }
            body = body.mapValues { inline($0, objects: objects, depth: 0) }
            guard var spec = CommentSpec(pdfDictionary: body) else { skipped += 1; continue }
            if spec.name.isEmpty { spec.name = "vivepdf-fdf-\(position)-\(UUID().uuidString.prefix(8))" }
            if let objectNumber { nameOf[objectNumber] = spec.name }
            if case .ref(let parent)? = body["IRT"] { pendingParents.append((specs.count, parent)) }
            specs.append(spec)
        }
        for (index, parent) in pendingParents { specs[index].inReplyTo = nameOf[parent] }
        return (specs, skipped)
    }

    private static func inline(_ value: CommentPDFValue, objects: [Int: CommentPDFValue], depth: Int) -> CommentPDFValue {
        guard depth < 40 else { return .null }
        switch value {
        case .ref(let number):
            // Keep /IRT-style refs to annotations as refs; resolve everything else (appearance streams).
            guard let target = objects[number] else { return .null }
            if let dict = target.dictionary, dict["Subtype"] != nil, dict["Rect"] != nil { return value }
            return inline(target, objects: objects, depth: depth + 1)
        case .dict(let dict): return .dict(dict.mapValues { inline($0, objects: objects, depth: depth + 1) })
        case .array(let items): return .array(items.map { inline($0, objects: objects, depth: depth + 1) })
        case .stream(let dict, let data, let filtered):
            return .stream(dict.mapValues { inline($0, objects: objects, depth: depth + 1) }, data, filtered: filtered)
        default: return value
        }
    }
}
