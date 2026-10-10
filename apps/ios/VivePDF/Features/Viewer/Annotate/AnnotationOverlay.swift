import PDFKit
import SwiftUI
import UIKit

/// Place over the main page canvas (same frame). Attaches the annotate touch handling to the live
/// `PDFView`, shows the floating menu for selected marks (desktop `AnnotationSelectionMenu`) and the
/// text / link sheets. Lets every other touch through to the pages.
struct AnnotationOverlay: View {
    let session: ViewerSession

    init(session: ViewerSession) {
        self.session = session
    }

    var body: some View {
        let controller = AnnotationController.of(session)
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                Color.clear.allowsHitTesting(false)
                if let frame = controller.selectionFrame, !controller.selected.isEmpty, !controller.dragging {
                    AnnotationSelectionMenu(session: session, controller: controller)
                        .fixedSize()
                        .position(menuPosition(for: frame, in: proxy.size))
                        .transition(.opacity)
                }
            }
        }
        .task(id: ObjectIdentifier(session.pdf)) {
            // The canvas publishes its view on its first layout pass; wait briefly for it.
            for _ in 0..<40 {
                if session.pdfView != nil { break }
                try? await Task.sleep(for: .milliseconds(50))
            }
            controller.attach()
        }
        .onAppear { controller.attach() }
        .onChange(of: session.showsAnnotate) { _, shown in
            if !shown { controller.disarm() }
        }
        .sheet(item: Binding(get: { controller.textEditing }, set: { if $0 == nil { controller.textEditing = nil } })) { editing in
            AnnotateTextSheet(editing: editing) { text in controller.finishTextEditing(editing, text: text) }
        }
        .sheet(item: Binding(get: { controller.linkDraft }, set: { controller.linkDraft = $0 })) { draft in
            AnnotateLinkSheet(pageCount: session.pageCount) { url, page in
                controller.addLink(on: draft.page, rect: draft.rect, url: url, pageIndex: page)
            }
        }
    }

    private func menuPosition(for frame: CGRect, in size: CGSize) -> CGPoint {
        let halfWidth: CGFloat = 110
        let x = min(max(frame.midX, halfWidth), max(halfWidth, size.width - halfWidth))
        let above = frame.minY - 34
        let y = above > 40 ? above : min(frame.maxY + 34, size.height - 30)
        return CGPoint(x: x, y: y)
    }
}

/// Floating actions for the selected mark(s): link target, note, edit text, delete.
private struct AnnotationSelectionMenu: View {
    let session: ViewerSession
    let controller: AnnotationController
    @Environment(\.openURL) private var openURL
    @State private var noteOpen = false

    private var single: PDFAnnotation? { controller.selected.count == 1 ? controller.selected.first : nil }

    private var linkURL: URL? {
        guard let single, AnnotationKind.of(single) == "Link" else { return nil }
        let url = single.url ?? (single.action as? PDFActionURL)?.url
        guard let url, let scheme = url.scheme?.lowercased(), ["http", "https", "mailto", "tel"].contains(scheme) else { return nil }
        return url
    }

    private var linkPage: PDFPage? {
        guard let single, AnnotationKind.of(single) == "Link" else { return nil }
        return single.destination?.page ?? (single.action as? PDFActionGoTo)?.destination.page
    }

    var body: some View {
        HStack(spacing: 0) {
            if let linkURL {
                Text(linkURL.absoluteString)
                    .font(.caption)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: 180)
                    .padding(.horizontal, 8)
                item("arrow.up.right.square", t("viewer.link.open")) { openURL(linkURL) }
            }
            if let linkPage {
                let index = session.pdf.index(for: linkPage)
                item("arrow.turn.down.right", t("viewer.link.goToPage", ["page": session.label(ofPage: index)])) {
                    controller.deselect()
                    session.go(toPage: index)
                }
            }
            if let single {
                let kind = AnnotationKind.of(single)
                if kind == "FreeText" || kind == "Text" {
                    item("pencil", t("annotate.freeText")) {
                        guard let page = single.page else { return }
                        controller.textEditing = AnnotationController.TextEditing(annotation: single, page: page, isNew: false)
                    }
                }
                if kind != "Text" && kind != "FreeText" {
                    item(single.contents?.isEmpty == false ? "note.text" : "note.text.badge.plus", t("annotate.note")) { noteOpen = true }
                        .popover(isPresented: $noteOpen) {
                            AnnotateNoteEditor(annotation: single, controller: controller)
                                .presentationCompactAdaptation(.popover)
                        }
                }
            }
            item("trash", t("common.delete"), role: .destructive) { controller.deleteSelected() }
        }
        .padding(.horizontal, 4)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.border))
        .shadow(color: .black.opacity(0.15), radius: 8, y: 3)
    }

    private func item(_ symbol: String, _ label: String, role: ButtonRole? = nil, action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            Image(systemName: symbol)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(role == .destructive ? Palette.destructive : Palette.foreground)
        .accessibilityLabel(label)
        .help(label)
    }
}

/// Note attached to a mark (`contents`), saved when the popover closes.
private struct AnnotateNoteEditor: View {
    let annotation: PDFAnnotation
    let controller: AnnotationController
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(t("annotate.note")).font(.headline)
            TextField(t("annotate.notePlaceholder"), text: $draft, axis: .vertical)
                .lineLimit(3...8)
                .textFieldStyle(.roundedBorder)
        }
        .padding()
        .frame(minWidth: 260, idealWidth: 320)
        .onAppear { draft = annotation.contents ?? "" }
        .onDisappear {
            guard draft != (annotation.contents ?? "") else { return }
            controller.modify(annotation) { $0.contents = draft }
        }
    }
}

/// Text of a free text box or sticky note.
private struct AnnotateTextSheet: View {
    let editing: AnnotationController.TextEditing
    let onFinish: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var finished = false
    @FocusState private var focused: Bool

    private var isNote: Bool { AnnotationKind.of(editing.annotation) == "Text" }

    var body: some View {
        NavigationStack {
            TextField(isNote ? t("annotate.notePlaceholder") : t("annotate.textPlaceholder"), text: $text, axis: .vertical)
                .lineLimit(4...20)
                .focused($focused)
                .padding()
                .frame(maxHeight: .infinity, alignment: .top)
                .navigationTitle(isNote ? t("viewer.comments.types.Text") : t("annotate.freeText"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(t("common.cancel")) { finish(nil) }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(t("ios.viewer.annotate.done")) { finish(text) }
                    }
                }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            let current = editing.annotation.contents ?? ""
            text = editing.isNew || current == t("annotate.textPlaceholder") ? "" : current
            focused = true
        }
        .onDisappear { if !finished { onFinish(text) } }
    }

    private func finish(_ value: String?) {
        finished = true
        onFinish(value)
        dismiss()
    }
}

/// Target of a new link: a web address or a page number (desktop `viewer.overlay.link*`).
private struct AnnotateLinkSheet: View {
    let pageCount: Int
    let onAdd: (URL?, Int?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var page = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(t("viewer.overlay.linkTarget")) {
                    TextField(t("viewer.overlay.linkUrl"), text: $address)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    Text(t("viewer.overlay.linkOr")).font(.footnote).foregroundStyle(Palette.mutedForeground)
                    TextField(t("viewer.overlay.linkPage"), text: $page)
                        .keyboardType(.numberPad)
                }
                if let error {
                    Text(error).foregroundStyle(Palette.destructive).font(.footnote)
                }
            }
            .navigationTitle(t("viewer.overlay.link"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("viewer.overlay.linkAdd"), action: add)
                        .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty && page.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func add() {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            guard let url = Self.webURL(trimmed) else {
                error = t("viewer.link.invalidUrl")
                return
            }
            onAdd(url, nil)
            dismiss()
            return
        }
        guard let number = Int(page.trimmingCharacters(in: .whitespaces)), number >= 1, number <= pageCount else {
            error = t("tools.outOfRange", ["min": 1, "max": pageCount])
            return
        }
        onAdd(nil, number - 1)
        dismiss()
    }

    /// Accepts http(s) addresses; a bare host ("example.com") gets https:// like a browser would.
    static func webURL(_ text: String) -> URL? {
        let candidate = text.contains("://") ? text : "https://\(text)"
        guard let url = URL(string: candidate), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = url.host, host.contains(".") || host == "localhost" else { return nil }
        return url
    }
}
