import PDFKit
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// Single-touch drag recogniser that starts on touch down (drawing must not wait for a pan threshold) and
/// collects coalesced Pencil samples. A second finger cancels it so two-finger scroll and pinch still work.
final class AnnotateDragRecognizer: UIGestureRecognizer {
    private var tracked: UITouch?
    private var pending: [CGPoint] = []
    private(set) var startLocation: CGPoint = .zero

    /// Points received since the last call (view coordinates).
    func drainPoints() -> [CGPoint] {
        defer { pending.removeAll() }
        return pending
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        if tracked != nil || touches.count > 1 || (event.allTouches?.count ?? 0) > 1 {
            state = state == .possible ? .failed : .cancelled
            return
        }
        guard let touch = touches.first else { return }
        tracked = touch
        startLocation = touch.location(in: view)
        pending = [startLocation]
        state = .began
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let tracked, touches.contains(tracked) else { return }
        let samples = event.coalescedTouches(for: tracked) ?? [tracked]
        pending.append(contentsOf: samples.map { $0.location(in: view) })
        state = .changed
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let tracked, touches.contains(tracked) else { return }
        pending.append(tracked.location(in: view))
        state = .ended
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        state = .cancelled
    }

    override func reset() {
        tracked = nil
        pending.removeAll()
    }
}

/// Transparent layer above the pages that draws live strokes, marquees, the eraser and selection handles.
final class AnnotateOverlayView: UIView {
    weak var handler: AnnotateInputHandler?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        MainActor.assumeIsolated { handler?.drawOverlay(in: context) }
    }
}

/// Touch handling for the annotate tools on a `VivePDFView`: drawing, shapes, marquee selection, eraser,
/// moving/resizing selected marks, taps on marks and Apple Pencil double-tap.
@MainActor
final class AnnotateInputHandler: NSObject, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
    unowned let controller: AnnotationController
    private(set) weak var view: VivePDFView?
    private(set) weak var document: PDFDocument?
    private let overlay = AnnotateOverlayView()
    private lazy var drawRecognizer = AnnotateDragRecognizer(target: self, action: #selector(handleDraw(_:)))
    private lazy var moveRecognizer = AnnotateDragRecognizer(target: self, action: #selector(handleMove(_:)))
    private var pencil: UIPencilInteraction?
    private weak var scrollView: UIScrollView?
    private var savedMinTouches = 1
    private var offsetObservation: NSKeyValueObservation?
    private var observers: [NSObjectProtocol] = []

    // Live gesture state (page coordinates).
    private var livePage: PDFPage?
    private var livePoints: [CGPoint] = []
    private var liveTool: AnnotateTool?
    private var liveSelection: PDFSelection?

    // Move/resize state.
    private enum DragTarget { case body, handle(AnnotationGeometry.ResizeHandle), lineStart, lineEnd }
    private var dragTarget: DragTarget?
    private var dragStart: CGPoint = .zero
    private var dragPage: PDFPage?
    private var originals: [(PDFAnnotation, AnnotationSnapshot, CGRect)] = []

    init(controller: AnnotationController) {
        self.controller = controller
        super.init()
        overlay.handler = self
    }

    // MARK: - Install

    func install(on view: VivePDFView, document: PDFDocument) {
        self.document = document
        if self.view === view {
            update()
            return
        }
        uninstall()
        self.view = view
        overlay.frame = view.bounds
        view.addSubview(overlay)
        for recognizer in [drawRecognizer, moveRecognizer] {
            recognizer.delegate = self
            view.addGestureRecognizer(recognizer)
        }
        let pencil = UIPencilInteraction()
        pencil.delegate = self
        view.addInteraction(pencil)
        self.pencil = pencil
        view.tapInterceptor = { [weak self] point in
            MainActor.assumeIsolated { self?.handleTap(at: point) ?? false }
        }
        scrollView = Self.findScrollView(in: view)
        savedMinTouches = scrollView?.panGestureRecognizer.minimumNumberOfTouches ?? 1
        offsetObservation = scrollView?.observe(\.contentOffset, options: []) { [weak self] _, _ in
            DispatchQueue.main.async { self?.refreshOverlay() }
        }
        let center = NotificationCenter.default
        for name in [Notification.Name.PDFViewScaleChanged, .PDFViewPageChanged, .PDFViewDisplayModeChanged] {
            observers.append(center.addObserver(forName: name, object: view, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.refreshOverlay() }
            })
        }
        update()
    }

    func uninstall() {
        guard let view else { return }
        view.removeGestureRecognizer(drawRecognizer)
        view.removeGestureRecognizer(moveRecognizer)
        if let pencil { view.removeInteraction(pencil) }
        pencil = nil
        overlay.removeFromSuperview()
        view.tapInterceptor = nil
        scrollView?.panGestureRecognizer.minimumNumberOfTouches = savedMinTouches
        offsetObservation = nil
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        self.view = nil
    }

    private static func findScrollView(in view: UIView) -> UIScrollView? {
        for subview in view.subviews {
            if let scroll = subview as? UIScrollView { return scroll }
            if let nested = findScrollView(in: subview) { return nested }
        }
        return nil
    }

    /// Re-applies the armed tool: who gets one-finger touches, Pencil-only drawing, overlay order.
    func update() {
        guard let view else { return }
        let tool = controller.tool
        let drawing = tool != nil && tool != .select
        drawRecognizer.isEnabled = drawing
        let pencilOnly = controller.pencilOnly && tool != .area && tool != .link
        drawRecognizer.allowedTouchTypes = pencilOnly
            ? [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
            : [NSNumber(value: UITouch.TouchType.direct.rawValue), NSNumber(value: UITouch.TouchType.pencil.rawValue), NSNumber(value: UITouch.TouchType.indirectPointer.rawValue)]
        // While a tool draws with the finger, scrolling takes two fingers (like Notes and Freeform).
        scrollView?.panGestureRecognizer.minimumNumberOfTouches = drawing && !pencilOnly ? 2 : savedMinTouches
        if !drawing { cancelLive() }
        view.bringSubviewToFront(overlay)
        refreshOverlay()
    }

    func cancelLive() {
        livePage = nil
        livePoints = []
        liveTool = nil
        liveSelection = nil
        overlay.setNeedsDisplay()
    }

    func refreshOverlay() {
        overlay.setNeedsDisplay()
        guard let view else { return }
        let frames = controller.selected.compactMap { annotation -> CGRect? in
            guard let page = annotation.page, page.document === view.document else { return nil }
            return view.convert(annotation.bounds, from: page)
        }
        let union = frames.dropFirst().reduce(frames.first) { $0?.union($1) }
        let visible = union.flatMap { $0.intersects(view.bounds) ? $0 : nil }
        if controller.selectionFrame.map({ old in visible.map { abs(old.minX - $0.minX) + abs(old.minY - $0.minY) + abs(old.width - $0.width) + abs(old.height - $0.height) > 0.5 } ?? true }) ?? (visible != nil) {
            controller.selectionFrame = visible
        }
    }

    // MARK: - Taps

    private func handleTap(at point: CGPoint) -> Bool {
        guard let view, let page = view.page(for: point, nearest: false) else {
            if !controller.selected.isEmpty { controller.deselect(); return true }
            return false
        }
        let tool = controller.tool
        // Drawing tools handle their own taps through the drag recogniser.
        if let tool, tool != .select { return true }
        let pagePoint = view.convert(point, to: page)
        if let mark = controller.mark(at: pagePoint, on: page, includeLinks: tool == .select) {
            controller.select([mark])
            return true
        }
        if !controller.selected.isEmpty {
            controller.deselect()
            return true
        }
        return false
    }

    // MARK: - Drawing

    @objc private func handleDraw(_ recognizer: AnnotateDragRecognizer) {
        guard let view, let tool = controller.tool else { return }
        switch recognizer.state {
        case .began:
            let start = recognizer.startLocation
            guard let page = view.page(for: start, nearest: true) else { return }
            livePage = page
            liveTool = tool
            livePoints = [view.convert(start, to: page)]
            _ = recognizer.drainPoints()
            if tool.isMarkup { updateMarkupSelection() }
            overlay.setNeedsDisplay()
        case .changed:
            guard let page = livePage else { return }
            let points = recognizer.drainPoints().map { view.convert($0, to: page) }
            switch tool {
            case .ink, .eraser:
                let minimum = 0.6 / max(view.scaleFactor, 0.1)
                for point in points where livePoints.last.map({ hypot($0.x - point.x, $0.y - point.y) >= minimum }) ?? true {
                    livePoints.append(point)
                }
            default:
                if let last = points.last { livePoints = [livePoints[0], last] }
            }
            if tool.isMarkup { updateMarkupSelection() }
            overlay.setNeedsDisplay()
        case .ended:
            if let page = livePage, let last = recognizer.drainPoints().last {
                let point = view.convert(last, to: page)
                if tool == .ink || tool == .eraser { livePoints.append(point) } else { livePoints = [livePoints[0], point] }
            }
            finish(tool, in: view)
            cancelLive()
        default:
            if tool.isMarkup { view.clearSelection() }
            cancelLive()
        }
    }

    private func updateMarkupSelection() {
        guard let view, let page = livePage, let start = livePoints.first else { return }
        let end = livePoints.last ?? start
        let selection = hypot(end.x - start.x, end.y - start.y) < 2 / max(view.scaleFactor, 0.1)
            ? page.selectionForWord(at: start)
            : page.selection(from: start, to: end)
        liveSelection = selection
        view.currentSelection = selection
    }

    private func finish(_ tool: AnnotateTool, in view: VivePDFView) {
        guard let page = livePage, let start = livePoints.first else { return }
        let end = livePoints.last ?? start
        let scale = max(view.scaleFactor, 0.1)
        let isTap = hypot(end.x - start.x, end.y - start.y) * scale < 6
        switch tool {
        case .ink:
            controller.addInk(livePoints, on: page)
        case .eraser:
            controller.erase(along: livePoints, radius: controller.eraserSize / scale, on: page)
        case .square, .circle, .line, .arrow:
            controller.addShape(tool, from: start, to: end, on: page)
        case .highlight, .underline, .strikeout, .squiggly:
            if let selection = liveSelection { controller.markupSelection(with: tool, selection: selection) }
            view.clearSelection()
        case .freeText:
            controller.addFreeText(in: isTap ? nil : AnnotationGeometry.area(from: start, to: end), at: start, on: page)
        case .note:
            controller.addNote(at: end, on: page)
        case .stamp:
            controller.addStamp(at: end, on: page)
        case .link:
            let rect = AnnotationGeometry.area(from: start, to: end)
            if !isTap { controller.linkDraft = AnnotationController.LinkDraft(page: page, rect: rect) }
        case .area:
            if isTap {
                controller.deselect()
            } else {
                controller.select(controller.marks(in: AnnotationGeometry.area(from: start, to: end), on: page))
            }
        case .select:
            break
        }
    }

    // MARK: - Move & resize

    private func resizable(_ annotation: PDFAnnotation) -> Bool {
        ["Square", "Circle", "Ink", "FreeText", "Stamp", "Link"].contains(AnnotationKind.of(annotation))
    }

    private func movable(_ annotation: PDFAnnotation) -> Bool {
        !["Highlight", "Underline", "StrikeOut", "Squiggly"].contains(AnnotationKind.of(annotation))
    }

    private func lineEnds(_ annotation: PDFAnnotation) -> (CGPoint, CGPoint)? {
        if let curved = annotation as? CurvedLineAnnotation {
            let points = curved.pageVertices
            guard let first = points.first, let last = points.last else { return nil }
            return (first, last)
        }
        guard AnnotationKind.of(annotation) == "Line" else { return nil }
        let origin = annotation.bounds.origin
        return (CGPoint(x: origin.x + annotation.startPoint.x, y: origin.y + annotation.startPoint.y),
                CGPoint(x: origin.x + annotation.endPoint.x, y: origin.y + annotation.endPoint.y))
    }

    private func dragTarget(at point: CGPoint) -> DragTarget? {
        guard let view, let first = controller.selected.first, let page = first.page, page.document === view.document,
              controller.selected.allSatisfy({ $0.page === page }) else { return nil }
        let reach: CGFloat = 22
        if controller.selected.count == 1 {
            if let (start, end) = lineEnds(first) {
                let startView = view.convert(start, from: page), endView = view.convert(end, from: page)
                if hypot(point.x - startView.x, point.y - startView.y) < reach { return .lineStart }
                if hypot(point.x - endView.x, point.y - endView.y) < reach { return .lineEnd }
            } else if resizable(first) {
                for handle in AnnotationGeometry.ResizeHandle.allCases {
                    let spot = view.convert(handle.point(in: first.bounds), from: page)
                    if hypot(point.x - spot.x, point.y - spot.y) < reach { return .handle(handle) }
                }
            }
        }
        guard controller.selected.contains(where: movable) else { return nil }
        let frames = controller.selected.map { view.convert($0.bounds, from: page).insetBy(dx: -10, dy: -10) }
        return frames.contains { $0.contains(point) } ? .body : nil
    }

    @objc private func handleMove(_ recognizer: AnnotateDragRecognizer) {
        guard let view else { return }
        switch recognizer.state {
        case .began:
            guard let target = dragTarget(at: recognizer.startLocation), let page = controller.selected.first?.page else { return }
            dragTarget = target
            dragPage = page
            dragStart = view.convert(recognizer.startLocation, to: page)
            originals = controller.selected.filter(movable).map { ($0, AnnotationSnapshot($0), $0.bounds) }
            controller.dragging = true
        case .changed:
            guard let page = dragPage, let target = dragTarget, let last = recognizer.drainPoints().last else { return }
            let current = view.convert(last, to: page)
            let delta = CGVector(dx: current.x - dragStart.x, dy: current.y - dragStart.y)
            apply(target, delta: delta)
            refreshOverlay()
        case .ended:
            if !originals.isEmpty { controller.commitReshape(originals.map { ($0.0, $0.1) }) }
            endMove()
        default:
            for (annotation, snapshot, _) in originals {
                snapshot.restore(annotation)
                if let page = annotation.page { view.annotationsChanged(on: page) }
            }
            endMove()
        }
    }

    private func apply(_ target: DragTarget, delta: CGVector) {
        switch target {
        case .body:
            for (annotation, snapshot, bounds) in originals {
                controller.reshape(annotation, original: snapshot, from: bounds, to: bounds.offsetBy(dx: delta.dx, dy: delta.dy))
            }
        case .handle(let handle):
            guard let (annotation, snapshot, bounds) = originals.first else { return }
            controller.reshape(annotation, original: snapshot, from: bounds, to: AnnotationGeometry.resize(bounds, handle: handle, by: delta))
        case .lineStart, .lineEnd:
            guard let (annotation, snapshot, _) = originals.first else { return }
            snapshot.restore(annotation)
            guard let (start, end) = lineEnds(annotation) else { return }
            let moved = CGPoint(x: (isStart(target) ? start : end).x + delta.dx, y: (isStart(target) ? start : end).y + delta.dy)
            let newStart = isStart(target) ? moved : start
            let newEnd = isStart(target) ? end : moved
            if let curved = annotation as? CurvedLineAnnotation {
                let curve = AnnotationGeometry.curve(fromVertices: curved.pageVertices)
                AnnotationController.setPageVertices(AnnotationGeometry.curvedVertices(start: newStart, end: newEnd, curve: curve), on: curved)
            } else {
                AnnotationController.setLine(annotation, start: newStart, end: newEnd)
            }
            if let page = annotation.page { view?.annotationsChanged(on: page) }
        }
    }

    private func isStart(_ target: DragTarget) -> Bool {
        if case .lineStart = target { return true }
        return false
    }

    private func endMove() {
        dragTarget = nil
        dragPage = nil
        originals = []
        controller.dragging = false
        refreshOverlay()
    }

    // MARK: - UIGestureRecognizerDelegate

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        if gestureRecognizer === moveRecognizer {
            guard controller.tool == nil || controller.tool == .select || controller.tool == .area else { return false }
            return dragTarget(at: moveRecognizer.startLocation) != nil
        }
        return true
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === drawRecognizer else { return false }
        if other is UIPinchGestureRecognizer { return true }
        if let pan = other as? UIPanGestureRecognizer, pan.minimumNumberOfTouches >= 2 { return true }
        return false
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        // Scrolling waits until we know the touch is not on a selected mark.
        gestureRecognizer === moveRecognizer && (other.view is UIScrollView || other is UILongPressGestureRecognizer)
    }

    // MARK: - Apple Pencil

    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        guard let tool = controller.tool, AnnotateTool.drawTools.contains(tool) else { return }
        controller.toggleEraser()
    }

    // MARK: - Drawing the overlay

    func drawOverlay(in context: CGContext) {
        guard let view else { return }
        let scale = max(view.scaleFactor, 0.1)
        let tint = UIColor.tintColor

        // Selected marks: dashed frame + handles.
        for annotation in controller.selected {
            guard let page = annotation.page, page.document === view.document else { continue }
            let frame = view.convert(annotation.bounds, from: page).insetBy(dx: -3, dy: -3)
            context.setStrokeColor(tint.cgColor)
            context.setLineWidth(1.5)
            context.setLineDash(phase: 0, lengths: [5, 3])
            context.stroke(frame)
            context.setLineDash(phase: 0, lengths: [])
            guard controller.selected.count == 1 else { continue }
            var spots: [CGPoint] = []
            if let (start, end) = lineEnds(annotation) {
                spots = [view.convert(start, from: page), view.convert(end, from: page)]
            } else if resizable(annotation) {
                spots = AnnotationGeometry.ResizeHandle.allCases.map { view.convert($0.point(in: annotation.bounds), from: page) }
            }
            for spot in spots {
                let dot = CGRect(x: spot.x - 6, y: spot.y - 6, width: 12, height: 12)
                context.setFillColor(UIColor.systemBackground.cgColor)
                context.fillEllipse(in: dot)
                context.setStrokeColor(tint.cgColor)
                context.setLineWidth(2)
                context.strokeEllipse(in: dot)
            }
        }

        // Live gesture preview.
        guard let page = livePage, let tool = liveTool, let first = livePoints.first else { return }
        let points = livePoints.map { view.convert($0, from: page) }
        let start = view.convert(first, from: page)
        let end = points.last ?? start
        let style = controller.style(for: tool)
        let color = style.color.withAlphaComponent(style.opacity)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        switch tool {
        case .ink:
            context.setStrokeColor(color.cgColor)
            context.setLineWidth(style.strokeWidth * scale)
            context.move(to: start)
            points.dropFirst().forEach { context.addLine(to: $0) }
            if points.count == 1 { context.addLine(to: CGPoint(x: start.x + 0.1, y: start.y)) }
            context.strokePath()
        case .eraser:
            let radius = controller.eraserSize
            context.setStrokeColor(UIColor.systemGray.withAlphaComponent(0.3).cgColor)
            context.setLineWidth(radius * 2)
            context.move(to: start)
            points.dropFirst().forEach { context.addLine(to: $0) }
            context.strokePath()
            context.setStrokeColor(UIColor.label.withAlphaComponent(0.6).cgColor)
            context.setLineWidth(1)
            context.strokeEllipse(in: CGRect(x: end.x - radius, y: end.y - radius, width: radius * 2, height: radius * 2))
        case .square, .circle:
            let rect = AnnotationGeometry.area(from: start, to: end)
            context.setStrokeColor(color.cgColor)
            context.setLineWidth(style.strokeWidth * scale)
            if style.dashed { context.setLineDash(phase: 0, lengths: AnnotateStyle.dashPattern.map { $0 * scale }) }
            if let fill = style.fill {
                context.setFillColor(fill.withAlphaComponent(style.opacity).cgColor)
                if tool == .square { context.fill(rect) } else { context.fillEllipse(in: rect) }
            }
            if tool == .square { context.stroke(rect) } else { context.strokeEllipse(in: rect) }
            context.setLineDash(phase: 0, lengths: [])
        case .line, .arrow:
            context.setStrokeColor(color.cgColor)
            context.setLineWidth(style.strokeWidth * scale)
            context.move(to: start)
            context.addLine(to: end)
            context.strokePath()
        case .area, .link, .freeText:
            let rect = AnnotationGeometry.area(from: start, to: end)
            context.setFillColor(tint.withAlphaComponent(0.08).cgColor)
            context.fill(rect)
            context.setStrokeColor(tint.cgColor)
            context.setLineWidth(1)
            context.setLineDash(phase: 0, lengths: [4, 3])
            context.stroke(rect)
            context.setLineDash(phase: 0, lengths: [])
        default:
            break
        }
    }
}
