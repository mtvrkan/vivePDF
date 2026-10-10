import Foundation

/// The twenty tool pages (`toolNavigation` in `apps/desktop/src/app/navigation.ts`).
enum ToolID: String, CaseIterable, Identifiable, Codable, Hashable {
    case merge, split, compress, convert, create, ocr, scan, edit, codes, omr
    case security, sign, forms, compare, access, preflight, pdfa, rename, batch, watch
    /// `/tools/pages?tab=rotate|delete|extract` — quick page tools outside the organizer.
    case pageTools

    var id: String { rawValue }

    var labelKey: String { self == .pageTools ? "tools.grid.organizer" : "nav.\(rawValue)" }

    var tone: Tone {
        switch self {
        case .merge, .split, .rename, .pageTools: .organize
        case .compress, .ocr, .scan, .compare, .access, .preflight, .pdfa, .batch, .watch: .improve
        case .convert: .fromPdf
        case .create: .toPdf
        case .edit, .codes, .omr, .forms: .edit
        case .security, .sign: .security
        }
    }

    var symbol: String {
        switch self {
        case .merge: "arrow.triangle.merge"
        case .split: "scissors"
        case .compress: "arrow.down.right.and.arrow.up.left"
        case .convert: "arrow.left.arrow.right"
        case .create: "doc.badge.plus"
        case .ocr: "text.viewfinder"
        case .scan: "doc.viewfinder"
        case .edit: "pencil.line"
        case .codes: "qrcode"
        case .omr: "checklist.checked"
        case .security: "checkmark.shield"
        case .sign: "signature"
        case .forms: "list.clipboard"
        case .compare: "arrow.left.and.right.square"
        case .access: "accessibility"
        case .preflight: "printer"
        case .pdfa: "archivebox"
        case .rename: "tag"
        case .batch: "square.stack.3d.up"
        case .watch: "folder.badge.gearshape"
        case .pageTools: "rectangle.grid.2x2"
        }
    }

    /// Tools shown in the sidebar / tools tab (page tools are reached through shortcuts).
    static var navigable: [ToolID] { allCases.filter { $0 != .pageTools } }
}

/// Every destination in the app. `tab` selects a sub-page (`?tab=` / `?mode=` on desktop).
enum Route: Hashable, Codable {
    case home
    case viewer
    case pages
    case studio(cv: Bool = false)
    case search
    case settings(section: String? = nil)
    case about
    case tool(ToolID, tab: String? = nil)

    var labelKey: String {
        switch self {
        case .home: "nav.home"
        case .viewer: "nav.viewer"
        case .pages: "nav.pages"
        case .studio: "nav.studio"
        case .search: "nav.search"
        case .settings: "nav.settings"
        case .about: "nav.about"
        case .tool(let id, _): id.labelKey
        }
    }

    var symbol: String {
        switch self {
        case .home: "house"
        case .viewer: "book"
        case .pages: "square.grid.2x2"
        case .studio: "paintpalette"
        case .search: "magnifyingglass"
        case .settings: "gearshape"
        case .about: "info.circle"
        case .tool(let id, _): id.symbol
        }
    }

    /// Sidebar/tab identity: tools compare by tool, ignoring the tab.
    var section: String {
        switch self {
        case .home: "home"
        case .viewer: "viewer"
        case .pages: "pages"
        case .studio: "studio"
        case .search: "search"
        case .settings: "settings"
        case .about: "about"
        case .tool(let id, _): "tool.\(id.rawValue)"
        }
    }

    /// Parses desktop-style routes such as `/tools/convert?mode=docx` (used by the catalog and deep links).
    init?(path: String) {
        let parts = path.split(separator: "?", maxSplits: 1).map(String.init)
        let pathPart = parts[0]
        var query: [String: String] = [:]
        if parts.count > 1 {
            for pair in parts[1].split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
                if kv.count == 2 { query[kv[0]] = kv[1] }
            }
        }
        switch pathPart {
        case "/", "": self = .home
        case "/viewer": self = .viewer
        case "/pages": self = .pages
        case "/studio": self = .studio(cv: query["cv"] == "1")
        case "/search": self = .search
        case "/settings": self = .settings(section: query["section"])
        case "/about": self = .about
        default:
            guard pathPart.hasPrefix("/tools/") else { return nil }
            let name = String(pathPart.dropFirst("/tools/".count))
            let tool: ToolID? = name == "pages" ? .pageTools : ToolID(rawValue: name)
            guard let tool else { return nil }
            self = .tool(tool, tab: query["tab"] ?? query["mode"])
        }
    }
}

/// A catalog entry (`toolShortcuts` on desktop): one specific task, possibly a tab inside a tool page.
struct ToolShortcut: Identifiable, Hashable {
    let id: String
    let labelKey: String
    let route: Route
    let group: Tone
    let symbol: String
    let keywords: String
    var descriptionKey: String { "tools.grid.descriptions.\(id)" }

    var label: String { t(labelKey) }
    var detail: String { L10n.shared.has(descriptionKey) ? t(descriptionKey) : "" }

    func matches(_ query: String) -> Bool {
        let needle = query.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return true }
        let haystack = [label, detail, keywords, id].joined(separator: " ").folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        return needle.split(separator: " ").allSatisfy { haystack.contains($0) }
    }
}

enum ToolCatalog {
    private static func s(_ id: String, _ labelKey: String, _ path: String, _ group: Tone, _ symbol: String, _ keywords: String = "") -> ToolShortcut {
        ToolShortcut(id: id, labelKey: labelKey, route: Route(path: path) ?? .home, group: group, symbol: symbol, keywords: keywords)
    }

    static let groups: [Tone] = [.organize, .improve, .toPdf, .fromPdf, .edit, .security]

    static let homeQuickActionIds = ["merge", "split", "compress", "images-to-pdf", "docx", "pages"]

    static let shortcuts: [ToolShortcut] = [
        s("merge", "nav.merge", "/tools/merge", .organize, "arrow.triangle.merge", "combine join"),
        s("split", "nav.split", "/tools/split", .organize, "scissors", "divide"),
        s("pages", "tools.grid.organizer", "/pages", .organize, "square.grid.2x2", "reorder sort drag"),
        s("rotate", "tools.grid.rotate", "/tools/pages?tab=rotate", .organize, "rotate.right", "turn"),
        s("delete", "tools.grid.deletePages", "/tools/pages?tab=delete", .organize, "trash", "remove"),
        s("extract", "tools.grid.extractPages", "/tools/pages?tab=extract", .organize, "doc.on.doc", "export"),
        s("compress", "nav.compress", "/tools/compress", .improve, "arrow.down.right.and.arrow.up.left", "shrink reduce size"),
        s("repair", "tools.edit.repair.title", "/tools/edit?tab=repair", .improve, "wrench.adjustable", "fix corrupt"),
        s("ocr", "nav.ocr", "/tools/ocr", .improve, "text.viewfinder", "scan text recognize"),
        s("compare", "nav.compare", "/tools/compare", .improve, "arrow.left.and.right.square", "diff"),
        s("access", "nav.access", "/tools/access", .improve, "accessibility", "accessibility pdf/ua alt text tags language title erisilebilirlik"),
        s("preflight", "nav.preflight", "/tools/preflight", .improve, "printer", "preflight print check fonts dpi bleed baski kontrol matbaa"),
        s("pdfa", "nav.pdfa", "/tools/pdfa", .improve, "archivebox", "pdf/a pdfa archive archival long term validate conformance arsiv uzun sureli dogrula"),
        s("batch", "nav.batch", "/tools/batch", .improve, "square.stack.3d.up", "batch bulk multiple toplu"),
        s("watch", "nav.watch", "/tools/watch", .improve, "folder.badge.gearshape", "watched folder automation izle klasor"),
        s("scanner", "tools.scan.scanner.title", "/tools/scan?tab=scanner", .improve, "scanner", "scanner camera document acquire tarayici tara"),
        s("scan-enhance", "tools.scan.enhance.title", "/tools/scan?tab=enhance", .improve, "wand.and.stars", "scan deskew despeckle whiten clean tarama duzelt"),
        s("scan-split", "tools.scan.split.title", "/tools/scan?tab=split", .organize, "rectangle.split.3x1", "scan split separator qr blank batch tarama bol"),
        s("photo", "tools.scan.photo.title", "/tools/scan?tab=photo", .toPdf, "camera", "photo phone camera document scan perspective fotograf telefon belge"),
        s("rename", "nav.rename", "/tools/rename", .organize, "tag", "rename invoice date title bulk yeniden adlandir fatura tarih"),
        s("qr-add", "tools.codes.add.title", "/tools/codes?tab=add", .edit, "qrcode", "qr code stamp link karekod ekle"),
        s("barcode-read", "tools.codes.read.title", "/tools/codes?tab=read", .edit, "barcode.viewfinder", "barcode qr read scan list barkod oku"),
        s("omr-sheet", "tools.omr.sheet.title", "/tools/omr?tab=sheet", .edit, "checklist", "omr optical answer sheet bubble exam test optik form cevap kagidi sinav"),
        s("omr-grade", "tools.omr.grade.title", "/tools/omr?tab=grade", .edit, "checklist.checked", "omr optical grade score read answer key exam optik okut puanla cevap anahtari sinav"),
        s("create-document", "nav.create", "/tools/create", .toPdf, "doc.badge.plus", "create new document text txt markdown template report letter petition minutes notes booklet olustur yeni belge metin sablon rapor mektup dilekce tutanak ders notu kitapcik odev"),
        s("create-bulk", "tools.create.bulk.title", "/tools/create?tab=bulk", .toPdf, "rosette", "bulk mail merge csv excel table certificate invitation badge name tag toplu sertifika davetiye yaka karti tablo"),
        s("create-paper", "tools.create.paper.title", "/tools/create?tab=paper", .toPdf, "note.text", "paper lined ruled graph grid dot notebook music staff handwriting printable kagit cizgili kareli noktali defter nota"),
        s("create-book", "tools.create.book.title", "/tools/create?tab=book", .toPdf, "book.closed", "book markdown chapters ebook table of contents novel thesis manual kitap bolum icindekiler roman tez kilavuz"),
        s("create-cv", "studio.cv.title", "/studio?cv=1", .toPdf, "person.text.rectangle", "cv resume curriculum vitae job application photo experience education ozgecmis is basvurusu deneyim egitim"),
        s("images-to-pdf", "tools.convert.modes.images-to-pdf", "/tools/convert?mode=images-to-pdf", .toPdf, "photo.on.rectangle", "jpg png folder photos"),
        s("file-to-pdf", "tools.convert.modes.file-to-pdf", "/tools/convert?mode=file-to-pdf", .toPdf, "doc.text", "word excel powerpoint office html markdown"),
        s("svg-to-pdf", "tools.convert.modes.svg-to-pdf", "/tools/convert?mode=svg-to-pdf", .toPdf, "scribble.variable", "svg vector drawing inkscape illustrator figma logo icon vektor cizim"),
        s("url-to-pdf", "tools.convert.modes.url-to-pdf", "/tools/convert?mode=url-to-pdf", .toPdf, "globe", "url web page website link site sayfa adres kaydet"),
        s("docx", "tools.convert.modes.docx", "/tools/convert?mode=docx", .fromPdf, "doc.richtext", "word"),
        s("xlsx", "tools.convert.modes.xlsx", "/tools/convert?mode=xlsx", .fromPdf, "tablecells", "excel table"),
        s("pptx", "tools.convert.modes.pptx", "/tools/convert?mode=pptx", .fromPdf, "rectangle.on.rectangle", "powerpoint"),
        s("images", "tools.convert.modes.images", "/tools/convert?mode=images", .fromPdf, "photo", "jpg png webp"),
        s("text", "tools.convert.modes.text", "/tools/convert?mode=text", .fromPdf, "textformat", "txt"),
        s("markdown", "tools.convert.modes.markdown", "/tools/convert?mode=markdown", .fromPdf, "number", "md"),
        s("html", "tools.convert.modes.html", "/tools/convert?mode=html", .fromPdf, "chevron.left.forwardslash.chevron.right", "web"),
        s("epub", "tools.convert.modes.epub", "/tools/convert?mode=epub", .fromPdf, "book", "ebook epub kindle kobo reflow e-kitap oku"),
        s("number", "tools.edit.number.title", "/tools/edit?tab=number", .edit, "list.number", "page numbers"),
        s("headerFooter", "tools.edit.headerFooter.title", "/tools/edit?tab=headerFooter", .edit, "rectangle.topthird.inset.filled", "header footer"),
        s("letterhead", "tools.edit.letterhead.title", "/tools/edit?tab=letterhead", .edit, "doc.richtext.fill", "letterhead template stationery antetli kagit sablon"),
        s("cover", "tools.edit.cover.title", "/tools/edit?tab=cover", .edit, "book.pages", "cover page title page front report thesis kapak sayfasi on kapak rapor tez odev"),
        s("findReplace", "tools.edit.findReplace.title", "/tools/edit?tab=findReplace", .edit, "arrow.2.squarepath", "find replace text search bul degistir"),
        s("watermark", "tools.security.watermark.title", "/tools/security?tab=watermark", .edit, "drop", "stamp logo watermark filigran"),
        s("removeWatermark", "tools.security.removeWatermark.title", "/tools/security?tab=removeWatermark", .edit, "eraser", "clean stamp logo unwatermark"),
        s("stamp", "tools.security.stamp.title", "/tools/security?tab=stamp", .edit, "seal", "stamp approved draft confidential damga onaylandi taslak gizli"),
        s("crop", "tools.edit.crop.title", "/tools/edit?tab=crop", .edit, "crop", "margins"),
        s("resize", "tools.edit.resize.title", "/tools/edit?tab=resize", .edit, "arrow.up.left.and.down.right.magnifyingglass", "a4 letter scale"),
        s("flatten", "tools.edit.flatten.title", "/tools/edit?tab=flatten", .edit, "square.3.layers.3d.down.right", "bake"),
        s("impose", "tools.edit.impose.title", "/tools/edit?tab=impose", .edit, "rectangle.grid.2x2", "booklet n-up nup imposition"),
        s("poster", "tools.edit.poster.title", "/tools/edit?tab=poster", .edit, "square.grid.3x3", "poster tile tiling banner enlarge large print doseme buyut afis"),
        s("bookmarks", "tools.edit.bookmarks.title", "/tools/edit?tab=bookmarks", .edit, "bookmark", "toc outline table of contents"),
        s("autolink", "tools.edit.autolink.title", "/tools/edit?tab=autolink", .edit, "link", "auto link url email hyperlink clickable baglanti otomatik tiklanabilir eposta"),
        s("textedit", "tools.edit.textedit.title", "/tools/edit?tab=textedit", .edit, "character.cursor.ibeam", "edit text content experimental"),
        s("forms", "tools.forms.tabs.fill", "/tools/forms?tab=fill", .edit, "list.clipboard", "fill acroform forms form doldur"),
        s("form-merge", "tools.forms.tabs.merge", "/tools/forms?tab=merge", .edit, "list.clipboard", "mail merge csv excel batch fill toplu doldur"),
        s("form-export", "tools.forms.tabs.export", "/tools/forms?tab=export", .edit, "list.clipboard", "export forms excel csv table toplu form"),
        s("form-detect", "tools.forms.tabs.detect", "/tools/forms?tab=detect", .edit, "list.clipboard", "detect fields lines boxes alan algila"),
        s("annotate", "viewer.annotate", "/viewer", .edit, "highlighter", "highlight draw note"),
        s("encrypt", "tools.security.encrypt.title", "/tools/security?tab=encrypt", .security, "lock", "password protect"),
        s("decrypt", "tools.security.decrypt.title", "/tools/security?tab=decrypt", .security, "lock.open", "remove password unlock"),
        s("seal", "tools.security.certificate.title", "/tools/security?tab=certificate", .security, "key.horizontal", "certificate recipient public key pubsec seal sertifika muhurle alici"),
        s("unseal", "tools.security.decryptCertificate.title", "/tools/security?tab=decryptCertificate", .security, "lock.open.display", "certificate private key p12 pfx open sealed sertifika ac muhur"),
        s("redact", "tools.edit.redact.title", "/tools/edit?tab=redact", .security, "eye.slash", "black out remove"),
        s("privacy", "tools.security.privacy.title", "/tools/security?tab=privacy", .security, "exclamationmark.shield", "privacy sanitize metadata javascript share check gizlilik temizle"),
        s("sign", "tools.sign.sign.title", "/tools/sign?tab=sign", .security, "signature", "signature pades"),
        s("verify", "tools.sign.verify.title", "/tools/sign?tab=verify", .security, "checkmark.seal", "validate signature"),
        s("certificate", "tools.sign.certificate.title", "/tools/sign?tab=certificate", .security, "key", "p12 pfx"),
        s("certificate-export", "tools.sign.export.title", "/tools/sign?tab=export", .security, "square.and.arrow.up", "cer der public certificate export p12 pfx sertifika disa aktar acik anahtar"),
    ]

    static func shortcut(_ id: String) -> ToolShortcut? { shortcuts.first { $0.id == id } }

    static func shortcuts(in group: Tone) -> [ToolShortcut] { shortcuts.filter { $0.group == group } }
}
