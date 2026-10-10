import Foundation

/// Inline image (`BI … ID <data> EI`). `dict` keeps the abbreviated keys as written; use `expandedDict`
/// for canonical names (W→Width, CS→ColorSpace, F→Filter, …).
struct CosInlineImage: Hashable {
    var dict: CosDict
    var data: Data

    static let keyNames = ["BPC": "BitsPerComponent", "CS": "ColorSpace", "D": "Decode", "DP": "DecodeParms",
                           "F": "Filter", "H": "Height", "IM": "ImageMask", "I": "Interpolate", "W": "Width", "L": "Length"]
    static let valueNames = ["G": "DeviceGray", "RGB": "DeviceRGB", "CMYK": "DeviceCMYK", "I": "Indexed",
                             "AHx": "ASCIIHexDecode", "A85": "ASCII85Decode", "LZW": "LZWDecode", "Fl": "FlateDecode",
                             "RL": "RunLengthDecode", "CCF": "CCITTFaxDecode", "DCT": "DCTDecode"]

    /// Dictionary with full key names and expanded colour-space/filter abbreviations (as for an image XObject).
    var expandedDict: CosDict {
        var out = CosDict()
        func expand(_ v: CosObject) -> CosObject {
            switch v {
            case .name(let n): return .name(CosInlineImage.valueNames[n] ?? n)
            case .array(let a): return .array(a.map(expand))
            default: return v
            }
        }
        for (k, v) in dict {
            let key = CosInlineImage.keyNames[k] ?? k
            out[key] = (key == "ColorSpace" || key == "Filter") ? expand(v) : v
        }
        out["Type"] = "XObject"
        out["Subtype"] = "Image"
        return out
    }

    /// The image as a stream (filters per its dictionary), e.g. to decode with `CosImage`.
    var stream: CosStream { CosStream(dict: expandedDict, rawData: data) }
}

/// One content-stream operation: operator + operands. `range` is the byte range in the parsed data
/// (first operand … end of operator, `EI` included for inline images) so callers can cut or splice the
/// original bytes without re-serialising everything.
struct CosOperation: Hashable {
    var op: String
    var operands: [CosObject]
    var inlineImage: CosInlineImage?
    var range: Range<Int>

    init(_ op: String, _ operands: [CosObject] = [], inlineImage: CosInlineImage? = nil, range: Range<Int> = 0..<0) {
        self.op = op
        self.operands = operands
        self.inlineImage = inlineImage
        self.range = range
    }

    func number(_ i: Int) -> Double { i < operands.count ? operands[i].number ?? 0 : 0 }
}

/// Marked-content sequence (`BMC`/`BDC` … `EMC`), as operation indices.
struct CosMarkedContent: Hashable {
    var tag: String
    /// Inline property dictionary or a /Properties resource name.
    var properties: CosObject?
    /// Index of the BMC/BDC operation and of its matching EMC.
    var begin: Int
    var end: Int
    var depth: Int

    /// `/MCID` when the properties are an inline dictionary.
    var mcid: Int? { properties?.dict?.int("MCID") }
}

enum CosContent {
    // MARK: Parsing

    /// Parses a (decoded) content stream into operations. Never throws: malformed bits are skipped.
    static func parse(_ data: Data) -> [CosOperation] {
        data.withCosLexer { lexer in parse(&lexer) }
    }

    static func parse(_ lexer: inout CosLexer) -> [CosOperation] {
        var ops: [CosOperation] = []
        var operands: [CosObject] = []
        var start = -1
        while true {
            lexer.skipWhitespace()
            let tokenStart = lexer.pos
            let token = lexer.nextToken()
            switch token {
            case .eof:
                return ops
            case .keyword(let k):
                switch k {
                case "true", "false", "null":
                    if start < 0 { start = tokenStart }
                    operands.append(k == "null" ? .null : .bool(k == "true"))
                    continue
                case "BI":
                    let begin = start < 0 ? tokenStart : start
                    if let image = parseInlineImage(&lexer) {
                        ops.append(CosOperation("BI", operands, inlineImage: image, range: begin..<lexer.pos))
                    }
                case ">", ")", "]", "}", "{":
                    break // stray delimiters: ignore
                default:
                    ops.append(CosOperation(k, operands, range: (start < 0 ? tokenStart : start)..<lexer.pos))
                }
                operands.removeAll(keepingCapacity: true)
                start = -1
            case .arrayClose, .dictClose, .braceOpen, .braceClose:
                continue
            default:
                if start < 0 { start = tokenStart }
                if let value = try? lexer.parseObject(after: token) {
                    operands.append(value)
                    if operands.count > 4096 { operands.removeFirst(operands.count - 4096) } // garbage guard
                }
            }
        }
    }

    private static func parseInlineImage(_ lexer: inout CosLexer) -> CosInlineImage? {
        var dict = CosDict()
        // Key/value pairs up to ID.
        while true {
            let t = lexer.nextToken()
            switch t {
            case .eof: return nil
            case .keyword("ID"):
                // Exactly one whitespace byte follows ID (except for some broken producers).
                if lexer.pos < lexer.count, CosBytes.isWhitespace(lexer.byte(at: lexer.pos)) { lexer.pos += 1 }
                let dataStart = lexer.pos
                let end = inlineImageEnd(&lexer, dict: dict, from: dataStart)
                let dataEnd = end.dataEnd
                let data = Data(UnsafeBufferPointer(start: lexer.base + dataStart, count: max(0, dataEnd - dataStart)))
                lexer.pos = end.next
                return CosInlineImage(dict: dict, data: data)
            case .name(let key):
                if let v = try? lexer.parseObject() { dict[key] = v }
            default:
                continue
            }
        }
    }

    /// Finds the end of inline image data. Uses the exact size for unfiltered images, /L if given, and
    /// otherwise the first `EI` delimited by whitespace that is followed by plausible content.
    private static func inlineImageEnd(_ lexer: inout CosLexer, dict: CosDict, from start: Int) -> (dataEnd: Int, next: Int) {
        let count = lexer.count
        let base = lexer.base
        func isEI(at p: Int) -> Bool {
            guard p + 1 < count, base[p] == 0x45, base[p + 1] == 0x49 else { return false }
            return p + 2 >= count || !CosBytes.isRegular(base[p + 2])
        }
        let filter = dict["F"] ?? dict["Filter"]
        var exact: Int? = (dict["L"] ?? dict["Length"])?.int
        if exact == nil, filter == nil || filter?.array?.isEmpty == true {
            let w = (dict["W"] ?? dict["Width"])?.int ?? 0
            let h = (dict["H"] ?? dict["Height"])?.int ?? 0
            let isMask = (dict["IM"] ?? dict["ImageMask"])?.bool ?? false
            let bpc = isMask ? 1 : ((dict["BPC"] ?? dict["BitsPerComponent"])?.int ?? 8)
            var colors = 1
            switch (dict["CS"] ?? dict["ColorSpace"]) {
            case .name(let n)?: colors = ["RGB": 3, "DeviceRGB": 3, "CMYK": 4, "DeviceCMYK": 4].first { $0.key == n }?.value ?? 1
            case .array(let a)?: if let first = a.first?.name, first == "I" || first == "Indexed" { colors = 1 }
            default: break
            }
            if isMask { colors = 1 }
            if w > 0, h > 0 { exact = (w * colors * bpc + 7) / 8 * h }
        }
        if let exact, exact >= 0, start + exact <= count {
            var p = start + exact
            while p < count, CosBytes.isWhitespace(base[p]) { p += 1 }
            if isEI(at: p) { return (start + exact, p + 2) }
        }
        // Scan for whitespace + EI + delimiter, checking what follows looks like content-stream syntax.
        var p = start
        while p + 1 < count {
            if base[p] == 0x45, base[p + 1] == 0x49, p > start, CosBytes.isWhitespace(base[p - 1]), isEI(at: p) {
                if followsPlausibly(base, count, p + 2) { return (p - 1, p + 2) }
            }
            p += 1
        }
        return (count, count)
    }

    private static func followsPlausibly(_ base: UnsafePointer<UInt8>, _ count: Int, _ from: Int) -> Bool {
        var p = from
        var checked = 0
        while p < count, checked < 32 {
            let b = base[p]
            if b < 0x09 || (b > 0x0D && b < 0x20) || b > 0x7E { return false }
            p += 1
            checked += 1
        }
        return true
    }

    // MARK: Serialising

    static func serialize(_ ops: [CosOperation]) -> Data {
        var out = [UInt8]()
        out.reserveCapacity(ops.count * 16)
        let serializer = CosSerializer()
        for op in ops {
            append(op, serializer: serializer, into: &out)
            out.append(0x0A)
        }
        return Data(out)
    }

    static func append(_ op: CosOperation, serializer: CosSerializer = CosSerializer(), into out: inout [UInt8]) {
        for operand in op.operands {
            serializer.write(operand, into: &out)
            out.append(0x20)
        }
        if op.op == "BI", let image = op.inlineImage {
            out += Array("BI".utf8)
            for (k, v) in image.dict {
                out.append(0x20)
                CosSerializer.writeName(k, into: &out)
                out.append(0x20)
                serializer.write(v, into: &out)
            }
            out += Array(" ID ".utf8)
            out += [UInt8](image.data)
            out += Array("\nEI".utf8)
        } else {
            out += Array(op.op.utf8)
        }
    }

    // MARK: Editing helpers

    /// Removes byte ranges from `data` (overlapping ranges are merged); a newline replaces each cut so
    /// neighbouring tokens never fuse.
    static func removing(_ ranges: [Range<Int>], from data: Data) -> Data {
        let sorted = ranges.filter { !$0.isEmpty }.sorted { $0.lowerBound < $1.lowerBound }
        var merged: [Range<Int>] = []
        for r in sorted {
            if let last = merged.last, r.lowerBound <= last.upperBound {
                merged[merged.count - 1] = last.lowerBound..<max(last.upperBound, r.upperBound)
            } else {
                merged.append(r)
            }
        }
        var out = Data()
        out.reserveCapacity(data.count)
        var cursor = data.startIndex
        for r in merged {
            let lo = data.startIndex + r.lowerBound, hi = min(data.endIndex, data.startIndex + r.upperBound)
            guard lo >= cursor, lo <= data.endIndex else { continue }
            out.append(data[cursor..<lo])
            out.append(0x0A)
            cursor = hi
        }
        if cursor < data.endIndex { out.append(data[cursor..<data.endIndex]) }
        return out
    }

    /// Replaces byte ranges with new bytes (ranges must not overlap).
    static func replacing(_ replacements: [(Range<Int>, Data)], in data: Data) -> Data {
        var out = Data()
        var cursor = data.startIndex
        for (r, bytes) in replacements.sorted(by: { $0.0.lowerBound < $1.0.lowerBound }) {
            let lo = data.startIndex + r.lowerBound
            guard lo >= cursor else { continue }
            out.append(data[cursor..<lo])
            out.append(0x20)
            out.append(bytes)
            out.append(0x20)
            cursor = data.startIndex + r.upperBound
        }
        if cursor < data.endIndex { out.append(data[cursor..<data.endIndex]) }
        return out
    }

    /// Marked-content sequences with their nesting depth (unbalanced EMCs are ignored, unclosed
    /// sequences end at the last operation).
    static func markedContent(_ ops: [CosOperation]) -> [CosMarkedContent] {
        var stack: [(tag: String, props: CosObject?, begin: Int)] = []
        var result: [CosMarkedContent] = []
        for (i, op) in ops.enumerated() {
            switch op.op {
            case "BMC": stack.append((op.operands.first?.name ?? "", nil, i))
            case "BDC": stack.append((op.operands.first?.name ?? "", op.operands.count > 1 ? op.operands[1] : nil, i))
            case "EMC":
                if let open = stack.popLast() {
                    result.append(CosMarkedContent(tag: open.tag, properties: open.props, begin: open.begin, end: i, depth: stack.count))
                }
            default: break
            }
        }
        while let open = stack.popLast() {
            result.append(CosMarkedContent(tag: open.tag, properties: open.props, begin: open.begin, end: ops.count - 1, depth: stack.count))
        }
        return result.sorted { $0.begin < $1.begin }
    }
}
