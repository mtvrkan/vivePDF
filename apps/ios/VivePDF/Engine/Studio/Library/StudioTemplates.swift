import Foundation

/// The desktop's built-in template catalogue (`templates/catalog.ts`). Every template was built by the
/// desktop code for each of the eight languages and packed into `studio-templates.bin` (raw deflate):
/// English designs in full, other languages as leaf-level differences, and ornament art as
/// `{ "$o": [id, primary, secondary, width, height] }` references rebuilt by `StudioOrnaments`.
enum StudioTemplates {
    enum Category: String, CaseIterable, Identifiable {
        case resumes, certificates, invitations, social, posters, flyers, covers, business, cards, menus, education, personal, labels
        var id: String { rawValue }
        var labelKey: String { "studio.templates.categories.\(rawValue)" }
        /// SF Symbol standing in for the desktop's Lucide category icon.
        var symbol: String {
            switch self {
            case .resumes: "person.text.rectangle"
            case .certificates: "rosette"
            case .invitations: "envelope.open"
            case .social: "square.and.arrow.up"
            case .posters: "megaphone"
            case .flyers: "newspaper"
            case .covers: "book"
            case .business: "briefcase"
            case .cards: "person.crop.rectangle"
            case .menus: "fork.knife"
            case .education: "graduationcap"
            case .personal: "calendar"
            case .labels: "tag"
            }
        }
    }

    struct Info: Identifiable, Hashable {
        let id: String
        let category: Category
        let width: Double
        let height: Double
        var nameKey: String { "studio.templates.items.\(id)" }
        var name: String { t(nameKey) }
    }

    static let languages = ["tr", "en", "de", "fr", "es", "it", "pt-BR", "ar"]

    private final class Pack: @unchecked Sendable {
        let infos: [Info]
        let base: [[String: Any]]
        let locales: [String: [[Any]]]
        init(infos: [Info], base: [[String: Any]], locales: [String: [[Any]]]) {
            self.infos = infos
            self.base = base
            self.locales = locales
        }
    }

    private static let pack: Pack = {
        guard let url = StudioResources.url("studio-templates", "bin"), let packed = try? Data(contentsOf: url),
              let json = try? (packed as NSData).decompressed(using: .zlib) as Data,
              let root = try? JSONSerialization.jsonObject(with: json) as? [String: Any] else {
            return Pack(infos: [], base: [], locales: [:])
        }
        let meta = root["meta"] as? [[String: Any]] ?? []
        let infos = meta.compactMap { item -> Info? in
            guard let id = item["id"] as? String, let category = (item["category"] as? String).flatMap(Category.init(rawValue:)) else { return nil }
            return Info(id: id, category: category, width: (item["width"] as? NSNumber)?.doubleValue ?? 595.28, height: (item["height"] as? NSNumber)?.doubleValue ?? 841.89)
        }
        return Pack(infos: infos, base: root["base"] as? [[String: Any]] ?? [], locales: root["locales"] as? [String: [[Any]]] ?? [:])
    }()

    /// Every template in desktop order.
    static var all: [Info] { pack.infos }

    static func info(_ id: String) -> Info? { pack.infos.first { $0.id == id } }

    static func templates(in category: Category) -> [Info] { pack.infos.filter { $0.category == category } }

    static func packLanguage(_ language: String) -> String {
        if languages.contains(language) { return language }
        let base = language.split(separator: "-").first.map(String.init)?.lowercased() ?? "en"
        if base == "pt" { return "pt-BR" }
        return languages.contains(base) ? base : "en"
    }

    /// `TemplateGallery` search: template name + category name, case-insensitive substring in the UI language.
    static func search(_ query: String, language: String) -> [Info] {
        let locale = Locale(identifier: language)
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(with: locale)
        guard !needle.isEmpty else { return all }
        return all.filter { "\($0.name) \(t($0.category.labelKey))".lowercased(with: locale).contains(needle) }
    }

    // MARK: Building

    private final class Box: @unchecked Sendable {
        var value: Any
        init(_ value: Any) { self.value = value }
    }

    private static func set(_ root: Any, _ path: ArraySlice<Any>, _ value: Any) -> Any {
        guard let key = path.first else { return value }
        if let index = key as? Int, var array = root as? [Any], array.indices.contains(index) {
            array[index] = set(array[index], path.dropFirst(), value)
            return array
        }
        if let name = key as? String, var dict = root as? [String: Any] {
            dict[name] = set(dict[name] ?? NSNull(), path.dropFirst(), value)
            return dict
        }
        return root
    }

    private static let artCache = NSCache<NSString, Box>()

    private static func ornamentPaths(_ spec: [Any]) -> [StudioVectorPath]? {
        guard spec.count == 5, let id = spec[0] as? String, let primary = spec[1] as? String, let secondary = spec[2] as? String,
              let w = (spec[3] as? NSNumber)?.doubleValue, let h = (spec[4] as? NSNumber)?.doubleValue,
              let item = StudioOrnaments.ornament(id) else { return nil }
        let key = "\(id)|\(primary)|\(secondary)|\(w)|\(h)" as NSString
        if let hit = artCache.object(forKey: key)?.value as? [StudioVectorPath] { return hit }
        let paths = item.build(StudioOrnaments.Colors(primary: primary, secondary: secondary), (w, h)).paths
        artCache.setObject(Box(paths), forKey: key)
        return paths
    }

    /// Builds a fresh copy of a template in `language`: new page and element ids, group ids remapped
    /// consistently, ornament art regenerated. Nil for unknown ids.
    static func design(id: String, language: String) -> StudioDesign? {
        guard let index = pack.infos.firstIndex(where: { $0.id == id }), pack.base.indices.contains(index) else { return nil }
        var root: Any = pack.base[index]
        let lang = packLanguage(language)
        if lang != "en", let diffs = pack.locales[lang], diffs.indices.contains(index) {
            for entry in diffs[index] {
                guard let pair = entry as? [Any], pair.count == 2, let path = pair[0] as? [Any] else { continue }
                root = set(root, path[...], pair[1])
            }
        }
        guard var object = root as? [String: Any], var pages = object["pages"] as? [[String: Any]] else { return nil }
        var arts: [(page: Int, element: Int, paths: [StudioVectorPath])] = []
        var groups: [String: String] = [:]
        for p in pages.indices {
            guard var elements = pages[p]["elements"] as? [[String: Any]] else { continue }
            for e in elements.indices {
                if let group = elements[e]["groupId"] as? String {
                    if groups[group] == nil { groups[group] = StudioFactory.newId() }
                    elements[e]["groupId"] = groups[group]
                }
                if let ref = (elements[e]["paths"] as? [String: Any])?["$o"] as? [Any], let paths = ornamentPaths(ref) {
                    elements[e]["paths"] = [["d": "M0 0", "fill": ["type": "none"]]]
                    arts.append((p, e, paths))
                }
            }
            pages[p]["elements"] = elements
        }
        object["pages"] = pages
        guard var design = StudioJSON.design(object) else { return nil }
        for art in arts where design.pages.indices.contains(art.page) && design.pages[art.page].elements.indices.contains(art.element) {
            design.pages[art.page].elements[art.element].vector?.paths = art.paths
        }
        return design
    }

    // MARK: Thumbnails

    /// `thumbnailPage`: empty image frames become grey picture placeholders so previews read well.
    static func thumbnailPage(_ page: StudioPage) -> StudioPage {
        var next = page
        next.elements = page.elements.map { element in
            guard let image = element.image, image.src.isEmpty else { return element }
            return placeholder(element, image)
        }
        return next
    }

    static func placeholder(_ element: StudioElement, _ image: StudioImage) -> StudioElement {
        let width = element.width, height = element.height
        let outline = image.mask == .circle ? StudioShapes.ellipse(width / 2, height / 2, width / 2, height / 2)
            : StudioShapes.roundedRect(0, 0, width, height, image.mask == .rounded ? image.cornerRadius : 0)
        let side = min(min(width, height) / 3, 48)
        let cx = width / 2, cy = height / 2
        let base = cy + side / 2
        let num = StudioOrnaments.num
        let peak = "M\(num(cx - side / 2)) \(num(base)) L\(num(cx - side / 6)) \(num(cy - side / 10)) L\(num(cx + side / 6)) \(num(base)) Z"
        let hill = "M\(num(cx - side / 10)) \(num(base)) L\(num(cx + side / 5)) \(num(cy + side / 8)) L\(num(cx + side / 2)) \(num(base)) Z"
        let sun = StudioShapes.ellipse(cx + side / 4, cy - side / 4, side / 9, side / 9)
        func solid(_ d: String, _ color: String) -> StudioVectorPath { StudioVectorPath(d: d, fill: .solid(color), stroke: nil) }
        var result = element
        result.flipX = false
        result.flipY = false
        result.lockRatio = nil
        result.content = .vector(StudioVector(viewWidth: width, viewHeight: height, paths: [solid(outline, "#e6e8ec"), solid(peak, "#a3a9b4"), solid(hill, "#a3a9b4"), solid(sun, "#a3a9b4")], dropShadow: image.dropShadow))
        return result
    }
}
