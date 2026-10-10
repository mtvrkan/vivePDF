import CoreGraphics
import CoreImage
import Foundation

/// QR module matrices from Core Image's generator (the desktop uses zxing-cpp without quiet zones).
enum StudioQRCode {
    struct Modules {
        let size: Int
        let bits: [Bool]
        func dark(_ row: Int, _ column: Int) -> Bool { bits[row * size + column] }
    }

    private final class Box { let value: Modules?; init(_ v: Modules?) { value = v } }
    private static let cache: NSCache<NSString, Box> = {
        let c = NSCache<NSString, Box>()
        c.countLimit = 256
        return c
    }()

    static func modules(_ value: String, level: StudioQRLevel) -> Modules? {
        let key = "\(level.rawValue)|\(value)" as NSString
        if let hit = cache.object(forKey: key) { return hit.value }
        let result = generate(value, level: level)
        cache.setObject(Box(result), forKey: key)
        return result
    }

    private static func generate(_ value: String, level: StudioQRLevel) -> Modules? {
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(Data(value.utf8), forKey: "inputMessage")
        filter.setValue(level.rawValue, forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage else { return nil }
        let context = CIContext(options: [.workingColorSpace: NSNull()])
        guard let cg = context.createCGImage(output, from: output.extent) else { return nil }
        let w = cg.width, h = cg.height
        var pixels = [UInt8](repeating: 255, count: w * h)
        guard let gray = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        gray.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        // Trim the generator's quiet zone: the finder patterns bound the symbol exactly.
        var minX = w, minY = h, maxX = -1, maxY = -1
        for y in 0..<h { for x in 0..<w where pixels[y * w + x] < 128 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) } }
        guard maxX >= minX, maxY >= minY else { return nil }
        let size = min(maxX - minX + 1, maxY - minY + 1)
        var bits = [Bool](repeating: false, count: size * size)
        for row in 0..<size { for column in 0..<size { bits[row * size + column] = pixels[(minY + row) * w + minX + column] < 128 } }
        return Modules(size: size, bits: bits)
    }
}
