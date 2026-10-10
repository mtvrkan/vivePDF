import Foundation

/// Rows of a CSV/TSV/TXT or XLSX/XLSM table: the first row names the columns (desktop `_form_rows.load_rows`).
struct TableData: Sendable {
    var columns: [String]
    var rows: [[String: String]]
    /// Worksheet names (XLSX only), in workbook order.
    var sheets: [String]
}

enum TableDataReader {
    static let extensions = ["csv", "tsv", "txt", "xlsx", "xlsm"]

    static func read(_ url: URL, sheet: String? = nil) throws -> TableData {
        guard FileManager.default.fileExists(atPath: url.path) else { throw EngineError(.FILE_NOT_FOUND, detail: url.lastPathComponent) }
        switch url.pathExtension.lowercased() {
        case "xlsx", "xlsm": return try readWorkbook(url, sheet: sheet)
        default:
            guard let data = try? Data(contentsOf: url) else { throw EngineError(.FILE_NOT_FOUND, detail: url.lastPathComponent) }
            return readDelimited(TextCodec.decode(data))
        }
    }

    // MARK: CSV

    /// Picks the delimiter that splits the sample lines most consistently (`csv.Sniffer` on desktop).
    static func sniffDelimiter(_ text: String) -> Character {
        let sample = text.prefix(4096).split(separator: "\n", omittingEmptySubsequences: true).prefix(20).map(String.init)
        var best: Character = ","
        var bestScore = -1
        for candidate in [";", ",", "\t", "|"] as [Character] {
            let counts = sample.map { line in splitLine(line, delimiter: candidate).count }
            guard let first = counts.first, first > 1 else { continue }
            let consistent = counts.filter { $0 == first }.count
            let score = consistent * 100 + first
            if score > bestScore { bestScore = score; best = candidate }
        }
        return best
    }

    private static func splitLine(_ line: String, delimiter: Character) -> [String] {
        parseRecords(line, delimiter: delimiter).first ?? []
    }

    /// RFC 4180 records: quoted fields may contain delimiters, doubled quotes and newlines.
    static func parseRecords(_ text: String, delimiter: Character) -> [[String]] {
        var records: [[String]] = []
        var record: [String] = []
        var field = ""
        var quoted = false
        var atFieldStart = true
        var iterator = text.makeIterator()
        var pending: Character? = nil
        func next() -> Character? {
            if let value = pending { pending = nil; return value }
            return iterator.next()
        }
        while let character = next() {
            if quoted {
                if character == "\"" {
                    if let following = next() {
                        if following == "\"" { field.append("\"") } else { quoted = false; pending = following }
                    } else {
                        quoted = false
                    }
                } else {
                    field.append(character)
                }
                continue
            }
            switch character {
            case "\"" where atFieldStart:
                quoted = true
                atFieldStart = false
            case delimiter:
                record.append(field)
                field = ""
                atFieldStart = true
            case "\n", "\r\n", "\r":
                record.append(field)
                records.append(record)
                record = []
                field = ""
                atFieldStart = true
            default:
                field.append(character)
                atFieldStart = false
            }
        }
        if !field.isEmpty || !record.isEmpty {
            record.append(field)
            records.append(record)
        }
        return records
    }

    static func readDelimited(_ text: String, delimiter: Character? = nil) -> TableData {
        let separator = delimiter ?? sniffDelimiter(text)
        var records = parseRecords(text, delimiter: separator)
        guard !records.isEmpty else { return TableData(columns: [], rows: [], sheets: []) }
        let header = records.removeFirst().map { $0.trimmingCharacters(in: .whitespaces) }
        let rows: [[String: String]] = records.compactMap { record in
            guard record.contains(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else { return nil }
            var row: [String: String] = [:]
            for (index, column) in header.enumerated() where !column.isEmpty {
                row[column] = index < record.count ? record[index].trimmingCharacters(in: .whitespaces) : ""
            }
            return row
        }
        return TableData(columns: header.filter { !$0.isEmpty }, rows: rows, sheets: [])
    }

    // MARK: XLSX

    private static func readWorkbook(_ url: URL, sheet: String?) throws -> TableData {
        let zip: ZipReader
        do { zip = try ZipReader(url: url) } catch { throw EngineError(.INVALID_PARAMS, reason: "fileUnreadable", detail: url.lastPathComponent) }
        guard let workbook = try? zip.data("xl/workbook.xml") else { throw EngineError(.INVALID_PARAMS, reason: "fileUnreadable", detail: url.lastPathComponent) }
        let relations = (try? zip.data("xl/_rels/workbook.xml.rels")).map { SimpleXML.parse($0) } ?? nil
        var targets: [String: String] = [:]
        for node in relations?.descendants("Relationship") ?? [] {
            if let id = node.attributes["Id"], let target = node.attributes["Target"] { targets[id] = target }
        }
        let book = SimpleXML.parse(workbook)
        var sheets: [(name: String, path: String)] = []
        for node in book?.descendants("sheet") ?? [] {
            guard let name = node.attributes["name"] else { continue }
            let relation = node.attributes["r:id"] ?? node.attributes.first { $0.key.hasSuffix(":id") }?.value ?? ""
            var target = targets[relation] ?? "worksheets/sheet\(sheets.count + 1).xml"
            if target.hasPrefix("/") { target.removeFirst() } else { target = "xl/" + target }
            sheets.append((name, target))
        }
        guard !sheets.isEmpty else { throw EngineError(.INVALID_PARAMS, reason: "noSheets") }
        let chosen = sheets.first { $0.name == sheet } ?? sheets[0]
        let shared = sharedStrings(zip)
        let dateStyles = dateStyleIndexes(zip)
        let dateBase1904 = book?.descendants("workbookPr").first?.attributes["date1904"].map { $0 == "1" || $0 == "true" } ?? false
        guard let sheetData = try? zip.data(chosen.path), let root = SimpleXML.parse(sheetData) else {
            return TableData(columns: [], rows: [], sheets: sheets.map(\.name))
        }
        var grid: [[String]] = []
        for row in root.descendants("row") {
            var values: [String] = []
            for cell in row.children where cell.name == "c" {
                let column = cell.attributes["r"].map(columnIndex) ?? values.count
                while values.count < column { values.append("") }
                values.append(cellText(cell, shared: shared, dateStyles: dateStyles, base1904: dateBase1904))
            }
            let rowIndex = row.attributes["r"].flatMap(Int.init).map { $0 - 1 } ?? grid.count
            while grid.count < rowIndex { grid.append([]) }
            grid.append(values)
        }
        guard !grid.isEmpty else { return TableData(columns: [], rows: [], sheets: sheets.map(\.name)) }
        let header = grid.removeFirst().map { $0.trimmingCharacters(in: .whitespaces) }
        let rows: [[String: String]] = grid.compactMap { values in
            guard values.contains(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else { return nil }
            var row: [String: String] = [:]
            for (index, column) in header.enumerated() where !column.isEmpty {
                row[column] = index < values.count ? values[index].trimmingCharacters(in: .whitespaces) : ""
            }
            return row
        }
        return TableData(columns: header.filter { !$0.isEmpty }, rows: rows, sheets: sheets.map(\.name))
    }

    private static func columnIndex(_ reference: String) -> Int {
        var value = 0
        for scalar in reference.unicodeScalars {
            guard scalar.value >= 65 && scalar.value <= 90 else { break }
            value = value * 26 + Int(scalar.value - 64)
        }
        return max(0, value - 1)
    }

    private static func sharedStrings(_ zip: ZipReader) -> [String] {
        guard let data = try? zip.data("xl/sharedStrings.xml"), let root = SimpleXML.parse(data) else { return [] }
        return root.children.filter { $0.name == "si" }.map { item in
            item.descendants("t").filter { !$0.hasAncestorNamed("rPh") }.map(\.text).joined()
        }
    }

    private static func dateStyleIndexes(_ zip: ZipReader) -> Set<Int> {
        guard let data = try? zip.data("xl/styles.xml"), let root = SimpleXML.parse(data) else { return [] }
        var custom: [Int: String] = [:]
        for format in root.descendants("numFmt") {
            if let id = format.attributes["numFmtId"].flatMap(Int.init), let code = format.attributes["formatCode"] { custom[id] = code }
        }
        let builtinDates: Set<Int> = Set(14...22).union([27, 30, 36, 45, 46, 47, 50, 57])
        var dates: Set<Int> = []
        let cellXfs = root.descendants("cellXfs").first?.children.filter { $0.name == "xf" } ?? []
        for (index, xf) in cellXfs.enumerated() {
            guard let id = xf.attributes["numFmtId"].flatMap(Int.init) else { continue }
            if builtinDates.contains(id) { dates.insert(index); continue }
            if let code = custom[id] {
                let stripped = code.replacingOccurrences(of: #"\[[^\]]*\]|"[^"]*""#, with: "", options: .regularExpression).lowercased()
                if stripped.contains("y") || stripped.contains("d") || (stripped.contains("m") && stripped.contains("h")) { dates.insert(index) }
            }
        }
        return dates
    }

    private static func cellText(_ cell: SimpleXML.Node, shared: [String], dateStyles: Set<Int>, base1904: Bool) -> String {
        let type = cell.attributes["t"] ?? "n"
        let value = cell.children.first { $0.name == "v" }?.text ?? ""
        switch type {
        case "s": return Int(value).flatMap { $0 < shared.count ? shared[$0] : nil } ?? ""
        case "inlineStr": return cell.descendants("t").map(\.text).joined()
        case "str", "e": return value
        case "b": return value == "1" ? "TRUE" : "FALSE"
        case "d": return value
        default:
            guard let number = Double(value) else { return value }
            if let style = cell.attributes["s"].flatMap(Int.init), dateStyles.contains(style) {
                return excelDate(number, base1904: base1904)
            }
            if number == number.rounded() && abs(number) < 1e15 { return String(Int64(number)) }
            var text = String(format: "%.10g", number)
            if text.contains("e") { text = String(number) }
            return text
        }
    }

    private static func excelDate(_ serial: Double, base1904: Bool) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let base = base1904 ? DateComponents(year: 1904, month: 1, day: 1) : DateComponents(year: 1899, month: 12, day: 30)
        guard let origin = calendar.date(from: base) else { return String(serial) }
        let date = origin.addingTimeInterval(serial * 86_400)
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let day = String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
        if serial == serial.rounded() { return day }
        let time = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
        return serial < 1 ? time : "\(day) \(time)"
    }
}

/// A tiny DOM over XMLParser — enough for OOXML parts and EPUB/OPF manifests.
enum SimpleXML {
    final class Node {
        let name: String
        let attributes: [String: String]
        var children: [Node] = []
        var text = ""
        weak var parent: Node?

        init(name: String, attributes: [String: String]) {
            self.name = name
            self.attributes = attributes
        }

        func descendants(_ local: String) -> [Node] {
            var found: [Node] = []
            var stack = children.reversed() as [Node]
            while let node = stack.popLast() {
                if node.localName == local { found.append(node) }
                stack.append(contentsOf: node.children.reversed())
            }
            return found
        }

        var localName: String { name.split(separator: ":").last.map(String.init) ?? name }

        func hasAncestorNamed(_ local: String) -> Bool {
            var node = parent
            while let current = node {
                if current.localName == local { return true }
                node = current.parent
            }
            return false
        }
    }

    private final class Builder: NSObject, XMLParserDelegate {
        var root: Node?
        var stack: [Node] = []

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
            let local = elementName.split(separator: ":").last.map(String.init) ?? elementName
            let node = Node(name: local, attributes: attributeDict)
            node.parent = stack.last
            stack.last?.children.append(node)
            if root == nil { root = node }
            stack.append(node)
        }

        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
            _ = stack.popLast()
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            stack.last?.text += string
        }

        func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
            stack.last?.text += String(decoding: CDATABlock, as: UTF8.self)
        }
    }

    static func parse(_ data: Data) -> Node? {
        let parser = XMLParser(data: data)
        let builder = Builder()
        parser.delegate = builder
        parser.shouldResolveExternalEntities = false
        parser.parse()
        return builder.root
    }
}
