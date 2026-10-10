import CoreGraphics
import Foundation
import ImageIO

/// Turns an image XObject stream into a file: JPEG data is saved as is (original quality), everything
/// else is decoded (DeviceGray/RGB/CMYK, ICC-based, Indexed, 1-bit masks, soft masks) and saved as PNG.
enum PDFImageExtractor {
    struct Extracted {
        var data: Data
        var ext: String
        var width: Int
        var height: Int
    }

    static func extract(_ stream: CGPDFStreamRef) -> Extracted? {
        guard let dictionary = CGPDFStreamGetDictionary(stream) else { return nil }
        var width: CGPDFInteger = 0, height: CGPDFInteger = 0
        CGPDFDictionaryGetInteger(dictionary, "Width", &width)
        CGPDFDictionaryGetInteger(dictionary, "Height", &height)
        var smask: CGPDFStreamRef?
        CGPDFDictionaryGetStream(dictionary, "SMask", &smask)
        var format = CGPDFDataFormat.raw
        guard let data = CGPDFStreamCopyData(stream, &format) as Data? else { return nil }
        switch format {
        case .jpegEncoded where smask == nil && !isCMYK(dictionary):
            return Extracted(data: data, ext: "jpg", width: Int(width), height: Int(height))
        case .jpegEncoded, .JPEG2000:
            guard let source = CGImageSourceCreateWithData(data as CFData, nil), var image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
            if let smask, let alpha = decode(smask, isMask: true) { image = applyAlpha(image, alpha) ?? image }
            return png(image)
        default:
            guard var image = decode(stream, raw: data) else { return nil }
            if let smask, let alpha = decode(smask, isMask: true) { image = applyAlpha(image, alpha) ?? image }
            return png(image)
        }
    }

    private static func png(_ image: CGImage) -> Extracted? {
        ImageEncoder.data([image], format: .png).map { Extracted(data: $0, ext: "png", width: image.width, height: image.height) }
    }

    private static func isCMYK(_ dictionary: CGPDFDictionaryRef) -> Bool {
        var name: UnsafePointer<CChar>?
        if CGPDFDictionaryGetName(dictionary, "ColorSpace", &name), let name { return String(cString: name) == "DeviceCMYK" }
        return false
    }

    /// Colour space of an image dictionary entry, with its component count.
    private static func colorSpace(_ object: CGPDFObjectRef?) -> (CGColorSpace, Int)? {
        guard let object else { return (CGColorSpaceCreateDeviceGray(), 1) }
        var name: UnsafePointer<CChar>?
        if CGPDFObjectGetValue(object, .name, &name), let name {
            switch String(cString: name) {
            case "DeviceRGB", "CalRGB": return (CGColorSpace(name: CGColorSpace.sRGB)!, 3)
            case "DeviceCMYK": return (CGColorSpaceCreateDeviceCMYK(), 4)
            default: return (CGColorSpaceCreateDeviceGray(), 1)
            }
        }
        var array: CGPDFArrayRef?
        guard CGPDFObjectGetValue(object, .array, &array), let array, CGPDFArrayGetCount(array) >= 1 else { return nil }
        var family: UnsafePointer<CChar>?
        guard CGPDFArrayGetName(array, 0, &family), let family else { return nil }
        switch String(cString: family) {
        case "ICCBased":
            var profile: CGPDFStreamRef?
            guard CGPDFArrayGetStream(array, 1, &profile), let profile, let info = CGPDFStreamGetDictionary(profile) else { return nil }
            var components: CGPDFInteger = 3
            CGPDFDictionaryGetInteger(info, "N", &components)
            var format = CGPDFDataFormat.raw
            if let data = CGPDFStreamCopyData(profile, &format), let space = CGColorSpace(iccData: data) { return (space, Int(components)) }
            return components == 1 ? (CGColorSpaceCreateDeviceGray(), 1) : components == 4 ? (CGColorSpaceCreateDeviceCMYK(), 4) : (CGColorSpace(name: CGColorSpace.sRGB)!, 3)
        case "CalRGB", "Lab": return (CGColorSpace(name: CGColorSpace.sRGB)!, 3)
        case "CalGray": return (CGColorSpaceCreateDeviceGray(), 1)
        case "Indexed", "I":
            var baseObject: CGPDFObjectRef?
            var high: CGPDFInteger = 0
            guard CGPDFArrayGetObject(array, 1, &baseObject), CGPDFArrayGetInteger(array, 2, &high),
                  let (base, count) = colorSpace(baseObject) else { return nil }
            var table = Data()
            var string: CGPDFStringRef?
            var lookup: CGPDFStreamRef?
            if CGPDFArrayGetString(array, 3, &string), let string, let bytes = CGPDFStringGetBytePtr(string) {
                table = Data(bytes: bytes, count: CGPDFStringGetLength(string))
            } else if CGPDFArrayGetStream(array, 3, &lookup), let lookup {
                var format = CGPDFDataFormat.raw
                table = (CGPDFStreamCopyData(lookup, &format) as Data?) ?? Data()
            }
            let needed = (Int(high) + 1) * count
            if table.count < needed { table.append(Data(repeating: 0, count: needed - table.count)) }
            let space = table.withUnsafeBytes { CGColorSpace(indexedBaseSpace: base, last: Int(high), colorTable: $0.bindMemory(to: UInt8.self).baseAddress!) }
            return space.map { ($0, 1) }
        default:
            return nil
        }
    }

    static func decode(_ stream: CGPDFStreamRef, raw: Data? = nil, isMask: Bool = false) -> CGImage? {
        guard let dictionary = CGPDFStreamGetDictionary(stream) else { return nil }
        var width: CGPDFInteger = 0, height: CGPDFInteger = 0, bits: CGPDFInteger = 8
        CGPDFDictionaryGetInteger(dictionary, "Width", &width)
        CGPDFDictionaryGetInteger(dictionary, "Height", &height)
        CGPDFDictionaryGetInteger(dictionary, "BitsPerComponent", &bits)
        var stencil: CGPDFBoolean = 0
        CGPDFDictionaryGetBoolean(dictionary, "ImageMask", &stencil)
        guard width > 0, height > 0 else { return nil }
        var format = CGPDFDataFormat.raw
        guard let data = raw ?? (CGPDFStreamCopyData(stream, &format) as Data?) else { return nil }
        if format != .raw {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
            return CGImageSourceCreateImageAtIndex(source, 0, nil)
        }
        var decodeArray: CGPDFArrayRef?
        var inverted = false
        if CGPDFDictionaryGetArray(dictionary, "Decode", &decodeArray), let decodeArray {
            var first: CGPDFReal = 0
            CGPDFArrayGetNumber(decodeArray, 0, &first)
            inverted = first == 1
        }
        if stencil != 0 || isMask {
            bits = stencil != 0 ? 1 : bits
        }
        var space: CGColorSpace
        var components: Int
        if stencil != 0 || isMask {
            (space, components) = (CGColorSpaceCreateDeviceGray(), 1)
        } else {
            var object: CGPDFObjectRef?
            CGPDFDictionaryGetObject(dictionary, "ColorSpace", &object)
            guard let resolved = colorSpace(object) else { return nil }
            (space, components) = resolved
            if space.model == .indexed { components = 1 }
        }
        let bitsPerPixel = Int(bits) * components
        let rowBytes = (Int(width) * bitsPerPixel + 7) / 8
        guard data.count >= rowBytes * Int(height), [1, 2, 4, 8, 16].contains(Int(bits)) else { return nil }
        guard let provider = CGDataProvider(data: data as CFData) else { return nil }
        var decode: [CGFloat]? = nil
        if inverted || stencil != 0 {
            // A stencil mask paints where samples are 0: show painted pixels black on white.
            decode = stencil != 0 ? (inverted ? [0, 1] : [1, 0]).map(CGFloat.init) : Array(repeating: [1, 0], count: components).flatMap { $0 }.map(CGFloat.init)
            if stencil != 0 { decode = inverted ? [1, 0] : [0, 1] }
        }
        let byteOrder: CGBitmapInfo = bits == 16 ? .byteOrder16Big : []
        return CGImage(width: Int(width), height: Int(height), bitsPerComponent: Int(bits), bitsPerPixel: bitsPerPixel, bytesPerRow: rowBytes,
                       space: space, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue).union(byteOrder),
                       provider: provider, decode: decode, shouldInterpolate: false, intent: .defaultIntent)
    }

    /// Combines a colour image with a gray soft mask into RGBA.
    private static func applyAlpha(_ image: CGImage, _ mask: CGImage) -> CGImage? {
        let width = image.width, height = image.height
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let maskContext = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
                                          space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        let rect = CGRect(x: 0, y: 0, width: width, height: height)
        context.draw(image, in: rect)
        maskContext.draw(mask, in: rect)
        guard let pixels = context.data?.bindMemory(to: UInt8.self, capacity: width * height * 4),
              let alpha = maskContext.data?.bindMemory(to: UInt8.self, capacity: width * height) else { return nil }
        for index in 0..<(width * height) {
            let a = UInt16(alpha[index])
            pixels[index * 4] = UInt8(UInt16(pixels[index * 4]) * a / 255)
            pixels[index * 4 + 1] = UInt8(UInt16(pixels[index * 4 + 1]) * a / 255)
            pixels[index * 4 + 2] = UInt8(UInt16(pixels[index * 4 + 2]) * a / 255)
            pixels[index * 4 + 3] = UInt8(a)
        }
        return context.makeImage()
    }
}
