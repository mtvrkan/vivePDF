import Observation
import PDFKit
import SwiftUI
import UIKit

/// Persisted presentation preferences (`vivepdf.presentation`, same fields as the desktop store).
struct PresentationPrefs: Codable, Equatable {
    var penColor = "#E5484D"
    var penWidth: CGFloat = 3
    var highlighterWidth: CGFloat = 18
    var penOpacity: CGFloat = 1
    var shapeKind: PresentationShape = .arrow
    var textSize: CGFloat = 28
    var laserColor = "#E5484D"
    var laserSize: CGFloat = 8
    var spotlightRadius: CGFloat = 180
    var spotlightDim: CGFloat = 0.78
    var magnifierSize: CGFloat = 220
    var magnifierZoom: CGFloat = 2.5
    var showClock = false
    var showTimer = false
    var annotationsMode = false

    static let storageKey = "vivepdf.presentation"

    static func load() -> PresentationPrefs {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let prefs = try? JSONDecoder().decode(PresentationPrefs.self, from: data) else { return PresentationPrefs() }
        return prefs
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) { UserDefaults.standard.set(data, forKey: Self.storageKey) }
    }
}

/// Slide transition (iOS addition; the desktop switches instantly).
enum SlideTransition: String, CaseIterable, Identifiable {
    case none, fade, push
    var id: String { rawValue }
    var labelKey: String { "ios.viewer.presentation.transition.\(rawValue)" }
}

enum BlackoutMode: String { case none, black, white }

/// Where a drawing lives: a slide, or the black/white board shown during blackout.
enum DrawingSurface: Hashable {
    case page(Int)
    case board(BlackoutMode)
}

/// A laser trail sample.
struct LaserSample {
    var point: CGPoint
    var time: TimeInterval
}

/// Per-document presentation state: slide, tools, drawings, blackout, timer, overview, external screen.
@MainActor
@Observable
final class PresentationController {
    let session: ViewerSession

    var pageIndex = 0
    /// +1 / -1 for the push transition direction.
    var lastStep = 1
    var tool: PresentationTool = .pointer
    var prefs = PresentationPrefs.load() { didSet { if prefs != oldValue { prefs.save() } } }
    var blackout: BlackoutMode = .none
    var overviewOpen = false
    var chromeVisible = true
    var styleOpen = false
    var settingsOpen = false

    // Drawings
    private(set) var strokes: [DrawingSurface: [PresentationStroke]] = [:]
    private var redo: [DrawingSurface: [PresentationStroke]] = [:]
    var live: PresentationStroke?
    var selectedID: String?
    /// Annotations written into the PDF while "save drawings as permanent notes" is on.
    private(set) var sessionAnnotations: [(page: Int, annotation: PDFAnnotation)] = []
    /// Bumped when page images must be re-rendered (an annotation was written onto the slide).
    var renderRevision = 0

    // Pointer tools
    var pointer: CGPoint?
    var laserTrail: [LaserSample] = []
    /// Normalised rect of the slide that is zoomed into (nil = whole slide).
    var zoomRect: CGRect?
    var areaZoomArmed = false
    var areaDraft: CGRect?

    // Text tool
    var textDraftAt: CGPoint?
    var textDraft = ""

    // Timer
    var timerRunning = false
    var timerStartedAt: Date?
    var timerElapsed: TimeInterval = 0

    // Page jump by typed digits
    var jumpBuffer = ""
    @ObservationIgnored private var jumpTask: Task<Void, Never>?

    /// Apple Pencil seen during this presentation: fingers then navigate instead of drawing.
    var pencilDetected = UIPencilInteraction.prefersPencilOnlyDrawing
    var externalConnected = false

    @ObservationIgnored private var hideTask: Task<Void, Never>?

    init(session: ViewerSession) {
        self.session = session
    }

    static func of(_ session: ViewerSession) -> PresentationController {
        session.service(PresentationController.self) { PresentationController(session: session) }
    }

    var pageCount: Int { session.pageCount }

    // MARK: - Lifecycle

    func begin(at start: Int?) {
        pageIndex = min(max(0, start ?? session.currentPageIndex), max(0, pageCount - 1))
        tool = .pointer
        blackout = .none
        overviewOpen = false
        zoomRect = nil
        live = nil
        selectedID = nil
        showChrome()
    }

    /// Leaves the presentation on the slide the presenter reached (desktop `exitImmersive`).
    func end() {
        timerRunning = false
        session.go(toPage: pageIndex)
        session.presenting = false
    }

    // MARK: - Navigation

    func go(to index: Int) {
        guard pageCount > 0 else { return }
        let target = min(max(0, index), pageCount - 1)
        guard target != pageIndex else { return }
        lastStep = target > pageIndex ? 1 : -1
        pageIndex = target
        zoomRect = nil
        selectedID = nil
        laserTrail = []
    }

    func next() { go(to: pageIndex + 1) }
    func previous() { go(to: pageIndex - 1) }

    func typeDigit(_ digit: Character) {
        jumpBuffer = PresentationGeometry.appendJumpDigit(jumpBuffer, digit)
        jumpTask?.cancel()
        jumpTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(1200))
            guard !Task.isCancelled else { return }
            self?.jumpBuffer = ""
        }
    }

    /// Enter after typed digits jumps there; returns false when there was nothing typed.
    func commitJump() -> Bool {
        guard !jumpBuffer.isEmpty else { return false }
        if let page = PresentationGeometry.resolveJump(jumpBuffer, pageCount: pageCount) { go(to: page) }
        jumpBuffer = ""
        return true
    }

    // MARK: - Chrome

    func showChrome() {
        chromeVisible = true
        scheduleHide()
    }

    func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(3000))
            guard !Task.isCancelled, let self, !self.styleOpen, !self.settingsOpen, self.textDraftAt == nil,
                  self.tool == .pointer || self.tool.tracksPointer else { return }
            withAnimation(.easeOut(duration: 0.25)) { self.chromeVisible = false }
        }
    }

    func toggleChrome() {
        if chromeVisible { withAnimation { chromeVisible = false } } else { showChrome() }
    }

    // MARK: - Tools

    func toggle(_ next: PresentationTool) {
        tool = tool == next ? .pointer : next
        if !tool.hasStyleOptions { styleOpen = false }
        selectedID = nil
        pointer = nil
        laserTrail = []
        textDraftAt = nil
    }

    func toggleBlackout(_ mode: BlackoutMode) {
        blackout = blackout == mode ? .none : mode
        selectedID = nil
    }

    var surface: DrawingSurface { blackout == .none ? .page(pageIndex) : .board(blackout) }

    func strokes(on surface: DrawingSurface) -> [PresentationStroke] { strokes[surface] ?? [] }

    var visibleStrokes: [PresentationStroke] { strokes(on: surface) }

    var visibleCount: Int { visibleStrokes.count }

    var totalCount: Int { strokes.values.reduce(0) { $0 + $1.count } }

    var inkColor: String { prefs.penColor }

    /// Colour used on the current surface (dark ink becomes white on the black board).
    func displayColor(_ hex: String) -> String {
        blackout == .black ? PresentationGeometry.readableOnDark(hex) : hex
    }

    // MARK: - Drawing

    func beginStroke(at point: CGPoint, surfaceSize: CGSize) {
        let width = max(surfaceSize.width, 1)
        let id = PresentationStroke.makeID()
        switch tool {
        case .pen:
            live = PresentationStroke(id: id, kind: .pen, color: prefs.penColor, width: prefs.penWidth / width, points: [point],
                                      opacity: prefs.penOpacity < 1 ? prefs.penOpacity : nil)
        case .highlighter:
            live = PresentationStroke(id: id, kind: .highlighter, color: prefs.penColor, width: prefs.highlighterWidth / width, points: [point])
        case .shape:
            live = PresentationStroke(id: id, kind: prefs.shapeKind.strokeKind, color: prefs.penColor, width: prefs.penWidth / width, points: [point, point],
                                      opacity: prefs.penOpacity < 1 ? prefs.penOpacity : nil)
        default:
            live = nil
        }
    }

    func extendStroke(to point: CGPoint, surfaceSize: CGSize, constrain: Bool) {
        guard var stroke = live else { return }
        if stroke.isFreehand {
            stroke.points.append(point)
        } else {
            let start = stroke.points[0]
            stroke.points = [start, constrain ? PresentationGeometry.constrainedEnd(stroke.kind, start: start, point: point, surface: surfaceSize) : point]
        }
        live = stroke
    }

    func finishStroke(surfaceSize: CGSize) {
        guard let stroke = live else { return }
        live = nil
        guard PresentationGeometry.isKept(stroke, surface: surfaceSize) else { return }
        add(stroke)
    }

    func add(_ stroke: PresentationStroke) {
        let target = surface
        if prefs.annotationsMode, case .page(let page) = target {
            writeAnnotation(stroke, page: page)
            return
        }
        strokes[target, default: []].append(stroke)
        redo[target] = []
    }

    func undo() {
        if prefs.annotationsMode, blackout == .none {
            session.undoManager.undo()
            renderRevision += 1
            return
        }
        let target = surface
        guard var list = strokes[target], let last = list.popLast() else { return }
        strokes[target] = list
        redo[target, default: []].append(last)
    }

    func redoStroke() {
        if prefs.annotationsMode, blackout == .none {
            session.undoManager.redo()
            renderRevision += 1
            return
        }
        let target = surface
        guard var list = redo[target], let last = list.popLast() else { return }
        redo[target] = list
        strokes[target, default: []].append(last)
    }

    var canUndo: Bool {
        if prefs.annotationsMode, blackout == .none { return renderRevision >= 0 && session.undoManager.canUndo }
        return !(strokes[surface] ?? []).isEmpty
    }
    var canRedo: Bool {
        if prefs.annotationsMode, blackout == .none { return renderRevision >= 0 && session.undoManager.canRedo }
        return !(redo[surface] ?? []).isEmpty
    }

    /// Erases around a normalised point with a radius in slide points.
    func erase(at point: CGPoint, radiusPoints: CGFloat, surfaceSize: CGSize) {
        let target = surface
        guard let list = strokes[target], !list.isEmpty else { return }
        let radius = radiusPoints / max(surfaceSize.width, 1)
        var changed = false
        var result: [PresentationStroke] = []
        for stroke in list {
            if let pieces = PresentationGeometry.erase(stroke, at: point, radius: radius) {
                changed = true
                result += pieces
            } else {
                result.append(stroke)
            }
        }
        if changed {
            strokes[target] = result
            redo[target] = []
        }
    }

    func select(at point: CGPoint, surfaceSize: CGSize) {
        selectedID = PresentationGeometry.topDrawing(in: visibleStrokes, at: point, tolerance: 10, scale: surfaceSize)?.id
    }

    func moveSelected(by delta: CGSize) {
        guard let id = selectedID, var list = strokes[surface], let index = list.firstIndex(where: { $0.id == id }) else { return }
        list[index] = PresentationGeometry.translated(list[index], dx: delta.width, dy: delta.height)
        strokes[surface] = list
    }

    func deleteSelected() {
        guard let id = selectedID else { return }
        strokes[surface]?.removeAll { $0.id == id }
        selectedID = nil
    }

    var selectedStroke: PresentationStroke? {
        guard let id = selectedID else { return nil }
        return visibleStrokes.first { $0.id == id }
    }

    func commitText(surfaceSize: CGSize) {
        defer { textDraftAt = nil; textDraft = "" }
        guard let anchor = textDraftAt else { return }
        let text = textDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let width = max(surfaceSize.width, 1), height = max(surfaceSize.height, 1)
        let font = UIFont.systemFont(ofSize: prefs.textSize, weight: .semibold)
        let lines = text.components(separatedBy: "\n")
        let measured = lines.map { ($0 as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0
        let blockHeight = CGFloat(lines.count) * prefs.textSize * PresentationGeometry.textLineHeight
        add(PresentationStroke(id: PresentationStroke.makeID("text"), kind: .text, color: prefs.penColor, width: 0, points: [anchor],
                               text: text, fontSize: prefs.textSize / width, size: CGSize(width: ceil(measured) / width, height: ceil(blockHeight) / height)))
    }

    // MARK: - Cleanup

    func clearVisible() {
        if prefs.annotationsMode, blackout == .none {
            clearSessionAnnotations(page: pageIndex)
        } else {
            strokes[surface] = []
            redo[surface] = []
        }
        selectedID = nil
    }

    func clearAll() {
        if prefs.annotationsMode {
            clearSessionAnnotations(page: nil)
        } else {
            strokes = [:]
            redo = [:]
        }
        selectedID = nil
    }

    var cleanupPageCount: Int {
        prefs.annotationsMode && blackout == .none ? sessionAnnotations.filter { $0.page == pageIndex }.count : visibleCount
    }

    var cleanupTotalCount: Int { prefs.annotationsMode ? sessionAnnotations.count : totalCount }

    // MARK: - Timer

    var timerValue: TimeInterval {
        if timerRunning, let started = timerStartedAt { return timerElapsed + Date().timeIntervalSince(started) }
        return timerElapsed
    }

    func toggleTimerRunning() {
        if timerRunning {
            timerElapsed = timerValue
            timerStartedAt = nil
            timerRunning = false
        } else {
            timerStartedAt = Date()
            timerRunning = true
        }
    }

    func resetTimer() {
        timerElapsed = 0
        timerStartedAt = timerRunning ? Date() : nil
    }

    // MARK: - Laser

    @ObservationIgnored private var laserTask: Task<Void, Never>?

    /// Clears the trail once it has faded, so the animation timeline stops.
    func fadeLaser() {
        laserTask?.cancel()
        laserTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled, let self else { return }
            let now = Date().timeIntervalSinceReferenceDate
            if let last = self.laserTrail.last, now - last.time > 0.7 { self.laserTrail = [] }
        }
    }

    func addLaser(_ point: CGPoint) {
        let now = Date().timeIntervalSinceReferenceDate
        laserTrail.append(LaserSample(point: point, time: now))
        laserTrail.removeAll { now - $0.time > 0.7 }
    }

    // MARK: - Permanent notes (annotations mode)

    /// Writes a drawing into the PDF as a real annotation (desktop "Save drawings as permanent notes").
    private func writeAnnotation(_ stroke: PresentationStroke, page index: Int) {
        guard let page = session.pdf.page(at: index),
              let annotation = PresentationAnnotationWriter.annotation(for: stroke, on: page) else { return }
        annotation.userName = AppModel.shared.authorName
        annotation.modificationDate = Date()
        _ = annotation.setValue(UUID().uuidString, forAnnotationKey: PDFAnnotationKey(rawValue: "/NM"))
        insert(annotation, on: page, index: index)
    }

    private func insert(_ annotation: PDFAnnotation, on page: PDFPage, index: Int) {
        page.addAnnotation(annotation)
        sessionAnnotations.append((index, annotation))
        session.undoManager.registerUndo(withTarget: self) { controller in
            MainActor.assumeIsolated { controller.remove(annotation, from: page, index: index) }
        }
        session.markEdited()
        renderRevision += 1
    }

    private func remove(_ annotation: PDFAnnotation, from page: PDFPage, index: Int) {
        page.removeAnnotation(annotation)
        sessionAnnotations.removeAll { $0.annotation === annotation }
        session.undoManager.registerUndo(withTarget: self) { controller in
            MainActor.assumeIsolated { controller.insert(annotation, on: page, index: index) }
        }
        session.markEdited()
        renderRevision += 1
    }

    private func clearSessionAnnotations(page: Int?) {
        let doomed = sessionAnnotations.filter { page == nil || $0.page == page }
        guard !doomed.isEmpty else { return }
        for item in doomed {
            item.annotation.page?.removeAnnotation(item.annotation)
        }
        sessionAnnotations.removeAll { item in doomed.contains { $0.annotation === item.annotation } }
        session.markEdited()
        renderRevision += 1
        session.show(ViewerToast(text: t("presentation.cleanup.cleared")))
    }

    // MARK: - Area zoom

    /// Zooms into a dragged normalised area; tiny drags reset the zoom.
    func applyAreaZoom(_ rect: CGRect) {
        areaZoomArmed = false
        areaDraft = nil
        let normalized = rect.standardized
        guard normalized.width > 0.02, normalized.height > 0.02 else { zoomRect = nil; return }
        zoomRect = normalized.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    }
}

/// Converts presentation drawings into PDF annotations on a page.
enum PresentationAnnotationWriter {
    /// Maps a normalised slide point (top-left origin, displayed orientation) into page space.
    static func pagePoint(_ point: CGPoint, on page: PDFPage) -> CGPoint {
        let crop = page.bounds(for: .cropBox)
        let rotation = ((page.rotation % 360) + 360) % 360
        let w = crop.width, h = crop.height
        let displayed = rotation % 180 == 0 ? CGSize(width: w, height: h) : CGSize(width: h, height: w)
        let x = point.x * displayed.width
        let y = (1 - point.y) * displayed.height
        let (u, v): (CGFloat, CGFloat) = switch rotation {
        case 90: (w - y, x)
        case 180: (w - x, h - y)
        case 270: (y, h - x)
        default: (x, y)
        }
        return CGPoint(x: crop.minX + u, y: crop.minY + v)
    }

    /// Width of the displayed slide in PDF points (widths and font sizes are fractions of it).
    static func displayedWidth(of page: PDFPage) -> CGFloat {
        let crop = page.bounds(for: .cropBox)
        return page.rotation % 180 == 0 ? crop.width : crop.height
    }

    static func color(_ hex: String, alpha: CGFloat = 1) -> UIColor {
        guard let rgb = PresentationGeometry.rgb(hex) else { return UIColor.red.withAlphaComponent(alpha) }
        return UIColor(red: rgb.r, green: rgb.g, blue: rgb.b, alpha: alpha)
    }

    static func annotation(for stroke: PresentationStroke, on page: PDFPage) -> PDFAnnotation? {
        let scale = displayedWidth(of: page)
        let lineWidth = max(0.5, stroke.width * scale)
        let alpha = stroke.kind == .highlighter ? PresentationGeometry.highlighterAlpha : (stroke.opacity ?? 1)
        let points = stroke.points.map { pagePoint($0, on: page) }
        guard !points.isEmpty else { return nil }
        let border = PDFBorder()
        border.lineWidth = lineWidth

        func box(_ list: [CGPoint], pad: CGFloat) -> CGRect {
            let xs = list.map(\.x), ys = list.map(\.y)
            return CGRect(x: xs.min()! - pad, y: ys.min()! - pad, width: xs.max()! - xs.min()! + pad * 2, height: ys.max()! - ys.min()! + pad * 2)
        }

        switch stroke.kind {
        case .pen, .highlighter:
            let bounds = box(points, pad: lineWidth)
            let annotation = PDFAnnotation(bounds: bounds, forType: .ink, withProperties: nil)
            let path = UIBezierPath()
            path.move(to: CGPoint(x: points[0].x - bounds.minX, y: points[0].y - bounds.minY))
            for point in points.dropFirst() { path.addLine(to: CGPoint(x: point.x - bounds.minX, y: point.y - bounds.minY)) }
            path.lineWidth = lineWidth
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            annotation.add(path)
            annotation.border = border
            annotation.color = color(stroke.color, alpha: alpha)
            return annotation
        case .line, .arrow:
            guard points.count > 1 else { return nil }
            let head = stroke.kind == .arrow ? PresentationGeometry.arrowHeadLength(lineWidth: lineWidth) : 0
            let bounds = box(Array(points.prefix(2)), pad: lineWidth + head)
            let annotation = PDFAnnotation(bounds: bounds, forType: .line, withProperties: nil)
            annotation.startPoint = CGPoint(x: points[0].x - bounds.minX, y: points[0].y - bounds.minY)
            annotation.endPoint = CGPoint(x: points[1].x - bounds.minX, y: points[1].y - bounds.minY)
            annotation.startLineStyle = .none
            annotation.endLineStyle = stroke.kind == .arrow ? .openArrow : .none
            annotation.border = border
            annotation.color = color(stroke.color, alpha: alpha)
            return annotation
        case .rect, .ellipse:
            guard points.count > 1 else { return nil }
            let bounds = box(Array(points.prefix(2)), pad: lineWidth / 2)
            let annotation = PDFAnnotation(bounds: bounds, forType: stroke.kind == .rect ? .square : .circle, withProperties: nil)
            annotation.border = border
            annotation.color = color(stroke.color, alpha: alpha)
            return annotation
        case .text:
            guard let text = stroke.text, let size = stroke.size else { return nil }
            let corner = pagePoint(stroke.points[0], on: page)
            let far = pagePoint(CGPoint(x: stroke.points[0].x + size.width, y: stroke.points[0].y + size.height), on: page)
            let bounds = CGRect(x: min(corner.x, far.x), y: min(corner.y, far.y), width: abs(far.x - corner.x) + 8, height: abs(far.y - corner.y) + 4)
            let annotation = PDFAnnotation(bounds: bounds, forType: .freeText, withProperties: nil)
            annotation.contents = text
            annotation.font = UIFont.systemFont(ofSize: max(4, (stroke.fontSize ?? 0.03) * scale), weight: .semibold)
            annotation.fontColor = color(stroke.color, alpha: alpha)
            annotation.color = .clear
            let none = PDFBorder()
            none.lineWidth = 0
            annotation.border = none
            return annotation
        }
    }
}
