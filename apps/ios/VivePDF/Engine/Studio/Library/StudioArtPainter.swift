import CoreGraphics
import Foundation

/// Paints vector art (ornament and icon previews) with Core Graphics. The page renderer draws the real
/// elements; this lightweight painter only serves library thumbnails.
enum StudioArtPainter {
    static func cgColor(_ hex: String, alpha: Double = 1) -> CGColor {
        let (r, g, b) = StudioColor.components(hex)
        return CGColor(srgbRed: r, green: g, blue: b, alpha: alpha)
    }

    /// Draws `paths` (in a `viewWidth × viewHeight` space) fitted into `rect` (y-down context).
    static func draw(_ paths: [StudioVectorPath], viewWidth: Double, viewHeight: Double, in rect: CGRect, context: CGContext, tint: String? = nil) {
        guard viewWidth > 0, viewHeight > 0 else { return }
        context.saveGState()
        context.translateBy(x: rect.minX, y: rect.minY)
        context.scaleBy(x: rect.width / viewWidth, y: rect.height / viewHeight)
        for path in paths {
            let cg = StudioPath.cgPath(path.d)
            context.saveGState()
            context.setAlpha(path.opacity)
            if let fill = StudioShapes.renderFill(path.fill, viewWidth, viewHeight) {
                context.saveGState()
                context.addPath(cg)
                switch fill {
                case .solid(let c):
                    context.setFillColor(cgColor(tint ?? c))
                    context.fillPath(using: path.evenOdd ? .evenOdd : .winding)
                case .linear(let x1, let y1, let x2, let y2, let stops):
                    context.clip(using: path.evenOdd ? .evenOdd : .winding)
                    if let gradient = gradient(stops, tint) {
                        context.drawLinearGradient(gradient, start: CGPoint(x: x1, y: y1), end: CGPoint(x: x2, y: y2), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
                    }
                case .radial(let cx, let cy, let r, let stops):
                    context.clip(using: path.evenOdd ? .evenOdd : .winding)
                    if let gradient = gradient(stops, tint) {
                        let centre = CGPoint(x: cx, y: cy)
                        context.drawRadialGradient(gradient, startCenter: centre, startRadius: 0, endCenter: centre, endRadius: r, options: [.drawsAfterEndLocation])
                    }
                }
                context.restoreGState()
            }
            if let stroke = StudioShapes.renderStroke(path.stroke) {
                context.addPath(cg)
                context.setStrokeColor(cgColor(tint ?? stroke.color))
                context.setLineWidth(stroke.width)
                context.setLineCap(stroke.cap == .round ? .round : stroke.cap == .square ? .square : .butt)
                context.setLineJoin(stroke.join == .round ? .round : stroke.join == .bevel ? .bevel : .miter)
                context.setLineDash(phase: 0, lengths: stroke.dash.map { CGFloat($0) })
                context.strokePath()
            }
            context.restoreGState()
        }
        context.restoreGState()
    }

    private static func gradient(_ stops: [StudioGradientStop], _ tint: String?) -> CGGradient? {
        let colors = stops.map { cgColor(tint ?? $0.color) } as CFArray
        var locations = stops.map { CGFloat($0.offset) }
        return CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: &locations)
    }

    /// Rasterises art into an image `pixels` wide/high on its longer side, with an optional backdrop.
    static func image(_ paths: [StudioVectorPath], viewWidth: Double, viewHeight: Double, side: CGFloat, background: String? = nil, tint: String? = nil) -> CGImage? {
        let scale = side / CGFloat(max(viewWidth, viewHeight))
        let width = max(1, Int((CGFloat(viewWidth) * scale).rounded())), height = max(1, Int((CGFloat(viewHeight) * scale).rounded()))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: 1, y: -1)
        if let background {
            context.setFillColor(cgColor(background))
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        draw(paths, viewWidth: viewWidth, viewHeight: viewHeight, in: CGRect(x: 0, y: 0, width: width, height: height), context: context, tint: tint)
        return context.makeImage()
    }
}
