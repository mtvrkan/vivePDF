import PDFKit
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Result panel

/// Lists produced files with Open / Preview / Share / Save to Files, like the desktop result panel.
struct ResultPanel: View {
    let result: JobResult
    var tone: Tone = .organize
    @State private var preview: URL?
    @State private var exportURLs: [URL] = []
    @State private var exporting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(result.summary ?? t("tools.done"), systemImage: "checkmark.circle.fill")
                .font(.headline)
                .foregroundStyle(Palette.success)
            if !result.details.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(result.details.enumerated()), id: \.offset) { _, row in
                        LabeledContent(row.0, value: row.1).font(.callout)
                    }
                }
            }
            if let report = result.report, !report.isEmpty {
                ScrollView {
                    Text(report).font(.callout.monospaced()).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 260)
                .padding(10)
                .background(Palette.muted, in: RoundedRectangle(cornerRadius: 10))
            }
            ForEach(result.outputs, id: \.self) { url in
                OutputFileRow(url: url, preview: $preview)
            }
            if result.outputs.count > 1 {
                HStack {
                    ShareLink(items: result.outputs) { Label(t("ios.common.shareAll"), systemImage: "square.and.arrow.up") }
                    Spacer()
                    Button { exportURLs = result.outputs; exporting = true } label: {
                        Label(t("ios.common.saveToFiles"), systemImage: "folder")
                    }
                }
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .quickLookPreview($preview, in: result.outputs)
        .fileMover(isPresented: $exporting, files: exportURLs.compactMap(copyForExport)) { _ in }
    }
}

/// Makes a copy so moving it into Files keeps our own output in place.
func copyForExport(_ url: URL) -> URL? {
    let dest = Workspace.scratch().appendingPathComponent(url.lastPathComponent)
    return (try? FileManager.default.copyItem(at: url, to: dest)) != nil ? dest : nil
}

struct OutputFileRow: View {
    let url: URL
    @Binding var preview: URL?
    @Environment(AppModel.self) private var app
    @State private var exporting = false

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { info; Spacer(minLength: 8); actions }
            VStack(alignment: .leading, spacing: 10) { info; actions }
        }
        .padding(12)
        .background(Palette.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .fileMover(isPresented: $exporting, file: copyForExport(url)) { _ in }
    }

    private var info: some View {
        HStack(spacing: 10) {
            FileIcon(url: url)
            VStack(alignment: .leading, spacing: 2) {
                Text(url.lastPathComponent).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(Workspace.formatBytes(Workspace.fileSize(url))).font(.caption).foregroundStyle(Palette.mutedForeground)
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 8) {
            if url.pathExtension.lowercased() == "pdf" {
                Button { app.open(url) } label: { Label(t("tools.openResult"), systemImage: "book") }
                    .buttonStyle(.borderedProminent)
            }
            Button { preview = url } label: { Image(systemName: "eye") }
                .buttonStyle(.bordered)
                .accessibilityLabel(t("ios.common.preview"))
            ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }
                .buttonStyle(.bordered)
                .accessibilityLabel(t("ios.common.share"))
            Button { exporting = true } label: { Image(systemName: "folder") }
                .buttonStyle(.bordered)
                .accessibilityLabel(t("ios.common.saveToFiles"))
        }
        .controlSize(.small)
        .labelStyle(.titleAndIcon)
    }
}

struct FileIcon: View {
    let url: URL
    var size: CGFloat = 36
    var body: some View {
        let ext = url.pathExtension.lowercased()
        let (symbol, color): (String, Color) = switch ext {
        case "pdf": ("doc.richtext.fill", Palette.destructive)
        case "docx", "doc", "odt", "rtf": ("doc.text.fill", Palette.groupIndigo)
        case "xlsx", "xls", "csv", "ods": ("tablecells.fill", Palette.success)
        case "pptx", "ppt", "odp": ("rectangle.on.rectangle.angled.fill", Tone.toPdf.color)
        case "png", "jpg", "jpeg", "webp", "heic", "tif", "tiff", "gif", "bmp", "svg": ("photo.fill", Palette.groupCyan)
        case "md", "txt", "html", "htm", "json", "xml", "xfdf", "fdf": ("doc.plaintext.fill", Palette.groupGray)
        case "epub": ("book.fill", Palette.groupBrown)
        case "zip": ("doc.zipper", Palette.groupGray)
        case "p12", "pfx", "cer", "der", "pem": ("key.fill", Tone.security.color)
        default: url.hasDirectoryPath ? ("folder.fill", Palette.primary) : ("doc.fill", Palette.groupGray)
        }
        Image(systemName: symbol)
            .font(.system(size: size * 0.5))
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
    }
}

// MARK: - Source pickers

/// Picks one source PDF: from open tabs, recent files or the Files app. Shows name, pages and size.
struct SourcePicker: View {
    @Binding var url: URL?
    var types: [UTType] = [.pdf]
    var title: String? = nil
    @Environment(AppModel.self) private var app
    @State private var importing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title { Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.mutedForeground) }
            if let url {
                HStack(spacing: 12) {
                    FileIcon(url: url, size: 44)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(url.lastPathComponent).font(.headline).lineLimit(2)
                        Text(subtitle(url)).font(.caption).foregroundStyle(Palette.mutedForeground)
                    }
                    Spacer(minLength: 4)
                    menu { Text(t("tools.changeSource")) }
                }
            } else {
                menu {
                    Label(types == [.pdf] ? t("tools.chooseSource") : t("ios.common.chooseFile"), systemImage: "doc.badge.plus")
                        .frame(maxWidth: .infinity, minHeight: 64)
                }
                .buttonStyle(.bordered)
            }
        }
        .card()
        .fileImporter(isPresented: $importing, allowedContentTypes: types) { result in
            if case .success(let picked) = result { url = picked }
        }
        .onAppear {
            if url == nil, let first = app.inbox.first, types.contains(where: { Workspace.contentType(of: first)?.conforms(to: $0) ?? false }) {
                url = app.takeInbox().first
            } else if url == nil, types == [.pdf], let active = app.documents.active {
                url = active.url
            }
        }
    }

    private func menu<L: View>(@ViewBuilder label: () -> L) -> some View {
        Menu {
            Button { importing = true } label: { Label(t("ios.common.browseFiles"), systemImage: "folder") }
            if types.contains(.pdf) {
                let open = app.documents.documents
                if !open.isEmpty {
                    Section(t("ios.common.openDocuments")) {
                        ForEach(open) { doc in Button(doc.fileName) { url = doc.url } }
                    }
                }
                let recent = app.documents.recents.prefix(8).compactMap { r in r.resolve().map { (r, $0) } }
                if !recent.isEmpty {
                    Section(t("home.recent")) {
                        ForEach(recent, id: \.0.id) { item in Button(item.0.name) { url = item.1 } }
                    }
                }
            }
        } label: { label() }
    }

    private func subtitle(_ url: URL) -> String {
        var parts = [Workspace.formatBytes(withSecurityScope(url) { Workspace.fileSize(url) })]
        if url.pathExtension.lowercased() == "pdf", let count = withSecurityScope(url, { PDFDocument(url: url)?.pageCount }) {
            parts.insert(t("tools.checkReport.pages", ["count": count]), at: 0)
        }
        return parts.joined(separator: " · ")
    }
}

/// Picks several files (merge, batch, images to PDF…). Reorderable, removable.
struct MultiFilePicker: View {
    @Binding var urls: [URL]
    var types: [UTType] = [.pdf]
    var allowsPhotos = false
    var reorderable = true
    @Environment(AppModel.self) private var app
    @State private var importing = false
    @State private var photos = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(urls.enumerated()), id: \.element) { index, url in
                HStack(spacing: 10) {
                    Text("\(index + 1)").font(.caption.monospacedDigit()).foregroundStyle(Palette.mutedForeground).frame(width: 22)
                    FileIcon(url: url, size: 32)
                    Text(url.lastPathComponent).font(.subheadline).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 4)
                    if reorderable {
                        Button { move(index, by: -1) } label: { Image(systemName: "chevron.up") }
                            .disabled(index == 0)
                            .accessibilityLabel(t("ios.common.moveUp"))
                        Button { move(index, by: 1) } label: { Image(systemName: "chevron.down") }
                            .disabled(index == urls.count - 1)
                            .accessibilityLabel(t("ios.common.moveDown"))
                    }
                    Button(role: .destructive) { urls.remove(at: index) } label: { Image(systemName: "xmark.circle.fill") }
                        .accessibilityLabel(t("common.removeNamed", ["name": url.lastPathComponent]))
                }
                .buttonStyle(.borderless)
                .padding(.vertical, 4)
                if index < urls.count - 1 { Divider() }
            }
            ViewThatFits(in: .horizontal) {
                HStack { addButtons }
                VStack(alignment: .leading) { addButtons }
            }
        }
        .card()
        .fileImporter(isPresented: $importing, allowedContentTypes: types, allowsMultipleSelection: true) { result in
            if case .success(let picked) = result { urls += picked.filter { !urls.contains($0) } }
        }
        .sheet(isPresented: $photos) {
            PhotoPicker { picked in urls += picked }
        }
        .onAppear {
            let pending = app.inbox.filter { url in types.contains { Workspace.contentType(of: url)?.conforms(to: $0) ?? false } }
            if !pending.isEmpty { urls += app.takeInbox().filter(pending.contains) }
        }
    }

    @ViewBuilder private var addButtons: some View {
        Button { importing = true } label: { Label(t("ios.common.addFiles"), systemImage: "plus") }
            .buttonStyle(.bordered)
        if allowsPhotos {
            Button { photos = true } label: { Label(t("ios.common.addPhotos"), systemImage: "photo.on.rectangle") }
                .buttonStyle(.bordered)
        }
        if types.contains(.pdf), !app.documents.documents.isEmpty {
            Menu {
                ForEach(app.documents.documents) { doc in
                    Button(doc.fileName) { if !urls.contains(doc.url) { urls.append(doc.url) } }
                }
            } label: { Label(t("ios.common.openDocuments"), systemImage: "book") }
                .buttonStyle(.bordered)
        }
    }

    private func move(_ index: Int, by delta: Int) {
        let target = index + delta
        guard urls.indices.contains(target) else { return }
        urls.swapAt(index, target)
    }
}

// MARK: - Page range

/// Text field for "1-3, 5" style ranges with live validation against the page count.
struct PageRangeField: View {
    @Binding var text: String
    var pageCount: Int?
    var placeholder: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(placeholder ?? t("tools.allPages"), text: $text)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numbersAndPunctuation)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if let pageCount, !text.isEmpty, PageRanges.parse(text, pageCount: pageCount) == nil {
                Text(t("tools.outOfRange", ["min": 1, "max": pageCount]))
                    .font(.caption).foregroundStyle(Palette.destructive)
            }
        }
    }
}

// MARK: - Thumbnails

/// Lazily rendered page thumbnail (cached by PDFKit).
struct PageThumbnail: View {
    let page: PDFPage?
    var width: CGFloat = 120
    @State private var image: UIImage?
    @Environment(\.displayScale) private var scale

    var body: some View {
        let bounds = page?.bounds(for: .cropBox) ?? CGRect(x: 0, y: 0, width: 595, height: 842)
        let rotated = (page?.rotation ?? 0) % 180 != 0
        let aspect = rotated ? bounds.width / max(bounds.height, 1) : bounds.height / max(bounds.width, 1)
        ZStack {
            Color.white
            if let image { Image(uiImage: image).resizable().scaledToFit() } else { ProgressView() }
        }
        .frame(width: width, height: width * aspect)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Palette.border))
        .shadow(color: .black.opacity(0.08), radius: 4, y: 2)
        .task(id: page.map(ObjectIdentifier.init)) {
            guard let page else { return }
            let target = CGSize(width: width * scale, height: width * aspect * scale)
            image = await Task.detached(priority: .utility) { page.thumbnail(of: target, for: .cropBox) }.value
        }
    }
}

// MARK: - Empty state

struct EmptyStateView: View {
    let symbol: String
    let title: String
    var message: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol).font(.system(size: 44, weight: .light)).foregroundStyle(Palette.primary)
            Text(title).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
            if let message { Text(message).font(.callout).foregroundStyle(Palette.mutedForeground).multilineTextAlignment(.center) }
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(.borderedProminent).padding(.top, 4)
            }
        }
        .padding(32)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
