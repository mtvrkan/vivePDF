import Foundation

/// One styled piece of inline text from Markdown.
struct MDInline: Equatable {
    enum Kind: Equatable {
        case text(String)
        case code(String)
        case lineBreak
        case image(source: String, alt: String)
    }

    var kind: Kind
    var bold = false
    var italic = false
    var strike = false
    var link: String?

    static func text(_ value: String) -> MDInline { MDInline(kind: .text(value)) }

    var plainText: String {
        switch kind {
        case .text(let value), .code(let value): value
        case .lineBreak: "\n"
        case .image(_, let alt): alt
        }
    }
}

enum MDAlign: Equatable { case none, left, center, right }

/// Block structure of a Markdown (CommonMark + GFM tables) or structured plain-text document.
indirect enum MDBlock: Equatable {
    case heading(level: Int, [MDInline])
    /// `lines` keeps the original line breaks (short plain-text lines such as addresses or poems).
    case paragraph([MDInline], lines: Bool)
    case list(ordered: Bool, start: Int, items: [[MDBlock]])
    case code(String)
    case quote([MDBlock])
    case table(header: [[MDInline]], aligns: [MDAlign], rows: [[[MDInline]]])
    case rule
    case html(String)
}

extension Array where Element == MDInline {
    var plainText: String { map(\.plainText).joined() }
}

/// A pragmatic CommonMark block + inline parser: ATX/setext headings, paragraphs, fenced and indented
/// code, block quotes, nested bullet/ordered lists, thematic breaks, GFM pipe tables, emphasis, code
/// spans, links, images, autolinks, hard breaks and backslash escapes. Raw HTML blocks are kept as
/// `.html` (rendered as their text); inline tags are dropped except `<br>`.
enum MarkdownParser {
    static func parse(_ text: String) -> [MDBlock] {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false).map { expandTabs(String($0)) }
        return blocks(lines)
    }

    /// True when a text looks like Markdown (`MARKDOWN_HINT` on desktop).
    static func looksLikeMarkdown(_ text: String) -> Bool {
        text.range(of: #"(?m)^(#{1,6} |```|\|.+\|$|\* |> )"#, options: .regularExpression) != nil
    }

    // MARK: Blocks

    private static func expandTabs(_ line: String) -> String {
        guard line.contains("\t") else { return line }
        var out = ""
        var column = 0
        for character in line {
            if character == "\t" {
                let spaces = 4 - column % 4
                out += String(repeating: " ", count: spaces)
                column += spaces
            } else {
                out.append(character)
                column += 1
            }
        }
        return out
    }

    private static func indent(_ line: String) -> Int { line.prefix { $0 == " " }.count }
    private static func isBlank(_ line: String) -> Bool { line.allSatisfy { $0 == " " } }

    private static func matches(_ line: String, _ pattern: String) -> Bool {
        line.range(of: pattern, options: .regularExpression) != nil
    }

    private static func fence(_ line: String) -> (marker: Character, length: Int, info: String)? {
        guard indent(line) < 4 else { return nil }
        let body = line.drop { $0 == " " }
        guard let first = body.first, first == "`" || first == "~" else { return nil }
        let length = body.prefix { $0 == first }.count
        guard length >= 3 else { return nil }
        let info = body.dropFirst(length).trimmingCharacters(in: .whitespaces)
        if first == "`" && info.contains("`") { return nil }
        return (first, length, info)
    }

    private struct ListMarker {
        let ordered: Bool
        let bullet: Character
        let delimiter: Character
        let number: Int
        let contentIndent: Int
        let rest: String
    }

    private static func listMarker(_ line: String) -> ListMarker? {
        let lead = indent(line)
        guard lead < 4 else { return nil }
        let body = Array(line.dropFirst(lead))
        guard let first = body.first else { return nil }
        var markerWidth = 0
        var ordered = false
        var number = 1
        var delimiter: Character = "."
        if "-+*".contains(first) {
            markerWidth = 1
        } else if first.isASCII && first.isNumber {
            let digits = body.prefix { $0.isASCII && $0.isNumber }
            guard digits.count <= 9, body.count > digits.count, ".)".contains(body[digits.count]) else { return nil }
            ordered = true
            number = Int(String(digits)) ?? 1
            delimiter = body[digits.count]
            markerWidth = digits.count + 1
        } else {
            return nil
        }
        let after = body.dropFirst(markerWidth)
        if after.isEmpty { return ListMarker(ordered: ordered, bullet: first, delimiter: delimiter, number: number, contentIndent: lead + markerWidth + 1, rest: "") }
        guard after.first == " " else { return nil }
        var spaces = after.prefix { $0 == " " }.count
        if spaces > 4 { spaces = 1 }
        let rest = String(after.dropFirst(spaces))
        return ListMarker(ordered: ordered, bullet: first, delimiter: delimiter, number: number, contentIndent: lead + markerWidth + spaces, rest: rest)
    }

    private static let thematic = #"^ {0,3}(?:(?:-[ ]*){3,}|(?:\*[ ]*){3,}|(?:_[ ]*){3,})$"#
    private static let htmlStart = #"^ {0,3}(?:<!--|<(?:address|article|aside|blockquote|body|center|details|dialog|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|title|tr|ul|script|style)(?:\s|/?>|$))"#

    private static func startsBlock(_ line: String) -> Bool {
        if isBlank(line) { return true }
        if fence(line) != nil || matches(line, #"^ {0,3}#{1,6}(?: |$)"#) || matches(line, thematic) { return true }
        if matches(line, #"^ {0,3}>"#) || matches(line, htmlStart) { return true }
        if let marker = listMarker(line), !marker.rest.isEmpty, !marker.ordered || marker.number == 1 { return true }
        return false
    }

    private static func tableCells(_ line: String) -> [String] {
        var text = line.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("|") { text.removeFirst() }
        if text.hasSuffix("|") && !text.hasSuffix("\\|") { text.removeLast() }
        var cells: [String] = []
        var current = ""
        var escaped = false
        var inCode = false
        for character in text {
            if escaped { current.append(character); escaped = false; continue }
            if character == "\\" { escaped = true; current.append(character); continue }
            if character == "`" { inCode.toggle() }
            if character == "|" && !inCode { cells.append(current.trimmingCharacters(in: .whitespaces)); current = ""; continue }
            current.append(character)
        }
        cells.append(current.trimmingCharacters(in: .whitespaces))
        return cells.map { $0.replacingOccurrences(of: "\\|", with: "|") }
    }

    private static func delimiterRow(_ line: String) -> [MDAlign]? {
        guard line.contains("-"), matches(line, #"^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$"#) else { return nil }
        return tableCells(line).map { cell in
            let left = cell.hasPrefix(":"), right = cell.hasSuffix(":")
            return left && right ? .center : right ? .right : left ? .left : .none
        }
    }

    static func blocks(_ lines: [String]) -> [MDBlock] {
        var out: [MDBlock] = []
        var paragraph: [String] = []
        var index = 0

        func flush() {
            guard !paragraph.isEmpty else { return }
            let text = paragraph.map { $0.drop { $0 == " " } }.joined(separator: "\n")
            out.append(.paragraph(inlines(String(text)), lines: false))
            paragraph = []
        }

        while index < lines.count {
            let line = lines[index]
            if isBlank(line) { flush(); index += 1; continue }

            if indent(line) >= 4 && paragraph.isEmpty {
                var code: [String] = []
                while index < lines.count, isBlank(lines[index]) || indent(lines[index]) >= 4 {
                    code.append(String(lines[index].dropFirst(min(4, indent(lines[index])))))
                    index += 1
                }
                while code.last.map(isBlank) == true { code.removeLast() }
                out.append(.code(code.joined(separator: "\n")))
                continue
            }

            if let open = fence(line) {
                flush()
                let lead = indent(line)
                var code: [String] = []
                index += 1
                while index < lines.count {
                    let current = lines[index]
                    if let close = fence(current), close.marker == open.marker, close.length >= open.length, close.info.isEmpty { index += 1; break }
                    code.append(String(current.dropFirst(min(lead, indent(current)))))
                    index += 1
                }
                out.append(.code(code.joined(separator: "\n")))
                continue
            }

            if matches(line, #"^ {0,3}#{1,6}(?: |$)"#) {
                flush()
                let body = line.drop { $0 == " " }
                let level = body.prefix { $0 == "#" }.count
                var text = body.dropFirst(level).trimmingCharacters(in: .whitespaces)
                text = text.replacingOccurrences(of: #"(?:^|\s+)#+\s*$"#, with: "", options: .regularExpression)
                out.append(.heading(level: level, inlines(text)))
                index += 1
                continue
            }

            if !paragraph.isEmpty, matches(line, #"^ {0,3}(=+|-+)\s*$"#) {
                let level = line.contains("=") ? 1 : 2
                let text = paragraph.map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")
                paragraph = []
                out.append(.heading(level: level, inlines(text)))
                index += 1
                continue
            }

            if matches(line, thematic) {
                flush()
                out.append(.rule)
                index += 1
                continue
            }

            if matches(line, #"^ {0,3}>"#) {
                flush()
                var quoted: [String] = []
                while index < lines.count {
                    let current = lines[index]
                    if matches(current, #"^ {0,3}>"#) {
                        var body = current.drop { $0 == " " }.dropFirst()
                        if body.first == " " { body = body.dropFirst() }
                        quoted.append(String(body))
                    } else if !isBlank(current), !startsBlock(current), let last = quoted.last, !isBlank(last) {
                        quoted.append(current)
                    } else {
                        break
                    }
                    index += 1
                }
                out.append(.quote(blocks(quoted)))
                continue
            }

            if let marker = listMarker(line), paragraph.isEmpty || (!marker.rest.isEmpty && (!marker.ordered || marker.number == 1)) {
                flush()
                var items: [[String]] = []
                var current: [String] = [marker.rest]
                var contentIndent = marker.contentIndent
                var sawBlank = false
                index += 1
                while index < lines.count {
                    let next = lines[index]
                    if isBlank(next) {
                        current.append("")
                        sawBlank = true
                        index += 1
                        continue
                    }
                    if indent(next) >= contentIndent {
                        current.append(String(next.dropFirst(contentIndent)))
                        sawBlank = false
                        index += 1
                        continue
                    }
                    if let other = listMarker(next), other.ordered == marker.ordered,
                       other.ordered ? other.delimiter == marker.delimiter : other.bullet == marker.bullet {
                        items.append(current)
                        current = [other.rest]
                        contentIndent = other.contentIndent
                        sawBlank = false
                        index += 1
                        continue
                    }
                    if !sawBlank, !startsBlock(next), listMarker(next) == nil {
                        current.append(next.trimmingCharacters(in: .whitespaces))
                        index += 1
                        continue
                    }
                    break
                }
                items.append(current)
                let parsed = items.map { item -> [MDBlock] in
                    var trimmed = item
                    while trimmed.last.map(isBlank) == true { trimmed.removeLast() }
                    return blocks(trimmed)
                }
                out.append(.list(ordered: marker.ordered, start: marker.number, items: parsed))
                continue
            }

            if paragraph.isEmpty, line.contains("|"), index + 1 < lines.count, let aligns = delimiterRow(lines[index + 1]) {
                let header = tableCells(line)
                if header.count == aligns.count {
                    var rows: [[[MDInline]]] = []
                    index += 2
                    while index < lines.count, !isBlank(lines[index]), lines[index].contains("|") || !startsBlock(lines[index]) {
                        var cells = tableCells(lines[index])
                        if cells.count < header.count { cells += Array(repeating: "", count: header.count - cells.count) }
                        rows.append(cells.prefix(header.count).map { inlines($0) })
                        index += 1
                    }
                    out.append(.table(header: header.map { inlines($0) }, aligns: aligns, rows: rows))
                    continue
                }
            }

            if paragraph.isEmpty, matches(line, htmlStart) {
                var html: [String] = []
                while index < lines.count, !isBlank(lines[index]) {
                    html.append(lines[index])
                    index += 1
                }
                out.append(.html(html.joined(separator: "\n")))
                continue
            }

            paragraph.append(line)
            index += 1
        }
        flush()
        return out
    }

    // MARK: Inlines

    private struct Style {
        var bold = false
        var italic = false
        var strike = false
        var link: String?
    }

    static func inlines(_ text: String) -> [MDInline] {
        var out: [MDInline] = []
        parseInline(Array(text), style: Style(), into: &out)
        return merged(out)
    }

    private static func merged(_ items: [MDInline]) -> [MDInline] {
        var out: [MDInline] = []
        for item in items {
            if case .text(let value) = item.kind, var last = out.last, case .text(let previous) = last.kind,
               last.bold == item.bold, last.italic == item.italic, last.strike == item.strike, last.link == item.link {
                last.kind = .text(previous + value)
                out[out.count - 1] = last
            } else {
                out.append(item)
            }
        }
        return out
    }

    private static let punctuation = Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")

    private static func parseInline(_ chars: [Character], style: Style, into out: inout [MDInline]) {
        var buffer = ""
        var index = 0

        func emitText() {
            guard !buffer.isEmpty else { return }
            out.append(MDInline(kind: .text(buffer), bold: style.bold, italic: style.italic, strike: style.strike, link: style.link))
            buffer = ""
        }

        func find(_ needle: [Character], from start: Int) -> Int? {
            guard needle.count > 0, start <= chars.count - needle.count else { return nil }
            var position = start
            while position <= chars.count - needle.count {
                if chars[position] == "\\" { position += 2; continue }
                if Array(chars[position..<position + needle.count]) == needle { return position }
                position += 1
            }
            return nil
        }

        /// `[label](target)` starting at `open` (the `[`); returns label range, target, end index.
        func bracket(_ open: Int) -> (label: [Character], target: String, end: Int)? {
            var depth = 0
            var position = open
            while position < chars.count {
                let character = chars[position]
                if character == "\\" { position += 2; continue }
                if character == "[" { depth += 1 }
                if character == "]" { depth -= 1; if depth == 0 { break } }
                position += 1
            }
            guard position < chars.count, position + 1 < chars.count, chars[position + 1] == "(" else { return nil }
            let label = Array(chars[(open + 1)..<position])
            var close = position + 2
            var parens = 1
            while close < chars.count {
                if chars[close] == "\\" { close += 2; continue }
                if chars[close] == "(" { parens += 1 }
                if chars[close] == ")" { parens -= 1; if parens == 0 { break } }
                close += 1
            }
            guard close < chars.count else { return nil }
            var target = String(chars[(position + 2)..<close]).trimmingCharacters(in: .whitespaces)
            if let titleStart = target.range(of: #"\s+["'(]"#, options: .regularExpression) { target = String(target[..<titleStart.lowerBound]) }
            if target.hasPrefix("<") && target.hasSuffix(">") { target = String(target.dropFirst().dropLast()) }
            return (label, target, close + 1)
        }

        while index < chars.count {
            let character = chars[index]

            if character == "\\", index + 1 < chars.count {
                let next = chars[index + 1]
                if next == "\n" { emitText(); out.append(MDInline(kind: .lineBreak)); index += 2; continue }
                if punctuation.contains(next) { buffer.append(next); index += 2; continue }
            }

            if character == "\n" {
                if buffer.hasSuffix("  ") {
                    buffer = String(buffer.dropLast(2)).replacingOccurrences(of: #" +$"#, with: "", options: .regularExpression)
                    emitText()
                    out.append(MDInline(kind: .lineBreak))
                } else {
                    while buffer.hasSuffix(" ") { buffer.removeLast() }
                    buffer.append(" ")
                }
                index += 1
                while index < chars.count, chars[index] == " " { index += 1 }
                continue
            }

            if character == "`" {
                let run = chars[index...].prefix { $0 == "`" }.count
                if let close = find(Array(repeating: "`", count: run), from: index + run) {
                    var code = String(chars[(index + run)..<close]).replacingOccurrences(of: "\n", with: " ")
                    if code.hasPrefix(" ") && code.hasSuffix(" ") && code.trimmingCharacters(in: .whitespaces).count > 0 { code = String(code.dropFirst().dropLast()) }
                    emitText()
                    out.append(MDInline(kind: .code(code), bold: style.bold, italic: style.italic, strike: style.strike, link: style.link))
                    index = close + run
                    continue
                }
                buffer += String(repeating: "`", count: run)
                index += run
                continue
            }

            if character == "!", index + 1 < chars.count, chars[index + 1] == "[", let parsed = bracket(index + 1) {
                emitText()
                out.append(MDInline(kind: .image(source: parsed.target, alt: String(parsed.label)), link: style.link))
                index = parsed.end
                continue
            }

            if character == "[", let parsed = bracket(index) {
                emitText()
                var inner = style
                inner.link = parsed.target
                parseInline(parsed.label, style: inner, into: &out)
                index = parsed.end
                continue
            }

            if character == "<" {
                let rest = String(chars[index...])
                if let match = rest.range(of: #"^<(https?://[^\s<>]+|mailto:[^\s<>]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>"#, options: .regularExpression) {
                    let address = String(rest[match].dropFirst().dropLast())
                    emitText()
                    let target = address.contains("@") && !address.hasPrefix("mailto:") ? "mailto:\(address)" : address
                    out.append(MDInline(kind: .text(address), bold: style.bold, italic: style.italic, strike: style.strike, link: target))
                    index += rest.distance(from: rest.startIndex, to: match.upperBound)
                    continue
                }
                if let match = rest.range(of: #"^</?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?/?>"#, options: .regularExpression) {
                    let tag = rest[match].lowercased()
                    if tag.hasPrefix("<br") { emitText(); out.append(MDInline(kind: .lineBreak)) }
                    index += rest.distance(from: rest.startIndex, to: match.upperBound)
                    continue
                }
            }

            if character == "*" || character == "_" || character == "~" {
                let run = chars[index...].prefix { $0 == character }.count
                let before: Character? = index > 0 ? chars[index - 1] : nil
                let after: Character? = index + run < chars.count ? chars[index + run] : nil
                let opens = after.map { !$0.isWhitespace } ?? false
                let intraword = character == "_" && (before?.isLetter == true || before?.isNumber == true)
                if character == "~" {
                    if run == 2, opens, let close = find(["~", "~"], from: index + 2), close > index + 2 {
                        emitText()
                        var inner = style
                        inner.strike = true
                        parseInline(Array(chars[(index + 2)..<close]), style: inner, into: &out)
                        index = close + 2
                        continue
                    }
                } else if opens && !intraword {
                    let strong = run >= 2
                    let width = strong ? 2 : 1
                    let delimiter = Array(repeating: character, count: width)
                    if let close = closingDelimiter(chars, delimiter: delimiter, from: index + width), close > index + width {
                        emitText()
                        var inner = style
                        if strong { inner.bold = true } else { inner.italic = true }
                        parseInline(Array(chars[(index + width)..<close]), style: inner, into: &out)
                        index = close + width
                        continue
                    }
                }
                buffer += String(repeating: character, count: run)
                index += run
                continue
            }

            if character == "&", let semicolon = chars[index...].prefix(10).firstIndex(of: ";") {
                let entity = String(chars[index...semicolon])
                if let decoded = decodeEntity(entity) {
                    buffer += decoded
                    index = semicolon + 1
                    continue
                }
            }

            buffer.append(character)
            index += 1
        }
        emitText()
    }

    private static func closingDelimiter(_ chars: [Character], delimiter: [Character], from start: Int) -> Int? {
        var position = start
        let width = delimiter.count
        while position <= chars.count - width {
            let character = chars[position]
            if character == "\\" { position += 2; continue }
            if character == "`" {
                let run = chars[position...].prefix { $0 == "`" }.count
                var probe = position + run
                var found = false
                while probe <= chars.count - run {
                    if chars[probe..<probe + run].allSatisfy({ $0 == "`" }) { found = true; break }
                    probe += 1
                }
                position = found ? probe + run : position + run
                continue
            }
            if Array(chars[position..<position + width]) == delimiter {
                let before = chars[position - 1]
                let runLength = chars[position...].prefix { $0 == delimiter[0] }.count
                let after: Character? = position + runLength < chars.count ? chars[position + runLength] : nil
                let intraword = delimiter[0] == "_" && (after?.isLetter == true || after?.isNumber == true)
                // A single delimiter must not be part of a double one (so *a **b** c* nests).
                if !before.isWhitespace && !intraword && (width == 2 || runLength != 2) {
                    return runLength > width && width == 1 ? position + runLength - 1 : position
                }
                position += runLength
                continue
            }
            position += 1
        }
        return nil
    }

    private static func decodeEntity(_ entity: String) -> String? {
        let named = ["&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'", "&nbsp;": "\u{00A0}", "&copy;": "©", "&reg;": "®", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…"]
        if let value = named[entity] { return value }
        guard entity.hasPrefix("&#") else { return nil }
        let body = entity.dropFirst(2).dropLast()
        let value = body.first == "x" || body.first == "X" ? UInt32(body.dropFirst(), radix: 16) : UInt32(body)
        return value.flatMap(Unicode.Scalar.init).map { String(Character($0)) }
    }

    // MARK: Plain text

    /// Structures plain text like the desktop (`plain_text_html`): blank lines separate blocks, a line in
    /// CAPITALS heads a section, "1." / "-" lines become lists, short-line blocks keep their breaks.
    static func plainText(_ text: String) -> [MDBlock] {
        var groups: [[String]] = []
        var current: [String] = []
        for raw in text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                if !current.isEmpty { groups.append(current); current = [] }
            } else {
                current.append(line.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression))
            }
        }
        if !current.isEmpty { groups.append(current) }
        return groups.flatMap(plainBlock)
    }

    static func isPlainHeading(_ line: String) -> Bool {
        let stripped = line.trimmingCharacters(in: .whitespaces)
        guard !stripped.isEmpty, stripped.count <= 90, !stripped.hasSuffix("."), !stripped.hasSuffix(","), !stripped.hasSuffix(";") else { return false }
        let letters = stripped.filter(\.isLetter)
        return letters.count >= 2 && !letters.contains(where: \.isLowercase)
    }

    private static let orderedItem = #"^\s*(\d{1,4})[.)]\s+(.*)$"#
    private static let bulletItem = #"^\s*[-*•–]\s+(.*)$"#

    private static func capture(_ line: String, _ pattern: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) else { return nil }
        return (0..<match.numberOfRanges).map { index in
            Range(match.range(at: index), in: line).map { String(line[$0]) } ?? ""
        }
    }

    private static func plainBlock(_ lines: [String]) -> [MDBlock] {
        let isItem = { (line: String) in capture(line, orderedItem) != nil || capture(line, bulletItem) != nil }
        let wholeList = lines.count > 1 && lines.allSatisfy(isItem)
        if !wholeList, let first = lines.first, isPlainHeading(first) {
            let rest = Array(lines.dropFirst())
            return [.heading(level: 2, [.text(first.trimmingCharacters(in: .whitespaces))])] + (rest.isEmpty ? [] : plainBlock(rest))
        }
        if let first = lines.first {
            let ordered = capture(first, orderedItem)
            let bullet = capture(first, bulletItem)
            if ordered != nil || bullet != nil {
                let pattern = ordered != nil ? orderedItem : bulletItem
                var items: [[String]] = []
                for line in lines {
                    if let groups = capture(line, pattern) {
                        items.append([groups.last?.trimmingCharacters(in: .whitespaces) ?? ""])
                    } else if !items.isEmpty {
                        items[items.count - 1].append(line.trimmingCharacters(in: .whitespaces))
                    }
                }
                let start = ordered.flatMap { Int($0[1]) } ?? 1
                return [.list(ordered: ordered != nil, start: start, items: items.map { [.paragraph([.text($0.joined(separator: " "))], lines: false)] })]
            }
        }
        let stripped = lines.map { $0.trimmingCharacters(in: .whitespaces) }
        if stripped.count > 1 && stripped.allSatisfy({ $0.count <= 60 }) {
            var inlines: [MDInline] = []
            for (position, line) in stripped.enumerated() {
                if position > 0 { inlines.append(MDInline(kind: .lineBreak)) }
                inlines.append(.text(line))
            }
            return [.paragraph(inlines, lines: true)]
        }
        return [.paragraph([.text(stripped.joined(separator: " "))], lines: false)]
    }
}
