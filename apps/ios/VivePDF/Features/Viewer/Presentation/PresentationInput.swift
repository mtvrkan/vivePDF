import SwiftUI
import UIKit

/// Raw touch handling for the slide stage. Decides per touch whether it draws, moves a pointer tool or
/// navigates, so Apple Pencil can draw while fingers keep swiping between slides (desktop: mouse draws,
/// clicks/keys navigate).
struct PresentationInputLayer: UIViewRepresentable {
    struct Handlers {
        var toolDraws: Bool
        var tracksPointer: Bool
        var fingerDraws: Bool
        var isRTL: Bool
        var drawBegan: (CGPoint) -> Void
        var drawMoved: (CGPoint, _ constrain: Bool) -> Void
        var drawEnded: (CGPoint) -> Void
        var drawCancelled: () -> Void
        var pointer: (CGPoint?) -> Void
        var tap: (CGPoint) -> Void
        /// +1 next slide, -1 previous slide.
        var swipe: (Int) -> Void
        var pencilSeen: () -> Void
    }

    var handlers: Handlers

    func makeUIView(context: Context) -> PresentationInputSurface {
        let view = PresentationInputSurface()
        view.handlers = handlers
        return view
    }

    func updateUIView(_ view: PresentationInputSurface, context: Context) {
        view.handlers = handlers
    }
}

final class PresentationInputSurface: UIView {
    var handlers: PresentationInputLayer.Handlers?
    private var drawTouch: UITouch?
    private var navStarts: [ObjectIdentifier: CGPoint] = [:]
    private var navLast: [ObjectIdentifier: CGPoint] = [:]
    private var navMaxTouches = 0
    private var pointerTouch: UITouch?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        backgroundColor = .clear
        let hover = UIHoverGestureRecognizer(target: self, action: #selector(hovered(_:)))
        addGestureRecognizer(hover)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    @objc private func hovered(_ recognizer: UIHoverGestureRecognizer) {
        guard let handlers, handlers.tracksPointer else { return }
        switch recognizer.state {
        case .began, .changed: handlers.pointer(recognizer.location(in: self))
        default: handlers.pointer(nil)
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let handlers else { return }
        for touch in touches {
            let point = touch.location(in: self)
            if touch.type == .pencil { handlers.pencilSeen() }
            let canDraw = handlers.toolDraws && (touch.type == .pencil || handlers.fingerDraws)
            if drawTouch == nil, canDraw, navStarts.isEmpty, (event?.allTouches?.count ?? 1) == 1 {
                drawTouch = touch
                handlers.drawBegan(point)
                continue
            }
            if let current = drawTouch, current.type != .pencil, touch.type != .pencil {
                // A second finger while drawing with a finger: it was a two-finger swipe, not a stroke.
                handlers.drawCancelled()
                navStarts[ObjectIdentifier(current)] = current.location(in: self)
                drawTouch = nil
            }
            if handlers.tracksPointer, pointerTouch == nil, navStarts.isEmpty {
                pointerTouch = touch
                handlers.pointer(point)
            }
            navStarts[ObjectIdentifier(touch)] = point
            navLast[ObjectIdentifier(touch)] = point
            navMaxTouches = max(navMaxTouches, navStarts.count)
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let handlers else { return }
        for touch in touches {
            if touch === drawTouch {
                // A finger held down while the Pencil draws snaps lines and squares shapes (desktop Shift).
                let constrain = !navStarts.isEmpty
                for sample in event?.coalescedTouches(for: touch) ?? [touch] {
                    handlers.drawMoved(sample.location(in: self), constrain)
                }
            } else {
                if touch === pointerTouch, navMaxTouches <= 1 { handlers.pointer(touch.location(in: self)) }
                navLast[ObjectIdentifier(touch)] = touch.location(in: self)
            }
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        finish(touches, cancelled: false)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        finish(touches, cancelled: true)
    }

    private func finish(_ touches: Set<UITouch>, cancelled: Bool) {
        guard let handlers else { return }
        var moves: [CGSize] = []
        var lastStart: CGPoint?
        for touch in touches {
            if touch === drawTouch {
                if cancelled { handlers.drawCancelled() } else { handlers.drawEnded(touch.location(in: self)) }
                drawTouch = nil
                continue
            }
            if touch === pointerTouch {
                pointerTouch = nil
                if handlers.tracksPointer { handlers.pointer(nil) }
            }
            let key = ObjectIdentifier(touch)
            if let start = navStarts[key] {
                let end = touch.location(in: self)
                moves.append(CGSize(width: end.x - start.x, height: end.y - start.y))
                lastStart = start
            }
            navStarts[key] = nil
            navLast[key] = nil
        }
        guard !cancelled, navStarts.isEmpty, let start = lastStart, let move = moves.first else {
            if navStarts.isEmpty { navMaxTouches = 0 }
            return
        }
        let fingers = navMaxTouches
        navMaxTouches = 0
        // Pointer tools and finger-drawing keep one finger for themselves: navigation needs two.
        let needsTwo = handlers.tracksPointer || (handlers.toolDraws && handlers.fingerDraws)
        if abs(move.width) > 50, abs(move.width) > abs(move.height) * 1.2, !needsTwo || fingers >= 2 {
            let towardsNext = move.width < 0
            // In right-to-left layouts the next slide comes from the left.
            handlers.swipe(towardsNext != handlers.isRTL ? 1 : -1)
        } else if hypot(move.width, move.height) < 12, fingers == 1, !needsTwo || handlers.tracksPointer {
            handlers.tap(start)
        }
    }
}
