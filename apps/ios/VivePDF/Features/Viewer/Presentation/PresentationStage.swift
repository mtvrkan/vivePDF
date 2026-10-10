import PDFKit
import SwiftUI
import UIKit

/// Renders slides off the main thread and caches them (a handful of pages at screen resolution).
@MainActor
enum SlideImageCache {
    private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 12
        return cache
    }()

    static func key(_ document: PDFDocument, _ index: Int, _ pixels: CGSize, _ revision: Int) -> NSString {
        "\(ObjectIdentifier(document).hashValue)-\(index)-\(Int(pixels.width))x\(Int(pixels.height))-\(revision)" as NSString
    }

    static func cached(_ key: NSString) -> UIImage? { cache.object(forKey: key) }
    static func store(_ image: UIImage, _ key: NSString) { cache.setObject(image, forKey: key) }
}

/// Size of a page as it is displayed (rotation applied).
func displayedPageSize(_ page: PDFPage?) -> CGSize {
    guard let page else { return CGSize(width: 595, height: 842) }
    let box = page.bounds(for: .cropBox)
    return page.rotation % 180 == 0 ? box.size : CGSize(width: box.height, height: box.width)
}

/// Where the slide sits in a container: fitted, or zoomed so `zoom` (normalised) fills the container.
func slideFrame(container: CGSize, page: CGSize, zoom: CGRect?) -> CGRect {
    guard container.width > 0, container.height > 0, page.width > 0, page.height > 0 else { return .zero }
    if let zoom, zoom.width > 0, zoom.height > 0 {
        let scale = min(container.width / (zoom.width * page.width), container.height / (zoom.height * page.height))
        let size = CGSize(width: page.width * scale, height: page.height * scale)
        let center = CGPoint(x: zoom.midX * size.width, y: zoom.midY * size.height)
        return CGRect(origin: CGPoint(x: container.width / 2 - center.x, y: container.height / 2 - center.y), size: size)
    }
    let scale = min(container.width / page.width, container.height / page.height)
    let size = CGSize(width: page.width * scale, height: page.height * scale)
    return CGRect(origin: CGPoint(x: (container.width - size.width) / 2, y: (container.height - size.height) / 2), size: size)
}

/// One slide image, rendered for the given frame.
struct SlideImageView: View {
    let document: PDFDocument
    let index: Int
    let size: CGSize
    let revision: Int
    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Color.white
            if let image { Image(uiImage: image).resizable().interpolation(.high) }
        }
        .frame(width: size.width, height: size.height)
        .task(id: "\(index)-\(Int(size.width))-\(Int(size.height))-\(revision)-\(ObjectIdentifier(document).hashValue)") {
            await render()
        }
    }

    private func render() async {
        guard let page = document.page(at: index), size.width > 1, size.height > 1 else { return }
        // Cap the bitmap so zoomed-in slides stay within memory.
        let factor = min(displayScale, 4096 / max(size.width, size.height))
        let pixels = CGSize(width: (size.width * factor).rounded(), height: (size.height * factor).rounded())
        let key = SlideImageCache.key(document, index, pixels, revision)
        if let cached = SlideImageCache.cached(key) { image = cached; return }
        let rendered = await Task.detached(priority: .userInitiated) { page.thumbnail(of: pixels, for: .cropBox) }.value
        SlideImageCache.store(rendered, key)
        if !Task.isCancelled { image = rendered }
    }
}

/// Draws presentation strokes into a SwiftUI canvas.
enum StrokePainter {
    static func color(_ hex: String) -> Color { Color(uiColor: PresentationAnnotationWriter.color(hex)) }

    static func draw(_ stroke: PresentationStroke, in context: GraphicsContext, frame: CGRect, onBlack: Bool, multiply: Bool = true) {
        guard !stroke.points.isEmpty else { return }
        let hex = onBlack ? PresentationGeometry.readableOnDark(stroke.color) : stroke.color
        let paint = color(hex)
        var ctx = context
        func map(_ p: CGPoint) -> CGPoint { CGPoint(x: frame.minX + p.x * frame.width, y: frame.minY + p.y * frame.height) }
        if stroke.kind == .highlighter {
            ctx.opacity = PresentationGeometry.highlighterAlpha
            if multiply && !onBlack { ctx.blendMode = .multiply }
        } else if let opacity = stroke.opacity {
            ctx.opacity = opacity
        }
        if stroke.kind == .text {
            let size = (stroke.fontSize ?? 0) * frame.width
            guard let text = stroke.text, size > 0 else { return }
            let anchor = map(stroke.points[0])
            let leading = (PresentationGeometry.textLineHeight - 1) / 2 * size
            for (index, line) in text.components(separatedBy: "\n").enumerated() {
                ctx.draw(Text(line).font(.system(size: size, weight: .semibold)).foregroundColor(paint),
                         at: CGPoint(x: anchor.x, y: anchor.y + leading + CGFloat(index) * size * PresentationGeometry.textLineHeight),
                         anchor: .topLeading)
            }
            return
        }
        let lineWidth = stroke.width * frame.width
        var path = Path()
        let points: [CGPoint]
        switch stroke.kind {
        case .rect: points = PresentationGeometry.rectCorners(stroke)
        case .ellipse: points = PresentationGeometry.ellipsePoints(stroke)
        default: points = stroke.kind == .line || stroke.kind == .arrow ? Array(stroke.points.prefix(2)) : stroke.points
        }
        path.addLines(points.map(map))
        if points.count == 1 {
            let p = map(points[0])
            ctx.fill(Path(ellipseIn: CGRect(x: p.x - lineWidth / 2, y: p.y - lineWidth / 2, width: lineWidth, height: lineWidth)), with: .color(paint))
            return
        }
        if stroke.kind == .arrow, stroke.points.count > 1 {
            let from = map(stroke.points[0]), tip = map(stroke.points[1])
            let angle = atan2(tip.y - from.y, tip.x - from.x)
            let length = PresentationGeometry.arrowHeadLength(lineWidth: lineWidth)
            let spread = CGFloat.pi / 7
            path.move(to: CGPoint(x: tip.x - length * cos(angle - spread), y: tip.y - length * sin(angle - spread)))
            path.addLine(to: tip)
            path.addLine(to: CGPoint(x: tip.x - length * cos(angle + spread), y: tip.y - length * sin(angle + spread)))
        }
        ctx.stroke(path, with: .color(paint), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
    }
}

/// The slide with everything drawn over it: drawings, laser, spotlight, magnifier, blackout boards.
/// `interactive` stages accept input; the external display shows a passive copy of the same state.
struct PresentationStage: View {
    @Bindable var controller: PresentationController
    var interactive = true
    @Environment(\.layoutDirection) private var layoutDirection
    @AppStorage("vivepdf.presentation.transition") private var transitionRaw = SlideTransition.fade.rawValue
    @AppStorage("vivepdf.presentation.pencilOnly") private var pencilOnly = false
    @State private var areaStart: CGPoint?
    @State private var dragLast: CGPoint?
    @FocusState private var textFocused: Bool

    private var transition: SlideTransition { SlideTransition(rawValue: transitionRaw) ?? .fade }

    var body: some View {
        GeometryReader { proxy in
            let pageSize = displayedPageSize(controller.session.pdf.page(at: controller.pageIndex))
            let frame = slideFrame(container: proxy.size, page: pageSize, zoom: controller.zoomRect)
            ZStack(alignment: .topLeading) {
                Color.black
                slide(frame: frame, container: proxy.size)
                    .animation(transition == .none ? nil : .easeInOut(duration: 0.32), value: controller.pageIndex)
                board
                overlays(frame: frame, container: proxy.size)
                if interactive {
                    PresentationInputLayer(handlers: handlers(frame: frame, container: proxy.size))
                    textDraft(frame: surfaceFrame(frame, container: proxy.size))
                }
            }
            .clipped()
        }
        .ignoresSafeArea()
    }

    // MARK: Slide + drawings

    @ViewBuilder
    private func slide(frame: CGRect, container: CGSize) -> some View {
        ZStack(alignment: .topLeading) {
            SlideImageView(document: controller.session.pdf, index: controller.pageIndex, size: frame.size, revision: controller.renderRevision + controller.session.revision)
                .offset(x: frame.minX, y: frame.minY)
            let strokes = controller.strokes(on: .page(controller.pageIndex))
            let live = controller.blackout == .none ? controller.live : nil
            Canvas { context, _ in
                for stroke in strokes {
                    StrokePainter.draw(stroke, in: context, frame: frame, onBlack: false)
                }
                if let live { StrokePainter.draw(live, in: context, frame: frame, onBlack: false) }
            }
            .allowsHitTesting(false)
        }
        .frame(width: container.width, height: container.height, alignment: .topLeading)
        .id(controller.pageIndex)
        .transition(slideTransition)
        .environment(\.layoutDirection, .leftToRight)
    }

    private var slideTransition: AnyTransition {
        switch transition {
        case .none: return .identity
        case .fade: return .opacity
        case .push:
            let forward = controller.lastStep >= 0
            // Mirrors in right-to-left languages, where the next slide arrives from the left.
            let rtl = layoutDirection == .rightToLeft
            let incoming: Edge = forward != rtl ? .trailing : .leading
            let outgoing: Edge = incoming == .trailing ? .leading : .trailing
            return .asymmetric(insertion: .move(edge: incoming), removal: .move(edge: outgoing))
        }
    }

    @ViewBuilder
    private var board: some View {
        if controller.blackout != .none {
            GeometryReader { proxy in
                let frame = CGRect(origin: .zero, size: proxy.size)
                let onBlack = controller.blackout == .black
                let strokes = controller.strokes(on: .board(controller.blackout))
                let live = controller.live
                ZStack {
                    (onBlack ? Color.black : Color.white)
                    Canvas { context, _ in
                        for stroke in strokes {
                            StrokePainter.draw(stroke, in: context, frame: frame, onBlack: onBlack)
                        }
                        if let live { StrokePainter.draw(live, in: context, frame: frame, onBlack: onBlack) }
                    }
                }
            }
            .allowsHitTesting(false)
            .transition(.opacity)
        }
    }

    /// Frame used for normalising input: the whole screen on blackout boards, the slide otherwise.
    private func surfaceFrame(_ frame: CGRect, container: CGSize) -> CGRect {
        controller.blackout == .none ? frame : CGRect(origin: .zero, size: container)
    }

    // MARK: Pointer tools

    @ViewBuilder
    private func overlays(frame: CGRect, container: CGSize) -> some View {
        let surface = surfaceFrame(frame, container: container)
        if let selected = controller.selectedStroke {
            let box = PresentationGeometry.bounds(selected, scale: surface.size).offsetBy(dx: surface.minX, dy: surface.minY).insetBy(dx: -6, dy: -6)
            Rectangle()
                .strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                .frame(width: box.width, height: box.height)
                .offset(x: box.minX, y: box.minY)
                .allowsHitTesting(false)
        }
        if let draft = controller.areaDraft {
            let box = CGRect(x: frame.minX + draft.minX * frame.width, y: frame.minY + draft.minY * frame.height, width: draft.width * frame.width, height: draft.height * frame.height)
            Rectangle().fill(Color.accentColor.opacity(0.15))
                .overlay(Rectangle().strokeBorder(Color.accentColor, lineWidth: 1.5))
                .frame(width: box.width, height: box.height)
                .offset(x: box.minX, y: box.minY)
                .allowsHitTesting(false)
        }
        if controller.tool == .laser, !controller.laserTrail.isEmpty {
            LaserTrailView(trail: controller.laserTrail, frame: surface, color: StrokePainter.color(controller.prefs.laserColor), size: controller.prefs.laserSize)
                .allowsHitTesting(false)
        }
        if controller.tool == .spotlight, let pointer = controller.pointer {
            let center = CGPoint(x: surface.minX + pointer.x * surface.width, y: surface.minY + pointer.y * surface.height)
            let radius = controller.prefs.spotlightRadius
            Canvas { context, size in
                var path = Path(CGRect(origin: .zero, size: size))
                path.addEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
                context.fill(path, with: .color(.black.opacity(controller.prefs.spotlightDim)), style: FillStyle(eoFill: true))
            }
            .allowsHitTesting(false)
        }
        if controller.tool == .magnifier, let pointer = controller.pointer, controller.blackout == .none {
            MagnifierLens(controller: controller, frame: frame, pointer: pointer)
                .allowsHitTesting(false)
        }
    }

    // MARK: Text tool

    @ViewBuilder
    private func textDraft(frame: CGRect) -> some View {
        if let anchor = controller.textDraftAt {
            let surface = frame
            TextField(t("presentation.textPlaceholder"), text: $controller.textDraft)
                .font(.system(size: max(12, min(controller.prefs.textSize, 48)), weight: .semibold))
                .foregroundStyle(StrokePainter.color(controller.displayColor(controller.prefs.penColor)))
                .padding(6)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                .frame(minWidth: 160, maxWidth: 420)
                .fixedSize()
                .focused($textFocused)
                .submitLabel(.done)
                .onSubmit { controller.commitText(surfaceSize: frame.size) }
                .offset(x: surface.minX + anchor.x * surface.width, y: surface.minY + anchor.y * surface.height)
                .onAppear { textFocused = true }
        }
    }

    // MARK: Input

    private func normalize(_ point: CGPoint, _ frame: CGRect) -> CGPoint {
        guard frame.width > 0, frame.height > 0 else { return .zero }
        let x = (point.x - frame.minX) / frame.width, y = (point.y - frame.minY) / frame.height
        // Drawings may reach one slide-width beyond the edges (desktop `STROKE_REACH`).
        return CGPoint(x: min(2, max(-1, x)), y: min(2, max(-1, y)))
    }

    private func handlers(frame slideRect: CGRect, container: CGSize) -> PresentationInputLayer.Handlers {
        let boardRect = CGRect(origin: .zero, size: container)
        let surface = controller.blackout == .none ? slideRect : boardRect
        let tool = controller.tool
        let drawingTools: Set<PresentationTool> = [.pen, .highlighter, .shape, .text, .select, .eraser]
        let toolDraws = controller.areaZoomArmed || drawingTools.contains(tool)
        let fingerDraws = !(controller.pencilDetected || pencilOnly)
        return PresentationInputLayer.Handlers(
            toolDraws: toolDraws,
            tracksPointer: tool.tracksPointer,
            fingerDraws: fingerDraws,
            isRTL: layoutDirection == .rightToLeft,
            drawBegan: { point in drawBegan(point, slideRect, surface) },
            drawMoved: { point, constrain in drawMoved(point, constrain, slideRect, surface) },
            drawEnded: { point in drawEnded(point, slideRect, surface) },
            drawCancelled: {
                controller.live = nil
                controller.areaDraft = nil
                areaStart = nil
            },
            pointer: { point in
                guard let point else {
                    if controller.tool == .laser { controller.fadeLaser() } else { controller.pointer = nil }
                    return
                }
                let n = normalize(point, surface)
                controller.pointer = n
                if controller.tool == .laser { controller.addLaser(n) }
            },
            tap: { point in tap(point, container) },
            swipe: { step in
                if step > 0 { controller.next() } else { controller.previous() }
            },
            pencilSeen: { if !controller.pencilDetected { controller.pencilDetected = true } }
        )
    }

    private func drawBegan(_ point: CGPoint, _ slideRect: CGRect, _ rect: CGRect) {
        if controller.areaZoomArmed {
            areaStart = normalize(point, slideRect)
            return
        }
        let n = normalize(point, rect)
        switch controller.tool {
        case .pen, .highlighter, .shape: controller.beginStroke(at: n, surfaceSize: rect.size)
        case .eraser: controller.erase(at: n, radiusPoints: 14, surfaceSize: rect.size)
        case .select:
            controller.select(at: n, surfaceSize: rect.size)
            dragLast = n
        default: break
        }
    }

    private func drawMoved(_ point: CGPoint, _ constrain: Bool, _ slideRect: CGRect, _ rect: CGRect) {
        if controller.areaZoomArmed, let start = areaStart {
            let n = normalize(point, slideRect)
            controller.areaDraft = CGRect(x: min(start.x, n.x), y: min(start.y, n.y), width: abs(n.x - start.x), height: abs(n.y - start.y))
            return
        }
        let n = normalize(point, rect)
        switch controller.tool {
        case .pen, .highlighter, .shape: controller.extendStroke(to: n, surfaceSize: rect.size, constrain: constrain)
        case .eraser: controller.erase(at: n, radiusPoints: 14, surfaceSize: rect.size)
        case .select:
            if let last = dragLast, controller.selectedID != nil {
                controller.moveSelected(by: CGSize(width: n.x - last.x, height: n.y - last.y))
            }
            dragLast = n
        default: break
        }
    }

    private func drawEnded(_ point: CGPoint, _ slideRect: CGRect, _ rect: CGRect) {
        if controller.areaZoomArmed {
            if let draft = controller.areaDraft { controller.applyAreaZoom(draft) } else { controller.applyAreaZoom(.zero) }
            areaStart = nil
            return
        }
        switch controller.tool {
        case .pen, .highlighter, .shape: controller.finishStroke(surfaceSize: rect.size)
        case .text:
            if controller.textDraftAt != nil {
                controller.commitText(surfaceSize: rect.size)
            } else {
                controller.textDraft = ""
                controller.textDraftAt = normalize(point, rect)
            }
        case .select: dragLast = nil
        default: break
        }
    }

    /// Pointer tool taps: outer thirds turn slides (mirrored in RTL), the middle shows or hides the bar.
    private func tap(_ point: CGPoint, _ container: CGSize) {
        if controller.overviewOpen { return }
        guard controller.tool == .pointer else {
            controller.toggleChrome()
            return
        }
        let width = container.width
        let rtl = layoutDirection == .rightToLeft
        if point.x < width / 3 {
            rtl ? controller.next() : controller.previous()
        } else if point.x > width * 2 / 3 {
            rtl ? controller.previous() : controller.next()
        } else {
            controller.toggleChrome()
        }
    }
}

/// Fading laser trail (desktop `LaserTrail`).
struct LaserTrailView: View {
    let trail: [LaserSample]
    let frame: CGRect
    let color: Color
    let size: CGFloat

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, _ in
                let now = timeline.date.timeIntervalSinceReferenceDate
                let points = trail.filter { now - $0.time < 0.7 }
                func map(_ p: CGPoint) -> CGPoint { CGPoint(x: frame.minX + p.x * frame.width, y: frame.minY + p.y * frame.height) }
                for (a, b) in zip(points, points.dropFirst()) {
                    let age = now - b.time
                    var path = Path()
                    path.move(to: map(a.point))
                    path.addLine(to: map(b.point))
                    context.stroke(path, with: .color(color.opacity(max(0, 0.8 - age / 0.7 * 0.8))),
                                   style: StrokeStyle(lineWidth: size * 0.8, lineCap: .round, lineJoin: .round))
                }
                if let last = points.last {
                    let p = map(last.point)
                    let glow = CGRect(x: p.x - size * 1.4, y: p.y - size * 1.4, width: size * 2.8, height: size * 2.8)
                    context.fill(Path(ellipseIn: glow), with: .color(color.opacity(0.3)))
                    context.fill(Path(ellipseIn: CGRect(x: p.x - size / 2, y: p.y - size / 2, width: size, height: size)), with: .color(color))
                }
            }
        }
    }
}

/// Round magnifying lens following the pointer (desktop `MagnifierLens`).
struct MagnifierLens: View {
    let controller: PresentationController
    let frame: CGRect
    let pointer: CGPoint

    var body: some View {
        let zoom = controller.prefs.magnifierZoom
        let diameter = controller.prefs.magnifierSize
        let center = CGPoint(x: frame.minX + pointer.x * frame.width, y: frame.minY + pointer.y * frame.height)
        // The slide scaled around the pointer, shown through a circle centred on it.
        let scaled = CGRect(x: center.x + (frame.minX - center.x) * zoom, y: center.y + (frame.minY - center.y) * zoom,
                            width: frame.width * zoom, height: frame.height * zoom)
        ZStack(alignment: .topLeading) {
            Color.black
            SlideImageView(document: controller.session.pdf, index: controller.pageIndex, size: scaled.size, revision: controller.renderRevision + controller.session.revision)
                .offset(x: scaled.minX - (center.x - diameter / 2), y: scaled.minY - (center.y - diameter / 2))
            let strokes = controller.strokes(on: .page(controller.pageIndex))
            Canvas { context, _ in
                let local = scaled.offsetBy(dx: -(center.x - diameter / 2), dy: -(center.y - diameter / 2))
                for stroke in strokes {
                    StrokePainter.draw(stroke, in: context, frame: local, onBlack: false)
                }
            }
        }
        .frame(width: diameter, height: diameter, alignment: .topLeading)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(.white.opacity(0.9), lineWidth: 3))
        .shadow(color: .black.opacity(0.5), radius: 12)
        .offset(x: center.x - diameter / 2, y: center.y - diameter / 2)
    }
}
