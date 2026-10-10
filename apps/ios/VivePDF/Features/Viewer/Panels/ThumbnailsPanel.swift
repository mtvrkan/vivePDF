import PDFKit
import SwiftUI

/// Page thumbnails (desktop `ThumbnailSidebar`): tap to go to a page, long-press for page actions.
/// Reordering by drag lives in the Pages organizer.
struct ViewerThumbnailsPanel: View {
    let session: ViewerSession
    @State private var shareURL: URL?
    @State private var bookmarkPage: Int?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 116, maximum: 220), spacing: 14)], spacing: 16) {
                    ForEach(0..<session.pageCount, id: \.self) { index in
                        cell(index).id(index)
                    }
                }
                .padding(14)
            }
            .onAppear { proxy.scrollTo(session.currentPageIndex, anchor: .center) }
            .onChange(of: session.currentPageIndex) { _, index in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(index, anchor: .center) }
            }
        }
        .viewerShareSheet(url: $shareURL)
        .modifier(ViewerBookmarkPrompt(session: session, page: $bookmarkPage))
    }

    private func cell(_ index: Int) -> some View {
        let active = index == session.currentPageIndex
        return Button { session.go(toPage: index) } label: {
            VStack(spacing: 6) {
                ViewerPageThumbnail(page: session.pdf.page(at: index), revision: session.revision)
                    .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(active ? Palette.primary : .clear, lineWidth: 2.5))
                Text(session.label(ofPage: index))
                    .font(.caption.monospacedDigit().weight(active ? .bold : .regular))
                    .foregroundStyle(active ? Palette.primary : .secondary)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(t("viewer.reading.page", ["page": index + 1]))
        .accessibilityAddTraits(active ? .isSelected : [])
        .contextMenu {
            ViewerPageMenuItems(session: session, pageIndex: index, shareURL: $shareURL, bookmarkPage: $bookmarkPage)
        } preview: {
            ViewerPageThumbnail(page: session.pdf.page(at: index), revision: session.revision, width: 320)
        }
    }
}

/// Thumbnail that re-renders when the page changes (rotation, new marks), unlike the Core `PageThumbnail`.
struct ViewerPageThumbnail: View {
    let page: PDFPage?
    var revision = 0
    var width: CGFloat = 150
    @State private var image: UIImage?
    @Environment(\.displayScale) private var scale

    private var aspect: CGFloat {
        let bounds = page?.bounds(for: .cropBox) ?? CGRect(x: 0, y: 0, width: 595, height: 842)
        let rotated = (page?.rotation ?? 0) % 180 != 0
        return rotated ? bounds.width / max(bounds.height, 1) : bounds.height / max(bounds.width, 1)
    }

    var body: some View {
        Color.white
            .aspectRatio(1 / aspect, contentMode: .fit)
            .frame(maxWidth: width)
            .overlay {
                if let image { Image(uiImage: image).resizable().scaledToFit() } else { ProgressView().controlSize(.small) }
            }
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
            .task(id: "\(page.map { ObjectIdentifier($0).hashValue } ?? 0)-\(revision)-\(page?.rotation ?? 0)") {
                guard let page else { return }
                let target = CGSize(width: width * scale, height: width * aspect * scale)
                image = page.thumbnail(of: target, for: .cropBox)
            }
    }
}

extension View {
    /// Presents the share sheet for a produced file while `url` is set.
    func viewerShareSheet(url: Binding<URL?>) -> some View {
        sheet(isPresented: Binding(get: { url.wrappedValue != nil }, set: { if !$0 { url.wrappedValue = nil } })) {
            if let file = url.wrappedValue { ViewerShareSheet(items: [file]).presentationDetents([.medium, .large]) }
        }
    }
}

/// System share sheet (for files produced by page actions).
struct ViewerShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// "Add bookmark here" prompt: name defaults to the selected text or "Page N" (desktop `addBookmarkTitle`).
struct ViewerBookmarkPrompt: ViewModifier {
    let session: ViewerSession
    @Binding var page: Int?
    @State private var title = ""

    func body(content: Content) -> some View {
        content.alert(t("viewer.context.addBookmarkTitle", ["page": (page ?? 0) + 1]), isPresented: Binding(get: { page != nil }, set: { if !$0 { page = nil } })) {
            TextField(t("viewer.context.bookmarkName"), text: $title)
            Button(t("common.cancel"), role: .cancel) { page = nil }
            Button(t("viewer.context.addBookmarkConfirm")) {
                if let page {
                    let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
                    ViewerPageActions.addBookmark(session, title: name.isEmpty ? t("viewer.context.bookmarkDefaultTitle", ["page": page + 1]) : name, page: page)
                }
                page = nil
            }
        } message: {
            Text(t("viewer.context.addBookmarkHint"))
        }
        .onChange(of: page) { _, value in
            guard let value else { return }
            let selected = ViewerText.bookmarkTitle(from: session.selectedText)
            title = selected.isEmpty ? t("viewer.context.bookmarkDefaultTitle", ["page": value + 1]) : selected
        }
    }
}
