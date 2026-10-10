import CoreGraphics
import Foundation

/// Reads and writes `/PageLabels`. PDFKit can show labels (`PDFPage.label`) but cannot set them, so labels
/// are read through Core Graphics and written as a small incremental update of the saved file.
enum PageLabelsIO {
    /// One page's label: style (`D r R a A` or empty), prefix and number (`LabelParts` on desktop).
    struct Part: Hashable, Sendable {
        var style: String
        var prefix: String
        var number: Int

        static func plain(_ position: Int) -> Part { Part(style: "D", prefix: "", number: position + 1) }
    }

    // MARK: Reading

    /// Per-page label parts of a document, or nil when it has no page labels.
    static func parts(of url: URL, password: String? = nil) -> [Part]? {
        guard let document = CGPDFDocument(url as CFURL) else { return nil }
        if document.isEncrypted, !document.isUnlocked { _ = document.unlockWithPassword(password ?? "") }
        return parts(of: document)
    }

    static func parts(of document: CGPDFDocument) -> [Part]? {
        guard let catalog = document.catalog else { return nil }
        var labels: CGPDFDictionaryRef?
        guard CGPDFDictionaryGetDictionary(catalog, "PageLabels", &labels), let labels else { return nil }
        var entries: [(start: Int, style: String, prefix: String, first: Int)] = []
        collect(labels, into: &entries, depth: 0)
        guard !entries.isEmpty else { return nil }
        entries.sort { $0.start < $1.start }
        var result: [Part] = []
        var current = -1
        for index in 0..<document.numberOfPages {
            while current + 1 < entries.count && entries[current + 1].start <= index { current += 1 }
            if current < 0 { result.append(.plain(index)); continue }
            let rule = entries[current]
            result.append(Part(style: rule.style, prefix: rule.prefix, number: rule.first + index - rule.start))
        }
        return result
    }

    private static func collect(_ node: CGPDFDictionaryRef, into entries: inout [(start: Int, style: String, prefix: String, first: Int)], depth: Int) {
        guard depth < 16 else { return }
        var nums: CGPDFArrayRef?
        if CGPDFDictionaryGetArray(node, "Nums", &nums), let nums {
            let count = CGPDFArrayGetCount(nums)
            var index = 0
            while index + 1 < count {
                var start: CGPDFInteger = 0
                var dict: CGPDFDictionaryRef?
                if CGPDFArrayGetInteger(nums, index, &start), CGPDFArrayGetDictionary(nums, index + 1, &dict), let dict {
                    var style: UnsafePointer<CChar>?
                    let styleName = CGPDFDictionaryGetName(dict, "S", &style) ? style.map { String(cString: $0) } ?? "" : ""
                    var prefixRef: CGPDFStringRef?
                    let prefix = CGPDFDictionaryGetString(dict, "P", &prefixRef) ? prefixRef.flatMap { CGPDFStringCopyTextString($0) as String? } ?? "" : ""
                    var first: CGPDFInteger = 1
                    if !CGPDFDictionaryGetInteger(dict, "St", &first) { first = 1 }
                    entries.append((Int(start), styleName, prefix, max(1, Int(first))))
                }
                index += 2
            }
        }
        var kids: CGPDFArrayRef?
        if CGPDFDictionaryGetArray(node, "Kids", &kids), let kids {
            for index in 0..<CGPDFArrayGetCount(kids) {
                var kid: CGPDFDictionaryRef?
                if CGPDFArrayGetDictionary(kids, index, &kid), let kid { collect(kid, into: &entries, depth: depth + 1) }
            }
        }
    }

    // MARK: Rules

    /// Compresses per-page parts into label ranges (`label_rules`).
    static func rules(_ parts: [Part]) -> [PageLabelRule] {
        var rules: [PageLabelRule] = []
        var previous: Part?
        for (position, part) in parts.enumerated() {
            let continues = previous.map { $0.style == part.style && $0.prefix == part.prefix && (part.style.isEmpty || part.number == $0.number + 1) } ?? false
            if !continues {
                rules.append(PageLabelRule(start: position, style: PageLabelStyle(rawValue: part.style) ?? .decimal, prefix: part.prefix, firstNumber: part.number))
            }
            previous = part
        }
        return rules
    }

    /// Expands explicit rules to one part per page (`explicit_label_parts`).
    static func parts(rules: [PageLabelRule], total: Int) -> [Part] {
        let ordered = rules.filter { $0.start < total }.sorted { $0.start < $1.start }
        var parts: [Part] = []
        var current: PageLabelRule?
        var upcoming = ordered.makeIterator()
        var following = upcoming.next()
        for position in 0..<total {
            while let next = following, next.start <= position {
                current = next
                following = upcoming.next()
            }
            if let current {
                parts.append(Part(style: current.style.rawValue, prefix: current.prefix, number: current.firstNumber + position - current.start))
            } else {
                parts.append(.plain(position))
            }
        }
        return parts
    }

    /// True when the parts equal plain 1, 2, 3… numbering (no labels needed).
    static func isPlain(_ parts: [Part]) -> Bool {
        parts.enumerated().allSatisfy { $0.element == .plain($0.offset) }
    }

    // MARK: Writing

    /// Writes `rules` as the document's `/PageLabels` (nil or empty removes them). Returns false when the
    /// file layout is not one we can patch safely (e.g. encrypted or cross-reference streams).
    @discardableResult
    static func write(_ rules: [PageLabelRule]?, to url: URL) throws -> Bool {
        let value: String?
        if let rules, !rules.isEmpty {
            var nums = ""
            for rule in rules.sorted(by: { $0.start < $1.start }) {
                var dict = "<<"
                if rule.style != .none { dict += " /S /\(rule.style.rawValue)" }
                if !rule.prefix.isEmpty { dict += " /P \(PagesCatalogPatcher.textString(rule.prefix))" }
                if rule.firstNumber != 1 { dict += " /St \(rule.firstNumber)" }
                dict += " >>"
                nums += " \(rule.start) \(dict)"
            }
            value = "<< /Nums [\(nums) ] >>"
        } else {
            value = nil
        }
        return try PagesCatalogPatcher.setEntries(["PageLabels": value], in: url)
    }
}

/// Minimal incremental-update writer for documents saved by PDFKit (classic xref tables):
/// rewrites the catalog with changed entries and appends a new xref section.
enum PagesCatalogPatcher {
    /// `value` is serialized PDF syntax for a direct object; nil removes the key.
    static func setEntries(_ entries: [String: String?], in url: URL) throws -> Bool {
        var data = try Data(contentsOf: url)
        let bytes = [UInt8](data)
        guard let startxrefRange = lastRange(of: Array("startxref".utf8), in: bytes),
              let prevXref = readInt(bytes, from: startxrefRange.upperBound),
              prevXref < bytes.count, bytes[prevXref...].starts(with: Array("xref".utf8)) else { return false }
        guard let trailerRange = lastRange(of: Array("trailer".utf8), in: bytes, before: startxrefRange.lowerBound),
              let trailerOpen = firstRange(of: Array("<<".utf8), in: bytes, from: trailerRange.upperBound)?.lowerBound,
              let trailerEnd = PagesPDFSyntax.skipValue(bytes, trailerOpen) else { return false }
        let trailer = PagesPDFSyntax.topLevelEntries(bytes, trailerOpen, trailerEnd)
        if trailer["Encrypt"] != nil { return false }
        guard let rootText = trailer["Root"], let rootRef = PagesPDFSyntax.reference(rootText),
              let sizeText = trailer["Size"], let size = Int(sizeText.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        // Locate the catalog object (the last definition wins).
        let header = Array("\(rootRef.number) \(rootRef.generation) obj".utf8)
        var searchEnd = bytes.count
        var objectStart: Int?
        while let found = lastRange(of: header, in: bytes, before: searchEnd) {
            if found.lowerBound == 0 || PagesPDFSyntax.isWhitespace(bytes[found.lowerBound - 1]) { objectStart = found.upperBound; break }
            searchEnd = found.lowerBound
        }
        guard let objectStart, let dictOpen = firstRange(of: Array("<<".utf8), in: bytes, from: objectStart)?.lowerBound,
              let dictEnd = PagesPDFSyntax.skipValue(bytes, dictOpen) else { return false }
        // Rebuild the dictionary without the replaced keys.
        var kept = ""
        for (key, value) in PagesPDFSyntax.orderedEntries(bytes, dictOpen, dictEnd) where entries.index(forKey: key) == nil {
            kept += " /\(key) \(value)"
        }
        var newObjects: [(number: Int, generation: Int, body: String)] = []
        var nextNumber = size
        for (key, value) in entries.sorted(by: { $0.key < $1.key }) {
            guard let value else { continue }
            newObjects.append((nextNumber, 0, value))
            kept += " /\(key) \(nextNumber) 0 R"
            nextNumber += 1
        }
        newObjects.append((rootRef.number, rootRef.generation, "<<\(kept) >>"))

        var appended = Data("\n".utf8)
        var offsets: [(number: Int, generation: Int, offset: Int)] = []
        for object in newObjects {
            offsets.append((object.number, object.generation, data.count + appended.count))
            appended += Data("\(object.number) \(object.generation) obj\n\(object.body)\nendobj\n".utf8)
        }
        let xrefOffset = data.count + appended.count
        var xref = "xref\n"
        for entry in offsets.sorted(by: { $0.number < $1.number }) {
            xref += "\(entry.number) 1\n" + String(format: "%010d %05d n \n", entry.offset, entry.generation)
        }
        var trailerText = "trailer\n<< /Size \(max(size, nextNumber)) /Root \(rootRef.number) \(rootRef.generation) R /Prev \(prevXref)"
        for key in ["Info", "ID"] { if let value = trailer[key] { trailerText += " /\(key) \(value)" } }
        trailerText += " >>\nstartxref\n\(xrefOffset)\n%%EOF\n"
        appended += Data((xref + trailerText).utf8)
        data += appended
        try data.write(to: url, options: .atomic)
        return true
    }

    /// A PDF text string: literal for printable ASCII, UTF-16BE hex otherwise.
    static func textString(_ text: String) -> String {
        if text.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value < 0x7f }) {
            let escaped = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "(", with: "\\(").replacingOccurrences(of: ")", with: "\\)")
            return "(\(escaped))"
        }
        var hex = "<FEFF"
        for unit in text.utf16 { hex += String(format: "%04X", unit) }
        return hex + ">"
    }

    private static func readInt(_ bytes: [UInt8], from start: Int) -> Int? {
        var index = start
        while index < bytes.count, PagesPDFSyntax.isWhitespace(bytes[index]) { index += 1 }
        var value = 0
        var digits = 0
        while index < bytes.count, bytes[index] >= 48, bytes[index] <= 57 {
            value = value * 10 + Int(bytes[index] - 48)
            index += 1
            digits += 1
        }
        return digits > 0 ? value : nil
    }

    static func lastRange(of needle: [UInt8], in bytes: [UInt8], before end: Int? = nil) -> Range<Int>? {
        let limit = min(end ?? bytes.count, bytes.count)
        guard needle.count <= limit else { return nil }
        var index = limit - needle.count
        while index >= 0 {
            if bytes[index] == needle[0], Array(bytes[index..<index + needle.count]) == needle { return index..<index + needle.count }
            index -= 1
        }
        return nil
    }

    static func firstRange(of needle: [UInt8], in bytes: [UInt8], from start: Int) -> Range<Int>? {
        guard needle.count <= bytes.count else { return nil }
        var index = start
        while index + needle.count <= bytes.count {
            if bytes[index] == needle[0], Array(bytes[index..<index + needle.count]) == needle { return index..<index + needle.count }
            index += 1
        }
        return nil
    }
}

/// Just enough PDF syntax scanning to copy dictionary entries verbatim.
enum PagesPDFSyntax {
    static func isWhitespace(_ byte: UInt8) -> Bool { byte == 0x20 || byte == 0x0a || byte == 0x0d || byte == 0x09 || byte == 0x0c || byte == 0x00 }
    static func isDelimiter(_ byte: UInt8) -> Bool { "()<>[]{}/%".utf8.contains(byte) }

    static func skipWhitespace(_ bytes: [UInt8], _ start: Int) -> Int {
        var index = start
        while index < bytes.count {
            if isWhitespace(bytes[index]) { index += 1; continue }
            if bytes[index] == UInt8(ascii: "%") {
                while index < bytes.count, bytes[index] != 0x0a, bytes[index] != 0x0d { index += 1 }
                continue
            }
            break
        }
        return index
    }

    /// Index just past the object starting at `start` (whitespace already skipped), or nil.
    static func skipValue(_ bytes: [UInt8], _ start: Int) -> Int? {
        guard start < bytes.count else { return nil }
        let byte = bytes[start]
        if byte == UInt8(ascii: "<"), start + 1 < bytes.count, bytes[start + 1] == UInt8(ascii: "<") {
            var index = start + 2
            while true {
                index = skipWhitespace(bytes, index)
                guard index < bytes.count else { return nil }
                if bytes[index] == UInt8(ascii: ">"), index + 1 < bytes.count, bytes[index + 1] == UInt8(ascii: ">") { return index + 2 }
                guard let next = skipValue(bytes, index) else { return nil }
                index = next
            }
        }
        if byte == UInt8(ascii: "[") {
            var index = start + 1
            while true {
                index = skipWhitespace(bytes, index)
                guard index < bytes.count else { return nil }
                if bytes[index] == UInt8(ascii: "]") { return index + 1 }
                guard let next = skipValue(bytes, index) else { return nil }
                index = next
            }
        }
        if byte == UInt8(ascii: "(") {
            var depth = 0
            var index = start
            while index < bytes.count {
                let c = bytes[index]
                if c == UInt8(ascii: "\\") { index += 2; continue }
                if c == UInt8(ascii: "(") { depth += 1 }
                if c == UInt8(ascii: ")") { depth -= 1; if depth == 0 { return index + 1 } }
                index += 1
            }
            return nil
        }
        if byte == UInt8(ascii: "<") {
            guard let close = bytes[start...].firstIndex(of: UInt8(ascii: ">")) else { return nil }
            return close + 1
        }
        if byte == UInt8(ascii: "/") {
            var index = start + 1
            while index < bytes.count, !isWhitespace(bytes[index]), !isDelimiter(bytes[index]) { index += 1 }
            return index
        }
        // Number, keyword, or an indirect reference "n g R".
        var index = start
        while index < bytes.count, !isWhitespace(bytes[index]), !isDelimiter(bytes[index]) { index += 1 }
        guard index > start else { return nil }
        let token = String(decoding: bytes[start..<index], as: UTF8.self)
        if Int(token) != nil {
            let second = skipWhitespace(bytes, index)
            var secondEnd = second
            while secondEnd < bytes.count, bytes[secondEnd] >= 48, bytes[secondEnd] <= 57 { secondEnd += 1 }
            if secondEnd > second {
                let third = skipWhitespace(bytes, secondEnd)
                if third < bytes.count, bytes[third] == UInt8(ascii: "R"),
                   third + 1 >= bytes.count || isWhitespace(bytes[third + 1]) || isDelimiter(bytes[third + 1]) {
                    return third + 1
                }
            }
        }
        return index
    }

    /// Key → raw value text of a dictionary spanning `open..<end` (`<<` … `>>`), in file order.
    static func orderedEntries(_ bytes: [UInt8], _ open: Int, _ end: Int) -> [(String, String)] {
        var result: [(String, String)] = []
        var index = open + 2
        while true {
            index = skipWhitespace(bytes, index)
            guard index < end - 2, bytes[index] == UInt8(ascii: "/"), let keyEnd = skipValue(bytes, index) else { break }
            let key = String(decoding: bytes[(index + 1)..<keyEnd], as: UTF8.self)
            let valueStart = skipWhitespace(bytes, keyEnd)
            guard let valueEnd = skipValue(bytes, valueStart) else { break }
            result.append((key, String(decoding: bytes[valueStart..<valueEnd], as: UTF8.self)))
            index = valueEnd
        }
        return result
    }

    static func topLevelEntries(_ bytes: [UInt8], _ open: Int, _ end: Int) -> [String: String] {
        Dictionary(orderedEntries(bytes, open, end), uniquingKeysWith: { _, last in last })
    }

    static func reference(_ text: String) -> (number: Int, generation: Int)? {
        let parts = text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\r" || $0 == "\t" })
        guard parts.count == 3, parts[2] == "R", let number = Int(parts[0]), let generation = Int(parts[1]) else { return nil }
        return (number, generation)
    }
}
