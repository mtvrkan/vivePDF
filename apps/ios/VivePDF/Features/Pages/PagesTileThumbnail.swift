import ImageIO
import PDFKit
import SwiftUI

/// Rendered thumbnails shared by every organizer grid (cleared by the system under memory pressure).
enum PagesThumbnailCache {
    static let images: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 600
        return cache
    }()
}

/// One tile's picture: a page (own rotation plus the tile's turn), a ruled blank page, or a picture,
/// fitted into a `box` so every grid cell has the same height.
struct PagesTileThumbnail: View {
    let tile: OrganizerTile
    let model: OrganizerModel
    let box: CGSize
    @Environment(\.displayScale) private var scale
    @State private var image: UIImage?

    var body: some View {
        let size = fittedSize
        ZStack {
            Color.white
            content
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color.black.opacity(0.12)))
        .shadow(color: .black.opacity(0.10), radius: 3, y: 1)
        .frame(width: box.width, height: box.height)
        .task(id: renderKey) { await render() }
    }

    @ViewBuilder private var content: some View {
        switch tile.kind {
        case .blank(let width, let height, let paper):
            if let paper {
                Canvas { context, canvasSize in
                    let turned = tile.rotate % 180 != 0
                    let pageSize = CGSize(width: width, height: height)
                    let factor = (turned ? canvasSize.height : canvasSize.width) / max(pageSize.width, 1)
                    context.withCGContext { cg in
                        cg.translateBy(x: canvasSize.width / 2, y: canvasSize.height / 2)
                        cg.rotate(by: CGFloat(tile.rotate) * .pi / 180)
                        cg.scaleBy(x: factor, y: factor)
                        cg.translateBy(x: -pageSize.width / 2, y: -pageSize.height / 2)
                        PagesPaperMarks(width: width, height: height, pattern: paper).draw(in: cg, color: paper.color, lineScale: max(1, 0.8 / factor))
                    }
                }
            }
        default:
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                ProgressView().controlSize(.small)
            }
        }
    }

    /// Display aspect after rotation, fitted into the box.
    private var fittedSize: CGSize {
        let display = model.displaySize(of: tile) ?? CGSize(width: 595, height: 842)
        let factor = min(box.width / max(display.width, 1), box.height / max(display.height, 1))
        return CGSize(width: max(display.width * factor, 1), height: max(display.height * factor, 1))
    }

    private var renderKey: String {
        let pixels = Int(max(box.width, box.height) * scale)
        switch tile.kind {
        case .page(let source, let index):
            let document = model.source(source).map { ObjectIdentifier($0.document).hashValue } ?? 0
            return "p\(document)-\(index)-\(tile.rotate)-\(pixels)"
        case .image(let url): return "i\(url.path)-\(tile.rotate)-\(pixels)"
        case .blank: return "b"
        }
    }

    private func render() async {
        let pixels = max(box.width, box.height) * scale
        let key = renderKey as NSString
        if let cached = PagesThumbnailCache.images.object(forKey: key) { image = cached; return }
        let rotate = tile.rotate
        var rendered: UIImage?
        switch tile.kind {
        case .page:
            guard let page = model.page(for: tile) else { return }
            let target = CGSize(width: pixels, height: pixels)
            rendered = await Task.detached(priority: .utility) { page.thumbnail(of: target, for: .cropBox) }.value
        case .image(let url):
            rendered = await Task.detached(priority: .utility) { () -> UIImage? in
                PagesAssembler.orientedImage(url, maxPixels: Int(pixels)).map { UIImage(cgImage: $0) }
            }.value
        case .blank:
            return
        }
        guard let rendered, !Task.isCancelled else { return }
        let turned = Self.rotated(rendered, by: rotate)
        PagesThumbnailCache.images.setObject(turned, forKey: key)
        image = turned
    }

    /// Turns an image by quarter turns without re-rendering.
    static func rotated(_ image: UIImage, by degrees: Int) -> UIImage {
        guard degrees % 360 != 0, let cgImage = image.cgImage else { return image }
        let orientation: UIImage.Orientation = switch degrees % 360 {
        case 90: .right
        case 180: .down
        default: .left
        }
        return UIImage(cgImage: cgImage, scale: image.scale, orientation: orientation)
    }
}

/// Picture of a ruled paper pattern for the Insert Blank sheet.
struct PagesPaperPreview: View {
    let size: CGSize
    let paper: PagesPaperPattern

    var body: some View {
        Canvas { context, canvasSize in
            let factor = min(canvasSize.width / size.width, canvasSize.height / size.height)
            context.withCGContext { cg in
                cg.translateBy(x: (canvasSize.width - size.width * factor) / 2, y: (canvasSize.height - size.height * factor) / 2)
                cg.scaleBy(x: factor, y: factor)
                PagesPaperMarks(width: size.width, height: size.height, pattern: paper).draw(in: cg, color: paper.color, lineScale: max(1, 0.8 / factor))
            }
        }
        .aspectRatio(size.width / max(size.height, 1), contentMode: .fit)
        .background(Color.white)
        .overlay(Rectangle().strokeBorder(Color.black.opacity(0.15)))
        .accessibilityHidden(true)
    }
}
