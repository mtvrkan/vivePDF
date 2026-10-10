import Foundation

/// Port of `model/svgColors.ts`: finds and remaps colours inside imported SVG markup through the
/// element's `colorMap`, preserving each colour's original notation and alpha.
enum StudioSVGColors {
    private static let namedTable =
        "aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd," +
        "blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed," +
        "cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9," +
        "darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f," +
        "darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff," +
        "dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc," +
        "ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c," +
        "indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080," +
        "lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a," +
        "lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00," +
        "limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db," +
        "mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970," +
        "mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500," +
        "orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9," +
        "peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1," +
        "saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd," +
        "slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0," +
        "violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32"

    static let named: [String: String] = Dictionary(uniqueKeysWithValues: namedTable.split(separator: ",").map { pair in
        let parts = pair.split(separator: ":")
        return (String(parts[0]), "#" + parts[1])
    })

    enum Format { case hex, rgb, named, current }
    struct Parsed { var key: String; var alpha: String?; var format: Format }

    private static let property = "(?:fill|stroke|stop-color|flood-color|lighting-color|color)"
    private static let attribute = try! NSRegularExpression(pattern: "(\\s\(property)\\s*=\\s*)([\"'])([^\"'<>]*)\\2", options: [.caseInsensitive])
    private static let styleAttribute = try! NSRegularExpression(pattern: "(\\sstyle\\s*=\\s*)([\"'])([^\"'<>]*)\\2", options: [.caseInsensitive])
    private static let styleElement = try! NSRegularExpression(pattern: "(<style\\b[^>]*>)([\\s\\S]*?)(</style\\s*>)", options: [.caseInsensitive])
    private static let declaration = try! NSRegularExpression(pattern: "((?:^|[\\s;{])\(property)\\s*:\\s*)([^;{}\"'<>!]+)", options: [.caseInsensitive])
    private static let token = try! NSRegularExpression(pattern: "url\\([^)]*\\)|#[0-9a-f]+\\b|rgba?\\([^)]*\\)|[a-z][a-z-]*", options: [.caseInsensitive])
    private static let colorDeclared = try! NSRegularExpression(pattern: "\\scolor\\s*=|(?:^|[\\s;{\"'])color\\s*:", options: [.caseInsensitive])
    private static let colorValue = try! NSRegularExpression(pattern: "\\scolor\\s*=\\s*([\"'])([^\"'<>]*)\\1|(?:^|[\\s;{\"'])color\\s*:\\s*([^;{}\"'<>!]+)", options: [.caseInsensitive])

    private static func hexByte(_ v: Double) -> String { String(format: "%02x", Int(min(255, max(0, v)).rounded())) }

    private static func channel(_ part: String) -> Double? {
        let trimmed = part.trimmingCharacters(in: .whitespaces)
        guard let v = Double(trimmed.replacingOccurrences(of: "%", with: "")) else { return nil }
        return trimmed.hasSuffix("%") ? v / 100 * 255 : v
    }

    static func parse(_ token: String) -> Parsed? {
        if token.hasPrefix("#") {
            let digits = token.dropFirst().lowercased()
            guard digits.allSatisfy(\.isHexDigit) else { return nil }
            if digits.count == 3 || digits.count == 4 {
                let full = digits.map { "\($0)\($0)" }.joined()
                return Parsed(key: "#" + full.prefix(6), alpha: digits.count == 4 ? String(full.suffix(2)) : nil, format: .hex)
            }
            if digits.count == 6 || digits.count == 8 {
                return Parsed(key: "#" + digits.prefix(6), alpha: digits.count == 8 ? String(digits.suffix(2)) : nil, format: .hex)
            }
            return nil
        }
        let lower = token.lowercased()
        if lower.hasPrefix("rgb") {
            guard let open = token.firstIndex(of: "("), token.hasSuffix(")") else { return nil }
            let inner = token[token.index(after: open)..<token.index(before: token.endIndex)].trimmingCharacters(in: .whitespaces)
            let parts = inner.split(whereSeparator: { $0 == " " || $0 == "," || $0 == "/" }).map(String.init)
            guard (3...4).contains(parts.count) else { return nil }
            let rgb = parts.prefix(3).map(channel)
            guard rgb.allSatisfy({ $0 != nil }) else { return nil }
            return Parsed(key: "#" + rgb.map { hexByte($0!) }.joined(), alpha: parts.count == 4 ? parts[3] : nil, format: .rgb)
        }
        return named[lower].map { Parsed(key: $0, alpha: nil, format: .named) }
    }

    private static func format(_ hex: String, _ original: Parsed) -> String {
        guard let alpha = original.alpha else { return hex }
        if original.format == .hex { return hex + alpha }
        let c = StudioColor.rgb255(hex)
        return "rgba(\(c.0), \(c.1), \(c.2), \(alpha))"
    }

    private static func replace(_ regex: NSRegularExpression, in text: String, _ transform: ([String]) -> String) -> String {
        let ns = text as NSString
        var result = ""
        var last = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            let groups = (0..<match.numberOfRanges).map { i -> String in
                let r = match.range(at: i)
                return r.location == NSNotFound ? "" : ns.substring(with: r)
            }
            result += transform(groups)
            last = match.range.location + match.range.length
        }
        return result + ns.substring(from: last)
    }

    private static func documentColor(_ svg: String) -> String {
        let ns = svg as NSString
        guard let m = colorValue.firstMatch(in: svg, range: NSRange(location: 0, length: ns.length)) else { return "#000000" }
        let r2 = m.range(at: 2), r3 = m.range(at: 3)
        let value = r2.location != NSNotFound ? ns.substring(with: r2) : r3.location != NSNotFound ? ns.substring(with: r3) : ""
        let vns = value as NSString
        for t in token.matches(in: value, range: NSRange(location: 0, length: vns.length)) {
            if let parsed = parse(vns.substring(with: t.range)) { return parsed.key }
        }
        return "#000000"
    }

    private static func rewriteValue(_ value: String, _ visit: (Parsed) -> String?, _ current: String?) -> String {
        replace(token, in: value) { groups in
            let tok = groups[0]
            let lower = tok.lowercased()
            let parsed: Parsed?
            if lower.hasPrefix("url(") { parsed = nil } else if lower == "currentcolor" { parsed = current.map { Parsed(key: $0, alpha: nil, format: .current) } } else { parsed = parse(tok) }
            guard let parsed else { return tok }
            return visit(parsed) ?? tok
        }
    }

    private static func rewriteDeclarations(_ text: String, _ visit: (Parsed) -> String?, _ current: String?) -> String {
        replace(declaration, in: text) { $0[1] + rewriteValue($0[2], visit, current) }
    }

    private static func hasCurrentColor(_ svg: String) -> Bool { svg.range(of: "currentcolor", options: .caseInsensitive) != nil }

    static func rewrite(_ svg: String, _ visit: (Parsed) -> String?) -> String {
        let current = hasCurrentColor(svg) ? documentColor(svg) : nil
        var out = replace(styleElement, in: svg) { $0[1] + rewriteDeclarations($0[2], visit, current) + $0[3] }
        out = replace(attribute, in: out) { $0[1] + $0[2] + rewriteValue($0[3], visit, current) + $0[2] }
        out = replace(styleAttribute, in: out) { $0[1] + $0[2] + rewriteDeclarations($0[3], visit, current) + $0[2] }
        return out
    }

    private static let cache = NSCache<NSString, NSArray>()

    static func colors(_ svg: String) -> [String] {
        if let hit = cache.object(forKey: svg as NSString) as? [String] { return hit }
        var found: [String] = []
        _ = rewrite(svg) { color in
            if !found.contains(color.key) { found.append(color.key) }
            return nil
        }
        cache.setObject(found as NSArray, forKey: svg as NSString)
        return found
    }

    /// Markup with the colour map applied (and `currentColor` resolved when the document sets `color`).
    static func recolored(_ svg: String, _ map: [String: String]?) -> String {
        let mapped = !(map ?? [:]).isEmpty
        let ns = svg as NSString
        let resolveCurrent = hasCurrentColor(svg) && colorDeclared.firstMatch(in: svg, range: NSRange(location: 0, length: ns.length)) != nil
        guard mapped || resolveCurrent else { return svg }
        return rewrite(svg) { color in
            if let target = map?[color.key], target != color.key { return format(target, color) }
            return color.format == .current ? color.key : nil
        }
    }

    static func effective(_ element: StudioSVG) -> [String] {
        if let graphic = StudioGraphics.colors(of: element) { return graphic }
        var seen: [String] = []
        for c in colors(element.svg).map({ element.colorMap?[$0] ?? $0 }) where !seen.contains(c) { seen.append(c) }
        return seen
    }

    static func swap(_ element: StudioSVG, _ swap: (String) -> String) -> StudioSVG {
        if let graphic = StudioGraphics.swapColors(element, swap) { return graphic }
        var next = element.colorMap ?? [:]
        var changed = false
        for original in colors(element.svg) {
            let current = element.colorMap?[original] ?? original
            let target = swap(current).lowercased()
            guard target != current, StudioJSON.isColour(target) else { continue }
            changed = true
            if target == original { next.removeValue(forKey: original) } else { next[original] = target }
        }
        guard changed else { return element }
        var result = element
        result.colorMap = next.isEmpty ? nil : next
        return result
    }
}

/// Hex colour helpers.
enum StudioColor {
    static func rgb255(_ hex: String) -> (Int, Int, Int) {
        let chars = Array(hex.utf8)
        func byte(_ i: Int) -> Int {
            guard chars.count >= i + 2 else { return 0 }
            return Int(String(decoding: chars[i..<(i + 2)], as: UTF8.self), radix: 16) ?? 0
        }
        return (byte(1), byte(3), byte(5))
    }

    static func components(_ hex: String) -> (Double, Double, Double) {
        let c = rgb255(hex)
        return (Double(c.0) / 255, Double(c.1) / 255, Double(c.2) / 255)
    }

    static func hex(_ r: Double, _ g: Double, _ b: Double) -> String {
        func byte(_ v: Double) -> String { String(format: "%02x", Int((min(1, max(0, v)) * 255).rounded())) }
        return "#" + byte(r) + byte(g) + byte(b)
    }

    /// Relative luminance (WCAG).
    static func luminance(_ hex: String) -> Double {
        let (r, g, b) = components(hex)
        func lin(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }

    static func contrast(_ a: String, _ b: String) -> Double {
        let la = luminance(a), lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }
}
