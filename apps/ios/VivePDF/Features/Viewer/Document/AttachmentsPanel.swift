import PDFKit
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

/// Files embedded in the PDF (desktop `AttachmentsPanel`): open, share, save, extract all, add, remove.
struct AttachmentsPanel: View {
    let session: ViewerSession

    @State private var items: [PDFAttachmentInfo]?
    @State private var failed = false
    @State private var busy = false
    @State private var preview: URL?
    @State private var previewItems: [URL] = []
    @State private var shared: SharedFile?
    @State private var exportURL: URL?
    @State private var exporting = false
    @State private var importing = false
    @State private var pendingDelete: PDFAttachmentInfo?

    init(session: ViewerSession) {
        self.session = session
    }

    var body: some View {
        List {
            if let items {
                if items.isEmpty {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Label(t("viewer.attachments.empty"), systemImage: "paperclip").font(.headline)
                            Text(t("viewer.attachments.hint")).font(.callout).foregroundStyle(Palette.mutedForeground)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 6)
                    }
                } else {
                    Section {
                        ForEach(items) { item in row(item) }
                    } header: {
                        Text(t("viewer.attachments.count", ["count": items.count]))
                    }
                }
            } else if failed {
                Section {
                    Label(t("errors.INVALID_PDF"), systemImage: "exclamationmark.triangle").foregroundStyle(Palette.destructive)
                    Button(t("common.retry")) { Task { await load() } }
                }
            } else {
                Section { HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 12) }
            }
            Section {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { addButton; extractAllButton }
                    VStack(alignment: .leading, spacing: 10) { addButton; extractAllButton }
                }
                .buttonStyle(.bordered)
                .disabled(busy)
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    if !AttachmentEngine.canWrite {
                        PanelFootnote(text: t("ios.viewer.document.attachmentsReadOnly"), symbol: "info.circle")
                    } else if session.document.isDirty {
                        PanelFootnote(text: t("ios.viewer.document.saveBeforeAttach"), symbol: "info.circle")
                    }
                }
                .padding(.top, 4)
            }
        }
        .listStyle(.insetGrouped)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await load() } } label: { Label(t("viewer.comments.refresh"), systemImage: "arrow.clockwise") }
                    .disabled(busy)
            }
        }
        .task(id: DocumentReloadKey(session)) { await load() }
        .quickLookPreview($preview, in: previewItems)
        .sheet(item: $shared) { file in DocumentActivitySheet(items: [file.url]).presentationDetents([.medium, .large]) }
        .fileMover(isPresented: $exporting, file: exportURL) { _ in }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await add(urls) } }
        }
        .confirmationDialog(t("viewer.attachments.delete"), isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible, presenting: pendingDelete) { item in
            Button(t("viewer.attachments.delete"), role: .destructive) { Task { await remove(item) } }
            Button(t("common.cancel"), role: .cancel) {}
        } message: { item in
            Text(t("viewer.attachments.deleteConfirm", ["name": item.fileName]))
        }
    }

    // MARK: - Rows

    private func row(_ item: PDFAttachmentInfo) -> some View {
        Button { Task { await open(item) } } label: {
            HStack(spacing: 12) {
                FileIcon(url: URL(fileURLWithPath: item.fileName), size: 36)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.fileName).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.foreground)
                        .lineLimit(2).truncationMode(.middle)
                    Text(subtitle(item)).font(.caption).foregroundStyle(Palette.mutedForeground)
                    if let description = item.description {
                        Text(description).font(.caption).foregroundStyle(Palette.mutedForeground).lineLimit(3)
                    }
                }
                Spacer(minLength: 4)
                actionsMenu(item)
            }
            .contentShape(Rectangle())
            .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .contextMenu { actions(item) }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if AttachmentEngine.canWrite, item.kind == .embedded {
                Button(role: .destructive) { pendingDelete = item } label: { Label(t("viewer.attachments.delete"), systemImage: "trash") }
            }
            Button { Task { await share(item) } } label: { Label(t("ios.common.share"), systemImage: "square.and.arrow.up") }
                .tint(Palette.primary)
        }
    }

    private func actionsMenu(_ item: PDFAttachmentInfo) -> some View {
        Menu { actions(item) } label: {
            Image(systemName: "ellipsis.circle").font(.title3).frame(width: 44, height: 44)
        }
        .accessibilityLabel(t("viewer.context.title"))
    }

    @ViewBuilder private func actions(_ item: PDFAttachmentInfo) -> some View {
        Button { Task { await open(item) } } label: { Label(t("ios.common.preview"), systemImage: "eye") }
        Button { Task { await share(item) } } label: { Label(t("ios.common.share"), systemImage: "square.and.arrow.up") }
        Button { Task { await saveToFiles(item) } } label: { Label(t("ios.common.saveToFiles"), systemImage: "folder") }
        Button { Task { await extract([item]) } } label: { Label(t("viewer.attachments.extract"), systemImage: "square.and.arrow.down") }
        if let page = item.pageIndex {
            Button { session.go(toPage: page) } label: { Label(t("viewer.link.goToPage", ["page": session.label(ofPage: page)]), systemImage: "arrow.turn.down.right") }
        }
        if AttachmentEngine.canWrite, item.kind == .embedded {
            Divider()
            Button(role: .destructive) { pendingDelete = item } label: { Label(t("viewer.attachments.delete"), systemImage: "trash") }
        }
    }

    private var addButton: some View {
        Button { importing = true } label: { Label(t("viewer.attachments.add"), systemImage: "plus") }
            .disabled(!AttachmentEngine.canWrite || session.document.isDirty)
    }

    private var extractAllButton: some View {
        Button { Task { await extract(items ?? []) } } label: { Label(t("viewer.attachments.extractAll"), systemImage: "square.and.arrow.down.on.square") }
            .disabled((items ?? []).isEmpty)
    }

    private func subtitle(_ item: PDFAttachmentInfo) -> String {
        var parts = [Workspace.formatBytes(item.size)]
        if let page = item.pageIndex { parts.append(t("viewer.comments.pageShort", ["page": session.label(ofPage: page)])) }
        if let modified = item.modified ?? item.created { parts.append(DocumentFormat.date(modified)) }
        return parts.joined(separator: " · ")
    }

    // MARK: - Actions

    private func load() async {
        guard let document = session.pdf.documentRef else { failed = true; return }
        let list = await Task.detached(priority: .userInitiated) { AttachmentEngine.list(in: document) }.value
        items = list
        failed = false
    }

    /// Writes one attachment to a private scratch file (for Quick Look, sharing and Files).
    private func materialize(_ item: PDFAttachmentInfo) async -> URL? {
        guard let document = session.pdf.documentRef else { return nil }
        busy = true
        defer { busy = false }
        do {
            return try await Task.detached(priority: .userInitiated) {
                try AttachmentEngine.extract([item], from: document, to: Workspace.scratch()).first
            }.value
        } catch {
            session.show(ViewerToast(text: t("viewer.attachments.missing"), symbol: "exclamationmark.triangle.fill", isError: true))
            return nil
        }
    }

    private func open(_ item: PDFAttachmentInfo) async {
        guard let url = await materialize(item) else { return }
        if url.pathExtension.lowercased() == "pdf" {
            // PDFs open as a viewer tab, like opening any other document.
            AppModel.shared.open(url)
            return
        }
        previewItems = [url]
        preview = url
    }

    private func share(_ item: PDFAttachmentInfo) async {
        guard let url = await materialize(item) else { return }
        shared = SharedFile(url: url)
    }

    private func saveToFiles(_ item: PDFAttachmentInfo) async {
        guard let url = await materialize(item) else { return }
        exportURL = url
        exporting = true
    }

    private func extract(_ selection: [PDFAttachmentInfo]) async {
        guard !selection.isEmpty, let document = session.pdf.documentRef else { return }
        busy = true
        defer { busy = false }
        let source = session.document.url
        do {
            let outputs = try await Task.detached(priority: .userInitiated) {
                try AttachmentEngine.extract(selection, from: document, to: Workspace.outputDirectory(for: source, suffix: "attachments"))
            }.value
            session.show(ViewerToast(text: t("viewer.attachments.extracted", ["count": outputs.count]), symbol: "square.and.arrow.down"))
        } catch {
            session.showError(error)
        }
    }

    private func add(_ urls: [URL]) async {
        guard AttachmentEngine.canWrite, !urls.isEmpty else { return }
        for url in urls {
            let size = withSecurityScope(url) { Workspace.fileSize(url) }
            if size > AttachmentEngine.maxBytes {
                session.show(ViewerToast(text: t("viewer.attachments.tooLarge"), symbol: "exclamationmark.triangle.fill", isError: true))
                return
            }
        }
        await rewrite { source in try AttachmentEngine.add(urls, to: source) }
    }

    private func remove(_ item: PDFAttachmentInfo) async {
        await rewrite { source in try AttachmentEngine.remove([item.name], from: source) }
    }

    /// Rewrites the file on disk (attachments live outside PDFKit's model) and reloads the view.
    private func rewrite(_ body: @escaping @Sendable (URL) throws -> URL) async {
        guard !session.document.isDirty else {
            session.show(ViewerToast(text: t("ios.viewer.document.saveBeforeAttach"), symbol: "exclamationmark.triangle.fill", isError: true))
            return
        }
        busy = true
        defer { busy = false }
        let source = session.document.url
        let page = session.currentPageIndex
        do {
            let output = try await Task.detached(priority: .userInitiated) { try withSecurityScope(source) { try body(source) } }.value
            try session.document.replaceFile(with: output)
            session.refresh()
            session.restorePosition(page)
        } catch {
            session.showError(error)
        }
    }
}
