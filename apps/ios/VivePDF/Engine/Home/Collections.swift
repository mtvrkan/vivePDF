import Foundation
import Observation

/// Colours shared with viewer tab groups (`GROUP_COLORS` on desktop).
enum GroupColor: String, CaseIterable, Codable, Identifiable {
    case blue, green, orange, purple, amber, red, teal, cyan, indigo, pink, lime, brown, gray
    var id: String { rawValue }
    var labelKey: String { "viewer.tabGroups.colors.\(rawValue)" }
}

/// A file inside a collection. The bookmark keeps access to files picked from other apps' folders.
struct CollectionFile: Codable, Hashable, Identifiable {
    var path: String
    var bookmark: Data?
    var id: String { path }
    var name: String { (path as NSString).lastPathComponent }
    var folder: String { (path as NSString).deletingLastPathComponent }

    init(url: URL) {
        path = url.path
        bookmark = withSecurityScope(url) { try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) }
    }

    init(path: String, bookmark: Data? = nil) {
        self.path = path
        self.bookmark = bookmark
    }

    /// The live URL, or nil when the file is gone.
    func resolve() -> URL? {
        if let bookmark {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: bookmark, bookmarkDataIsStale: &stale) {
                let exists = withSecurityScope(url) { FileManager.default.fileExists(atPath: url.path) }
                return exists ? url : nil
            }
        }
        return FileManager.default.fileExists(atPath: path) ? URL(fileURLWithPath: path) : nil
    }
}

/// A named set of files opened together (`features/home/collectionsStore.ts`).
struct FileCollection: Codable, Hashable, Identifiable {
    static let nameMax = 40
    static let filesMax = 50

    var id: String
    var name: String
    var color: GroupColor
    var files: [CollectionFile]
    var pinned: Bool = false

    static func cleanName(_ name: String) -> String {
        String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(nameMax))
    }

    static func unique(_ files: [CollectionFile]) -> [CollectionFile] {
        var seen = Set<String>()
        return files.filter { seen.insert($0.path.lowercased()).inserted }.prefix(filesMax).map { $0 }
    }
}

enum CollectionSort: String, CaseIterable, Identifiable {
    case collection, nameAsc, nameDesc, folder, type
    var id: String { rawValue }
    var labelKey: String { "home.collections.sorts.\(rawValue)" }
}

enum CollectionOrdering {
    static func matching(_ files: [CollectionFile], query: String) -> [CollectionFile] {
        let needle = TextFolding.fold(query)
        guard !needle.isEmpty else { return files }
        return files.filter { TextFolding.fold($0.path).contains(needle) }
    }

    static func sorted(_ files: [CollectionFile], by sort: CollectionSort) -> [CollectionFile] {
        func byName(_ a: CollectionFile, _ b: CollectionFile) -> Bool {
            a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
        switch sort {
        case .collection: return files
        case .nameAsc: return files.sorted(by: byName)
        case .nameDesc: return files.sorted { byName($1, $0) }
        case .folder:
            return files.sorted {
                let order = $0.folder.localizedStandardCompare($1.folder)
                return order == .orderedSame ? byName($0, $1) : order == .orderedAscending
            }
        case .type:
            return files.sorted {
                let a = ($0.path as NSString).pathExtension, b = ($1.path as NSString).pathExtension
                let order = a.localizedStandardCompare(b)
                return order == .orderedSame ? byName($0, $1) : order == .orderedAscending
            }
        }
    }

    static func pinnedFirst(_ collections: [FileCollection]) -> [FileCollection] {
        collections.filter(\.pinned) + collections.filter { !$0.pinned }
    }

    /// Moves within its pinned/unpinned block, like the desktop `moveCollection`.
    static func move(_ collections: [FileCollection], id: String, to index: Int) -> [FileCollection] {
        let ordered = pinnedFirst(collections)
        guard let moving = ordered.first(where: { $0.id == id }) else { return collections }
        var rest = ordered.filter { $0.id != id }
        let pinnedCount = rest.filter(\.pinned).count
        let target = moving.pinned ? max(0, min(pinnedCount, index)) : max(pinnedCount, min(rest.count, index))
        rest.insert(moving, at: target)
        return rest
    }
}

/// Persisted in `Application Support/vivePDF/collections.json`.
@Observable
final class CollectionsStore {
    static let shared = CollectionsStore()

    private(set) var collections: [FileCollection] = []
    @ObservationIgnored private let fileURL = Workspace.support.appendingPathComponent("collections.json")

    private init() {
        if let data = try? Data(contentsOf: fileURL), let list = try? JSONDecoder().decode([FileCollection].self, from: data) {
            collections = list
        }
    }

    var ordered: [FileCollection] { CollectionOrdering.pinnedFirst(collections) }

    func collection(_ id: String) -> FileCollection? { collections.first { $0.id == id } }

    @discardableResult
    func create(name: String, files: [CollectionFile]) -> String {
        let id = UUID().uuidString
        let used = Set(collections.map(\.color))
        let color = GroupColor.allCases.first { !used.contains($0) } ?? GroupColor.allCases[collections.count % GroupColor.allCases.count]
        update(collections + [FileCollection(id: id, name: FileCollection.cleanName(name), color: color, files: FileCollection.unique(files))])
        return id
    }

    func edit(_ id: String, name: String, files: [CollectionFile]) {
        change(id) {
            $0.name = FileCollection.cleanName(name)
            $0.files = FileCollection.unique(files)
        }
    }

    func recolor(_ id: String, _ color: GroupColor) { change(id) { $0.color = color } }

    func addFiles(_ id: String, _ files: [CollectionFile]) { change(id) { $0.files = FileCollection.unique($0.files + files) } }

    func removeFiles(_ id: String, paths: Set<String>) {
        change(id) { $0.files.removeAll { paths.contains($0.path) } }
    }

    func remove(_ id: String) { update(collections.filter { $0.id != id }) }

    func move(_ id: String, to index: Int) { update(CollectionOrdering.move(collections, id: id, to: index)) }

    func setPinned(_ id: String, _ pinned: Bool) {
        guard var moving = collection(id) else { return }
        moving.pinned = pinned
        var others = CollectionOrdering.pinnedFirst(collections.filter { $0.id != id })
        let pinnedCount = others.filter(\.pinned).count
        others.insert(moving, at: pinnedCount)
        update(others)
    }

    func restore(_ snapshot: [FileCollection]) { update(snapshot) }

    private func change(_ id: String, _ edit: (inout FileCollection) -> Void) {
        update(collections.map { item in
            guard item.id == id else { return item }
            var copy = item
            edit(&copy)
            return copy
        })
    }

    private func update(_ next: [FileCollection]) {
        collections = next
        if let data = try? JSONEncoder().encode(next) { try? data.write(to: fileURL, options: .atomic) }
    }
}

/// Lower-case, diacritic- and Turkish-dotless-i-insensitive comparison text (`normalizeText` on desktop).
enum TextFolding {
    static func fold(_ value: String) -> String {
        value.replacingOccurrences(of: "ı", with: "i").replacingOccurrences(of: "İ", with: "i")
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}

enum RecentSort: String, CaseIterable, Identifiable {
    case recent, name, folder
    var id: String { rawValue }
    var labelKey: String { "home.recentSorts.\(rawValue)" }
}

/// Filtering and ordering for the Home "Recent documents" list (`recentList.ts`).
enum RecentOrdering {
    static func folder(of item: RecentDocument) -> String { (item.path as NSString).deletingLastPathComponent }

    static func matching(_ items: [RecentDocument], query: String) -> [RecentDocument] {
        let needle = TextFolding.fold(query)
        guard !needle.isEmpty else { return items }
        return items.filter { TextFolding.fold("\($0.name) \(folder(of: $0))").contains(needle) }
    }

    static func sorted(_ items: [RecentDocument], by sort: RecentSort) -> [RecentDocument] {
        func byName(_ a: RecentDocument, _ b: RecentDocument) -> Bool { a.name.localizedStandardCompare(b.name) == .orderedAscending }
        switch sort {
        case .recent: return items
        case .name: return items.sorted(by: byName)
        case .folder:
            return items.sorted {
                let order = folder(of: $0).localizedStandardCompare(folder(of: $1))
                return order == .orderedSame ? byName($0, $1) : order == .orderedAscending
            }
        }
    }

    static func pinnedFirst(_ items: [RecentDocument]) -> [RecentDocument] {
        items.filter(\.pinned) + items.filter { !$0.pinned }
    }
}

/// "just now", "5 minutes ago", "yesterday", or a medium date after a week (`formatRelativeMoment`).
enum RelativeMoment {
    static func format(_ date: Date, now: Date = Date(), locale: Locale, justNow: String) -> String {
        let diff = date.timeIntervalSince(now)
        if abs(diff) < 60 { return justNow }
        let days = (diff / 86_400).rounded()
        if abs(days) < 7 {
            let formatter = RelativeDateTimeFormatter()
            formatter.locale = locale
            formatter.dateTimeStyle = .named
            if abs(diff) < 3600 { return formatter.localizedString(from: DateComponents(minute: Int((diff / 60).rounded()))) }
            if abs(diff) < 86_400 { return formatter.localizedString(from: DateComponents(hour: Int((diff / 3600).rounded()))) }
            return formatter.localizedString(from: DateComponents(day: Int(days)))
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .medium
        return formatter.string(from: date)
    }
}
