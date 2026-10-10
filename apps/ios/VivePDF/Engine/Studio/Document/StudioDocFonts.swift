import CoreText
import Foundation

/// `@font-face` rules for Studio font ids, used by the document editor and the PDF layout (WebKit).
/// Font files travel as data URLs so WebKit can read bundled, downloaded and imported fonts alike;
/// installed iOS fonts are referenced with `local()`.
enum StudioDocFonts {
    private static let lock = NSLock()
    private static var fileIndex: [String: URL]?
    private static var encoded: [String: String] = [:]
    private static var indexedRevision = -1

    /// Stable CSS family name for a font id (`fontFamilyFor`).
    static func family(_ fontId: String) -> String {
        var hash: Int32 = 0
        for unit in fontId.utf16 { hash = hash &* 31 &+ Int32(bitPattern: UInt32(unit)) }
        return "vp-doc-\(String(UInt32(bitPattern: hash), radix: 36))"
    }

    static func stack(_ fontId: String?) -> String {
        guard let fontId else { return "sans-serif" }
        return "\"\(family(fontId))\", sans-serif"
    }

    private static func index() -> [String: URL] {
        let revision = StudioFonts.shared.revision
        if let fileIndex, indexedRevision == revision { return fileIndex }
        var map: [String: URL] = [:]
        var candidates: [URL] = []
        for name in ["Studio-DejaVuSans", "Studio-DejaVuSans-Bold"] { if let url = StudioResources.url(name, "ttf") { candidates.append(url) } }
        for folder in [StudioFonts.libraryDirectory, StudioFonts.importedDirectory] {
            candidates += ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []).filter { ["ttf", "otf"].contains($0.pathExtension.lowercased()) }
        }
        for url in candidates {
            guard let provider = CGDataProvider(url: url as CFURL), let font = CGFont(provider), let name = font.postScriptName as String? else { continue }
            map[name] = url
        }
        fileIndex = map
        indexedRevision = revision
        return map
    }

    private static func source(for font: CTFont) -> String? {
        let name = CTFontCopyPostScriptName(font) as String
        lock.lock()
        defer { lock.unlock() }
        if let url = index()[name] {
            if let hit = encoded[url.path] { return hit }
            guard let data = try? Data(contentsOf: url) else { return nil }
            let format = url.pathExtension.lowercased() == "otf" ? "opentype" : "truetype"
            let mime = url.pathExtension.lowercased() == "otf" ? "font/otf" : "font/ttf"
            let value = "url(data:\(mime);base64,\(data.base64EncodedString())) format(\"\(format)\")"
            encoded[url.path] = value
            return value
        }
        return "local(\"\(name)\")"
    }

    /// Four `@font-face` rules (regular, bold, italic, bold italic) for `fontId` under `cssFamily`.
    /// Faked italics are left out so WebKit slants the upright face, like the desktop editor.
    static func rules(_ fontId: String, cssFamily: String) -> String {
        var rules = ""
        for (bold, italic) in [(false, false), (true, false), (false, true), (true, true)] {
            let face = StudioFonts.shared.face(fontId, weight: bold ? 700 : 400, italic: italic)
            if italic && face.oblique { continue }
            guard let src = source(for: face.font) else { continue }
            rules += "@font-face{font-family:\"\(cssFamily)\";src:\(src);font-weight:\(bold ? "bold" : "normal");font-style:\(italic ? "italic" : "normal");}"
        }
        return rules
    }

    /// Every font id a node tree uses through `textStyle` marks.
    static func fontIds(in node: StudioDocNode) -> [String] {
        var found: [String] = []
        func visit(_ n: StudioDocNode) {
            for mark in n.marks ?? [] where mark.type == "textStyle" {
                if let id = mark.string("fontId"), !id.isEmpty, !found.contains(id) { found.append(id) }
            }
            (n.content ?? []).forEach(visit)
        }
        visit(node)
        return found
    }
}
