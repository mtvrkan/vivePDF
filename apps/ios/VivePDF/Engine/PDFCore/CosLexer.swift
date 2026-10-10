import Foundation

/// Byte-class helpers shared by the lexer, the content parser and the serializer.
enum CosBytes {
    /// 0 = regular, 1 = whitespace, 2 = delimiter.
    static let classes: [UInt8] = {
        var t = [UInt8](repeating: 0, count: 256)
        for w: UInt8 in [0, 9, 10, 12, 13, 32] { t[Int(w)] = 1 }
        for d in Array("()<>[]{}/%".utf8) { t[Int(d)] = 2 }
        return t
    }()

    @inline(__always) static func isWhitespace(_ b: UInt8) -> Bool { classes[Int(b)] == 1 }
    @inline(__always) static func isDelimiter(_ b: UInt8) -> Bool { classes[Int(b)] == 2 }
    @inline(__always) static func isRegular(_ b: UInt8) -> Bool { classes[Int(b)] == 0 }

    @inline(__always) static func hexValue(_ b: UInt8) -> Int? {
        switch b {
        case 0x30...0x39: return Int(b - 0x30)
        case 0x41...0x46: return Int(b - 0x37)
        case 0x61...0x66: return Int(b - 0x57)
        default: return nil
        }
    }
}

/// Lexical tokens of PDF syntax (file objects and content streams).
enum CosToken: Equatable {
    case int(Int)
    case real(Double)
    case string(CosString)
    case name(String)
    case keyword(String)
    case arrayOpen, arrayClose, dictOpen, dictClose, braceOpen, braceClose
    case eof
}

/// Tokenizer + object parser over a raw byte buffer. The caller guarantees the buffer outlives the lexer
/// (CosDocument keeps its mapped file alive; content parsing runs inside `withUnsafeBytes`).
struct CosLexer {
    let base: UnsafePointer<UInt8>
    let count: Int
    var pos: Int
    static let maxDepth = 256

    init(_ buffer: UnsafeBufferPointer<UInt8>, at pos: Int = 0) {
        // An empty buffer may have a nil base address; point at a static byte instead.
        self.base = buffer.baseAddress ?? CosLexer.emptyByte
        self.count = buffer.count
        self.pos = pos
    }

    init(base: UnsafePointer<UInt8>, count: Int, at pos: Int = 0) {
        self.base = base
        self.count = count
        self.pos = pos
    }

    private static let emptyByte: UnsafePointer<UInt8> = {
        let p = UnsafeMutablePointer<UInt8>.allocate(capacity: 1)
        p.initialize(to: 0)
        return UnsafePointer(p)
    }()

    var atEnd: Bool { pos >= count }

    @inline(__always) func byte(at i: Int) -> UInt8 { base[i] }

    /// Skips whitespace and comments.
    mutating func skipWhitespace() {
        while pos < count {
            let b = base[pos]
            if CosBytes.isWhitespace(b) {
                pos += 1
            } else if b == 0x25 { // %
                while pos < count, base[pos] != 0x0A, base[pos] != 0x0D { pos += 1 }
            } else {
                return
            }
        }
    }

    /// Returns true and advances when the bytes at the current position (after whitespace) equal `word`
    /// followed by a non-regular byte.
    mutating func consumeKeyword(_ word: StaticString) -> Bool {
        skipWhitespace()
        let n = word.utf8CodeUnitCount
        guard pos + n <= count else { return false }
        let w = word.utf8Start
        for i in 0..<n where base[pos + i] != w[i] { return false }
        if pos + n < count, CosBytes.isRegular(base[pos + n]) { return false }
        pos += n
        return true
    }

    func matches(_ word: StaticString, at p: Int) -> Bool {
        let n = word.utf8CodeUnitCount
        guard p >= 0, p + n <= count else { return false }
        let w = word.utf8Start
        for i in 0..<n where base[p + i] != w[i] { return false }
        return true
    }

    // MARK: Tokens

    mutating func nextToken() -> CosToken {
        skipWhitespace()
        guard pos < count else { return .eof }
        let b = base[pos]
        switch b {
        case 0x5B: pos += 1; return .arrayOpen   // [
        case 0x5D: pos += 1; return .arrayClose  // ]
        case 0x7B: pos += 1; return .braceOpen   // {
        case 0x7D: pos += 1; return .braceClose  // }
        case 0x28: return .string(readLiteralString())
        case 0x2F: return .name(readName())
        case 0x3C: // <
            if pos + 1 < count, base[pos + 1] == 0x3C { pos += 2; return .dictOpen }
            return .string(readHexString())
        case 0x3E: // >
            if pos + 1 < count, base[pos + 1] == 0x3E { pos += 2; return .dictClose }
            pos += 1
            return .keyword(">")
        case 0x29: // stray ')'
            pos += 1
            return .keyword(")")
        default:
            let start = pos
            while pos < count, CosBytes.isRegular(base[pos]) { pos += 1 }
            if pos == start { pos += 1; return .keyword(String(UnicodeScalar(b))) }
            if b == 0x2B || b == 0x2D || b == 0x2E || (b >= 0x30 && b <= 0x39) {
                if let number = parseNumber(start, pos) { return number }
            }
            return .keyword(String(decoding: UnsafeBufferPointer(start: base + start, count: pos - start), as: UTF8.self))
        }
    }

    /// Lenient number parsing: accepts `+`, `-`, `--5`, `1.`, `.5`, `-.5`, trailing junk after the number.
    private func parseNumber(_ start: Int, _ end: Int) -> CosToken? {
        var i = start
        var negative = false
        while i < end, base[i] == 0x2D || base[i] == 0x2B { if base[i] == 0x2D { negative.toggle() }; i += 1 }
        var intPart = 0
        var digits = 0
        var overflow = false
        while i < end, base[i] >= 0x30, base[i] <= 0x39 {
            let (m, o1) = intPart.multipliedReportingOverflow(by: 10)
            let (s, o2) = m.addingReportingOverflow(Int(base[i] - 0x30))
            if o1 || o2 { overflow = true } else { intPart = s }
            digits += 1
            i += 1
        }
        if i < end, base[i] == 0x2E {
            i += 1
            var frac = 0.0, scale = 1.0
            while i < end, base[i] >= 0x30, base[i] <= 0x39 {
                if scale > 1e-17 { scale /= 10; frac += Double(base[i] - 0x30) * scale }
                digits += 1
                i += 1
            }
            if digits == 0 { return i == end ? .int(0) : nil }
            var value = Double(intPart) + frac
            if overflow {
                let text = String(decoding: UnsafeBufferPointer(start: base + start, count: i - start), as: UTF8.self)
                value = abs(Double(text.filter { $0 != "+" && $0 != "-" }) ?? 0)
            }
            return .real(negative ? -value : value)
        }
        if digits == 0 {
            // "-" or "+" alone: treat as 0 (seen in broken content streams); otherwise a keyword.
            return i == end ? .int(0) : nil
        }
        if i < end, base[i] == 0x45 || base[i] == 0x65 { // exponent (not PDF syntax, but seen in the wild)
            let text = String(decoding: UnsafeBufferPointer(start: base + start, count: end - start), as: UTF8.self)
            if let d = Double(text) { return .real(d) }
        }
        if overflow {
            let text = String(decoding: UnsafeBufferPointer(start: base + start, count: i - start), as: UTF8.self)
            return .real(Double(text) ?? 0)
        }
        return .int(negative ? -intPart : intPart)
    }

    private mutating func readName() -> String {
        pos += 1 // '/'
        let start = pos
        var hasEscape = false
        while pos < count, CosBytes.isRegular(base[pos]) {
            if base[pos] == 0x23 { hasEscape = true }
            pos += 1
        }
        let raw = UnsafeBufferPointer(start: base + start, count: pos - start)
        if !hasEscape { return CosName.decode(raw) }
        var out: [UInt8] = []
        out.reserveCapacity(raw.count)
        var i = 0
        while i < raw.count {
            if raw[i] == 0x23, i + 2 < raw.count,
               let h = CosBytes.hexValue(raw[i + 1]), let l = CosBytes.hexValue(raw[i + 2]) {
                out.append(UInt8(h << 4 | l))
                i += 3
            } else {
                out.append(raw[i])
                i += 1
            }
        }
        return CosName.decode(out)
    }

    private mutating func readHexString() -> CosString {
        pos += 1 // '<'
        var out: [UInt8] = []
        var high: Int? = nil
        while pos < count {
            let b = base[pos]
            pos += 1
            if b == 0x3E { break }
            guard let v = CosBytes.hexValue(b) else { continue }
            if let h = high { out.append(UInt8(h << 4 | v)); high = nil } else { high = v }
        }
        if let h = high { out.append(UInt8(h << 4)) }
        return CosString(bytes: out, isHex: true)
    }

    private mutating func readLiteralString() -> CosString {
        pos += 1 // '('
        var out: [UInt8] = []
        var depth = 1
        while pos < count {
            let b = base[pos]
            pos += 1
            switch b {
            case 0x28: depth += 1; out.append(b)
            case 0x29:
                depth -= 1
                if depth == 0 { return CosString(bytes: out) }
                out.append(b)
            case 0x0D: // EOL normalisation: CR or CRLF → LF
                if pos < count, base[pos] == 0x0A { pos += 1 }
                out.append(0x0A)
            case 0x5C:
                guard pos < count else { break }
                let e = base[pos]
                pos += 1
                switch e {
                case 0x6E: out.append(0x0A)
                case 0x72: out.append(0x0D)
                case 0x74: out.append(0x09)
                case 0x62: out.append(0x08)
                case 0x66: out.append(0x0C)
                case 0x0D: if pos < count, base[pos] == 0x0A { pos += 1 } // line continuation
                case 0x0A: break
                case 0x30...0x37:
                    var v = Int(e - 0x30)
                    for _ in 0..<2 {
                        guard pos < count, base[pos] >= 0x30, base[pos] <= 0x37 else { break }
                        v = v * 8 + Int(base[pos] - 0x30)
                        pos += 1
                    }
                    out.append(UInt8(v & 0xFF))
                default: out.append(e) // \( \) \\ and unknown escapes keep the character
                }
            default: out.append(b)
            }
        }
        return CosString(bytes: out)
    }

    // MARK: Objects

    /// Parses one object. Integers followed by `gen R` become references.
    /// Throws on unexpected tokens; nested dictionaries/arrays tolerate garbage where possible.
    mutating func parseObject(depth: Int = 0) throws -> CosObject {
        let token = nextToken()
        return try parseObject(after: token, depth: depth)
    }

    mutating func parseObject(after token: CosToken, depth: Int = 0) throws -> CosObject {
        guard depth < CosLexer.maxDepth else { throw CosError.malformed("nesting too deep") }
        switch token {
        case .int(let i):
            if i >= 0, let r = tryReference(i) { return .ref(r) }
            return .int(i)
        case .real(let r): return .real(r)
        case .string(let s): return .string(s)
        case .name(let n): return .name(n)
        case .arrayOpen:
            var items: [CosObject] = []
            while true {
                let t = nextToken()
                switch t {
                case .arrayClose: return .array(items)
                case .eof: return .array(items) // truncated: keep what we have
                case .dictClose: continue
                case .keyword(let k):
                    if k == "endobj" || k == "stream" || k == "endstream" { pos -= k.utf8.count; return .array(items) }
                    if k == "null" { items.append(.null) } else if k == "true" { items.append(.bool(true)) }
                    else if k == "false" { items.append(.bool(false)) }
                default: items.append(try parseObject(after: t, depth: depth + 1))
                }
            }
        case .dictOpen:
            return .dict(try parseDictBody(depth: depth))
        case .keyword(let k):
            switch k {
            case "null": return .null
            case "true": return .bool(true)
            case "false": return .bool(false)
            default: throw CosError.malformed("unexpected keyword \(k)")
            }
        case .eof: throw CosError.malformed("unexpected end of data")
        default: throw CosError.malformed("unexpected token \(token)")
        }
    }

    /// Parses dictionary entries after `<<` up to and including `>>`.
    mutating func parseDictBody(depth: Int = 0) throws -> CosDict {
        var dict = CosDict()
        while true {
            let t = nextToken()
            switch t {
            case .dictClose, .eof: return dict
            case .name(let key):
                let vt = nextToken()
                switch vt {
                case .dictClose: return dict // key without value
                case .eof: return dict
                case .keyword(let k) where k == "endobj" || k == "stream" || k == "endstream":
                    pos -= k.utf8.count
                    return dict
                default:
                    if let value = try? parseObject(after: vt, depth: depth + 1) { dict[key] = value }
                }
            case .keyword(let k) where k == "endobj" || k == "stream" || k == "endstream":
                pos -= k.utf8.count // let the caller see it
                return dict
            default:
                continue // garbage key: skip
            }
        }
    }

    /// After an integer: checks for `gen R` and consumes it.
    private mutating func tryReference(_ num: Int) -> CosRef? {
        let saved = pos
        skipWhitespace()
        // Fast path: digits, whitespace, 'R', delimiter/whitespace/end.
        var p = pos
        var gen = 0
        let digitsStart = p
        while p < count, base[p] >= 0x30, base[p] <= 0x39, p - digitsStart < 6 { gen = gen * 10 + Int(base[p] - 0x30); p += 1 }
        guard p > digitsStart, p < count, CosBytes.isWhitespace(base[p]) else { pos = saved; return nil }
        while p < count, CosBytes.isWhitespace(base[p]) { p += 1 }
        guard p < count, base[p] == 0x52, p + 1 >= count || !CosBytes.isRegular(base[p + 1]) else { pos = saved; return nil }
        pos = p + 1
        return CosRef(num, gen)
    }
}

extension Data {
    /// Runs `body` with a lexer over this data.
    func withCosLexer<T>(at pos: Int = 0, _ body: (inout CosLexer) throws -> T) rethrows -> T {
        try withUnsafeBytes { raw in
            var lexer = CosLexer(raw.bindMemory(to: UInt8.self), at: pos)
            return try body(&lexer)
        }
    }
}
