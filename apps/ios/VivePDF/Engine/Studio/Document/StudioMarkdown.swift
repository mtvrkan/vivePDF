import Foundation

/// A compact CommonMark + pipe-table renderer for Markdown imports (the desktop uses markdown-it
/// with the `commonmark` preset and tables): headings, paragraphs, emphasis, code, links, pictures,
/// quotes, nested lists, rules, fenced / indented code and tables.
enum StudioMarkdown {
    static func html(_ source: String) -> String {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\t", with: "    ").components(separatedBy: "\n")
        return blocks(lines)
    }

    private static func indent(_ line: String) -> Int { line.prefix { $0 == " " }.count }
    private static func isBlank(_ line: String) -> Bool { line.trimmingCharacters(in: .whitespaces).isEmpty }

    private static func isRule(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "")
        guard trimmed.count >= 3, indent(line) < 4, let first = trimmed.first, "-*_".contains(first) else { return false }
        return trimmed.allSatisfy { $0 == first }
    }

    private static func heading(_ line: String) -> (Int, String)? {
        guard indent(line) < 4 else { return nil }
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let hashes = trimmed.prefix { $0 == "#" }.count
        guard (1...6).contains(hashes) else { return nil }
        let rest = trimmed.dropFirst(hashes)
        guard rest.isEmpty || rest.first == " " else { return nil }
        var text = rest.trimmingCharacters(in: .whitespaces)
        if let range = text.range(of: "\\s+#+\\s*$", options: .regularExpression) { text.removeSubrange(range) } else if text.allSatisfy({ $0 == "#" }) { text = "" }
        return (hashes, text)
    }

    /// List marker: (ordered, start number, content column).
    private static func listMarker(_ line: String) -> (ordered: Bool, start: Int, column: Int, rest: String)? {
        let lead = indent(line)
        guard lead < 4 || true else { return nil }
        let body = line.dropFirst(lead)
        if let first = body.first, "-*+".contains(first), body.dropFirst().first == " " || body.count == 1 {
            let afterSpaces = body.dropFirst().prefix { $0 == " " }.count
            let column = lead + 1 + max(1, min(afterSpaces, 4))
            return (false, 1, column, String(body.dropFirst(1 + afterSpaces)))
        }
        let digits = body.prefix { $0.isNumber }
        if !digits.isEmpty, digits.count <= 9 {
            let after = body.dropFirst(digits.count)
            if let delimiter = after.first, delimiter == "." || delimiter == ")", after.dropFirst().first == " " || after.count == 1 {
                let afterSpaces = after.dropFirst().prefix { $0 == " " }.count
                let column = lead + digits.count + 1 + max(1, min(afterSpaces, 4))
                return (true, Int(digits) ?? 1, column, String(after.dropFirst(1 + afterSpaces)))
            }
        }
        return nil
    }

    private static func tableCells(_ line: String) -> [String] {
        var text = line.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("|") { text.removeFirst() }
        if text.hasSuffix("|") && !text.hasSuffix("\\|") { text.removeLast() }
        var cells: [String] = []
        var current = ""
        var escaped = false
        for char in text {
            if escaped { current.append(char); escaped = false; continue }
            if char == "\\" { escaped = true; current.append(char); continue }
            if char == "|" { cells.append(current); current = ""; continue }
            current.append(char)
        }
        cells.append(current)
        return cells.map { $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "\\|", with: "|") }
    }

    private static func delimiterRow(_ line: String) -> [String]? {
        guard line.contains("-") else { return nil }
        let cells = tableCells(line)
        guard !cells.isEmpty, cells.allSatisfy({ $0.range(of: "^:?-+:?$", options: .regularExpression) != nil }) else { return nil }
        return cells.map { cell in
            switch (cell.hasPrefix(":"), cell.hasSuffix(":")) {
            case (true, true): "center"
            case (false, true): "right"
            case (true, false): "left"
            default: ""
            }
        }
    }

    private static func blocks(_ lines: [String]) -> String {
        var out = ""
        var i = 0
        var paragraph: [String] = []
        func flush() {
            if !paragraph.isEmpty {
                out += "<p>\(inline(paragraph.map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")))</p>\n"
                paragraph = []
            }
        }
        while i < lines.count {
            let line = lines[i]
            if isBlank(line) { flush(); i += 1; continue }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            // Fenced code
            if indent(line) < 4, trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flush()
                let fence = String(trimmed.prefix(3))
                let info = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces).split(separator: " ").first.map(String.init) ?? ""
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(fence) { code.append(lines[i]); i += 1 }
                i += 1
                let cls = info.isEmpty ? "" : " class=\"language-\(StudioDocHTML.escape(info))\""
                out += "<pre><code\(cls)>\(StudioDocHTML.escape(code.joined(separator: "\n")))\(code.isEmpty ? "" : "\n")</code></pre>\n"
                continue
            }
            // Indented code (not inside a paragraph)
            if indent(line) >= 4, paragraph.isEmpty {
                var code: [String] = []
                while i < lines.count, indent(lines[i]) >= 4 || isBlank(lines[i]) { code.append(String(lines[i].dropFirst(min(4, indent(lines[i]))))); i += 1 }
                while code.last.map(isBlank) == true { code.removeLast() }
                out += "<pre><code>\(StudioDocHTML.escape(code.joined(separator: "\n")))\n</code></pre>\n"
                continue
            }
            if let (level, text) = heading(line) { flush(); out += "<h\(level)>\(inline(text))</h\(level)>\n"; i += 1; continue }
            // Setext headings
            if !paragraph.isEmpty, indent(line) < 4, trimmed.range(of: "^(=+|-+)$", options: .regularExpression) != nil {
                let level = trimmed.hasPrefix("=") ? 1 : 2
                out += "<h\(level)>\(inline(paragraph.map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")))</h\(level)>\n"
                paragraph = []
                i += 1
                continue
            }
            if isRule(line) { flush(); out += "<hr>\n"; i += 1; continue }
            if indent(line) < 4, trimmed.hasPrefix(">") {
                flush()
                var quoted: [String] = []
                while i < lines.count, !isBlank(lines[i]) {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if t.hasPrefix(">") {
                        var rest = String(t.dropFirst())
                        if rest.hasPrefix(" ") { rest.removeFirst() }
                        quoted.append(rest)
                    } else { quoted.append(lines[i]) }
                    i += 1
                }
                out += "<blockquote>\n\(blocks(quoted))</blockquote>\n"
                continue
            }
            // Tables
            if paragraph.isEmpty, line.contains("|"), i + 1 < lines.count, let aligns = delimiterRow(lines[i + 1]) {
                let header = tableCells(line)
                if header.count == aligns.count {
                    func cellTag(_ tag: String, _ text: String, _ index: Int) -> String {
                        let align = index < aligns.count && !aligns[index].isEmpty ? " style=\"text-align:\(aligns[index])\"" : ""
                        return "<\(tag)\(align)>\(inline(text))</\(tag)>"
                    }
                    out += "<table>\n<thead>\n<tr>\n" + header.enumerated().map { cellTag("th", $1, $0) }.joined(separator: "\n") + "\n</tr>\n</thead>\n"
                    i += 2
                    var rows: [String] = []
                    while i < lines.count, !isBlank(lines[i]), lines[i].contains("|") {
                        let cells = tableCells(lines[i])
                        let padded = (0..<header.count).map { $0 < cells.count ? cells[$0] : "" }
                        rows.append("<tr>\n" + padded.enumerated().map { cellTag("td", $1, $0) }.joined(separator: "\n") + "\n</tr>")
                        i += 1
                    }
                    if !rows.isEmpty { out += "<tbody>\n\(rows.joined(separator: "\n"))\n</tbody>\n" }
                    out += "</table>\n"
                    continue
                }
            }
            if let marker = listMarker(line), indent(line) < 4, paragraph.isEmpty || !marker.rest.isEmpty {
                flush()
                let ordered = marker.ordered
                var items: [[String]] = []
                var tight = true
                var sawBlank = false
                while i < lines.count {
                    let current = lines[i]
                    if isBlank(current) { sawBlank = true; items[items.count - 1].append(""); i += 1; continue }
                    if let m = listMarker(current), indent(current) < marker.column, m.ordered == ordered {
                        if sawBlank { tight = false }
                        sawBlank = false
                        items.append([m.rest])
                        i += 1
                        continue
                    }
                    if !items.isEmpty, indent(current) >= marker.column {
                        if sawBlank { tight = false }
                        sawBlank = false
                        items[items.count - 1].append(String(current.dropFirst(marker.column)))
                        i += 1
                        continue
                    }
                    if !items.isEmpty, !sawBlank, listMarker(current) == nil, heading(current) == nil, !isRule(current) {
                        items[items.count - 1].append(current)
                        i += 1
                        continue
                    }
                    break
                }
                let tag = ordered ? "ol" : "ul"
                let start = ordered && marker.start != 1 ? " start=\"\(marker.start)\"" : ""
                out += "<\(tag)\(start)>\n"
                for var item in items {
                    while item.last.map(isBlank) == true { item.removeLast() }
                    var body = blocks(item)
                    if tight {
                        body = body.replacingOccurrences(of: "<p>", with: "").replacingOccurrences(of: "</p>\n", with: "\n")
                        if body.hasSuffix("\n") { body.removeLast() }
                    }
                    out += "<li>\(body)</li>\n"
                }
                out += "</\(tag)>\n"
                continue
            }
            paragraph.append(line)
            i += 1
        }
        flush()
        return out
    }

    // MARK: Inline

    static func inline(_ text: String) -> String {
        let chars = Array(text)
        var out = ""
        var i = 0
        func rest(_ from: Int) -> String { String(chars[from...]) }
        while i < chars.count {
            let c = chars[i]
            if c == "\\", i + 1 < chars.count {
                let next = chars[i + 1]
                if next == "\n" { out += "<br>\n"; i += 2; continue }
                if "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".contains(next) { out += StudioDocHTML.escape(String(next)); i += 2; continue }
            }
            if c == "`" {
                let ticks = chars[i...].prefix { $0 == "`" }.count
                let fence = String(repeating: "`", count: ticks)
                let after = rest(i + ticks)
                if let close = after.range(of: fence) {
                    var code = String(after[..<close.lowerBound]).replacingOccurrences(of: "\n", with: " ")
                    if code.hasPrefix(" ") && code.hasSuffix(" ") && code.count > 2 { code = String(code.dropFirst().dropLast()) }
                    out += "<code>\(StudioDocHTML.escape(code))</code>"
                    i += ticks + after.distance(from: after.startIndex, to: close.upperBound)
                    continue
                }
                out += fence
                i += ticks
                continue
            }
            if c == "<", let match = rest(i).range(of: "^<(https?://[^\\s<>]+|mailto:[^\\s<>]+)>", options: .regularExpression) {
                let link = String(rest(i)[match].dropFirst().dropLast())
                out += "<a href=\"\(StudioDocHTML.escape(link))\">\(StudioDocHTML.escape(link))</a>"
                i += link.count + 2
                continue
            }
            if c == "!" || c == "[", let (html, length) = linkOrImage(chars, i) {
                out += html
                i += length
                continue
            }
            if c == "*" || c == "_" {
                let run = chars[i...].prefix { $0 == c }.count
                if let (html, length) = emphasis(chars, i, c, min(run, 3)) {
                    out += html
                    i += length
                    continue
                }
                out += String(repeating: c, count: run)
                i += run
                continue
            }
            if c == "\n" {
                if out.hasSuffix("  ") {
                    while out.hasSuffix(" ") { out.removeLast() }
                    out += "<br>\n"
                } else { out += "\n" }
                i += 1
                continue
            }
            out += StudioDocHTML.escape(String(c))
            i += 1
        }
        return out
    }

    private static func emphasis(_ chars: [Character], _ start: Int, _ c: Character, _ count: Int) -> (String, Int)? {
        for n in stride(from: count, through: 1, by: -1) {
            let open = start + n
            guard open < chars.count, !chars[open].isWhitespace else { continue }
            var j = open
            while j < chars.count {
                if chars[j] == c {
                    let run = chars[j...].prefix { $0 == c }.count
                    if run >= n, j > open, !chars[j - 1].isWhitespace {
                        if c == "_", j + n < chars.count, chars[j + n].isLetter || chars[j + n].isNumber { j += run; continue }
                        let inner = inline(String(chars[open..<j]))
                        let html = n == 3 ? "<em><strong>\(inner)</strong></em>" : n == 2 ? "<strong>\(inner)</strong>" : "<em>\(inner)</em>"
                        return (html, j + n - start)
                    }
                    j += run
                    continue
                }
                if chars[j] == "`" {
                    let ticks = chars[j...].prefix { $0 == "`" }.count
                    j += ticks
                    while j < chars.count, chars[j] != "`" { j += 1 }
                    j += ticks
                    continue
                }
                j += 1
            }
        }
        return nil
    }

    private static func linkOrImage(_ chars: [Character], _ start: Int) -> (String, Int)? {
        let isImage = chars[start] == "!"
        let open = isImage ? start + 1 : start
        guard open < chars.count, chars[open] == "[" else { return nil }
        var depth = 0
        var j = open
        var closeBracket = -1
        while j < chars.count {
            if chars[j] == "\\" { j += 2; continue }
            if chars[j] == "[" { depth += 1 }
            if chars[j] == "]" { depth -= 1; if depth == 0 { closeBracket = j; break } }
            j += 1
        }
        guard closeBracket > 0, closeBracket + 1 < chars.count, chars[closeBracket + 1] == "(" else { return nil }
        var k = closeBracket + 2
        var parens = 1
        while k < chars.count {
            if chars[k] == "(" { parens += 1 }
            if chars[k] == ")" { parens -= 1; if parens == 0 { break } }
            k += 1
        }
        guard k < chars.count else { return nil }
        let label = String(chars[(open + 1)..<closeBracket])
        var target = String(chars[(closeBracket + 2)..<k]).trimmingCharacters(in: .whitespaces)
        var title: String?
        if let range = target.range(of: "\\s+[\"'](.*)[\"']$", options: .regularExpression) {
            title = String(target[range]).trimmingCharacters(in: .whitespaces).dropFirst().dropLast().description
            target.removeSubrange(range)
        }
        if target.hasPrefix("<") && target.hasSuffix(">") { target = String(target.dropFirst().dropLast()) }
        let titleAttr = title.map { " title=\"\(StudioDocHTML.escape($0))\"" } ?? ""
        if isImage {
            let alt = label.replacingOccurrences(of: "[*_`\\[\\]]", with: "", options: .regularExpression)
            return ("<img src=\"\(StudioDocHTML.escape(target))\" alt=\"\(StudioDocHTML.escape(alt))\"\(titleAttr)>", k + 1 - start)
        }
        return ("<a href=\"\(StudioDocHTML.escape(target))\"\(titleAttr)>\(inline(label))</a>", k + 1 - start)
    }
}
