import Foundation
import Observation
import SwiftUI
import UniformTypeIdentifiers

/// The open document (`documentStore.ts`): edits bump `revision` (drives the preview) and are
/// mirrored into a draft file shortly after, so an unsaved document survives the app being closed.
@MainActor
@Observable
final class StudioDocStore {
    var document: StudioDocument
    var url: URL?
    var dirty = false
    var revision = 0

    @ObservationIgnored private var draftTask: Task<Void, Never>?

    init(file: StudioDocumentFile) {
        document = file.document
        url = file.url
        StudioDocDrafts.write(document, url: url)
    }

    var displayName: String { document.name.isEmpty ? t("studio.doc.untitled") : document.name }

    private func changed() {
        dirty = true
        revision += 1
        scheduleDraft()
    }

    /// The editor parsed string content into nodes on first open (not a user edit).
    func adopt(_ node: StudioDocNode) {
        guard document.content != .node(node) else { return }
        document.content = .node(node)
        revision += 1
        scheduleDraft()
    }

    func setContent(_ node: StudioDocNode) {
        guard document.content != .node(node) else { return }
        document.content = .node(node)
        changed()
    }

    func update(_ change: (inout StudioDocSettings) -> Void) {
        var settings = document.settings
        change(&settings)
        let clamped = settings.clamped()
        guard clamped != document.settings else { return }
        document.settings = clamped
        changed()
    }

    func setName(_ name: String) {
        let trimmed = String(name.prefix(200))
        guard trimmed != document.name else { return }
        document.name = trimmed
        changed()
    }

    private func scheduleDraft() {
        draftTask?.cancel()
        let document = document, url = url
        draftTask = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            StudioDocDrafts.write(document, url: url)
        }
    }

    func flushDraft() {
        draftTask?.cancel()
        StudioDocDrafts.write(document, url: url)
    }

    /// Writes the document back to its file (coordinated, security-scoped).
    func save() throws {
        guard let url else { return }
        let data = try document.data()
        try withSecurityScope(url) {
            var coordError: NSError?
            var writeError: Error?
            NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { target in
                do { try data.write(to: target, options: .atomic) } catch { writeError = error }
            }
            if let error = coordError ?? writeError { throw error }
        }
        markSaved(url)
    }

    func markSaved(_ url: URL) {
        self.url = url
        dirty = false
        StudioDocDrafts.write(document, url: url)
    }

    var fileDocument: StudioDocFileDocument { StudioDocFileDocument(document: document) }

    /// File name offered by "Save as" (`sanitizeFileName(name) || untitled`).
    var suggestedName: String {
        let cleaned = document.name.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "[\\\\/:*?\"<>|\\x00-\\x1f]+", with: "-", options: .regularExpression)
        return cleaned.isEmpty ? t("studio.doc.untitled") : cleaned
    }
}

/// `.vivedoc` for `.fileExporter` / `.fileImporter`.
struct StudioDocFileDocument: FileDocument {
    static var readableContentTypes: [UTType] { [StudioDocument.contentType] }
    var document: StudioDocument

    init(document: StudioDocument) { self.document = document }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw EngineError(.INVALID_PARAMS, reason: "noDocument") }
        document = try StudioDocument.read(data)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: try document.data())
    }
}

/// The autosaved draft (`vivepdf.studioDocumentDraft` on desktop) in Application Support.
enum StudioDocDrafts {
    static var fileURL: URL { Workspace.supportFolder("studio").appendingPathComponent("document-draft.json") }

    static func write(_ document: StudioDocument, url: URL?) {
        var payload: [String: Any] = ["document": document.json]
        if let url {
            payload["filePath"] = url.path
            if let bookmark = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) {
                payload["bookmark"] = bookmark.base64EncodedString()
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    static func read() -> StudioDocumentFile? {
        guard let data = try? Data(contentsOf: fileURL), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let document = StudioDocument(json: object["document"]) else { return nil }
        var url: URL?
        if let encoded = object["bookmark"] as? String, let bookmark = Data(base64Encoded: encoded) {
            var stale = false
            url = try? URL(resolvingBookmarkData: bookmark, bookmarkDataIsStale: &stale)
        }
        if url == nil, let path = object["filePath"] as? String, FileManager.default.fileExists(atPath: path) { url = URL(fileURLWithPath: path) }
        return StudioDocumentFile(document: document, url: url)
    }
}
