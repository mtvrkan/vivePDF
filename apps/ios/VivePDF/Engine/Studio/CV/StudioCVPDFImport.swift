import CoreText
import Foundation
import PDFKit

/// Port of `studio_cv.py`, `_studio_cv_parse.py` and `_studio_cv_sections.py`: reads a CV (or a LinkedIn
/// profile export) PDF back into CV fields. Text lines come from PDFKit with their size and weight.
enum StudioCVPDFImport {
    typealias T = StudioCVText

    static let keywordConfidence = 0.9
    static let fontConfidence = 0.6
    static let inferredConfidence = 0.4
    static let maxPages = 40

    struct Line {
        var text: String
        var size: Double
        var bold: Bool
        var x0: Double
        var x1: Double
        var y0: Double
        var y1: Double
        var page: Int
        var column = 0
        var startsColumn = false
    }

    final class Block {
        let key: String
        let heading: String
        let confidence: Double
        var lines: [Line] = []
        init(key: String, heading: String, confidence: Double) {
            self.key = key
            self.heading = heading
            self.confidence = confidence
        }
    }

    struct Header {
        var name = ""
        var headline = ""
        var location = ""
        var contacts: [(String, String)] = []
        var leftover: [Line] = []
    }

    struct Section: Identifiable { var key: StudioCVImportKey; var count: Int; var confidence: Double; var id: String { key.rawValue } }

    struct Result {
        var profile: StudioCVProfile
        var sections: [Section]
        var linkedin: Bool
        var pages: Int
    }

    // MARK: Reading lines

    private static func isBold(_ font: CTFont) -> Bool {
        CTFontGetSymbolicTraits(font).contains(.traitBold) || (CTFontCopyPostScriptName(font) as String).lowercased().contains("bold")
    }

    private struct Glyph { var char: Character; var rect: CGRect; var size: Double; var bold: Bool }

    /// Lines of one page in reading order (two-column layouts read column by column).
    static func pageLines(_ page: PDFPage, number: Int) -> (lines: [Line], footers: Int) {
        let bounds = page.bounds(for: .mediaBox)
        guard let attributed = page.attributedString else { return ([], 0) }
        let string = attributed.string as NSString
        var raw: [[Glyph]] = []
        var current: [Glyph] = []
        func flush() {
            if current.contains(where: { !$0.char.isWhitespace }) { raw.append(current) }
            current = []
        }
        var index = 0
        while index < string.length {
            let range = string.rangeOfComposedCharacterSequence(at: index)
            let char = Character(string.substring(with: range))
            index = range.location + range.length
            if char == "\n" || char == "\r" || char == "\r\n" { flush(); continue }
            let rect = page.characterBounds(at: range.location)
            var size = Double(rect.height)
            var bold = false
            if let value = attributed.attribute(.font, at: range.location, effectiveRange: nil) as AnyObject?, CFGetTypeID(value) == CTFontGetTypeID() {
                let font = unsafeBitCast(value, to: CTFont.self)
                size = Double(CTFontGetSize(font))
                bold = isBold(font)
            }
            let glyph = Glyph(char: char, rect: rect, size: size, bold: bold)
            if let last = current.last(where: { !$0.char.isWhitespace }), !char.isWhitespace, !rect.isEmpty, !last.rect.isEmpty {
                let height = max(1, min(rect.height, last.rect.height))
                let sameRow = abs(rect.midY - last.rect.midY) < height * 0.5
                let gap = rect.minX - last.rect.maxX
                if !sameRow || gap > max(last.size, size) * 1.2 || gap < -height { flush() }
            }
            current.append(glyph)
        }
        flush()
        var lines: [Line] = []
        var footers = 0
        for glyphs in raw {
            let shown = glyphs.filter { !$0.char.isWhitespace && !$0.rect.isEmpty }
            guard !shown.isEmpty else { continue }
            let text = T.plainLine(String(glyphs.map(\.char)))
            if T.fullMatch(T.footer, T.fold(text)) { footers += 1; continue }
            let heavy = shown.filter(\.bold).count
            let minX = shown.map(\.rect.minX).min() ?? 0, maxX = shown.map(\.rect.maxX).max() ?? 0
            let minY = shown.map(\.rect.minY).min() ?? 0, maxY = shown.map(\.rect.maxY).max() ?? 0
            let size = ((shown.map(\.size).max() ?? 10) * 10).rounded() / 10
            lines.append(Line(text: text, size: size, bold: heavy * 2 > shown.count, x0: Double(minX - bounds.minX), x1: Double(maxX - bounds.minX), y0: Double(bounds.maxY - maxY), y1: Double(bounds.maxY - minY), page: number))
        }
        return (ordered(lines, Double(bounds.width)), footers)
    }

    private static func split(_ lines: [Line], _ width: Double) -> Double? {
        guard lines.count >= 6 else { return nil }
        for percent in stride(from: 20, to: 56, by: 2) {
            let split = width * Double(percent) / 100
            if lines.contains(where: { $0.x0 < split - 1 && $0.x1 > split + 1 }) { continue }
            let left = lines.filter { $0.x1 <= split + 1 }
            let right = lines.filter { $0.x0 >= split - 1 }
            if left.count < 3 || right.count < 3 { continue }
            let dated = left.filter { T.findRange($0.text) != nil || T.findSingle($0.text) != nil }.count
            if dated * 2 >= left.count { return nil }
            let overlap = min(left.map(\.y1).max()!, right.map(\.y1).max()!) - max(left.map(\.y0).min()!, right.map(\.y0).min()!)
            if overlap > 0 { return split }
        }
        return nil
    }

    private static func sameRow(_ a: Line, _ b: Line) -> Bool {
        let height = min(a.y1 - a.y0, b.y1 - b.y0)
        let centre = abs((a.y0 + a.y1) - (b.y0 + b.y1)) / 2
        let apart = b.x0 >= a.x1 - 1 || a.x0 >= b.x1 - 1
        return centre < height * 0.35 && apart
    }

    private static func joined(_ a: Line, _ b: Line) -> Line {
        let (left, right) = a.x0 <= b.x0 ? (a, b) : (b, a)
        let heavier = left.text.count >= right.text.count ? left : right
        return Line(text: "\(left.text) | \(right.text)", size: max(left.size, right.size), bold: heavier.bold, x0: min(left.x0, right.x0), x1: max(left.x1, right.x1), y0: min(left.y0, right.y0), y1: max(left.y1, right.y1), page: left.page, column: left.column)
    }

    private static func rows(_ lines: [Line]) -> [Line] {
        var rows: [Line] = []
        for line in lines.sorted(by: { (($0.y0 + $0.y1) / 2, $0.x0) < (($1.y0 + $1.y1) / 2, $1.x0) }) {
            if let last = rows.last, sameRow(last, line) { rows[rows.count - 1] = joined(last, line) } else { rows.append(line) }
        }
        return rows
    }

    private static func ordered(_ lines: [Line], _ width: Double) -> [Line] {
        guard let split = split(lines, width) else { return rows(lines) }
        let left = rows(lines.filter { ($0.x0 + $0.x1) / 2 < split })
        var right = rows(lines.filter { ($0.x0 + $0.x1) / 2 >= split })
        for i in right.indices { right[i].column = 1 }
        if !left.isEmpty && !right.isEmpty { right[0].startsColumn = true }
        return left + right
    }

    static func bodySize(_ lines: [Line]) -> Double {
        let weighted = lines.map { ($0.size, $0.text.count) }.sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }
        let total = weighted.reduce(0) { $0 + $1.1 }
        var running = 0
        for (size, weight) in weighted {
            running += weight
            if running * 2 >= total { return size }
        }
        return 10
    }

    private static func isUpper(_ text: String) -> Bool {
        let cased = text.filter { $0.isLetter && ($0.isUppercase || $0.isLowercase) }
        return !cased.isEmpty && cased.allSatisfy(\.isUppercase)
    }

    private static func fontHeading(_ line: Line, _ body: Double, _ top: Double) -> Bool {
        let text = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.count > 40 || text.split(whereSeparator: \.isWhitespace).count > 4 || text.contains(where: \.isNumber) || text.contains("@") || text.contains("|")
            || [".", ",", ";"].contains(text.last.map(String.init) ?? "") || T.matchStart(T.bullet, text) != nil || line.size >= top * 0.95 { return false }
        let letters = text.filter(\.isLetter).count
        return line.size >= body * 1.2 || (line.bold && isUpper(text) && letters >= 3)
    }

    static func segment(_ lines: [Line]) -> (header: [Line], blocks: [Block], headings: Set<String>) {
        let body = bodySize(lines)
        let top = lines.filter { $0.page == lines[0].page }.map(\.size).max() ?? 0
        let keywordAny = lines.contains { T.headingOf($0.text) != nil }
        var header: [Line] = []
        var blocks: [Block] = []
        var headings = Set<String>()
        var current: Block?
        var keywordSeen = false
        for (index, line) in lines.enumerated() {
            if line.startsColumn { current = nil; keywordSeen = false }
            if let key = T.headingOf(line.text) {
                headings.insert(T.headingKey(line.text))
                let block = Block(key: key, heading: line.text, confidence: keywordConfidence)
                blocks.append(block)
                current = block
                keywordSeen = true
                continue
            }
            if (keywordSeen || (!keywordAny && index > 2)) && fontHeading(line, body, top) {
                let block = Block(key: "custom", heading: line.text, confidence: fontConfidence)
                blocks.append(block)
                current = block
                continue
            }
            if let current { current.lines.append(line) } else { header.append(line) }
        }
        return (header, blocks, headings)
    }

    private static func pieces(_ text: String) -> [String] {
        text.components(separatedBy: " | ").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private static func namePiece(_ text: String) -> String {
        for piece in pieces(text) {
            let (found, rest) = T.contactsIn(piece)
            let words = rest.split(whereSeparator: \.isWhitespace)
            if found.isEmpty && rest == T.trimmed(piece) && (1...6).contains(words.count) && rest.count <= 60 && !rest.contains(where: \.isNumber) && T.headingOf(rest) == nil && rest.contains(where: \.isLetter) {
                return rest
            }
        }
        return ""
    }

    private static func continues(_ previous: Line, _ line: Line) -> Bool {
        previous.page == line.page && abs(previous.size - line.size) < 0.6 && line.y0 - previous.y1 < line.size * 0.6
    }

    private static func same(_ a: Line, _ b: Line) -> Bool { a.text == b.text && a.y0 == b.y0 && a.x0 == b.x0 && a.page == b.page }

    static func readHeader(_ header: [Line], _ lines: [Line], linkedin: Bool) -> Header {
        var result = Header()
        let page = header.first?.page ?? lines[0].page
        let onPage = header.filter { $0.page == page }
        let pool = onPage.isEmpty ? Array(lines.prefix(6)) : onPage
        var nameIndex: Int?
        for (index, line) in pool.enumerated().sorted(by: { $0.element.size > $1.element.size || ($0.element.size == $1.element.size && $0.offset < $1.offset) }) {
            result.name = namePiece(line.text)
            if !result.name.isEmpty { nameIndex = index; break }
        }
        var texts: [Line] = []
        for (index, line) in pool.enumerated() where index != nameIndex {
            var remainder: [String] = []
            for piece in pieces(line.text) {
                let (found, rest) = T.contactsIn(piece)
                result.contacts += found
                if !found.isEmpty {
                    if result.location.isEmpty { result.location = T.locationValue(rest) }
                } else if !rest.isEmpty {
                    remainder.append(rest)
                }
            }
            let afterName = nameIndex == nil || index > nameIndex!
            if !remainder.isEmpty && afterName && header.contains(where: { same($0, line) }) {
                var copy = line
                copy.text = remainder.joined(separator: " ")
                copy.column = 0
                copy.startsColumn = false
                texts.append(copy)
            }
        }
        if linkedin && texts.count >= 2 && !texts.last!.text.contains(where: \.isNumber) {
            let last = texts.removeLast()
            if result.location.isEmpty { result.location = T.trimmed(last.text) }
        }
        var headline: [Line] = []
        for line in texts {
            let place = T.locationValue(line.text)
            if headline.isEmpty || (result.leftover.isEmpty && continues(headline[headline.count - 1], line) && place.isEmpty) {
                headline.append(line)
            } else if !place.isEmpty && result.location.isEmpty {
                result.location = place
            } else {
                result.leftover.append(line)
            }
        }
        result.headline = headline.map(\.text).joined(separator: " ")
        return result
    }

    static func blockContacts(_ lines: [Line]) -> ([(String, String)], String) {
        var texts: [String] = []
        for line in lines {
            let text = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let last = texts.last, last.hasSuffix("-") || last.hasSuffix("/"), !(last.components(separatedBy: "(").first ?? "").trimmingCharacters(in: .whitespaces).contains(" ") {
                texts[texts.count - 1] += text
            } else {
                texts.append(text)
            }
        }
        var contacts: [(String, String)] = []
        var location = ""
        for text in texts {
            let (found, rest) = T.contactsIn(text)
            contacts += found
            if found.isEmpty && !rest.isEmpty && location.isEmpty { location = T.locationValue(rest) }
        }
        return (contacts, location)
    }

    static func firstPageEmails(_ lines: [Line]) -> [(String, String)] {
        let page = lines[0].page
        for line in lines where line.page == page {
            if let m = T.search(T.email, line.text) { return [("email", T.sub(line.text, m.range))] }
        }
        return []
    }

    // MARK: Sections (`_studio_cv_sections.py`)

    struct Entry {
        var titles: [String] = []
        var start = ""
        var end = ""
        var current = false
        var location = ""
        var details = ""
    }

    private static func bulletText(_ text: String) -> (Bool, String) {
        if let m = T.matchStart(T.bullet, text) { return (true, (text as NSString).substring(from: m.range.length).trimmingCharacters(in: .whitespacesAndNewlines)) }
        return (false, text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    static func paragraph(_ lines: [Line]) -> String {
        var parts: [String] = []
        var previous: Line?
        for line in lines {
            let (isBullet, text) = bulletText(line.text)
            if isBullet {
                parts.append("- \(text)")
            } else if !parts.isEmpty, let previous, previous.page == line.page, line.y0 - previous.y1 < line.size * 0.6, !previous.text.trimmingCharacters(in: .whitespaces).hasSuffix(":") {
                parts[parts.count - 1] += " \(text)"
            } else {
                parts.append(text)
            }
            previous = line
        }
        return T.clip(parts.joined(separator: "\n"), T.textLimit)
    }

    static func logicalLines(_ lines: [Line]) -> [String] {
        var result: [String] = []
        var previous: Line?
        for line in lines {
            let (isBullet, text) = bulletText(line.text)
            guard !text.isEmpty else { continue }
            let joins = !result.isEmpty && !isBullet && previous != nil && previous!.page == line.page && (["," , "-", "/", "&"].contains { result[result.count - 1].hasSuffix($0) } || (text.first?.isLowercase ?? false))
            if joins {
                let glue = result[result.count - 1].hasSuffix("-") || result[result.count - 1].hasSuffix("/") ? "" : " "
                result[result.count - 1] += glue + text
            } else {
                result.append(text)
            }
            previous = line
        }
        return result
    }

    private static func splitItems(_ text: String) -> [String] {
        var items: [String] = []
        var depth = 0
        var current = ""
        for char in text {
            if char == "(" { depth += 1 }
            if char == ")" { depth -= 1 }
            if ",;•|·▪●".contains(char) && depth <= 0 {
                items.append(current)
                current = ""
            } else {
                current.append(char)
            }
        }
        items.append(current)
        let strip = CharacterSet(charactersIn: " \t-–—:;")
        return items.map { $0.trimmingCharacters(in: strip) }.filter { !$0.isEmpty }
    }

    private static let category = T.re("^[^:,]{1,30}:\\s+(?=\\S)")

    static func listItems(_ lines: [Line], stripCategory: Bool) -> [String] {
        logicalLines(lines).flatMap { text -> [String] in
            var value = text
            if stripCategory, let m = T.matchStart(category, value) { value = (value as NSString).substring(from: m.range.length) }
            return splitItems(value)
        }
    }

    static func skills(_ lines: [Line]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for item in listItems(lines, stripCategory: true) {
            let key = T.fold(item)
            if seen.insert(key).inserted { result.append(T.clip(item)) }
        }
        return result
    }

    private static func styleFlags(_ lines: [Line]) -> ([Bool], Bool) {
        let body = bodySize(lines)
        let flags = lines.map { $0.bold || $0.size > body + 0.6 }
        return (flags, flags.contains(true) && !flags.allSatisfy { $0 })
    }

    private static func titleLike(_ line: Line, _ styled: Bool, _ varied: Bool, _ loose: Bool) -> Bool {
        let text = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if T.matchStart(T.bullet, text) != nil || text.count > 120 || text.hasSuffix(":") { return false }
        if text.hasSuffix(".") && !styled { return false }
        if varied { return styled }
        return loose || text.count <= 80
    }

    private static func anchors(_ lines: [Line]) -> [(Int, StudioCVText.DateSpan)] {
        for (finder, limit) in [(T.findRange as (String) -> StudioCVText.DateSpan?, 140), (T.findSingle, 80)] {
            var found: [(Int, StudioCVText.DateSpan)] = []
            for (index, line) in lines.enumerated() {
                if T.matchStart(T.bullet, line.text) != nil || line.text.count > limit { continue }
                if let span = finder(line.text), span.before.count + span.after.count <= 120 { found.append((index, span)) }
            }
            if !found.isEmpty { return found }
        }
        return []
    }

    private static func locationAfter(_ lines: [Line], _ index: Int, _ limit: Int, _ flags: [Bool], _ linkedin: Bool) -> String {
        guard index < limit else { return "" }
        let text = lines[index].text.trimmingCharacters(in: .whitespacesAndNewlines)
        if T.matchStart(T.bullet, text) != nil { return "" }
        let place = T.locationValue(text)
        if !place.isEmpty { return place }
        let relaxed = linkedin && !flags[index] && text.count <= 40 && !text.contains(where: \.isNumber) && !text.hasSuffix(".") && !text.hasSuffix(":")
        return relaxed ? T.trimmed(text) : ""
    }

    static func entries(_ lines: [Line], linkedin: Bool) -> [Entry] {
        guard !lines.isEmpty else { return [] }
        let pairs = anchors(lines)
        guard !pairs.isEmpty else { return [Entry(titles: [lines[0].text], details: paragraph(Array(lines.dropFirst())))] }
        let anchorIndices = pairs.map(\.0)
        let (flags, varied) = styleFlags(lines)
        var found: [Entry] = []
        var consumed: [Int] = []
        for (position, (anchor, span)) in pairs.enumerated() {
            let limit = position + 1 < anchorIndices.count ? anchorIndices[position + 1] : lines.count
            var entry = Entry(start: span.start, end: span.end, current: span.current)
            if !span.before.isEmpty { entry.titles.append(span.before) }
            if !span.after.isEmpty {
                let place = T.locationValue(span.after)
                if !place.isEmpty { entry.location = place } else { entry.titles.append(span.after) }
            }
            var cursor = anchor + 1
            if anchorIndices[0] == 0 {
                while cursor < limit && entry.titles.count < 2 && titleLike(lines[cursor], flags[cursor], varied, entry.titles.isEmpty) {
                    entry.titles.append(lines[cursor].text.trimmingCharacters(in: .whitespacesAndNewlines))
                    cursor += 1
                }
            }
            if entry.location.isEmpty {
                entry.location = locationAfter(lines, cursor, limit, flags, linkedin)
                if !entry.location.isEmpty { cursor += 1 }
            }
            consumed.append(cursor)
            found.append(entry)
        }
        if anchorIndices[0] == 0 {
            for position in found.indices {
                let limit = position + 1 < anchorIndices.count ? anchorIndices[position + 1] : lines.count
                found[position].details = paragraph(Array(lines[min(consumed[position], limit)..<limit]))
            }
            return found
        }
        var starts: [Int] = []
        for (position, anchor) in anchorIndices.enumerated() {
            let lower = position == 0 ? 0 : consumed[position - 1]
            let reach = position == 0 ? 3 : 2
            var start = anchor
            var styledSeen = false
            while start - 1 >= lower && anchor - (start - 1) <= reach {
                let styled = flags[start - 1]
                if !titleLike(lines[start - 1], styled, false, false) || (varied && styledSeen && !styled) { break }
                start -= 1
                styledSeen = styledSeen || styled
            }
            if varied && !styledSeen { start = anchor }
            starts.append(start)
            found[position].titles.insert(contentsOf: lines[start..<anchor].map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }, at: 0)
        }
        for position in found.indices {
            let limit = position + 1 < found.count ? starts[position + 1] : lines.count
            let orphans = position == 0 ? Array(lines[0..<starts[0]]) : []
            let from = min(consumed[position], limit)
            found[position].details = paragraph(orphans + Array(lines[from..<max(from, limit)]))
        }
        return found
    }

    private static let pair = T.re("\\s+(?:at|@|bei|chez|presso)\\s+|\\s+[-|—–]\\s+|\\s*[,|@]\\s+", .caseInsensitive)
    private static let school = T.re("universit|univ\\.|college|school|okul|lise|institut|enstitu|academy|akademi|hochschule|fakulte|faculty|gymnasium|ecole|escuela|escola|liceo|lycee|politecnic|polytechnic|جامعة")
    private static let organisation = T.re("\\b(?:inc|ltd|llc|gmbh|ag|corp|co|a\\.s|s\\.a|sti|plc|bv|srl|sas|holding|group)\\b\\.?")
    private static let onRequest = T.re("request|talep|anfrage|demande|solicitud|richiesta|solicitacao")

    static func splitPair(_ text: String) -> (String, String) {
        guard let m = T.search(pair, text) else { return (T.trimmed(text), "") }
        let ns = text as NSString
        return (T.trimmed(ns.substring(to: m.range.location)), T.trimmed(ns.substring(from: m.range.location + m.range.length)))
    }

    private static func withExtra(_ details: String, _ extra: [String]) -> String {
        T.clip(extra.isEmpty ? details : (extra + [details]).joined(separator: "\n"), T.textLimit)
    }

    static func experienceFields(_ entry: Entry, linkedin: Bool) -> (String, String, String) {
        let texts = entry.titles.map(T.trimmed).filter { !$0.isEmpty }
        guard !texts.isEmpty else { return ("", "", entry.details) }
        if texts.count == 1 {
            let (role, org) = splitPair(texts[0])
            return (T.clip(role), T.clip(org), entry.details)
        }
        var first = texts[0], second = texts[1]
        let firstOrg = T.search(organisation, T.fold(first)) != nil
        let secondOrg = T.search(organisation, T.fold(second)) != nil
        if linkedin || (firstOrg && !secondOrg) { swap(&first, &second) }
        return (T.clip(first), T.clip(second), withExtra(entry.details, Array(texts.dropFirst(2))))
    }

    static func educationFields(_ entry: Entry, linkedin: Bool) -> (String, String, String) {
        let texts = entry.titles.map(T.trimmed).filter { !$0.isEmpty }
        guard !texts.isEmpty else { return ("", "", entry.details) }
        func isSchool(_ s: String) -> Bool { T.search(school, T.fold(s)) != nil }
        if texts.count == 1 {
            let (left, right) = splitPair(texts[0])
            if !right.isEmpty && isSchool(left) { return (T.clip(right), T.clip(left), entry.details) }
            if !right.isEmpty && isSchool(right) { return (T.clip(left), T.clip(right), entry.details) }
            if isSchool(texts[0]) { return ("", T.clip(texts[0]), entry.details) }
            return (T.clip(texts[0]), "", entry.details)
        }
        let schools = texts.prefix(2).enumerated().filter { isSchool($0.element) }.map(\.offset)
        let schoolIndex = schools.first ?? (linkedin ? 0 : 1)
        return (T.clip(texts[1 - schoolIndex]), T.clip(texts[schoolIndex]), withExtra(entry.details, Array(texts.dropFirst(2))))
    }

    static func certificates(_ lines: [Line]) -> [(String, String, String)] {
        logicalLines(lines).compactMap { line in
            var text = line
            var date = ""
            if let span = T.findRange(text) ?? T.findSingle(text) {
                date = span.start.isEmpty ? span.end : "\(span.start) - \(span.end)"
                text = [span.before, span.after].filter { !$0.isEmpty }.joined(separator: " ")
            }
            let (name, issuer) = splitPair(text)
            return name.isEmpty ? nil : (T.clip(name), T.clip(issuer), T.clip(date))
        }
    }

    private static func groups(_ lines: [Line]) -> [[Line]] {
        let (flags, varied) = styleFlags(lines)
        var groups: [[Line]] = []
        for (index, line) in lines.enumerated() {
            let previous = index > 0 ? lines[index - 1] : nil
            let starts: Bool
            if varied { starts = flags[index] && !(index > 0 && flags[index - 1]) } else {
                starts = previous == nil || previous!.page != line.page || line.y0 - previous!.y1 > line.size * 0.9
            }
            if starts || groups.isEmpty { groups.append([line]) } else { groups[groups.count - 1].append(line) }
        }
        return groups
    }

    static func projects(_ lines: [Line]) -> [(String, String, String)] {
        groups(lines).compactMap { group in
            var link = ""
            for line in group {
                if let m = T.search(T.url, line.text) {
                    link = T.sub(line.text, m.range)
                    while let last = link.last, ".,;:)".contains(last) { link.removeLast() }
                    break
                }
            }
            func stripped(_ s: String) -> String { T.trimmed(T.url.stringByReplacingMatches(in: s, range: T.full(s), withTemplate: " ")) }
            let name = link.isEmpty ? T.trimmed(group[0].text) : stripped(group[0].text)
            let rest = group.dropFirst().filter { !stripped($0.text).isEmpty }
            return name.isEmpty ? nil : (T.clip(name), T.clip(link), paragraph(Array(rest)))
        }
    }

    static func references(_ lines: [Line]) -> [(String, String, String)] {
        groups(lines).compactMap { group in
            if group.count <= 2 && T.search(onRequest, T.fold(group.map(\.text).joined(separator: " "))) != nil { return nil }
            var contact = "", role = ""
            for line in group.dropFirst() {
                let (found, rest) = T.contactsIn(line.text)
                if !found.isEmpty && contact.isEmpty { contact = found[0].1 } else if found.isEmpty && !rest.isEmpty && role.isEmpty { role = rest }
            }
            return (T.clip(T.trimmed(group[0].text)), T.clip(role), T.clip(contact))
        }
    }

    // MARK: Profile (`studio_cv.py`)

    private static func contacts(_ found: [(String, String)]) -> [StudioCVContact] {
        var seen = Set<String>()
        var result: [StudioCVContact] = []
        for (kind, value) in found where !value.isEmpty {
            var key = T.fold(value)
            while key.hasSuffix("/") { key.removeLast() }
            if seen.insert("\(kind)|\(key)").inserted { result.append(StudioCVContact(kind: StudioCVContactKind(rawValue: kind) ?? .other, value: T.clip(value))) }
        }
        return Array(result.prefix(StudioCVList.contacts.limit))
    }

    private static func levelled(_ names: [String], languages: Bool) -> [StudioCVLeveled] {
        names.compactMap { item in
            let (name, level) = languages ? T.languageLevel(item) : (T.clip(item), 0)
            return name.isEmpty ? nil : StudioCVLeveled(name: name, level: level)
        }
    }

    private static func fill(_ profile: inout StudioCVProfile, _ block: Block, _ linkedin: Bool) -> Int {
        let lines = block.lines
        switch block.key {
        case "summary":
            let text = paragraph(lines)
            profile.summary = T.clip(profile.summary.isEmpty ? text : "\(profile.summary)\n\(text)", T.textLimit)
            return text.isEmpty ? 0 : 1
        case "experience":
            let items = entries(lines, linkedin: linkedin).map { entry -> StudioCVExperience in
                let (role, org, details) = experienceFields(entry, linkedin: linkedin)
                return StudioCVExperience(role: role, organisation: org, location: T.clip(entry.location), start: entry.start, end: entry.end, current: entry.current, details: details)
            }
            profile.experience += items
            return items.count
        case "education":
            let items = entries(lines, linkedin: linkedin).map { entry -> StudioCVEducation in
                let (degree, school, details) = educationFields(entry, linkedin: linkedin)
                return StudioCVEducation(degree: degree, school: school, location: T.clip(entry.location), start: entry.start, end: entry.end, current: false, details: details)
            }
            profile.education += items
            return items.count
        case "skills":
            let found = levelled(skills(lines), languages: false)
            profile.skills += found
            return found.count
        case "languages":
            let found = levelled(listItems(lines, stripCategory: false), languages: true)
            profile.languages += found
            return found.count
        case "certificates":
            let items = certificates(lines).map { StudioCVCertificate(name: $0.0, issuer: $0.1, date: $0.2) }
            profile.certificates += items
            return items.count
        case "projects":
            let items = projects(lines).map { StudioCVProject(name: $0.0, link: $0.1, details: $0.2) }
            profile.projects += items
            return items.count
        case "references":
            let items = references(lines).map { StudioCVReference(name: $0.0, role: $0.1, contact: $0.2) }
            profile.references += items
            return items.count
        case "interests":
            let items = listItems(lines, stripCategory: false)
            profile.interests = T.clip(([profile.interests] + items).filter { !$0.isEmpty }.joined(separator: ", "), T.textLimit)
            return items.count
        case "custom":
            let body = paragraph(lines)
            if !body.isEmpty { profile.custom.append(StudioCVCustom(heading: T.clip(block.heading), body: body)) }
            return body.isEmpty ? 0 : 1
        default:
            return 0
        }
    }

    static func profile(_ lines: [Line], footers: Int) -> (StudioCVProfile, [Section], Bool) {
        let (headerLines, blocks, headings) = segment(lines)
        let every = lines.map { T.fold($0.text) }.joined(separator: " ")
        let linkedin = every.contains("linkedin.com/in/") && (footers > 0 || !headings.isDisjoint(with: ["top skills", "contact"]))
        let header = readHeader(headerLines, lines, linkedin: linkedin)
        var profile = StudioCVProfile()
        profile.name = T.clip(header.name)
        profile.headline = T.clip(header.headline)
        profile.contacts = []
        profile.experience = []
        profile.education = []
        var counts: [String: Int] = [:]
        var confidence: [String: Double] = [:]
        var foundContacts = header.contacts
        var location = header.location
        for block in blocks {
            if block.key == "contact" || block.key == "personal" {
                let (extra, place) = blockContacts(block.lines)
                foundContacts += extra
                if location.isEmpty { location = place }
                if !extra.isEmpty { confidence["contact"] = keywordConfidence }
                if block.key == "personal" { confidence["personal"] = keywordConfidence }
                continue
            }
            let count = fill(&profile, block, linkedin)
            if count > 0 {
                counts[block.key, default: 0] += count
                confidence[block.key] = max(confidence[block.key] ?? 0, block.confidence)
            }
        }
        if profile.summary.isEmpty && !header.leftover.isEmpty {
            profile.summary = paragraph(header.leftover)
            counts["summary"] = 1
            confidence["summary"] = inferredConfidence
        }
        if !foundContacts.contains(where: { $0.0 == "email" }) { foundContacts += firstPageEmails(lines) }
        if !location.isEmpty { foundContacts.append(("location", location)) }
        profile.contacts = contacts(foundContacts)
        profile.experience = Array(profile.experience.prefix(StudioCVList.experience.limit))
        profile.education = Array(profile.education.prefix(StudioCVList.education.limit))
        profile.skills = Array(profile.skills.prefix(StudioCVList.skills.limit))
        profile.languages = Array(profile.languages.prefix(StudioCVList.languages.limit))
        profile.certificates = Array(profile.certificates.prefix(StudioCVList.certificates.limit))
        profile.projects = Array(profile.projects.prefix(StudioCVList.projects.limit))
        profile.references = Array(profile.references.prefix(StudioCVList.references.limit))
        profile.custom = Array(profile.custom.prefix(StudioCVList.custom.limit))
        counts["personal"] = (profile.name.isEmpty ? 0 : 1) + (profile.headline.isEmpty ? 0 : 1)
        counts["contact"] = profile.contacts.count
        for list in StudioCVList.allCases where counts[list.rawValue] != nil { counts[list.rawValue] = min(counts[list.rawValue]!, list.limit) }
        let sections = StudioCVImportKey.allCases.compactMap { key -> Section? in
            guard let count = counts[key.rawValue], count > 0 else { return nil }
            return Section(key: key, count: count, confidence: confidence[key.rawValue] ?? inferredConfidence)
        }
        return (profile, sections, linkedin)
    }

    /// `studio.cv_import_pdf`. Throws `NEEDS_PASSWORD` for locked files and `UNSUPPORTED/noText` for scans.
    static func read(url: URL, password: String?, progress: ProgressHandler? = nil) throws -> Result {
        let document: PDFDocument? = withSecurityScope(url) { PDFDocument(url: url) }
        guard let document else { throw EngineError(.INVALID_PDF) }
        if document.isLocked {
            guard let password, !password.isEmpty, document.unlock(withPassword: password) else { throw EngineError(.NEEDS_PASSWORD) }
        }
        let total = min(document.pageCount, maxPages)
        let reporter = ProgressReporter(total: total, progress)
        var lines: [Line] = []
        var footers = 0
        for index in 0..<total {
            try reporter.step(index)
            guard let page = document.page(at: index) else { continue }
            let found = pageLines(page, number: index)
            lines += found.lines
            footers += found.footers
        }
        guard lines.contains(where: { $0.text.contains(where: { $0.isLetter || $0.isNumber }) }) else {
            throw EngineError(.UNSUPPORTED, reason: "noText")
        }
        let (profile, sections, linkedin) = profile(lines, footers: footers)
        return Result(profile: profile, sections: sections, linkedin: linkedin, pages: document.pageCount)
    }
}
