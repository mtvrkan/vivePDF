import CoreGraphics
import Foundation

/// A paragraph: consecutive lines of one text column.
struct TextBlock {
    var lines: [TextLine]
    var rect: CGRect
    var size: CGFloat { lines.first?.size ?? 11 }
    var rtl: Bool { lines.filter(\.rtl).count * 2 > lines.count }
    var text: String { PageLayout.joinLines(lines.map(\.text)) }
}

/// A table found on a page: grid boundaries plus the text of every cell.
struct DetectedTable {
    var rect: CGRect
    /// Column boundaries (x), count = columns + 1.
    var xs: [CGFloat]
    /// Row boundaries (y), count = rows + 1.
    var ys: [CGFloat]
    /// Cell lines (row → column → lines, top to bottom).
    var cells: [[[TextLine]]]
    /// Merged cell ranges (first row, first column, last row, last column), inclusive.
    var merges: [(r0: Int, c0: Int, r1: Int, c1: Int)]
    var ruled: Bool

    var rowCount: Int { ys.count - 1 }
    var columnCount: Int { xs.count - 1 }

    func text(_ row: Int, _ column: Int) -> String {
        cells[row][column].map(\.text).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: "\n")
    }

    /// Text rows (`nil` for cells covered by a merge, other than its top-left cell).
    var rows: [[String?]] {
        var covered = Set<Int>()
        for merge in merges {
            for row in merge.r0...merge.r1 { for column in merge.c0...merge.c1 where row != merge.r0 || column != merge.c0 { covered.insert(row * 10_000 + column) } }
        }
        return (0..<rowCount).map { row in (0..<columnCount).map { column in covered.contains(row * 10_000 + column) ? nil : text(row, column) } }
    }

    func merge(at row: Int, _ column: Int) -> (r0: Int, c0: Int, r1: Int, c1: Int)? {
        merges.first { row >= $0.r0 && row <= $0.r1 && column >= $0.c0 && column <= $0.c1 }
    }
}

enum PageElement {
    case paragraph(TextBlock)
    case table(DetectedTable)
    case image(PlacedImage)

    var rect: CGRect {
        switch self {
        case .paragraph(let block): block.rect
        case .table(let table): table.rect
        case .image(let image): image.rect
        }
    }
}

enum PageLayout {
    // MARK: Text helpers

    /// Joins wrapped lines into running text, undoing end-of-line hyphenation.
    static func joinLines(_ lines: [String]) -> String {
        var out = ""
        for raw in lines {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { continue }
            if out.isEmpty { out = line; continue }
            if out.hasSuffix("-"), out.count > 1, let first = line.first, first.isLowercase,
               let before = out.dropLast().last, before.isLetter {
                out.removeLast()
                out += line
            } else {
                out += " " + line
            }
        }
        return out
    }

    static let bullets: Set<Character> = ["•", "◦", "▪", "▫", "●", "○", "■", "□", "–", "-", "*", "·", "‣", "⁃", "➢", "►", "✓", "✔"]

    /// "• text" → ("•", "text"), "3. text" → ("3.", "text").
    static func listMarker(_ text: String) -> (marker: String, ordered: Bool, rest: String)? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if let first = trimmed.first, bullets.contains(first) {
            let rest = trimmed.dropFirst().trimmingCharacters(in: .whitespaces)
            if !rest.isEmpty && (first != "-" && first != "*" || trimmed.dropFirst().first == " ") { return (String(first), false, rest) }
        }
        if let range = trimmed.range(of: #"^(\d{1,3}|[a-zA-Z])[.)]\s+"#, options: .regularExpression) {
            let marker = trimmed[range].trimmingCharacters(in: .whitespaces)
            return (marker, true, String(trimmed[range.upperBound...]))
        }
        return nil
    }

    // MARK: Paragraphs

    /// Groups lines (already in reading order) into paragraphs.
    static func paragraphs(_ lines: [TextLine]) -> [TextBlock] {
        var blocks: [TextBlock] = []
        for line in lines where !line.text.trimmingCharacters(in: .whitespaces).isEmpty {
            if var block = blocks.last, let previous = block.lines.last, continues(previous, line, block: block) {
                block.lines.append(line)
                block.rect = block.rect.union(line.rect)
                blocks[blocks.count - 1] = block
            } else {
                blocks.append(TextBlock(lines: [line], rect: line.rect))
            }
        }
        return blocks
    }

    private static func continues(_ previous: TextLine, _ line: TextLine, block: TextBlock) -> Bool {
        let size = max(previous.size, 1)
        guard abs(line.size - previous.size) <= size * 0.15, previous.rtl == line.rtl, previous.bold == line.bold || block.lines.count > 1 else { return false }
        let gap = line.rect.minY - previous.rect.maxY
        guard gap > -size * 0.5, gap < size * 0.75 else { return false }
        let overlap = min(previous.rect.maxX, line.rect.maxX) - max(previous.rect.minX, line.rect.minX)
        guard overlap > min(previous.rect.width, line.rect.width) * 0.3 else { return false }
        if listMarker(line.text) != nil { return false }
        // A short previous line that does not reach the block's right edge ends a paragraph.
        if block.lines.count > 1 {
            let right = block.rect.maxX
            if !previous.rtl && previous.rect.maxX < right - size * 6 && !previous.text.hasSuffix("-") { return false }
        }
        return true
    }

    // MARK: Reading order (recursive XY-cut)

    static func readingOrder<T>(_ items: [T], rect: (T) -> CGRect, gap: CGFloat = 6) -> [T] {
        guard items.count > 1 else { return items }
        let rects = items.map(rect)
        // Vertical channel spanning the whole region → columns, left to right.
        if let cut = xCut(rects, minGap: gap) {
            let left = items.enumerated().filter { rects[$0.offset].midX < cut }.map(\.element)
            let right = items.enumerated().filter { rects[$0.offset].midX >= cut }.map(\.element)
            if !left.isEmpty && !right.isEmpty { return readingOrder(left, rect: rect, gap: gap) + readingOrder(right, rect: rect, gap: gap) }
        }
        if let cut = yCut(rects) {
            let top = items.enumerated().filter { rects[$0.offset].midY < cut }.map(\.element)
            let bottom = items.enumerated().filter { rects[$0.offset].midY >= cut }.map(\.element)
            if !top.isEmpty && !bottom.isEmpty { return readingOrder(top, rect: rect, gap: gap) + readingOrder(bottom, rect: rect, gap: gap) }
        }
        return items.sorted { abs(rect($0).minY - rect($1).minY) > 2 ? rect($0).minY < rect($1).minY : rect($0).minX < rect($1).minX }
    }

    private static func xCut(_ rects: [CGRect], minGap: CGFloat) -> CGFloat? {
        let sorted = rects.sorted { $0.minX < $1.minX }
        var reach = sorted[0].maxX
        var best: (gap: CGFloat, at: CGFloat)?
        for rect in sorted.dropFirst() {
            if rect.minX - reach >= minGap, rect.minX - reach > (best?.gap ?? 0) { best = (rect.minX - reach, (rect.minX + reach) / 2) }
            reach = max(reach, rect.maxX)
        }
        return best?.at
    }

    private static func yCut(_ rects: [CGRect]) -> CGFloat? {
        let sorted = rects.sorted { $0.minY < $1.minY }
        var reach = sorted[0].maxY
        var best: (gap: CGFloat, at: CGFloat)?
        for rect in sorted.dropFirst() {
            if rect.minY - reach > -0.5, rect.minY - reach >= (best?.gap ?? -0.5) { best = (rect.minY - reach, (rect.minY + reach) / 2) }
            reach = max(reach, rect.maxY)
        }
        return best?.at
    }

    // MARK: Elements

    /// The page as paragraphs, tables and pictures in reading order.
    static func elements(_ page: PageContent, tables: [DetectedTable], images: Bool) -> [PageElement] {
        let free = page.lines.filter { line in !tables.contains { $0.rect.insetBy(dx: -2, dy: -2).contains(CGPoint(x: line.rect.midX, y: line.rect.midY)) } }
        // Order lines first (columns), then group paragraphs, then interleave tables and pictures.
        let ordered = readingOrder(free, rect: \.rect, gap: max(page.bodySize * 0.9, 8))
        var elements: [PageElement] = paragraphs(ordered).map { .paragraph($0) }
        elements += tables.map { .table($0) }
        if images {
            let pageRect = CGRect(origin: .zero, size: page.size)
            elements += page.images.filter { $0.rect.width >= 8 && $0.rect.height >= 8 }
                .filter { image in !tables.contains { $0.rect.contains(image.rect) } }
                .map { var copy = $0; copy.rect = $0.rect.intersection(pageRect); return .image(copy) }
        }
        return readingOrder(elements, rect: \.rect, gap: max(page.bodySize * 0.9, 8))
    }

    /// Heading level for a block given the document's body size (1…3), or nil.
    static func headingLevel(_ block: TextBlock, body: CGFloat) -> Int? {
        let text = block.text
        guard text.count <= 200, body > 0, !text.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        let size = block.lines.map(\.size).max() ?? block.size
        if size >= body * 1.5 { return 1 }
        if size >= body * 1.25 { return 2 }
        if size >= body * 1.1 { return 3 }
        return nil
    }

    // MARK: Tables

    static func tables(_ page: PageContent, borderless: Bool) -> [DetectedTable] {
        let ruled = ruledTables(page)
        if !ruled.isEmpty || !borderless { return ruled }
        return alignedTables(page)
    }

    private static func ruledTables(_ page: PageContent) -> [DetectedTable] {
        let horizontal = page.rulings.filter { $0.height <= 3 && $0.width >= 6 }
        let vertical = page.rulings.filter { $0.width <= 3 && $0.height >= 6 }
        guard horizontal.count >= 2, vertical.count >= 2 else { return [] }
        let all = horizontal + vertical
        // Connected components of touching rulings.
        var parent = Array(all.indices)
        func find(_ i: Int) -> Int { var i = i; while parent[i] != i { parent[i] = parent[parent[i]]; i = parent[i] }; return i }
        for i in all.indices {
            let a = all[i].insetBy(dx: -2, dy: -2)
            for j in (i + 1)..<all.count where a.intersects(all[j]) {
                let ri = find(i), rj = find(j)
                if ri != rj { parent[ri] = rj }
            }
        }
        var groups: [Int: [Int]] = [:]
        for index in all.indices { groups[find(index), default: []].append(index) }
        var tables: [DetectedTable] = []
        for members in groups.values {
            let hs = members.filter { $0 < horizontal.count }.map { all[$0] }
            let vs = members.filter { $0 >= horizontal.count }.map { all[$0] }
            guard hs.count >= 2, vs.count >= 2 else { continue }
            let ys = snap(hs.map(\.midY))
            let xs = snap(vs.map(\.midX))
            guard ys.count >= 2, xs.count >= 2, (ys.count - 1) * (xs.count - 1) >= 2 else { continue }
            let rect = CGRect(x: xs.first!, y: ys.first!, width: xs.last! - xs.first!, height: ys.last! - ys.first!)
            guard rect.width > 20, rect.height > 8 else { continue }
            var table = DetectedTable(rect: rect, xs: xs, ys: ys, cells: [], merges: [], ruled: true)
            table.merges = merges(xs: xs, ys: ys, horizontal: hs, vertical: vs)
            fill(&table, lines: page.lines)
            // A frame around a block of prose is not a table.
            let filled = (0..<table.rowCount).flatMap { r in (0..<table.columnCount).map { c in table.text(r, c) } }.filter { !$0.isEmpty }.count
            if filled == 0 { continue }
            tables.append(table)
        }
        return tables.sorted { $0.rect.minY < $1.rect.minY }
    }

    private static func snap(_ values: [CGFloat], tolerance: CGFloat = 2.5) -> [CGFloat] {
        var out: [CGFloat] = []
        for value in values.sorted() {
            if let last = out.last, value - last <= tolerance { out[out.count - 1] = (last + value) / 2 } else { out.append(value) }
        }
        return out
    }

    private static func merges(xs: [CGFloat], ys: [CGFloat], horizontal: [CGRect], vertical: [CGRect]) -> [(r0: Int, c0: Int, r1: Int, c1: Int)] {
        let rows = ys.count - 1, columns = xs.count - 1
        var parent = Array(0..<(rows * columns))
        func find(_ i: Int) -> Int { var i = i; while parent[i] != i { parent[i] = parent[parent[i]]; i = parent[i] }; return i }
        func union(_ a: Int, _ b: Int) { let ra = find(a), rb = find(b); if ra != rb { parent[max(ra, rb)] = min(ra, rb) } }
        for row in 0..<rows {
            let midY = (ys[row] + ys[row + 1]) / 2
            for column in 0..<(columns - max(0, 0)) where column + 1 < columns {
                let x = xs[column + 1]
                let walled = vertical.contains { abs($0.midX - x) <= 3 && $0.minY <= midY && $0.maxY >= midY }
                if !walled { union(row * columns + column, row * columns + column + 1) }
            }
        }
        for column in 0..<columns {
            let midX = (xs[column] + xs[column + 1]) / 2
            for row in 0..<rows where row + 1 < rows {
                let y = ys[row + 1]
                let walled = horizontal.contains { abs($0.midY - y) <= 3 && $0.minX <= midX && $0.maxX >= midX }
                if !walled { union(row * columns + column, (row + 1) * columns + column) }
            }
        }
        var groups: [Int: [Int]] = [:]
        for cell in 0..<(rows * columns) { groups[find(cell), default: []].append(cell) }
        return groups.values.filter { $0.count > 1 }.map { cells in
            let rowsIn = cells.map { $0 / columns }, columnsIn = cells.map { $0 % columns }
            return (rowsIn.min()!, columnsIn.min()!, rowsIn.max()!, columnsIn.max()!)
        }
    }

    private static func fill(_ table: inout DetectedTable, lines: [TextLine]) {
        var cells = Array(repeating: Array(repeating: [TextLine](), count: table.columnCount), count: table.rowCount)
        for line in lines where table.rect.insetBy(dx: -2, dy: -2).contains(CGPoint(x: line.rect.midX, y: line.rect.midY)) {
            // Split the line's spans across cells by their centres.
            var pieces: [Int: [TextSpan]] = [:]
            for span in line.spans {
                let x = span.rect.midX, y = span.rect.midY
                guard let column = table.xs.indices.dropLast().last(where: { table.xs[$0] <= x }),
                      let row = table.ys.indices.dropLast().last(where: { table.ys[$0] <= y }) else { continue }
                let r = min(row, table.rowCount - 1), c = min(column, table.columnCount - 1)
                let target = table.merge(at: r, c).map { ($0.r0, $0.c0) } ?? (r, c)
                pieces[target.0 * 10_000 + target.1, default: []].append(span)
            }
            for (key, spans) in pieces {
                var trimmed = spans
                if let last = trimmed.indices.last { trimmed[last].text = trimmed[last].text.trimmingCharacters(in: .whitespaces) }
                cells[key / 10_000][key % 10_000].append(TextLine(spans: trimmed, rect: trimmed.reduce(.null) { $0.union($1.rect) }, rtl: line.rtl))
            }
        }
        table.cells = cells
    }

    /// Tables without rulings: runs of lines whose text pieces line up in two or more columns.
    private static func alignedTables(_ page: PageContent) -> [DetectedTable] {
        let ordered = page.lines.sorted { $0.rect.minY < $1.rect.minY }
        // Merge lines on one baseline (the reader splits them at wide gaps).
        var rows: [[TextLine]] = []
        for line in ordered {
            if let last = rows.last?.first, abs(last.rect.midY - line.rect.midY) < min(last.rect.height, line.rect.height) * 0.5 {
                rows[rows.count - 1].append(line)
            } else {
                rows.append([line])
            }
        }
        var tables: [DetectedTable] = []
        var run: [[TextLine]] = []
        func flush() {
            defer { run = [] }
            guard run.count >= 2 else { return }
            let starts = snap(run.flatMap { $0.map(\.rect.minX) }, tolerance: 6)
            let columns = starts.filter { start in run.filter { row in row.contains { abs($0.rect.minX - start) <= 6 } }.count * 2 >= run.count }
            guard columns.count >= 2 else { return }
            let filledRows = run.filter { row in Set(row.compactMap { line in columns.lastIndex { $0 <= line.rect.minX + 6 } }).count >= 2 }
            guard filledRows.count >= 2 else { return }
            let all = run.flatMap { $0 }
            let rect = all.reduce(CGRect.null) { $0.union($1.rect) }
            var xs = columns.map { $0 - 2 }
            xs[0] = min(xs[0], rect.minX - 2)
            xs.append(rect.maxX + 2)
            var ys: [CGFloat] = [run[0].map(\.rect.minY).min()! - 2]
            for index in 0..<(run.count - 1) {
                let bottom = run[index].map(\.rect.maxY).max()!, top = run[index + 1].map(\.rect.minY).min()!
                ys.append((bottom + top) / 2)
            }
            ys.append(run[run.count - 1].map(\.rect.maxY).max()! + 2)
            var table = DetectedTable(rect: CGRect(x: xs.first!, y: ys.first!, width: xs.last! - xs.first!, height: ys.last! - ys.first!), xs: xs, ys: ys, cells: [], merges: [], ruled: false)
            fill(&table, lines: all)
            tables.append(table)
        }
        for row in rows {
            let multi = row.count >= 2
            if let previous = run.last, multi {
                let gap = row.map(\.rect.minY).min()! - previous.map(\.rect.maxY).max()!
                if gap > (row.first?.size ?? 11) * 2.5 { flush() }
            }
            if multi { run.append(row) } else { flush() }
        }
        flush()
        return tables
    }
}
