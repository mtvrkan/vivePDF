import Foundation
import Observation
import PDFKit

/// Folder full-text index (`ops/search.py`). The user picks folders in the Files app; each is remembered by a
/// bookmark, its PDFs are read with PDFKit and their page texts are stored under Application Support/vivePDF/Search.
/// Unchanged files (same size and modification date) are skipped on re-index, removed files are dropped.
@MainActor
@Observable
final class SearchIndex {
    static let shared = SearchIndex()
    nonisolated static let staleInterval: TimeInterval = 10 * 60
    nonisolated static let resultLimit = 40
    nonisolated static let maxMatchedPages = 5
    nonisolated static let maxPageCharacters = 200_000

    struct Folder: Codable, Identifiable, Hashable {
        var id: String
        var name: String
        var path: String
        var bookmark: Data
        var recursive: Bool
        var addedAt: Date
        var lastIndexed: Date?
        var files = 0
        var pages = 0
    }

    struct IndexedFile: Codable, Hashable {
        enum Status: String, Codable { case ok, unindexable }
        var relativePath: String
        var title: String
        var pages: Int
        var modified: Date
        var size: Int64
        var status: Status
        var texts: [String]
    }

    struct Stats: Hashable {
        var indexed = 0, unchanged = 0, skipped = 0, removed = 0, pages = 0
        static func + (a: Stats, b: Stats) -> Stats {
            Stats(indexed: a.indexed + b.indexed, unchanged: a.unchanged + b.unchanged, skipped: a.skipped + b.skipped,
                  removed: a.removed + b.removed, pages: a.pages + b.pages)
        }
    }

    struct Filters: Hashable {
        var folderID: String?
        /// Restricts to one document (the active viewer document).
        var documentPath: String?
        var modifiedAfter: Date?
        var modifiedBefore: Date?
        var minPages: Int?
        var maxPages: Int?
    }

    struct PageHit: Hashable, Identifiable {
        var page: Int
        var snippet: SearchQuery.Snippet
        var id: Int { page }
    }

    struct FileHit: Hashable, Identifiable {
        var folderID: String
        var path: String
        var title: String
        var pages: Int
        var matchedPages: [PageHit]
        var pageHits: Int
        var id: String { path }
        var fileName: String { (path as NSString).lastPathComponent }
    }

    struct Result: Hashable {
        var files: [FileHit]
        var totalFiles: Int
    }

    private(set) var folders: [Folder] = []
    private(set) var isIndexing = false
    private(set) var progress: (current: Int, total: Int)?
    private(set) var lastStats: Stats?
    private(set) var lastError: String?

    @ObservationIgnored private var corpus: SearchCorpus?
    @ObservationIgnored private var indexTask: Task<Void, Never>?
    private let directory = Workspace.supportFolder("Search")
    private var foldersURL: URL { directory.appendingPathComponent("folders.json") }

    private init() {
        if let data = try? Data(contentsOf: foldersURL), let list = try? JSONDecoder().decode([Folder].self, from: data) {
            folders = list
        }
    }

    var totalFiles: Int { folders.reduce(0) { $0 + $1.files } }
    var totalPages: Int { folders.reduce(0) { $0 + $1.pages } }
    var lastIndexed: Date? { folders.compactMap(\.lastIndexed).max() }
    var isStale: Bool { lastIndexed.map { Date().timeIntervalSince($0) >= Self.staleInterval } ?? true }

    /// Bytes used by the stored index (shown under Settings › Data).
    var storageBytes: Int64 {
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        return urls.reduce(0) { $0 + Workspace.fileSize($1) }
    }

    // MARK: Folders

    enum AddError: Error { case overlap, unreadable }

    /// Adds a folder picked in the Files app and indexes it.
    func addFolder(_ url: URL) throws {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let path = url.standardizedFileURL.path
        for existing in folders where existing.path != path {
            if path.hasPrefix(existing.path + "/") || existing.path.hasPrefix(path + "/") { throw AddError.overlap }
        }
        if folders.contains(where: { $0.path == path }) { return }
        guard let bookmark = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) else {
            throw AddError.unreadable
        }
        folders.append(Folder(id: UUID().uuidString, name: url.lastPathComponent, path: path, bookmark: bookmark, recursive: true, addedAt: Date()))
        persistFolders()
        reindex(onlyFolder: folders.last?.id, force: true)
    }

    func removeFolder(_ folder: Folder) {
        folders.removeAll { $0.id == folder.id }
        try? FileManager.default.removeItem(at: filesURL(folder.id))
        persistFolders()
        corpus = nil
    }

    func clearAll() {
        indexTask?.cancel()
        for folder in folders { try? FileManager.default.removeItem(at: filesURL(folder.id)) }
        folders = []
        persistFolders()
        corpus = nil
    }

    func cancelIndexing() { indexTask?.cancel() }

    /// Re-indexes stale folders (or all with `force`), in the background.
    func reindex(onlyFolder: String? = nil, force: Bool = false) {
        guard !isIndexing else { return }
        let targets = folders.filter { folder in
            if let onlyFolder { return folder.id == onlyFolder }
            return force || folder.lastIndexed.map { Date().timeIntervalSince($0) >= Self.staleInterval } ?? true
        }
        guard !targets.isEmpty else { return }
        isIndexing = true
        lastError = nil
        progress = nil
        let directory = directory
        indexTask = Task { [weak self] in
            var total = Stats()
            for folder in targets {
                if Task.isCancelled { break }
                do {
                    let outcome = try await Task.detached(priority: .utility) {
                        try Self.index(folder: folder, directory: directory) { current, count in
                            Task { @MainActor in self?.progress = (current, count) }
                        }
                    }.value
                    total = total + outcome.stats
                    self?.finish(folder: folder.id, files: outcome.files, pages: outcome.pages)
                } catch is CancellationError {
                    break
                } catch {
                    self?.lastError = error.localizedDescription
                }
            }
            self?.lastStats = total
            self?.isIndexing = false
            self?.progress = nil
            self?.corpus = nil
        }
    }

    private func finish(folder id: String, files: Int, pages: Int) {
        guard let index = folders.firstIndex(where: { $0.id == id }) else { return }
        folders[index].files = files
        folders[index].pages = pages
        folders[index].lastIndexed = Date()
        persistFolders()
    }

    private func persistFolders() {
        if let data = try? JSONEncoder().encode(folders) { try? data.write(to: foldersURL, options: .atomic) }
    }

    private func filesURL(_ folderID: String) -> URL { directory.appendingPathComponent("\(folderID).json") }

    // MARK: Indexing (off the main actor)

    private struct Outcome: Sendable {
        var stats: Stats
        var files: Int
        var pages: Int
    }

    nonisolated private static func index(folder: Folder, directory: URL, progress: @escaping @Sendable (Int, Int) -> Void) throws -> Outcome {
        var stale = false
        guard let root = try? URL(resolvingBookmarkData: folder.bookmark, bookmarkDataIsStale: &stale) else {
            throw EngineError(.FILE_NOT_FOUND, detail: folder.name)
        }
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let store = directory.appendingPathComponent("\(folder.id).json")
        let known: [String: IndexedFile] = (try? Data(contentsOf: store))
            .flatMap { try? JSONDecoder().decode([IndexedFile].self, from: $0) }
            .map { Dictionary($0.map { ($0.relativePath, $0) }, uniquingKeysWith: { a, _ in a }) } ?? [:]
        let pdfs = listPDFs(in: root, recursive: folder.recursive)
        var stats = Stats()
        var result: [IndexedFile] = []
        var seen = Set<String>()
        let rootPath = root.standardizedFileURL.path
        for (position, url) in pdfs.enumerated() {
            try Task.checkCancellation()
            let relative = String(url.standardizedFileURL.path.dropFirst(rootPath.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            seen.insert(relative)
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            let modified = values?.contentModificationDate ?? .distantPast
            let size = Int64(values?.fileSize ?? 0)
            if let existing = known[relative], abs(existing.modified.timeIntervalSince(modified)) < 0.001, existing.size == size {
                stats.unchanged += 1
                result.append(existing)
                continue
            }
            if let document = PDFDocument(url: url), !document.isLocked {
                let texts = (0..<document.pageCount).map { String((document.page(at: $0)?.string ?? "").prefix(maxPageCharacters)) }
                let title = (document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String)?.trimmingCharacters(in: .whitespaces)
                result.append(IndexedFile(relativePath: relative, title: title?.isEmpty == false ? title! : url.deletingPathExtension().lastPathComponent,
                                          pages: texts.count, modified: modified, size: size, status: .ok, texts: texts))
                stats.indexed += 1
                stats.pages += texts.count
            } else {
                result.append(IndexedFile(relativePath: relative, title: url.deletingPathExtension().lastPathComponent, pages: 0,
                                          modified: modified, size: size, status: .unindexable, texts: []))
                stats.skipped += 1
            }
            if (position + 1) % 3 == 0 || position + 1 == pdfs.count { progress(position + 1, pdfs.count) }
        }
        stats.removed = known.keys.filter { !seen.contains($0) }.count
        let data = try JSONEncoder().encode(result)
        try data.write(to: store, options: .atomic)
        let ok = result.filter { $0.status == .ok }
        return Outcome(stats: stats, files: ok.count, pages: ok.reduce(0) { $0 + $1.pages })
    }

    nonisolated static func listPDFs(in root: URL, recursive: Bool) -> [URL] {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.isRegularFileKey]
        var found: [URL] = []
        if recursive {
            let enumerator = fm.enumerator(at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants])
            while let url = enumerator?.nextObject() as? URL {
                if url.pathExtension.lowercased() == "pdf", (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
                    found.append(url)
                }
            }
        } else {
            found = ((try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])) ?? [])
                .filter { $0.pathExtension.lowercased() == "pdf" }
        }
        return found.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
    }

    // MARK: Querying

    private func loadCorpus() async -> SearchCorpus {
        if let corpus { return corpus }
        let folders = folders
        let directory = directory
        let built = await Task.detached(priority: .userInitiated) { () -> SearchCorpus in
            var files: [SearchCorpus.File] = []
            var pageTexts: [(file: Int, number: Int, text: String)] = []
            for folder in folders {
                guard let data = try? Data(contentsOf: directory.appendingPathComponent("\(folder.id).json")),
                      let list = try? JSONDecoder().decode([IndexedFile].self, from: data) else { continue }
                for file in list where file.status == .ok {
                    let index = files.count
                    files.append(SearchCorpus.File(folderID: folder.id, path: (folder.path as NSString).appendingPathComponent(file.relativePath),
                                                   title: file.title, pages: file.pages, modified: file.modified))
                    for (number, text) in file.texts.enumerated() where !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        pageTexts.append((index, number + 1, text))
                    }
                }
            }
            return SearchCorpus(files: files, pageTexts: pageTexts)
        }.value
        corpus = built
        return built
    }

    func query(_ text: String, filters: Filters, limit: Int = SearchIndex.resultLimit) async -> Result {
        let expression = SearchQuery.parse(text)
        guard !expression.isEmpty else { return Result(files: [], totalFiles: 0) }
        let corpus = await loadCorpus()
        return await Task.detached(priority: .userInitiated) {
            Self.run(expression, on: corpus, filters: filters, limit: limit)
        }.value
    }

    nonisolated static func run(_ expression: SearchQuery.Expression, on corpus: SearchCorpus, filters: Filters, limit: Int) -> Result {
        let terms = SearchQuery.positiveTerms(expression)
        var minPages = filters.minPages, maxPages = filters.maxPages
        if let lo = minPages, let hi = maxPages, lo > hi { (minPages, maxPages) = (hi, lo) }
        var after = filters.modifiedAfter, before = filters.modifiedBefore
        if let a = after, let b = before, a > b { (after, before) = (b, a) }
        func allowed(_ file: SearchCorpus.File) -> Bool {
            if let id = filters.folderID, file.folderID != id { return false }
            if let path = filters.documentPath, URL(fileURLWithPath: path).standardizedFileURL.path != file.path { return false }
            if let after, file.modified < after { return false }
            if let before, file.modified > before { return false }
            if let minPages, file.pages < minPages { return false }
            if let maxPages, file.pages > maxPages { return false }
            return true
        }
        var order: [Int] = []
        var grouped: [Int: [Int]] = [:]
        for hit in corpus.evaluate(expression) {
            let page = corpus.pages[hit.page]
            guard allowed(corpus.files[page.file]) else { continue }
            if grouped[page.file] == nil { order.append(page.file) }
            grouped[page.file, default: []].append(hit.page)
        }
        let files = order.prefix(limit).map { fileIndex -> FileHit in
            let file = corpus.files[fileIndex]
            let hits = grouped[fileIndex] ?? []
            return FileHit(folderID: file.folderID, path: file.path, title: file.title, pages: file.pages,
                           matchedPages: hits.prefix(maxMatchedPages).map { pageIndex in
                               let page = corpus.pages[pageIndex]
                               return PageHit(page: page.number, snippet: SearchQuery.snippet(text: page.text, terms: terms))
                           },
                           pageHits: hits.count)
        }
        return Result(files: files, totalFiles: order.count)
    }

    /// A URL for a hit that carries its own security scope, so the viewer can keep it open (and save) after
    /// the folder's access ends.
    func openableURL(for hit: FileHit) -> URL? {
        guard let folder = folders.first(where: { $0.id == hit.folderID }) else { return nil }
        var stale = false
        guard let root = try? URL(resolvingBookmarkData: folder.bookmark, bookmarkDataIsStale: &stale) else { return nil }
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let relative = String(hit.path.dropFirst(folder.path.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let file = root.appendingPathComponent(relative)
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        if let bookmark = try? file.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil),
           let resolved = try? URL(resolvingBookmarkData: bookmark, bookmarkDataIsStale: &stale) {
            return resolved
        }
        return file
    }
}

/// Recent search queries (`vivepdf.searchHistory`, newest first, at most 10).
enum SearchHistory {
    static let key = "vivepdf.searchHistory"
    static let limit = 10

    static func read() -> [String] {
        guard let data = UserDefaults.standard.string(forKey: key)?.data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }
        return list.compactMap { $0 as? String }
    }

    static func write(_ items: [String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: items), let text = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(text, forKey: key)
    }

    @discardableResult
    static func push(_ query: String) -> [String] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let current = read()
        guard !trimmed.isEmpty else { return current }
        let next = Array(([trimmed] + current.filter { $0 != trimmed }).prefix(limit))
        write(next)
        return next
    }

    @discardableResult
    static func remove(_ query: String) -> [String] {
        let next = read().filter { $0 != query }
        write(next)
        return next
    }

    @discardableResult
    static func clear() -> [String] {
        UserDefaults.standard.removeObject(forKey: key)
        return []
    }
}
