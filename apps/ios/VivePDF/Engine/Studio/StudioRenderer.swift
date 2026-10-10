import CoreGraphics
import CoreImage
import CoreText
import Foundation
import ImageIO

/// Draws Studio pages with Core Graphics / Core Text — the same code paints the canvas, thumbnails
/// and vector PDF / PNG / JPEG exports, so what you see is exactly what you export. Mirrors the
/// desktop engine (`studio.py`, `_studio_vector.py`, `_studio_text_draw.py`, `_studio_shadow.py`).
enum StudioRenderer {
    struct Options {
        /// UI / document language for letter case rules (Turkish dotted i).
        var language: String = "en"
        /// Mail-merge values (`{n}`, `{date}`, custom fields). Empty leaves placeholders as typed.
        var values: [String: String] = [:]
        /// Paint a plain white background instead of leaving it transparent (desktop `keepWhite`).
        var keepWhite = false
        /// Draw grey placeholders for empty image frames (template thumbnails, canvas).
        var imagePlaceholders = false
        /// Skip these element ids (the canvas draws the element being edited itself).
        var skip: Set<String> = []
        /// Pixel budget hint for images (raster outputs downsample big photos).
        var maxImagePixels: CGFloat = 0
        /// Drawing into a PDF: photos are capped at 300 dpi and embedded as JPEG when opaque.
        var pdf = false
    }

    static let miterLimit: CGFloat = 4

    // MARK: Page

    /// Paints `page` into `context`, whose user space is page points with the origin at the top-left
    /// and y growing downwards.
    static func draw(page: StudioPage, in context: CGContext, options: Options = Options()) {
        drawBackground(page, context, options)
        for element in page.elements where !options.skip.contains(element.id) {
            draw(element: element, in: context, options: options)
        }
    }

    static func drawBackground(_ page: StudioPage, _ context: CGContext, _ options: Options) {
        let frame = CGRect(x: 0, y: 0, width: page.width, height: page.height)
        if let fill = StudioShapes.renderFill(page.background.fill, page.width, page.height) {
            let plainWhite: Bool = if case .solid(let c) = fill { c.lowercased() == "#ffffff" } else { false }
            if options.keepWhite || !plainWhite {
                context.saveGState()
                paint(fill, path: CGPath(rect: frame, transform: nil), evenOdd: false, in: context)
                context.restoreGState()
            }
        }
        if let image = page.background.image, image.opacity > 0 {
            var element = StudioFactory.image(src: image.src, x: 0, y: 0, width: page.width, height: page.height)
            element.opacity = image.opacity
            element.image?.fit = image.fit
            draw(element: element, in: context, options: options)
        }
    }

    // MARK: Elements

    /// Paints one element (no page background) in page coordinates.
    static func draw(element: StudioElement, in context: CGContext, options: Options = Options()) {
        guard !element.hidden, element.opacity > 0 else { return }
        if case .text(let text) = element.content, text.plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
        if case .qr(let qr) = element.content, qr.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
        let shadow = element.dropShadow.flatMap { $0.opacity > 0 ? $0 : nil }
        context.saveGState()
        context.setAlpha(CGFloat(element.opacity))
        let grouped = element.opacity < 1 || shadow != nil
        if grouped { context.beginTransparencyLayer(auxiliaryInfo: nil) }
        if let shadow {
            // Shadow offsets live in device space; compute them from the page transform.
            let ctm = context.ctm
            let dx = CGFloat(shadow.x), dy = CGFloat(shadow.y)
            let offset = CGSize(width: ctm.a * dx + ctm.c * dy, height: ctm.b * dx + ctm.d * dy)
            let scale = sqrt(abs(ctm.a * ctm.d - ctm.b * ctm.c))
            context.setShadow(offset: offset, blur: CGFloat(shadow.blur) * 2 * scale, color: cgColor(shadow.color, alpha: shadow.opacity))
            context.beginTransparencyLayer(auxiliaryInfo: nil)
        }
        context.concatenate(transform(for: element))
        drawContent(element, context, options)
        if shadow != nil { context.endTransparencyLayer() }
        if grouped { context.endTransparencyLayer() }
        context.restoreGState()
    }

    /// Element box → page transform: rotation about the centre, then mirroring inside the box.
    static func transform(for e: StudioElement) -> CGAffineTransform {
        var t = CGAffineTransform(translationX: e.x + e.width / 2, y: e.y + e.height / 2)
        if e.rotation != 0 { t = t.rotated(by: e.rotation * .pi / 180) }
        if e.flipX || e.flipY { t = t.scaledBy(x: e.flipX ? -1 : 1, y: e.flipY ? -1 : 1) }
        return t.translatedBy(x: -e.width / 2, y: -e.height / 2)
    }

    private static func drawContent(_ e: StudioElement, _ context: CGContext, _ options: Options) {
        switch e.content {
        case .text(let text):
            drawText(text, width: e.width, height: e.height, context: context, options: options)
        case .shape(let shape):
            drawPaths(StudioShapes.shapePaths(shape, width: e.width, height: e.height), context)
        case .vector(let vector):
            context.saveGState()
            context.scaleBy(x: e.width / max(0.0001, vector.viewWidth), y: e.height / max(0.0001, vector.viewHeight))
            let paths = vector.paths.map { p in
                StudioShapes.RenderPath(d: p.d, fill: StudioShapes.renderFill(p.fill, vector.viewWidth, vector.viewHeight), stroke: StudioShapes.renderStroke(p.stroke), evenOdd: p.evenOdd, opacity: p.opacity)
            }
            drawPaths(paths, context)
            context.restoreGState()
        case .image(let image):
            drawImage(image, size: CGSize(width: e.width, height: e.height), context: context, options: options)
        case .qr(let qr):
            drawQR(qr, size: CGSize(width: e.width, height: e.height), context: context, values: options.values)
        case .svg(let svg):
            let rect = CGRect(x: 0, y: 0, width: e.width, height: e.height)
            if !StudioGraphics.draw(svg, in: rect, context: context, values: options.values) {
                StudioSVGRenderer.draw(StudioSVGColors.recolored(svg.svg, svg.colorMap), in: rect, context: context)
            }
        }
    }

    // MARK: Paint

    static func cgColor(_ hex: String, alpha: Double = 1) -> CGColor {
        let (r, g, b) = StudioColor.components(hex)
        return CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: [r, g, b, alpha]) ?? CGColor(red: r, green: g, blue: b, alpha: alpha)
    }

    private static func normalisedStops(_ stops: [StudioGradientStop]) -> [StudioGradientStop] {
        var ordered = StudioShapes.sortedStops(stops)
        guard let first = ordered.first, let last = ordered.last else { return [StudioGradientStop(offset: 0, color: "#000000"), StudioGradientStop(offset: 1, color: "#000000")] }
        if first.offset > 0 { ordered.insert(StudioGradientStop(offset: 0, color: first.color), at: 0) }
        if last.offset < 1 { ordered.append(StudioGradientStop(offset: 1, color: last.color)) }
        if ordered.count == 1 { ordered.append(StudioGradientStop(offset: 1, color: ordered[0].color)) }
        return ordered
    }

    private static func gradient(_ stops: [StudioGradientStop]) -> CGGradient? {
        let list = normalisedStops(stops)
        return CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: list.map { cgColor($0.color) } as CFArray, locations: list.map { CGFloat($0.offset) })
    }

    static func paint(_ fill: StudioShapes.RenderFill, path: CGPath, evenOdd: Bool, in context: CGContext) {
        switch fill {
        case .solid(let color):
            context.addPath(path)
            context.setFillColor(cgColor(color))
            context.fillPath(using: evenOdd ? .evenOdd : .winding)
        case .linear(let x1, let y1, let x2, let y2, let stops):
            guard let g = gradient(stops) else { return }
            context.saveGState()
            context.addPath(path)
            context.clip(using: evenOdd ? .evenOdd : .winding)
            context.drawLinearGradient(g, start: CGPoint(x: x1, y: y1), end: CGPoint(x: x2, y: y2), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            context.restoreGState()
        case .radial(let cx, let cy, let r, let stops):
            guard let g = gradient(stops) else { return }
            context.saveGState()
            context.addPath(path)
            context.clip(using: evenOdd ? .evenOdd : .winding)
            let centre = CGPoint(x: cx, y: cy)
            context.drawRadialGradient(g, startCenter: centre, startRadius: 0, endCenter: centre, endRadius: r, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            context.restoreGState()
        }
    }

    static func applyStroke(_ stroke: StudioShapes.RenderStroke, _ context: CGContext) {
        context.setStrokeColor(cgColor(stroke.color))
        context.setLineWidth(stroke.width)
        let cap: CGLineCap = switch stroke.cap { case .butt: .butt; case .round: .round; case .square: .square }
        let join: CGLineJoin = switch stroke.join { case .miter: .miter; case .round: .round; case .bevel: .bevel }
        context.setLineCap(cap)
        context.setLineJoin(join)
        context.setMiterLimit(miterLimit)
        let dash = stroke.dash.filter { $0 >= 0 }
        if dash.isEmpty || !dash.contains(where: { $0 > 0 }) { context.setLineDash(phase: 0, lengths: []) } else { context.setLineDash(phase: 0, lengths: dash.map { CGFloat($0) }) }
    }

    static func drawPaths(_ paths: [StudioShapes.RenderPath], _ context: CGContext) {
        for p in paths where p.fill != nil || p.stroke != nil {
            let path = StudioPath.cgPath(p.d)
            guard !path.isEmpty else { continue }
            context.saveGState()
            let grouped = p.opacity < 1 && p.fill != nil && p.stroke != nil
            context.setAlpha(CGFloat(p.opacity))
            if grouped { context.beginTransparencyLayer(auxiliaryInfo: nil); context.setAlpha(1) }
            if let fill = p.fill { paint(fill, path: path, evenOdd: p.evenOdd, in: context) }
            if let stroke = p.stroke {
                applyStroke(stroke, context)
                context.addPath(path)
                context.strokePath()
            }
            if grouped { context.endTransparencyLayer() }
            context.restoreGState()
        }
    }

    // MARK: Text

    private static let underlineKey = NSAttributedString.Key("vpUnderline")
    private static let strikeKey = NSAttributedString.Key("vpStrike")

    /// Draws laid-out text inside a `width` × `height` box at the origin (y down).
    static func drawText(_ text: StudioText, width: Double, height: Double, context: CGContext, options: Options) {
        let layout = StudioTextLayout.layout(text, width: width, height: height, values: options.values, language: text.language ?? options.language)
        drawLayout(layout, text: text, context: context)
    }

    static func drawLayout(_ layout: StudioTextLayout.Result, text: StudioText, context: CGContext) {
        if let highlight = text.highlight, !layout.bands.isEmpty {
            context.setFillColor(cgColor(highlight.color))
            for band in layout.bands {
                context.fill(band.insetBy(dx: -highlight.padding, dy: -highlight.padding))
            }
        }
        let lines = layout.lines.map { line(for: $0, layout: layout) }
        if let shadow = text.shadow, shadow.opacity > 0 {
            context.saveGState()
            context.translateBy(x: shadow.x, y: shadow.y)
            context.setAlpha(CGFloat(shadow.opacity))
            context.beginTransparencyLayer(auxiliaryInfo: nil)
            let colour = cgColor(shadow.color)
            for (laid, built) in zip(layout.lines, lines) { decorations(laid, built, layout, kind: underlineKey, colour: colour, context: context) }
            for (laid, built) in zip(layout.lines, lines) { glyphs(laid, built, layout, mode: .fill, colour: colour, width: 0, context: context) }
            for (laid, built) in zip(layout.lines, lines) { decorations(laid, built, layout, kind: strikeKey, colour: colour, context: context) }
            context.endTransparencyLayer()
            context.restoreGState()
        }
        for (laid, built) in zip(layout.lines, lines) { decorations(laid, built, layout, kind: underlineKey, colour: nil, context: context) }
        if let outline = text.outline {
            for (laid, built) in zip(layout.lines, lines) { glyphs(laid, built, layout, mode: .stroke, colour: cgColor(outline.color), width: outline.width * 2, context: context) }
        }
        for (laid, built) in zip(layout.lines, lines) { glyphs(laid, built, layout, mode: .fill, colour: nil, width: 0, context: context) }
        for (laid, built) in zip(layout.lines, lines) { decorations(laid, built, layout, kind: strikeKey, colour: nil, context: context) }
    }

    struct BuiltLine {
        let line: CTLine?
        /// The same line taking its colour from the context (shadow and outline passes).
        let contextLine: CTLine?
        /// Visual x extents of each atom (box coordinates), in logical order.
        let extents: [(Double, Double)]
        let marker: CTLine?
        let contextMarker: CTLine?
    }

    private static func line(for laid: StudioTextLayout.LaidLine, layout: StudioTextLayout.Result) -> BuiltLine {
        let string = NSMutableAttributedString()
        var ranges: [NSRange] = []
        for atom in laid.atoms {
            let face = atom.style.face
            let size = atom.style.size * layout.scale
            let piece = atom.text.replacingOccurrences(of: "\t", with: " ")
            var kern = layout.spacing
            if atom.space { kern += laid.extra }
            var attrs = StudioTextLayout.attributes(font: face.font(size: size), color: cgColor(atom.style.color), kern: kern)
            if atom.style.underline { attrs[underlineKey] = true }
            if atom.style.strike { attrs[strikeKey] = true }
            attrs[NSAttributedString.Key("vpColor")] = atom.style.color
            let start = string.length
            string.append(NSAttributedString(string: piece, attributes: attrs))
            ranges.append(NSRange(location: start, length: string.length - start))
        }
        var ctLine: CTLine?
        var extents: [(Double, Double)] = []
        if string.length > 0 {
            var direction = layout.direction == .rtl ? CTWritingDirection.rightToLeft : .leftToRight
            let setting = withUnsafeBytes(of: &direction) { raw in
                CTParagraphStyleSetting(spec: .baseWritingDirection, valueSize: MemoryLayout<CTWritingDirection>.size, value: raw.baseAddress!)
            }
            let style = withUnsafePointer(to: setting) { CTParagraphStyleCreate($0, 1) }
            string.addAttribute(NSAttributedString.Key(kCTParagraphStyleAttributeName as String), value: style, range: NSRange(location: 0, length: string.length))
            let made = CTLineCreateWithAttributedString(string)
            ctLine = made
            for range in ranges {
                let a = Double(CTLineGetOffsetForStringIndex(made, range.location, nil))
                let b = Double(CTLineGetOffsetForStringIndex(made, range.location + range.length, nil))
                extents.append((laid.x + min(a, b), laid.x + max(a, b)))
            }
            // RTL runs report offsets of the leading edge; fall back to measured widths when collapsed.
            for i in extents.indices where extents[i].1 - extents[i].0 < 0.01 && laid.widths[i] > 0.01 {
                extents[i] = (extents[i].0 - (layout.direction == .rtl ? laid.widths[i] : 0), extents[i].0 + (layout.direction == .rtl ? 0 : laid.widths[i]))
            }
        }
        var markerLine: CTLine?, contextMarker: CTLine?
        let fromContext = NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String)
        if let marker = laid.marker {
            let size = marker.style.size * layout.scale
            var attrs = StudioTextLayout.attributes(font: marker.style.face.font(size: size), color: cgColor(marker.style.color), kern: layout.spacing)
            markerLine = CTLineCreateWithAttributedString(NSAttributedString(string: marker.text, attributes: attrs))
            attrs[fromContext] = true
            contextMarker = CTLineCreateWithAttributedString(NSAttributedString(string: marker.text, attributes: attrs))
        }
        var contextLine: CTLine?
        if string.length > 0 {
            let copy = NSMutableAttributedString(attributedString: string)
            copy.addAttribute(fromContext, value: true, range: NSRange(location: 0, length: copy.length))
            contextLine = CTLineCreateWithAttributedString(copy)
        }
        return BuiltLine(line: ctLine, contextLine: contextLine, extents: extents, marker: markerLine, contextMarker: contextMarker)
    }

    private static func glyphs(_ laid: StudioTextLayout.LaidLine, _ built: BuiltLine, _ layout: StudioTextLayout.Result, mode: CGTextDrawingMode, colour: CGColor?, width: Double, context: CGContext) {
        context.saveGState()
        context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        context.setTextDrawingMode(mode)
        if let colour {
            context.setFillColor(colour)
            context.setStrokeColor(colour)
        }
        if mode == .stroke {
            context.setLineWidth(width)
            context.setLineJoin(.miter)
            context.setMiterLimit(miterLimit)
        }
        let recolour = colour != nil
        if let line = recolour ? built.contextLine : built.line {
            context.textPosition = CGPoint(x: laid.x, y: laid.baseline)
            CTLineDraw(line, context)
        }
        if let marker = recolour ? built.contextMarker : built.marker, let m = laid.marker {
            context.textPosition = CGPoint(x: m.x, y: laid.baseline)
            CTLineDraw(marker, context)
        }
        context.restoreGState()
    }

    private static func decorations(_ laid: StudioTextLayout.LaidLine, _ built: BuiltLine, _ layout: StudioTextLayout.Result, kind: NSAttributedString.Key, colour: CGColor?, context: CGContext) {
        var spans: [(Double, Double, StudioTextLayout.Style)] = []
        var previous: Int?
        for (index, atom) in laid.atoms.enumerated() where !atom.space && index < built.extents.count {
            let on = kind == underlineKey ? atom.style.underline : atom.style.strike
            guard on else { previous = nil; continue }
            let (a, b) = built.extents[index]
            if let p = previous, laid.atoms[p].style.color == atom.style.color || colour != nil, let last = spans.last {
                spans[spans.count - 1] = (min(last.0, a), max(last.1, b), last.2)
            } else {
                spans.append((a, b, atom.style))
            }
            previous = index
        }
        for (start, end, style) in spans {
            let face = style.face
            let size = style.size * layout.scale
            let y: Double
            let thickness: Double
            if kind == underlineKey {
                y = laid.baseline + face.underlinePosition * size
                thickness = face.underlineThickness * size
            } else {
                y = laid.baseline - face.ascender * size / 3
                thickness = face.strikeThickness * size
            }
            context.setStrokeColor(colour ?? cgColor(style.color))
            context.setLineWidth(thickness)
            context.setLineDash(phase: 0, lengths: [])
            context.setLineCap(.butt)
            context.move(to: CGPoint(x: start, y: y))
            context.addLine(to: CGPoint(x: end, y: y))
            context.strokePath()
        }
    }

    // MARK: Images

    private static let imageCache: NSCache<NSString, CGImage> = {
        let c = NSCache<NSString, CGImage>()
        c.totalCostLimit = 400 * 1024 * 1024
        return c
    }()

    /// Decoded, orientation-corrected image for a stored path (cached).
    static func loadImage(_ path: String, maxPixels: CGFloat = 0) -> CGImage? {
        let key = "\(path)|\(Int(maxPixels))" as NSString
        if let hit = imageCache.object(forKey: key) { return hit }
        let url = path.hasPrefix("file://") ? URL(string: path) : URL(fileURLWithPath: path)
        guard let url, let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let w = (props?[kCGImagePropertyPixelWidth] as? CGFloat) ?? 4096
        let h = (props?[kCGImagePropertyPixelHeight] as? CGFloat) ?? 4096
        let longest = max(w, h)
        let limit = maxPixels > 0 ? min(longest, maxPixels) : min(longest, 8192)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: limit,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        imageCache.setObject(image, forKey: key, cost: image.bytesPerRow * image.height)
        return image
    }

    static func imageSize(_ path: String) -> CGSize? {
        let url = URL(fileURLWithPath: path)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? CGFloat, let h = props[kCGImagePropertyPixelHeight] as? CGFloat else { return nil }
        let orientation = (props[kCGImagePropertyOrientation] as? Int) ?? 1
        return orientation >= 5 ? CGSize(width: h, height: w) : CGSize(width: w, height: h)
    }

    /// Rounds a pixel budget up to a power of two so the decode cache stays small while resizing.
    static func bucket(_ pixels: CGFloat) -> CGFloat {
        var value: CGFloat = 256
        while value < pixels && value < 8192 { value *= 2 }
        return value
    }

    /// Opaque pictures go into PDFs as JPEG (q 0.9) like the desktop engine; others stay lossless.
    static func jpegBacked(_ image: CGImage) -> CGImage {
        switch image.alphaInfo {
        case .none, .noneSkipFirst, .noneSkipLast: break
        default: return image
        }
        guard let data = StudioProject.encode(image, type: .jpeg, quality: 0.9), let provider = CGDataProvider(data: data as CFData),
              let jpeg = CGImage(jpegDataProviderSource: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { return image }
        return jpeg
    }

    private static let ciContext = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])

    /// Desktop filter matrix (3×4, rows R/G/B with offset) applied in sRGB.
    static func filtered(_ image: CGImage, _ filters: StudioImageFilters?) -> CGImage {
        guard let filters, let m = StudioImageFilterMath.matrix(filters) else { return image }
        let input = CIImage(cgImage: image)
        guard let filter = CIFilter(name: "CIColorMatrix") else { return image }
        filter.setValue(input, forKey: kCIInputImageKey)
        filter.setValue(CIVector(x: m[0], y: m[1], z: m[2], w: 0), forKey: "inputRVector")
        filter.setValue(CIVector(x: m[4], y: m[5], z: m[6], w: 0), forKey: "inputGVector")
        filter.setValue(CIVector(x: m[8], y: m[9], z: m[10], w: 0), forKey: "inputBVector")
        filter.setValue(CIVector(x: 0, y: 0, z: 0, w: 1), forKey: "inputAVector")
        filter.setValue(CIVector(x: m[3], y: m[7], z: m[11], w: 0), forKey: "inputBiasVector")
        guard let output = filter.outputImage?.cropped(to: input.extent),
              let result = ciContext.createCGImage(output, from: input.extent) else { return image }
        return result
    }

    static func drawImage(_ image: StudioImage, size: CGSize, context: CGContext, options: Options) {
        let rect = CGRect(origin: .zero, size: size)
        let clip: CGPath = switch image.mask {
        case .circle: CGPath(ellipseIn: rect, transform: nil)
        case .rounded: StudioPath.cgPath(StudioShapes.roundedRect(0, 0, size.width, size.height, image.cornerRadius))
        case .none: CGPath(rect: rect, transform: nil)
        }
        let wanted = options.maxImagePixels > 0 ? options.maxImagePixels : bucket(max(size.width / max(0.01, image.crop.width), size.height / max(0.01, image.crop.height)) * (options.pdf ? 300.0 / 72.0 : 3) * 1.5)
        if let source = image.src.isEmpty ? nil : loadImage(image.src, maxPixels: wanted) {
            var picture = source
            let pw = CGFloat(picture.width), ph = CGFloat(picture.height)
            if !image.crop.isWhole {
                let left = (image.crop.x * pw).rounded(), top = (image.crop.y * ph).rounded()
                let right = min(pw, max(left + 1, ((image.crop.x + image.crop.width) * pw).rounded()))
                let bottom = min(ph, max(top + 1, ((image.crop.y + image.crop.height) * ph).rounded()))
                picture = picture.cropping(to: CGRect(x: left, y: top, width: right - left, height: bottom - top)) ?? picture
            }
            if image.fit == .cover, size.width > 0, size.height > 0 {
                let w = CGFloat(picture.width), h = CGFloat(picture.height)
                let aspect = size.width / size.height
                if w / h > aspect {
                    let kept = max(1, (h * aspect).rounded())
                    picture = picture.cropping(to: CGRect(x: ((w - kept) / 2).rounded(.down), y: 0, width: kept, height: h)) ?? picture
                } else {
                    let kept = max(1, (w / aspect).rounded())
                    picture = picture.cropping(to: CGRect(x: 0, y: ((h - kept) / 2).rounded(.down), width: w, height: kept)) ?? picture
                }
            }
            var placed = rect
            if image.fit == .contain {
                let w = CGFloat(picture.width), h = CGFloat(picture.height)
                let scale = min(size.width / w, size.height / h)
                placed = CGRect(x: (size.width - w * scale) / 2, y: (size.height - h * scale) / 2, width: w * scale, height: h * scale)
            }
            picture = filtered(picture, image.filters)
            if options.pdf { picture = jpegBacked(picture) }
            context.saveGState()
            context.addPath(clip)
            context.clip()
            // CGContext draws images y-up; flip locally.
            context.translateBy(x: placed.minX, y: placed.maxY)
            context.scaleBy(x: 1, y: -1)
            context.interpolationQuality = .high
            context.draw(picture, in: CGRect(x: 0, y: 0, width: placed.width, height: placed.height))
            context.restoreGState()
        } else if options.imagePlaceholders {
            drawImagePlaceholder(size: size, clip: clip, context: context)
        }
        if let stroke = StudioShapes.renderStroke(image.stroke) {
            let d = image.mask == .circle ? StudioShapes.ellipse(size.width / 2, size.height / 2, size.width / 2, size.height / 2)
                : StudioShapes.roundedRect(0, 0, size.width, size.height, image.mask == .rounded ? image.cornerRadius : 0)
            drawPaths([StudioShapes.RenderPath(d: d, fill: nil, stroke: stroke)], context)
        }
    }

    /// Grey frame with a mountain-and-sun glyph (`thumbnailPage.placeholderOf`).
    static func drawImagePlaceholder(size: CGSize, clip: CGPath, context: CGContext) {
        let width = size.width, height = size.height
        let side = min(min(width, height) / 3, 48)
        let cx = width / 2, cy = height / 2, base = cy + side / 2
        context.saveGState()
        context.addPath(clip)
        context.setFillColor(cgColor("#e6e8ec"))
        context.fillPath()
        context.setFillColor(cgColor("#a3a9b4"))
        let peak = CGMutablePath()
        peak.addLines(between: [CGPoint(x: cx - side / 2, y: base), CGPoint(x: cx - side / 6, y: cy - side / 10), CGPoint(x: cx + side / 6, y: base)])
        peak.closeSubpath()
        let hill = CGMutablePath()
        hill.addLines(between: [CGPoint(x: cx - side / 10, y: base), CGPoint(x: cx + side / 5, y: cy + side / 8), CGPoint(x: cx + side / 2, y: base)])
        hill.closeSubpath()
        context.addPath(peak)
        context.addPath(hill)
        context.addEllipse(in: CGRect(x: cx + side / 4 - side / 9, y: cy - side / 4 - side / 9, width: side * 2 / 9, height: side * 2 / 9))
        context.fillPath()
        context.restoreGState()
    }

    // MARK: QR

    static func drawQR(_ qr: StudioQR, size: CGSize, context: CGContext, values: [String: String]) {
        let value = values.isEmpty ? qr.value : StudioPlaceholders.fill(qr.value, values)
        guard let modules = StudioQRCode.modules(value, level: qr.errorLevel) else { return }
        let count = CGFloat(modules.size)
        let side = min(size.width, size.height)
        let unit = side / count
        let left = (size.width - side) / 2, top = (size.height - side) / 2
        if let background = qr.background {
            context.setFillColor(cgColor(background))
            context.fill(CGRect(origin: .zero, size: size))
        }
        let path = CGMutablePath()
        for row in 0..<modules.size {
            var column = 0
            while column < modules.size {
                guard modules.dark(row, column) else { column += 1; continue }
                let start = column
                while column < modules.size && modules.dark(row, column) { column += 1 }
                path.addRect(CGRect(x: left + CGFloat(start) * unit, y: top + CGFloat(row) * unit, width: CGFloat(column - start) * unit, height: unit))
            }
        }
        context.addPath(path)
        context.setFillColor(cgColor(qr.color))
        context.fillPath()
    }

    // MARK: Raster

    /// Rasterises a page at `scale` pixels per point.
    static func image(page: StudioPage, scale: CGFloat, options: Options = Options(), opaque: Bool = true) -> CGImage? {
        let width = max(1, Int((page.width * scale).rounded())), height = max(1, Int((page.height * scale).rounded()))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                      bitmapInfo: opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        if opaque {
            context.setFillColor(CGColor(gray: 1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: CGFloat(width) / page.width, y: -CGFloat(height) / page.height)
        var opts = options
        if opts.maxImagePixels == 0 { opts.maxImagePixels = CGFloat(max(width, height)) * 1.5 }
        draw(page: page, in: context, options: opts)
        return context.makeImage()
    }

    /// A page preview whose longer side is `side` pixels (template gallery, recents, pages strip).
    static func thumbnail(page: StudioPage, side: CGFloat, language: String) -> CGImage? {
        let scale = side / max(page.width, page.height)
        var options = Options(language: language)
        options.imagePlaceholders = true
        return image(page: page, scale: scale, options: options, opaque: true)
    }
}

/// Port of `model/imageFilters.ts` (`filterMatrix`).
enum StudioImageFilterMath {
    typealias Affine = (matrix: [[Double]], offset: [Double])

    static let presets: [(String, StudioImageFilters)] = [
        ("none", .neutral),
        ("bw", StudioImageFilters(contrast: 1.1, grayscale: 1)),
        ("warm", StudioImageFilters(brightness: 1.03, saturation: 1.1, warmth: 0.6)),
        ("cool", StudioImageFilters(saturation: 0.95, warmth: -0.6)),
        ("vivid", StudioImageFilters(contrast: 1.15, saturation: 1.5)),
        ("fade", StudioImageFilters(brightness: 1.1, contrast: 0.75, saturation: 0.75)),
    ]

    static func preset(of filters: StudioImageFilters?) -> String? {
        let current = filters ?? .neutral
        return presets.first { p in
            abs(p.1.brightness - current.brightness) < 1e-9 && abs(p.1.contrast - current.contrast) < 1e-9 && abs(p.1.saturation - current.saturation) < 1e-9
                && abs(p.1.warmth - current.warmth) < 1e-9 && abs(p.1.sepia - current.sepia) < 1e-9 && abs(p.1.grayscale - current.grayscale) < 1e-9
        }?.0
    }

    private static func diagonal(_ r: Double, _ g: Double, _ b: Double, _ offset: Double = 0) -> Affine {
        ([[r, 0, 0], [0, g, 0], [0, 0, b]], [offset, offset, offset])
    }

    private static func saturation(_ a: Double) -> Affine {
        ([[0.213 + 0.787 * a, 0.715 - 0.715 * a, 0.072 - 0.072 * a],
          [0.213 - 0.213 * a, 0.715 + 0.285 * a, 0.072 - 0.072 * a],
          [0.213 - 0.213 * a, 0.715 - 0.715 * a, 0.072 + 0.928 * a]], [0, 0, 0])
    }

    private static func sepia(_ amount: Double) -> Affine {
        let r = 1 - amount
        return ([[0.393 + 0.607 * r, 0.769 - 0.769 * r, 0.189 - 0.189 * r],
                 [0.349 - 0.349 * r, 0.686 + 0.314 * r, 0.168 - 0.168 * r],
                 [0.272 - 0.272 * r, 0.534 - 0.534 * r, 0.131 + 0.869 * r]], [0, 0, 0])
    }

    private static func grayscale(_ amount: Double) -> Affine {
        let r = 1 - amount
        return ([[0.2126 + 0.7874 * r, 0.7152 - 0.7152 * r, 0.0722 - 0.0722 * r],
                 [0.2126 - 0.2126 * r, 0.7152 + 0.2848 * r, 0.0722 - 0.0722 * r],
                 [0.2126 - 0.2126 * r, 0.7152 - 0.7152 * r, 0.0722 + 0.9278 * r]], [0, 0, 0])
    }

    static func compose(_ first: Affine, _ second: Affine) -> Affine {
        let matrix = second.matrix.map { row in (0..<3).map { column in (0..<3).reduce(0.0) { $0 + row[$1] * first.matrix[$1][column] } } }
        let offset = second.matrix.enumerated().map { index, row in (0..<3).reduce(0.0) { $0 + row[$1] * first.offset[$1] } + second.offset[index] }
        return (matrix, offset)
    }

    /// 12 numbers (rows of `[r g b offset]`), rounded like the desktop; nil for neutral filters.
    static func matrix(_ filters: StudioImageFilters) -> [Double]? {
        guard !filters.isNeutral else { return nil }
        let steps: [Affine] = [
            diagonal(filters.brightness, filters.brightness, filters.brightness),
            diagonal(filters.contrast, filters.contrast, filters.contrast, 0.5 - 0.5 * filters.contrast),
            saturation(filters.saturation),
            diagonal(1 + 0.15 * filters.warmth, 1, 1 - 0.15 * filters.warmth),
            sepia(filters.sepia),
            grayscale(filters.grayscale),
        ]
        let affine = steps.dropFirst().reduce(steps[0], compose)
        return affine.matrix.enumerated().flatMap { index, row in row + [affine.offset[index]] }.map { ($0 * 1e6).rounded() / 1e6 }
    }
}
