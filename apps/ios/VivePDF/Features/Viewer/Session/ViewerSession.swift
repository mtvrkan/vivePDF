import Observation
import PDFKit
import SwiftUI
import UIKit

/// Side panels shown next to the page on wide windows (leading column) and as sheets on compact width.
/// Mirrors the desktop navigation rail (`NavigationRail` in `ViewerRails.tsx`).
enum LeadingPanel: String, CaseIterable, Identifiable {
    case thumbnails, outline, search, attachments, signatures, layers
    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .thumbnails: "viewer.thumbnails"
        case .outline: "viewer.outline.title"
        case .search: "viewer.search"
        case .attachments: "viewer.attachments.title"
        case .signatures: "viewer.signatures.title"
        case .layers: "viewer.layers.title"
        }
    }

    var symbol: String {
        switch self {
        case .thumbnails: "square.grid.2x2"
        case .outline: "list.bullet.indent"
        case .search: "magnifyingglass"
        case .attachments: "paperclip"
        case .signatures: "signature"
        case .layers: "square.3.layers.3d"
        }
    }
}

/// Panels on the trailing side (desktop `ToolsRail`): shown in an `.inspector`, which becomes a sheet on iPhone.
enum TrailingPanel: String, CaseIterable, Identifiable {
    case comments, info, translate
    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .comments: "viewer.comments.title"
        case .info: "viewer.inspector"
        case .translate: "viewer.translate.title"
        }
    }

    var symbol: String {
        switch self {
        case .comments: "text.bubble"
        case .info: "info.circle"
        case .translate: "translate"
        }
    }
}

/// Page layout choices from the desktop "Page display" menu, plus iOS paging.
enum PageSpread: String, CaseIterable, Identifiable {
    /// One page per row, continuous scrolling (desktop `SpreadMode.None`).
    case single
    /// Two pages side by side (desktop `SpreadMode.Odd`).
    case twoPage
    /// Two pages, the cover alone (desktop `SpreadMode.Even`).
    case twoPageCover
    var id: String { rawValue }

    var labelKey: String {
        switch self {
        case .single: "viewer.pageDisplay.single"
        case .twoPage: "viewer.pageDisplay.twoPage"
        case .twoPageCover: "viewer.pageDisplay.twoPageCover"
        }
    }

    var symbol: String {
        switch self {
        case .single: "doc"
        case .twoPage: "book.pages"
        case .twoPageCover: "book"
        }
    }
}

enum ScrollDirection: String, CaseIterable, Identifiable {
    case vertical, horizontal
    var id: String { rawValue }
    var labelKey: String { "viewer.pageDisplay.\(rawValue)" }
    var symbol: String { self == .vertical ? "arrow.up.and.down" : "arrow.left.and.right" }
}

/// Page colour schemes (`PAGE_COLOR_SCHEMES` in `shared/lib/pageColors.ts`).
enum PageColorScheme: String, CaseIterable, Identifiable {
    case normal, dark, sepia, whiteOnBlack, yellowOnBlack, greenOnBlack
    var id: String { rawValue }
    var labelKey: String { "viewer.pageDisplay.colors.\(rawValue)" }
}

/// Zoom requests (desktop `ZoomMode` + presets).
enum ZoomRequest: Equatable {
    case fitWidth, fitPage, actualSize
    case level(CGFloat)
    case zoomIn, zoomOut
}

/// Drag-a-rectangle tools from the desktop toolbar (`viewer.areaText.tool`, `viewer.snapshot.tool`, `viewer.areaZoom`).
enum ViewerAreaTool: String, Identifiable {
    case text, snapshot, zoom
    var id: String { rawValue }
}

/// A transient message ("toast") shown over the page.
struct ViewerToast: Identifiable, Equatable {
    let id = UUID()
    var text: String
    var symbol: String = "checkmark.circle.fill"
    var isError = false
    /// Optional action button (e.g. "Go to page 1" after resuming).
    var actionTitle: String?
    var action: (() -> Void)?

    static func == (lhs: ViewerToast, rhs: ViewerToast) -> Bool { lhs.id == rhs.id }
}

/// State of one open document in the viewer: page position, zoom, layout, panels and the live `PDFView`.
/// One session per `OpenDocument` (kept while its tab is open), so switching tabs restores everything.
///
/// Feature modules attach their own controllers with `service(_:)` instead of growing this type
/// (annotation tools, speech, presentation…), which keeps them independent.
@MainActor
@Observable
final class ViewerSession: Identifiable {
    let document: OpenDocument
    nonisolated let id: UUID
    var pdf: PDFDocument { document.pdf }

    /// The live page view (set by `PDFCanvas`). Not observed: views react to the published values below.
    @ObservationIgnored weak var pdfView: VivePDFView? {
        didSet { pdfViewDidChange() }
    }

    // MARK: Position & zoom
    var currentPageIndex: Int = 0 {
        didSet { if document.currentPageIndex != currentPageIndex { document.currentPageIndex = currentPageIndex } }
    }
    var pageCount: Int { pdf.pageCount }
    /// Current zoom, 1 = 100 % (PDF points to screen points).
    var scale: CGFloat = 1
    /// True while PDFKit picks the scale (fit page on first show, after rotation).
    var autoScales = true
    var canGoBack = false
    var canGoForward = false

    // MARK: Layout (persisted globally like the desktop page display store)
    var spread: PageSpread { didSet { UserDefaults.standard.set(spread.rawValue, forKey: "vivepdf.viewer.spread"); applyLayout() } }
    var direction: ScrollDirection { didSet { UserDefaults.standard.set(direction.rawValue, forKey: "vivepdf.viewer.direction"); applyLayout() } }
    /// Page-by-page paging (iOS page curl-free swipe), handy on phones.
    var paged: Bool { didSet { UserDefaults.standard.set(paged, forKey: "vivepdf.viewer.paged"); applyLayout() } }
    var pageColors: PageColorScheme { didSet { UserDefaults.standard.set(pageColors.rawValue, forKey: "vivepdf.viewer.pageColors") } }
    /// Last non-normal scheme, so the quick toggle restores the reader's favourite.
    var lastPageColors: PageColorScheme
    /// View-only rotation in quarter turns, undone before saving (desktop rotate plugin never writes the file).
    private(set) var viewRotation = 0

    // MARK: Panels & modes
    var leadingPanel: LeadingPanel?
    var trailingPanel: TrailingPanel?
    var showsAnnotate = false
    var showsReadAloud = false
    var readingMode = false
    var presenting = false
    /// Full-screen reading with chrome hidden (desktop immersive mode); tap toggles chrome.
    var immersive = false
    var chromeHidden = false
    var autoScrolling = false
    var autoScrollSpeedIndex = 2
    var autoScrollBackwards = false
    /// Split view (`viewer/split`): the second pane shows `splitDocument` (nil = same document).
    var splitActive = false
    var splitStacked = false
    var splitURL: URL?

    // MARK: Text selection
    /// Live text selection in the page view (nil when nothing is selected).
    var selection: PDFSelection?
    var selectedText: String { selection?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
    /// Text handed to the translate panel (selection or page text).
    var translateText: String = ""

    // MARK: Search state (shared by the search panel and the canvas highlights)
    var searchQuery = ""
    var searchMatchCase = false
    var searchWholeWord = false
    var searchResults: [PDFSelection] = []
    var searchIndex = -1
    var searching = false

    // MARK: Changes
    /// Bumped whenever annotations, outline, attachments or metadata change, so panels re-read the document.
    var revision = 0
    var toast: ViewerToast?
    /// Shows the print sheet / go-to-page prompt / make-searchable prompt.
    var showPrint = false
    var printPageIndex: Int?
    var showGoToPage = false
    var makeSearchablePage: Int??
    /// Highlight rectangles drawn over form widgets (`FieldHighlights`).
    var highlightFields = false
    /// Armed area tool (drag over the page to read text, copy a picture or zoom).
    var areaTool: ViewerAreaTool?
    /// External link the reader tapped; the viewer asks before opening it.
    var linkPrompt: URL?
    /// Link long-pressed for a preview (page thumbnail or address).
    var linkPreview: PDFAnnotation?

    /// Set once the viewer has applied its first-show defaults (panels, resume toast).
    @ObservationIgnored var didAppear = false
    @ObservationIgnored let undoManager = UndoManager()
    @ObservationIgnored private var services: [ObjectIdentifier: AnyObject] = [:]
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    init(document: OpenDocument) {
        self.document = document
        id = document.id
        let defaults = UserDefaults.standard
        spread = defaults.string(forKey: "vivepdf.viewer.spread").flatMap(PageSpread.init(rawValue:)) ?? .single
        direction = defaults.string(forKey: "vivepdf.viewer.direction").flatMap(ScrollDirection.init(rawValue:)) ?? .vertical
        paged = defaults.bool(forKey: "vivepdf.viewer.paged")
        let colors = defaults.string(forKey: "vivepdf.viewer.pageColors").flatMap(PageColorScheme.init(rawValue:)) ?? .normal
        pageColors = colors
        lastPageColors = colors == .normal ? .dark : colors
        currentPageIndex = document.currentPageIndex
        undoManager.levelsOfUndo = 200
    }

    /// Returns the feature controller of type `T`, creating it on first use. Lets modules keep per-document
    /// state (annotation tool, speech position…) without this type knowing about them.
    func service<T: AnyObject>(_ type: T.Type = T.self, make: () -> T) -> T {
        let key = ObjectIdentifier(type)
        if let existing = services[key] as? T { return existing }
        let created = make()
        services[key] = created
        return created
    }

    func existingService<T: AnyObject>(_ type: T.Type) -> T? {
        services[ObjectIdentifier(type)] as? T
    }

    // MARK: - Navigation

    var currentPage: PDFPage? { pdf.page(at: currentPageIndex) }

    /// Jumps to a zero-based page index (clamped), recording it in the back/forward history.
    func go(toPage index: Int) {
        guard pageCount > 0 else { return }
        let target = min(max(0, index), pageCount - 1)
        guard let page = pdf.page(at: target) else { return }
        if let pdfView { pdfView.go(to: page) }
        currentPageIndex = target
    }

    func go(to destination: PDFDestination) {
        pdfView?.go(to: destination)
        if let page = destination.page { currentPageIndex = pdf.index(for: page) }
    }

    /// Shows a selection (search hit, comment, outline target) and scrolls it into view.
    func reveal(_ selection: PDFSelection, select: Bool = false) {
        guard let page = selection.pages.first else { return }
        if let pdfView {
            if select { pdfView.setCurrentSelection(selection, animate: true) }
            pdfView.go(to: selection)
        }
        currentPageIndex = pdf.index(for: page)
    }

    /// Scrolls to an annotation and flashes it.
    func reveal(_ annotation: PDFAnnotation) {
        guard let page = annotation.page else { return }
        let destination = PDFDestination(page: page, at: CGPoint(x: annotation.bounds.minX, y: annotation.bounds.maxY + 24))
        go(to: destination)
    }

    func nextPage() {
        if let pdfView, pdfView.canGoToNextPage { pdfView.goToNextPage(nil) } else { go(toPage: currentPageIndex + 1) }
    }

    func previousPage() {
        if let pdfView, pdfView.canGoToPreviousPage { pdfView.goToPreviousPage(nil) } else { go(toPage: currentPageIndex - 1) }
    }

    func firstPage() { go(toPage: 0) }
    func lastPage() { go(toPage: pageCount - 1) }

    func goBack() { pdfView?.goBack(nil); refreshHistory() }
    func goForward() { pdfView?.goForward(nil); refreshHistory() }

    func refreshHistory() {
        canGoBack = pdfView?.canGoBack ?? false
        canGoForward = pdfView?.canGoForward ?? false
    }

    /// Display label of a page (`/PageLabels`, e.g. "iv"), falling back to the page number.
    func label(ofPage index: Int) -> String {
        if let label = pdf.page(at: index)?.label, !label.isEmpty, label != "\(index + 1)" { return label }
        return "\(index + 1)"
    }

    /// Parses a page typed by the reader: a page label ("iv") or a number.
    func pageIndex(fromInput raw: String) -> Int? {
        let text = raw.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }
        for index in 0..<pageCount where pdf.page(at: index)?.label?.caseInsensitiveCompare(text) == .orderedSame {
            if pdf.page(at: index)?.label != "\(index + 1)" { return index }
        }
        guard let number = Int(text), number >= 1, number <= pageCount else { return nil }
        return number - 1
    }

    // MARK: - Zoom

    static let minScale: CGFloat = 0.25
    static let maxScale: CGFloat = 8
    static let zoomPresets: [CGFloat] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

    func zoom(_ request: ZoomRequest) {
        guard let pdfView else { return }
        switch request {
        case .fitPage:
            pdfView.autoScales = true
            pdfView.scaleFactor = pdfView.scaleFactorForSizeToFit
            autoScales = true
        case .fitWidth:
            pdfView.autoScales = false
            pdfView.scaleFactor = fitWidthScale(in: pdfView)
            autoScales = false
        case .actualSize:
            pdfView.autoScales = false
            pdfView.scaleFactor = 1
            autoScales = false
        case .level(let level):
            pdfView.autoScales = false
            pdfView.scaleFactor = min(Self.maxScale, max(Self.minScale, level))
            autoScales = false
        case .zoomIn:
            pdfView.autoScales = false
            pdfView.scaleFactor = min(Self.maxScale, pdfView.scaleFactor * 1.25)
            autoScales = false
        case .zoomOut:
            pdfView.autoScales = false
            pdfView.scaleFactor = max(Self.minScale, pdfView.scaleFactor / 1.25)
            autoScales = false
        }
        scale = pdfView.scaleFactor
    }

    private func fitWidthScale(in view: PDFView) -> CGFloat {
        guard let page = view.currentPage ?? pdf.page(at: 0) else { return 1 }
        let bounds = page.bounds(for: view.displayBox)
        let rotated = (page.rotation % 180) != 0
        var width = rotated ? bounds.height : bounds.width
        if spread != .single && direction == .vertical { width *= 2 }
        let insets = view.pageBreakMargins.left + view.pageBreakMargins.right + 8
        let available = view.bounds.width - view.safeAreaInsets.left - view.safeAreaInsets.right - insets
        return max(Self.minScale, min(Self.maxScale, available / max(width, 1)))
    }

    // MARK: - Layout

    func applyLayout() {
        guard let pdfView else { return }
        let page = pdfView.currentPage
        pdfView.displayDirection = direction == .horizontal ? .horizontal : .vertical
        switch spread {
        case .single: pdfView.displayMode = paged ? .singlePage : .singlePageContinuous
        case .twoPage, .twoPageCover: pdfView.displayMode = paged ? .twoUp : .twoUpContinuous
        }
        pdfView.displaysAsBook = spread == .twoPageCover
        // Page-by-page swiping uses UIPageViewController, which only supports single pages.
        let wantsPager = paged && spread == .single
        if pdfView.isUsingPageViewController != wantsPager {
            pdfView.usePageViewController(wantsPager, withViewOptions: [UIPageViewController.OptionsKey.interPageSpacing: 12])
        }
        pdfView.layoutDocumentView()
        if autoScales { pdfView.autoScales = true }
        if let page { pdfView.go(to: page) }
    }

    /// Rotates the view by quarter turns. PDFKit only rotates pages, so the turn is applied to the pages and
    /// undone before any save (`withViewRotationRemoved`), matching the desktop's view-only rotation.
    func rotateView(clockwise: Bool = true) {
        let delta = clockwise ? 90 : -90
        let wasDirty = document.isDirty
        for index in 0..<pageCount { pdf.page(at: index).map { $0.rotation = ($0.rotation + delta + 360) % 360 } }
        viewRotation = ((viewRotation + (clockwise ? 1 : -1)) % 4 + 4) % 4
        document.isDirty = wasDirty
        pdfView?.layoutDocumentView()
        if autoScales { pdfView?.autoScales = true }
        go(toPage: currentPageIndex)
    }

    /// Runs `body` with the view rotation taken off the pages (used around saves and snapshots).
    func withViewRotationRemoved<T>(_ body: () throws -> T) rethrows -> T {
        let turns = viewRotation
        guard turns != 0 else { return try body() }
        let delta = turns * 90
        for index in 0..<pageCount { pdf.page(at: index).map { $0.rotation = ($0.rotation - delta + 360) % 360 } }
        defer {
            for index in 0..<pageCount { pdf.page(at: index).map { $0.rotation = ($0.rotation + delta) % 360 } }
        }
        return try body()
    }

    func togglePageColors() {
        if pageColors == .normal { pageColors = lastPageColors } else { lastPageColors = pageColors; pageColors = .normal }
    }

    // MARK: - Changes & saving

    /// Records that the document was edited in memory (annotations, outline, metadata…).
    func markEdited() {
        document.isDirty = true
        revision += 1
    }

    /// Re-reads panels without marking the document dirty (after a reload or a view-only change).
    func refresh() { revision += 1 }

    /// Saves in place. View rotation is removed first, and the view position is restored after PDFKit reloads.
    @discardableResult
    func save() -> Bool {
        let page = currentPageIndex
        do {
            try withViewRotationRemoved { try document.save() }
            viewRotation = 0
            undoManager.removeAllActions()
            revision += 1
            restorePosition(page)
            show(ViewerToast(text: t("viewer.save.saved", ["name": document.fileName])))
            return true
        } catch {
            show(ViewerToast(text: error.localizedDescription, symbol: "exclamationmark.triangle.fill", isError: true))
            return false
        }
    }

    /// Writes a copy with all edits to `Documents/vivePDF` (desktop "Save as" with the `annotated` suffix).
    func saveCopy(suffix: String = t("annotate.suffix")) -> URL? {
        let target = Workspace.output(for: document.url, suffix: suffix, ext: "pdf")
        let ok = withViewRotationRemoved { pdf.write(to: target) }
        guard ok else {
            show(ViewerToast(text: t("errors.INTERNAL"), symbol: "exclamationmark.triangle.fill", isError: true))
            return nil
        }
        show(ViewerToast(text: t("viewer.save.saved", ["name": target.lastPathComponent])))
        return target
    }

    /// A file with the current state (unsaved edits included, view rotation excluded) for sharing and tools.
    func snapshotURL() -> URL? {
        guard document.isDirty || viewRotation != 0 else { return document.url }
        let temp = Workspace.scratch().appendingPathComponent(document.fileName)
        let ok = withViewRotationRemoved { pdf.write(to: temp) }
        return ok ? temp : nil
    }

    /// Throws away unsaved edits by re-reading the file.
    func discardChanges() {
        let page = currentPageIndex
        do {
            try document.reload()
            viewRotation = 0
            undoManager.removeAllActions()
            revision += 1
            restorePosition(page)
        } catch {
            show(ViewerToast(text: error.localizedDescription, symbol: "exclamationmark.triangle.fill", isError: true))
        }
    }

    /// Re-reads the file after an outside change (file-changed banner).
    func reloadFromDisk() { discardChanges() }

    /// After PDFKit swaps in a reloaded `PDFDocument`, put the reader back where they were.
    func restorePosition(_ page: Int) {
        currentPageIndex = min(page, max(0, pageCount - 1))
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.go(toPage: self.currentPageIndex)
        }
    }

    // MARK: - Toasts

    func show(_ toast: ViewerToast, seconds: Double = 3) {
        toastTask?.cancel()
        self.toast = toast
        toastTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(toast.action == nil ? seconds : seconds * 2))
            guard !Task.isCancelled, self?.toast?.id == toast.id else { return }
            self?.toast = nil
        }
    }

    func showError(_ error: Error) {
        show(ViewerToast(text: error.localizedDescription, symbol: "exclamationmark.triangle.fill", isError: true))
    }

    func showMessage(_ text: String, symbol: String = "checkmark.circle.fill") {
        show(ViewerToast(text: text, symbol: symbol))
    }

    // MARK: - Page text helpers

    /// Plain text of a page (empty for scanned pages without a text layer).
    func text(ofPage index: Int) -> String {
        pdf.page(at: index)?.string ?? ""
    }

    /// True when no page in the first few has any text (a scanned document → offer "Make selectable").
    var looksScanned: Bool {
        guard pageCount > 0 else { return false }
        let sample = min(pageCount, 5)
        return (0..<sample).allSatisfy { (pdf.page(at: $0)?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private func pdfViewDidChange() {
        guard pdfView != nil else { return }
        applyLayout()
        refreshHistory()
    }
}

/// Keeps one `ViewerSession` per open document for as long as its tab is open.
@MainActor
final class ViewerSessions {
    static let shared = ViewerSessions()
    private var sessions: [OpenDocument.ID: ViewerSession] = [:]

    func session(for document: OpenDocument) -> ViewerSession {
        if let existing = sessions[document.id] { return existing }
        let created = ViewerSession(document: document)
        sessions[document.id] = created
        return created
    }

    func existing(for document: OpenDocument) -> ViewerSession? { sessions[document.id] }

    /// Drops sessions whose documents were closed and returns them so the caller can stop their work.
    @discardableResult
    func prune(keeping open: [OpenDocument]) -> [ViewerSession] {
        let ids = Set(open.map(\.id))
        let removed = sessions.filter { !ids.contains($0.key) }.map(\.value)
        sessions = sessions.filter { ids.contains($0.key) }
        return removed
    }
}
