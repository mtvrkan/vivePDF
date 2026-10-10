import PDFKit
import SwiftUI
import UniformTypeIdentifiers

/// Small uppercase label above a section, like the desktop "eyebrow".
struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.caption2.weight(.semibold))
            .tracking(0.8)
            .foregroundStyle(Palette.mutedForeground)
            .lineLimit(2)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Rounded tone tile behind an SF Symbol (`tone-tile` on desktop).
struct ToneTile: View {
    let symbol: String
    var tone: Color = Palette.primary
    var soft: Color = Palette.accent
    var size: CGFloat = 40
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(tone)
            .frame(width: size, height: size)
            .background(soft, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityHidden(true)
    }
}

extension HomeSize {
    var padding: CGFloat { pick(14, 20, 28) }
}

extension GroupColor {
    var color: Color {
        switch self {
        case .blue: Tone.organize.color
        case .green: Tone.improve.color
        case .orange: Tone.toPdf.color
        case .purple: Tone.fromPdf.color
        case .amber: Tone.edit.color
        case .red: Tone.security.color
        case .teal: Palette.groupTeal
        case .cyan: Palette.groupCyan
        case .indigo: Palette.groupIndigo
        case .pink: Palette.groupPink
        case .lime: Palette.groupLime
        case .brown: Palette.groupBrown
        case .gray: Palette.groupGray
        }
    }
}

/// Thumbnail of a PDF's first page, rendered off the main thread and cached.
struct FileThumbnail: View {
    let url: URL?
    var aspect: CGFloat = 0.75
    @State private var image: UIImage?
    @State private var failed = false
    @Environment(\.displayScale) private var scale

    private static let cache = NSCache<NSString, UIImage>()

    var body: some View {
        Color.clear
            .aspectRatio(1 / aspect, contentMode: .fit)
            .overlay {
                ZStack {
                    Palette.secondary.opacity(0.5)
                    if let image {
                        Image(uiImage: image).resizable().scaledToFill()
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    } else if failed || url == nil {
                        Image(systemName: url == nil ? "exclamationmark.triangle" : "doc.text")
                            .font(.title)
                            .foregroundStyle(url == nil ? Palette.warning : Palette.mutedForeground)
                    } else {
                        ProgressView()
                    }
                }
            }
            .clipped()
            .task(id: url) { await load() }
            .accessibilityHidden(true)
    }

    private func load() async {
        guard let url else { return }
        let key = url.path as NSString
        if let cached = Self.cache.object(forKey: key) { image = cached; return }
        let target = CGSize(width: 320 * scale / 2, height: 320 * scale / 2 * aspect * 1.6)
        let rendered = await Task.detached(priority: .utility) { () -> UIImage? in
            withSecurityScope(url) {
                guard let document = PDFDocument(url: url), !document.isLocked, let page = document.page(at: 0) else { return nil }
                return page.thumbnail(of: target, for: .cropBox)
            }
        }.value
        if let rendered {
            Self.cache.setObject(rendered, forKey: key)
            image = rendered
        } else {
            failed = true
        }
    }
}

enum HomeActions {
    /// Opens the Files app at the folder holding `url` (works for the app's own folder and iCloud Drive).
    static func revealInFiles(_ url: URL) {
        let folder = url.hasDirectoryPath ? url : url.deletingLastPathComponent()
        guard let encoded = folder.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let target = URL(string: "shareddocuments://\(encoded)") else { return }
        UIApplication.shared.open(target)
    }

    /// Opens a PDF and moves the viewer to `page` (1-based).
    @MainActor
    static func open(_ url: URL, page: Int?, app: AppModel) {
        guard url.pathExtension.lowercased() == "pdf" else { app.open(url); return }
        if let doc = app.documents.open(url) {
            if let page { doc.currentPageIndex = max(0, min(doc.pageCount - 1, page - 1)) }
            app.navigate(.viewer)
        }
    }

    /// "From clipboard": PDFs and files open directly, pictures go to Images → PDF, text to Create PDF.
    @MainActor
    static func openClipboard(app: AppModel) -> Bool {
        let board = UIPasteboard.general
        let folder = Workspace.scratch()
        if let data = board.data(forPasteboardType: UTType.pdf.identifier) {
            let url = folder.appendingPathComponent("\(t("clipboard.fileName")).pdf")
            if (try? data.write(to: url)) != nil { app.open(url); return true }
        }
        if let urls = board.urls?.filter(\.isFileURL), !urls.isEmpty {
            urls.forEach(app.open)
            return true
        }
        if board.hasImages, let images = board.images, !images.isEmpty {
            var urls: [URL] = []
            for (index, image) in images.enumerated() {
                let url = folder.appendingPathComponent(String(format: "%@-%02d.png", t("clipboard.fileName"), index + 1))
                if let data = image.pngData(), (try? data.write(to: url)) != nil { urls.append(url) }
            }
            guard !urls.isEmpty else { return false }
            app.inbox = urls
            app.navigate(.tool(.convert, tab: "images-to-pdf"))
            return true
        }
        if let text = board.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let url = folder.appendingPathComponent("\(t("clipboard.fileName")).txt")
            if (try? text.write(to: url, atomically: true, encoding: .utf8)) != nil {
                app.inbox = [url]
                app.navigate(.tool(.create))
                return true
            }
        }
        return false
    }

    /// Finds the tool a history entry came from (entries store the localized tool label).
    static func tool(forLabel label: String) -> ToolID? {
        ToolID.allCases.first { t($0.labelKey) == label }
    }
}

/// Uniform section card: eyebrow + trailing accessory, then content.
struct HomeCard<Accessory: View, Content: View>: View {
    let title: String
    var size: HomeSize = .medium
    var tinted = false
    @ViewBuilder var accessory: () -> Accessory
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: size.pick(10, 14, 18)) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    Eyebrow(text: title)
                    Spacer(minLength: 8)
                    accessory()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow(text: title)
                    accessory()
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: size.padding)
        .overlay {
            if tinted {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(LinearGradient(colors: [Palette.primary.opacity(0.08), .clear], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .allowsHitTesting(false)
            }
        }
    }
}

extension HomeCard where Accessory == EmptyView {
    init(title: String, size: HomeSize = .medium, tinted: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, size: size, tinted: tinted, accessory: { EmptyView() }, content: content)
    }
}

/// Compact text field with a magnifier and clear button.
struct InlineSearchField: View {
    let placeholder: String
    @Binding var text: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.mutedForeground).font(.footnote)
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(t("common.close"))
            }
        }
        .font(.subheadline)
        .padding(.horizontal, 10)
        .frame(minHeight: 36)
        .background(Palette.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// Monogram-free key cap for keyboard shortcuts (iPad hardware keyboards).
struct KeyCap: View {
    let keys: String
    var body: some View {
        Text(L10n.shortcutLabel(keys))
            .font(.caption.monospaced())
            .foregroundStyle(Palette.mutedForeground)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Palette.card.opacity(0.7), in: RoundedRectangle(cornerRadius: 5))
            .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Palette.border))
    }
}
