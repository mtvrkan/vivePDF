import CoreGraphics
import CoreText
import CryptoKit
import Foundation
import Observation

/// Font ids shared with the desktop (`bundled:dejavu-sans`, `library:<family>`, `system:<key>`,
/// `imported:<stem>`) resolved to Core Text faces. Library families download on demand from the same
/// release the desktop uses; imported fonts are copied into the app container.
struct StudioFontChoice: Identifiable, Hashable {
    enum Source: String { case bundled, library, system, imported }
    let id: String
    let name: String
    let source: Source
    var installed = true
    var category: String? = nil
    var bytes: Int = 0
    var weights: [Int] = [400, 700]
}

/// One resolved face: a Core Text font at size 1 plus the metrics the layout engine needs (in em).
final class StudioFace {
    let font: CTFont
    let oblique: Bool
    let ascender: Double
    let descender: Double
    let underlinePosition: Double
    let underlineThickness: Double
    let strikeThickness: Double
    private var sized: [Double: CTFont] = [:]
    private let lock = NSLock()

    init(font: CTFont, oblique: Bool) {
        self.font = font
        self.oblique = oblique
        let units = Double(CTFontGetUnitsPerEm(font))
        let size = Double(CTFontGetSize(font))
        var ascent = Double(CTFontGetAscent(font)) / size
        var descent = -Double(CTFontGetDescent(font)) / size
        if ascent - descent <= 0 { ascent = 0.8; descent = -0.2 }
        ascender = ascent
        descender = descent
        underlinePosition = -Double(CTFontGetUnderlinePosition(font)) / size
        let thickness = max(Double(CTFontGetUnderlineThickness(font)) / size, 0.02)
        underlineThickness = thickness
        var strike = 0.0
        if let table = CTFontCopyTable(font, CTFontTableTag(kCTFontTableOS2), []) as Data?, table.count >= 28, units > 0 {
            let raw = Int16(bitPattern: UInt16(table[26]) << 8 | UInt16(table[27]))
            strike = Double(raw) / units
        }
        strikeThickness = strike > 0 ? strike : thickness
    }

    /// The face at `size` points (oblique faces carry the desktop's 0.25 slant in their matrix).
    func font(size: Double) -> CTFont {
        lock.lock()
        defer { lock.unlock() }
        if let hit = sized[size] { return hit }
        var matrix = oblique ? CGAffineTransform(a: 1, b: 0, c: -0.25, d: 1, tx: 0, ty: 0) : .identity
        let made = CTFontCreateCopyWithAttributes(font, CGFloat(size), &matrix, nil)
        if sized.count > 64 { sized.removeAll() }
        sized[size] = made
        return made
    }

    func hasGlyphs(_ text: String) -> Bool {
        let units = Array(text.utf16)
        guard !units.isEmpty else { return true }
        var glyphs = [CGGlyph](repeating: 0, count: units.count)
        return CTFontGetGlyphsForCharacters(font, units, &glyphs, units.count)
    }
}

@Observable
final class StudioFonts: @unchecked Sendable {
    static let shared = StudioFonts()

    struct LibraryFile: Decodable { let style: String; let name: String; let size: Int; let sha256: String }
    struct LibraryFamily: Decodable { let id: String; let name: String; let category: String; let files: [LibraryFile] }
    private struct Catalog: Decodable { let release: String; let base: String; let families: [LibraryFamily] }

    /// Bumped whenever fonts appear or disappear so canvases and thumbnails redraw.
    private(set) var revision = 0
    /// Library family ids currently downloading, with progress 0…1.
    private(set) var downloading: [String: Double] = [:]

    @ObservationIgnored let library: [LibraryFamily]
    @ObservationIgnored private let downloadBase: String
    @ObservationIgnored private var faces: [String: StudioFace] = [:]
    @ObservationIgnored private var files: [String: CTFont] = [:]
    @ObservationIgnored private let lock = NSRecursiveLock()
    @ObservationIgnored private var systemIndex: [String: [SystemFace]]?
    @ObservationIgnored private var systemLabels: [(key: String, label: String)] = []

    static let defaultId = StudioTypography.defaultFontId

    private init() {
        if let url = StudioResources.url("studio-font-library", "json"), let data = try? Data(contentsOf: url),
           let catalog = try? JSONDecoder().decode(Catalog.self, from: data) {
            library = catalog.families
            downloadBase = catalog.base
        } else {
            library = []
            downloadBase = "https://github.com/mtvrkan/vivePDF/releases/download/fonts-2"
        }
    }

    // MARK: Folders

    static var libraryDirectory: URL { Workspace.supportFolder("font-library") }
    static var importedDirectory: URL { Workspace.supportFolder("studio-fonts") }

    // MARK: Faces

    /// `resolve_face`: the face for a font id, weight (100…900) and style; unknown or missing fonts fall
    /// back to DejaVu Sans like the desktop engine.
    func face(_ fontId: String?, weight: Int, italic: Bool) -> StudioFace {
        let key = "\(fontId ?? Self.defaultId)|\(weight)|\(italic ? 1 : 0)|\(revision)"
        lock.lock()
        defer { lock.unlock() }
        if let hit = faces[key] { return hit }
        let (font, realItalic) = resolve(fontId, weight: weight, italic: italic)
        let face = StudioFace(font: font, oblique: italic && !realItalic)
        faces[key] = face
        return face
    }

    private func resolve(_ fontId: String?, weight: Int, italic: Bool) -> (CTFont, Bool) {
        let bold = weight >= StudioTypography.boldFrom
        let parts = (fontId ?? "").split(separator: ":", maxSplits: 1).map(String.init)
        let kind = parts.first ?? "", value = parts.count > 1 ? parts[1] : ""
        switch kind {
        case "library":
            if let (url, real) = libraryFace(value, bold: bold, italic: italic), let font = fileFont(url) { return (font, real) }
        case "system":
            if let (font, real) = systemFace(value, weight: weight, italic: italic) { return (font, real) }
        case "imported":
            if let (font, real) = importedFace(value, weight: weight, italic: italic) { return (font, real) }
        default:
            break
        }
        return (bundledFont(bold: bold), false)
    }

    private func bundledFont(bold: Bool) -> CTFont {
        if let url = StudioResources.url(bold ? "Studio-DejaVuSans-Bold" : "Studio-DejaVuSans", "ttf"), let font = fileFont(url) { return font }
        return CTFontCreateWithName((bold ? "Helvetica-Bold" : "Helvetica") as CFString, 1, nil)
    }

    private func fileFont(_ url: URL) -> CTFont? {
        lock.lock()
        defer { lock.unlock() }
        if let hit = files[url.path] { return hit }
        guard let provider = CGDataProvider(url: url as CFURL), let cg = CGFont(provider) else { return nil }
        let font = CTFontCreateWithGraphicsFont(cg, 1, nil, nil)
        files[url.path] = font
        return font
    }

    // MARK: Library

    func libraryFamily(_ id: String) -> LibraryFamily? {
        let key = id.hasPrefix("library:") ? String(id.dropFirst(8)) : id
        return library.first { $0.id == key }
    }

    func isInstalled(_ family: LibraryFamily) -> Bool {
        family.files.allSatisfy { file in
            let url = Self.libraryDirectory.appendingPathComponent(file.name)
            return (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) == file.size
        }
    }

    /// True when the font id resolves to its real face (library fonts need a download first).
    func isAvailable(_ fontId: String?) -> Bool {
        guard let fontId, fontId.hasPrefix("library:") else { return true }
        return libraryFamily(fontId).map(isInstalled) ?? false
    }

    private func libraryFace(_ id: String, bold: Bool, italic: Bool) -> (URL, Bool)? {
        guard let family = libraryFamily(id), isInstalled(family) else { return nil }
        let order: [String] = switch (bold, italic) {
        case (true, true): ["boldItalic", "italic", "bold", "regular"]
        case (false, true): ["italic", "regular"]
        case (true, false): ["bold", "regular"]
        case (false, false): ["regular"]
        }
        for style in order {
            if let file = family.files.first(where: { $0.style == style }) {
                return (Self.libraryDirectory.appendingPathComponent(file.name), style == "italic" || style == "boldItalic")
            }
        }
        return nil
    }

    /// Library families used by `design` that are not downloaded yet (MissingFontsBar).
    func missingFamilies(in design: StudioDesign) -> [LibraryFamily] {
        StudioEdit.libraryFontIds(design).compactMap(libraryFamily).filter { !isInstalled($0) }
    }

    @MainActor
    func download(_ familyId: String) async throws {
        guard let family = libraryFamily(familyId) else { throw EngineError.invalid(familyId) }
        let total = Double(max(1, family.files.reduce(0) { $0 + $1.size }))
        var done = 0.0
        downloading[family.id] = 0
        defer { downloading[family.id] = nil }
        for file in family.files {
            let target = Self.libraryDirectory.appendingPathComponent(file.name)
            if (try? target.resourceValues(forKeys: [.fileSizeKey]).fileSize) == file.size { done += Double(file.size); continue }
            guard let url = URL(string: "\(downloadBase)/\(file.name)") else { continue }
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode ?? 200 < 400, data.count == file.size else {
                throw EngineError(.NETWORK, reason: "fontDownload", detail: file.name)
            }
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard digest == file.sha256 else { throw EngineError(.NETWORK, reason: "fontChecksum", detail: file.name) }
            try data.write(to: target, options: .atomic)
            done += Double(file.size)
            downloading[family.id] = done / total
        }
        invalidate()
    }

    func removeLibrary(_ familyId: String) {
        guard let family = libraryFamily(familyId) else { return }
        for file in family.files { try? FileManager.default.removeItem(at: Self.libraryDirectory.appendingPathComponent(file.name)) }
        invalidate()
    }

    func invalidate() {
        lock.lock()
        faces.removeAll()
        files.removeAll()
        systemIndex = nil
        lock.unlock()
        revision += 1
    }

    // MARK: System fonts

    private struct SystemFace { let name: String; let family: String; let weight: Int; let italic: Bool }

    static func normalize(_ name: String) -> String {
        var cleaned = name
        if cleaned.count > 7, cleaned.dropFirst(6).first == "+", cleaned.prefix(6).allSatisfy({ $0.isUppercase }) { cleaned = String(cleaned.dropFirst(7)) }
        return cleaned.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    /// `family_key`: lower-case alphanumerics without style words or MT/PS suffixes ("Georgia-Bold" → "georgia").
    static func familyKey(_ name: String) -> String {
        var key = normalize(name)
        func strip() {
            for suffix in ["psmt", "mt", "ps"] where key.hasSuffix(suffix) && key.count > suffix.count + 2 { key.removeLast(suffix.count) }
        }
        strip()
        for word in ["bolditalic", "boldoblique", "bold", "italic", "oblique", "regular", "roman", "book"] { key = key.replacingOccurrences(of: word, with: "") }
        strip()
        return key
    }

    private func buildSystemIndex() -> [String: [SystemFace]] {
        if let systemIndex { return systemIndex }
        var index: [String: [SystemFace]] = [:]
        var labels: [String: String] = [:]
        let collection = CTFontCollectionCreateFromAvailableFonts(nil)
        let descriptors = (CTFontCollectionCreateMatchingFontDescriptors(collection) as? [CTFontDescriptor]) ?? []
        for descriptor in descriptors {
            guard let name = CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute) as? String, !name.hasPrefix(".") else { continue }
            let family = (CTFontDescriptorCopyAttribute(descriptor, kCTFontFamilyNameAttribute) as? String) ?? name
            let traits = (CTFontDescriptorCopyAttribute(descriptor, kCTFontTraitsAttribute) as? [CFString: Any]) ?? [:]
            let symbolic = (traits[kCTFontSymbolicTrait] as? UInt32) ?? 0
            let italic = symbolic & CTFontSymbolicTraits.traitItalic.rawValue != 0
            let w = (traits[kCTFontWeightTrait] as? Double) ?? 0
            let weight = Self.cssWeight(w)
            let key = Self.familyKey(family)
            guard !key.isEmpty else { continue }
            index[key, default: []].append(SystemFace(name: name, family: family, weight: weight, italic: italic))
            if labels[key] == nil { labels[key] = family }
        }
        systemIndex = index
        systemLabels = labels.map { ($0.key, $0.value) }.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        return index
    }

    /// Core Text weight trait (-1…1) → CSS weight.
    static func cssWeight(_ trait: Double) -> Int {
        let table: [(Double, Int)] = [(-0.8, 100), (-0.6, 200), (-0.4, 300), (0, 400), (0.23, 500), (0.3, 600), (0.4, 700), (0.56, 800), (0.62, 900)]
        return table.min { abs($0.0 - trait) < abs($1.0 - trait) }?.1 ?? 400
    }

    static func nearestWeight(_ weights: [Int], _ wanted: Int) -> Int {
        weights.min { a, b in
            let da = abs(a - wanted), db = abs(b - wanted)
            if da != db { return da < db }
            return wanted >= 400 ? a > b : a < b
        } ?? wanted
    }

    private func systemFace(_ key: String, weight: Int, italic: Bool) -> (CTFont, Bool)? {
        lock.lock()
        let index = buildSystemIndex()
        lock.unlock()
        let candidates = index[key] ?? index[Self.familyKey(key)] ?? []
        guard !candidates.isEmpty else { return nil }
        let italics = italic ? candidates.filter(\.italic) : []
        let pool = italics.isEmpty ? candidates.filter { !$0.italic } : italics
        let chosen = pool.isEmpty ? candidates : pool
        let best = Self.nearestWeight(chosen.map(\.weight), weight)
        guard let face = chosen.first(where: { $0.weight == best }) else { return nil }
        return (CTFontCreateWithName(face.name as CFString, 1, nil), !italics.isEmpty)
    }

    // MARK: Imported fonts

    private struct ImportedFace { let url: URL; let stem: String; let family: String; let weight: Int; let italic: Bool }

    private func importedFaces() -> [ImportedFace] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: Self.importedDirectory, includingPropertiesForKeys: nil)) ?? []
        return urls.filter { ["ttf", "otf"].contains($0.pathExtension.lowercased()) }.compactMap { url in
            guard let font = fileFont(url) else { return nil }
            let family = (CTFontCopyFamilyName(font) as String?) ?? url.deletingPathExtension().lastPathComponent
            let traits = CTFontGetSymbolicTraits(font)
            let weightTrait = ((CTFontCopyTraits(font) as? [CFString: Any])?[kCTFontWeightTrait] as? Double) ?? 0
            return ImportedFace(url: url, stem: url.deletingPathExtension().lastPathComponent, family: family, weight: Self.cssWeight(weightTrait), italic: traits.contains(.traitItalic))
        }
    }

    private func importedFace(_ stem: String, weight: Int, italic: Bool) -> (CTFont, Bool)? {
        let all = importedFaces()
        guard let lead = all.first(where: { $0.stem == stem }) else { return nil }
        let family = all.filter { $0.family == lead.family }
        let italics = italic ? family.filter(\.italic) : []
        let pool = italics.isEmpty ? family.filter { !$0.italic } : italics
        let chosen = pool.isEmpty ? [lead] : pool
        let best = Self.nearestWeight(chosen.map(\.weight), weight)
        guard let face = chosen.first(where: { $0.weight == best }), let font = fileFont(face.url) else { return nil }
        return (font, !italics.isEmpty)
    }

    /// Copies a picked .ttf/.otf into the app; returns its font id.
    @discardableResult
    func importFont(from url: URL) throws -> String {
        let ext = url.pathExtension.lowercased()
        guard ext == "ttf" || ext == "otf" else { throw EngineError(.INVALID_PARAMS, reason: "fontType") }
        let data = try withSecurityScope(url) { try Data(contentsOf: url) }
        guard data.count <= 30 * 1024 * 1024 else { throw EngineError(.INVALID_PARAMS, reason: "fontTooLarge") }
        guard let provider = CGDataProvider(data: data as CFData), CGFont(provider) != nil else { throw EngineError(.INVALID_PARAMS, reason: "fontUnreadable") }
        let stem = url.deletingPathExtension().lastPathComponent.replacingOccurrences(of: "[^A-Za-z0-9._-]+", with: "-", options: .regularExpression)
        var target = Self.importedDirectory.appendingPathComponent(stem).appendingPathExtension(ext)
        var counter = 2
        while FileManager.default.fileExists(atPath: target.path), (try? Data(contentsOf: target)) != data {
            target = Self.importedDirectory.appendingPathComponent("\(stem)-\(counter)").appendingPathExtension(ext)
            counter += 1
        }
        try data.write(to: target, options: .atomic)
        invalidate()
        return "imported:\(target.deletingPathExtension().lastPathComponent)"
    }

    func removeImported(_ fontId: String) {
        let stem = fontId.hasPrefix("imported:") ? String(fontId.dropFirst(9)) : fontId
        for url in (try? FileManager.default.contentsOfDirectory(at: Self.importedDirectory, includingPropertiesForKeys: nil)) ?? [] where url.deletingPathExtension().lastPathComponent == stem {
            try? FileManager.default.removeItem(at: url)
        }
        invalidate()
    }

    // MARK: Catalogue

    /// Every font the pickers offer (`fonts.catalogue`): bundled, imported, library, then system families.
    func catalogue() -> [StudioFontChoice] {
        _ = revision
        var choices = [StudioFontChoice(id: Self.defaultId, name: "DejaVu Sans", source: .bundled)]
        var seenFamilies = Set<String>()
        for face in importedFaces() where !seenFamilies.contains(face.family) {
            seenFamilies.insert(face.family)
            let weights = Array(Set(importedFaces().filter { $0.family == face.family && !$0.italic }.map(\.weight))).sorted()
            choices.append(StudioFontChoice(id: "imported:\(face.stem)", name: face.family, source: .imported, weights: weights.isEmpty ? [400] : weights))
        }
        for family in library {
            let styles = Set(family.files.map(\.style))
            let weights = [(400, "regular"), (700, "bold")].filter { styles.contains($0.1) }.map(\.0)
            choices.append(StudioFontChoice(id: "library:\(family.id)", name: family.name, source: .library, installed: isInstalled(family), category: family.category, bytes: family.files.reduce(0) { $0 + $1.size }, weights: weights))
        }
        lock.lock()
        let index = buildSystemIndex()
        let labels = systemLabels
        lock.unlock()
        for (key, label) in labels {
            let weights = Array(Set((index[key] ?? []).filter { !$0.italic }.map(\.weight))).sorted()
            choices.append(StudioFontChoice(id: "system:\(key)", name: label, source: .system, weights: weights))
        }
        return choices
    }

    /// Human name for a font id (pickers, missing-font bar).
    func displayName(_ fontId: String?) -> String {
        guard let fontId else { return "DejaVu Sans" }
        if let family = libraryFamily(fontId) { return family.name }
        if fontId.hasPrefix("system:") {
            lock.lock()
            _ = buildSystemIndex()
            let label = systemLabels.first { $0.key == String(fontId.dropFirst(7)) }?.label
            lock.unlock()
            return label ?? String(fontId.dropFirst(7))
        }
        if fontId.hasPrefix("imported:") {
            let stem = String(fontId.dropFirst(9))
            return importedFaces().first { $0.stem == stem }?.family ?? stem
        }
        return "DejaVu Sans"
    }

    /// CSS weights available for a font id (weight picker; empty means regular/bold only).
    func weights(_ fontId: String?) -> [Int] {
        catalogue().first { $0.id == (fontId ?? Self.defaultId) }?.weights ?? [400, 700]
    }
}

/// Bundled Studio resources. XcodeGen flattens group folders into the bundle root, so names are unique.
enum StudioResources {
    static func url(_ name: String, _ ext: String) -> URL? {
        for bundle in [Bundle.main, Bundle(for: BundleToken.self)] {
            if let url = bundle.url(forResource: name, withExtension: ext) { return url }
            for sub in ["Studio", "Studio/fonts", "Studio/templates", "Resources/Studio", "Resources/Studio/fonts"] {
                if let url = bundle.url(forResource: name, withExtension: ext, subdirectory: sub) { return url }
            }
        }
        return nil
    }

    private final class BundleToken {}
}
