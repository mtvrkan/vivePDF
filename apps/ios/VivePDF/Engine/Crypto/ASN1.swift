import Foundation

/// A parsed or built ASN.1 element. Parsing accepts DER and the BER forms real-world CMS uses
/// (indefinite lengths, constructed strings); building always produces DER.
///
/// `raw` is the exact encoding (identifier + length + contents) — signatures are checked over these
/// bytes, never over a re-encoding, so non-canonical input still verifies.
struct ASN1Node: Hashable, @unchecked Sendable {
    enum TagClass: UInt8 { case universal = 0, application = 1, contextSpecific = 2, `private` = 3 }

    /// Universal tag numbers used in this module.
    enum Universal {
        static let boolean: UInt = 1, integer: UInt = 2, bitString: UInt = 3, octetString: UInt = 4, null: UInt = 5
        static let oid: UInt = 6, enumerated: UInt = 10, utf8String: UInt = 12, sequence: UInt = 16, set: UInt = 17
        static let numericString: UInt = 18, printableString: UInt = 19, t61String: UInt = 20, ia5String: UInt = 22
        static let utcTime: UInt = 23, generalizedTime: UInt = 24, visibleString: UInt = 26
        static let universalString: UInt = 28, bmpString: UInt = 30
    }

    let tagClass: TagClass
    let constructed: Bool
    let tagNumber: UInt
    /// Content octets. For constructed elements this is the concatenation of the children's encodings.
    let value: Data
    /// Children of a constructed element (empty for primitives).
    let children: [ASN1Node]
    /// Full encoding as parsed (or as built).
    let raw: Data

    // MARK: Tag helpers

    var isSequence: Bool { tagClass == .universal && tagNumber == Universal.sequence }
    var isSet: Bool { tagClass == .universal && tagNumber == Universal.set }
    func isContext(_ number: UInt) -> Bool { tagClass == .contextSpecific && tagNumber == number }
    func isUniversal(_ number: UInt) -> Bool { tagClass == .universal && tagNumber == number }

    /// First child with the given context tag (`[n]`), used for optional/implicit fields.
    func context(_ number: UInt) -> ASN1Node? { children.first { $0.isContext(number) } }

    subscript(_ index: Int) -> ASN1Node {
        get throws {
            guard index >= 0, index < children.count else { throw CryptoError.malformed("ASN.1 element \(index) missing") }
            return children[index]
        }
    }

    func expect(_ number: UInt, _ what: String) throws -> ASN1Node {
        guard isUniversal(number) else { throw CryptoError.malformed("expected \(what)") }
        return self
    }

    // MARK: Value accessors

    /// Big-endian two's-complement bytes of an INTEGER/ENUMERATED.
    var integerBytes: Data {
        get throws {
            guard tagClass != .universal || isUniversal(Universal.integer) || isUniversal(Universal.enumerated) else {
                throw CryptoError.malformed("expected INTEGER")
            }
            return value
        }
    }

    /// Unsigned magnitude of an INTEGER (leading 0x00 sign octets stripped).
    var unsignedIntegerBytes: Data {
        get throws {
            var bytes = try integerBytes
            while bytes.count > 1 && bytes.first == 0 { bytes = bytes.dropFirst() }
            return Data(bytes)
        }
    }

    var intValue: Int {
        get throws {
            let bytes = try integerBytes
            guard !bytes.isEmpty, bytes.count <= 8 else { throw CryptoError.malformed("integer out of range") }
            var result = Int64(Int8(bitPattern: bytes.first!))
            for byte in bytes.dropFirst() { result = (result << 8) | Int64(byte) }
            return Int(result)
        }
    }

    var boolValue: Bool {
        get throws {
            guard isUniversal(Universal.boolean), value.count == 1 else { throw CryptoError.malformed("expected BOOLEAN") }
            return value.first != 0
        }
    }

    var oid: String {
        get throws {
            guard isUniversal(Universal.oid) else { throw CryptoError.malformed("expected OBJECT IDENTIFIER") }
            return try ASN1.decodeOID(value)
        }
    }

    /// OCTET STRING contents; concatenates the segments of a BER constructed OCTET STRING.
    var octets: Data {
        get throws {
            if constructed { return Data(try children.map { try $0.octets }.joined()) }
            return value
        }
    }

    /// BIT STRING payload without the unused-bits octet.
    var bitStringBytes: Data {
        get throws {
            guard isUniversal(Universal.bitString) || tagClass != .universal else { throw CryptoError.malformed("expected BIT STRING") }
            if constructed { return Data(try children.map { try $0.bitStringBytes }.joined()) }
            guard !value.isEmpty else { throw CryptoError.malformed("empty BIT STRING") }
            return value.dropFirst().cryptoDetached
        }
    }

    /// Named bits of a BIT STRING (bit 0 = most significant bit of the first payload byte).
    var bitFlags: [Bool] {
        get throws {
            guard let unused = value.first else { return [] }
            let payload = value.dropFirst()
            var bits: [Bool] = []
            for byte in payload { for shift in (0..<8).reversed() { bits.append(byte & (1 << shift) != 0) } }
            if unused > 0 && bits.count >= Int(unused) { bits.removeLast(Int(unused)) }
            return bits
        }
    }

    /// Any of the ASN.1 character string types as a Swift string.
    var stringValue: String {
        get throws {
            guard tagClass == .universal || tagClass == .contextSpecific else { throw CryptoError.malformed("expected string") }
            let bytes = try octets
            switch tagNumber {
            case Universal.bmpString:
                var units: [UInt16] = []
                var index = bytes.startIndex
                while index + 1 < bytes.endIndex {
                    units.append(UInt16(bytes[index]) << 8 | UInt16(bytes[index + 1]))
                    index += 2
                }
                return String(decoding: units, as: UTF16.self)
            case Universal.universalString:
                var scalars = String.UnicodeScalarView()
                var index = bytes.startIndex
                while index + 3 < bytes.endIndex {
                    let code = UInt32(bytes[index]) << 24 | UInt32(bytes[index + 1]) << 16 | UInt32(bytes[index + 2]) << 8 | UInt32(bytes[index + 3])
                    if let scalar = Unicode.Scalar(code) { scalars.append(scalar) }
                    index += 4
                }
                return String(scalars)
            case Universal.t61String:
                // Teletex is in practice Latin-1 (or UTF-8 from sloppy encoders).
                return String(data: bytes, encoding: .utf8) ?? String(data: bytes, encoding: .isoLatin1) ?? ""
            default:
                return String(data: bytes, encoding: .utf8) ?? String(data: bytes, encoding: .isoLatin1) ?? ""
            }
        }
    }

    /// UTCTime / GeneralizedTime.
    var dateValue: Date {
        get throws {
            guard let text = String(data: value, encoding: .ascii) else { throw CryptoError.malformed("bad time") }
            if isUniversal(Universal.utcTime) { return try ASN1.parseTime(text, generalized: false) }
            if isUniversal(Universal.generalizedTime) { return try ASN1.parseTime(text, generalized: true) }
            throw CryptoError.malformed("expected time")
        }
    }

    /// Re-encodes the element as strict DER (definite lengths, primitive strings kept as parsed).
    func derEncoded() -> Data {
        if !constructed { return ASN1.encode(tagClass: tagClass, constructed: false, number: tagNumber, content: value) }
        let content = Data(children.map { $0.derEncoded() }.joined())
        return ASN1.encode(tagClass: tagClass, constructed: true, number: tagNumber, content: content)
    }

    /// The same contents under another tag (IMPLICIT retagging, e.g. signedAttrs `[0]` → `SET`).
    func retagged(_ tagClass: TagClass, _ number: UInt, constructed: Bool? = nil) -> ASN1Node {
        let isConstructed = constructed ?? self.constructed
        let content = isConstructed ? Data(children.map(\.raw).joined()) : value
        return ASN1Node(tagClass: tagClass, constructed: isConstructed, tagNumber: number, value: content, children: isConstructed ? children : [],
                        raw: ASN1.encode(tagClass: tagClass, constructed: isConstructed, number: number, content: content))
    }
}

/// Builders and codec for `ASN1Node`.
enum ASN1 {
    static let maxDepth = 64

    // MARK: Parsing

    static func parse(_ data: Data) throws -> ASN1Node {
        let bytes = [UInt8](data)
        var offset = 0
        let node = try parseElement(bytes, &offset, depth: 0)
        guard offset == bytes.count else {
            // Allow trailing zero padding (PDF /Contents placeholders are zero-filled).
            guard bytes[offset...].allSatisfy({ $0 == 0 }) else { throw CryptoError.malformed("trailing bytes after ASN.1 element") }
            return node
        }
        return node
    }

    /// Parses consecutive elements (e.g. the contents of an implicitly tagged SET).
    static func parseAll(_ data: Data) throws -> [ASN1Node] {
        let bytes = [UInt8](data)
        var offset = 0
        var nodes: [ASN1Node] = []
        while offset < bytes.count { nodes.append(try parseElement(bytes, &offset, depth: 0)) }
        return nodes
    }

    private static func parseElement(_ bytes: [UInt8], _ offset: inout Int, depth: Int) throws -> ASN1Node {
        guard depth < maxDepth else { throw CryptoError.malformed("ASN.1 nesting too deep") }
        let start = offset
        guard offset < bytes.count else { throw CryptoError.malformed("truncated ASN.1") }
        let identifier = bytes[offset]
        offset += 1
        let tagClass = ASN1Node.TagClass(rawValue: identifier >> 6)!
        let constructed = identifier & 0x20 != 0
        var number = UInt(identifier & 0x1F)
        if number == 0x1F {
            number = 0
            var count = 0
            repeat {
                guard offset < bytes.count, count < 4 else { throw CryptoError.malformed("bad ASN.1 tag") }
                number = (number << 7) | UInt(bytes[offset] & 0x7F)
                count += 1
                offset += 1
            } while bytes[offset - 1] & 0x80 != 0
        }
        guard offset < bytes.count else { throw CryptoError.malformed("truncated ASN.1 length") }
        let first = bytes[offset]
        offset += 1
        var length: Int? = nil
        if first < 0x80 {
            length = Int(first)
        } else if first > 0x80 {
            let count = Int(first & 0x7F)
            guard count <= 4, offset + count <= bytes.count else { throw CryptoError.malformed("bad ASN.1 length") }
            var value = 0
            for _ in 0..<count { value = (value << 8) | Int(bytes[offset]); offset += 1 }
            length = value
        }
        if let length {
            guard length <= bytes.count - offset else { throw CryptoError.malformed("ASN.1 length exceeds data") }
            let contentStart = offset
            let end = offset + length
            var children: [ASN1Node] = []
            if constructed {
                while offset < end { children.append(try parseElement(bytes, &offset, depth: depth + 1)) }
                guard offset == end else { throw CryptoError.malformed("ASN.1 child overruns parent") }
            }
            offset = end
            return ASN1Node(tagClass: tagClass, constructed: constructed, tagNumber: number,
                            value: Data(bytes[contentStart..<end]), children: children, raw: Data(bytes[start..<end]))
        }
        // Indefinite length (BER): constructed only, ends with 00 00.
        guard constructed else { throw CryptoError.malformed("indefinite length on primitive") }
        var children: [ASN1Node] = []
        let contentStart = offset
        while true {
            guard offset + 1 < bytes.count else { throw CryptoError.malformed("unterminated indefinite length") }
            if bytes[offset] == 0 && bytes[offset + 1] == 0 { break }
            children.append(try parseElement(bytes, &offset, depth: depth + 1))
        }
        let contentEnd = offset
        offset += 2
        return ASN1Node(tagClass: tagClass, constructed: true, tagNumber: number,
                        value: Data(bytes[contentStart..<contentEnd]), children: children, raw: Data(bytes[start..<offset]))
    }

    // MARK: Encoding

    static func encodeLength(_ length: Int) -> [UInt8] {
        if length < 0x80 { return [UInt8(length)] }
        var bytes: [UInt8] = []
        var value = length
        while value > 0 { bytes.insert(UInt8(value & 0xFF), at: 0); value >>= 8 }
        return [0x80 | UInt8(bytes.count)] + bytes
    }

    static func encode(tagClass: ASN1Node.TagClass, constructed: Bool, number: UInt, content: Data) -> Data {
        var out = Data()
        let head = (tagClass.rawValue << 6) | (constructed ? 0x20 : 0)
        if number < 31 {
            out.append(head | UInt8(number))
        } else {
            out.append(head | 0x1F)
            var groups: [UInt8] = []
            var value = number
            repeat { groups.insert(UInt8(value & 0x7F), at: 0); value >>= 7 } while value > 0
            for (index, group) in groups.enumerated() { out.append(index < groups.count - 1 ? group | 0x80 : group) }
        }
        out.append(contentsOf: encodeLength(content.count))
        out.append(content)
        return out
    }

    static func primitive(_ number: UInt, _ content: Data, tagClass: ASN1Node.TagClass = .universal) -> ASN1Node {
        ASN1Node(tagClass: tagClass, constructed: false, tagNumber: number, value: content, children: [],
                 raw: encode(tagClass: tagClass, constructed: false, number: number, content: content))
    }

    static func constructed(_ number: UInt, _ children: [ASN1Node], tagClass: ASN1Node.TagClass = .universal) -> ASN1Node {
        let content = Data(children.map(\.raw).joined())
        return ASN1Node(tagClass: tagClass, constructed: true, tagNumber: number, value: content, children: children,
                        raw: encode(tagClass: tagClass, constructed: true, number: number, content: content))
    }

    // MARK: Builders

    static func sequence(_ children: [ASN1Node]) -> ASN1Node { constructed(ASN1Node.Universal.sequence, children) }

    /// SET OF in DER order (elements sorted by their encodings).
    static func set(_ children: [ASN1Node], sort: Bool = true) -> ASN1Node {
        let ordered = sort ? children.sorted { $0.raw.lexicographicallyPrecedes($1.raw) } : children
        return constructed(ASN1Node.Universal.set, ordered)
    }

    /// `[n] EXPLICIT` wrapper.
    static func explicit(_ number: UInt, _ child: ASN1Node) -> ASN1Node { constructed(number, [child], tagClass: .contextSpecific) }

    /// `[n] IMPLICIT` constructed (e.g. `[0] IMPLICIT SET OF Certificate`).
    static func implicitConstructed(_ number: UInt, _ children: [ASN1Node]) -> ASN1Node { constructed(number, children, tagClass: .contextSpecific) }

    /// `[n] IMPLICIT` primitive (e.g. `[1] IMPLICIT IA5String` URI, `[0] IMPLICIT OCTET STRING`).
    static func implicitPrimitive(_ number: UInt, _ content: Data) -> ASN1Node { primitive(number, content, tagClass: .contextSpecific) }

    static func integer(_ value: Int) -> ASN1Node {
        var bytes: [UInt8] = []
        var remaining = Int64(value)
        repeat { bytes.insert(UInt8(truncatingIfNeeded: remaining), at: 0); remaining >>= 8 } while remaining != 0 && remaining != -1
        if value >= 0, let first = bytes.first, first & 0x80 != 0 { bytes.insert(0, at: 0) }
        if value < 0, let first = bytes.first, first & 0x80 == 0 { bytes.insert(0xFF, at: 0) }
        return primitive(ASN1Node.Universal.integer, Data(bytes))
    }

    /// Non-negative INTEGER from an unsigned big-endian magnitude.
    static func integer(unsigned magnitude: Data) -> ASN1Node {
        var bytes = [UInt8](magnitude)
        while bytes.count > 1 && bytes[0] == 0 && bytes[1] & 0x80 == 0 { bytes.removeFirst() }
        if bytes.isEmpty { bytes = [0] }
        if bytes[0] & 0x80 != 0 { bytes.insert(0, at: 0) }
        return primitive(ASN1Node.Universal.integer, Data(bytes))
    }

    /// INTEGER using already two's-complement bytes (e.g. a serial number copied from a certificate).
    static func integer(raw: Data) -> ASN1Node { primitive(ASN1Node.Universal.integer, raw) }

    static func boolean(_ value: Bool) -> ASN1Node { primitive(ASN1Node.Universal.boolean, Data([value ? 0xFF : 0])) }
    static func null() -> ASN1Node { primitive(ASN1Node.Universal.null, Data()) }
    static func octetString(_ data: Data) -> ASN1Node { primitive(ASN1Node.Universal.octetString, data) }
    static func bitString(_ data: Data, unusedBits: UInt8 = 0) -> ASN1Node { primitive(ASN1Node.Universal.bitString, Data([unusedBits]) + data) }
    static func utf8String(_ text: String) -> ASN1Node { primitive(ASN1Node.Universal.utf8String, Data(text.utf8)) }
    static func printableString(_ text: String) -> ASN1Node { primitive(ASN1Node.Universal.printableString, Data(text.utf8)) }
    static func ia5String(_ text: String) -> ASN1Node { primitive(ASN1Node.Universal.ia5String, Data(text.utf8)) }

    static func bmpString(_ text: String) -> ASN1Node {
        var data = Data()
        for unit in text.utf16 { data.append(UInt8(unit >> 8)); data.append(UInt8(unit & 0xFF)) }
        return primitive(ASN1Node.Universal.bmpString, data)
    }

    /// Named-bit BIT STRING in DER (trailing zero bits trimmed), e.g. KeyUsage.
    static func namedBits(_ bits: [Int]) -> ASN1Node {
        guard let highest = bits.max() else { return bitString(Data()) }
        var bytes = [UInt8](repeating: 0, count: highest / 8 + 1)
        for bit in bits { bytes[bit / 8] |= 0x80 >> UInt8(bit % 8) }
        let unused = UInt8(7 - highest % 8)
        return bitString(Data(bytes), unusedBits: unused)
    }

    static func oid(_ dotted: String) -> ASN1Node { primitive(ASN1Node.Universal.oid, encodeOID(dotted)) }

    /// Certificate validity time: UTCTime through 2049, GeneralizedTime from 2050 (RFC 5280 §4.1.2.5).
    static func time(_ date: Date) -> ASN1Node {
        let year = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "UTC")!, from: date).year ?? 2000
        return year < 2050 && year >= 1950 ? utcTime(date) : generalizedTime(date)
    }

    static func utcTime(_ date: Date) -> ASN1Node { primitive(ASN1Node.Universal.utcTime, Data(format(date, "yyMMddHHmmss'Z'").utf8)) }
    static func generalizedTime(_ date: Date) -> ASN1Node { primitive(ASN1Node.Universal.generalizedTime, Data(format(date, "yyyyMMddHHmmss'Z'").utf8)) }

    /// `SEQUENCE { OID, params }`; `params: nil` omits the parameters, `.null()` writes NULL.
    static func algorithm(_ oid: String, _ parameters: ASN1Node? = nil) -> ASN1Node {
        sequence([ASN1.oid(oid)] + (parameters.map { [$0] } ?? []))
    }

    /// Wraps an already-encoded element so it can be placed among built children.
    static func raw(_ der: Data) throws -> ASN1Node { try parse(der) }

    // MARK: OID / time codecs

    static func encodeOID(_ dotted: String) -> Data {
        let parts = dotted.split(separator: ".").compactMap { UInt($0) }
        guard parts.count >= 2 else { return Data() }
        var out = Data()
        func base128(_ value: UInt) {
            var groups: [UInt8] = []
            var remaining = value
            repeat { groups.insert(UInt8(remaining & 0x7F), at: 0); remaining >>= 7 } while remaining > 0
            for (index, group) in groups.enumerated() { out.append(index < groups.count - 1 ? group | 0x80 : group) }
        }
        base128(parts[0] * 40 + parts[1])
        for part in parts.dropFirst(2) { base128(part) }
        return out
    }

    static func decodeOID(_ data: Data) throws -> String {
        guard !data.isEmpty else { throw CryptoError.malformed("empty OID") }
        var components: [UInt] = []
        var value: UInt = 0
        var started = false
        for byte in data {
            guard value >> 57 == 0 else { throw CryptoError.malformed("OID component too large") }
            value = (value << 7) | UInt(byte & 0x7F)
            started = true
            if byte & 0x80 == 0 {
                if components.isEmpty {
                    let first: UInt = value < 40 ? 0 : (value < 80 ? 1 : 2)
                    components = [first, value - first * 40]
                } else {
                    components.append(value)
                }
                value = 0
                started = false
            }
        }
        guard !started else { throw CryptoError.malformed("truncated OID") }
        return components.map(String.init).joined(separator: ".")
    }

    private static func format(_ date: Date, _ pattern: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }

    /// Parses UTCTime (`YYMMDDhhmm[ss](Z|±hhmm)`) and GeneralizedTime (with optional fraction).
    static func parseTime(_ text: String, generalized: Bool) throws -> Date {
        var chars = Array(text)
        var offsetSeconds = 0
        if chars.last == "Z" {
            chars.removeLast()
        } else if chars.count >= 5, chars[chars.count - 5] == "+" || chars[chars.count - 5] == "-" {
            let sign = chars[chars.count - 5] == "-" ? -1 : 1
            guard let hours = Int(String(chars[(chars.count - 4)..<(chars.count - 2)])),
                  let minutes = Int(String(chars[(chars.count - 2)...])) else { throw CryptoError.malformed("bad time zone") }
            offsetSeconds = sign * (hours * 3600 + minutes * 60)
            chars.removeLast(5)
        }
        var fraction = 0.0
        if let dot = chars.firstIndex(where: { $0 == "." || $0 == "," }) {
            fraction = Double("0." + String(chars[(dot + 1)...])) ?? 0
            chars.removeSubrange(dot...)
        }
        let digits = String(chars)
        guard digits.allSatisfy(\.isNumber) else { throw CryptoError.malformed("bad time") }
        func field(_ start: Int, _ length: Int) -> Int? {
            guard digits.count >= start + length else { return nil }
            let lower = digits.index(digits.startIndex, offsetBy: start)
            return Int(digits[lower..<digits.index(lower, offsetBy: length)])
        }
        var components = DateComponents()
        var position: Int
        if generalized {
            guard let year = field(0, 4) else { throw CryptoError.malformed("bad time") }
            components.year = year
            position = 4
        } else {
            guard let year = field(0, 2) else { throw CryptoError.malformed("bad time") }
            components.year = year >= 50 ? 1900 + year : 2000 + year
            position = 2
        }
        guard let month = field(position, 2), let day = field(position + 2, 2), let hour = field(position + 4, 2) else {
            throw CryptoError.malformed("bad time")
        }
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = field(position + 6, 2) ?? 0
        components.second = field(position + 8, 2) ?? 0
        components.timeZone = TimeZone(identifier: "UTC")
        guard let date = Calendar(identifier: .gregorian).date(from: components) else { throw CryptoError.malformed("bad time") }
        return date.addingTimeInterval(fraction - Double(offsetSeconds))
    }
}

extension Data {
    /// Normalises a slice so indices start at zero.
    var cryptoDetached: Data { Data(self) }

    var cryptoHex: String { map { String(format: "%02x", $0) }.joined() }

    init?(cryptoHex hex: String) {
        let clean = hex.filter { !$0.isWhitespace && $0 != ":" }
        guard clean.count % 2 == 0 else { return nil }
        var data = Data(capacity: clean.count / 2)
        var index = clean.startIndex
        while index < clean.endIndex {
            let next = clean.index(index, offsetBy: 2)
            guard let byte = UInt8(clean[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        self = data
    }
}
