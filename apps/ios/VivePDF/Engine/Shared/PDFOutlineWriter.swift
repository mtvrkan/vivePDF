import Foundation

/// Adds a bookmark (outline) tree to a PDF written by a Core Graphics PDF context, as an incremental
/// update appended to the file. Core Graphics cannot write outlines and PDFKit drops newly created
/// outline trees on save on current OS versions, so the few objects needed are written directly:
/// outline items, a copy of the catalog pointing at them, and an xref section chained with `/Prev`.
/// Only classic xref tables are supported (what Quartz writes); otherwise the file is left unchanged.
enum PDFOutlineWriter {
    struct Entry {
        var level: Int
        var title: String
        /// Zero-based page index.
        var page: Int
    }

    /// Writes `source` with `entries` as bookmarks to `output` (moves the file; `source` is consumed).
    static func write(_ entries: [Entry], source: URL, to output: URL) throws {
        if !entries.isEmpty, let data = try? Data(contentsOf: source), let updated = appendOutline(entries, to: data) {
            try updated.write(to: source, options: .atomic)
        }
        if FileManager.default.fileExists(atPath: output.path) { try FileManager.default.removeItem(at: output) }
        try FileManager.default.moveItem(at: source, to: output)
    }

    // MARK: Parsing (enough for Quartz output)

    private static func ascii(_ data: Data, _ range: Range<Int>) -> String {
        String(decoding: data[(data.startIndex + range.lowerBound)..<(data.startIndex + range.upperBound)], as: UTF8.self)
    }

    private static func lastRange(of needle: String, in data: Data) -> Range<Int>? {
        let tail = data.suffix(4096)
        guard let found = tail.lastRange(of: Data(needle.utf8)) else { return nil }
        let base = data.count - tail.count
        return (found.lowerBound - tail.startIndex + base)..<(found.upperBound - tail.startIndex + base)
    }

    private static func xrefOffsets(_ data: Data, at offset: Int) -> [Int: Int]? {
        guard offset < data.count else { return nil }
        let text = ascii(data, offset..<min(data.count, offset + 20 * 200_000))
        guard text.hasPrefix("xref") else { return nil }
        var offsets: [Int: Int] = [:]
        let lines = text.split(whereSeparator: { $0 == "\n" || $0 == "\r" })
        var index = 1
        while index < lines.count {
            let header = lines[index].split(separator: " ")
            if lines[index].hasPrefix("trailer") { break }
            guard header.count == 2, let start = Int(header[0]), let count = Int(header[1]) else { return nil }
            index += 1
            for number in 0..<count where index < lines.count {
                let parts = lines[index].split(separator: " ")
                if parts.count >= 3, parts[2].hasPrefix("n"), let position = Int(parts[0]) { offsets[start + number] = position }
                index += 1
            }
        }
        return offsets
    }

    private static func objectBody(_ data: Data, number: Int, offsets: [Int: Int]) -> String? {
        guard let start = offsets[number] else { return nil }
        let chunk = ascii(data, start..<min(data.count, start + 64 * 1024))
        guard let open = chunk.range(of: "obj"), let close = chunk.range(of: "endobj") else { return nil }
        return String(chunk[open.upperBound..<close.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func reference(_ key: String, in dictionary: String) -> Int? {
        guard let range = dictionary.range(of: #"/\#(key)\s+(\d+)\s+\d+\s+R"#, options: .regularExpression) else { return nil }
        let match = dictionary[range]
        return match.split(separator: " ").dropFirst().first.flatMap { Int($0.trimmingCharacters(in: .whitespaces)) }
            ?? Int(match.replacingOccurrences(of: #"/\#(key)\s+"#, with: "", options: .regularExpression).split(separator: " ").first ?? "")
    }

    private static func kids(_ dictionary: String) -> [Int] {
        guard let range = dictionary.range(of: #"/Kids\s*\[([^\]]*)\]"#, options: .regularExpression) else { return [] }
        let body = dictionary[range].replacingOccurrences(of: #"/Kids\s*\["#, with: "", options: .regularExpression).dropLast()
        let tokens = body.split(whereSeparator: \.isWhitespace)
        var out: [Int] = []
        var index = 0
        while index + 2 < tokens.count + 1 && index < tokens.count {
            if index + 2 < tokens.count, tokens[index + 2] == "R", let number = Int(tokens[index]) { out.append(number); index += 3 } else { index += 1 }
        }
        return out
    }

    private static func pageObjects(_ data: Data, root: Int, offsets: [Int: Int], depth: Int = 0) -> [Int] {
        guard depth < 32, let body = objectBody(data, number: root, offsets: offsets) else { return [] }
        if body.range(of: #"/Type\s*/Pages\b"#, options: .regularExpression) != nil {
            return kids(body).flatMap { pageObjects(data, root: $0, offsets: offsets, depth: depth + 1) }
        }
        return [root]
    }

    private static func pdfText(_ text: String) -> String {
        var hex = "<FEFF"
        for unit in text.utf16 { hex += String(format: "%04X", unit) }
        return hex + ">"
    }

    // MARK: Writing

    static func appendOutline(_ entries: [Entry], to data: Data) -> Data? {
        guard let startRange = lastRange(of: "startxref", in: data) else { return nil }
        let after = ascii(data, startRange.upperBound..<min(data.count, startRange.upperBound + 40))
        guard let xrefStart = after.split(whereSeparator: \.isWhitespace).first.flatMap({ Int($0) }),
              let offsets = xrefOffsets(data, at: xrefStart),
              let trailerRange = lastRange(of: "trailer", in: data) else { return nil }
        let trailer = ascii(data, trailerRange.upperBound..<startRange.lowerBound)
        guard let rootNumber = reference("Root", in: trailer),
              let sizeRange = trailer.range(of: #"/Size\s+(\d+)"#, options: .regularExpression),
              let size = Int(trailer[sizeRange].split(whereSeparator: \.isWhitespace).last ?? ""),
              let catalog = objectBody(data, number: rootNumber, offsets: offsets),
              let pagesRoot = reference("Pages", in: catalog) else { return nil }
        let pages = pageObjects(data, root: pagesRoot, offsets: offsets)
        guard !pages.isEmpty else { return nil }

        // Build the tree: each entry's parent is the nearest previous entry with a lower level.
        let outlineRoot = size
        var numbers: [Int] = []
        for index in entries.indices { numbers.append(size + 1 + index) }
        var parent = [Int](repeating: -1, count: entries.count)
        var stack: [Int] = []
        for (index, entry) in entries.enumerated() {
            while let last = stack.last, entries[last].level >= entry.level { stack.removeLast() }
            parent[index] = stack.last ?? -1
            stack.append(index)
        }
        func children(of node: Int) -> [Int] { entries.indices.filter { parent[$0] == node } }
        func descendants(of node: Int) -> Int { children(of: node).reduce(0) { $0 + 1 + descendants(of: $1) } }

        var body = Data()
        var newOffsets: [Int: Int] = [:]
        var cursor = data.count
        if data.last != 0x0A { body.append(0x0A); cursor += 1 }
        func emit(_ number: Int, _ text: String) {
            newOffsets[number] = cursor + body.count
            body.append(Data("\(number) 0 obj\n\(text)\nendobj\n".utf8))
        }
        let top = children(of: -1)
        emit(outlineRoot, "<< /Type /Outlines /First \(numbers[top.first!]) 0 R /Last \(numbers[top.last!]) 0 R /Count \(descendants(of: -1)) >>")
        for (index, entry) in entries.enumerated() {
            let siblings = children(of: parent[index])
            let position = siblings.firstIndex(of: index)!
            let page = pages[max(0, min(pages.count - 1, entry.page))]
            var dictionary = "<< /Title \(pdfText(entry.title)) /Parent \(parent[index] < 0 ? outlineRoot : numbers[parent[index]]) 0 R"
            dictionary += " /Dest [\(page) 0 R /XYZ null null null]"
            if position > 0 { dictionary += " /Prev \(numbers[siblings[position - 1]]) 0 R" }
            if position + 1 < siblings.count { dictionary += " /Next \(numbers[siblings[position + 1]]) 0 R" }
            let own = children(of: index)
            if let first = own.first, let last = own.last {
                dictionary += " /First \(numbers[first]) 0 R /Last \(numbers[last]) 0 R /Count \(entry.level <= 1 ? descendants(of: index) : -descendants(of: index))"
            }
            emit(numbers[index], dictionary + " >>")
        }
        var catalogBody = catalog.replacingOccurrences(of: #"/Outlines\s+\d+\s+\d+\s+R"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"/PageMode\s*/\w+"#, with: "", options: .regularExpression)
        guard let open = catalogBody.range(of: "<<") else { return nil }
        catalogBody.replaceSubrange(open, with: "<< /Outlines \(outlineRoot) 0 R /PageMode /UseOutlines ")
        emit(rootNumber, catalogBody)

        let xrefOffset = cursor + body.count
        var xref = "xref\n0 1\n0000000000 65535 f \n"
        let sorted = newOffsets.keys.sorted()
        var index = 0
        while index < sorted.count {
            var end = index
            while end + 1 < sorted.count && sorted[end + 1] == sorted[end] + 1 { end += 1 }
            xref += "\(sorted[index]) \(end - index + 1)\n"
            for number in sorted[index]...sorted[end] { xref += String(format: "%010d 00000 n \n", newOffsets[number]!) }
            index = end + 1
        }
        var newTrailer = "<< /Size \(size + 1 + entries.count) /Root \(rootNumber) 0 R /Prev \(xrefStart)"
        if let info = reference("Info", in: trailer) { newTrailer += " /Info \(info) 0 R" }
        if let id = trailer.range(of: #"/ID\s*\[[^\]]*\]"#, options: .regularExpression) { newTrailer += " " + trailer[id].replacingOccurrences(of: "\n", with: " ") }
        newTrailer += " >>"
        body.append(Data("\(xref)trailer\n\(newTrailer)\nstartxref\n\(xrefOffset)\n%%EOF\n".utf8))
        var result = data
        if data.last != 0x0A { result.append(0x0A) }
        result.append(body.dropFirst(data.last != 0x0A ? 1 : 0))
        return result
    }
}
