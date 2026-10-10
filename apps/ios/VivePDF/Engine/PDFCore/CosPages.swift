import CoreGraphics
import Foundation

/// One page with its inheritable attributes resolved (ISO 32000-2 §7.7.3.4).
struct CosPage {
    let index: Int
    let ref: CosRef
    /// The page dictionary as stored (inherited keys may be absent here).
    let dict: CosDict
    /// Effective /Resources (inherited, resolved to a dictionary; empty if none).
    let resources: CosDict
    let mediaBox: CGRect
    /// Effective crop box (defaults to the media box, clipped to it).
    let cropBox: CGRect
    /// Normalised to 0, 90, 180 or 270.
    let rotation: Int
    let userUnit: Double

    /// Bleed/Trim/Art boxes default to the crop box.
    let bleedBox: CGRect
    let trimBox: CGRect
    let artBox: CGRect

    /// Size as displayed (crop box, rotation applied).
    var displaySize: CGSize {
        rotation % 180 == 0 ? cropBox.size : CGSize(width: cropBox.height, height: cropBox.width)
    }
}

extension CosDocument {
    static let inheritableKeys = ["Resources", "MediaBox", "CropBox", "Rotate"]
    static let defaultMediaBox = CGRect(x: 0, y: 0, width: 612, height: 792)

    /// Page object references in order (page tree flattened, cycles and broken nodes skipped).
    var pageRefs: [CosRef] {
        lock.lock(); defer { lock.unlock() }
        if let cached = pageCache, cached.generation == editGeneration { return cached.refs }
        var refs: [CosRef] = []
        var visited = Set<CosRef>()
        func walk(_ node: CosObject, depth: Int) {
            guard depth < 64, let ref = node.ref, !visited.contains(ref) else { return }
            visited.insert(ref)
            guard let d = dict(node) else { return }
            if let kids = array(d["Kids"]), d.type != "Page" {
                for kid in kids { walk(kid, depth: depth + 1) }
            } else if d.type == "Page" || d.type == nil || d["Contents"] != nil || d["MediaBox"] != nil {
                refs.append(ref)
            }
        }
        walk(catalog["Pages"] ?? .null, depth: 0)
        if refs.isEmpty {
            // Broken page tree: fall back to every /Type /Page object in file order.
            refs = allRefs.filter { dict(.ref($0))?.type == "Page" }
        }
        pageCache = (editGeneration, refs)
        return refs
    }

    var pageCount: Int { pageRefs.count }

    func pageIndex(of ref: CosRef) -> Int? { pageRefs.firstIndex(of: ref) }

    /// Value of an inheritable key for a page (walks /Parent).
    func inherited(_ key: String, of pageRef: CosRef) -> CosObject? {
        var current: CosObject = .ref(pageRef)
        var seen = Set<CosRef>()
        for _ in 0..<64 {
            guard let r = current.ref, !seen.contains(r), let d = dict(current) else { break }
            seen.insert(r)
            if let v = d[key], !resolve(v).isNull { return v }
            guard let parent = d["Parent"] else { break }
            current = parent
        }
        return nil
    }

    func page(at index: Int) -> CosPage? {
        let refs = pageRefs
        guard index >= 0, index < refs.count else { return nil }
        let ref = refs[index]
        let d = dict(.ref(ref)) ?? CosDict()
        let media = rect(inherited("MediaBox", of: ref)).flatMap { $0.width > 0 && $0.height > 0 ? $0 : nil } ?? Self.defaultMediaBox
        var crop = rect(inherited("CropBox", of: ref)).map { $0.intersection(media) } ?? media
        if crop.isNull || crop.width <= 0 || crop.height <= 0 { crop = media }
        func box(_ key: String) -> CGRect {
            guard let r = rect(d[key]) else { return crop }
            let clipped = r.intersection(media)
            return clipped.isNull || clipped.isEmpty ? crop : clipped
        }
        var rotation = (int(inherited("Rotate", of: ref)) ?? 0) % 360
        if rotation < 0 { rotation += 360 }
        rotation = (rotation / 90) * 90
        return CosPage(index: index, ref: ref, dict: d, resources: dict(inherited("Resources", of: ref)) ?? CosDict(),
                       mediaBox: media, cropBox: crop, rotation: rotation,
                       userUnit: number(d["UserUnit"]) ?? 1,
                       bleedBox: box("BleedBox"), trimBox: box("TrimBox"), artBox: box("ArtBox"))
    }

    var pages: [CosPage] { (0..<pageCount).compactMap { page(at: $0) } }

    // MARK: Content streams

    /// The page's content streams (refs or direct streams) in order.
    func contentStreams(of pageRef: CosRef) -> [CosObject] {
        guard let d = dict(.ref(pageRef)), let contents = d["Contents"] else { return [] }
        switch resolve(contents) {
        case .array(let items): return items
        case .stream: return [contents]
        default: return []
        }
    }

    /// Decoded, concatenated page content (streams joined with a newline, as the spec requires).
    func pageContents(at index: Int) -> Data {
        guard index >= 0, index < pageCount else { return Data() }
        var out = Data()
        for (i, s) in contentStreams(of: pageRefs[index]).enumerated() {
            if i > 0 { out.append(0x0A) }
            if let d = try? decodedData(s) { out.append(d) }
        }
        return out
    }

    /// Replaces all page content with one new stream.
    func setPageContents(at index: Int, _ data: Data, compress: Bool = true) {
        guard index >= 0, index < pageCount else { return }
        let pageRef = pageRefs[index]
        let streamRef = add(.stream(CosStream(decoded: data, compress: compress)))
        modifyDict(pageRef) { $0["Contents"] = .ref(streamRef) }
    }

    /// Adds content before/after the existing streams without decoding them. With `isolate`, the existing
    /// content is wrapped in `q … Q` so its graphics state cannot leak into the appended content.
    func addPageContents(at index: Int, _ data: Data, prepend: Bool = false, isolate: Bool = true, compress: Bool = true) {
        guard index >= 0, index < pageCount else { return }
        let pageRef = pageRefs[index]
        var existing = contentStreams(of: pageRef)
        let newRef = add(.stream(CosStream(decoded: data, compress: compress)))
        if prepend {
            existing.insert(.ref(newRef), at: 0)
        } else {
            if isolate, !existing.isEmpty {
                existing.insert(.ref(add(.stream(CosStream(decoded: Data("q\n".utf8), compress: false)))), at: 0)
                existing.append(.ref(add(.stream(CosStream(decoded: Data("\nQ\n".utf8), compress: false)))))
            }
            existing.append(.ref(newRef))
        }
        // Direct streams inside /Contents are invalid; make sure every element is a reference.
        let refs: [CosObject] = existing.map { $0.ref != nil ? $0 : .ref(add(resolve($0))) }
        modifyDict(pageRef) { $0["Contents"] = .array(refs) }
    }

    // MARK: Page tree editing

    /// Rewrites the page tree as a single /Pages node whose /Kids are all pages, copying inherited
    /// attributes into each page first. All structural edits go through this, so they are simple and safe.
    @discardableResult
    func flattenPageTree() -> CosRef {
        lock.lock(); defer { lock.unlock() }
        let refs = pageRefs
        let rootRef: CosRef
        if let r = catalog.ref("Pages"), dict(.ref(r)) != nil { rootRef = r } else {
            rootRef = add(.dict(["Type": "Pages", "Kids": [], "Count": 0]))
            if let c = catalogRef { modifyDict(c) { $0["Pages"] = .ref(rootRef) } }
        }
        for ref in refs {
            var d = dict(.ref(ref)) ?? CosDict()
            var changed = false
            for key in Self.inheritableKeys where d[key] == nil {
                if let v = inherited(key, of: ref) { d[key] = v; changed = true }
            }
            if d.ref("Parent") != rootRef { d["Parent"] = .ref(rootRef); changed = true }
            if d.type != "Page" { d["Type"] = "Page"; changed = true }
            if changed { update(ref, .dict(d)) }
        }
        var root = dict(.ref(rootRef)) ?? CosDict()
        for key in Self.inheritableKeys { root[key] = nil }
        root["Type"] = "Pages"
        root["Kids"] = .array(refs.map { .ref($0) })
        root["Count"] = .int(refs.count)
        root["Parent"] = nil
        update(rootRef, .dict(root))
        return rootRef
    }

    /// Sets the page order to `order` (indices into the current pages; omissions delete, repeats are not
    /// allowed — duplicate a page with `duplicatePage`).
    func setPageOrder(_ order: [Int]) throws {
        let refs = pageRefs
        guard Set(order).count == order.count, order.allSatisfy({ $0 >= 0 && $0 < refs.count }) else {
            throw CosError.invalidArgument("page order")
        }
        let root = flattenPageTree()
        modifyDict(root) {
            $0["Kids"] = .array(order.map { .ref(refs[$0]) })
            $0["Count"] = .int(order.count)
        }
    }

    func removePage(at index: Int) throws {
        guard index >= 0, index < pageCount else { throw CosError.invalidArgument("page index") }
        try setPageOrder((0..<pageCount).filter { $0 != index })
    }

    func movePage(from: Int, to: Int) throws {
        var order = Array(0..<pageCount)
        guard from >= 0, from < order.count, to >= 0, to < order.count else { throw CosError.invalidArgument("page index") }
        let item = order.remove(at: from)
        order.insert(item, at: to)
        try setPageOrder(order)
    }

    /// Inserts an existing page object (already in this document) at `index` (== pageCount appends).
    func insertPage(_ pageRef: CosRef, at index: Int) throws {
        var refs = pageRefs
        guard index >= 0, index <= refs.count else { throw CosError.invalidArgument("page index") }
        let root = flattenPageTree()
        modifyDict(pageRef) {
            $0["Type"] = "Page"
            $0["Parent"] = .ref(root)
        }
        refs.insert(pageRef, at: index)
        modifyDict(root) {
            $0["Kids"] = .array(refs.map { .ref($0) })
            $0["Count"] = .int(refs.count)
        }
    }

    /// Creates an empty page (optionally with content) and inserts it.
    @discardableResult
    func addPage(mediaBox: CGRect = CosDocument.defaultMediaBox, contents: Data? = nil, resources: CosDict = CosDict(),
                 at index: Int? = nil) throws -> CosRef {
        var d: CosDict = ["Type": "Page", "MediaBox": .rect(mediaBox), "Resources": .dict(resources)]
        if let contents { d["Contents"] = .ref(add(.stream(CosStream(decoded: contents)))) }
        let ref = add(.dict(d))
        try insertPage(ref, at: index ?? pageCount)
        return ref
    }

    /// Shallow-duplicates a page (shares content streams and resources) and inserts the copy after it.
    @discardableResult
    func duplicatePage(at index: Int, to target: Int? = nil) throws -> CosRef {
        guard let page = page(at: index) else { throw CosError.invalidArgument("page index") }
        var d = page.dict
        for key in Self.inheritableKeys where d[key] == nil { d[key] = inherited(key, of: page.ref) }
        d["Annots"] = nil // annotations belong to one page (/P); copy them explicitly if needed
        d["StructParents"] = nil
        let ref = add(.dict(d))
        try insertPage(ref, at: target ?? index + 1)
        return ref
    }

    // MARK: Importing from another document

    /// Deep-copies `object` from `source` into this document, following references (except /Parent links
    /// and references to pages not being imported). `map` memoises copied objects across calls so shared
    /// resources (fonts, images) are copied once — reuse the same map when importing many pages.
    func importObject(_ object: CosObject, from source: CosDocument, map: inout [CosRef: CosRef],
                      excluding excluded: Set<CosRef> = []) -> CosObject {
        switch object {
        case .ref(let r):
            if let mapped = map[r] { return .ref(mapped) }
            if excluded.contains(r) { return .null }
            let placeholder = add(.null)
            map[r] = placeholder
            let copied = importObject(source.object(r), from: source, map: &map, excluding: excluded)
            update(placeholder, copied)
            return .ref(placeholder)
        case .array(let items):
            return .array(items.map { importObject($0, from: source, map: &map, excluding: excluded) })
        case .dict(let d):
            return .dict(importDict(d, from: source, map: &map, excluding: excluded))
        case .stream(var s):
            s.dict = importDict(s.dict, from: source, map: &map, excluding: excluded)
            return .stream(s)
        default:
            return object
        }
    }

    private func importDict(_ d: CosDict, from source: CosDocument, map: inout [CosRef: CosRef], excluding: Set<CosRef>) -> CosDict {
        var out = CosDict()
        for (k, v) in d {
            if k == "Parent", d.type == "Page" || d.type == "Pages" { continue }
            if k == "StructParent" || k == "StructParents" { continue } // the structure tree is not imported
            out[k] = importObject(v, from: source, map: &map, excluding: excluding)
        }
        return out
    }

    /// Copies page `index` of `source` (with its resources, annotations and inherited attributes) and inserts it.
    @discardableResult
    func importPage(from source: CosDocument, index: Int, at target: Int? = nil, map: inout [CosRef: CosRef]) throws -> CosRef {
        guard let page = source.page(at: index) else { throw CosError.invalidArgument("page index") }
        var d = page.dict
        for key in Self.inheritableKeys where d[key] == nil { d[key] = source.inherited(key, of: page.ref) }
        d["Parent"] = nil
        d["B"] = nil // article beads point into the source's thread structure
        // Other pages of the source are excluded so link destinations do not drag whole pages along;
        // our own page maps to the new object (annotation /P back-links).
        let excluded = Set(source.pageRefs).subtracting([page.ref])
        let newRef = add(.null)
        map[page.ref] = newRef
        let copied = importObject(.dict(d), from: source, map: &map, excluding: excluded)
        update(newRef, copied)
        try insertPage(newRef, at: target ?? pageCount)
        return newRef
    }
}
