import Observation
import PDFKit
import SwiftUI

/// A PDF whose pages the organizer can show and assemble from (the open document or an inserted file).
struct OrganizerSource {
    let id: String
    /// Readable by engines (the open document's file, or an app-owned copy of an inserted file).
    let url: URL
    var password: String?
    let fileName: String
    let document: PDFDocument
}

/// Arrangement state of the page organizer for one open document, with undo/redo
/// (`organizerStore.ts`). Kept per document so switching tabs does not lose work.
@MainActor
@Observable
final class OrganizerModel {
    struct Step {
        var tiles: [OrganizerTile]
        var cuts: Set<String>
        var labels: [String: PagesTileLabel]
    }

    static let historyLimit = 100

    let documentID: OpenDocument.ID
    /// Identity of the `PDFDocument` the tiles were built from; a reload (apply in place, external change) resets.
    private(set) var pdfIdentity: ObjectIdentifier
    private(set) var sources: [String: OrganizerSource] = [:]
    private(set) var tiles: [OrganizerTile] = []
    private(set) var initialTiles: [OrganizerTile] = []
    private(set) var cuts: Set<String> = []
    private(set) var labels: [String: PagesTileLabel] = [:]
    private(set) var past: [Step] = []
    private(set) var future: [Step] = []
    var selected: Set<String> = []
    var anchor: String?

    init(document: OpenDocument) {
        documentID = document.id
        pdfIdentity = ObjectIdentifier(document.pdf)
        reset(to: document)
    }

    /// Starts over from the document's current pages.
    func reset(to document: OpenDocument) {
        pdfIdentity = ObjectIdentifier(document.pdf)
        sources = [OrganizerOps.mainSourceID: OrganizerSource(id: OrganizerOps.mainSourceID, url: document.url, password: document.password,
                                                               fileName: document.fileName, document: document.pdf)]
        tiles = OrganizerOps.initialTiles(pageCount: document.pageCount)
        initialTiles = tiles
        cuts = []
        labels = [:]
        past = []
        future = []
        selected = []
        anchor = nil
    }

    func isCurrent(for document: OpenDocument) -> Bool {
        pdfIdentity == ObjectIdentifier(document.pdf) && initialTiles.count == document.pageCount
    }

    // MARK: Derived

    var canUndo: Bool { !past.isEmpty }
    var canRedo: Bool { !future.isEmpty }
    var labelTexts: [String]? { OrganizerOps.labelTexts(tiles, labels: labels) }
    var isDirty: Bool { OrganizerOps.isDirty(tiles, initial: initialTiles) || labelTexts != nil }
    var partStarts: [Int] { OrganizerOps.cutStarts(tiles, cuts: cuts) }
    var hasUnsavedWork: Bool { isDirty || !partStarts.isEmpty }
    var selectedTiles: [OrganizerTile] { tiles.filter { selected.contains($0.key) } }

    func position(of key: String) -> Int? { tiles.firstIndex { $0.key == key } }

    func source(_ id: String) -> OrganizerSource? { sources[id] }

    /// The page a tile shows, for thumbnails.
    func page(for tile: OrganizerTile) -> PDFPage? {
        guard case .page(let source, let index) = tile.kind else { return nil }
        return sources[source]?.document.page(at: index - 1)
    }

    /// Displayed size (rotation applied) of a tile in points.
    func displaySize(of tile: OrganizerTile) -> CGSize? {
        var size: CGSize
        switch tile.kind {
        case .page:
            guard let page = page(for: tile) else { return nil }
            let box = page.bounds(for: .cropBox).size
            size = page.rotation % 180 == 0 ? box : CGSize(width: box.height, height: box.width)
        case .blank(let width, let height, _):
            size = CGSize(width: width, height: height)
        case .image(let url):
            guard let pixels = PagesImageSize.pixels(url) else { return nil }
            size = OrganizerOps.imagePageSize(pixels: pixels)
        }
        if tile.rotate % 180 != 0 { size = CGSize(width: size.height, height: size.width) }
        return size
    }

    // MARK: Sources

    func addSource(url: URL, password: String?, document: PDFDocument) -> String {
        if let existing = sources.values.first(where: { $0.url.standardizedFileURL == url.standardizedFileURL }) { return existing.id }
        let id = "s\(UUID().uuidString.prefix(6))"
        sources[id] = OrganizerSource(id: id, url: url, password: password, fileName: url.lastPathComponent, document: document)
        return id
    }

    /// Sources in assembly order (the open document first).
    func pageSources(mainURL: URL? = nil) -> [PagesSource] {
        var list: [PagesSource] = []
        if let main = sources[OrganizerOps.mainSourceID] {
            list.append(PagesSource(id: main.id, url: mainURL ?? main.url, password: main.password))
        }
        for source in sources.values where source.id != OrganizerOps.mainSourceID {
            list.append(PagesSource(id: source.id, url: source.url, password: source.password))
        }
        return list
    }

    // MARK: History

    func commit(_ next: [OrganizerTile], cuts nextCuts: Set<String>? = nil, labels nextLabels: [String: PagesTileLabel]? = nil) {
        past.append(Step(tiles: tiles, cuts: cuts, labels: labels))
        if past.count > Self.historyLimit { past.removeFirst(past.count - Self.historyLimit) }
        future = []
        let carried = OrganizerOps.carryMarks(before: tiles, after: next, cuts: nextCuts ?? cuts, labels: nextLabels ?? labels)
        tiles = next
        cuts = carried.0
        labels = carried.1
        pruneSelection()
    }

    func setMarks(cuts nextCuts: Set<String>? = nil, labels nextLabels: [String: PagesTileLabel]? = nil) {
        let changed = (nextCuts.map { $0 != cuts } ?? false) || (nextLabels.map { $0 != labels } ?? false)
        if changed { commit(tiles, cuts: nextCuts, labels: nextLabels) }
    }

    func undo() {
        guard let previous = past.popLast() else { return }
        future.insert(Step(tiles: tiles, cuts: cuts, labels: labels), at: 0)
        apply(previous)
    }

    func redo() {
        guard !future.isEmpty else { return }
        let next = future.removeFirst()
        past.append(Step(tiles: tiles, cuts: cuts, labels: labels))
        apply(next)
    }

    func resetArrangement() {
        commit(initialTiles, cuts: [], labels: [:])
    }

    private func apply(_ step: Step) {
        tiles = step.tiles
        cuts = step.cuts
        labels = step.labels
        pruneSelection()
    }

    private func pruneSelection() {
        let alive = Set(tiles.map(\.key))
        selected = selected.filter(alive.contains)
        if let anchor, !alive.contains(anchor) { self.anchor = nil }
    }

    // MARK: Selection

    func select(_ keys: [String], anchor newAnchor: String?? = nil) {
        selected = Set(keys)
        if let newAnchor { anchor = newAnchor } else if let first = keys.first { anchor = first }
    }

    func selectAll() { select(tiles.map(\.key), anchor: .some(anchor ?? tiles.first?.key)) }
    func selectNone() { selected = [] }

    func toggle(_ key: String) {
        if selected.contains(key) { selected.remove(key) } else { selected.insert(key) }
        anchor = key
    }

    /// Selects from the anchor to `key` (Shift on the desktop).
    func extend(to key: String) {
        guard let anchor, let from = position(of: anchor), let to = position(of: key) else { toggle(key); return }
        let range = min(from, to)...max(from, to)
        selected.formUnion(tiles[range].map(\.key))
    }

    func invertSelection() {
        let inverted = tiles.filter { !selected.contains($0.key) }.map(\.key)
        select(inverted, anchor: .some(inverted.first))
    }

    func selectParity(odd: Bool) { select(OrganizerOps.atParity(tiles, odd: odd)) }

    /// Moves the focus (anchor) by `delta`; `extend` grows the selection like Shift+arrow.
    func moveFocus(by delta: Int, extend: Bool) {
        guard !tiles.isEmpty else { return }
        let current = anchor.flatMap(position(of:)) ?? -1
        let next = max(0, min(tiles.count - 1, current < 0 ? 0 : current + delta))
        let key = tiles[next].key
        if extend, let anchor, let from = position(of: anchor) {
            selected.formUnion(tiles[min(from, next)...max(from, next)].map(\.key))
            self.anchor = key
        } else {
            select([key], anchor: .some(key))
        }
    }

    /// The tile a single-page command (labels…) applies to.
    var focusKey: String? {
        if let anchor, selected.contains(anchor), position(of: anchor) != nil { return anchor }
        return tiles.first { selected.contains($0.key) }?.key ?? anchor.flatMap { position(of: $0) != nil ? $0 : nil } ?? tiles.first?.key
    }

    // MARK: Edits (useOrganizerEdits)

    func rotateSelected(_ delta: Int) {
        guard !selected.isEmpty else { return }
        commit(tiles.map { selected.contains($0.key) ? OrganizerTile(key: $0.key, kind: $0.kind, rotate: OrganizerOps.rotated($0.rotate, by: delta)) : $0 })
    }

    func rotate(_ key: String, by delta: Int) {
        commit(tiles.map { $0.key == key ? OrganizerTile(key: $0.key, kind: $0.kind, rotate: OrganizerOps.rotated($0.rotate, by: delta)) : $0 })
    }

    func deleteSelected() {
        guard !selected.isEmpty, selected.count < tiles.count else { return }
        let first = tiles.firstIndex { selected.contains($0.key) } ?? 0
        commit(tiles.filter { !selected.contains($0.key) })
        let key = tiles[min(first, tiles.count - 1)].key
        select([key], anchor: .some(key))
    }

    func delete(_ key: String) {
        guard tiles.count > 1 else { return }
        commit(tiles.filter { $0.key != key })
    }

    func deleteRelative(before: Bool) {
        guard selected.count == 1, let key = selected.first, let position = position(of: key) else { return }
        commit(before ? Array(tiles[position...]) : Array(tiles[...position]))
    }

    func reverseAll() { commit(tiles.reversed()) }

    func duplicateSelected(copies: Int = 1, layout: OrganizerOps.CopyLayout = .each) {
        guard !selected.isEmpty else { return }
        let outcome = OrganizerOps.withCopies(tiles, keys: selected, copies: copies, layout: layout)
        guard !outcome.copies.isEmpty else { return }
        commit(outcome.tiles)
        select(outcome.copies, anchor: .some(outcome.copies.first))
    }

    func reverseSelected() {
        let next = OrganizerOps.reverseWithin(tiles, keys: selected)
        if next != tiles { commit(next) }
    }

    func insert(_ incoming: [OrganizerTile], place: OrganizerOps.InsertPlace) {
        guard !incoming.isEmpty else { return }
        let at = OrganizerOps.insertionPoint(tiles, selected: selected, place: place)
        commit(OrganizerOps.insert(tiles, at: at, incoming))
        select(incoming.map(\.key), anchor: .some(incoming.first?.key))
    }

    func insert(_ incoming: [OrganizerTile], at position: Int) {
        guard !incoming.isEmpty else { return }
        commit(OrganizerOps.insert(tiles, at: position, incoming))
        select(incoming.map(\.key), anchor: .some(incoming.first?.key))
    }

    func replaceSelection(with incoming: [OrganizerTile]) {
        commit(OrganizerOps.replace(tiles, selected: selected, with: incoming))
        select(incoming.map(\.key), anchor: .some(incoming.first?.key))
    }

    /// Drag & drop: moves `keys` to before the tile now at `dropIndex`.
    func move(_ keys: Set<String>, to dropIndex: Int) {
        let next = OrganizerOps.move(tiles, keys: keys, to: dropIndex)
        if next != tiles { commit(next) }
    }

    func nudgeSelected(_ delta: Int) {
        let next = OrganizerOps.nudge(tiles, keys: selected, delta: delta)
        if next != tiles { commit(next) }
    }

    func moveSelected(toPosition position: Int) {
        let next = OrganizerOps.move(tiles, keys: selected, toPosition: position)
        if next != tiles { commit(next) }
    }

    func toggleCutsAtSelection() {
        let last = tiles.last?.key
        setMarks(cuts: OrganizerOps.toggleCuts(cuts, keys: tiles.filter { selected.contains($0.key) && $0.key != last }.map(\.key)))
    }

    func toggleCut(at key: String) { setMarks(cuts: OrganizerOps.toggleCuts(cuts, keys: [key])) }

    func clearCuts() { setMarks(cuts: []) }

    func addCuts(_ keys: [String]) { setMarks(cuts: cuts.union(keys)) }

    func setLabel(_ label: PagesTileLabel?, for key: String) {
        var next = labels
        next[key] = label
        setMarks(labels: next)
    }

    func clearLabels() { setMarks(labels: [:]) }

    func applyDuplex(pad: Bool, reverseBacks: Bool, twoFiles: Bool) {
        let size = sources[OrganizerOps.mainSourceID]?.document.page(at: 0)?.bounds(for: .mediaBox).size ?? CGSize(width: 595, height: 842)
        let outcome = OrganizerOps.duplexOrder(tiles, padding: pad ? size : nil, reverseBacks: reverseBacks)
        commit(outcome.tiles, cuts: twoFiles ? Set(outcome.cutAfter.map { [$0] } ?? []) : [])
    }

    /// Applies detected turns (per source, 1-based page → degrees) to tiles; returns how many changed.
    func applyDetectedRotation(_ turns: [String: [Int: Int]], upright: [String: Set<Int>]) -> Int {
        var changed = 0
        let next = tiles.map { tile -> OrganizerTile in
            guard case .page(let source, let index) = tile.kind else { return tile }
            let target: Int
            if let turn = turns[source]?[index] { target = turn } else if upright[source]?.contains(index) == true { target = 0 } else { return tile }
            if tile.rotate == target { return tile }
            changed += 1
            return OrganizerTile(key: tile.key, kind: tile.kind, rotate: target)
        }
        if changed > 0 { commit(next) }
        return changed
    }

    /// Tiles whose page is in `pages` (per source, 1-based); blanks count as blank when asked.
    func tiles(matching pages: [String: Set<Int>], includeBlankTiles: Bool) -> [String] {
        tiles.compactMap { tile in
            switch tile.kind {
            case .page(let source, let index): return pages[source]?.contains(index) == true ? tile.key : nil
            case .blank(_, _, let paper): return includeBlankTiles && paper == nil ? tile.key : nil
            case .image: return nil
            }
        }
    }
}

/// Organizer sessions survive navigation and tab switches (the desktop stashes them per document).
@MainActor
enum OrganizerSessions {
    private static var models: [OpenDocument.ID: OrganizerModel] = [:]

    static func model(for document: OpenDocument) -> OrganizerModel {
        if let existing = models[document.id] {
            if !existing.isCurrent(for: document) { existing.reset(to: document) }
            return existing
        }
        let model = OrganizerModel(document: document)
        models[document.id] = model
        return model
    }

    static func existing(_ id: OpenDocument.ID) -> OrganizerModel? { models[id] }

    static func prune(keeping ids: Set<OpenDocument.ID>) {
        models = models.filter { ids.contains($0.key) }
    }
}

/// Pages copied with Copy / Cut, pasteable into any document's organizer.
@MainActor
enum PagesClipboard {
    struct Clipped {
        var kind: OrganizerTile.Kind
        var rotate: Int
        /// For page tiles: where the page comes from.
        var source: (url: URL, password: String?, document: PDFDocument)?
    }

    static var items: [Clipped] = []
    static var isEmpty: Bool { items.isEmpty }
}

enum PagesImageSize {
    /// Pixel size with EXIF orientation applied.
    static func pixels(_ url: URL) -> CGSize? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int else { return nil }
        let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
        return orientation >= 5 ? CGSize(width: height, height: width) : CGSize(width: width, height: height)
    }
}
