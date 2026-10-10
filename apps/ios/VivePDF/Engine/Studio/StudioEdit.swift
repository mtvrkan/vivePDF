import CoreGraphics
import Foundation

/// Pure editing operations on pages and designs (port of `model/edit.ts`, `layers.ts`, `pages.ts`,
/// `flip.ts`, `guides.ts`, `colors.ts`). Every function returns a new value; the store records history.
enum StudioEdit {
    enum AlignMode: String, CaseIterable { case left, centerX, right, top, middleY, bottom }
    enum AlignTarget: String { case selection, page }
    enum Axis: String { case horizontal, vertical }
    enum Reorder: String { case forward, backward, front, back }
    enum PageResizeMode: String { case keep, scale }

    // MARK: Bounds

    static func bounds(_ e: StudioElement) -> CGRect {
        let angle = e.rotation * .pi / 180
        let c = abs(cos(angle)), s = abs(sin(angle))
        let w = e.width * c + e.height * s
        let h = e.width * s + e.height * c
        return CGRect(x: e.x + e.width / 2 - w / 2, y: e.y + e.height / 2 - h / 2, width: w, height: h)
    }

    static func union(_ rects: [CGRect]) -> CGRect? {
        guard let first = rects.first else { return nil }
        return rects.dropFirst().reduce(first) { $0.union($1) }
    }

    static func selectionBounds(_ page: StudioPage, _ ids: [String]) -> CGRect? {
        let chosen = Set(ids)
        return union(page.elements.filter { chosen.contains($0.id) }.map(bounds))
    }

    static func expandToGroups(_ page: StudioPage, _ ids: [String]) -> [String] {
        let chosen = Set(ids)
        let groups = Set(page.elements.filter { chosen.contains($0.id) }.compactMap(\.groupId))
        return page.elements.filter { chosen.contains($0.id) || ($0.groupId.map(groups.contains) ?? false) }.map(\.id)
    }

    static func withoutGroup(of id: String, in page: StudioPage, from ids: [String]) -> [String] {
        let groupId = page.element(id)?.groupId
        let members = Set(groupId == nil ? [id] : page.elements.filter { $0.groupId == groupId }.map(\.id))
        return ids.filter { !members.contains($0) }
    }

    private static func units(_ page: StudioPage, _ ids: [String]) -> [[StudioElement]] {
        let chosen = Set(ids)
        var order: [String] = []
        var byKey: [String: [StudioElement]] = [:]
        for e in page.elements where chosen.contains(e.id) && !e.locked {
            let key = e.groupId ?? "#\(e.id)"
            if byKey[key] == nil { order.append(key) }
            byKey[key, default: []].append(e)
        }
        return order.compactMap { byKey[$0] }
    }

    static func distributableCount(_ page: StudioPage, _ ids: [String]) -> Int { units(page, ids).count }

    static func groupMapper() -> (String?) -> String? {
        var groups: [String: String] = [:]
        return { groupId in
            guard let groupId, !groupId.isEmpty else { return nil }
            if let known = groups[groupId] { return known }
            let fresh = StudioFactory.newId()
            groups[groupId] = fresh
            return fresh
        }
    }

    private static func shifted(_ page: StudioPage, _ offsets: [String: (Double, Double)]) -> StudioPage {
        guard !offsets.isEmpty else { return page }
        var next = page
        for i in next.elements.indices {
            if let o = offsets[next.elements[i].id], o.0 != 0 || o.1 != 0 {
                next.elements[i].x += o.0
                next.elements[i].y += o.1
            }
        }
        return next
    }

    // MARK: Elements

    static func update(_ page: StudioPage, _ id: String, _ change: (inout StudioElement) -> Void) -> StudioPage {
        var next = page
        if let i = next.index(of: id) { change(&next.elements[i]) }
        return next
    }

    static func add(_ page: StudioPage, _ elements: [StudioElement]) -> StudioPage {
        var next = page
        let room = max(0, StudioLimits.maxElementsPerPage - page.elements.count)
        next.elements += elements.prefix(room)
        return next
    }

    static func remove(_ page: StudioPage, _ ids: [String]) -> StudioPage {
        let chosen = Set(ids)
        var next = page
        next.elements.removeAll { chosen.contains($0.id) && !$0.locked }
        return next
    }

    static func move(_ page: StudioPage, _ ids: [String], dx: Double, dy: Double) -> StudioPage {
        var offsets: [String: (Double, Double)] = [:]
        for unit in units(page, ids) { for e in unit { offsets[e.id] = (dx, dy) } }
        return shifted(page, offsets)
    }

    private static func completeGroups(_ page: StudioPage, _ chosen: Set<String>) -> Set<String> {
        var total: [String: Int] = [:], picked: [String: Int] = [:]
        for e in page.elements {
            guard let g = e.groupId else { continue }
            total[g, default: 0] += 1
            if chosen.contains(e.id) { picked[g, default: 0] += 1 }
        }
        return Set(picked.filter { $0.value > 1 && $0.value == total[$0.key] }.map(\.key))
    }

    static func duplicate(_ page: StudioPage, _ ids: [String], offset: Double) -> (page: StudioPage, ids: [String]) {
        let chosen = Set(ids)
        let regroup = groupMapper()
        let whole = completeGroups(page, chosen)
        let copies = page.elements.filter { chosen.contains($0.id) }.map { e -> StudioElement in
            var copy = e
            copy.id = StudioFactory.newId()
            copy.x += offset
            copy.y += offset
            copy.locked = false
            copy.groupId = e.groupId.flatMap { whole.contains($0) ? regroup($0) : nil }
            return copy
        }
        let next = add(page, copies)
        let added = Set(next.elements.map(\.id))
        return (next, copies.map(\.id).filter { added.contains($0) })
    }

    /// Copies elements into a page with fresh ids (paste), keeping whole groups grouped.
    static func pasteCopies(_ elements: [StudioElement], offset: Double) -> [StudioElement] {
        let source = StudioPage(id: "clipboard", width: 1, height: 1, elements: elements)
        let result = duplicate(source, elements.map(\.id), offset: offset)
        return Array(result.page.elements.suffix(result.ids.count))
    }

    static func align(_ page: StudioPage, _ ids: [String], _ mode: AlignMode, _ target: AlignTarget) -> StudioPage {
        let groups = units(page, ids)
        let frame: CGRect? = target == .page || groups.count < 2 ? CGRect(x: 0, y: 0, width: page.width, height: page.height) : union(groups.flatMap { $0.map(bounds) })
        guard let frame else { return page }
        var offsets: [String: (Double, Double)] = [:]
        for unit in groups {
            guard let box = union(unit.map(bounds)) else { continue }
            var dx = 0.0, dy = 0.0
            switch mode {
            case .left: dx = frame.minX - box.minX
            case .centerX: dx = frame.midX - box.midX
            case .right: dx = frame.maxX - box.maxX
            case .top: dy = frame.minY - box.minY
            case .middleY: dy = frame.midY - box.midY
            case .bottom: dy = frame.maxY - box.maxY
            }
            for e in unit { offsets[e.id] = (dx, dy) }
        }
        return shifted(page, offsets)
    }

    static func distribute(_ page: StudioPage, _ ids: [String], _ axis: Axis) -> StudioPage {
        var boxes = units(page, ids).compactMap { unit in union(unit.map(bounds)).map { (unit, $0) } }
        guard boxes.count >= 3 else { return page }
        func start(_ b: CGRect) -> Double { axis == .horizontal ? b.minX : b.minY }
        func size(_ b: CGRect) -> Double { axis == .horizontal ? b.width : b.height }
        boxes.sort { start($0.1) + size($0.1) / 2 < start($1.1) + size($1.1) / 2 }
        let first = start(boxes[0].1)
        let last = boxes[boxes.count - 1].1
        let span = start(last) + size(last) - first
        let gap = (span - boxes.reduce(0) { $0 + size($1.1) }) / Double(boxes.count - 1)
        var offsets: [String: (Double, Double)] = [:]
        var cursor = first
        for (unit, box) in boxes {
            let delta = cursor - start(box)
            for e in unit { offsets[e.id] = axis == .horizontal ? (delta, 0) : (0, delta) }
            cursor += size(box) + gap
        }
        return shifted(page, offsets)
    }

    // MARK: Layers

    struct LayerRun { var groupId: String?; var elements: [StudioElement] }

    static func layerRuns(_ elements: [StudioElement]) -> [LayerRun] {
        var runs: [LayerRun] = []
        for e in elements {
            if let last = runs.last, let g = e.groupId, last.groupId == g { runs[runs.count - 1].elements.append(e) } else { runs.append(LayerRun(groupId: e.groupId, elements: [e])) }
        }
        return runs
    }

    private static func shiftChosen<T>(_ items: [T], _ chosen: (T) -> Bool, _ direction: Reorder) -> [T] {
        let picked = items.filter(chosen), others = items.filter { !chosen($0) }
        if picked.isEmpty || others.isEmpty { return items }
        switch direction {
        case .front: return others + picked
        case .back: return picked + others
        case .forward:
            var order = items
            var i = order.count - 2
            while i >= 0 {
                if chosen(order[i]) && !chosen(order[i + 1]) { order.swapAt(i, i + 1) }
                i -= 1
            }
            return order
        case .backward:
            var order = items
            for i in 1..<max(1, order.count) where chosen(order[i]) && !chosen(order[i - 1]) { order.swapAt(i, i - 1) }
            return order
        }
    }

    static func reorder(_ page: StudioPage, _ ids: [String], _ direction: Reorder) -> StudioPage {
        let chosen = Set(ids)
        let isChosen: (StudioElement) -> Bool = { chosen.contains($0.id) }
        let whole: (LayerRun) -> Bool = { $0.elements.allSatisfy(isChosen) }
        let runs = layerRuns(page.elements).map { run -> LayerRun in
            if !whole(run) && run.elements.contains(where: isChosen) { var r = run; r.elements = shiftChosen(run.elements, isChosen, direction); return r }
            return run
        }
        var next = page
        next.elements = shiftChosen(runs, whole, direction).flatMap(\.elements)
        return next
    }

    private static func nearestRunEdge(_ elements: [StudioElement], _ at: Int) -> Int {
        let groupId = at > 0 && at < elements.count ? elements[at].groupId : nil
        guard let groupId, elements[at - 1].groupId == groupId else { return at }
        var start = at
        while start > 0 && elements[start - 1].groupId == groupId { start -= 1 }
        var end = at
        while end < elements.count && elements[end].groupId == groupId { end += 1 }
        return at - start <= end - at ? start : end
    }

    /// Moves `ids` so they land at `index` in the original stacking order (layers drag & drop).
    static func place(_ page: StudioPage, _ ids: [String], at index: Int) -> StudioPage {
        let chosen = Set(ids)
        let moving = page.elements.filter { chosen.contains($0.id) }
        guard !moving.isEmpty else { return page }
        let rest = page.elements.filter { !chosen.contains($0.id) }
        let passed = page.elements.prefix(max(0, index)).filter { chosen.contains($0.id) }.count
        var at = max(0, min(rest.count, index - passed))
        let groupId = moving[0].groupId
        let inside = groupId != nil && moving.allSatisfy { $0.groupId == groupId } && rest.contains { $0.groupId == groupId }
        if inside, let first = rest.firstIndex(where: { $0.groupId == groupId }), let last = rest.lastIndex(where: { $0.groupId == groupId }) {
            at = max(first, min(last + 1, at))
        } else {
            at = nearestRunEdge(rest, at)
        }
        var next = page
        next.elements = Array(rest[..<at]) + moving + Array(rest[at...])
        return next
    }

    static func group(_ page: StudioPage, _ ids: [String]) -> (page: StudioPage, groupId: String?) {
        let chosen = Set(expandToGroups(page, ids))
        guard chosen.count >= 2, let top = page.elements.lastIndex(where: { chosen.contains($0.id) }) else { return (page, nil) }
        let groupId = StudioFactory.newId()
        let members = page.elements.filter { chosen.contains($0.id) }.map { e -> StudioElement in var m = e; m.groupId = groupId; return m }
        let below = page.elements.prefix(top + 1).filter { !chosen.contains($0.id) }
        var next = page
        next.elements = below + members + Array(page.elements[(top + 1)...])
        return (next, groupId)
    }

    static func ungroup(_ page: StudioPage, _ ids: [String]) -> StudioPage {
        let chosen = Set(ids)
        let groups = Set(page.elements.filter { chosen.contains($0.id) }.compactMap(\.groupId))
        guard !groups.isEmpty else { return page }
        var next = page
        for i in next.elements.indices where next.elements[i].groupId.map(groups.contains) == true { next.elements[i].groupId = nil }
        return next
    }

    // MARK: Flip

    static func flip(_ page: StudioPage, _ ids: [String], _ axis: Axis) -> StudioPage {
        let chosen = Set(ids)
        let targets = page.elements.filter { chosen.contains($0.id) && !$0.locked }
        guard !targets.isEmpty else { return page }
        let box = union(targets.map(bounds)) ?? .zero
        let single = targets.count == 1
        var next = page
        for i in next.elements.indices where chosen.contains(next.elements[i].id) && !next.elements[i].locked {
            var e = next.elements[i]
            if axis == .horizontal { e.flipX.toggle() } else { e.flipY.toggle() }
            if !single {
                let cx = e.x + e.width / 2, cy = e.y + e.height / 2
                let nx = axis == .horizontal ? 2 * box.midX - cx : cx
                let ny = axis == .vertical ? 2 * box.midY - cy : cy
                e.x = nx - e.width / 2
                e.y = ny - e.height / 2
                e.rotation = e.rotation != 0 ? -e.rotation : 0
            }
            next.elements[i] = e
        }
        return next
    }

    // MARK: Pages

    static func updatePage(_ design: StudioDesign, _ pageId: String, _ change: (StudioPage) -> StudioPage) -> StudioDesign {
        var next = design
        if let i = next.pages.firstIndex(where: { $0.id == pageId }) { next.pages[i] = change(next.pages[i]) }
        return next
    }

    static func addPage(_ design: StudioDesign, after id: String?) -> (design: StudioDesign, pageId: String?) {
        guard design.pages.count < StudioLimits.maxPages else { return (design, nil) }
        let index = id.flatMap { pid in design.pages.firstIndex { $0.id == pid } } ?? design.pages.count - 1
        let template = design.pages[max(0, index)]
        let page = StudioFactory.page(width: template.width, height: template.height)
        var next = design
        next.pages.insert(page, at: index + 1)
        return (next, page.id)
    }

    static func duplicatePage(_ design: StudioDesign, _ id: String) -> (design: StudioDesign, pageId: String?) {
        guard let index = design.pages.firstIndex(where: { $0.id == id }), design.pages.count < StudioLimits.maxPages else { return (design, nil) }
        let regroup = groupMapper()
        var copy = design.pages[index]
        copy.id = StudioFactory.newId()
        copy.elements = copy.elements.map { var e = $0; e.id = StudioFactory.newId(); e.groupId = regroup(e.groupId); return e }
        var next = design
        next.pages.insert(copy, at: index + 1)
        return (next, copy.id)
    }

    static func removePage(_ design: StudioDesign, _ id: String) -> StudioDesign {
        guard design.pages.count > 1 else { return design }
        var next = design
        next.pages.removeAll { $0.id == id }
        return next
    }

    static func movePage(_ design: StudioDesign, _ id: String, to index: Int) -> StudioDesign {
        guard let from = design.pages.firstIndex(where: { $0.id == id }) else { return design }
        var next = design
        let page = next.pages.remove(at: from)
        next.pages.insert(page, at: max(0, min(next.pages.count, index)))
        return next
    }

    private static func scaled(_ stroke: StudioStroke?, _ factor: Double) -> StudioStroke? {
        guard var s = stroke else { return nil }
        s.width = min(500, max(0.1, s.width * factor))
        return s
    }

    static func resizePage(_ page: StudioPage, width: Double, height: Double, mode: PageResizeMode) -> StudioPage {
        let w = StudioFactory.clampSide(width), h = StudioFactory.clampSide(height)
        if w == page.width && h == page.height { return page }
        var next = page
        next.width = w
        next.height = h
        if mode == .keep || page.elements.isEmpty { return next }
        let factor = min(w / page.width, h / page.height)
        let dx = (w - page.width * factor) / 2, dy = (h - page.height * factor) / 2
        next.elements = page.elements.map { e in
            var s = e
            s.x = e.x * factor + dx
            s.y = e.y * factor + dy
            s.width = max(StudioLimits.minElementSide, e.width * factor)
            s.height = max(StudioLimits.minElementSide, e.height * factor)
            switch s.content {
            case .text(var t): t.fontSize = min(1000, max(1, t.fontSize * factor)); s.content = .text(t)
            case .shape(var v): v.cornerRadius *= factor; v.stroke = scaled(v.stroke, factor); s.content = .shape(v)
            case .image(var v): v.cornerRadius *= factor; v.stroke = scaled(v.stroke, factor); s.content = .image(v)
            default: break
            }
            return s
        }
        return next
    }

    static func resizeAllPages(_ design: StudioDesign, width: Double, height: Double, mode: PageResizeMode) -> StudioDesign {
        var next = design
        next.pages = design.pages.map { resizePage($0, width: width, height: height, mode: mode) }
        return next
    }

    /// Inserts a template's pages after (or in place of an empty) current page (`templates/apply.ts`).
    static func insertTemplate(_ design: StudioDesign, pageId: String?, template: StudioDesign) -> (design: StudioDesign, pageId: String)? {
        let index = max(0, design.pages.firstIndex { $0.id == pageId } ?? 0)
        let current = design.pages.indices.contains(index) ? design.pages[index] : nil
        let replace = current?.elements.isEmpty == true
        let pages = Array(design.pages[..<(replace ? index : min(design.pages.count, index + 1))]) + template.pages + Array(design.pages[min(design.pages.count, index + 1)...])
        guard pages.count <= StudioLimits.maxPages else { return nil }
        var next = design
        next.name = design.name.isEmpty ? template.name : design.name
        next.palette = Array((design.palette + template.palette.filter { !design.palette.contains($0) }).prefix(StudioLimits.maxPalette))
        next.pages = pages
        return (next, template.pages.first?.id ?? current?.id ?? "")
    }

    // MARK: Guides & margins

    static func addGuide(_ page: StudioPage, _ guide: StudioGuide) -> StudioPage {
        guard page.guides.count < StudioLimits.maxGuidesPerPage, guide.position.isFinite else { return page }
        var next = page
        next.guides.append(guide)
        return next
    }

    static func moveGuide(_ page: StudioPage, _ index: Int, _ position: Double) -> StudioPage {
        guard page.guides.indices.contains(index), position.isFinite, page.guides[index].position != position else { return page }
        var next = page
        next.guides[index].position = position
        return next
    }

    static func removeGuide(_ page: StudioPage, _ index: Int) -> StudioPage {
        guard page.guides.indices.contains(index) else { return page }
        var next = page
        next.guides.remove(at: index)
        return next
    }

    static func withMargins(_ design: StudioDesign, _ millimetres: Double) -> StudioDesign {
        var next = design
        next.margins = millimetres.isFinite ? min(StudioLimits.maxMarginMM, max(0, millimetres)) : 0
        return next
    }

    // MARK: Colours

    static func elementColors(_ e: StudioElement) -> [String] {
        switch e.content {
        case .text(let t): return [t.color] + t.runs.compactMap(\.color)
        case .shape(let s): return s.fill.colors + (s.stroke.map { [$0.color] } ?? [])
        case .image(let i): return i.stroke.map { [$0.color] } ?? []
        case .qr(let q): return [q.color] + (q.background.map { [$0] } ?? [])
        case .vector(let v): return v.paths.flatMap { $0.fill.colors + ($0.stroke.map { [$0.color] } ?? []) }
        case .svg(let s): return StudioSVGColors.effective(s)
        }
    }

    static func uniqueColors(_ e: StudioElement) -> [String] {
        var seen: [String] = []
        for c in elementColors(e).map({ $0.lowercased() }) where !seen.contains(c) { seen.append(c) }
        return seen
    }

    static func swap(_ e: StudioElement, _ swap: (String) -> String) -> StudioElement {
        var next = e
        func stroke(_ s: StudioStroke?) -> StudioStroke? { s.map { var c = $0; c.color = swap($0.color); return c } }
        switch e.content {
        case .text(var t):
            t.color = swap(t.color)
            t.runs = t.runs.map { var r = $0; if let c = r.color { r.color = swap(c) }; return r }
            next.content = .text(t)
        case .shape(var s): s.fill = s.fill.mapColors(swap); s.stroke = stroke(s.stroke); next.content = .shape(s)
        case .image(var i): i.stroke = stroke(i.stroke); next.content = .image(i)
        case .qr(var q): q.color = swap(q.color); q.background = q.background.map(swap); next.content = .qr(q)
        case .vector(var v):
            v.paths = v.paths.map { var p = $0; p.fill = p.fill.mapColors(swap); p.stroke = stroke(p.stroke); return p }
            next.content = .vector(v)
        case .svg(let s): next.content = .svg(StudioSVGColors.swap(s, swap))
        }
        return next
    }

    static func recolor(_ e: StudioElement, from: String, to: String) -> StudioElement {
        let wanted = from.lowercased()
        return swap(e) { $0.lowercased() == wanted ? to : $0 }
    }

    static func designColors(_ design: StudioDesign) -> [String] {
        var counts: [String: Int] = [:]
        var order: [String] = []
        for page in design.pages {
            for c in page.background.fill.colors + page.elements.flatMap(elementColors) {
                let key = c.lowercased()
                if counts[key] == nil { order.append(key) }
                counts[key, default: 0] += 1
            }
        }
        return order.enumerated().sorted { (counts[$0.element] ?? 0, -$0.offset) > (counts[$1.element] ?? 0, -$1.offset) }.map(\.element)
    }

    static func recolorDesign(_ design: StudioDesign, from: String, to: String) -> StudioDesign {
        let wanted = from.lowercased()
        let swapper: (String) -> String = { $0.lowercased() == wanted ? to : $0 }
        var next = design
        next.pages = design.pages.map { page in
            var p = page
            p.background.fill = page.background.fill.mapColors(swapper)
            p.elements = page.elements.map { swap($0, swapper) }
            return p
        }
        return next
    }

    // MARK: Vector stroke width

    static func vectorStrokeWidth(_ e: StudioElement) -> Double? {
        guard let v = e.vector else { return nil }
        let widths = v.paths.compactMap { $0.stroke?.width }
        guard let widest = widths.max() else { return nil }
        let scale = sqrt((e.width / v.viewWidth) * (e.height / v.viewHeight))
        return ((widest * (scale.isFinite && scale > 0 ? scale : 1)) * 100).rounded() / 100
    }

    static func withVectorStrokeWidth(_ e: StudioElement, _ width: Double) -> StudioElement {
        guard var v = e.vector, let current = vectorStrokeWidth(e), width > 0, abs(current - width) > 1e-6 else { return e }
        let factor = width / current
        v.paths = v.paths.map { p in
            var q = p
            if var s = q.stroke { s.width = min(500, max(0.1, s.width * factor)); q.stroke = s }
            return q
        }
        var next = e
        next.content = .vector(v)
        return next
    }

    /// Image paths referenced by the design (project assets).
    static func imagePaths(_ design: StudioDesign) -> [String] {
        var seen: [String] = []
        for page in design.pages {
            if let src = page.background.image?.src, !seen.contains(src) { seen.append(src) }
            for e in page.elements { if let src = e.image?.src, !src.isEmpty, !seen.contains(src) { seen.append(src) } }
        }
        return seen.filter { !$0.isEmpty }
    }

    static func libraryFontIds(_ design: StudioDesign) -> [String] {
        var ids = Set<String>()
        for page in design.pages {
            for e in page.elements {
                guard let t = e.text else { continue }
                for id in [t.fontId] + t.runs.map(\.fontId) { if let id, id.hasPrefix("library:") { ids.insert(id) } }
            }
        }
        return ids.sorted()
    }
}
