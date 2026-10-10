import Compression
import Foundation

/// Minimal ZIP reader/writer for `.vivedesign` projects (stored + raw DEFLATE via Compression).
enum StudioZip {
    struct Entry {
        var name: String
        var data: Data
        var compress: Bool
    }

    enum ZipError: Error { case corrupt, unsupported }

    // MARK: CRC-32

    private static let table: [UInt32] = (0..<256).map { n in
        var c = UInt32(n)
        for _ in 0..<8 { c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        data.withUnsafeBytes { raw in
            for byte in raw.bindMemory(to: UInt8.self) { crc = table[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8) }
        }
        return crc ^ 0xFFFF_FFFF
    }

    // MARK: Deflate

    static func deflate(_ data: Data) -> Data? {
        guard !data.isEmpty else { return Data() }
        let capacity = data.count + data.count / 10 + 1024
        var out = Data(count: capacity)
        let written = out.withUnsafeMutableBytes { dst in
            data.withUnsafeBytes { src in
                compression_encode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, capacity, src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written > 0 else { return nil }
        out.count = written
        return out
    }

    static func inflate(_ data: Data, size: Int) -> Data? {
        if size == 0 { return Data() }
        var out = Data(count: size)
        let written = out.withUnsafeMutableBytes { dst in
            data.withUnsafeBytes { src in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, size, src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written == size else { return nil }
        return out
    }

    // MARK: Writing

    private static func le16(_ v: Int) -> Data { var x = UInt16(truncatingIfNeeded: v).littleEndian; return Data(bytes: &x, count: 2) }
    private static func le32(_ v: UInt32) -> Data { var x = v.littleEndian; return Data(bytes: &x, count: 4) }

    static func archive(_ entries: [Entry]) throws -> Data {
        var body = Data()
        var central = Data()
        let (dosTime, dosDate) = dosStamp(Date())
        for entry in entries {
            let name = Data(entry.name.utf8)
            let crc = crc32(entry.data)
            var payload = entry.data
            var method = 0
            if entry.compress, let packed = deflate(entry.data), packed.count < entry.data.count { payload = packed; method = 8 }
            guard body.count < Int(UInt32.max), payload.count < Int(UInt32.max) else { throw ZipError.unsupported }
            let offset = UInt32(body.count)
            var local = Data()
            local += le32(0x0403_4B50) + le16(20) + le16(0x0800) + le16(method) + le16(dosTime) + le16(dosDate)
            local += le32(crc) + le32(UInt32(payload.count)) + le32(UInt32(entry.data.count)) + le16(name.count) + le16(0)
            local += name
            body += local
            body += payload
            var record = Data()
            record += le32(0x0201_4B50) + le16(20) + le16(20) + le16(0x0800) + le16(method) + le16(dosTime) + le16(dosDate)
            record += le32(crc) + le32(UInt32(payload.count)) + le32(UInt32(entry.data.count)) + le16(name.count) + le16(0) + le16(0)
            record += le16(0) + le16(0) + le32(0) + le32(offset)
            record += name
            central += record
        }
        let start = UInt32(body.count)
        var end = Data()
        end += le32(0x0605_4B50) + le16(0) + le16(0) + le16(entries.count) + le16(entries.count) + le32(UInt32(central.count)) + le32(start) + le16(0)
        return body + central + end
    }

    private static func dosStamp(_ date: Date) -> (Int, Int) {
        let c = Calendar(identifier: .gregorian).dateComponents(in: .current, from: date)
        let time = ((c.hour ?? 0) << 11) | ((c.minute ?? 0) << 5) | ((c.second ?? 0) / 2)
        let day = (max(0, (c.year ?? 1980) - 1980) << 9) | ((c.month ?? 1) << 5) | (c.day ?? 1)
        return (time, day)
    }

    // MARK: Reading

    struct Listing {
        let name: String
        let method: Int
        let compressedSize: Int
        let size: Int
        let localOffset: Int
    }

    private static func u16(_ d: Data, _ at: Int) -> Int { Int(d[d.startIndex + at]) | Int(d[d.startIndex + at + 1]) << 8 }
    private static func u32(_ d: Data, _ at: Int) -> Int { u16(d, at) | u16(d, at + 2) << 16 }

    static func list(_ data: Data) throws -> [Listing] {
        guard data.count >= 22 else { throw ZipError.corrupt }
        var eocd = -1
        var i = data.count - 22
        let floor = max(0, data.count - 22 - 65535)
        while i >= floor {
            if u32(data, i) == 0x0605_4B50 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw ZipError.corrupt }
        let count = u16(data, eocd + 10)
        var at = u32(data, eocd + 16)
        var result: [Listing] = []
        for _ in 0..<count {
            guard at + 46 <= data.count, u32(data, at) == 0x0201_4B50 else { throw ZipError.corrupt }
            let method = u16(data, at + 10)
            let compressed = u32(data, at + 20)
            let size = u32(data, at + 24)
            let nameLength = u16(data, at + 28), extra = u16(data, at + 30), comment = u16(data, at + 32)
            let offset = u32(data, at + 42)
            guard at + 46 + nameLength <= data.count else { throw ZipError.corrupt }
            let name = String(decoding: data[(data.startIndex + at + 46)..<(data.startIndex + at + 46 + nameLength)], as: UTF8.self)
            result.append(Listing(name: name, method: method, compressedSize: compressed, size: size, localOffset: offset))
            at += 46 + nameLength + extra + comment
        }
        return result
    }

    static func read(_ data: Data, _ entry: Listing, limit: Int = .max) throws -> Data {
        guard entry.size <= limit else { throw ZipError.unsupported }
        let at = entry.localOffset
        guard at + 30 <= data.count, u32(data, at) == 0x0403_4B50 else { throw ZipError.corrupt }
        let start = at + 30 + u16(data, at + 26) + u16(data, at + 28)
        guard start + entry.compressedSize <= data.count else { throw ZipError.corrupt }
        let payload = data[(data.startIndex + start)..<(data.startIndex + start + entry.compressedSize)]
        switch entry.method {
        case 0: return Data(payload)
        case 8:
            guard let out = inflate(Data(payload), size: entry.size) else { throw ZipError.corrupt }
            return out
        default: throw ZipError.unsupported
        }
    }
}
