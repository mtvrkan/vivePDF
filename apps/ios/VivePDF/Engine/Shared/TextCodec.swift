import Foundation

/// Decoding of user text files the way the desktop engine does (`_story.decode_text`): byte-order marks
/// first, then UTF-8, then the legacy Windows code pages Turkish users most often have, then Latin-1.
enum TextCodec {
    static func decode(_ data: Data, declared: String.Encoding? = nil) -> String {
        let boms: [([UInt8], String.Encoding)] = [
            ([0xFF, 0xFE, 0x00, 0x00], .utf32LittleEndian), ([0x00, 0x00, 0xFE, 0xFF], .utf32BigEndian),
            ([0xEF, 0xBB, 0xBF], .utf8), ([0xFF, 0xFE], .utf16LittleEndian), ([0xFE, 0xFF], .utf16BigEndian),
        ]
        for (mark, encoding) in boms where data.starts(with: mark) {
            if let text = String(data: data.dropFirst(mark.count), encoding: encoding) { return text }
        }
        if let declared, let text = String(data: data, encoding: declared) { return text }
        if let text = String(data: data, encoding: .utf8) { return text }
        let cp1254 = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.windowsLatin5.rawValue)))
        for encoding in [cp1254, .windowsCP1252] {
            if let text = String(data: data, encoding: encoding) { return text }
        }
        return String(decoding: data, as: UTF8.self)
    }

    /// `<meta charset=…>` / `encoding=` declared in the first bytes of an HTML or XML file.
    static func declaredCharset(_ data: Data) -> String.Encoding? {
        let head = String(decoding: data.prefix(4096), as: UTF8.self)
        guard let range = head.range(of: #"charset\s*=\s*["']?([A-Za-z0-9_.:-]+)"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
        let match = String(head[range])
        let name = match.replacingOccurrences(of: #"(?i)charset\s*=\s*["']?"#, with: "", options: .regularExpression)
        let cf = CFStringConvertIANACharSetNameToEncoding(name as CFString)
        guard cf != kCFStringEncodingInvalidId else { return nil }
        return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
    }

    /// Text without control characters that XML 1.0 (and therefore OOXML/EPUB) forbids.
    static func xmlSafe(_ text: String) -> String {
        guard text.unicodeScalars.contains(where: { !isXMLScalar($0) }) else { return text }
        var scalars = String.UnicodeScalarView()
        scalars.append(contentsOf: text.unicodeScalars.filter(isXMLScalar))
        return String(scalars)
    }

    private static func isXMLScalar(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x9, 0xA, 0xD, 0x20...0xD7FF, 0xE000...0xFFFD, 0x10000...0x10FFFF: true
        default: false
        }
    }
}

/// Escaping for XML / XHTML / HTML output.
enum XMLText {
    static func escape(_ text: String, quotes: Bool = true) -> String {
        var out = ""
        out.reserveCapacity(text.count)
        for character in TextCodec.xmlSafe(text) {
            switch character {
            case "&": out += "&amp;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            case "\"" where quotes: out += "&quot;"
            case "'" where quotes: out += "&apos;"
            default: out.append(character)
            }
        }
        return out
    }

    /// Removes tags and decodes the common entities (plain text of an HTML fragment).
    static func plain(_ html: String) -> String {
        var text = html.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        for (entity, value) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'"), ("&amp;", "&")] {
            text = text.replacingOccurrences(of: entity, with: value)
        }
        return text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
