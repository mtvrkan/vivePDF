import PDFKit
import SwiftUI

/// "Make the text selectable?" (desktop `MakeSearchableDialog`): reads scanned pages with Vision and
/// writes an invisible text layer onto them, rewriting the file on disk.
struct MakeSearchableSheet: View {
    let session: ViewerSession
    /// Page to read (zero-based), or nil for the whole document.
    let pageIndex: Int?

    @Environment(\.dismiss) private var dismiss
    @AppStorage("vivepdf.viewer.ocrLanguages") private var storedLanguages = ""
    @State private var supported: [String] = []
    @State private var task: Task<Void, Never>?
    @State private var fraction: Double?
    @State private var running = false

    init(session: ViewerSession, pageIndex: Int?) {
        self.session = session
        self.pageIndex = pageIndex
    }

    private var languages: [String] {
        let stored = storedLanguages.split(separator: ",").map(String.init).filter { supported.isEmpty || supported.contains($0) }
        return stored.isEmpty ? TextLayerOCR.defaultLanguages(for: L10n.shared.locale, supported: supported.isEmpty ? TextLayerOCR.supportedLanguages() : supported) : stored
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(pageIndex.map { t("viewer.searchable.bodyPage", ["page": $0 + 1, "name": session.document.fileName]) }
                         ?? t("viewer.searchable.bodyDocument", ["name": session.document.fileName]))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(t("viewer.searchable.hint")).font(.footnote).foregroundStyle(Palette.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                    if session.document.isDirty {
                        Label(t("viewer.searchable.saveFirst"), systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(Palette.warning)
                    }
                }
                Section {
                    NavigationLink {
                        languagePicker
                    } label: {
                        LabeledContent(t("tools.ocr.languages"), value: languages.map(displayName).joined(separator: ", "))
                    }
                    .disabled(running)
                }
                if running {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            ProgressView(value: fraction) { Text(t("tools.working")) }
                            Button(t("common.cancel"), role: .cancel) { task?.cancel() }
                                .buttonStyle(.bordered)
                        }
                    }
                }
            }
            .navigationTitle(t("viewer.searchable.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) {
                        if running { task?.cancel() } else { dismiss() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("viewer.searchable.run")) { run() }
                        .disabled(running || session.document.isDirty)
                }
            }
            .task { supported = TextLayerOCR.supportedLanguages() }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(running)
    }

    private var languagePicker: some View {
        List(supported, id: \.self) { code in
            let selected = languages.contains(code)
            Button {
                var next = languages
                if selected { next.removeAll { $0 == code } } else { next.append(code) }
                if !next.isEmpty { storedLanguages = next.joined(separator: ",") }
            } label: {
                HStack {
                    Text(displayName(code)).foregroundStyle(Palette.foreground)
                    Spacer()
                    if selected { Image(systemName: "checkmark").foregroundStyle(Palette.primary) }
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .accessibilityAddTraits(selected ? .isSelected : [])
        }
        .navigationTitle(t("tools.ocr.languages"))
    }

    private func displayName(_ code: String) -> String {
        L10n.shared.locale.foundationLocale.localizedString(forIdentifier: code) ?? code
    }

    private func run() {
        guard !session.document.isDirty else {
            session.show(ViewerToast(text: t("viewer.searchable.saveFirst"), symbol: "exclamationmark.triangle.fill", isError: true))
            return
        }
        let source = session.document.url
        let password = session.document.password
        let pages = pageIndex.map { [$0] }
        let chosen = languages
        let page = session.currentPageIndex
        running = true
        fraction = nil
        task = Task { @MainActor in
            defer { running = false }
            do {
                let result = try await TextLayerOCR.makeSearchable(source: source, password: password, pages: pages, languages: chosen) { value, _ in
                    Task { @MainActor in fraction = value }
                }
                try Task.checkCancellation()
                if result.pagesDone == 0 {
                    session.show(ViewerToast(text: t("viewer.searchable.nothingToDo"), symbol: "info.circle.fill"))
                } else {
                    try session.document.replaceFile(with: result.url)
                    session.refresh()
                    session.restorePosition(page)
                    session.show(ViewerToast(text: t("viewer.searchable.done", ["count": result.pagesDone]), symbol: "text.viewfinder"))
                }
                dismiss()
            } catch is CancellationError {
                session.show(ViewerToast(text: t("viewer.searchable.cancelled"), symbol: "xmark.circle.fill"))
                dismiss()
            } catch {
                session.showError(error)
                dismiss()
            }
        }
    }
}
