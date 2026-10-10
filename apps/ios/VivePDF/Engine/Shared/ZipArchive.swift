import Foundation

// ZipArchive — a small, dependency-free ZIP reader/writer shared by every module that produces or reads
// OOXML (DOCX/XLSX/PPTX), EPUB, or ".zip" bundles of exported files.
//
// Writing:
//     let zip = try ZipWriter(url: target)              // creates/truncates the file
//     try zip.add("mimetype", data: Data("application/epub+zip".utf8), compress: false)
//     try zip.add("word/document.xml", string: xml)       // deflated by default
//     try zip.add("media/image1.png", contentsOf: fileURL, compress: false)
//     try zip.finish()                                    // writes the central directory; required
//
// Reading:
//     let zip = try ZipReader(url: source)                // or ZipReader(data:)
//     zip.entries.map(\.path)                             // every entry, in archive order
//     let xml = try zip.string("xl/sharedStrings.xml")    // nil when the entry does not exist
//     let bytes = try zip.data("word/media/image1.png")
//
// Compression uses the Compression framework's raw DEFLATE (via `NSData.compressed(using: .zlib)`),
// entries are "stored" or "deflated", CRC-32 is computed here. ZIP64 is not implemented: archives or
// entries beyond 4 GiB / 65 535 entries throw `ZipError.tooLarge` instead of producing a corrupt file.
// Entry names are written as UTF-8 (general-purpose flag bit 11).

enum ZipError: Error, Equatable {
    case notAZip
    case unsupportedMethod(UInt16)
    case corrupt(String)
    case tooLarge
    case finished
    case io(String)
}

enum ZipArchive {
    /// Standard CRC-32 (IEEE 802.3), as stored in ZIP headers.
    static func crc32(_ data: Data, seed: UInt32 = 0) -> UInt32 {
        var crc = ~seed
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            for byte in raw {
                crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
            }
        }
        return ~crc
    }

    private static let crcTable: [UInt32] = (0..<256).map { index -> UInt32 in
        var value = UInt32(index)
        for _ in 0..<8 { value = (value & 1) != 0 ? 0xEDB8_8320 ^ (value >> 1) : value >> 1 }
        return value
    }

    /// Raw DEFLATE (RFC 1951), the payload format of ZIP method 8.
    static func deflate(_ data: Data) throws -> Data {
        if data.isEmpty { return Data([0x03, 0x00]) }
        do { return try (data as NSData).compressed(using: .zlib) as Data } catch { throw ZipError.io("deflate") }
    }

    static func inflate(_ data: Data) throws -> Data {
        if data.isEmpty { return Data() }
        do { return try (data as NSData).decompressed(using: .zlib) as Data } catch { throw ZipError.corrupt("inflate") }
    }

    /// MS-DOS time and date fields used by ZIP headers (local time, 2-second resolution).
    static func dosDateTime(_ date: Date) -> (time: UInt16, date: UInt16) {
        let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let year = max(1980, min(2107, parts.year ?? 1980))
        let time = UInt16((parts.hour ?? 0) << 11 | (parts.minute ?? 0) << 5 | (parts.second ?? 0) / 2)
        let day = UInt16((year - 1980) << 9 | (parts.month ?? 1) << 5 | (parts.day ?? 1))
        return (time, day)
    }
}

// MARK: - Writer

/// Streams entries into a ZIP file. Each entry is compressed in memory, then appended.
final class ZipWriter {
    private struct CentralRecord {
        let name: Data
        let method: UInt16
        let crc: UInt32
        let compressedSize: UInt32
        let size: UInt32
        let offset: UInt32
        let time: UInt16
        let date: UInt16
        let isDirectory: Bool
    }

    private let handle: FileHandle
    private var offset: UInt64 = 0
    private var records: [CentralRecord] = []
    private var names = Set<String>()
    private var finished = false
    let url: URL

    init(url: URL) throws {
        self.url = url
        try? FileManager.default.removeItem(at: url)
        guard FileManager.default.createFile(atPath: url.path, contents: nil),
              let handle = try? FileHandle(forWritingTo: url) else { throw ZipError.io("create \(url.lastPathComponent)") }
        self.handle = handle
    }

    deinit { if !finished { try? handle.close() } }

    /// Adds `data` under `path` (forward slashes). Duplicate names are ignored after the first.
    func add(_ path: String, data: Data, compress: Bool = true, modified: Date = Date()) throws {
        guard !finished else { throw ZipError.finished }
        guard names.insert(path).inserted else { return }
        let crc = ZipArchive.crc32(data)
        var payload = data
        var method: UInt16 = 0
        if compress && data.count > 64 {
            let deflated = try ZipArchive.deflate(data)
            if deflated.count < data.count { payload = deflated; method = 8 }
        }
        guard data.count < Int(UInt32.max), payload.count < Int(UInt32.max),
              offset + UInt64(payload.count) + 30 + UInt64(path.utf8.count) < UInt64(UInt32.max),
              records.count < 0xFFFF else { throw ZipError.tooLarge }
        let name = Data(path.utf8)
        let stamp = ZipArchive.dosDateTime(modified)
        var header = Data(capacity: 30 + name.count)
        header.appendLE(UInt32(0x0403_4B50))
        header.appendLE(UInt16(20))                     // version needed
        header.appendLE(UInt16(0x0800))                 // UTF-8 names
        header.appendLE(method)
        header.appendLE(stamp.time)
        header.appendLE(stamp.date)
        header.appendLE(crc)
        header.appendLE(UInt32(payload.count))
        header.appendLE(UInt32(data.count))
        header.appendLE(UInt16(name.count))
        header.appendLE(UInt16(0))
        header.append(name)
        records.append(CentralRecord(name: name, method: method, crc: crc, compressedSize: UInt32(payload.count),
                                     size: UInt32(data.count), offset: UInt32(offset), time: stamp.time, date: stamp.date,
                                     isDirectory: path.hasSuffix("/")))
        try write(header)
        try write(payload)
    }

    func add(_ path: String, string: String, compress: Bool = true) throws {
        try add(path, data: Data(string.utf8), compress: compress)
    }

    func add(_ path: String, contentsOf file: URL, compress: Bool = true) throws {
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { throw ZipError.io("read \(file.lastPathComponent)") }
        let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date()
        try add(path, data: data, compress: compress, modified: modified)
    }

    func addDirectory(_ path: String) throws {
        try add(path.hasSuffix("/") ? path : path + "/", data: Data(), compress: false)
    }

    /// Writes the central directory and closes the file.
    func finish() throws {
        guard !finished else { return }
        let start = offset
        for record in records {
            var entry = Data(capacity: 46 + record.name.count)
            entry.appendLE(UInt32(0x0201_4B50))
            entry.appendLE(UInt16(0x0314))               // made by: Unix, 2.0
            entry.appendLE(UInt16(20))
            entry.appendLE(UInt16(0x0800))
            entry.appendLE(record.method)
            entry.appendLE(record.time)
            entry.appendLE(record.date)
            entry.appendLE(record.crc)
            entry.appendLE(record.compressedSize)
            entry.appendLE(record.size)
            entry.appendLE(UInt16(record.name.count))
            entry.appendLE(UInt16(0))                    // extra
            entry.appendLE(UInt16(0))                    // comment
            entry.appendLE(UInt16(0))                    // disk
            entry.appendLE(UInt16(0))                    // internal attributes
            entry.appendLE(record.isDirectory ? UInt32(0o040755) << 16 | 0x10 : UInt32(0o100644) << 16)
            entry.appendLE(record.offset)
            entry.append(record.name)
            try write(entry)
        }
        let size = offset - start
        guard offset < UInt64(UInt32.max) else { throw ZipError.tooLarge }
        var end = Data(capacity: 22)
        end.appendLE(UInt32(0x0605_4B50))
        end.appendLE(UInt16(0))
        end.appendLE(UInt16(0))
        end.appendLE(UInt16(records.count))
        end.appendLE(UInt16(records.count))
        end.appendLE(UInt32(size))
        end.appendLE(UInt32(start))
        end.appendLE(UInt16(0))
        try write(end)
        finished = true
        do { try handle.close() } catch { throw ZipError.io("close") }
    }

    private func write(_ data: Data) throws {
        do { try handle.write(contentsOf: data) } catch { throw ZipError.io("write") }
        offset += UInt64(data.count)
        guard offset < UInt64(UInt32.max) else { throw ZipError.tooLarge }
    }
}

// MARK: - Reader

struct ZipEntry: Hashable {
    let path: String
    let method: UInt16
    let crc: UInt32
    let compressedSize: Int
    let size: Int
    let headerOffset: Int
    var isDirectory: Bool { path.hasSuffix("/") }
}

/// Reads a ZIP archive held in memory (files are memory-mapped).
struct ZipReader {
    let entries: [ZipEntry]
    private let bytes: Data
    private let index: [String: Int]

    init(url: URL) throws {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { throw ZipError.io("read \(url.lastPathComponent)") }
        try self.init(data: data)
    }

    init(data: Data) throws {
        bytes = data
        let count = data.count
        guard count >= 22 else { throw ZipError.notAZip }
        // The end-of-central-directory record sits in the last 22 + 65 535 bytes.
        var eocd = -1
        var position = count - 22
        let floor = max(0, count - 22 - 0xFFFF)
        while position >= floor {
            if data.readLE32(position) == 0x0605_4B50 { eocd = position; break }
            position -= 1
        }
        guard eocd >= 0 else { throw ZipError.notAZip }
        let total = Int(data.readLE16(eocd + 10))
        let directorySize = Int(data.readLE32(eocd + 12))
        let directoryOffset = Int(data.readLE32(eocd + 16))
        if directorySize == 0xFFFF_FFFF || directoryOffset == 0xFFFF_FFFF { throw ZipError.tooLarge }
        guard directoryOffset + directorySize <= count else { throw ZipError.corrupt("central directory") }
        var list: [ZipEntry] = []
        var cursor = directoryOffset
        for _ in 0..<total {
            guard cursor + 46 <= count, data.readLE32(cursor) == 0x0201_4B50 else { throw ZipError.corrupt("entry header") }
            let flags = data.readLE16(cursor + 8)
            let method = data.readLE16(cursor + 10)
            let crc = data.readLE32(cursor + 16)
            let compressed = Int(data.readLE32(cursor + 20))
            let size = Int(data.readLE32(cursor + 24))
            let nameLength = Int(data.readLE16(cursor + 28))
            let extraLength = Int(data.readLE16(cursor + 30))
            let commentLength = Int(data.readLE16(cursor + 32))
            let offset = Int(data.readLE32(cursor + 42))
            guard cursor + 46 + nameLength <= count else { throw ZipError.corrupt("entry name") }
            let nameData = data.subdata(in: (data.startIndex + cursor + 46)..<(data.startIndex + cursor + 46 + nameLength))
            let name = (flags & 0x0800) != 0
                ? String(decoding: nameData, as: UTF8.self)
                : (String(data: nameData, encoding: .utf8) ?? String(data: nameData, encoding: .isoLatin1) ?? "")
            if compressed == 0xFFFF_FFFF || size == 0xFFFF_FFFF || offset == 0xFFFF_FFFF { throw ZipError.tooLarge }
            list.append(ZipEntry(path: name.replacingOccurrences(of: "\\", with: "/"), method: method, crc: crc,
                                 compressedSize: compressed, size: size, headerOffset: offset))
            cursor += 46 + nameLength + extraLength + commentLength
        }
        entries = list
        var map: [String: Int] = [:]
        for (position, entry) in list.enumerated() where map[entry.path] == nil { map[entry.path] = position }
        index = map
    }

    func entry(_ path: String) -> ZipEntry? {
        if let position = index[path] { return entries[position] }
        // OOXML part names are case-insensitive.
        let lower = path.lowercased()
        return entries.first { $0.path.lowercased() == lower }
    }

    func contains(_ path: String) -> Bool { entry(path) != nil }

    /// Uncompressed bytes of an entry, or nil when it does not exist.
    func data(_ path: String) throws -> Data? {
        guard let entry = entry(path) else { return nil }
        return try data(of: entry)
    }

    func string(_ path: String) throws -> String? {
        try data(path).map { String(decoding: $0, as: UTF8.self) }
    }

    func data(of entry: ZipEntry) throws -> Data {
        let start = entry.headerOffset
        guard start + 30 <= bytes.count, bytes.readLE32(start) == 0x0403_4B50 else { throw ZipError.corrupt("local header") }
        let nameLength = Int(bytes.readLE16(start + 26))
        let extraLength = Int(bytes.readLE16(start + 28))
        let begin = start + 30 + nameLength + extraLength
        guard begin + entry.compressedSize <= bytes.count else { throw ZipError.corrupt("entry data") }
        let payload = bytes.subdata(in: (bytes.startIndex + begin)..<(bytes.startIndex + begin + entry.compressedSize))
        let output: Data
        switch entry.method {
        case 0: output = payload
        case 8: output = try ZipArchive.inflate(payload)
        default: throw ZipError.unsupportedMethod(entry.method)
        }
        if output.count != entry.size { throw ZipError.corrupt("size of \(entry.path)") }
        return output
    }

    /// Extracts every file entry into `folder`, refusing paths that escape it.
    func extractAll(to folder: URL) throws {
        let root = folder.standardizedFileURL.path
        for entry in entries {
            let target = folder.appendingPathComponent(entry.path).standardizedFileURL
            guard target.path.hasPrefix(root) else { continue }
            if entry.isDirectory {
                try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
                continue
            }
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data(of: entry).write(to: target)
        }
    }
}

// MARK: - Little-endian helpers

fileprivate extension Data {
    mutating func appendLE(_ value: UInt16) {
        append(UInt8(value & 0xFF))
        append(UInt8(value >> 8))
    }

    mutating func appendLE(_ value: UInt32) {
        append(UInt8(value & 0xFF))
        append(UInt8((value >> 8) & 0xFF))
        append(UInt8((value >> 16) & 0xFF))
        append(UInt8(value >> 24))
    }

    func readLE16(_ offset: Int) -> UInt16 {
        let base = startIndex + offset
        return UInt16(self[base]) | UInt16(self[base + 1]) << 8
    }

    func readLE32(_ offset: Int) -> UInt32 {
        let base = startIndex + offset
        return UInt32(self[base]) | UInt32(self[base + 1]) << 8 | UInt32(self[base + 2]) << 16 | UInt32(self[base + 3]) << 24
    }
}
