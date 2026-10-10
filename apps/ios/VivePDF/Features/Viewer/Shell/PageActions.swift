import PDFKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Page-level actions shared by the thumbnail menu, the page menu and keyboard shortcuts
/// (desktop `ViewerContextMenu` "Page" group and `ThumbnailSidebar` menu).
@MainActor
enum ViewerPageActions {
    /// Renders a page as it looks (comments and form fields included) at the given width in pixels.
    static func image(of page: PDFPage, width: CGFloat) -> UIImage {
        let bounds = page.bounds(for: .cropBox)
        let rotated = page.rotation % 180 != 0
        let size = rotated ? CGSize(width: bounds.height, height: bounds.width) : bounds.size
        let scale = width / max(size.width, 1)
        return page.thumbnail(of: CGSize(width: size.width * scale, height: size.height * scale), for: .cropBox)
    }

    static func copyImage(_ session: ViewerSession, page index: Int) {
        guard let page = session.pdf.page(at: index) else { return }
        UIPasteboard.general.image = image(of: page, width: 1600)
        session.showMessage(t("viewer.context.imageCopied"))
    }

    /// Saves the page as PNG at the chosen resolution (`viewer.context.savePagePng`), returns the file.
    @discardableResult
    static func savePNG(_ session: ViewerSession, page index: Int, dpi: CGFloat) -> URL? {
        guard let page = session.pdf.page(at: index) else { return nil }
        let bounds = page.bounds(for: .cropBox)
        let widthPoints = page.rotation % 180 != 0 ? bounds.height : bounds.width
        let picture = image(of: page, width: widthPoints / 72 * dpi)
        guard let data = picture.pngData() else { return nil }
        let url = Workspace.output(for: session.document.url, suffix: "\(t("viewer.context.pageSuffix"))-\(index + 1)", ext: "png")
        do {
            try data.write(to: url)
            session.showMessage(t("viewer.context.pagePngSaved", ["name": url.lastPathComponent]))
            return url
        } catch {
            session.showError(error)
            return nil
        }
    }

    /// Writes one page as its own PDF (`viewer.context.extractPage`).
    @discardableResult
    static func extract(_ session: ViewerSession, page index: Int) -> URL? {
        guard let page = session.pdf.page(at: index)?.copy() as? PDFPage else { return nil }
        let single = PDFDocument()
        single.insert(page, at: 0)
        let url = Workspace.output(for: session.document.url, suffix: "\(t("viewer.context.pageSuffix"))-\(index + 1)", ext: "pdf")
        guard single.write(to: url) else {
            session.showError(EngineError.internalError("write"))
            return nil
        }
        session.showMessage(t("viewer.context.pageExtracted", ["name": url.lastPathComponent]))
        return url
    }

    /// `file:///…#page=N` like the desktop "Copy link to page".
    static func copyLink(_ session: ViewerSession, page index: Int) {
        var components = URLComponents(url: session.document.url, resolvingAgainstBaseURL: false)
        components?.fragment = "page=\(index + 1)"
        UIPasteboard.general.string = components?.string ?? session.document.url.absoluteString
        session.showMessage(t("viewer.selection.copied"))
    }

    /// Rotates a page in the file (saved with the document), undoable.
    static func rotate(_ session: ViewerSession, page index: Int, by degrees: Int) {
        guard let page = session.pdf.page(at: index) else { return }
        page.rotation = (page.rotation + degrees + 360) % 360
        session.undoManager.registerUndo(withTarget: session) { target in
            MainActor.assumeIsolated { ViewerPageActions.rotate(target, page: index, by: -degrees) }
        }
        session.markEdited()
        session.pdfView?.layoutDocumentView()
    }

    /// Deletes a page (undoable); a document keeps at least one page.
    static func delete(_ session: ViewerSession, page index: Int) {
        guard session.pageCount > 1 else {
            session.show(ViewerToast(text: t("viewer.pageEdits.keepOnePage"), symbol: "exclamationmark.triangle.fill", isError: true))
            return
        }
        guard let page = session.pdf.page(at: index) else { return }
        session.pdf.removePage(at: index)
        session.undoManager.registerUndo(withTarget: session) { target in
            MainActor.assumeIsolated {
                target.pdf.insert(page, at: min(index, target.pageCount))
                target.undoManager.registerUndo(withTarget: target) { again in
                    MainActor.assumeIsolated { ViewerPageActions.delete(again, page: index) }
                }
                target.markEdited()
                target.go(toPage: index)
            }
        }
        session.markEdited()
        if session.currentPageIndex >= session.pageCount { session.currentPageIndex = session.pageCount - 1 }
    }

    /// Adds a bookmark pointing at a page (and optional point) at the right place among top-level entries.
    static func addBookmark(_ session: ViewerSession, title: String, page index: Int, at point: CGPoint? = nil) {
        guard let page = session.pdf.page(at: index) else { return }
        let root = session.pdf.outlineRoot ?? {
            let created = PDFOutline()
            session.pdf.outlineRoot = created
            return created
        }()
        let item = PDFOutline()
        item.label = title
        let bounds = page.bounds(for: .cropBox)
        item.destination = PDFDestination(page: page, at: point ?? CGPoint(x: bounds.minX, y: bounds.maxY))
        // Insert before the first top-level bookmark that points further into the document.
        var insertAt = root.numberOfChildren
        for child in 0..<root.numberOfChildren {
            if let target = root.child(at: child)?.destination?.page, session.pdf.index(for: target) > index { insertAt = child; break }
        }
        root.insertChild(item, at: insertAt)
        session.undoManager.registerUndo(withTarget: session) { target in
            MainActor.assumeIsolated {
                item.removeFromParent()
                target.markEdited()
            }
        }
        session.markEdited()
        session.showMessage(t("viewer.context.bookmarkQueued", ["title": title]), symbol: "bookmark.fill")
    }
}

/// Page menu items (long-press on a thumbnail, the "…" page menu on the toolbar).
struct ViewerPageMenuItems: View {
    let session: ViewerSession
    let pageIndex: Int
    var includeNavigation = true
    @Environment(AppModel.self) private var app
    @Binding var shareURL: URL?
    @Binding var bookmarkPage: Int?

    var body: some View {
        if includeNavigation {
            Button { session.go(toPage: pageIndex) } label: { Label(t("viewer.context.goToPage"), systemImage: "arrow.right.doc.on.clipboard") }
        }
        Button { bookmarkPage = pageIndex } label: { Label(t("viewer.context.addBookmark"), systemImage: "bookmark") }
        Button { ViewerPageActions.copyLink(session, page: pageIndex) } label: { Label(t("viewer.context.copyPageLink"), systemImage: "link") }
        Button { session.printPageIndex = pageIndex; session.showPrint = true } label: { Label(t("viewer.context.printThisPage"), systemImage: "printer") }
        Menu {
            Button { ViewerPageActions.copyImage(session, page: pageIndex) } label: { Label(t("viewer.context.copyPageImage"), systemImage: "photo.on.rectangle") }
            Button { shareURL = ViewerPageActions.savePNG(session, page: pageIndex, dpi: 150) } label: { Label("\(t("viewer.context.savePagePng")) · 150 dpi", systemImage: "photo") }
            Button { shareURL = ViewerPageActions.savePNG(session, page: pageIndex, dpi: 300) } label: { Label("\(t("viewer.context.savePagePng")) · 300 dpi", systemImage: "photo") }
            Button { shareURL = ViewerPageActions.extract(session, page: pageIndex) } label: { Label(t("viewer.context.extractPage"), systemImage: "doc.badge.arrow.up") }
        } label: { Label(t("viewer.context.exportPage"), systemImage: "square.and.arrow.up") }
        Menu {
            Button { session.rotateView(clockwise: true) } label: { Label(t("viewer.context.rotateViewForward"), systemImage: "rotate.right") }
            Button { session.rotateView(clockwise: false) } label: { Label(t("viewer.context.rotateViewBackward"), systemImage: "rotate.left") }
        } label: { Label(t("viewer.context.view"), systemImage: "eye") }
        Menu {
            Button { ViewerPageActions.rotate(session, page: pageIndex, by: 90) } label: { Label(t("viewer.pageEdits.rotateRight"), systemImage: "rotate.right.fill") }
            Button { ViewerPageActions.rotate(session, page: pageIndex, by: -90) } label: { Label(t("viewer.pageEdits.rotateLeft"), systemImage: "rotate.left.fill") }
            Button(role: .destructive) { ViewerPageActions.delete(session, page: pageIndex) } label: { Label(t("viewer.pageEdits.delete"), systemImage: "trash") }
                .disabled(session.pageCount <= 1)
            Button { app.navigate(.pages) } label: { Label(t("viewer.pageEdits.openOrganizer"), systemImage: "square.grid.2x2") }
        } label: { Label(t("viewer.pageEdits.menu"), systemImage: "doc.badge.gearshape") }
        if session.text(ofPage: pageIndex).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Menu {
                Button { session.makeSearchablePage = .some(pageIndex) } label: { Text(t("viewer.searchable.thisPage")) }
                Button { session.makeSearchablePage = .some(nil) } label: { Text(t("viewer.searchable.wholeDocument")) }
            } label: { Label(t("viewer.context.makeSelectable"), systemImage: "text.viewfinder") }
        }
    }
}
