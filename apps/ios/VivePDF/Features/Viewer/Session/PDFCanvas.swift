import PDFKit
import SwiftUI
import UIKit

/// `PDFView` with the hooks the viewer needs: extra items in the text-selection edit menu
/// (desktop `SelectionActions`), long-press on links (link preview), single taps for immersive mode and
/// double-tap zoom.
final class VivePDFView: PDFView {
    /// Adds viewer actions (highlight, translate, read aloud…) to the selection edit menu.
    var editMenuBuilder: ((UIMenuBuilder) -> Void)?
    /// Long press on a link annotation (shows the link preview instead of starting a text selection).
    var onLinkLongPress: ((PDFAnnotation, CGPoint) -> Void)?
    /// Single tap on an empty spot of the page (immersive chrome toggle). Not called for links or selections.
    var onBackgroundTap: ((CGPoint) -> Void)?
    /// Lets annotation tools claim taps (sticky notes, text boxes, select).
    var tapInterceptor: ((CGPoint) -> Bool)?

    private var installed = false

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        editMenuBuilder?(builder)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, !installed else { return }
        installed = true
        let linkPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLinkPress(_:)))
        linkPress.minimumPressDuration = 0.45
        linkPress.delegate = gestureDelegate
        addGestureRecognizer(linkPress)

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tap.delegate = gestureDelegate
        if !hasBuiltInDoubleTap(in: self) {
            let doubleTap = UITapGestureRecognizer(target: self, action: #selector(handleDoubleTap(_:)))
            doubleTap.numberOfTapsRequired = 2
            doubleTap.delegate = gestureDelegate
            addGestureRecognizer(doubleTap)
            tap.require(toFail: doubleTap)
        }
        addGestureRecognizer(tap)
    }

    private lazy var gestureDelegate = GestureDelegate(owner: self)

    /// PDFKit already zooms on double tap in some iOS versions; never add a second recogniser on top.
    private func hasBuiltInDoubleTap(in view: UIView) -> Bool {
        if view.gestureRecognizers?.contains(where: { ($0 as? UITapGestureRecognizer)?.numberOfTapsRequired == 2 }) == true { return true }
        return view.subviews.contains { hasBuiltInDoubleTap(in: $0) }
    }

    /// The link annotation under a point in view coordinates, if any.
    func link(at point: CGPoint) -> PDFAnnotation? {
        guard let page = page(for: point, nearest: false) else { return nil }
        let pagePoint = convert(point, to: page)
        return page.annotations.last { $0.type == "Link" && $0.bounds.contains(pagePoint) }
    }

    @objc private func handleLinkPress(_ recognizer: UILongPressGestureRecognizer) {
        guard recognizer.state == .began else { return }
        let point = recognizer.location(in: self)
        if let link = link(at: point) { onLinkLongPress?(link, point) }
    }

    @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
        let point = recognizer.location(in: self)
        if tapInterceptor?(point) == true { return }
        guard link(at: point) == nil, currentSelection == nil || currentSelection?.string?.isEmpty == true else { return }
        if let page = page(for: point, nearest: false), page.annotation(at: convert(point, to: page))?.widgetFieldType != nil { return }
        onBackgroundTap?(point)
    }

    @objc private func handleDoubleTap(_ recognizer: UITapGestureRecognizer) {
        let point = recognizer.location(in: self)
        let fit = scaleFactorForSizeToFit
        if scaleFactor > fit * 1.2 {
            autoScales = true
            scaleFactor = fit
        } else {
            guard let page = page(for: point, nearest: true) else { return }
            let pagePoint = convert(point, to: page)
            autoScales = false
            scaleFactor = min(maxScaleFactor, max(fit * 2.2, 1.5))
            go(to: PDFDestination(page: page, at: CGPoint(x: pagePoint.x - bounds.width / scaleFactor / 2, y: pagePoint.y + bounds.height / scaleFactor / 2)))
        }
    }

    private final class GestureDelegate: NSObject, UIGestureRecognizerDelegate {
        weak var owner: VivePDFView?
        init(owner: VivePDFView) { self.owner = owner }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            !(gestureRecognizer is UILongPressGestureRecognizer)
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let owner else { return false }
            if gestureRecognizer is UILongPressGestureRecognizer {
                return owner.link(at: gestureRecognizer.location(in: owner)) != nil
            }
            return true
        }
    }
}

/// The page canvas: a `VivePDFView` bound to a `ViewerSession` (position, zoom, selection, history).
/// Used by the main viewer, the split view pane and the presentation screen.
struct PDFCanvas: UIViewRepresentable {
    let session: ViewerSession
    /// Secondary panes (split view) don't publish their position into the session.
    var isPrimary = true
    var configure: ((VivePDFView) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator(session: session, isPrimary: isPrimary) }

    func makeUIView(context: Context) -> VivePDFView {
        let view = VivePDFView()
        view.backgroundColor = .secondarySystemBackground
        view.pageShadowsEnabled = true
        view.minScaleFactor = ViewerSession.minScale
        view.maxScaleFactor = ViewerSession.maxScale
        view.displayBox = .cropBox
        view.delegate = context.coordinator
        view.document = session.pdf
        view.autoScales = true
        view.isInMarkupMode = false
        context.coordinator.attach(view)
        if isPrimary { session.pdfView = view }
        configure?(view)
        let start = session.currentPageIndex
        if start > 0, let page = session.pdf.page(at: start) {
            DispatchQueue.main.async { view.go(to: page) }
        }
        return view
    }

    func updateUIView(_ view: VivePDFView, context: Context) {
        let pdf = session.pdf
        if view.document !== pdf {
            let page = session.currentPageIndex
            view.document = pdf
            if session.autoScales { view.autoScales = true } else { view.scaleFactor = session.scale }
            if let target = pdf.page(at: min(page, max(0, pdf.pageCount - 1))) { view.go(to: target) }
        }
        if isPrimary, session.pdfView !== view { session.pdfView = view }
    }

    static func dismantleUIView(_ view: VivePDFView, coordinator: Coordinator) {
        coordinator.detach()
    }

    @MainActor
    final class Coordinator: NSObject, PDFViewDelegate {
        let session: ViewerSession
        let isPrimary: Bool
        private var observers: [NSObjectProtocol] = []
        weak var view: VivePDFView?

        init(session: ViewerSession, isPrimary: Bool) {
            self.session = session
            self.isPrimary = isPrimary
        }

        func attach(_ view: VivePDFView) {
            self.view = view
            let center = NotificationCenter.default
            observers.append(center.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.pageChanged() }
            })
            observers.append(center.addObserver(forName: .PDFViewScaleChanged, object: view, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.scaleChanged() }
            })
            observers.append(center.addObserver(forName: .PDFViewSelectionChanged, object: view, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.selectionChanged() }
            })
            observers.append(center.addObserver(forName: .PDFViewChangedHistory, object: view, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.session.refreshHistory() }
            })
        }

        func detach() {
            observers.forEach(NotificationCenter.default.removeObserver)
            observers.removeAll()
        }

        private func pageChanged() {
            guard isPrimary, let view, let page = view.currentPage, let document = view.document else { return }
            let index = document.index(for: page)
            if index != NSNotFound, session.currentPageIndex != index { session.currentPageIndex = index }
            session.refreshHistory()
        }

        private func scaleChanged() {
            guard isPrimary, let view else { return }
            session.scale = view.scaleFactor
            session.autoScales = view.autoScales
        }

        private func selectionChanged() {
            guard isPrimary, let view else { return }
            let selection = view.currentSelection
            session.selection = (selection?.string?.isEmpty ?? true) ? nil : selection
        }

        // External links ask first (desktop shows the address with an "Open link" button).
        nonisolated func pdfViewWillClick(onLink sender: PDFView, with url: URL) {
            MainActor.assumeIsolated {
                session.linkPrompt = url
            }
        }
    }
}
