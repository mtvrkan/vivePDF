import CoreGraphics
import CoreText
import Foundation
import ImageIO

/// Renders SVG markup (imported drawings, tables, charts, flowcharts, formulas) with Core Graphics:
/// svg/g/a/switch/use/symbol/defs, path/rect/circle/ellipse/line/polyline/polygon, text/tspan,
/// data-URI images, transforms, viewBox + preserveAspectRatio, fill/stroke paint and opacities,
/// dashes, caps/joins, fill-rule, style attributes, `<style>` rules, gradients and clip paths.
enum StudioSVGRenderer {
    /// Natural size of the drawing (width/height or viewBox), if known.
    static func intrinsicSize(_ markup: String) -> CGSize? {
        guard let doc = document(markup) else { return nil }
        let root = doc.root
        let view = viewBox(root.attributes["viewBox"])
        let w = root.attributes["width"].flatMap { length($0, relative: view?.width ?? 0, font: 16) }
        let h = root.attributes["height"].flatMap { length($0, relative: view?.height ?? 0, font: 16) }
        if let w, let h, w > 0, h > 0 { return CGSize(width: w, height: h) }
        if let view, view.width > 0, view.height > 0 {
            if let w, w > 0 { return CGSize(width: w, height: w * view.height / view.width) }
            if let h, h > 0 { return CGSize(width: h * view.width / view.height, height: h) }
            return view.size
        }
        return nil
    }

    /// Draws `markup` stretched into `rect` (the element box, like the desktop `drawing_pdf` placement).
    static func draw(_ markup: String, in rect: CGRect, context: CGContext) {
        guard let doc = document(markup), rect.width > 0, rect.height > 0 else { return }
        let renderer = Renderer(doc: doc, context: context)
        context.saveGState()
        let root = doc.root
        let view = viewBox(root.attributes["viewBox"])
        let aspect = root.attributes["preserveAspectRatio"] ?? "xMidYMid meet"
        context.translateBy(x: rect.minX, y: rect.minY)
        if let natural = intrinsicSize(markup), natural.width > 0, natural.height > 0 {
            // Like the desktop: the drawing becomes a page of its own size, stretched onto the box.
            context.scaleBy(x: rect.width / natural.width, y: rect.height / natural.height)
            if let view {
                context.concatenate(viewBoxTransform(view, into: CGRect(origin: .zero, size: natural), aspect: aspect))
                renderer.viewport = view.size
            } else {
                renderer.viewport = natural
            }
        } else {
            renderer.viewport = rect.size
        }
        renderer.render(children: root.children, style: Style.initial)
        context.restoreGState()
    }

    // MARK: - Document model

    final class Node {
        let name: String
        var attributes: [String: String]
        var children: [Node] = []
        var text = ""
        weak var parent: Node?
        init(name: String, attributes: [String: String]) { self.name = name; self.attributes = attributes }
    }

    final class Document {
        let root: Node
        var ids: [String: Node] = [:]
        var rules: [(selector: String, declarations: [String: String])] = []
        init(root: Node) { self.root = root }
    }

    private final class Parser: NSObject, XMLParserDelegate {
        var stack: [Node] = []
        var root: Node?
        var styleText = ""

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
            let name = elementName.split(separator: ":").last.map(String.init) ?? elementName
            let node = Node(name: name, attributes: attributeDict)
            if let parent = stack.last { node.parent = parent; parent.children.append(node) } else { root = node }
            stack.append(node)
        }

        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
            if let node = stack.popLast(), node.name == "style" { styleText += node.text + "\n" }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            guard let node = stack.last else { return }
            if node.name == "text" || node.name == "tspan" || node.name == "textPath" {
                // Keep text order relative to tspans with an anonymous text child.
                let piece = Node(name: "#text", attributes: [:])
                piece.text = string
                piece.parent = node
                node.children.append(piece)
            } else {
                node.text += string
            }
        }

        func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
            if let s = String(data: CDATABlock, encoding: .utf8) { stack.last?.text += s }
        }
    }

    private static let cache = NSCache<NSString, DocumentBox>()
    private final class DocumentBox { let doc: Document; init(_ d: Document) { doc = d } }

    static func document(_ markup: String) -> Document? {
        let key = markup as NSString
        if let hit = cache.object(forKey: key) { return hit.doc }
        guard let data = markup.data(using: .utf8) else { return nil }
        let delegate = Parser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.shouldResolveExternalEntities = false
        parser.parse()
        guard let root = delegate.root, root.name == "svg" else { return nil }
        let doc = Document(root: root)
        func index(_ n: Node) {
            if let id = n.attributes["id"] { doc.ids[id] = n }
            n.children.forEach(index)
        }
        index(root)
        doc.rules = parseCSS(delegate.styleText)
        cache.setObject(DocumentBox(doc), forKey: key)
        return doc
    }

    // MARK: - CSS

    static func parseDeclarations(_ text: String) -> [String: String] {
        var out: [String: String] = [:]
        for part in text.split(separator: ";") {
            guard let colon = part.firstIndex(of: ":") else { continue }
            let key = part[..<colon].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            var value = part[part.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            if value.hasSuffix("!important") { value = value.replacingOccurrences(of: "!important", with: "").trimmingCharacters(in: .whitespaces) }
            if !key.isEmpty { out[key] = value }
        }
        return out
    }

    static func parseCSS(_ text: String) -> [(selector: String, declarations: [String: String])] {
        let cleaned = text.replacingOccurrences(of: "/\\*[\\s\\S]*?\\*/", with: "", options: .regularExpression)
        var rules: [(String, [String: String])] = []
        var rest = Substring(cleaned)
        while let open = rest.firstIndex(of: "{"), let close = rest[open...].firstIndex(of: "}") {
            let selectors = rest[..<open].trimmingCharacters(in: .whitespacesAndNewlines)
            let body = parseDeclarations(String(rest[rest.index(after: open)..<close]))
            if !selectors.hasPrefix("@") {
                for selector in selectors.split(separator: ",") { rules.append((selector.trimmingCharacters(in: .whitespacesAndNewlines), body)) }
            }
            rest = rest[rest.index(after: close)...]
        }
        return rules
    }

    static func matches(_ selector: String, _ node: Node) -> Bool {
        // Simple selectors only: tag, .class, #id, tag.class, *, and a trailing compound of a descendant chain.
        let compound = selector.split(separator: " ").last.map(String.init) ?? selector
        if compound == "*" { return true }
        var tag = "", rest = Substring(compound)
        while let first = rest.first, first != "." && first != "#" { tag.append(first); rest = rest.dropFirst() }
        if !tag.isEmpty && tag != node.name { return false }
        let classes = Set((node.attributes["class"] ?? "").split(whereSeparator: \.isWhitespace).map(String.init))
        var token = ""
        var kind: Character = " "
        func check() -> Bool {
            if token.isEmpty { return true }
            if kind == "." { return classes.contains(token) }
            if kind == "#" { return node.attributes["id"] == token }
            return true
        }
        for ch in rest {
            if ch == "." || ch == "#" {
                if !check() { return false }
                kind = ch; token = ""
            } else { token.append(ch) }
        }
        return check() && (!tag.isEmpty || !rest.isEmpty)
    }

    // MARK: - Style

    struct Style {
        var fill: String = "black"
        var stroke: String = "none"
        var strokeWidth: String = "1"
        var fillOpacity = 1.0
        var strokeOpacity = 1.0
        var fillRule = "nonzero"
        var lineCap = "butt"
        var lineJoin = "miter"
        var miterLimit = 4.0
        var dashArray = "none"
        var dashOffset = "0"
        var fontSize = 16.0
        var fontFamily = "sans-serif"
        var fontWeight = "normal"
        var fontStyle = "normal"
        var textAnchor = "start"
        var color = "#000000"
        var visible = true
        var clipRule = "nonzero"
        static let initial = Style()
    }

    static let inherited: Set<String> = ["fill", "stroke", "stroke-width", "fill-opacity", "stroke-opacity", "fill-rule", "stroke-linecap", "stroke-linejoin",
                                         "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "font-size", "font-family", "font-weight", "font-style",
                                         "text-anchor", "color", "visibility", "clip-rule", "font"]

    // MARK: - Geometry helpers

    static func viewBox(_ value: String?) -> CGRect? {
        guard let value else { return nil }
        let nums = numbers(value)
        guard nums.count == 4, nums[2] > 0, nums[3] > 0 else { return nil }
        return CGRect(x: nums[0], y: nums[1], width: nums[2], height: nums[3])
    }

    static func viewBoxTransform(_ view: CGRect, into rect: CGRect, aspect: String) -> CGAffineTransform {
        let parts = aspect.split(separator: " ").map(String.init)
        let align = parts.first ?? "xMidYMid"
        var sx = rect.width / view.width, sy = rect.height / view.height
        if align != "none" {
            let slice = parts.count > 1 && parts[1] == "slice"
            let s = slice ? max(sx, sy) : min(sx, sy)
            sx = s; sy = s
        }
        var tx = rect.minX - view.minX * sx, ty = rect.minY - view.minY * sy
        if align != "none" {
            let extraX = rect.width - view.width * sx, extraY = rect.height - view.height * sy
            if align.contains("xMid") { tx += extraX / 2 } else if align.contains("xMax") { tx += extraX }
            if align.contains("YMid") { ty += extraY / 2 } else if align.contains("YMax") { ty += extraY }
        }
        return CGAffineTransform(a: sx, b: 0, c: 0, d: sy, tx: tx, ty: ty)
    }

    static func numbers(_ text: String) -> [Double] {
        var out: [Double] = []
        let scalars = Array(text.utf8)
        var i = 0
        while i < scalars.count {
            let c = scalars[i]
            if (48...57).contains(c) || c == 45 || c == 43 || c == 46 {
                var j = i + 1
                var seenDot = c == 46, seenExp = false
                while j < scalars.count {
                    let d = scalars[j]
                    if (48...57).contains(d) { j += 1; continue }
                    if d == 46 && !seenDot && !seenExp { seenDot = true; j += 1; continue }
                    if (d == 101 || d == 69) && !seenExp { seenExp = true; j += 1; if j < scalars.count, scalars[j] == 45 || scalars[j] == 43 { j += 1 }; continue }
                    break
                }
                if let v = Double(String(decoding: scalars[i..<j], as: UTF8.self)) { out.append(v) }
                i = j
            } else { i += 1 }
        }
        return out
    }

    static func length(_ raw: String, relative: Double, font: Double) -> Double? {
        let s = raw.trimmingCharacters(in: .whitespaces)
        guard let v = numbers(s).first else { return nil }
        if s.hasSuffix("%") { return v / 100 * relative }
        if s.hasSuffix("pt") { return v * 4 / 3 }
        if s.hasSuffix("pc") { return v * 16 }
        if s.hasSuffix("mm") { return v * 96 / 25.4 }
        if s.hasSuffix("cm") { return v * 96 / 2.54 }
        if s.hasSuffix("in") { return v * 96 }
        if s.hasSuffix("em") { return v * font }
        if s.hasSuffix("ex") { return v * font / 2 }
        return v
    }

    static func transform(_ text: String?) -> CGAffineTransform {
        guard let text, !text.isEmpty else { return .identity }
        var result = CGAffineTransform.identity
        let pattern = try? NSRegularExpression(pattern: "(matrix|translate|scale|rotate|skewX|skewY)\\s*\\(([^)]*)\\)")
        let ns = text as NSString
        for m in pattern?.matches(in: text, range: NSRange(location: 0, length: ns.length)) ?? [] {
            let name = ns.substring(with: m.range(at: 1))
            let v = numbers(ns.substring(with: m.range(at: 2)))
            var t = CGAffineTransform.identity
            switch name {
            case "matrix" where v.count >= 6: t = CGAffineTransform(a: v[0], b: v[1], c: v[2], d: v[3], tx: v[4], ty: v[5])
            case "translate": t = CGAffineTransform(translationX: v.first ?? 0, y: v.count > 1 ? v[1] : 0)
            case "scale": t = CGAffineTransform(scaleX: v.first ?? 1, y: v.count > 1 ? v[1] : (v.first ?? 1))
            case "rotate":
                let a = (v.first ?? 0) * .pi / 180
                if v.count >= 3 { t = CGAffineTransform(translationX: v[1], y: v[2]).rotated(by: a).translatedBy(x: -v[1], y: -v[2]) } else { t = CGAffineTransform(rotationAngle: a) }
            case "skewX": t = CGAffineTransform(a: 1, b: 0, c: tan((v.first ?? 0) * .pi / 180), d: 1, tx: 0, ty: 0)
            case "skewY": t = CGAffineTransform(a: 1, b: tan((v.first ?? 0) * .pi / 180), c: 0, d: 1, tx: 0, ty: 0)
            default: break
            }
            result = t.concatenating(result)
        }
        return result
    }

    // MARK: - Colours

    static func colour(_ raw: String, current: String) -> (CGColor, Double)? {
        let value = raw.trimmingCharacters(in: .whitespaces)
        let lower = value.lowercased()
        if lower == "none" || lower == "transparent" { return nil }
        if lower == "currentcolor" { return colour(current, current: "#000000") }
        if lower.hasPrefix("hsl") {
            let n = numbers(value)
            guard n.count >= 3 else { return nil }
            let alpha = n.count > 3 ? (value.contains("%") && n[3] > 1 ? n[3] / 100 : n[3]) : 1
            let c = StudioSVGColorsHSL.rgb(n[0], n[1] / 100, n[2] / 100)
            return (CGColor(srgbRed: c.0, green: c.1, blue: c.2, alpha: 1), alpha)
        }
        guard let parsed = StudioSVGColors.parse(value) else { return nil }
        var alpha = 1.0
        if let a = parsed.alpha {
            if parsed.format == .hex { alpha = Double(Int(a, radix: 16) ?? 255) / 255 } else { alpha = a.hasSuffix("%") ? (Double(a.dropLast()) ?? 100) / 100 : (Double(a) ?? 1) }
        }
        let (r, g, b) = StudioColor.components(parsed.key)
        return (CGColor(srgbRed: r, green: g, blue: b, alpha: 1), alpha)
    }

    // MARK: - Renderer

    final class Renderer {
        let doc: Document
        let context: CGContext
        var viewport = CGSize(width: 100, height: 100)
        private var useDepth = 0

        init(doc: Document, context: CGContext) { self.doc = doc; self.context = context }

        /// Merged property map for a node: presentation attributes < CSS rules < inline style.
        func properties(_ node: Node) -> [String: String] {
            var props: [String: String] = [:]
            for (k, v) in node.attributes { props[k] = v }
            for rule in doc.rules where StudioSVGRenderer.matches(rule.selector, node) { for (k, v) in rule.declarations { props[k] = v } }
            if let style = node.attributes["style"] { for (k, v) in parseDeclarations(style) { props[k] = v } }
            return props
        }

        func resolve(_ props: [String: String], parent: Style) -> Style {
            var s = parent
            func value(_ key: String) -> String? {
                guard let v = props[key]?.trimmingCharacters(in: .whitespaces), !v.isEmpty, v != "inherit" else { return nil }
                return v
            }
            if let v = value("color") { s.color = v.lowercased() == "currentcolor" ? parent.color : v }
            if let v = value("font-size") { s.fontSize = length(v, relative: parent.fontSize, font: parent.fontSize) ?? parent.fontSize }
            if let v = value("fill") { s.fill = v }
            if let v = value("stroke") { s.stroke = v }
            if let v = value("stroke-width") { s.strokeWidth = v }
            if let v = value("fill-opacity") { s.fillOpacity = opacityValue(v) }
            if let v = value("stroke-opacity") { s.strokeOpacity = opacityValue(v) }
            if let v = value("fill-rule") { s.fillRule = v }
            if let v = value("clip-rule") { s.clipRule = v }
            if let v = value("stroke-linecap") { s.lineCap = v }
            if let v = value("stroke-linejoin") { s.lineJoin = v }
            if let v = value("stroke-miterlimit"), let n = Double(v) { s.miterLimit = n }
            if let v = value("stroke-dasharray") { s.dashArray = v }
            if let v = value("stroke-dashoffset") { s.dashOffset = v }
            if let v = value("font-family") { s.fontFamily = v }
            if let v = value("font-weight") { s.fontWeight = v }
            if let v = value("font-style") { s.fontStyle = v }
            if let v = value("text-anchor") { s.textAnchor = v }
            if let v = value("visibility") { s.visible = v != "hidden" && v != "collapse" }
            return s
        }

        func opacityValue(_ v: String) -> Double {
            let n = numbers(v).first ?? 1
            return max(0, min(1, v.hasSuffix("%") ? n / 100 : n))
        }

        func number(_ props: [String: String], _ key: String, _ relative: Double, _ style: Style, _ fallback: Double = 0) -> Double {
            props[key].flatMap { length($0, relative: relative, font: style.fontSize) } ?? fallback
        }

        func render(children: [Node], style: Style) {
            for child in children { render(child, style: style) }
        }

        func render(_ node: Node, style parentStyle: Style) {
            switch node.name {
            case "defs", "symbol", "clipPath", "mask", "linearGradient", "radialGradient", "pattern", "marker", "style", "title", "desc", "metadata", "script", "filter", "#text":
                return
            default: break
            }
            let props = properties(node)
            if props["display"] == "none" { return }
            let style = resolve(props, parent: parentStyle)
            let opacity = props["opacity"].map(opacityValue) ?? 1
            guard opacity > 0 else { return }
            context.saveGState()
            defer { context.restoreGState() }
            context.concatenate(transform(props["transform"]))
            if let clip = props["clip-path"], let id = reference(clip), let clipNode = doc.ids[id] { applyClip(clipNode, for: node, style: style) }
            let layered = opacity < 1
            if layered { context.setAlpha(opacity); context.beginTransparencyLayer(auxiliaryInfo: nil) }
            defer { if layered { context.endTransparencyLayer() } }
            switch node.name {
            case "svg":
                let x = number(props, "x", viewport.width, style), y = number(props, "y", viewport.height, style)
                let w = number(props, "width", viewport.width, style, viewport.width), h = number(props, "height", viewport.height, style, viewport.height)
                let saved = viewport
                if let view = viewBox(props["viewBox"]) {
                    context.concatenate(viewBoxTransform(view, into: CGRect(x: x, y: y, width: w, height: h), aspect: props["preserveAspectRatio"] ?? "xMidYMid meet"))
                    viewport = view.size
                } else {
                    context.translateBy(x: x, y: y)
                    viewport = CGSize(width: w, height: h)
                }
                render(children: node.children, style: style)
                viewport = saved
            case "g", "a":
                render(children: node.children, style: style)
            case "switch":
                if let first = node.children.first(where: { $0.name != "#text" }) { render(first, style: style) }
            case "use":
                guard useDepth < 16, let href = props["href"] ?? props["xlink:href"], href.hasPrefix("#"), let target = doc.ids[String(href.dropFirst())] else { return }
                context.translateBy(x: number(props, "x", viewport.width, style), y: number(props, "y", viewport.height, style))
                useDepth += 1
                defer { useDepth -= 1 }
                if target.name == "symbol" {
                    let symbolProps = properties(target)
                    let symbolStyle = resolve(symbolProps, parent: style)
                    if let view = viewBox(symbolProps["viewBox"]) {
                        let w = number(props, "width", viewport.width, style, view.width), h = number(props, "height", viewport.height, style, view.height)
                        context.concatenate(viewBoxTransform(view, into: CGRect(x: 0, y: 0, width: w, height: h), aspect: symbolProps["preserveAspectRatio"] ?? "xMidYMid meet"))
                    }
                    render(children: target.children, style: symbolStyle)
                } else {
                    render(target, style: style)
                }
            case "text":
                drawText(node, props: props, style: style)
            case "image":
                drawImage(props, style: style)
            default:
                if let path = shapePath(node.name, props, style) { paint(path, style: style, element: node) }
            }
        }

        func reference(_ value: String) -> String? {
            guard let open = value.range(of: "url("), let close = value.range(of: ")", range: open.upperBound..<value.endIndex) else { return nil }
            var id = value[open.upperBound..<close.lowerBound].trimmingCharacters(in: CharacterSet(charactersIn: " '\""))
            if id.hasPrefix("#") { id.removeFirst() }
            return id
        }

        func shapePath(_ name: String, _ p: [String: String], _ s: Style) -> CGPath? {
            let vw = viewport.width, vh = viewport.height, diag = sqrt(vw * vw + vh * vh) / sqrt(2)
            switch name {
            case "path":
                guard let d = p["d"], !d.isEmpty else { return nil }
                return StudioPath.cgPath(d)
            case "rect":
                let x = number(p, "x", vw, s), y = number(p, "y", vh, s), w = number(p, "width", vw, s), h = number(p, "height", vh, s)
                guard w > 0, h > 0 else { return nil }
                var rx = p["rx"].flatMap { length($0, relative: vw, font: s.fontSize) }
                var ry = p["ry"].flatMap { length($0, relative: vh, font: s.fontSize) }
                if rx == nil { rx = ry }
                if ry == nil { ry = rx }
                let crx = min(max(0, rx ?? 0), w / 2), cry = min(max(0, ry ?? 0), h / 2)
                let rect = CGRect(x: x, y: y, width: w, height: h)
                return crx > 0 && cry > 0 ? CGPath(roundedRect: rect, cornerWidth: crx, cornerHeight: cry, transform: nil) : CGPath(rect: rect, transform: nil)
            case "circle":
                let r = number(p, "r", diag, s)
                guard r > 0 else { return nil }
                let cx = number(p, "cx", vw, s), cy = number(p, "cy", vh, s)
                return CGPath(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r), transform: nil)
            case "ellipse":
                let rx = number(p, "rx", vw, s), ry = number(p, "ry", vh, s)
                guard rx > 0, ry > 0 else { return nil }
                let cx = number(p, "cx", vw, s), cy = number(p, "cy", vh, s)
                return CGPath(ellipseIn: CGRect(x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry), transform: nil)
            case "line":
                let path = CGMutablePath()
                path.move(to: CGPoint(x: number(p, "x1", vw, s), y: number(p, "y1", vh, s)))
                path.addLine(to: CGPoint(x: number(p, "x2", vw, s), y: number(p, "y2", vh, s)))
                return path
            case "polyline", "polygon":
                let n = numbers(p["points"] ?? "")
                guard n.count >= 4 else { return nil }
                let path = CGMutablePath()
                path.addLines(between: stride(from: 0, to: n.count - 1, by: 2).map { CGPoint(x: n[$0], y: n[$0 + 1]) })
                if name == "polygon" { path.closeSubpath() }
                return path
            default:
                return nil
            }
        }

        // MARK: Paint

        func paint(_ path: CGPath, style: Style, element: Node) {
            guard style.visible else { return }
            let box = path.boundingBoxOfPath
            if let fill = paintFor(style.fill, style: style) {
                context.saveGState()
                context.addPath(path)
                let evenOdd = style.fillRule == "evenodd"
                switch fill {
                case .color(let c, let a):
                    context.setFillColor(c.copy(alpha: a * style.fillOpacity) ?? c)
                    context.fillPath(using: evenOdd ? .evenOdd : .winding)
                case .gradient(let node):
                    context.clip(using: evenOdd ? .evenOdd : .winding)
                    drawGradient(node, box: box, opacity: style.fillOpacity)
                }
                context.restoreGState()
            }
            let width = length(style.strokeWidth, relative: sqrt((viewport.width * viewport.width + viewport.height * viewport.height) / 2), font: style.fontSize) ?? 1
            if width > 0, let stroke = paintFor(style.stroke, style: style) {
                context.saveGState()
                context.setLineWidth(width)
                context.setLineCap(style.lineCap == "round" ? .round : style.lineCap == "square" ? .square : .butt)
                context.setLineJoin(style.lineJoin == "round" ? .round : style.lineJoin == "bevel" ? .bevel : .miter)
                context.setMiterLimit(style.miterLimit)
                let dashes = style.dashArray == "none" ? [] : numbers(style.dashArray).map { max(0, $0) }
                if !dashes.isEmpty, dashes.contains(where: { $0 > 0 }) {
                    let pattern = dashes.count % 2 == 1 ? dashes + dashes : dashes
                    context.setLineDash(phase: numbers(style.dashOffset).first ?? 0, lengths: pattern.map { CGFloat($0) })
                }
                context.addPath(path)
                switch stroke {
                case .color(let c, let a):
                    context.setStrokeColor(c.copy(alpha: a * style.strokeOpacity) ?? c)
                    context.strokePath()
                case .gradient(let node):
                    context.replacePathWithStrokedPath()
                    context.clip()
                    drawGradient(node, box: box, opacity: style.strokeOpacity)
                }
                context.restoreGState()
            }
        }

        enum Paint { case color(CGColor, Double), gradient(Node) }

        func paintFor(_ value: String, style: Style) -> Paint? {
            let trimmed = value.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("url(") {
                if let id = reference(trimmed), let node = doc.ids[id], node.name.hasSuffix("Gradient") { return .gradient(node) }
                let fallback = trimmed[trimmed.index(after: trimmed.firstIndex(of: ")")!)...].trimmingCharacters(in: .whitespaces)
                return fallback.isEmpty ? nil : paintFor(fallback, style: style)
            }
            guard let (c, a) = colour(trimmed, current: style.color) else { return nil }
            return .color(c, a)
        }

        /// Gradient attributes with `href` inheritance.
        func gradientAttribute(_ node: Node, _ key: String, depth: Int = 0) -> String? {
            if let v = node.attributes[key] { return v }
            guard depth < 8, let href = node.attributes["href"] ?? node.attributes["xlink:href"], href.hasPrefix("#"), let base = doc.ids[String(href.dropFirst())] else { return nil }
            return gradientAttribute(base, key, depth: depth + 1)
        }

        func gradientStops(_ node: Node, depth: Int = 0) -> [Node] {
            let stops = node.children.filter { $0.name == "stop" }
            if !stops.isEmpty || depth >= 8 { return stops }
            guard let href = node.attributes["href"] ?? node.attributes["xlink:href"], href.hasPrefix("#"), let base = doc.ids[String(href.dropFirst())] else { return [] }
            return gradientStops(base, depth: depth + 1)
        }

        func drawGradient(_ node: Node, box: CGRect, opacity: Double) {
            var colors: [CGColor] = []
            var locations: [CGFloat] = []
            var last = 0.0
            for stop in gradientStops(node) {
                let props = properties(stop)
                var offset = props["offset"].map { $0.hasSuffix("%") ? (numbers($0).first ?? 0) / 100 : (numbers($0).first ?? 0) } ?? 0
                offset = max(last, min(1, max(0, offset)))
                last = offset
                let (c, a) = colour(props["stop-color"] ?? "black", current: "#000000") ?? (CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1), 0)
                let stopOpacity = props["stop-opacity"].map(opacityValue) ?? 1
                colors.append(c.copy(alpha: a * stopOpacity * opacity) ?? c)
                locations.append(offset)
            }
            guard !colors.isEmpty else { return }
            if colors.count == 1 { colors.append(colors[0]); locations = [0, 1] }
            guard let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors as CFArray, locations: locations) else { return }
            let userSpace = gradientAttribute(node, "gradientUnits") == "userSpaceOnUse"
            context.saveGState()
            if !userSpace {
                guard box.width > 0 || box.height > 0 else { context.restoreGState(); return }
                context.concatenate(CGAffineTransform(a: max(box.width, 0.0001), b: 0, c: 0, d: max(box.height, 0.0001), tx: box.minX, ty: box.minY))
            }
            context.concatenate(transform(gradientAttribute(node, "gradientTransform")))
            func value(_ key: String, _ fallback: Double, _ relative: Double) -> Double {
                guard let raw = gradientAttribute(node, key) else { return fallback }
                if raw.hasSuffix("%") { return (numbers(raw).first ?? 0) / 100 * (userSpace ? relative : 1) }
                return numbers(raw).first ?? fallback
            }
            let options: CGGradientDrawingOptions = [.drawsBeforeStartLocation, .drawsAfterEndLocation]
            if node.name == "linearGradient" {
                let w = viewport.width, h = viewport.height
                let start = CGPoint(x: value("x1", 0, w), y: value("y1", 0, h))
                let end = CGPoint(x: value("x2", userSpace ? w : 1, w), y: value("y2", 0, h))
                context.drawLinearGradient(gradient, start: start, end: end, options: options)
            } else {
                let w = viewport.width, h = viewport.height
                let cx = value("cx", userSpace ? w / 2 : 0.5, w), cy = value("cy", userSpace ? h / 2 : 0.5, h)
                let r = value("r", userSpace ? sqrt(w * w + h * h) / sqrt(2) / 2 : 0.5, sqrt(w * w + h * h) / sqrt(2))
                let fx = value("fx", cx, w), fy = value("fy", cy, h)
                context.drawRadialGradient(gradient, startCenter: CGPoint(x: fx, y: fy), startRadius: 0, endCenter: CGPoint(x: cx, y: cy), endRadius: r, options: options)
            }
            context.restoreGState()
        }

        // MARK: Clip

        func applyClip(_ clip: Node, for element: Node, style: Style) {
            let combined = CGMutablePath()
            let objectBox = clip.attributes["clipPathUnits"] == "objectBoundingBox"
            var bounds = CGRect.zero
            if objectBox, let own = shapePath(element.name, properties(element), style) { bounds = own.boundingBoxOfPath }
            var rule = "nonzero"
            func collect(_ node: Node, _ t: CGAffineTransform) {
                let props = properties(node)
                let local = transform(props["transform"]).concatenating(t)
                if let r = props["clip-rule"] { rule = r }
                if node.name == "use", let href = props["href"] ?? props["xlink:href"], href.hasPrefix("#"), let target = doc.ids[String(href.dropFirst())] {
                    collect(target, CGAffineTransform(translationX: number(props, "x", viewport.width, style), y: number(props, "y", viewport.height, style)).concatenating(local))
                    return
                }
                if let path = shapePath(node.name, props, style) {
                    var transform = local
                    if let copy = path.copy(using: &transform) { combined.addPath(copy) }
                }
                for child in node.children { collect(child, local) }
            }
            var base = transform(clip.attributes["transform"])
            if objectBox { base = base.concatenating(CGAffineTransform(a: bounds.width, b: 0, c: 0, d: bounds.height, tx: bounds.minX, ty: bounds.minY)) }
            for child in clip.children { collect(child, base) }
            if combined.isEmpty { context.clip(to: .zero); return }
            context.addPath(combined)
            context.clip(using: rule == "evenodd" ? .evenOdd : .winding)
        }

        // MARK: Text

        func font(_ style: Style) -> CTFont {
            let bold = style.fontWeight == "bold" || style.fontWeight == "bolder" || (Int(style.fontWeight) ?? 400) >= 600
            let italic = style.fontStyle == "italic" || style.fontStyle == "oblique"
            let families = style.fontFamily.split(separator: ",").map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " '\"")) }
            for family in families {
                let key = StudioFonts.familyKey(family)
                if ["serif", "sansserif", "monospace", "cursive", "fantasy", "systemui"].contains(key) {
                    let name = key == "serif" ? "Times New Roman" : key == "monospace" ? "Courier" : "Helvetica"
                    return traitFont(CTFontCreateWithName(name as CFString, style.fontSize, nil), bold: bold, italic: italic)
                }
                let face = StudioFonts.shared.face("system:\(key)", weight: bold ? 700 : 400, italic: italic)
                if let name = CTFontCopyFamilyName(face.font) as String?, StudioFonts.familyKey(name) == key { return face.font(size: style.fontSize) }
            }
            return StudioFonts.shared.face(nil, weight: bold ? 700 : 400, italic: italic).font(size: style.fontSize)
        }

        func traitFont(_ font: CTFont, bold: Bool, italic: Bool) -> CTFont {
            var traits: CTFontSymbolicTraits = []
            if bold { traits.insert(.traitBold) }
            if italic { traits.insert(.traitItalic) }
            guard !traits.isEmpty else { return font }
            return CTFontCreateCopyWithSymbolicTraits(font, 0, nil, traits, traits) ?? font
        }

        func drawText(_ node: Node, props: [String: String], style: Style) {
            var cursor = CGPoint(x: numbers(props["x"] ?? "0").first ?? 0, y: numbers(props["y"] ?? "0").first ?? 0)
            cursor.x += numbers(props["dx"] ?? "").first ?? 0
            cursor.y += numbers(props["dy"] ?? "").first ?? 0
            layoutText(node, style: style, cursor: &cursor)
        }

        func layoutText(_ node: Node, style: Style, cursor: inout CGPoint) {
            for child in node.children {
                if child.name == "#text" {
                    let collapsed = child.text.replacingOccurrences(of: "[\\s]+", with: " ", options: .regularExpression)
                    guard !collapsed.trimmingCharacters(in: .whitespaces).isEmpty || collapsed == " " else { continue }
                    drawRun(collapsed, style: style, at: &cursor)
                } else if child.name == "tspan" || child.name == "a" || child.name == "textPath" {
                    let props = properties(child)
                    let s = resolve(props, parent: style)
                    if let x = props["x"], let v = numbers(x).first { cursor.x = v }
                    if let y = props["y"], let v = numbers(y).first { cursor.y = v }
                    cursor.x += numbers(props["dx"] ?? "").first ?? 0
                    cursor.y += numbers(props["dy"] ?? "").first ?? 0
                    layoutText(child, style: s, cursor: &cursor)
                }
            }
        }

        func drawRun(_ text: String, style: Style, at cursor: inout CGPoint) {
            let ctFont = font(style)
            var attributes: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): ctFont]
            let fill = paintFor(style.fill, style: style)
            if case .color(let c, let a)? = fill { attributes[NSAttributedString.Key(kCTForegroundColorAttributeName as String)] = c.copy(alpha: a * style.fillOpacity) ?? c }
            let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
            let width = CTLineGetTypographicBounds(line, nil, nil, nil)
            var x = cursor.x
            if style.textAnchor == "middle" { x -= width / 2 } else if style.textAnchor == "end" { x -= width }
            if style.visible, fill != nil {
                context.saveGState()
                context.translateBy(x: x, y: cursor.y)
                context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
                context.textPosition = .zero
                CTLineDraw(line, context)
                context.restoreGState()
            }
            cursor.x = x + width
        }

        // MARK: Image

        func drawImage(_ props: [String: String], style: Style) {
            guard let href = props["href"] ?? props["xlink:href"], href.hasPrefix("data:"), let comma = href.firstIndex(of: ",") else { return }
            let header = href[..<comma]
            let payload = String(href[href.index(after: comma)...])
            let data: Data? = header.contains(";base64") ? Data(base64Encoded: payload, options: .ignoreUnknownCharacters) : payload.removingPercentEncoding?.data(using: .utf8)
            guard let data else { return }
            let w = number(props, "width", viewport.width, style), h = number(props, "height", viewport.height, style)
            let x = number(props, "x", viewport.width, style), y = number(props, "y", viewport.height, style)
            if header.contains("svg"), let markup = String(data: data, encoding: .utf8) {
                StudioSVGRenderer.draw(markup, in: CGRect(x: x, y: y, width: w, height: h), context: context)
                return
            }
            guard let source = CGImageSourceCreateWithData(data as CFData, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return }
            let natural = CGRect(x: 0, y: 0, width: Double(image.width), height: Double(image.height))
            let box = CGRect(x: x, y: y, width: w > 0 ? w : natural.width, height: h > 0 ? h : natural.height)
            context.saveGState()
            context.clip(to: box)
            context.concatenate(viewBoxTransform(natural, into: box, aspect: props["preserveAspectRatio"] ?? "xMidYMid meet"))
            context.translateBy(x: 0, y: natural.height)
            context.scaleBy(x: 1, y: -1)
            context.draw(image, in: natural)
            context.restoreGState()
        }
    }
}

enum StudioSVGColorsHSL {
    static func rgb(_ h: Double, _ s: Double, _ l: Double) -> (Double, Double, Double) {
        let c = (1 - abs(2 * l - 1)) * s
        let hp = (h.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 60
        let x = c * (1 - abs(hp.truncatingRemainder(dividingBy: 2) - 1))
        let (r, g, b): (Double, Double, Double) = switch hp {
        case 0..<1: (c, x, 0)
        case 1..<2: (x, c, 0)
        case 2..<3: (0, c, x)
        case 3..<4: (0, x, c)
        case 4..<5: (x, 0, c)
        default: (c, 0, x)
        }
        let m = l - c / 2
        return (r + m, g + m, b + m)
    }
}
