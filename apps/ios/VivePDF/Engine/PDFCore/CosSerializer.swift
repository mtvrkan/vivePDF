import Foundation

/// Object → PDF syntax. Used by the writer (with reference renumbering and string encryption hooks), by the
/// content stream serializer and by `description`.
struct CosSerializer {
    /// Maps references while writing (renumbering). nil result writes `null`.
    var mapRef: ((CosRef) -> CosRef?)?
    /// Transforms string bytes while writing (encryption). Strings are then always written as hex.
    var transformString: ((CosString) -> [UInt8])?

    init(mapRef: ((CosRef) -> CosRef?)? = nil, transformString: ((CosString) -> [UInt8])? = nil) {
        self.mapRef = mapRef
        self.transformString = transformString
    }

    static func serialize(_ object: CosObject) -> [UInt8] {
        var out: [UInt8] = []
        CosSerializer().write(object, into: &out)
        return out
    }

    static func data(_ object: CosObject) -> Data { Data(serialize(object)) }

    func write(_ object: CosObject, into out: inout [UInt8]) {
        switch object {
        case .null: out += Self.nullBytes
        case .bool(let b): out += b ? Self.trueBytes : Self.falseBytes
        case .int(let i): Self.writeInt(i, into: &out)
        case .real(let r): Self.writeReal(r, into: &out)
        case .string(let s):
            if let transformString {
                Self.writeHex(transformString(s), into: &out)
            } else if s.isHex {
                Self.writeHex(s.bytes, into: &out)
            } else {
                Self.writeLiteral(s.bytes, into: &out)
            }
        case .name(let n): Self.writeName(n, into: &out)
        case .array(let items):
            out.append(0x5B)
            for (i, item) in items.enumerated() {
                if i > 0 { out.append(0x20) }
                write(item, into: &out)
            }
            out.append(0x5D)
        case .dict(let d): write(d, into: &out)
        case .stream(let s): write(s.dict, into: &out) // payload is the writer's job
        case .ref(let r):
            if let mapRef {
                if let mapped = mapRef(r) { Self.writeRef(mapped, into: &out) } else { out += Self.nullBytes }
            } else {
                Self.writeRef(r, into: &out)
            }
        }
    }

    func write(_ dict: CosDict, into out: inout [UInt8]) {
        out += [0x3C, 0x3C]
        for (key, value) in dict {
            Self.writeName(key, into: &out)
            switch value {
            case .array, .dict, .string, .name: break
            default: out.append(0x20)
            }
            write(value, into: &out)
        }
        out += [0x3E, 0x3E]
    }

    private static let nullBytes = Array("null".utf8), trueBytes = Array("true".utf8), falseBytes = Array("false".utf8)

    static func writeRef(_ r: CosRef, into out: inout [UInt8]) {
        writeInt(r.num, into: &out)
        out.append(0x20)
        writeInt(r.gen, into: &out)
        out += [0x20, 0x52]
    }

    static func writeInt(_ value: Int, into out: inout [UInt8]) {
        if value >= 0 && value < 10 { out.append(UInt8(0x30 + value)); return }
        out += Array(String(value).utf8)
    }

    /// Fixed-point, at most 6 decimals, no exponent (PDF has no exponent syntax).
    static func writeReal(_ value: Double, into out: inout [UInt8]) {
        guard value.isFinite else { out.append(0x30); return }
        if value == value.rounded(), abs(value) < 1e15 { writeInt(Int(value), into: &out); return }
        var text = String(format: "%.6f", value)
        if text.contains(".") {
            while text.hasSuffix("0") { text.removeLast() }
            if text.hasSuffix(".") { text.removeLast() }
        }
        if text == "-0" || text.isEmpty { text = "0" }
        out += Array(text.utf8)
    }

    static func formatNumber(_ value: Double) -> String {
        var out: [UInt8] = []
        writeReal(value, into: &out)
        return String(decoding: out, as: UTF8.self)
    }

    private static let hexDigits = Array("0123456789ABCDEF".utf8)

    static func writeHex(_ bytes: [UInt8], into out: inout [UInt8]) {
        out.reserveCapacity(out.count + bytes.count * 2 + 2)
        out.append(0x3C)
        for b in bytes {
            out.append(hexDigits[Int(b >> 4)])
            out.append(hexDigits[Int(b & 0x0F)])
        }
        out.append(0x3E)
    }

    static func writeLiteral(_ bytes: [UInt8], into out: inout [UInt8]) {
        out.append(0x28)
        for b in bytes {
            switch b {
            case 0x28, 0x29, 0x5C: out.append(0x5C); out.append(b)
            case 0x0A: out += [0x5C, 0x6E]
            case 0x0D: out += [0x5C, 0x72]
            case 0x09: out += [0x5C, 0x74]
            case 0x08: out += [0x5C, 0x62]
            case 0x0C: out += [0x5C, 0x66]
            case 0..<0x20, 0x7F:
                out.append(0x5C)
                out.append(0x30 + (b >> 6))
                out.append(0x30 + ((b >> 3) & 7))
                out.append(0x30 + (b & 7))
            default: out.append(b)
            }
        }
        out.append(0x29)
    }

    static func writeName(_ name: String, into out: inout [UInt8]) {
        out.append(0x2F)
        for b in CosName.encode(name) {
            if b < 0x21 || b > 0x7E || b == 0x23 || CosBytes.isDelimiter(b) {
                out.append(0x23)
                out.append(hexDigits[Int(b >> 4)])
                out.append(hexDigits[Int(b & 0x0F)])
            } else {
                out.append(b)
            }
        }
    }
}
