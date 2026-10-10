import Observation
import PDFKit
import SwiftUI
import UIKit

/// Per-document annotate state and actions (desktop `AnnotateBar` logic + embedpdf annotation plugin):
/// the armed tool, tool styles, the selected marks, and every create/modify/delete with undo.
/// Touch input lives in `AnnotateInputHandler`; this type stays UI-free apart from the live preview data.
@MainActor
@Observable
final class AnnotationController {
    static func of(_ session: ViewerSession) -> AnnotationController {
        session.service(AnnotationController.self) { AnnotationController(session: session) }
    }

    unowned let session: ViewerSession

    /// Armed tool; nil = plain reading (taps on marks still select them, like the desktop).
    var tool: AnnotateTool? {
        didSet {
            guard tool != oldValue else { return }
            if let tool, tool.isMarkup, session.selection != nil { markupSelection(with: tool) }
            if tool != .select && tool != .area && tool != nil { deselect() }
            if tool?.draws == true, let previous = oldValue, AnnotateTool.drawTools.contains(previous), previous != .eraser { lastDrawTool = previous }
            input.update()
        }
    }
    @ObservationIgnored private var lastDrawTool: AnnotateTool = .ink
    var styles: [AnnotateTool: AnnotateStyle] = [:]
    var selected: [PDFAnnotation] = [] {
        didSet { selectionChanged(oldValue) }
    }
    /// Selection bounds in page-view coordinates (for the floating selection menu).
    var selectionFrame: CGRect?
    var dragging = false
    var eraserSize: CGFloat = 10
    var pencilOnly: Bool {
        didSet { UserDefaults.standard.set(pencilOnly, forKey: "vivepdf.viewer.annotate.pencilOnly"); input.update() }
    }
    var stamp: AnnotateStamp = .approved
    /// Free text box or note whose text is being edited (`isNew` = drop it if left untouched).
    var textEditing: TextEditing?
    /// Area dragged with the link tool, waiting for a target.
    var linkDraft: LinkDraft?
    var canUndo = false
    var canRedo = false

    struct TextEditing: Identifiable {
        let id = UUID()
        let annotation: PDFAnnotation
        let page: PDFPage
        let isNew: Bool
    }

    struct LinkDraft: Identifiable {
        let id = UUID()
        let page: PDFPage
        let rect: CGRect
    }

    static let minEraser: CGFloat = 4
    static let maxEraser: CGFloat = 40

    @ObservationIgnored private(set) lazy var input = AnnotateInputHandler(controller: self)
    @ObservationIgnored private var continuous: [(PDFAnnotation, AnnotationSnapshot)]?
    @ObservationIgnored private var undoObservers: [NSObjectProtocol] = []

    private init(session: ViewerSession) {
        self.session = session
        pencilOnly = UserDefaults.standard.bool(forKey: "vivepdf.viewer.annotate.pencilOnly")
        let center = NotificationCenter.default
        for name in [Notification.Name.NSUndoManagerDidCloseUndoGroup, .NSUndoManagerDidUndoChange, .NSUndoManagerDidRedoChange, .NSUndoManagerCheckpoint] {
            undoObservers.append(center.addObserver(forName: name, object: session.undoManager, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.refreshUndo() }
            })
        }
    }

    // MARK: - Attach to the live view

    /// Installs touch handling on the current page view (call again after the document or view changes).
    func attach() {
        guard let view = session.pdfView else { return }
        if input.view !== view || input.document !== session.pdf {
            selected = []
            textEditing = nil
            linkDraft = nil
        }
        input.install(on: view, document: session.pdf)
    }

    func disarm() {
        tool = nil
        deselect()
        input.cancelLive()
    }

    func selectTool(_ next: AnnotateTool) {
        tool = tool == next ? nil : next
    }

    func toggleEraser() {
        tool = tool == .eraser ? lastDrawTool : .eraser
    }

    // MARK: - Styles

    func style(for tool: AnnotateTool) -> AnnotateStyle { styles[tool] ?? .defaults(for: tool) }

    /// Tool whose controls the style row shows: the armed tool, else the selected mark's tool.
    var styleTool: AnnotateTool? {
        if let tool, tool.hasStyle { return tool }
        if let first = selected.first { return AnnotateTool.of(first) }
        return nil
    }

    /// Style shown in the style row (armed tool defaults, or the first selected mark).
    var currentStyle: AnnotateStyle? {
        if let tool, tool.hasStyle { return style(for: tool) }
        if let first = selected.first { return AnnotateStyle.of(first) }
        return nil
    }

    /// Changes the style of new marks and of every selected mark (only the fields that changed).
    func applyStyle(_ next: AnnotateStyle) {
        let previous = currentStyle
        if let tool, tool.hasStyle { styles[tool] = next }
        guard let previous else { return }
        for annotation in selected {
            guard let markTool = AnnotateTool.of(annotation), var target = AnnotateStyle.of(annotation) else { continue }
            if next.color != previous.color { target.color = next.color }
            if next.fill != previous.fill { target.fill = next.fill }
            if next.strokeWidth != previous.strokeWidth { target.strokeWidth = next.strokeWidth }
            if next.opacity != previous.opacity { target.opacity = next.opacity }
            if next.dashed != previous.dashed { target.dashed = next.dashed }
            if next.startEnding != previous.startEnding { target.startEnding = next.startEnding }
            if next.endEnding != previous.endEnding { target.endEnding = next.endEnding }
            if next.fontSize != previous.fontSize { target.fontSize = next.fontSize }
            let upgraded = upgradeIfNeeded(annotation)
            modify(upgraded) { target.apply(to: $0, tool: markTool) }
        }
    }

    /// Starts a slider drag: changes are applied live and recorded as one undo step at the end.
    func beginContinuousEdit() {
        continuous = selected.map { ($0, AnnotationSnapshot($0)) }
    }

    func endContinuousEdit() {
        guard let saved = continuous else { return }
        continuous = nil
        for (annotation, before) in saved { registerRestore(annotation, to: before, redo: AnnotationSnapshot(annotation)) }
    }

    // MARK: - Curve (lines)

    /// The selected line when exactly one straight or curved line is selected.
    var selectedLine: PDFAnnotation? {
        guard selected.count == 1, let line = selected.first else { return nil }
        let kind = AnnotationKind.of(line)
        if kind == "Line" || line is CurvedLineAnnotation { return line }
        return nil
    }

    var curve: Double {
        guard let curved = selectedLine as? CurvedLineAnnotation else { return 0 }
        return AnnotationGeometry.curve(fromVertices: curved.pageVertices)
    }

    func applyCurve(_ value: Double) {
        guard let line = selectedLine, let page = line.page else { return }
        if let curved = line as? CurvedLineAnnotation {
            let points = curved.pageVertices
            guard let start = points.first, let end = points.last else { return }
            modify(curved) { annotation in
                guard let curved = annotation as? CurvedLineAnnotation else { return }
                Self.setPageVertices(AnnotationGeometry.curvedVertices(start: start, end: end, curve: value), on: curved)
            }
            return
        }
        guard value != 0 else { return }
        let start = CGPoint(x: line.bounds.minX + line.startPoint.x, y: line.bounds.minY + line.startPoint.y)
        let end = CGPoint(x: line.bounds.minX + line.endPoint.x, y: line.bounds.minY + line.endPoint.y)
        let width = line.border?.lineWidth ?? 2
        let curved = CurvedLineAnnotation(vertices: AnnotationGeometry.curvedVertices(start: start, end: end, curve: value), width: width)
        curved.color = line.color
        curved.border = line.border
        curved.startEnding = .from(line.startLineStyle)
        curved.endEnding = .from(line.endLineStyle)
        curved.contents = line.contents
        curved.userName = line.userName
        curved.modificationDate = Date()
        Self.stampIdentity(curved, keepingFrom: line)
        session.undoManager.beginUndoGrouping()
        delete(line, from: page)
        insert(curved, on: page)
        session.undoManager.endUndoGrouping()
        selected = [curved]
    }

    static func setPageVertices(_ points: [CGPoint], on curved: CurvedLineAnnotation) {
        let width = curved.border?.lineWidth ?? 2
        let rect = AnnotationGeometry.boundsOf(points, padding: max(width * 3, 8))
        curved.bounds = rect
        curved.vertices = points.map { CGPoint(x: $0.x - rect.minX, y: $0.y - rect.minY) }
    }

    // MARK: - Creating marks

    /// Marks the current text selection with a highlight/underline/strikeout/squiggly (one mark per page,
    /// one quad per line — desktop `markupSelection`). Used by the bar and the selection edit menu.
    func markupSelection(_ subtype: PDFAnnotationSubtype) {
        let tool: AnnotateTool = switch subtype {
        case .underline: .underline
        case .strikeOut: .strikeout
        case .highlight: .highlight
        default: subtype.rawValue.contains("Squiggly") ? .squiggly : .highlight
        }
        markupSelection(with: tool)
    }

    func markupSelection(with tool: AnnotateTool, selection explicit: PDFSelection? = nil) {
        guard tool.isMarkup, let selection = explicit ?? session.selection ?? session.pdfView?.currentSelection else { return }
        let style = style(for: tool)
        var linesByPage: [(PDFPage, [CGRect])] = []
        for line in selection.selectionsByLine() {
            for page in line.pages {
                let rect = line.bounds(for: page)
                guard rect.width > 0.5, rect.height > 0.5 else { continue }
                if let index = linesByPage.firstIndex(where: { $0.0 === page }) { linesByPage[index].1.append(rect) } else { linesByPage.append((page, [rect])) }
            }
        }
        guard !linesByPage.isEmpty else { return }
        session.undoManager.beginUndoGrouping()
        for (page, rects) in linesByPage {
            let bounds = rects.dropFirst().reduce(rects[0]) { $0.union($1) }
            let annotation: PDFAnnotation = tool == .squiggly
                ? SquigglyAnnotation(bounds: bounds, forType: PDFAnnotationSubtype(rawValue: "Squiggly"), withProperties: nil)
                : PDFAnnotation(bounds: bounds, forType: tool.subtype ?? .highlight, withProperties: nil)
            annotation.quadrilateralPoints = rects.flatMap { rect -> [NSValue] in
                let r = rect.offsetBy(dx: -bounds.minX, dy: -bounds.minY)
                return [CGPoint(x: r.minX, y: r.maxY), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY)].map { NSValue(cgPoint: $0) }
            }
            style.apply(to: annotation, tool: tool)
            stampAuthor(annotation)
            insert(annotation, on: page)
        }
        session.undoManager.endUndoGrouping()
        session.pdfView?.clearSelection()
        session.selection = nil
    }

    /// Adds a sticky note (Text annotation) at a page point and opens its text editor.
    func addNote(at pagePoint: CGPoint, on page: PDFPage) {
        let size: CGFloat = 24
        let note = PDFAnnotation(bounds: CGRect(x: pagePoint.x - size / 2, y: pagePoint.y - size / 2, width: size, height: size), forType: .text, withProperties: nil)
        note.iconType = .note
        note.color = style(for: .note).color
        note.contents = ""
        stampAuthor(note)
        page.addAnnotation(note)
        redraw(page)
        textEditing = TextEditing(annotation: note, page: page, isNew: true)
    }

    func addFreeText(in rect: CGRect?, at point: CGPoint, on page: PDFPage) {
        let style = style(for: .freeText)
        let height = ceil(style.fontSize * 1.5 + 8)
        let frame = rect.flatMap { $0.width > 20 && $0.height > 10 ? $0 : nil }
            ?? CGRect(x: point.x, y: point.y - height, width: 200, height: height)
        let box = PDFAnnotation(bounds: frame, forType: .freeText, withProperties: nil)
        box.contents = t("annotate.textPlaceholder")
        box.color = .clear
        style.apply(to: box, tool: .freeText)
        box.alignment = .left
        stampAuthor(box)
        page.addAnnotation(box)
        redraw(page)
        textEditing = TextEditing(annotation: box, page: page, isNew: true)
    }

    func addStamp(at point: CGPoint, on page: PDFPage) {
        let style = style(for: .stamp)
        let author = Self.authorName
        let mark = StampBoxAnnotation.make(text: stamp.text(author: author), standardName: stamp.standardName, at: point, color: style.color.withAlphaComponent(style.opacity))
        stampAuthor(mark)
        insert(mark, on: page)
    }

    func addShape(_ tool: AnnotateTool, from start: CGPoint, to end: CGPoint, on page: PDFPage) {
        let style = style(for: tool)
        let pad = max(style.strokeWidth * 3, 8)
        switch tool {
        case .square, .circle:
            var rect = AnnotationGeometry.area(from: start, to: end)
            if rect.width < 4 && rect.height < 4 { rect = CGRect(x: start.x - 60, y: start.y - 40, width: 120, height: 80) }
            let outer = rect.insetBy(dx: -style.strokeWidth / 2, dy: -style.strokeWidth / 2)
            let shape = PDFAnnotation(bounds: outer, forType: tool == .square ? .square : .circle, withProperties: nil)
            style.apply(to: shape, tool: tool)
            stampAuthor(shape)
            insert(shape, on: page)
        case .line, .arrow:
            guard hypot(end.x - start.x, end.y - start.y) > 3 else { return }
            let rect = AnnotationGeometry.boundsOf([start, end], padding: pad)
            let line = PDFAnnotation(bounds: rect, forType: .line, withProperties: nil)
            line.startPoint = CGPoint(x: start.x - rect.minX, y: start.y - rect.minY)
            line.endPoint = CGPoint(x: end.x - rect.minX, y: end.y - rect.minY)
            style.apply(to: line, tool: tool)
            stampAuthor(line)
            insert(line, on: page)
        default: break
        }
    }

    func addInk(_ points: [CGPoint], on page: PDFPage) {
        guard !points.isEmpty else { return }
        let style = style(for: .ink)
        let rect = AnnotationGeometry.boundsOf(points, padding: style.strokeWidth / 2 + 1)
        let ink = PDFAnnotation(bounds: rect, forType: .ink, withProperties: nil)
        ink.add(.annotateStroke(points.map { CGPoint(x: $0.x - rect.minX, y: $0.y - rect.minY) }))
        style.apply(to: ink, tool: .ink)
        stampAuthor(ink)
        insert(ink, on: page)
    }

    /// Creates a link over `rect` to a web address or a page (desktop "Add link").
    func addLink(on page: PDFPage, rect: CGRect, url: URL?, pageIndex: Int?) {
        let link = PDFAnnotation(bounds: rect, forType: .link, withProperties: nil)
        if let url {
            link.url = url
        } else if let pageIndex, let target = session.pdf.page(at: pageIndex) {
            let top = target.bounds(for: .cropBox).maxY
            link.action = PDFActionGoTo(destination: PDFDestination(page: target, at: CGPoint(x: 0, y: top)))
        } else { return }
        let border = PDFBorder()
        border.lineWidth = 0
        link.border = border
        stampAuthor(link)
        insert(link, on: page)
        session.show(ViewerToast(text: t("viewer.overlay.linkAdded")))
    }

    /// Commits or drops the text typed into a new free text box / note (desktop drops untouched boxes).
    func finishTextEditing(_ editing: TextEditing, text: String?) {
        textEditing = nil
        let annotation = editing.annotation
        let trimmed = (text ?? annotation.contents ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let untouched = trimmed.isEmpty || trimmed == t("annotate.textPlaceholder")
        if editing.isNew {
            editing.page.removeAnnotation(annotation)
            redraw(editing.page)
            guard text != nil, !untouched else { return }
            annotation.contents = trimmed
            if AnnotationKind.of(annotation) == "FreeText" { Self.fitFreeText(annotation) }
            insert(annotation, on: editing.page)
            return
        }
        guard let text, text != annotation.contents else { return }
        if AnnotationKind.of(annotation) == "FreeText" && untouched {
            delete(annotation, from: editing.page)
            return
        }
        modify(annotation) {
            $0.contents = text
            if AnnotationKind.of($0) == "FreeText" { Self.fitFreeText($0) }
        }
    }

    /// Grows/shrinks a text box to hold its text, keeping the top edge in place.
    static func fitFreeText(_ box: PDFAnnotation) {
        let font = box.font ?? UIFont.systemFont(ofSize: 14)
        let text = (box.contents ?? "") as NSString
        let width = max(box.bounds.width, 60)
        let measured = text.boundingRect(with: CGSize(width: width - 8, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil)
        let height = ceil(measured.height + 10)
        box.bounds = CGRect(x: box.bounds.minX, y: box.bounds.maxY - height, width: width, height: height)
    }

    // MARK: - Selection

    func select(_ annotations: [PDFAnnotation]) { selected = annotations }

    func deselect() { if !selected.isEmpty { selected = [] } }

    private func selectionChanged(_ previous: [PDFAnnotation]) {
        input.refreshOverlay()
        // A text box left with its placeholder disappears once it is deselected (desktop `droppedUntouchedTexts`).
        for annotation in previous where !selected.contains(where: { $0 === annotation }) {
            guard AnnotationKind.of(annotation) == "FreeText", let page = annotation.page, page.document === session.pdf else { continue }
            let text = (annotation.contents ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty || text == t("annotate.textPlaceholder") { delete(annotation, from: page) }
        }
    }

    /// The topmost mark under a page point.
    func mark(at pagePoint: CGPoint, on page: PDFPage, includeLinks: Bool) -> PDFAnnotation? {
        page.annotations.reversed().first { annotation in
            guard AnnotationKind.isMark(annotation, includeLinks: includeLinks) else { return false }
            let slop: CGFloat = AnnotationKind.of(annotation) == "Line" ? 4 : 2
            return annotation.bounds.insetBy(dx: -slop, dy: -slop).contains(pagePoint)
        }
    }

    /// Marks that intersect a dragged area (desktop `marksInArea`).
    func marks(in area: CGRect, on page: PDFPage) -> [PDFAnnotation] {
        page.annotations.filter { AnnotationKind.isMark($0) && $0.bounds.intersects(area) }
    }

    func deleteSelected() {
        let marks = selected
        guard !marks.isEmpty else { return }
        selected = []
        session.undoManager.beginUndoGrouping()
        for mark in marks { if let page = mark.page { delete(mark, from: page) } }
        session.undoManager.endUndoGrouping()
    }

    /// Marks the "Delete all marks" button removes (desktop `allMarks`: drawings and text marks, not comments).
    static let bulkKinds: Set<String> = ["Square", "Circle", "Ink", "Line", "PolyLine", "FreeText", "Highlight", "Underline", "StrikeOut", "Squiggly"]

    func allMarks() -> [(PDFPage, PDFAnnotation)] {
        var result: [(PDFPage, PDFAnnotation)] = []
        for index in 0..<session.pdf.pageCount {
            guard let page = session.pdf.page(at: index) else { continue }
            for annotation in page.annotations where Self.bulkKinds.contains(AnnotationKind.of(annotation)) { result.append((page, annotation)) }
        }
        return result
    }

    func deleteAll() {
        let marks = allMarks()
        guard !marks.isEmpty else { return }
        selected = []
        session.undoManager.beginUndoGrouping()
        for (page, mark) in marks { delete(mark, from: page) }
        session.undoManager.endUndoGrouping()
    }

    // MARK: - Ink eraser

    /// Rubs out the parts of pen drawings on `page` that the eraser path (page points) touched.
    func erase(along path: [CGPoint], radius: CGFloat, on page: PDFPage) {
        guard !path.isEmpty else { return }
        var grouped = false
        defer { if grouped { session.undoManager.endUndoGrouping() } }
        for ink in page.annotations where AnnotationKind.of(ink) == "Ink" {
            guard ink.bounds.insetBy(dx: -radius, dy: -radius).intersects(AnnotationGeometry.boundsOf(path, padding: radius)) else { continue }
            let origin = ink.bounds.origin
            let strokes = (ink.paths ?? []).flatMap(\.annotateStrokes).map { $0.map { CGPoint(x: $0.x + origin.x, y: $0.y + origin.y) } }
            let erased = AnnotationGeometry.eraseAlong(strokes, path: path, radius: radius)
            guard !AnnotationGeometry.sameStrokes(erased, strokes) else { continue }
            if !grouped { session.undoManager.beginUndoGrouping(); grouped = true }
            let width = ink.border?.lineWidth ?? 1
            guard let rect = AnnotationGeometry.inkBounds(erased, strokeWidth: width + 2) else {
                delete(ink, from: page)
                continue
            }
            modify(ink) { annotation in
                annotation.paths?.forEach { annotation.remove($0) }
                annotation.bounds = rect
                for stroke in erased { annotation.add(.annotateStroke(stroke.map { CGPoint(x: $0.x - rect.minX, y: $0.y - rect.minY) })) }
            }
        }
    }

    // MARK: - Move & resize

    /// Moves/resizes `annotation` from its `original` state: `from` → `to` is applied to all its geometry.
    func reshape(_ annotation: PDFAnnotation, original: AnnotationSnapshot, from old: CGRect, to new: CGRect) {
        original.restore(annotation)
        let transform = AnnotationGeometry.transform(from: old, to: new)
        let kind = AnnotationKind.of(annotation)
        let scales = old.size != new.size
        if !scales {
            annotation.bounds = annotation.bounds.offsetBy(dx: new.minX - old.minX, dy: new.minY - old.minY)
        } else if kind == "Ink" {
            let origin = annotation.bounds.origin
            let strokes = (annotation.paths ?? []).flatMap(\.annotateStrokes).map { $0.map { CGPoint(x: $0.x + origin.x, y: $0.y + origin.y).applying(transform) } }
            let width = annotation.border?.lineWidth ?? 1
            let rect = AnnotationGeometry.inkBounds(strokes, strokeWidth: width + 2) ?? new
            annotation.paths?.forEach { annotation.remove($0) }
            annotation.bounds = rect
            strokes.forEach { annotation.add(.annotateStroke($0.map { CGPoint(x: $0.x - rect.minX, y: $0.y - rect.minY) })) }
        } else if kind == "Line" {
            let start = CGPoint(x: annotation.bounds.minX + annotation.startPoint.x, y: annotation.bounds.minY + annotation.startPoint.y).applying(transform)
            let end = CGPoint(x: annotation.bounds.minX + annotation.endPoint.x, y: annotation.bounds.minY + annotation.endPoint.y).applying(transform)
            Self.setLine(annotation, start: start, end: end)
        } else if let curved = annotation as? CurvedLineAnnotation {
            Self.setPageVertices(curved.pageVertices.map { $0.applying(transform) }, on: curved)
        } else {
            annotation.bounds = annotation.bounds.applying(transform)
        }
        if let page = annotation.page { session.pdfView?.annotationsChanged(on: page) }
    }

    static func setLine(_ line: PDFAnnotation, start: CGPoint, end: CGPoint) {
        let width = line.border?.lineWidth ?? 2
        let rect = AnnotationGeometry.boundsOf([start, end], padding: max(width * 3, 8))
        line.bounds = rect
        line.startPoint = CGPoint(x: start.x - rect.minX, y: start.y - rect.minY)
        line.endPoint = CGPoint(x: end.x - rect.minX, y: end.y - rect.minY)
    }

    /// Records the end of a drag as one undoable step.
    func commitReshape(_ changes: [(PDFAnnotation, AnnotationSnapshot)]) {
        session.undoManager.beginUndoGrouping()
        for (annotation, before) in changes {
            let after = AnnotationSnapshot(annotation)
            registerRestore(annotation, to: before, redo: after)
            if let page = annotation.page { changed(page) }
        }
        session.undoManager.endUndoGrouping()
    }

    // MARK: - Undoable primitives

    func insert(_ annotation: PDFAnnotation, on page: PDFPage) {
        page.addAnnotation(annotation)
        session.undoManager.registerUndo(withTarget: self) { controller in
            MainActor.assumeIsolated { controller.delete(annotation, from: page) }
        }
        changed(page)
    }

    func delete(_ annotation: PDFAnnotation, from page: PDFPage) {
        guard page.annotations.contains(where: { $0 === annotation }) else { return }
        page.removeAnnotation(annotation)
        if selected.contains(where: { $0 === annotation }) { selected.removeAll { $0 === annotation } }
        session.undoManager.registerUndo(withTarget: self) { controller in
            MainActor.assumeIsolated { controller.insert(annotation, on: page) }
        }
        changed(page)
    }

    /// Changes an annotation and records the before/after state for undo.
    func modify(_ annotation: PDFAnnotation, _ change: (PDFAnnotation) -> Void) {
        if continuous != nil {
            change(annotation)
            annotation.modificationDate = Date()
            if let page = annotation.page { changed(page) }
            return
        }
        let before = AnnotationSnapshot(annotation)
        change(annotation)
        annotation.modificationDate = Date()
        registerRestore(annotation, to: before, redo: AnnotationSnapshot(annotation))
        if let page = annotation.page { changed(page) }
    }

    private func registerRestore(_ annotation: PDFAnnotation, to state: AnnotationSnapshot, redo: AnnotationSnapshot) {
        session.undoManager.registerUndo(withTarget: self) { controller in
            MainActor.assumeIsolated {
                state.restore(annotation)
                controller.registerRestore(annotation, to: redo, redo: state)
                if let page = annotation.page { controller.changed(page) }
            }
        }
    }

    /// PDFKit cannot redraw Squiggly/PolyLine marks read from a file once they change; swap in our drawn type.
    private func upgradeIfNeeded(_ annotation: PDFAnnotation) -> PDFAnnotation {
        guard let page = annotation.page else { return annotation }
        let kind = AnnotationKind.of(annotation)
        let replacement: PDFAnnotation
        if kind == "Squiggly", !(annotation is SquigglyAnnotation) {
            replacement = SquigglyAnnotation(bounds: annotation.bounds, forType: PDFAnnotationSubtype(rawValue: "Squiggly"), withProperties: nil)
            replacement.quadrilateralPoints = annotation.quadrilateralPoints
        } else if kind == "PolyLine", !(annotation is CurvedLineAnnotation),
                  let flat = annotation.value(forAnnotationKey: PDFAnnotationKey(rawValue: "/Vertices")) as? [NSNumber], flat.count >= 4 {
            let points = stride(from: 0, to: flat.count - 1, by: 2).map { CGPoint(x: flat[$0].doubleValue, y: flat[$0 + 1].doubleValue) }
            let curved = CurvedLineAnnotation(vertices: points, width: annotation.border?.lineWidth ?? 1)
            curved.border = annotation.border
            replacement = curved
        } else {
            return annotation
        }
        replacement.color = annotation.color
        replacement.contents = annotation.contents
        replacement.userName = annotation.userName
        Self.stampIdentity(replacement, keepingFrom: annotation)
        let wasSelected = selected.contains { $0 === annotation }
        delete(annotation, from: page)
        insert(replacement, on: page)
        if wasSelected { selected = selected.filter { $0 !== annotation } + [replacement] }
        return replacement
    }

    func undo() {
        guard session.undoManager.canUndo else { return }
        selected = []
        session.undoManager.undo()
        refreshUndo()
    }

    func redo() {
        guard session.undoManager.canRedo else { return }
        selected = []
        session.undoManager.redo()
        refreshUndo()
    }

    func refreshUndo() {
        canUndo = session.undoManager.canUndo
        canRedo = session.undoManager.canRedo
    }

    /// Redraws without recording an edit (a text box that is not committed yet).
    func redraw(_ page: PDFPage) {
        session.pdfView?.annotationsChanged(on: page)
        input.refreshOverlay()
    }

    func changed(_ page: PDFPage) {
        session.pdfView?.annotationsChanged(on: page)
        session.markEdited()
        input.refreshOverlay()
        refreshUndo()
    }

    // MARK: - Identity

    static var authorName: String {
        let name = AppModel.shared.authorName.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let trimmed = String(name.prefix(64)).trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "vivePDF" : trimmed
    }

    /// Author, date and a unique `/NM` on every mark we create (XFDF and reply threads key on `/NM`).
    func stampAuthor(_ annotation: PDFAnnotation) {
        annotation.userName = Self.authorName
        annotation.modificationDate = Date()
        Self.stampIdentity(annotation, keepingFrom: nil)
    }

    static func stampIdentity(_ annotation: PDFAnnotation, keepingFrom original: PDFAnnotation?) {
        let key = PDFAnnotationKey(rawValue: "/NM")
        let name = (original?.value(forAnnotationKey: key) as? String) ?? "vivepdf-\(UUID().uuidString.lowercased())"
        _ = annotation.setValue(name, forAnnotationKey: key)
    }
}
