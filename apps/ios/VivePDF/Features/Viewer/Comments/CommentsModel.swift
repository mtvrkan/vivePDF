import Observation
import PDFKit
import SwiftUI
import UniformTypeIdentifiers

/// Comments panel state for one document: filters, the thread list and the editing operations.
/// Edits change the live `PDFDocument` (undoable, saved with the document), unlike the desktop app which
/// queues them as pending file changes.
@MainActor
@Observable
final class CommentsModel {
    enum StatusFilter: Hashable { case all, none, state(String) }
    enum RepliesFilter: Hashable { case all, with, without }
    enum ExportFormat: String, CaseIterable, Identifiable {
        case csv, xfdf, fdf, md
        var id: String { rawValue }
        var title: String { self == .md ? "Markdown" : rawValue.uppercased() }
        var hintKey: String? {
            switch self {
            case .xfdf: "viewer.comments.xfdfHint"
            case .fdf: "viewer.comments.fdfHint"
            case .md: "viewer.comments.markdownHint"
            case .csv: nil
            }
        }
    }

    static let reviewStates = ["Accepted", "Rejected", "Cancelled", "Completed"]
    static let replyLimit = 5000

    @ObservationIgnored private weak var session: ViewerSession?
    private(set) var collection = CommentCollection()
    private(set) var loaded = false

    var author: String?
    var type: String?
    var status: StatusFilter = .all
    var replies: RepliesFilter = .all
    var page = ""
    var showResolved = true
    var replyingTo: String?
    var editingID: String?
    var exported: ExportedFile?

    struct ExportedFile: Identifiable {
        let id = UUID()
        let result: JobResult
    }

    init(session: ViewerSession) {
        self.session = session
    }

    static func of(_ session: ViewerSession) -> CommentsModel {
        session.service(CommentsModel.self) { CommentsModel(session: session) }
    }

    // MARK: Reading

    func reload() {
        guard let session else { return }
        collection = CommentThreads.collect(session.pdf, password: session.document.password)
        loaded = true
    }

    var entries: [CommentThreadEntry] {
        let records = collection.records
        let answered = Set(records.compactMap(\.parentID))
        let pageNumber = Int(page.trimmingCharacters(in: .whitespaces))
        return CommentThreads.threads(records) { record in
            (author == nil || record.author == author)
                && (type == nil || record.type == type)
                && (pageNumber == nil || record.pageIndex + 1 == pageNumber)
                && (showResolved || !record.resolved)
                && statusMatches(record.state)
                && (replies == .all || answered.contains(record.id) == (replies == .with))
        }
    }

    private func statusMatches(_ state: String?) -> Bool {
        switch status {
        case .all: true
        case .none: state == nil
        case .state(let wanted): state == wanted
        }
    }

    var hasActiveFilters: Bool {
        author != nil || type != nil || status != .all || replies != .all || !page.isEmpty || !showResolved
    }

    func clearFilters() {
        author = nil; type = nil; status = .all; replies = .all; page = ""; showResolved = true
    }

    func typeLabel(_ type: String) -> String {
        let key = "viewer.comments.types.\(type)"
        return L10n.shared.has(key) ? t(key) : type
    }

    func stateLabel(_ state: String?) -> String {
        state.map { t("viewer.comments.states.\($0)") } ?? t("viewer.comments.noStatus")
    }

    func record(_ id: String) -> CommentRecord? { collection.records.first { $0.id == id } }

    func reveal(_ record: CommentRecord) {
        session?.reveal(record.annotation)
    }

    // MARK: Editing

    private var authorName: String? {
        let name = AppModel.shared.authorName.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return name.isEmpty ? nil : name
    }

    func canEdit(_ record: CommentRecord) -> Bool {
        record.author.isEmpty || record.author == authorName
    }

    func reply(to record: CommentRecord, content: String) {
        let text = String(content.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.replyLimit))
        guard !text.isEmpty, let created = CommentThreads.addReply(to: record.annotation, content: text, author: authorName),
              let page = created.page else { return }
        registerRemoval([(created, page)], name: t("viewer.comments.reply"))
        replyingTo = nil
        changed()
    }

    /// Review status as a state reply (sidecar `set_state`); a legacy "Resolved" subject is cleared.
    func setState(_ state: String?, for record: CommentRecord) {
        let target = state ?? CommentThreads.cleared
        guard (record.state ?? CommentThreads.cleared) != target else { return }
        group(t("viewer.comments.status")) {
            clearLegacySubject(record)
            if let created = CommentThreads.addState(target, to: record.annotation, author: authorName), let page = created.page {
                registerRemoval([(created, page)], name: t("viewer.comments.status"))
            }
        }
        changed()
    }

    /// Mark resolved / reopen (sidecar `set_resolved`).
    func toggleResolved(_ record: CommentRecord) {
        let name = record.resolved ? t("viewer.comments.unresolve") : t("viewer.comments.resolve")
        group(name) {
            if !record.resolved {
                if let created = CommentThreads.addState(CommentThreads.completed, to: record.annotation, author: authorName), let page = created.page {
                    registerRemoval([(created, page)], name: name)
                }
            } else {
                clearLegacySubject(record)
                if hasStateReply(record), let created = CommentThreads.addState(CommentThreads.cleared, to: record.annotation, author: authorName), let page = created.page {
                    registerRemoval([(created, page)], name: name)
                }
            }
        }
        changed()
    }

    private func hasStateReply(_ record: CommentRecord) -> Bool {
        collection.nodes.contains { $0.value.parent == record.id && CommentThreads.isStateReply($0.value.annotation) }
    }

    @discardableResult
    private func clearLegacySubject(_ record: CommentRecord) -> Bool {
        let subject = record.annotation.stringValue("Subj") ?? ""
        guard subject.trimmingCharacters(in: .whitespaces).caseInsensitiveCompare(CommentThreads.legacyResolvedSubject) == .orderedSame else { return false }
        setSubject(record.annotation, "")
        let previous = subject
        session?.undoManager.registerUndo(withTarget: self) { model in
            MainActor.assumeIsolated { model.setSubject(record.annotation, previous); model.changed() }
        }
        return true
    }

    private func setSubject(_ annotation: PDFAnnotation, _ subject: String) {
        annotation.setString(subject, for: "Subj")
    }

    /// Deletes a comment with all its replies and state marks (sidecar `delete_comments`).
    func delete(_ record: CommentRecord) {
        let doomed = Set([record.id]).union(collection.descendants(of: [record.id]))
        var items: [(PDFAnnotation, PDFPage)] = []
        for name in doomed {
            guard let annotation = collection.nodes[name]?.annotation, let page = annotation.page else { continue }
            items.append((annotation, page))
            if let popup = annotation.popup, let popupPage = popup.page { items.append((popup, popupPage)) }
        }
        remove(items, name: t("viewer.comments.delete"))
        if replyingTo == record.id { replyingTo = nil }
        changed()
    }

    func edit(_ record: CommentRecord, content: String) {
        let previous = record.annotation.contents ?? ""
        let previousDate = record.annotation.modificationDate
        guard previous != content else { editingID = nil; return }
        apply(content: content, date: Date(), to: record.annotation)
        session?.undoManager.registerUndo(withTarget: self) { model in
            MainActor.assumeIsolated {
                model.apply(content: previous, date: previousDate, to: record.annotation)
                model.changed()
            }
        }
        session?.undoManager.setActionName(t("ios.viewer.comments.edit"))
        editingID = nil
        changed()
    }

    private func apply(content: String, date: Date?, to annotation: PDFAnnotation) {
        annotation.contents = content
        annotation.modificationDate = date
    }

    // MARK: Import / export

    func importComments(from url: URL) {
        guard let session else { return }
        do {
            let data = try withSecurityScope(url) { try Data(contentsOf: url) }
            let result = try CommentExchange.importFile(data, into: session.pdf)
            let items = result.imported.compactMap { annotation in annotation.page.map { (annotation, $0) } }
            registerRemoval(items, name: t("viewer.comments.import"))
            changed()
            var message = t("viewer.comments.imported", ["count": result.imported.count])
            if result.duplicates > 0 { message += " · " + t("viewer.comments.importedDuplicates", ["count": result.duplicates]) }
            session.showMessage(message)
        } catch {
            session.showError(error)
        }
    }

    func export(_ format: ExportFormat) {
        guard let session else { return }
        reload()
        let records = collection.records.filter { showResolved || !$0.resolved }
        let target = Workspace.output(for: session.document.url, suffix: t("viewer.comments.suffix"), ext: format.rawValue)
        do {
            let count: Int
            switch format {
            case .xfdf:
                let (names, counted) = CommentExchange.exportNames(records, collection: collection)
                let data = try CommentExchange.exportXFDF(session.pdf, names: names, sourceName: session.document.fileName, password: session.document.password)
                try data.write(to: target, options: .atomic)
                count = counted
            case .fdf:
                let (names, counted) = CommentExchange.exportNames(records, collection: collection)
                _ = try CommentFDF.export(session.pdf, names: names, sourceName: session.document.fileName, to: target)
                count = counted
            case .md:
                let text = CommentExchange.markdown(name: session.document.fileName, records: records,
                                                    pageLabel: t("viewer.comments.summaryPage"), typeLabel: typeLabel,
                                                    labels: { session.label(ofPage: $0) })
                try Data(text.utf8).write(to: target, options: .atomic)
                count = records.count
            case .csv:
                try CommentExchange.csv(records: records, typeLabel: typeLabel).write(to: target, options: .atomic)
                count = records.count
            }
            exported = ExportedFile(result: JobResult(outputs: [target], summary: t("viewer.comments.exported", ["count": count])))
        } catch {
            session.showError(error)
        }
    }

    // MARK: Undo plumbing

    private func group(_ name: String, _ body: () -> Void) {
        guard let manager = session?.undoManager else { body(); return }
        manager.beginUndoGrouping()
        body()
        manager.setActionName(name)
        manager.endUndoGrouping()
    }

    /// Records that `items` were just added, so undo removes them.
    private func registerRemoval(_ items: [(PDFAnnotation, PDFPage)], name: String) {
        guard !items.isEmpty else { return }
        session?.undoManager.registerUndo(withTarget: self) { model in
            MainActor.assumeIsolated { model.remove(items, name: name); model.changed() }
        }
        session?.undoManager.setActionName(name)
    }

    private func remove(_ items: [(PDFAnnotation, PDFPage)], name: String) {
        for (annotation, page) in items { page.removeAnnotation(annotation) }
        session?.undoManager.registerUndo(withTarget: self) { model in
            MainActor.assumeIsolated { model.add(items, name: name); model.changed() }
        }
        session?.undoManager.setActionName(name)
    }

    private func add(_ items: [(PDFAnnotation, PDFPage)], name: String) {
        for (annotation, page) in items { page.addAnnotation(annotation) }
        registerRemoval(items, name: name)
    }

    private func changed() {
        session?.markEdited()
        reload()
    }
}
