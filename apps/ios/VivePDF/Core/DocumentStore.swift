import Foundation
import Observation
import PDFKit
import UIKit

/// One open PDF (a viewer tab). Opened in place: picked files keep their security scope while open,
/// and saving writes back to the original location through a file coordinator.
@Observable
final class OpenDocument: Identifiable, Hashable {
    let id = UUID()
    /// The file on disk (original location for files opened in place).
    private(set) var url: URL
    var pdf: PDFDocument
    var isDirty = false
    var currentPageIndex = 0
    /// Remembered password so engines can reopen encrypted files.
    var password: String?
    /// Set when the file changed on disk behind our back (other app / iCloud).
    var changedOnDisk = false
    @ObservationIgnored private var scoped = false
    @ObservationIgnored private var presenter: DocumentFilePresenter?

    var title: String { url.deletingPathExtension().lastPathComponent }
    var fileName: String { url.lastPathComponent }
    var pageCount: Int { pdf.pageCount }

    init(url: URL, pdf: PDFDocument, password: String? = nil) {
        self.url = url
        self.pdf = pdf
        self.password = password
        scoped = url.startAccessingSecurityScopedResource()
        let presenter = DocumentFilePresenter(url: url) { [weak self] in
            Task { @MainActor in self?.changedOnDisk = true }
        }
        NSFileCoordinator.addFilePresenter(presenter)
        self.presenter = presenter
    }

    deinit { close() }

    func close() {
        if let presenter { NSFileCoordinator.removeFilePresenter(presenter) }
        presenter = nil
        if scoped { url.stopAccessingSecurityScopedResource(); scoped = false }
    }

    static func == (lhs: OpenDocument, rhs: OpenDocument) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    /// Writes the in-memory document back to its file (coordinated, atomic) and reloads it.
    func save(options: [PDFDocumentWriteOption: Any] = [:]) throws {
        let temp = Workspace.scratch().appendingPathComponent(fileName)
        var writeOptions = options
        if let password, pdf.isEncrypted, writeOptions[.userPasswordOption] == nil {
            writeOptions[.userPasswordOption] = password
            writeOptions[.ownerPasswordOption] = password
        }
        guard pdf.write(to: temp, withOptions: writeOptions) else { throw EngineError.internalError("write") }
        try replaceFile(with: temp)
        isDirty = false
    }

    /// Replaces the file on disk with `newFile` (an engine output) and reloads the view.
    func replaceFile(with newFile: URL) throws {
        var coordError: NSError?
        var replaceError: Error?
        NSFileCoordinator(filePresenter: presenter).coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { target in
            do {
                let data = try Data(contentsOf: newFile)
                try data.write(to: target, options: .atomic)
            } catch { replaceError = error }
        }
        if let error = coordError ?? replaceError { throw error }
        try reload()
    }

    /// Re-reads the file (after an external change or an engine rewrite), keeping the page position.
    func reload() throws {
        guard let fresh = PDFDocument(url: url) else { throw EngineError(.INVALID_PDF) }
        if fresh.isLocked, let password { fresh.unlock(withPassword: password) }
        pdf = fresh
        currentPageIndex = min(currentPageIndex, max(0, fresh.pageCount - 1))
        changedOnDisk = false
        isDirty = false
    }

    /// Writes the current in-memory state to a temp file engines can read (unsaved edits included).
    func snapshotURL() throws -> URL {
        if !isDirty { return url }
        let temp = Workspace.scratch().appendingPathComponent(fileName)
        guard pdf.write(to: temp) else { throw EngineError.internalError("snapshot") }
        return temp
    }
}

private final class DocumentFilePresenter: NSObject, NSFilePresenter {
    let presentedItemURL: URL?
    let presentedItemOperationQueue = OperationQueue()
    let onChange: () -> Void
    init(url: URL, onChange: @escaping () -> Void) {
        presentedItemURL = url
        self.onChange = onChange
    }
    func presentedItemDidChange() { onChange() }
}

/// A remembered file for the Home screen ("Recent documents", "Continue reading").
struct RecentDocument: Codable, Identifiable, Hashable {
    var id: String { path }
    var path: String
    var name: String
    var bookmark: Data?
    var openedAt: Date
    var pageCount: Int
    var lastPage: Int
    var bytes: Int64
    var pinned: Bool = false

    func resolve() -> URL? {
        if let bookmark {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: bookmark, bookmarkDataIsStale: &stale) { return url }
        }
        let url = URL(fileURLWithPath: path)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
}

/// Open tabs, the active tab and the recent-files list.
@Observable
final class DocumentStore {
    var documents: [OpenDocument] = []
    var activeID: OpenDocument.ID?
    var recents: [RecentDocument] = []
    /// Set when a file needs a password before it can be opened; the UI shows `PasswordPrompt`.
    var pendingPassword: PendingPassword?
    var lastError: String?

    struct PendingPassword: Identifiable {
        let id = UUID()
        let url: URL
        var wrong = false
    }

    private let recentsURL = Workspace.support.appendingPathComponent("recents.json")

    init() {
        if let data = try? Data(contentsOf: recentsURL), let list = try? JSONDecoder().decode([RecentDocument].self, from: data) {
            recents = list
        }
    }

    var active: OpenDocument? {
        get { documents.first { $0.id == activeID } ?? documents.last }
        set { activeID = newValue?.id }
    }

    /// Opens a PDF (or focuses it if already open). Returns nil when a password is needed or it failed.
    @discardableResult
    func open(_ url: URL, password: String? = nil) -> OpenDocument? {
        if let existing = documents.first(where: { $0.url.standardizedFileURL == url.standardizedFileURL }) {
            activeID = existing.id
            return existing
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let pdf = PDFDocument(url: url) else {
            lastError = t("errors.INVALID_PDF")
            return nil
        }
        if pdf.isLocked {
            guard let password, pdf.unlock(withPassword: password) else {
                pendingPassword = PendingPassword(url: url, wrong: password != nil)
                return nil
            }
        }
        let doc = OpenDocument(url: url, pdf: pdf, password: password)
        if let recent = recents.first(where: { $0.path == url.path }) {
            doc.currentPageIndex = min(recent.lastPage, max(0, pdf.pageCount - 1))
        }
        documents.append(doc)
        activeID = doc.id
        remember(doc)
        return doc
    }

    func close(_ doc: OpenDocument) {
        remember(doc)
        doc.close()
        documents.removeAll { $0.id == doc.id }
        if activeID == doc.id { activeID = documents.last?.id }
    }

    func closeAll() {
        documents.forEach { remember($0); $0.close() }
        documents.removeAll()
        activeID = nil
    }

    func remember(_ doc: OpenDocument) {
        // Settings › Startup and privacy: "Remember recent files" / "Recent files to keep" (pinned files are extra).
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: "vivepdf.general.rememberRecent") as? Bool ?? true else { return }
        let limit = defaults.object(forKey: "vivepdf.general.recentLimit") as? Int ?? 12
        let bookmark = try? doc.url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        var entry = RecentDocument(path: doc.url.path, name: doc.fileName, bookmark: bookmark, openedAt: Date(),
                                   pageCount: doc.pageCount, lastPage: doc.currentPageIndex, bytes: Workspace.fileSize(doc.url))
        if let old = recents.first(where: { $0.path == entry.path }) { entry.pinned = old.pinned }
        recents.removeAll { $0.path == entry.path }
        recents.insert(entry, at: 0)
        let unpinned = recents.filter { !$0.pinned }
        if unpinned.count > limit {
            let dropped = Set(unpinned.dropFirst(limit).map(\.path))
            recents.removeAll { dropped.contains($0.path) }
        }
        persistRecents()
    }

    func forget(_ recent: RecentDocument) {
        recents.removeAll { $0.path == recent.path }
        persistRecents()
    }

    func clearRecents() {
        recents.removeAll { !$0.pinned }
        persistRecents()
    }

    func togglePin(_ recent: RecentDocument) {
        guard let index = recents.firstIndex(of: recent) else { return }
        recents[index].pinned.toggle()
        persistRecents()
    }

    func persistRecents() {
        if let data = try? JSONEncoder().encode(recents) { try? data.write(to: recentsURL, options: .atomic) }
    }
}
