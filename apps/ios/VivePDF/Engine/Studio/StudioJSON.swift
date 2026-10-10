import Foundation

// Reading (with the desktop's `normalize*` clamping) and writing of the desktop design JSON.

enum StudioJSON {
    typealias Object = [String: Any]

    // MARK: Helpers mirroring design.ts

    static func finite(_ value: Any?, _ fallback: Double, _ lo: Double = -100000, _ hi: Double = 100000) -> Double {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return fallback }
        let d = n.doubleValue
        return d.isFinite ? min(hi, max(lo, d)) : fallback
    }

    static func isNumber(_ value: Any?) -> Bool {
        guard let n = value as? NSNumber else { return false }
        return CFGetTypeID(n) != CFBooleanGetTypeID() && n.doubleValue.isFinite
    }

    static func text(_ value: Any?, _ fallback: String = "", limit: Int = 20000) -> String {
        guard let s = value as? String else { return fallback }
        return s.count > limit ? String(s.prefix(limit)) : s
    }

    static func isColour(_ value: String) -> Bool {
        let chars = Array(value.utf8)
        guard chars.count == 7, chars[0] == UInt8(ascii: "#") else { return false }
        return chars.dropFirst().allSatisfy { (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0) }
    }

    static func colour(_ value: Any?, _ fallback: String) -> String {
        if let s = value as? String, isColour(s) { return s.lowercased() }
        return fallback
    }

    static func oneOf<T: RawRepresentable>(_ value: Any?, _ fallback: T) -> T where T.RawValue == String {
        (value as? String).flatMap(T.init(rawValue:)) ?? fallback
    }

    static func record(_ value: Any?) -> Object? { value as? Object }

    static func bool(_ value: Any?) -> Bool? {
        guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
        return n.boolValue
    }

    // MARK: Fill / stroke

    static func stops(_ value: Any?) -> [StudioGradientStop] {
        let list = (value as? [Any] ?? []).compactMap(record).prefix(StudioLimits.maxGradientStops)
            .map { StudioGradientStop(offset: finite($0["offset"], 0, 0, 1), color: colour($0["color"], "#000000")) }
        return list.isEmpty ? [StudioGradientStop(offset: 0, color: "#000000"), StudioGradientStop(offset: 1, color: "#ffffff")] : Array(list)
    }

    static func fill(_ value: Any?) -> StudioFill {
        guard let f = record(value) else { return .none }
        switch f["type"] as? String {
        case "solid": return .solid(colour(f["color"], "#000000"))
        case "linear": return .linear(angle: finite(f["angle"], 0, -3600, 3600), stops: stops(f["stops"]))
        case "radial":
            return .radial(
                stops: stops(f["stops"]),
                cx: isNumber(f["cx"]) ? finite(f["cx"], 0.5, 0, 1) : nil,
                cy: isNumber(f["cy"]) ? finite(f["cy"], 0.5, 0, 1) : nil,
                radius: isNumber(f["radius"]) ? finite(f["radius"], 1, StudioLimits.minRadialRadius, StudioLimits.maxRadialRadius) : nil
            )
        default: return .none
        }
    }

    static func stroke(_ value: Any?) -> StudioStroke? {
        guard let s = record(value) else { return nil }
        var result = StudioStroke(color: colour(s["color"], "#000000"), width: finite(s["width"], 1, 0.1, 500), dash: oneOf(s["dash"], StudioDash.solid))
        result.cap = (s["cap"] as? String).flatMap(StudioLineCap.init(rawValue:))
        result.join = (s["join"] as? String).flatMap(StudioLineJoin.init(rawValue:))
        if isNumber(s["gap"]) { result.gap = finite(s["gap"], 1, StudioLimits.minDashGap, StudioLimits.maxDashGap) }
        return result
    }

    static func dropShadow(_ value: Any?) -> StudioDropShadow? {
        guard let s = record(value) else { return nil }
        let d = StudioDropShadow.standard
        return StudioDropShadow(
            color: colour(s["color"], d.color),
            opacity: finite(s["opacity"], d.opacity, 0, 1),
            x: finite(s["x"], d.x, -StudioLimits.maxShadowOffset, StudioLimits.maxShadowOffset),
            y: finite(s["y"], d.y, -StudioLimits.maxShadowOffset, StudioLimits.maxShadowOffset),
            blur: finite(s["blur"], d.blur, 0, StudioLimits.maxShadowBlur)
        )
    }

    static func weight(_ value: Any?) -> Int? {
        guard isNumber(value) else { return nil }
        return Int(finite(value, 400, Double(StudioLimits.minWeight), Double(StudioLimits.maxWeight)).rounded())
    }

    static func runs(_ value: Any?) -> [StudioTextRun] {
        let list = (value as? [Any] ?? []).compactMap(record).prefix(2000).map { run -> StudioTextRun in
            var r = StudioTextRun(text: text(run["text"]))
            r.bold = bool(run["bold"])
            r.italic = bool(run["italic"])
            r.underline = bool(run["underline"])
            r.strike = bool(run["strike"])
            if let c = run["color"] as? String, isColour(c) { r.color = c.lowercased() }
            if let f = run["fontId"] as? String, !f.isEmpty { r.fontId = String(f.prefix(1024)) }
            if isNumber(run["scale"]), let s = run["scale"] as? NSNumber, s.doubleValue != 1 {
                r.scale = finite(s, 1, StudioLimits.minRunScale, StudioLimits.maxRunScale)
            }
            if run["weight"] is NSNull { r.weight = .some(nil) } else if isNumber(run["weight"]) { r.weight = .some(weight(run["weight"])) }
            return r
        }
        return list.isEmpty ? [StudioTextRun(text: "")] : Array(list)
    }

    static func paragraphs(_ value: Any?, runs: [StudioTextRun]) -> [StudioParagraph] {
        let list = (value as? [Any] ?? []).prefix(20000).map { item -> StudioParagraph in
            let p = record(item)
            return StudioParagraph(list: oneOf(p?["list"], StudioListKind.none), level: Int(finite(p?["level"], 0, 0, Double(StudioLimits.maxListLevel)).rounded()))
        }
        return StudioTypography.fitParagraphs(Array(list), count: StudioTypography.paragraphCount(runs))
    }

    static func filters(_ value: Any?) -> StudioImageFilters? {
        guard let raw = record(value) else { return nil }
        func clamp(_ key: String, _ lo: Double, _ hi: Double, _ neutral: Double) -> Double { finite(raw[key], neutral, lo, hi) }
        let f = StudioImageFilters(
            brightness: clamp("brightness", 0, 2, 1), contrast: clamp("contrast", 0, 2, 1), saturation: clamp("saturation", 0, 2, 1),
            warmth: clamp("warmth", -1, 1, 0), sepia: clamp("sepia", 0, 1, 0), grayscale: clamp("grayscale", 0, 1, 0)
        )
        return f.isNeutral ? nil : f
    }

    static func paths(_ value: Any?) -> [StudioVectorPath] {
        (value as? [Any] ?? []).compactMap(record).filter { ($0["d"] as? String)?.isEmpty == false }.prefix(5000).map {
            StudioVectorPath(d: text($0["d"], limit: 400000), fill: fill($0["fill"]), stroke: stroke($0["stroke"]), evenOdd: bool($0["evenOdd"]) == true, opacity: finite($0["opacity"], 1, 0, 1))
        }
    }

    // MARK: Element

    static func element(_ value: Any?) -> StudioElement? {
        guard let raw = record(value) else { return nil }
        let id = text(raw["id"], limit: 100)
        var e = StudioElement(
            id: id.isEmpty ? StudioFactory.newId() : id,
            name: text(raw["name"], limit: 200),
            x: finite(raw["x"], 0),
            y: finite(raw["y"], 0),
            width: finite(raw["width"], 100, StudioLimits.minElementSide, 20000),
            height: finite(raw["height"], 100, StudioLimits.minElementSide, 20000),
            rotation: finite(raw["rotation"], 0, -3600, 3600),
            opacity: finite(raw["opacity"], 1, 0, 1),
            locked: bool(raw["locked"]) == true,
            hidden: bool(raw["hidden"]) == true,
            groupId: (raw["groupId"] as? String).flatMap { $0.isEmpty ? nil : String($0.prefix(100)) },
            flipX: bool(raw["flipX"]) == true,
            flipY: bool(raw["flipY"]) == true,
            lockRatio: bool(raw["lockRatio"]),
            content: .text(StudioText())
        )
        switch raw["kind"] as? String {
        case "text":
            let r = runs(raw["runs"])
            var t = StudioText()
            t.runs = r
            t.fontId = (raw["fontId"] as? String).flatMap { $0.isEmpty ? nil : String($0.prefix(1024)) }
            t.fontSize = finite(raw["fontSize"], 24, 1, 1000)
            t.color = colour(raw["color"], "#000000")
            t.bold = bool(raw["bold"]) == true
            t.italic = bool(raw["italic"]) == true
            t.underline = bool(raw["underline"]) == true
            t.strike = bool(raw["strike"]) == true
            t.weight = weight(raw["weight"])
            t.align = oneOf(raw["align"], StudioTextAlign.left)
            t.verticalAlign = oneOf(raw["verticalAlign"], StudioVerticalAlign.top)
            t.lineHeight = finite(raw["lineHeight"], 1.25, 0.5, 5)
            t.letterSpacing = finite(raw["letterSpacing"], 0, -0.5, 2)
            t.textCase = oneOf(raw["textCase"], bool(raw["uppercase"]) == true ? StudioTextCase.upper : .none)
            t.autoSize = oneOf(raw["autoSize"], bool(raw["shrinkToFit"]) == true ? StudioAutoSize.shrink : .fixed)
            t.paragraphs = paragraphs(raw["paragraphs"], runs: r)
            if let o = record(raw["outline"]) { t.outline = StudioTextOutline(color: colour(o["color"], "#000000"), width: finite(o["width"], 1, 0.1, 50)) }
            if let s = record(raw["shadow"]) {
                t.shadow = StudioTextShadow(color: colour(s["color"], "#000000"), x: finite(s["x"], 2, -500, 500), y: finite(s["y"], 2, -500, 500), opacity: finite(s["opacity"], 0.5, 0, 1))
            }
            if let h = record(raw["highlight"]) { t.highlight = StudioTextHighlight(color: colour(h["color"], "#fde047"), padding: finite(h["padding"], 2, 0, 200)) }
            if let lang = raw["language"] as? String, lang.count <= 20, lang.range(of: "^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$", options: .regularExpression) != nil { t.language = lang }
            e.content = .text(t)
        case "shape":
            let kind: StudioShapeKind = oneOf(raw["shape"], StudioShapeKind.rect)
            var s = StudioShape(shape: kind)
            s.fill = fill(raw["fill"])
            s.stroke = stroke(raw["stroke"])
            s.cornerRadius = finite(raw["cornerRadius"], 0, 0, StudioLimits.maxCornerRadius)
            if let c = raw["corners"] as? [Any], c.count == 4 { s.corners = c.map { finite($0, 0, 0, StudioLimits.maxCornerRadius) } }
            s.points = Int(finite(raw["points"], 5, 3, 64).rounded())
            s.innerRatio = finite(raw["innerRatio"], 0.45, 0.05, 0.95)
            s.startArrow = oneOf(raw["startArrow"], StudioArrowhead.none)
            s.endArrow = oneOf(raw["endArrow"], kind == .arrowLine ? StudioArrowhead.triangle : .none)
            s.arrowSize = finite(raw["arrowSize"], 1, StudioLimits.minArrowSize, StudioLimits.maxArrowSize)
            s.dropShadow = dropShadow(raw["dropShadow"])
            e.content = .shape(s)
        case "image":
            guard let src = raw["src"] as? String else { return nil }
            var i = StudioImage(src: String(src.prefix(4096)))
            i.fit = oneOf(raw["fit"], StudioImageFit.cover)
            let c = record(raw["crop"])
            let cx = finite(c?["x"], 0, 0, 0.99), cy = finite(c?["y"], 0, 0, 0.99)
            i.crop = StudioCrop(x: cx, y: cy, width: finite(c?["width"], 1, 0.01, 1 - cx), height: finite(c?["height"], 1, 0.01, 1 - cy))
            i.mask = oneOf(raw["mask"], StudioImageMask.none)
            i.cornerRadius = finite(raw["cornerRadius"], 0, 0, StudioLimits.maxCornerRadius)
            i.stroke = stroke(raw["stroke"])
            i.dropShadow = dropShadow(raw["dropShadow"])
            i.filters = filters(raw["filters"])
            e.content = .image(i)
        case "qr":
            let value = text(raw["value"], limit: 2000)
            var q = StudioQR(value: value.isEmpty ? "vivePDF" : value)
            q.color = colour(raw["color"], "#000000")
            q.background = raw["background"] is NSNull ? nil : colour(raw["background"], "#ffffff")
            q.errorLevel = oneOf(raw["errorLevel"], StudioQRLevel.M)
            q.dropShadow = dropShadow(raw["dropShadow"])
            e.content = .qr(q)
        case "vector":
            let p = paths(raw["paths"])
            guard !p.isEmpty else { return nil }
            e.content = .vector(StudioVector(viewWidth: finite(raw["viewWidth"], e.width, 0.01, 100000), viewHeight: finite(raw["viewHeight"], e.height, 0.01, 100000), paths: p, dropShadow: dropShadow(raw["dropShadow"])))
        case "svg":
            guard let markup = raw["svg"] as? String, !markup.isEmpty else { return nil }
            var s = StudioSVG(svg: String(markup.prefix(4_000_000)), source: oneOf(raw["source"], StudioSvgSource.import), data: StudioJSONValue(raw["data"]), dropShadow: dropShadow(raw["dropShadow"]))
            if let map = record(raw["colorMap"]) {
                var clean: [String: String] = [:]
                for (from, to) in map.prefix(256) {
                    if isColour(from), let to = to as? String, isColour(to), from.lowercased() != to.lowercased() { clean[from.lowercased()] = to.lowercased() }
                }
                s.colorMap = clean.isEmpty ? nil : clean
            }
            e.content = .svg(s)
        default:
            return nil
        }
        return e
    }

    static func background(_ value: Any?) -> StudioBackground {
        guard let b = record(value) else { return .blank }
        var result = StudioBackground(fill: fill(b["fill"]))
        if let image = record(b["image"]), let src = image["src"] as? String, !src.isEmpty {
            result.image = StudioBackgroundImage(src: String(src.prefix(4096)), fit: oneOf(image["fit"], StudioImageFit.cover), opacity: finite(image["opacity"], 1, 0, 1))
        }
        return result
    }

    static func page(_ value: Any?) -> StudioPage? {
        guard let raw = record(value) else { return nil }
        var seen = Set<String>()
        var elements: [StudioElement] = []
        for item in (raw["elements"] as? [Any] ?? []).prefix(StudioLimits.maxElementsPerPage) {
            guard var e = element(item) else { continue }
            if seen.contains(e.id) { e.id = StudioFactory.newId() }
            seen.insert(e.id)
            elements.append(e)
        }
        let guides = (raw["guides"] as? [Any] ?? []).compactMap(record).compactMap { g -> StudioGuide? in
            guard let axis = (g["axis"] as? String).flatMap(StudioGuideAxis.init(rawValue:)), isNumber(g["position"]) else { return nil }
            return StudioGuide(axis: axis, position: finite(g["position"], 0, -StudioLimits.maxPageSide, StudioLimits.maxPageSide * 2))
        }.prefix(StudioLimits.maxGuidesPerPage)
        let id = text(raw["id"], limit: 100)
        return StudioPage(
            id: id.isEmpty ? StudioFactory.newId() : id,
            name: text(raw["name"], limit: StudioLimits.maxPageName).trimmingCharacters(in: .whitespacesAndNewlines),
            width: StudioFactory.clampSide(finite(raw["width"], StudioPageSize.a4.size.width)),
            height: StudioFactory.clampSide(finite(raw["height"], StudioPageSize.a4.size.height)),
            background: background(raw["background"]),
            elements: elements,
            guides: Array(guides)
        )
    }

    /// `normalizeDesign`: nil when the value is not a design this version understands.
    static func design(_ value: Any?) -> StudioDesign? {
        guard let raw = record(value), raw["kind"] as? String == "design", isNumber(raw["version"]),
              let version = raw["version"] as? NSNumber, version.intValue <= StudioLimits.designVersion else { return nil }
        let pages = (raw["pages"] as? [Any] ?? []).prefix(StudioLimits.maxPages).compactMap(page)
        guard !pages.isEmpty else { return nil }
        let palette = (raw["palette"] as? [Any] ?? []).compactMap { $0 as? String }.filter(isColour).prefix(StudioLimits.maxPalette)
        return StudioDesign(name: text(raw["name"], limit: 200), palette: Array(palette), pages: pages, margins: finite(raw["margins"], 0, 0, StudioLimits.maxMarginMM))
    }

    static func design(data: Data) -> StudioDesign? {
        design(try? JSONSerialization.jsonObject(with: data))
    }

    // MARK: Encoding

    static func encode(_ fill: StudioFill) -> Object {
        switch fill {
        case .none: return ["type": "none"]
        case .solid(let c): return ["type": "solid", "color": c]
        case .linear(let angle, let stops): return ["type": "linear", "angle": angle, "stops": stops.map(encode)]
        case .radial(let stops, let cx, let cy, let r):
            var o: Object = ["type": "radial", "stops": stops.map(encode)]
            if let cx { o["cx"] = cx }
            if let cy { o["cy"] = cy }
            if let r { o["radius"] = r }
            return o
        }
    }

    static func encode(_ stop: StudioGradientStop) -> Object { ["offset": stop.offset, "color": stop.color] }

    static func encode(_ stroke: StudioStroke?) -> Any {
        guard let stroke else { return NSNull() }
        var o: Object = ["color": stroke.color, "width": stroke.width, "dash": stroke.dash.rawValue]
        if let cap = stroke.cap { o["cap"] = cap.rawValue }
        if let join = stroke.join { o["join"] = join.rawValue }
        if let gap = stroke.gap { o["gap"] = gap }
        return o
    }

    static func encode(_ shadow: StudioDropShadow?) -> Any {
        guard let s = shadow else { return NSNull() }
        return ["color": s.color, "opacity": s.opacity, "x": s.x, "y": s.y, "blur": s.blur] as Object
    }

    static func encode(_ run: StudioTextRun) -> Object {
        var o: Object = ["text": run.text]
        if let v = run.bold { o["bold"] = v }
        if let v = run.italic { o["italic"] = v }
        if let v = run.underline { o["underline"] = v }
        if let v = run.strike { o["strike"] = v }
        if let v = run.color { o["color"] = v }
        if let v = run.fontId { o["fontId"] = v }
        if let v = run.scale { o["scale"] = v }
        if let w = run.weight { o["weight"] = w.map { $0 as Any } ?? NSNull() }
        return o
    }

    static func encode(_ element: StudioElement) -> Object {
        var o: Object = [
            "id": element.id, "name": element.name, "x": element.x, "y": element.y, "width": element.width, "height": element.height,
            "rotation": element.rotation, "opacity": element.opacity, "locked": element.locked, "hidden": element.hidden,
            "groupId": element.groupId.map { $0 as Any } ?? NSNull(), "kind": element.kind,
        ]
        if element.flipX { o["flipX"] = true }
        if element.flipY { o["flipY"] = true }
        if let lock = element.lockRatio { o["lockRatio"] = lock }
        switch element.content {
        case .text(let t):
            o["runs"] = t.runs.map(encode)
            o["fontId"] = t.fontId.map { $0 as Any } ?? NSNull()
            o["fontSize"] = t.fontSize
            o["color"] = t.color
            o["bold"] = t.bold
            o["italic"] = t.italic
            o["underline"] = t.underline
            o["strike"] = t.strike
            o["weight"] = t.weight.map { $0 as Any } ?? NSNull()
            o["align"] = t.align.rawValue
            o["verticalAlign"] = t.verticalAlign.rawValue
            o["lineHeight"] = t.lineHeight
            o["letterSpacing"] = t.letterSpacing
            o["textCase"] = t.textCase.rawValue
            o["autoSize"] = t.autoSize.rawValue
            o["paragraphs"] = t.paragraphs.map { ["list": $0.list.rawValue, "level": $0.level] as Object }
            o["outline"] = t.outline.map { ["color": $0.color, "width": $0.width] as Object as Any } ?? NSNull()
            o["shadow"] = t.shadow.map { ["color": $0.color, "x": $0.x, "y": $0.y, "opacity": $0.opacity] as Object as Any } ?? NSNull()
            o["highlight"] = t.highlight.map { ["color": $0.color, "padding": $0.padding] as Object as Any } ?? NSNull()
            o["language"] = t.language.map { $0 as Any } ?? NSNull()
        case .shape(let s):
            o["shape"] = s.shape.rawValue
            o["fill"] = encode(s.fill)
            o["stroke"] = encode(s.stroke)
            o["cornerRadius"] = s.cornerRadius
            o["corners"] = s.corners.map { $0 as Any } ?? NSNull()
            o["points"] = s.points
            o["innerRatio"] = s.innerRatio
            o["startArrow"] = s.startArrow.rawValue
            o["endArrow"] = s.endArrow.rawValue
            o["arrowSize"] = s.arrowSize
            o["dropShadow"] = encode(s.dropShadow)
        case .image(let i):
            o["src"] = i.src
            o["fit"] = i.fit.rawValue
            o["crop"] = ["x": i.crop.x, "y": i.crop.y, "width": i.crop.width, "height": i.crop.height] as Object
            o["mask"] = i.mask.rawValue
            o["cornerRadius"] = i.cornerRadius
            o["stroke"] = encode(i.stroke)
            o["dropShadow"] = encode(i.dropShadow)
            if let f = i.filters {
                o["filters"] = ["brightness": f.brightness, "contrast": f.contrast, "saturation": f.saturation, "warmth": f.warmth, "sepia": f.sepia, "grayscale": f.grayscale] as Object
            }
        case .qr(let q):
            o["value"] = q.value
            o["color"] = q.color
            o["background"] = q.background.map { $0 as Any } ?? NSNull()
            o["errorLevel"] = q.errorLevel.rawValue
            o["dropShadow"] = encode(q.dropShadow)
        case .vector(let v):
            o["viewWidth"] = v.viewWidth
            o["viewHeight"] = v.viewHeight
            o["paths"] = v.paths.map { ["d": $0.d, "fill": encode($0.fill), "stroke": encode($0.stroke), "evenOdd": $0.evenOdd, "opacity": $0.opacity] as Object }
            o["dropShadow"] = encode(v.dropShadow)
        case .svg(let s):
            o["svg"] = s.svg
            o["source"] = s.source.rawValue
            o["data"] = s.data.any
            o["dropShadow"] = encode(s.dropShadow)
            if let map = s.colorMap { o["colorMap"] = map }
        }
        return o
    }

    static func encode(_ page: StudioPage) -> Object {
        var background: Object = ["fill": encode(page.background.fill), "image": NSNull()]
        if let image = page.background.image { background["image"] = ["src": image.src, "fit": image.fit.rawValue, "opacity": image.opacity] as Object }
        return [
            "id": page.id, "name": page.name, "width": page.width, "height": page.height, "background": background,
            "elements": page.elements.map(encode),
            "guides": page.guides.map { ["axis": $0.axis.rawValue, "position": $0.position] as Object },
        ]
    }

    static func encode(_ design: StudioDesign) -> Object {
        ["version": design.version, "kind": "design", "name": design.name, "palette": design.palette, "pages": design.pages.map(encode), "margins": design.margins]
    }

    static func data(_ design: StudioDesign, pretty: Bool = false) throws -> Data {
        try JSONSerialization.data(withJSONObject: encode(design), options: pretty ? [.prettyPrinted, .sortedKeys] : [.withoutEscapingSlashes])
    }

    static func element(fromJSONString string: String) -> [StudioElement] {
        guard let data = string.data(using: .utf8), let any = try? JSONSerialization.jsonObject(with: data) else { return [] }
        if let list = any as? [Any] { return list.compactMap(element) }
        if let o = any as? Object, let list = o["elements"] as? [Any] { return list.compactMap(element) }
        return []
    }
}
