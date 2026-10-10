import PDFKit
import SwiftUI

/// Sheets and prompts of the viewer: go to page, external link confirmation, link preview, print, OCR.
struct ViewerModals: ViewModifier {
    @Bindable var session: ViewerSession
    @Binding var goToPageText: String
    @Environment(\.openURL) private var openURL

    func body(content: Content) -> some View {
        content
            .alert(t("viewer.context.goToPagePrompt"), isPresented: $session.showGoToPage) {
                TextField(t("viewer.pageNumber"), text: $goToPageText)
                    .keyboardType(.numbersAndPunctuation)
                Button(t("common.cancel"), role: .cancel) {}
                Button(t("viewer.context.goToPagePrompt")) {
                    if let index = session.pageIndex(fromInput: goToPageText) { session.go(toPage: index) }
                }
            } message: {
                Text("1 – \(session.pageCount)")
            }
            .onChange(of: session.showGoToPage) { _, shown in if shown { goToPageText = session.label(ofPage: session.currentPageIndex) } }
            .confirmationDialog(t("viewer.link.open"), isPresented: Binding(get: { session.linkPrompt != nil }, set: { if !$0 { session.linkPrompt = nil } }), titleVisibility: .visible, presenting: session.linkPrompt) { url in
                Button(t("viewer.link.open")) { open(url) }
                Button(t("viewer.selection.copy")) { UIPasteboard.general.url = url; session.showMessage(t("viewer.selection.copied")) }
                Button(t("common.cancel"), role: .cancel) {}
            } message: { url in
                Text(url.absoluteString)
            }
            .sheet(isPresented: Binding(get: { session.linkPreview != nil }, set: { if !$0 { session.linkPreview = nil } })) {
                if let link = session.linkPreview {
                    ViewerLinkPreview(session: session, link: link) { url in open(url) }
                        .presentationDetents([.medium])
                }
            }
            .sheet(isPresented: $session.showPrint) {
                ViewerModules.printSheet(session: session, initialPage: session.printPageIndex)
            }
            .sheet(isPresented: Binding(get: { session.makeSearchablePage != nil }, set: { if !$0 { session.makeSearchablePage = nil } })) {
                if let target = session.makeSearchablePage {
                    ViewerModules.makeSearchable(session: session, pageIndex: target)
                }
            }
    }

    private func open(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto", "tel"].contains(scheme) else {
            session.show(ViewerToast(text: t("viewer.link.openFailed"), symbol: "exclamationmark.triangle.fill", isError: true))
            return
        }
        openURL(url)
    }
}

/// Where a link leads (desktop `LinkPreview`): page preview with "Go to page", or the web address.
struct ViewerLinkPreview: View {
    let session: ViewerSession
    let link: PDFAnnotation
    let openExternal: (URL) -> Void
    @Environment(\.dismiss) private var dismiss

    private var destination: PDFDestination? {
        link.destination ?? (link.action as? PDFActionGoTo)?.destination
    }

    private var url: URL? { link.url ?? (link.action as? PDFActionURL)?.url }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if let destination, let page = destination.page {
                    let index = session.pdf.index(for: page)
                    ViewerPageThumbnail(page: page, revision: session.revision, width: 260)
                        .frame(maxHeight: 280)
                        .accessibilityLabel(t("viewer.linkPreview.alt", ["page": session.label(ofPage: index)]))
                    Button {
                        dismiss()
                        session.go(to: destination)
                    } label: {
                        Label(t("viewer.link.goToPage", ["page": session.label(ofPage: index)]), systemImage: "arrow.turn.down.right")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                } else if let url {
                    Text(url.absoluteString)
                        .font(.callout.monospaced())
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Palette.muted, in: RoundedRectangle(cornerRadius: 10))
                    HStack {
                        Button {
                            dismiss()
                            openExternal(url)
                        } label: { Label(t("viewer.link.open"), systemImage: "safari").frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent)
                        Button {
                            UIPasteboard.general.url = url
                            session.showMessage(t("viewer.selection.copied"))
                            dismiss()
                        } label: { Label(t("viewer.selection.copy"), systemImage: "doc.on.doc").frame(maxWidth: .infinity) }
                            .buttonStyle(.bordered)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .navigationTitle(t("viewer.link.open"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { dismiss() } }
            }
        }
    }
}

/// Hardware keyboard shortcuts on iPad (desktop `ViewerShortcuts`, `zoomShortcuts`, `ViewerPage` keys).
/// Hidden buttons so they show in the ⌘ overlay and work while the page has focus.
struct ViewerShortcuts: View {
    let session: ViewerSession
    let closer: ViewerCloser
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            shortcut(t("viewer.search"), "f", .command) { session.leadingPanel = .search }
            shortcut(t("viewer.print"), "p", .command) { session.printPageIndex = nil; session.showPrint = true }
            shortcut(t("viewer.save.save"), "s", .command) { session.save() }
            shortcut(t("annotate.saveAs"), "s", [.command, .shift]) { _ = session.saveCopy() }
            shortcut(t("common.close"), "w", .command) { closer.close([session.document], in: app.documents) }
            shortcut(t("viewer.zoomIn"), "+", .command) { session.zoom(.zoomIn) }
            shortcut(t("viewer.zoomIn"), "=", .command) { session.zoom(.zoomIn) }
            shortcut(t("viewer.zoomOut"), "-", .command) { session.zoom(.zoomOut) }
            shortcut(t("viewer.actualSize"), "0", .command) { session.zoom(.actualSize) }
            shortcut(t("viewer.fitWidth"), "1", [.command, .option]) { session.zoom(.fitWidth) }
            shortcut(t("viewer.fitPage"), "2", [.command, .option]) { session.zoom(.fitPage) }
        }
        Group {
            shortcut(t("viewer.nextPage"), .pageDown, []) { session.nextPage() }
            shortcut(t("viewer.previousPage"), .pageUp, []) { session.previousPage() }
            shortcut(t("viewer.nextPage"), .rightArrow, .command) { session.nextPage() }
            shortcut(t("viewer.previousPage"), .leftArrow, .command) { session.previousPage() }
            shortcut(t("ios.viewer.firstPage"), .home, []) { session.firstPage() }
            shortcut(t("ios.viewer.lastPage"), .end, []) { session.lastPage() }
            shortcut(t("ios.viewer.firstPage"), .upArrow, .command) { session.firstPage() }
            shortcut(t("ios.viewer.lastPage"), .downArrow, .command) { session.lastPage() }
            shortcut(t("ios.viewer.back"), .leftArrow, .option) { session.goBack() }
            shortcut(t("ios.viewer.forward"), .rightArrow, .option) { session.goForward() }
            shortcut(t("viewer.context.goToPage"), "g", [.command, .option]) { session.showGoToPage = true }
        }
        Group {
            shortcut(t("viewer.pageDisplay.autoScroll"), "h", [.command, .shift]) { ViewerAutoScroller.of(session).toggle() }
            shortcut(t("viewer.split.title"), "e", [.command, .shift]) { session.splitActive.toggle() }
            shortcut(t("viewer.fullscreen"), "f", [.command, .control]) {
                if session.immersive { session.immersive = false; session.chromeHidden = false } else { session.immersive = true; session.chromeHidden = true }
            }
            shortcut(t("viewer.presentationTools"), .return, .command) { session.presenting = true }
            shortcut(t("viewer.annotate"), "a", [.command, .shift]) { session.showsAnnotate.toggle() }
            shortcut(t("viewer.reading.title"), "r", [.command, .shift]) { session.readingMode.toggle() }
            shortcut(t("viewer.thumbnails"), "t", [.command, .option]) { session.leadingPanel = session.leadingPanel == .thumbnails ? nil : .thumbnails }
            shortcut(t("viewer.outline.title"), "o", [.command, .option]) { session.leadingPanel = session.leadingPanel == .outline ? nil : .outline }
            shortcut(t("viewer.rotate"), "r", [.command, .option]) { session.rotateView(clockwise: true) }
            shortcut(t("viewer.pageDisplay.pageColors"), "i", [.command, .option]) { session.togglePageColors() }
            shortcut(t("viewer.exitFullscreen"), .escape, []) { escape() }
        }
        Group {
            if !session.showsAnnotate {
                shortcut(t("tools.pages.undo"), "z", .command) { session.undoManager.undo() }
                shortcut(t("tools.pages.redo"), "z", [.command, .shift]) { session.undoManager.redo() }
            }
            if session.autoScrolling {
                shortcut(t("ios.viewer.faster"), .downArrow, []) { ViewerAutoScroller.of(session).faster() }
                shortcut(t("ios.viewer.slower"), .upArrow, []) { ViewerAutoScroller.of(session).slower() }
                shortcut(t("ios.viewer.reverse"), "-", []) { ViewerAutoScroller.of(session).reverse() }
            }
        }
    }

    private func shortcut(_ title: String, _ key: KeyEquivalent, _ modifiers: EventModifiers, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .keyboardShortcut(key, modifiers: modifiers)
            .frame(width: 0, height: 0)
            .opacity(0)
            .accessibilityHidden(true)
    }

    /// Esc closes the innermost thing first, like the desktop.
    private func escape() {
        if session.autoScrolling { ViewerAutoScroller.of(session).stop() }
        else if session.immersive { session.immersive = false; session.chromeHidden = false }
        else if session.readingMode { session.readingMode = false }
        else if session.leadingPanel == .search { session.leadingPanel = nil }
        else if session.splitActive { session.splitActive = false }
    }
}
