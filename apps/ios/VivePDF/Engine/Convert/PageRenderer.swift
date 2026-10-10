import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers

/// Raster rendering of PDF pages (whole pages or clipped regions) and image file encoding.
enum PageRenderer {
    static let maxSide = 16_000
    static let maxPixels = 120_000_000

    /// DPI that keeps a page of `size` points inside the pixel limits (`page_dpi` on desktop).
    static func safeDPI(_ size: CGSize, dpi: CGFloat, maxSide: Int = PageRenderer.maxSide) -> CGFloat {
        let bySide = CGFloat(maxSide - 2) * 72 / max(size.width, size.height, 1)
        let byPixels = 72 * sqrt(CGFloat(maxPixels) / max(size.width * size.height, 1))
        return max(1, min(dpi, bySide, byPixels).rounded(.down))
    }

    /// Renders `clip` (display coordinates, whole page when nil) at `dpi`.
    static func render(_ page: PDFPage, dpi: CGFloat, gray: Bool = false, transparent: Bool = false, clip: CGRect? = nil) -> CGImage? {
        let pageSize = PDFPageReader.displaySize(page)
        let area = (clip ?? CGRect(origin: .zero, size: pageSize)).intersection(CGRect(origin: .zero, size: pageSize))
        guard area.width > 0, area.height > 0 else { return nil }
        let scale = dpi / 72
        let width = max(1, Int((area.width * scale).rounded()))
        let height = max(1, Int((area.height * scale).rounded()))
        let space = gray ? CGColorSpaceCreateDeviceGray() : CGColorSpace(name: CGColorSpace.sRGB)!
        let info: UInt32 = gray
            ? (transparent ? CGImageAlphaInfo.premultipliedLast.rawValue : CGImageAlphaInfo.none.rawValue)
            : (transparent ? CGImageAlphaInfo.premultipliedLast.rawValue : CGImageAlphaInfo.noneSkipLast.rawValue)
        // Gray with alpha is not a supported bitmap layout: render RGBA and convert afterwards.
        let renderSpace = gray && transparent ? CGColorSpace(name: CGColorSpace.sRGB)! : space
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: renderSpace,
                                      bitmapInfo: gray && transparent ? CGImageAlphaInfo.premultipliedLast.rawValue : info) else { return nil }
        if !transparent {
            context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        context.interpolationQuality = .high
        // Display space (top-left) → bitmap (bottom-left).
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: -area.minX, y: -(pageSize.height - area.maxY))
        draw(page, in: context)
        guard let image = context.makeImage() else { return nil }
        if gray && transparent { return grayscale(image) ?? image }
        return image
    }

    /// Draws a page in display orientation into a context whose user space is display points, y up.
    static func draw(_ page: PDFPage, in context: CGContext) {
        context.saveGState()
        // PDFKit draws the box with its rotation applied, origin at the bottom-left of the rotated box.
        page.draw(with: .cropBox, to: context)
        context.restoreGState()
    }

    private static func grayscale(_ image: CGImage) -> CGImage? {
        // Luminance into gray, alpha preserved by drawing twice: gray copy masked with the source alpha.
        guard let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let rect = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        context.clip(to: rect, mask: image)
        context.draw(image, in: rect)
        context.setBlendMode(.saturation)
        context.setFillColor(CGColor(gray: 0.5, alpha: 1))
        context.fill(rect)
        return context.makeImage()
    }
}

/// Writes CGImages with ImageIO (PNG, JPEG, HEIC, WebP when the OS can encode it, multi-page TIFF).
enum ImageEncoder {
    enum Format: String, CaseIterable, Sendable {
        case png, jpg, webp, tiff, heic

        var type: UTType {
            switch self {
            case .png: .png
            case .jpg: .jpeg
            case .webp: .webP
            case .tiff: .tiff
            case .heic: .heic
            }
        }

        var lossy: Bool { self == .jpg || self == .webp || self == .heic }
        var supportsAlpha: Bool { self != .jpg }

        /// Formats this device can write (WebP encoding is not available on every OS version).
        static var writable: [Format] {
            let identifiers = Set((CGImageDestinationCopyTypeIdentifiers() as? [String]) ?? [])
            return allCases.filter { identifiers.contains($0.type.identifier) }
        }
    }

    static func data(_ images: [CGImage], format: Format, quality: Double = 0.88, dpi: CGFloat = 72) -> Data? {
        let data = NSMutableData()
        guard !images.isEmpty, let destination = CGImageDestinationCreateWithData(data as CFMutableData, format.type.identifier as CFString, images.count, nil) else { return nil }
        var properties: [CFString: Any] = [kCGImagePropertyDPIWidth: dpi, kCGImagePropertyDPIHeight: dpi]
        if format.lossy { properties[kCGImageDestinationLossyCompressionQuality] = quality }
        if format == .tiff { properties[kCGImagePropertyTIFFDictionary] = [kCGImagePropertyTIFFCompression: 5] }
        if format == .png { properties[kCGImagePropertyPNGDictionary] = [kCGImagePropertyPNGXResolution: dpi, kCGImagePropertyPNGYResolution: dpi] }
        for image in images { CGImageDestinationAddImage(destination, image, properties as CFDictionary) }
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }

    static func write(_ images: [CGImage], format: Format, quality: Double = 0.88, dpi: CGFloat = 72, to url: URL) throws {
        guard let data = data(images, format: format, quality: quality, dpi: dpi) else { throw EngineError(.UNSUPPORTED, detail: format.rawValue) }
        try data.write(to: url, options: .atomic)
    }

    /// PNG when the picture has transparency, JPEG otherwise (pictures embedded in documents).
    static func documentPicture(_ image: CGImage) -> (data: Data, ext: String, mime: String)? {
        let alpha = image.alphaInfo
        let hasAlpha = !(alpha == .none || alpha == .noneSkipLast || alpha == .noneSkipFirst)
        if hasAlpha, let png = data([image], format: .png) { return (png, "png", "image/png") }
        if let jpeg = data([image], format: .jpg, quality: 0.85) { return (jpeg, "jpg", "image/jpeg") }
        return data([image], format: .png).map { ($0, "png", "image/png") }
    }
}
