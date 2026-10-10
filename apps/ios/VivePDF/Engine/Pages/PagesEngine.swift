import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers

/// Page operations: organizer assembly, page tools, merge and split (`pages.py`, `merge_split.py`).
enum PagesEngine {
    // MARK: Organizer

    /// Writes the arranged tiles to `output` (`pages.assemble`). `labels` nil = carry the sources' labels.
    @discardableResult
    static func assemble(sources: [PagesSource], tiles: [OrganizerTile], labels: [PageLabelRule]?, output: URL,
                         password: String? = nil, progress: ProgressHandler? = nil) throws -> Int {
        guard !tiles.isEmpty else { throw EngineError.invalid("no pages") }
        let used = Set(tiles.compactMap(\.sourceID))
        let relevant = sources.filter { used.contains($0.id) || $0.id == sources.first?.id }
        let access = PagesAssembler.ScopedAccess(relevant.map(\.url) + tiles.compactMap { if case .image(let url) = $0.kind { url } else { nil } })
        defer { withExtendedLifetime(access) {} }
        var documents: [String: PDFDocument] = [:]
        for source in relevant { documents[source.id] = try PagesAssembler.open(source.url, password: source.password) }
        let assembly = try PagesAssembler.assemble(tiles, sources: documents, progress: progress)
        PagesAssembler.carryOutlines(assembly, sourceOrder: relevant.map(\.id), sources: documents)
        let rules: [PageLabelRule]?
        if let labels {
            let parts = PageLabelsIO.parts(rules: labels, total: tiles.count)
            rules = PageLabelsIO.isPlain(parts) ? nil : PageLabelsIO.rules(parts)
        } else {
            var sourceParts: [String: [PageLabelsIO.Part]] = [:]
            for source in relevant { sourceParts[source.id] = PageLabelsIO.parts(of: source.url, password: source.password) }
            rules = PagesAssembler.carriedLabels(assembly, sourceParts: sourceParts)
        }
        progress?(0.9, nil)
        let main = relevant.first.flatMap { documents[$0.id] }
        return try PagesAssembler.write(assembly.document, to: output, labels: rules, password: password,
                                      attributes: main.map(PagesAssembler.carriedAttributes))
    }

    /// Writes the arrangement as several files, cut at `cuts` (0-based start positions; `pages.assemble_parts`).
    static func assembleParts(sources: [PagesSource], tiles: [OrganizerTile], cuts: [Int], labels: [PageLabelRule]?, folder: URL,
                              baseName: String, password: String? = nil, progress: ProgressHandler? = nil) throws -> [URL] {
        let bounds = partBounds(total: tiles.count, cuts: cuts)
        let width = String(bounds.count).count
        var outputs: [URL] = []
        let allParts = labels.map { PageLabelsIO.parts(rules: $0, total: tiles.count) }
        do {
            for (position, bound) in bounds.enumerated() {
                let share = Double(position) / Double(bounds.count)
                progress?(share, nil)
                let first = bound.lowerBound + 1, last = bound.upperBound
                let name = "\(PagesSpecs.sanitizeFileName(baseName))-\(String(format: "%0\(width)d", position + 1))-p\(first == last ? "\(first)" : "\(first)-\(last)")"
                let url = Workspace.unique(name: name, ext: "pdf", in: folder)
                let partLabels = allParts.map { parts -> [PageLabelRule] in
                    let firstRule = labels?.map(\.start).min() ?? tiles.count
                    return PageLabelsIO.rules(bound.map { index in index < firstRule ? PageLabelsIO.Part.plain(index - bound.lowerBound) : parts[index] })
                }
                try assemble(sources: sources, tiles: Array(tiles[bound]), labels: partLabels, output: url, password: password)
                outputs.append(url)
            }
        } catch {
            outputs.forEach { try? FileManager.default.removeItem(at: $0) }
            throw error
        }
        return outputs
    }

    static func partBounds(total: Int, cuts: [Int]) -> [Range<Int>] {
        let starts = [0] + Array(Set(cuts.filter { $0 > 0 && $0 < total })).sorted()
        return starts.enumerated().map { index, start in start..<(index + 1 < starts.count ? starts[index + 1] : total) }
    }

    // MARK: Page tools

    /// Rotates the chosen pages (0-based) by `degrees` clockwise.
    @discardableResult
    static func rotate(_ source: PagesSource, pages: [Int], degrees: Int, output: URL, progress: ProgressHandler? = nil) throws -> Int {
        let access = PagesAssembler.ScopedAccess([source.url])
        defer { withExtendedLifetime(access) {} }
        let document = try PagesAssembler.open(source.url, password: source.password)
        for index in Set(pages) { document.page(at: index).map { $0.rotation = OrganizerOps.rotated($0.rotation, by: degrees) } }
        progress?(0.8, nil)
        // PDFKit does not always keep /PageLabels when it rewrites a file.
        let labels = PageLabelsIO.parts(of: source.url, password: source.password).map(PageLabelsIO.rules)
        return try PagesAssembler.write(document, to: output, labels: labels, password: protectedPassword(document, source))
    }

    /// Keeps only `indices` (0-based, in that order) of the source, rewriting bookmarks and labels.
    @discardableResult
    static func select(_ source: PagesSource, indices: [Int], output: URL, progress: ProgressHandler? = nil) throws -> Int {
        guard !indices.isEmpty else { throw EngineError(.INVALID_PARAMS, reason: "noPagesSelected") }
        let access = PagesAssembler.ScopedAccess([source.url])
        defer { withExtendedLifetime(access) {} }
        let document = try PagesAssembler.open(source.url, password: source.password)
        let count = document.pageCount
        guard indices.allSatisfy({ $0 >= 0 && $0 < count }) else { throw EngineError(.INVALID_PARAMS, reason: "pageOutOfRange") }
        let labelParts = PageLabelsIO.parts(of: source.url, password: source.password)
        let password = protectedPassword(document, source)
        if indices == Array(0..<count) {
            return try PagesAssembler.write(document, to: output, labels: labelParts.map(PageLabelsIO.rules), password: password)
        }
        let hadOutline = document.outlineRoot != nil
        let outline = PagesAssembler.remappedOutline(document, indices: indices)
        let pages = (0..<count).compactMap { document.page(at: $0) }
        let wanted = indices.map { pages[$0] }
        if Set(indices).count == indices.count {
            // Remove the rest in place (keeps forms and document-level structure), then reorder.
            let kept = Set(indices)
            for index in stride(from: count - 1, through: 0, by: -1) where !kept.contains(index) { document.removePage(at: index) }
            for (target, page) in wanted.enumerated() {
                let current = document.index(for: page)
                if current != target { document.exchangePage(at: current, withPageAt: target) }
            }
        } else {
            // Repeated pages need copies.
            for index in stride(from: count - 1, through: 0, by: -1) { document.removePage(at: index) }
            for page in wanted { document.insert((page.copy() as? PDFPage) ?? page, at: document.pageCount) }
        }
        progress?(0.6, nil)
        dropDanglingLinks(document)
        if hadOutline { PagesAssembler.setOutline(document, entries: outline) }
        let labels = labelParts.map { parts in PageLabelsIO.rules(indices.map { parts[$0] }) }
        return try PagesAssembler.write(document, to: output, labels: labels, password: password)
    }

    static func delete(_ source: PagesSource, pages: Set<Int>, pageCount: Int, output: URL, progress: ProgressHandler? = nil) throws -> Int {
        let keep = (0..<pageCount).filter { !pages.contains($0) }
        guard !keep.isEmpty else { throw EngineError(.INVALID_PARAMS, reason: "allPagesDeleted") }
        return try select(source, indices: keep, output: output, progress: progress)
    }

    /// Removes link annotations whose target page is no longer in the document.
    static func dropDanglingLinks(_ document: PDFDocument) {
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index) else { continue }
            for annotation in page.annotations where annotation.type == "Link" {
                let destination = annotation.destination ?? (annotation.action as? PDFActionGoTo)?.destination
                if let target = destination?.page, document.index(for: target) == NSNotFound { page.removeAnnotation(annotation) }
            }
        }
    }

    /// The password to re-apply so outputs keep the source's protection (when we know it).
    static func protectedPassword(_ document: PDFDocument, _ source: PagesSource) -> String? {
        document.isEncrypted ? source.password : nil
    }

    // MARK: Merge

    enum BookmarkStyle: String, CaseIterable, Sendable { case nested, files, originals, none }

    struct MergeInput: Sendable {
        var url: URL
        var password: String?
        var ranges: String = ""
        var reverse = false
    }

    struct MergeOptions: Sendable {
        var bookmarks: BookmarkStyle = .nested
        var contentsPage = false
        var contentsTitle = "Contents"
        var interleave = false
        var padOdd = false
        var keepProtection = true
    }

    struct MergeResult: Sendable {
        var pageCount: Int
        var protectedFrom: String?
    }

    static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "heic", "heif"]

    static func isImage(_ url: URL) -> Bool { imageExtensions.contains(url.pathExtension.lowercased()) }

    /// One page from each file in turn, or one file after another with optional blank padding.
    static func mergePlacements(_ selections: [[Int]], interleave: Bool, padOdd: Bool) -> [(file: Int, index: Int?)] {
        var placements: [(file: Int, index: Int?)] = []
        if interleave {
            let longest = selections.map(\.count).max() ?? 0
            for step in 0..<longest {
                for (file, indices) in selections.enumerated() where step < indices.count { placements.append((file, indices[step])) }
            }
            return placements
        }
        for (file, indices) in selections.enumerated() {
            placements += indices.map { (file, $0) }
            if padOdd, indices.count % 2 == 1, file < selections.count - 1 { placements.append((file, nil)) }
        }
        return placements
    }

    static func mergedPageTotal(_ counts: [Int], interleave: Bool, padOdd: Bool) -> Int {
        let pages = counts.reduce(0, +)
        guard !interleave, padOdd else { return pages }
        return pages + counts.dropLast().filter { $0 % 2 == 1 }.count
    }

    static func merge(_ inputs: [MergeInput], options: MergeOptions, output: URL, progress: ProgressHandler? = nil) throws -> MergeResult {
        guard !inputs.isEmpty else { throw EngineError.invalid("no inputs") }
        let access = PagesAssembler.ScopedAccess(inputs.map(\.url))
        defer { withExtendedLifetime(access) {} }
        var documents: [String: PDFDocument] = [:]
        var selections: [[Int]] = []
        var labelParts: [String: [PageLabelsIO.Part]] = [:]
        for (position, input) in inputs.enumerated() {
            try Task.checkCancellation()
            progress?(0.4 * Double(position) / Double(inputs.count), nil)
            let id = "\(position)"
            let document: PDFDocument
            if isImage(input.url) {
                document = PDFDocument()
                document.insert(try PagesAssembler.imagePage(input.url), at: 0)
            } else {
                document = try PagesAssembler.open(input.url, password: input.password)
                labelParts[id] = PageLabelsIO.parts(of: input.url, password: input.password)
            }
            documents[id] = document
            guard let indices = PagesSpecs.pageIndices(input.ranges, pageCount: document.pageCount) else {
                throw EngineError(.INVALID_PARAMS, reason: "badRange", detail: input.url.lastPathComponent)
            }
            selections.append(input.reverse ? indices.reversed() : indices)
        }
        let placements = mergePlacements(selections, interleave: options.interleave, padOdd: options.padOdd)
        var tiles: [OrganizerTile] = []
        for (cursor, placement) in placements.enumerated() {
            if let index = placement.index {
                tiles.append(OrganizerTile(key: "\(cursor)", kind: .page(source: "\(placement.file)", index: index + 1)))
            } else {
                // Blank back side, the size of the page before it.
                let previous = placements[cursor - 1]
                let size = documents["\(previous.file)"]?.page(at: previous.index ?? 0)?.bounds(for: .mediaBox).size ?? CGSize(width: 595, height: 842)
                tiles.append(OrganizerTile(key: "\(cursor)", kind: .blank(width: size.width, height: size.height, paper: nil)))
            }
        }
        let assembly = try PagesAssembler.assemble(tiles, sources: documents, progress: progress, share: 0.4...0.85)
        let result = assembly.document
        func firstPosition(_ file: Int, _ index: Int) -> Int? { assembly.firstPosition["\(file)"]?[index] }
        let fileStarts: [Int?] = selections.enumerated().map { file, selection in selection.first.flatMap { firstPosition(file, $0) } }
        let names = inputs.map { $0.url.deletingPathExtension().lastPathComponent }

        // Bookmarks, as positions in the merged pages (before any contents pages).
        var outline: [(level: Int, title: String, position: Int, point: CGPoint, isOpen: Bool)] = []
        switch options.bookmarks {
        case .none: break
        case .files:
            for (file, start) in fileStarts.enumerated() { if let start { outline.append((1, names[file], start, CGPoint(x: 0, y: CGFloat.infinity), false)) } }
        case .nested, .originals:
            if options.interleave {
                for file in 0..<inputs.count {
                    guard let document = documents["\(file)"] else { continue }
                    for entry in PagesAssembler.outlineEntries(document) {
                        if let position = firstPosition(file, entry.page) { outline.append((entry.level, entry.title, position, entry.point, entry.isOpen)) }
                    }
                }
                outline = outline.enumerated().sorted { ($0.element.position, $0.offset) < ($1.element.position, $1.offset) }.map(\.element)
            } else {
                let multiple = options.bookmarks == .nested && inputs.count > 1
                for file in 0..<inputs.count {
                    guard let document = documents["\(file)"], let first = selections[file].first, let offset = firstPosition(file, first) else { continue }
                    if multiple { outline.append((1, names[file], offset, CGPoint(x: 0, y: CGFloat.infinity), true)) }
                    outline += PagesAssembler.remappedOutline(document, indices: selections[file], offset: offset, levelShift: multiple ? 1 : 0)
                }
            }
        }

        // Labels carried from the files (pages without labels count on).
        var labelRules: [PageLabelRule]?
        var lead = 0
        if options.contentsPage && !options.interleave, let firstPage = result.page(at: 0) {
            let size = firstPage.bounds(for: .mediaBox).size
            let entries = fileStarts.enumerated().compactMap { file, start in start.map { PagesAssembler.ContentsEntry(title: names[file], target: $0) } }
            lead = PagesAssembler.contentsPageCount(entries: entries.count, height: size.height)
            let carried = PagesAssembler.carriedLabels(assembly, sourceParts: labelParts)
            let labelled = carried != nil
            let partsAfter = carried.map { PageLabelsIO.parts(rules: $0, total: result.pageCount) }
            func number(_ target: Int) -> String {
                guard labelled, let partsAfter, target < partsAfter.count else { return "\(target + lead + 1)" }
                return LabelText.text(partsAfter[target])
            }
            let pages = try PagesAssembler.contentsPages(size: size, title: options.contentsTitle, entries: entries, numberOf: number) { result.page(at: $0) }
            for (offset, page) in pages.enumerated() { result.insert(page, at: offset) }
            outline = outline.map { ($0.level, $0.title, $0.position + lead, $0.point, $0.isOpen) }
            outline.insert((1, options.contentsTitle, 0, CGPoint(x: 0, y: CGFloat.infinity), false), at: 0)
            if let partsAfter {
                labelRules = PageLabelsIO.rules((0..<lead).map { PageLabelsIO.Part(style: "r", prefix: "", number: $0 + 1) } + partsAfter)
            }
        } else {
            labelRules = PagesAssembler.carriedLabels(assembly, sourceParts: labelParts)
        }
        if !outline.isEmpty { PagesAssembler.setOutline(result, entries: outline) }

        progress?(0.9, nil)
        var protectedFrom: String?
        var password: String?
        if options.keepProtection {
            for (file, input) in inputs.enumerated() where documents["\(file)"]?.isEncrypted == true {
                if let known = input.password { password = known; protectedFrom = input.url.lastPathComponent }
                break
            }
        }
        let pageCount = try PagesAssembler.write(result, to: output, labels: labelRules, password: password,
                                               attributes: documents["0"].map(PagesAssembler.carriedAttributes))
        return MergeResult(pageCount: pageCount, protectedFrom: protectedFrom)
    }

    enum LabelText {
        static func text(_ part: PageLabelsIO.Part) -> String {
            PagesTileLabel(style: PageLabelStyle(rawValue: part.style) ?? .decimal, prefix: part.prefix, firstNumber: part.number).text(at: 0)
        }
    }

    // MARK: Split

    enum SplitMode: String, CaseIterable, Sendable { case ranges, every, count, single, size, odd_even, bookmarks, text }

    struct SplitOptions: Sendable {
        var mode: SplitMode = .ranges
        var ranges = ""
        var every = 1
        var parts = 2
        var bookmarkLevel = 1
        var maxBytes = 5 * 1024 * 1024
        var textPattern = ""
        /// `{name}` `{n}` `{first}` `{last}` `{pages}` `{title}`; empty = default naming.
        var pattern = ""
        var baseName: String?
    }

    struct SplitOutput: Sendable {
        var url: URL
        var pageCount: Int
        var firstPage: Int
        var lastPage: Int
        var bytes: Int64
    }

    struct SplitResult: Sendable {
        var outputs: [SplitOutput]
        var protected: Bool
        var oversizedParts: [Int]
    }

    static func split(_ source: PagesSource, options: SplitOptions, folder: URL, progress: ProgressHandler? = nil) throws -> SplitResult {
        let access = PagesAssembler.ScopedAccess([source.url])
        defer { withExtendedLifetime(access) {} }
        let document = try PagesAssembler.open(source.url, password: source.password)
        let groups = try splitGroups(document, options: options, progress: progress).filter { !$0.pages.isEmpty }
        let baseName = PagesSpecs.sanitizeFileName(options.baseName ?? source.url.deletingPathExtension().lastPathComponent)
        let width = String(groups.count).count
        var taken = Set<String>()
        let labelParts = PageLabelsIO.parts(of: source.url, password: source.password)
        let password = protectedPassword(document, source)
        let writtenShare: Double = options.mode == .size ? 0.5 : (options.mode == .text ? 0.3 : 0)
        var outputs: [SplitOutput] = []
        do {
            for (position, group) in groups.enumerated() {
                try Task.checkCancellation()
                progress?(writtenShare + (1 - writtenShare) * Double(position) / Double(max(groups.count, 1)), nil)
                let name = PagesSpecs.uniqueName(partName(baseName, position: position, width: width, group: group.pages, title: group.title, pattern: options.pattern), taken: &taken)
                let url = Workspace.unique(name: name, ext: "pdf", in: folder)
                try writePart(document, indices: group.pages, labelParts: labelParts, password: password, to: url)
                outputs.append(SplitOutput(url: url, pageCount: group.pages.count, firstPage: group.pages[0] + 1, lastPage: group.pages[group.pages.count - 1] + 1,
                                           bytes: Workspace.fileSize(url)))
            }
        } catch {
            outputs.forEach { try? FileManager.default.removeItem(at: $0.url) }
            throw error
        }
        let oversized = options.mode == .size ? outputs.enumerated().filter { $0.element.bytes > Int64(options.maxBytes) }.map { $0.offset + 1 } : []
        return SplitResult(outputs: outputs, protected: password != nil, oversizedParts: oversized)
    }

    static func partName(_ baseName: String, position: Int, width: Int, group: [Int], title: String?, pattern: String) -> String {
        let first = group[0] + 1, last = group[group.count - 1] + 1
        let number = String(format: "%0\(width)d", position + 1)
        let titled = title.map { String(PagesSpecs.sanitizeFileName($0).prefix(48)) } ?? ""
        if !pattern.trimmingCharacters(in: .whitespaces).isEmpty {
            return PagesSpecs.renderName(pattern, values: ["name": baseName, "n": number, "first": "\(first)", "last": "\(last)",
                                                          "pages": "\(group.count)", "title": title == nil ? "" : titled])
        }
        let label = first == last ? "\(first)" : "\(first)-\(last)"
        return "\(baseName)-\(number)-\(titled.isEmpty || title == nil ? "p\(label)" : titled)"
    }

    /// Copies `indices` into a new file with remapped bookmarks and labels.
    static func writePart(_ document: PDFDocument, indices: [Int], labelParts: [PageLabelsIO.Part]?, password: String?, to url: URL) throws {
        let tiles = indices.map { OrganizerTile(key: "\($0)", kind: .page(source: "s", index: $0 + 1)) }
        let assembly = try PagesAssembler.assemble(tiles, sources: ["s": document])
        let outline = PagesAssembler.remappedOutline(document, indices: indices)
        if !outline.isEmpty { PagesAssembler.setOutline(assembly.document, entries: outline) }
        let labels = labelParts.map { parts in PageLabelsIO.rules(indices.map { parts[$0] }) }
        try PagesAssembler.write(assembly.document, to: url, labels: labels, password: password, attributes: PagesAssembler.carriedAttributes(document))
    }

    static func splitGroups(_ document: PDFDocument, options: SplitOptions, progress: ProgressHandler?) throws -> [(pages: [Int], title: String?)] {
        let count = document.pageCount
        guard count > 0 else { throw EngineError(.INVALID_PDF) }
        switch options.mode {
        case .bookmarks:
            var titles: [Int: String] = [:]
            for entry in PagesAssembler.outlineEntries(document) where entry.level <= options.bookmarkLevel && titles[entry.page] == nil {
                titles[entry.page] = entry.title
            }
            guard !titles.isEmpty else { throw EngineError(.INVALID_PARAMS, reason: "noBookmarks") }
            var starts = titles.keys.sorted()
            if starts[0] != 0 { starts.insert(0, at: 0) }
            return starts.enumerated().map { position, start in
                (Array(start..<(position + 1 < starts.count ? starts[position + 1] : count)), titles[start])
            }
        case .text:
            let pattern = options.textPattern.trimmingCharacters(in: .whitespaces)
            guard !pattern.isEmpty, let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
                throw EngineError(.INVALID_PARAMS, reason: "badPattern")
            }
            var groups: [(pages: [Int], title: String?)] = []
            var found = false
            for index in 0..<count {
                try Task.checkCancellation()
                if index % 10 == 0 { progress?(0.3 * Double(index) / Double(count), nil) }
                let text = (document.page(at: index)?.string ?? "").replacingOccurrences(of: "[^\\S\\n]", with: " ", options: .regularExpression)
                if let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) {
                    found = true
                    let range = match.numberOfRanges > 1 ? match.range(at: 1) : match.range
                    let label = Range(range, in: text).map { String(text[$0]).trimmingCharacters(in: .whitespaces) } ?? ""
                    groups.append(([index], label))
                } else if groups.isEmpty {
                    groups.append(([index], nil))
                } else {
                    groups[groups.count - 1].pages.append(index)
                }
            }
            guard found else { throw EngineError(.INVALID_PARAMS, reason: "noMatches") }
            return groups
        case .ranges:
            guard let groups = PagesSpecs.splitGroups(options.ranges, pageCount: count) else { throw EngineError(.INVALID_PARAMS, reason: "badRange") }
            return groups.map { ($0, nil) }
        case .every:
            let every = max(1, options.every)
            return stride(from: 0, to: count, by: every).map { (Array($0..<min($0 + every, count)), nil) }
        case .count:
            let parts = max(1, min(options.parts, count))
            let size = count / parts, extra = count % parts
            var start = 0
            return (0..<parts).map { position in
                let length = size + (position < extra ? 1 : 0)
                defer { start += length }
                return (Array(start..<start + length), nil)
            }
        case .single:
            return (0..<count).map { ([$0], nil) }
        case .odd_even:
            return [(Array(stride(from: 0, to: count, by: 2)), nil), (Array(stride(from: 1, to: count, by: 2)), nil)]
        case .size:
            return try sizeGroups(document, maxBytes: options.maxBytes, progress: progress).map { ($0, nil) }
        }
    }

    /// Greedy parts under `maxBytes`, estimated per page then checked by writing (`_size_groups`).
    static func sizeGroups(_ document: PDFDocument, maxBytes: Int, progress: ProgressHandler?) throws -> [[Int]] {
        let total = document.pageCount
        let overhead = Double(PDFDocument().dataRepresentation()?.count ?? 0)
        var weights: [Double] = []
        for index in 0..<total {
            try Task.checkCancellation()
            if index % 10 == 0 { progress?(0.2 * Double(index) / Double(total), nil) }
            weights.append(max(1, Double(try partBytes(document, index...index)) - overhead))
        }
        var groups: [[Int]] = []
        var start = 0
        while start < total {
            try Task.checkCancellation()
            progress?(0.2 + 0.3 * Double(start) / Double(total), nil)
            var end = start + 1
            var estimate = weights[start]
            while end < total && estimate + weights[end] <= Double(maxBytes) {
                estimate += weights[end]
                end += 1
            }
            for _ in 0..<6 where end - start > 1 {
                let measured = try partBytes(document, start...(end - 1))
                if measured <= maxBytes { break }
                let pages = end - start
                let drop = max(1, min(pages - 1, Int(Double(pages) * (1 - Double(maxBytes) / Double(measured))) + 1))
                end -= drop
            }
            groups.append(Array(start..<end))
            start = end
        }
        return groups
    }

    private static func partBytes(_ document: PDFDocument, _ range: ClosedRange<Int>) throws -> Int {
        let part = PDFDocument()
        for index in range { if let page = document.page(at: index)?.copy() as? PDFPage { part.insert(page, at: part.pageCount) } }
        return part.dataRepresentation()?.count ?? 0
    }

    // MARK: Copy into another document

    /// Appends tiles to the end of `target` and returns a temp file to swap in (`copyPagesInto`).
    static func appendPages(to target: PagesSource, sources: [PagesSource], tiles: [OrganizerTile]) throws -> URL {
        let access = PagesAssembler.ScopedAccess([target.url])
        let targetDocument = try PagesAssembler.open(target.url, password: target.password)
        let targetCount = targetDocument.pageCount
        withExtendedLifetime(access) {}
        let targetID = "__target"
        let all = (0..<targetCount).map { OrganizerTile(key: "t\($0)", kind: .page(source: targetID, index: $0 + 1)) } + tiles
        let output = Workspace.scratch().appendingPathComponent(target.url.lastPathComponent)
        try assemble(sources: [PagesSource(id: targetID, url: target.url, password: target.password)] + sources.filter { $0.id != targetID },
                     tiles: all, labels: nil, output: output, password: protectedPassword(targetDocument, target))
        return output
    }
}
