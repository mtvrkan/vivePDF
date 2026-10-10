import PDFKit
import SwiftUI

/// The PDF viewer (desktop `ViewerPage`): document tabs, the page canvas with its panels and bars, or an empty
/// state with "Open PDF" and recent files. Lives in a NavigationStack (compact tab) or the split view detail.
struct ViewerView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var closer = ViewerCloser()

    var body: some View {
        Group {
            if let document = app.documents.active {
                ViewerDocumentView(session: ViewerSessions.shared.session(for: document), closer: closer)
                    .id(document.id)
            } else {
                ViewerEmptyState()
                    .navigationTitle(t("nav.viewer"))
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
        .onChange(of: app.documents.documents.map(\.id)) { _, _ in
            ViewerSessions.shared.prune(keeping: app.documents.documents).forEach(ViewerModules.teardown)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .background else { return }
            // Remember reading positions (desktop ReadingPositionTracker) and autosave if the reader asked for it.
            for document in app.documents.documents {
                app.documents.remember(document)
                if UserDefaults.standard.bool(forKey: ViewerCloser.autosaveKey), document.isDirty {
                    ViewerSessions.shared.session(for: document).save()
                }
            }
        }
        .modifier(UnsavedCloseDialog(closer: closer))
    }
}

/// Closing tabs with unsaved changes asks Save / Discard / Cancel one document at a time
/// (desktop `UnsavedCloseDialog` + `useCloseDocuments`).
@MainActor
@Observable
final class ViewerCloser {
    static let autosaveKey = "vivepdf.viewer.autosave"
    var queue: [OpenDocument] = []
    var current: OpenDocument? { queue.first }

    func close(_ documents: [OpenDocument], in store: DocumentStore) {
        for document in documents {
            if document.isDirty {
                if !queue.contains(document) { queue.append(document) }
            } else {
                ViewerSessions.shared.existing(for: document)?.undoManager.removeAllActions()
                store.close(document)
            }
        }
    }

    func saveAndClose(in store: DocumentStore) {
        guard let document = current else { return }
        let saved = ViewerSessions.shared.session(for: document).save()
        guard saved else { return }
        store.close(document)
        queue.removeFirst()
    }

    func discardAndClose(in store: DocumentStore) {
        guard let document = current else { return }
        document.isDirty = false
        store.close(document)
        queue.removeFirst()
    }

    func cancel() { queue.removeAll() }
}

private struct UnsavedCloseDialog: ViewModifier {
    let closer: ViewerCloser
    @Environment(AppModel.self) private var app

    func body(content: Content) -> some View {
        content.alert(t("viewer.unsavedClose.title"), isPresented: Binding(get: { closer.current != nil }, set: { if !$0 && closer.current != nil { closer.cancel() } }), presenting: closer.current) { _ in
            Button(t("viewer.unsavedClose.save")) { closer.saveAndClose(in: app.documents) }
            Button(t("viewer.unsavedClose.discard"), role: .destructive) { closer.discardAndClose(in: app.documents) }
            Button(t("common.cancel"), role: .cancel) { closer.cancel() }
        } message: { document in
            let more = closer.queue.count > 1 ? "\n" + t("viewer.unsavedClose.more", ["count": closer.queue.count - 1]) : ""
            Text(t("viewer.unsavedClose.description", ["name": document.fileName]) + more)
        }
    }
}

// MARK: - Empty state

/// No open document: open button, what the viewer can do, recent files (desktop `DocumentEmptyState`).
struct ViewerEmptyState: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var recents: [RecentDocument] { Array(app.documents.recents.prefix(sizeClass == .compact ? 5 : 8)) }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                hero
                highlights
                if !recents.isEmpty { recentList }
            }
            .frame(maxWidth: 640)
            .padding(.horizontal, sizeClass == .compact ? 16 : 32)
            .padding(.vertical, 28)
            .frame(maxWidth: .infinity)
        }
        .background(AmbientBackground())
    }

    private var hero: some View {
        VStack(spacing: 14) {
            Image(systemName: "doc.richtext")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Palette.primary)
                .frame(width: 72, height: 72)
                .background(Palette.accent, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            Text(t("emptyDoc.eyebrow").uppercased())
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.mutedForeground)
            Text(t("viewer.empty.title")).font(.title2.bold()).multilineTextAlignment(.center)
            Text(t("viewer.empty.description"))
                .font(.callout)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button { app.showOpenPicker = true } label: {
                Label(t("common.openPdf"), systemImage: "folder")
                    .font(.headline)
                    .frame(minWidth: 180, minHeight: 30)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut("o", modifiers: .command)
        }
        .frame(maxWidth: .infinity)
        .card(padding: 24)
    }

    private var highlights: some View {
        let items: [(String, String)] = [
            ("magnifyingglass", t("viewer.empty.highlights.search")),
            ("highlighter", t("viewer.empty.highlights.annotate")),
            ("play.rectangle", t("viewer.empty.highlights.present").replacingOccurrences(of: " (F11)", with: "")),
        ]
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            ForEach(items, id: \.1) { item in
                Button { app.showOpenPicker = true } label: {
                    HStack(spacing: 10) {
                        Image(systemName: item.0)
                            .foregroundStyle(Palette.primary)
                            .frame(width: 34, height: 34)
                            .background(Palette.accent, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                        Text(item.1).font(.subheadline.weight(.medium)).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .background(Palette.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.border))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var recentList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(t("home.recent")).font(.headline)
            VStack(spacing: 0) {
                ForEach(recents) { recent in
                    Button {
                        if let url = recent.resolve() { app.open(url) } else { app.documents.forget(recent) }
                    } label: {
                        HStack(spacing: 12) {
                            FileIcon(url: URL(fileURLWithPath: recent.path), size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(recent.name).font(.subheadline.weight(.semibold)).lineLimit(1).truncationMode(.middle)
                                Text(recentDetail(recent)).font(.caption).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                            }
                            Spacer(minLength: 4)
                            if recent.pinned { Image(systemName: "pin.fill").font(.caption).foregroundStyle(Palette.mutedForeground) }
                            Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: 56)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button { app.documents.togglePin(recent) } label: { Label(t(recent.pinned ? "ios.viewer.unpin" : "ios.viewer.pin"), systemImage: recent.pinned ? "pin.slash" : "pin") }
                        Button(role: .destructive) { app.documents.forget(recent) } label: { Label(t("search.removeHistory"), systemImage: "minus.circle") }
                    }
                    if recent.id != recents.last?.id { Divider().padding(.leading, 62) }
                }
            }
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.border))
        }
    }

    private func recentDetail(_ recent: RecentDocument) -> String {
        var parts: [String] = []
        if recent.pageCount > 0 { parts.append(t("viewer.reading.page", ["page": recent.lastPage + 1]) + " / \(recent.pageCount)") }
        parts.append(recent.openedAt.formatted(.relative(presentation: .named)))
        return parts.joined(separator: " · ")
    }
}

// MARK: - Document tabs

/// Open documents as tabs (desktop `DocumentTabs`). Wide windows show a tab strip; the title menu offers the
/// same switching and closing on every width.
struct ViewerTabStrip: View {
    let closer: ViewerCloser
    @Environment(AppModel.self) private var app

    var body: some View {
        let documents = app.documents.documents
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(documents) { document in
                        tab(document).id(document.id)
                    }
                    Button { app.showOpenPicker = true } label: {
                        Image(systemName: "plus").frame(width: 36, height: 36).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(t("common.openPdf"))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
            }
            .onChange(of: app.documents.activeID) { _, id in withAnimation { proxy.scrollTo(id) } }
        }
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("viewer.tabs"))
    }

    private func tab(_ document: OpenDocument) -> some View {
        let active = document.id == app.documents.active?.id
        return HStack(spacing: 6) {
            if document.isDirty {
                Circle().fill(Palette.primary).frame(width: 7, height: 7).accessibilityLabel(t("viewer.pending.unsaved"))
            }
            Text(document.fileName)
                .font(.subheadline.weight(active ? .semibold : .regular))
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 200)
            Button { closer.close([document], in: app.documents) } label: {
                Image(systemName: "xmark").font(.caption2.weight(.bold)).frame(width: 24, height: 24).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("\(t("common.close")): \(document.fileName)")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .frame(minHeight: 36)
        .background(active ? Palette.accent : Color(.tertiarySystemFill), in: Capsule())
        .overlay(Capsule().strokeBorder(active ? Palette.primary.opacity(0.4) : .clear))
        .contentShape(Capsule())
        .onTapGesture { app.documents.activeID = document.id }
        .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
        .contextMenu { ViewerTabMenu(document: document, closer: closer) }
    }
}

/// Per-tab actions (desktop tab context menu).
struct ViewerTabMenu: View {
    let document: OpenDocument
    let closer: ViewerCloser
    @Environment(AppModel.self) private var app

    var body: some View {
        Button { closer.close([document], in: app.documents) } label: { Label(t("common.close"), systemImage: "xmark") }
        Button { closer.close(app.documents.documents.filter { $0.id != document.id }, in: app.documents) } label: { Label(t("viewer.context.closeOthers"), systemImage: "xmark.square") }
            .disabled(app.documents.documents.count < 2)
        Button { closer.close(app.documents.documents, in: app.documents) } label: { Label(t("viewer.context.closeAll"), systemImage: "xmark.rectangle") }
        Divider()
        if let active = app.documents.active, active.id != document.id {
            Button {
                let session = ViewerSessions.shared.session(for: active)
                session.splitURL = document.url
                session.splitActive = true
            } label: { Label(t("viewer.split.openBeside"), systemImage: "rectangle.split.2x1") }
        }
        Button { UIPasteboard.general.string = document.fileName } label: { Label(t("viewer.context.copyFileName"), systemImage: "doc.on.doc") }
        Button { UIPasteboard.general.string = document.url.path } label: { Label(t("viewer.context.copyPath"), systemImage: "folder") }
    }
}
