import CoreGraphics
import Foundation

// Value types shared by the page organizer, page tools, merge and split
// (`OrganizerTile`, `PagesPaperPattern`, `PageLabelRule` in the desktop `types.ts` / `pages.py`).

/// Ruled paper patterns for inserted blank pages (`PagesPaperStyle` in `_paper.py`).
enum PagesPaperStyle: String, CaseIterable, Codable, Hashable, Sendable {
    case lined, grid, dots, isometric, handwriting, staff

    /// Default line spacing in millimetres for each style.
    var defaultSpacing: Double {
        switch self {
        case .lined: 8
        case .grid: 5
        case .dots: 5
        case .isometric: 6
        case .handwriting: 4
        case .staff: 2
        }
    }
}

struct PagesPaperPattern: Codable, Hashable, Sendable {
    static let spacingRange: ClosedRange<Double> = 2...30
    static let spacingStep = 0.5
    static let defaultColor = "#9bb4d0"

    var style: PagesPaperStyle
    /// Millimetres between lines / dots.
    var spacing: Double
    /// `#rrggbb`.
    var color: String = PagesPaperPattern.defaultColor
    var margin = false
}

/// Page-label numbering styles (`/S` in a PDF page-label dictionary; empty = text only).
enum PageLabelStyle: String, CaseIterable, Codable, Hashable, Sendable {
    case decimal = "D", romanLower = "r", romanUpper = "R", lettersLower = "a", lettersUpper = "A", none = ""

    /// Key below `tools.pages.labels.styles.`.
    var labelKey: String { rawValue.isEmpty ? "none" : rawValue }
}

/// A page label that starts at one tile and runs until the next one (desktop `PagesTileLabel`).
struct PagesTileLabel: Codable, Hashable, Sendable {
    var style: PageLabelStyle = .decimal
    var prefix = ""
    var firstNumber = 1

    static let prefixLimit = 64
    static let numberLimit = 100_000

    func text(at offset: Int) -> String {
        let value = firstNumber + offset
        switch style {
        case .decimal: return "\(prefix)\(value)"
        case .romanLower: return prefix + PageLabelFormat.roman(value)
        case .romanUpper: return prefix + PageLabelFormat.roman(value).uppercased()
        case .lettersLower: return prefix + PageLabelFormat.letters(value)
        case .lettersUpper: return prefix + PageLabelFormat.letters(value).uppercased()
        case .none: return prefix
        }
    }
}

/// One `/PageLabels` range: from output page `start` (0-based) on.
struct PageLabelRule: Hashable, Sendable {
    var start: Int
    var style: PageLabelStyle
    var prefix: String
    var firstNumber: Int
}

enum PageLabelFormat {
    private static let romanTable: [(Int, String)] = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"),
                                                      (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]

    static func roman(_ value: Int) -> String {
        var rest = value
        var text = ""
        for (amount, symbol) in romanTable {
            while rest >= amount { text += symbol; rest -= amount }
        }
        return text
    }

    static func letters(_ value: Int) -> String {
        guard value >= 1 else { return "" }
        let letter = Character(UnicodeScalar(UInt8(97 + (value - 1) % 26)))
        return String(repeating: letter, count: (value - 1) / 26 + 1)
    }
}

/// One page slot in the organizer. `index` is 1-based like the desktop store.
struct OrganizerTile: Identifiable, Hashable, Sendable {
    enum Kind: Hashable, Sendable {
        case page(source: String, index: Int)
        case blank(width: Double, height: Double, paper: PagesPaperPattern?)
        case image(url: URL)
    }

    let key: String
    var kind: Kind
    /// Extra clockwise turn on top of the page's own rotation: 0, 90, 180, 270.
    var rotate: Int = 0

    var id: String { key }

    static func newKey() -> String { String(UUID().uuidString.prefix(8)).lowercased() }

    func copy(key: String = OrganizerTile.newKey()) -> OrganizerTile { OrganizerTile(key: key, kind: kind, rotate: rotate) }

    var sourceID: String? { if case .page(let source, _) = kind { source } else { nil } }
}

/// A PDF the organizer or a tool reads pages from.
struct PagesSource: Hashable, Sendable {
    var id: String
    var url: URL
    var password: String?
}

enum OrganizerOps {
    static let mainSourceID = "main"

    static func rotated(_ current: Int, by delta: Int) -> Int { ((current + delta) % 360 + 360) % 360 }

    static func initialTiles(pageCount: Int) -> [OrganizerTile] {
        (0..<pageCount).map { OrganizerTile(key: "p\($0 + 1)", kind: .page(source: mainSourceID, index: $0 + 1)) }
    }

    static func isDirty(_ tiles: [OrganizerTile], initial: [OrganizerTile]) -> Bool {
        guard tiles.count == initial.count else { return true }
        for (tile, original) in zip(tiles, initial) {
            guard case .page(let s1, let i1) = tile.kind, case .page(let s2, let i2) = original.kind else { return true }
            if s1 != s2 || i1 != i2 || tile.rotate != 0 { return true }
        }
        return false
    }

    /// Moves `keys` so they land before the tile currently at `dropIndex`.
    static func move(_ tiles: [OrganizerTile], keys: Set<String>, to dropIndex: Int) -> [OrganizerTile] {
        let moving = tiles.filter { keys.contains($0.key) }
        guard !moving.isEmpty else { return tiles }
        let at = max(0, min(dropIndex, tiles.count))
        let before = tiles[..<at].filter { !keys.contains($0.key) }
        let after = tiles[at...].filter { !keys.contains($0.key) }
        return before + moving + after
    }

    /// Shifts every selected tile `delta` steps, keeping blocks together (desktop `nudgeTiles`).
    static func nudge(_ tiles: [OrganizerTile], keys: Set<String>, delta: Int) -> [OrganizerTile] {
        guard delta != 0, !keys.isEmpty else { return tiles }
        var next = tiles
        let forward = delta > 0
        for _ in 0..<abs(delta) {
            var moved = false
            var blocked = true
            for offset in 0..<next.count {
                let position = forward ? next.count - 1 - offset : offset
                if !keys.contains(next[position].key) { blocked = false; continue }
                let target = forward ? position + 1 : position - 1
                if blocked || target < 0 || target >= next.count { continue }
                next.swapAt(position, target)
                moved = true
            }
            if !moved { break }
        }
        return next
    }

    /// Moves the selection so it starts at 1-based `position` among the remaining tiles.
    static func move(_ tiles: [OrganizerTile], keys: Set<String>, toPosition position: Int) -> [OrganizerTile] {
        let moving = tiles.filter { keys.contains($0.key) }
        guard !moving.isEmpty else { return tiles }
        let kept = tiles.filter { !keys.contains($0.key) }
        let at = max(0, min(kept.count, position - 1))
        return Array(kept[..<at]) + moving + Array(kept[at...])
    }

    static func insert(_ tiles: [OrganizerTile], at position: Int, _ incoming: [OrganizerTile]) -> [OrganizerTile] {
        let at = max(0, min(position, tiles.count))
        return Array(tiles[..<at]) + incoming + Array(tiles[at...])
    }

    enum InsertPlace: String, CaseIterable, Sendable { case after, before, end }

    static func insertionPoint(_ tiles: [OrganizerTile], selected: Set<String>, place: InsertPlace = .after) -> Int {
        switch place {
        case .end: return tiles.count
        case .before: return tiles.firstIndex { selected.contains($0.key) } ?? tiles.count
        case .after: return (tiles.lastIndex { selected.contains($0.key) }).map { $0 + 1 } ?? tiles.count
        }
    }

    static func reverseWithin(_ tiles: [OrganizerTile], keys: Set<String>) -> [OrganizerTile] {
        let chosen = tiles.filter { keys.contains($0.key) }
        guard chosen.count >= 2 else { return tiles }
        var reversed = Array(chosen.reversed()).makeIterator()
        return tiles.map { keys.contains($0.key) ? reversed.next()! : $0 }
    }

    enum CopyLayout: String, CaseIterable, Sendable { case each, block }

    static func withCopies(_ tiles: [OrganizerTile], keys: Set<String>, copies: Int, layout: CopyLayout) -> (tiles: [OrganizerTile], copies: [String]) {
        let chosen = tiles.filter { keys.contains($0.key) }
        guard !chosen.isEmpty, copies >= 1 else { return (tiles, []) }
        var made: [String] = []
        func copy(_ tile: OrganizerTile) -> OrganizerTile {
            let c = tile.copy()
            made.append(c.key)
            return c
        }
        if layout == .each {
            let next = tiles.flatMap { tile in keys.contains(tile.key) ? [tile] + (0..<copies).map { _ in copy(tile) } : [tile] }
            return (next, made)
        }
        let block = (0..<copies).flatMap { _ in chosen.map(copy) }
        return (insert(tiles, at: insertionPoint(tiles, selected: keys), block), made)
    }

    /// Odd = 1st, 3rd… position; even = 2nd, 4th…
    static func atParity(_ tiles: [OrganizerTile], odd: Bool) -> [String] {
        tiles.enumerated().filter { $0.offset % 2 == (odd ? 0 : 1) }.map(\.element.key)
    }

    static func replace(_ tiles: [OrganizerTile], selected: Set<String>, with incoming: [OrganizerTile]) -> [OrganizerTile] {
        guard let first = tiles.firstIndex(where: { selected.contains($0.key) }) else { return insert(tiles, at: tiles.count, incoming) }
        let kept = tiles.filter { !selected.contains($0.key) }
        let before = tiles[..<first].filter { !selected.contains($0.key) }.count
        return insert(kept, at: before, incoming)
    }

    /// 0-based positions where a new part starts (cut marks are stored on the tile *before* the cut).
    static func cutStarts(_ tiles: [OrganizerTile], cuts: Set<String>) -> [Int] {
        tiles.enumerated().compactMap { cuts.contains($0.element.key) && $0.offset < tiles.count - 1 ? $0.offset + 1 : nil }
    }

    static func toggleCuts(_ cuts: Set<String>, keys: [String]) -> Set<String> {
        var next = cuts
        let removing = !keys.isEmpty && keys.allSatisfy { next.contains($0) }
        for key in keys { if removing { next.remove(key) } else { next.insert(key) } }
        return next
    }

    /// Reorders for manual duplex printing: fronts then (reversed) backs, optionally padded to even.
    static func duplexOrder(_ tiles: [OrganizerTile], padding: CGSize?, reverseBacks: Bool) -> (tiles: [OrganizerTile], cutAfter: String?) {
        var padded = tiles
        if tiles.count % 2 == 1, let padding {
            padded.append(OrganizerTile(key: OrganizerTile.newKey(), kind: .blank(width: padding.width, height: padding.height, paper: nil)))
        }
        let fronts = padded.enumerated().filter { $0.offset % 2 == 0 }.map(\.element)
        var backs = padded.enumerated().filter { $0.offset % 2 == 1 }.map(\.element)
        if reverseBacks { backs.reverse() }
        return (fronts + backs, backs.isEmpty ? nil : fronts.last?.key)
    }

    /// Keeps cut marks and labels attached to sensible neighbours when their tiles disappear.
    static func carryMarks(before: [OrganizerTile], after: [OrganizerTile], cuts: Set<String>, labels: [String: PagesTileLabel]) -> (Set<String>, [String: PagesTileLabel]) {
        let alive = Dictionary(after.enumerated().map { ($0.element.key, $0.offset) }, uniquingKeysWith: { a, _ in a })
        let deadCuts = cuts.filter { alive[$0] == nil }
        let deadLabels = labels.keys.filter { alive[$0] == nil }
        if deadCuts.isEmpty && deadLabels.isEmpty { return (cuts, labels) }
        let oldPosition = Dictionary(before.enumerated().map { ($0.element.key, $0.offset) }, uniquingKeysWith: { a, _ in a })
        func aliveNeighbour(_ key: String, step: Int) -> Int? {
            guard let start = oldPosition[key] else { return nil }
            var position = start + step
            while position >= 0 && position < before.count {
                if let found = alive[before[position].key] { return found }
                position += step
            }
            return nil
        }
        var nextCuts = cuts.filter { alive[$0] != nil }
        for key in deadCuts {
            if let next = aliveNeighbour(key, step: 1), next > 0 { nextCuts.insert(after[next - 1].key) }
        }
        var nextLabels = labels.filter { alive[$0.key] != nil }
        for key in deadLabels {
            let previous = aliveNeighbour(key, step: -1)
            let targetIndex = previous.map { $0 + 1 } ?? 0
            if oldPosition[key] != nil, targetIndex < after.count, nextLabels[after[targetIndex].key] == nil {
                nextLabels[after[targetIndex].key] = labels[key]
            }
        }
        return (nextCuts, nextLabels)
    }

    // MARK: Labels

    static func labelRules(_ tiles: [OrganizerTile], labels: [String: PagesTileLabel]) -> [PageLabelRule] {
        tiles.enumerated().compactMap { position, tile in
            labels[tile.key].map { PageLabelRule(start: position, style: $0.style, prefix: $0.prefix, firstNumber: $0.firstNumber) }
        }
    }

    /// Label rules for a subset (extract), continuing the numbering each kept page had.
    static func subsetLabelRules(_ tiles: [OrganizerTile], labels: [String: PagesTileLabel], keep: Set<String>) -> [PageLabelRule] {
        var rules: [PageLabelRule] = []
        var governing: (label: PagesTileLabel, start: Int)?
        var previous: (label: PagesTileLabel, value: Int)?
        var kept = 0
        for (position, tile) in tiles.enumerated() {
            if let own = labels[tile.key] { governing = (own, position) }
            guard keep.contains(tile.key) else { continue }
            if let governing {
                let value = governing.label.firstNumber + position - governing.start
                if previous == nil || previous!.label != governing.label || previous!.value + 1 != value {
                    rules.append(PageLabelRule(start: kept, style: governing.label.style, prefix: governing.label.prefix, firstNumber: value))
                }
                previous = (governing.label, value)
            }
            kept += 1
        }
        return rules
    }

    /// What each tile shows as its page label, or nil when no tile has a label.
    static func labelTexts(_ tiles: [OrganizerTile], labels: [String: PagesTileLabel]) -> [String]? {
        guard tiles.contains(where: { labels[$0.key] != nil }) else { return nil }
        var current: (label: PagesTileLabel, start: Int)?
        return tiles.enumerated().map { position, tile in
            if let label = labels[tile.key] { current = (label, position) }
            return current.map { $0.label.text(at: position - $0.start) } ?? String(position + 1)
        }
    }

    static func positionsToKeys(_ tiles: [OrganizerTile], positions: [Int]) -> [String] {
        var seen = Set<Int>()
        return positions.compactMap { position in
            guard seen.insert(position).inserted, position >= 1, position <= tiles.count else { return nil }
            return tiles[position - 1].key
        }
    }

    // MARK: Shapes

    enum PaperName: String, CaseIterable, Sendable { case a4, letter, a3, a5, legal }

    private static let papers: [(PaperName, CGSize)] = [(.a4, CGSize(width: 595.28, height: 841.89)), (.letter, CGSize(width: 612, height: 792)),
                                                        (.a3, CGSize(width: 841.89, height: 1190.55)), (.a5, CGSize(width: 419.53, height: 595.28)),
                                                        (.legal, CGSize(width: 612, height: 1008))]

    static func upright(_ size: CGSize) -> CGSize { CGSize(width: min(size.width, size.height), height: max(size.width, size.height)) }

    static func isClose(_ a: CGSize, _ b: CGSize, tolerance: CGFloat = 2) -> Bool {
        abs(a.width - b.width) <= tolerance && abs(a.height - b.height) <= tolerance
    }

    static func paperName(of size: CGSize) -> PaperName? {
        let shape = upright(size)
        return papers.first { isClose(shape, $0.1) }?.0
    }

    struct SizeGroup: Identifiable, Sendable {
        var id: String
        var size: CGSize
        var paper: PaperName?
        var keys: [String]
    }

    /// Groups tiles by (upright) page size, largest group first. `sizeOf` returns the displayed size.
    static func sizeGroups(_ tiles: [OrganizerTile], sizeOf: (OrganizerTile) -> CGSize?) -> [SizeGroup] {
        var groups: [SizeGroup] = []
        for tile in tiles {
            guard let size = sizeOf(tile) else { continue }
            let shape = upright(size)
            if let index = groups.firstIndex(where: { isClose($0.size, shape) }) {
                groups[index].keys.append(tile.key)
            } else {
                groups.append(SizeGroup(id: "\(Int(shape.width.rounded()))x\(Int(shape.height.rounded()))", size: shape, paper: paperName(of: shape), keys: [tile.key]))
            }
        }
        return groups.sorted { $0.keys.count > $1.keys.count }
    }

    /// Image pages are sized to fit A4 (either orientation) without upscaling, like the desktop.
    static func imagePageSize(pixels: CGSize) -> CGSize {
        let limit = pixels.width > pixels.height ? CGSize(width: 842, height: 595) : CGSize(width: 595, height: 842)
        let scale = min(limit.width / max(pixels.width, 1), limit.height / max(pixels.height, 1), 1)
        return CGSize(width: pixels.width * scale, height: pixels.height * scale)
    }
}
