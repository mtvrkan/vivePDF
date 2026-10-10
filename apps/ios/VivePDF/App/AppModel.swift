import Foundation
import Observation
import SwiftUI

/// App-wide state shared by every scene: navigation, open documents and appearance.
/// Feature settings live in `@AppStorage("vivepdf.<feature>.<name>")` next to the views that use them.
@Observable
final class AppModel {
    static let shared = AppModel()

    var route: Route = .home
    /// Navigation history for the back/forward affordances on iPad.
    var history: [Route] = []
    let documents = DocumentStore()
    let l10n = L10n.shared

    var theme: ThemeMode {
        didSet { UserDefaults.standard.set(theme.rawValue, forKey: "vivepdf.theme") }
    }

    /// Author name written into annotations, comments and signatures.
    var authorName: String {
        didSet { UserDefaults.standard.set(authorName, forKey: "vivepdf.author") }
    }

    /// Shows the global search / command palette.
    var showCommandPalette = false
    /// Presents the system file importer for "Open PDF".
    var showOpenPicker = false
    /// Files handed to the app before a tool could take them (share sheet, "Open in", drag & drop).
    var inbox: [URL] = []
    /// Text the viewer should search for in the active document (folder-search hits, palette "Search in document").
    /// The viewer runs the search and sets it back to nil.
    var viewerSearchRequest: String?

    private init() {
        theme = UserDefaults.standard.string(forKey: "vivepdf.theme").flatMap(ThemeMode.init(rawValue:)) ?? .system
        authorName = UserDefaults.standard.string(forKey: "vivepdf.author") ?? UIDevice.current.name
    }

    func navigate(_ route: Route) {
        guard route != self.route else { return }
        history.append(self.route)
        if history.count > 50 { history.removeFirst() }
        self.route = route
    }

    func goBack() {
        guard let previous = history.popLast() else { return }
        route = previous
    }

    /// Opens a PDF in the viewer, or routes other file types to the right converter.
    func open(_ url: URL) {
        let ext = url.pathExtension.lowercased()
        if ext == "pdf" || ext.isEmpty {
            if documents.open(url) != nil { navigate(.viewer) }
        } else if ext == "vivestudio" {
            inbox = [url]
            navigate(.studio())
        } else if ["jpg", "jpeg", "png", "heic", "heif", "webp", "tif", "tiff", "gif", "bmp"].contains(ext) {
            inbox = [url]
            navigate(.tool(.convert, tab: "images-to-pdf"))
        } else if ext == "svg" {
            inbox = [url]
            navigate(.tool(.convert, tab: "svg-to-pdf"))
        } else {
            inbox = [url]
            navigate(.tool(.convert, tab: "file-to-pdf"))
        }
    }

    /// Takes the pending inbox files (a tool calls this on appear to pre-fill its sources).
    func takeInbox() -> [URL] {
        defer { inbox = [] }
        return inbox
    }
}
