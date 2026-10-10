import Compression
import Foundation

/// Stream filters (ISO 32000-1 §7.4). Decoders are lenient: corrupt or truncated input yields whatever
/// could be decoded (like Acrobat/MuPDF), and only throws when nothing at all could be decoded.
enum CosFilters {
    struct PartialDecode {
        var data: Data
        /// First filter left undecoded (an image codec such as "DCTDecode"), with its parameters.
        var remainingFilter: String?
        var remainingParms: CosDict?
        /// Any filters after `remainingFilter` (rare, e.g. DCT followed by nothing).
        var remainingFilters: [String] = []
    }

    /// Codecs that are not decoded here — their bytes are the image file format (JPEG, JPEG 2000, JBIG2, G3/G4).
    static let imageFilters: Set<String> = ["DCTDecode", "DCT", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode", "CCF"]

    static func canonicalName(_ name: String) -> String {
        switch name {
        case "Fl": return "FlateDecode"
        case "LZW": return "LZWDecode"
        case "AHx": return "ASCIIHexDecode"
        case "A85": return "ASCII85Decode"
        case "RL": return "RunLengthDecode"
        case "DCT": return "DCTDecode"
        case "CCF": return "CCITTFaxDecode"
        default: return name
        }
    }

    static func decode(_ input: Data, filters: [String], parms: [CosDict?], stopAtImageFilter: Bool) throws -> PartialDecode {
        var data = input
        for (index, raw) in filters.enumerated() {
            let name = canonicalName(raw)
            let p = index < parms.count ? parms[index] : nil
            if imageFilters.contains(name) {
                if stopAtImageFilter {
                    return PartialDecode(data: data, remainingFilter: name, remainingParms: p,
                                         remainingFilters: filters.dropFirst(index + 1).map(canonicalName))
                }
                throw CosError.unsupportedFilter(name)
            }
            data = try decode(data, filter: name, parms: p)
        }
        return PartialDecode(data: data, remainingFilter: nil, remainingParms: nil)
    }

    /// Applies one (non-image) filter.
    static func decode(_ data: Data, filter: String, parms: CosDict?) throws -> Data {
        switch canonicalName(filter) {
        case "FlateDecode": return try applyPredictor(flateDecode(data), parms: parms)
        case "LZWDecode": return try applyPredictor(lzwDecode(data, earlyChange: parms?.int("EarlyChange") ?? 1), parms: parms)
        case "ASCIIHexDecode": return asciiHexDecode(data)
        case "ASCII85Decode": return try ascii85Decode(data)
        case "RunLengthDecode": return runLengthDecode(data)
        case "Crypt": return data // decryption already happened when the object was loaded
        default: throw CosError.unsupportedFilter(filter)
        }
    }

    // MARK: Flate

    /// zlib (RFC 1950) or raw deflate (RFC 1951) input. The Compression framework speaks raw deflate.
    static func flateDecode(_ data: Data) throws -> Data {
        guard !data.isEmpty else { return Data() }
        var skip = 0
        if data.count >= 2 {
            let b0 = data[data.startIndex], b1 = data[data.startIndex + 1]
            if b0 & 0x0F == 8, b0 >> 4 <= 7, (UInt16(b0) << 8 | UInt16(b1)) % 31 == 0 {
                skip = (b1 & 0x20) != 0 ? 6 : 2
            }
        }
        do {
            return try inflate(data, skip: skip)
        } catch {
            // Some producers write a bogus header or raw deflate: try the other interpretation.
            if skip > 0, let raw = try? inflate(data, skip: 0), !raw.isEmpty { return raw }
            throw error
        }
    }

    private static func inflate(_ data: Data, skip: Int) throws -> Data {
        let chunk = 1 << 16
        var output = Data()
        output.reserveCapacity(min(max(data.count * 4, chunk), 256 << 20))
        let ok: Bool = data.withUnsafeBytes { raw -> Bool in
            guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return false }
            let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
            defer { stream.deallocate() }
            var status = compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB)
            guard status != COMPRESSION_STATUS_ERROR else { return false }
            defer { compression_stream_destroy(stream) }
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: chunk)
            defer { buffer.deallocate() }
            stream.pointee.src_ptr = base + skip
            stream.pointee.src_size = max(0, raw.count - skip)
            repeat {
                stream.pointee.dst_ptr = buffer
                stream.pointee.dst_size = chunk
                status = compression_stream_process(stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                let produced = chunk - stream.pointee.dst_size
                if produced > 0 { output.append(buffer, count: produced) }
                if status == COMPRESSION_STATUS_OK && produced == 0 && stream.pointee.src_size == 0 { break }
            } while status == COMPRESSION_STATUS_OK
            return status != COMPRESSION_STATUS_ERROR
        }
        if !ok && output.isEmpty { throw CosError.decodeFailed("FlateDecode") }
        return output
    }

    /// zlib-wrapped deflate (header + adler32), as PDF expects.
    static func flateEncode(_ data: Data) -> Data {
        var output = Data([0x78, 0x9C])
        let chunk = 1 << 16
        data.withUnsafeBytes { raw in
            let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
            defer { stream.deallocate() }
            guard compression_stream_init(stream, COMPRESSION_STREAM_ENCODE, COMPRESSION_ZLIB) != COMPRESSION_STATUS_ERROR else { return }
            defer { compression_stream_destroy(stream) }
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: chunk)
            defer { buffer.deallocate() }
            let empty: [UInt8] = [0]
            empty.withUnsafeBufferPointer { emptyPointer in
                stream.pointee.src_ptr = raw.bindMemory(to: UInt8.self).baseAddress ?? emptyPointer.baseAddress!
                stream.pointee.src_size = raw.count
                var status: compression_status
                repeat {
                    stream.pointee.dst_ptr = buffer
                    stream.pointee.dst_size = chunk
                    status = compression_stream_process(stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                    output.append(buffer, count: chunk - stream.pointee.dst_size)
                } while status == COMPRESSION_STATUS_OK
            }
        }
        let a = adler32(data)
        output.append(contentsOf: [UInt8(a >> 24), UInt8((a >> 16) & 0xFF), UInt8((a >> 8) & 0xFF), UInt8(a & 0xFF)])
        return output
    }

    static func adler32(_ data: Data) -> UInt32 {
        var a: UInt32 = 1, b: UInt32 = 0
        data.withUnsafeBytes { raw in
            let p = raw.bindMemory(to: UInt8.self)
            var i = 0
            while i < p.count {
                let end = min(i + 5552, p.count)
                while i < end { a &+= UInt32(p[i]); b &+= a; i += 1 }
                a %= 65521
                b %= 65521
            }
        }
        return b << 16 | a
    }

    /// Flate with PNG predictors (per-row adaptive choice) — smaller output for continuous-tone images.
    /// Returns the data and the `/DecodeParms` dictionary to store.
    static func flateEncode(_ data: Data, pngPredictorColumns columns: Int, colors: Int, bitsPerComponent: Int) -> (Data, CosDict) {
        let bpp = max(1, colors * bitsPerComponent / 8)
        let rowBytes = (columns * colors * bitsPerComponent + 7) / 8
        guard rowBytes > 0 else { return (flateEncode(data), CosDict()) }
        let src = [UInt8](data)
        let rows = (src.count + rowBytes - 1) / rowBytes
        var out = [UInt8]()
        out.reserveCapacity(rows * (rowBytes + 1))
        var prev = [UInt8](repeating: 0, count: rowBytes)
        var candidate = [UInt8](repeating: 0, count: rowBytes)
        var best = [UInt8](repeating: 0, count: rowBytes)
        for r in 0..<rows {
            var row = [UInt8](repeating: 0, count: rowBytes)
            let start = r * rowBytes
            let n = min(rowBytes, src.count - start)
            for i in 0..<n { row[i] = src[start + i] }
            var bestType: UInt8 = 0
            var bestScore = Int.max
            for type: UInt8 in 0...4 {
                var score = 0
                for i in 0..<rowBytes {
                    let left = i >= bpp ? Int(row[i - bpp]) : 0
                    let up = Int(prev[i])
                    let upLeft = i >= bpp ? Int(prev[i - bpp]) : 0
                    let predicted: Int
                    switch type {
                    case 1: predicted = left
                    case 2: predicted = up
                    case 3: predicted = (left + up) / 2
                    case 4: predicted = paeth(left, up, upLeft)
                    default: predicted = 0
                    }
                    let v = UInt8(truncatingIfNeeded: Int(row[i]) - predicted)
                    candidate[i] = v
                    score += v < 128 ? Int(v) : 256 - Int(v)
                }
                if score < bestScore { bestScore = score; bestType = type; swap(&best, &candidate) }
            }
            out.append(bestType)
            out += best
            prev = row
        }
        let parms: CosDict = ["Predictor": 15, "Colors": .int(colors), "BitsPerComponent": .int(bitsPerComponent), "Columns": .int(columns)]
        return (flateEncode(Data(out)), parms)
    }

    @inline(__always) private static func paeth(_ a: Int, _ b: Int, _ c: Int) -> Int {
        let p = a + b - c
        let pa = abs(p - a), pb = abs(p - b), pc = abs(p - c)
        if pa <= pb && pa <= pc { return a }
        return pb <= pc ? b : c
    }

    // MARK: Predictors

    static func applyPredictor(_ data: Data, parms: CosDict?) throws -> Data {
        guard let parms, let predictor = parms.int("Predictor"), predictor > 1 else { return data }
        let colors = max(1, parms.int("Colors") ?? 1)
        let bpc = max(1, parms.int("BitsPerComponent") ?? 8)
        let columns = max(1, parms.int("Columns") ?? 1)
        let bitsPerPixel = colors * bpc
        let rowBytes = (columns * bitsPerPixel + 7) / 8
        let bpp = max(1, bitsPerPixel / 8)
        let src = [UInt8](data)
        if predictor == 2 {
            return Data(tiffPredict(src, rowBytes: rowBytes, colors: colors, bpc: bpc, columns: columns))
        }
        // PNG predictors: every row starts with its own filter-type byte.
        var out = [UInt8]()
        out.reserveCapacity(src.count)
        var prev = [UInt8](repeating: 0, count: rowBytes)
        var row = [UInt8](repeating: 0, count: rowBytes)
        var i = 0
        while i < src.count {
            let type = src[i]
            i += 1
            let n = min(rowBytes, src.count - i)
            if n <= 0 { break }
            for k in 0..<rowBytes { row[k] = k < n ? src[i + k] : 0 }
            i += n
            switch type {
            case 1: for k in bpp..<max(bpp, rowBytes) { row[k] = row[k] &+ row[k - bpp] }
            case 2: for k in 0..<rowBytes { row[k] = row[k] &+ prev[k] }
            case 3:
                for k in 0..<rowBytes {
                    let left = k >= bpp ? Int(row[k - bpp]) : 0
                    row[k] = row[k] &+ UInt8((left + Int(prev[k])) / 2)
                }
            case 4:
                for k in 0..<rowBytes {
                    let left = k >= bpp ? Int(row[k - bpp]) : 0
                    let upLeft = k >= bpp ? Int(prev[k - bpp]) : 0
                    row[k] = row[k] &+ UInt8(paeth(left, Int(prev[k]), upLeft))
                }
            default: break
            }
            out.append(contentsOf: row[0..<n])
            swap(&prev, &row)
        }
        return Data(out)
    }

    private static func tiffPredict(_ src: [UInt8], rowBytes: Int, colors: Int, bpc: Int, columns: Int) -> [UInt8] {
        var out = src
        var rowStart = 0
        while rowStart < out.count {
            let rowEnd = min(rowStart + rowBytes, out.count)
            switch bpc {
            case 8:
                var k = rowStart + colors
                while k < rowEnd { out[k] = out[k] &+ out[k - colors]; k += 1 }
            case 16:
                var k = rowStart + 2 * colors
                while k + 1 < rowEnd {
                    let cur = UInt16(out[k]) << 8 | UInt16(out[k + 1])
                    let left = UInt16(out[k - 2 * colors]) << 8 | UInt16(out[k - 2 * colors + 1])
                    let v = cur &+ left
                    out[k] = UInt8(v >> 8)
                    out[k + 1] = UInt8(v & 0xFF)
                    k += 2
                }
            default: // 1, 2, 4 bits: work on unpacked samples
                let mask = (1 << bpc) - 1
                var prevSamples = [Int](repeating: 0, count: colors)
                for col in 0..<columns {
                    for c in 0..<colors {
                        let bit = (col * colors + c) * bpc
                        let byteIndex = rowStart + bit / 8
                        guard byteIndex < rowEnd else { break }
                        let shift = 8 - bpc - bit % 8
                        let v = (Int(out[byteIndex]) >> shift) & mask
                        let nv = (v + prevSamples[c]) & mask
                        prevSamples[c] = nv
                        out[byteIndex] = UInt8((Int(out[byteIndex]) & ~(mask << shift)) | (nv << shift))
                    }
                }
            }
            rowStart += rowBytes
        }
        return out
    }

    // MARK: LZW

    static func lzwDecode(_ data: Data, earlyChange: Int = 1) throws -> Data {
        let src = [UInt8](data)
        var out = [UInt8]()
        out.reserveCapacity(src.count * 3)
        var prefix = [Int](repeating: -1, count: 4096)
        var suffix = [UInt8](repeating: 0, count: 4096)
        var length = [Int](repeating: 0, count: 4096)
        for i in 0..<256 { suffix[i] = UInt8(i); length[i] = 1 }
        var next = 258
        var codeLength = 9
        var previous = -1
        var bitBuffer = 0, bitCount = 0, index = 0
        var stack = [UInt8](repeating: 0, count: 4096)
        func firstByte(_ code: Int) -> UInt8 {
            var c = code
            while prefix[c] >= 0 { c = prefix[c] }
            return suffix[c]
        }
        while true {
            while bitCount < codeLength {
                guard index < src.count else { return Data(out) }
                bitBuffer = (bitBuffer << 8) | Int(src[index])
                index += 1
                bitCount += 8
            }
            let code = (bitBuffer >> (bitCount - codeLength)) & ((1 << codeLength) - 1)
            bitCount -= codeLength
            bitBuffer &= (1 << bitCount) - 1
            if code == 256 { next = 258; codeLength = 9; previous = -1; continue }
            if code == 257 { break }
            var entry: Int
            if code < next && (code < 256 || length[code] > 0) {
                entry = code
                if previous >= 0, next < 4096 {
                    prefix[next] = previous
                    suffix[next] = firstByte(code)
                    length[next] = length[previous] + 1
                    next += 1
                }
            } else if code == next, previous >= 0, next < 4096 {
                prefix[next] = previous
                suffix[next] = firstByte(previous)
                length[next] = length[previous] + 1
                next += 1
                entry = code
            } else {
                break // corrupt
            }
            // Emit entry.
            var n = 0
            var c = entry
            while c >= 0 && n < 4096 { stack[n] = suffix[c]; n += 1; c = prefix[c] }
            for k in stride(from: n - 1, through: 0, by: -1) { out.append(stack[k]) }
            previous = entry
            if next + earlyChange >= 512 && codeLength == 9 { codeLength = 10 }
            else if next + earlyChange >= 1024 && codeLength == 10 { codeLength = 11 }
            else if next + earlyChange >= 2048 && codeLength == 11 { codeLength = 12 }
        }
        return Data(out)
    }

    // MARK: ASCII filters, RunLength

    static func asciiHexDecode(_ data: Data) -> Data {
        var out = [UInt8]()
        out.reserveCapacity(data.count / 2)
        var high: Int?
        for b in data {
            if b == 0x3E { break }
            guard let v = CosBytes.hexValue(b) else { continue }
            if let h = high { out.append(UInt8(h << 4 | v)); high = nil } else { high = v }
        }
        if let h = high { out.append(UInt8(h << 4)) }
        return Data(out)
    }

    static func asciiHexEncode(_ data: Data) -> Data {
        var out: [UInt8] = []
        CosSerializer.writeHex([UInt8](data), into: &out)
        return Data(out.dropFirst()) // keep trailing '>' as EOD marker
    }

    static func ascii85Decode(_ data: Data) throws -> Data {
        var out = [UInt8]()
        out.reserveCapacity(data.count * 4 / 5)
        var group = [UInt32]()
        group.reserveCapacity(5)
        var bytes = [UInt8](data)
        if bytes.count >= 2, bytes[0] == 0x3C, bytes[1] == 0x7E { bytes.removeFirst(2) }
        for b in bytes {
            if b == 0x7E { break } // ~>
            if CosBytes.isWhitespace(b) { continue }
            if b == 0x7A && group.isEmpty { out += [0, 0, 0, 0]; continue }
            guard b >= 0x21 && b <= 0x75 else { continue }
            group.append(UInt32(b - 0x21))
            if group.count == 5 {
                let v = group.reduce(UInt32(0)) { $0 &* 85 &+ $1 }
                out += [UInt8(v >> 24), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)]
                group.removeAll(keepingCapacity: true)
            }
        }
        if group.count > 1 {
            let n = group.count
            while group.count < 5 { group.append(84) }
            let v = group.reduce(UInt32(0)) { $0 &* 85 &+ $1 }
            let full = [UInt8(v >> 24), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)]
            out += full.prefix(n - 1)
        }
        return Data(out)
    }

    static func ascii85Encode(_ data: Data) -> Data {
        var out = [UInt8]()
        let src = [UInt8](data)
        var i = 0
        while i < src.count {
            let n = min(4, src.count - i)
            var v: UInt32 = 0
            for k in 0..<4 { v = v << 8 | UInt32(k < n ? src[i + k] : 0) }
            if v == 0 && n == 4 { out.append(0x7A) } else {
                var chars = [UInt8](repeating: 0, count: 5)
                for k in stride(from: 4, through: 0, by: -1) { chars[k] = UInt8(v % 85) + 0x21; v /= 85 }
                out += chars.prefix(n + 1)
            }
            i += 4
        }
        out += [0x7E, 0x3E]
        return Data(out)
    }

    static func runLengthDecode(_ data: Data) -> Data {
        let src = [UInt8](data)
        var out = [UInt8]()
        out.reserveCapacity(src.count * 2)
        var i = 0
        while i < src.count {
            let n = Int(src[i])
            i += 1
            if n == 128 { break }
            if n < 128 {
                let end = min(src.count, i + n + 1)
                out.append(contentsOf: src[i..<end])
                i = end
            } else if i < src.count {
                out.append(contentsOf: repeatElement(src[i], count: 257 - n))
                i += 1
            }
        }
        return Data(out)
    }
}
