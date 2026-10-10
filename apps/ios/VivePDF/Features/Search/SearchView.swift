import SwiftUI
import UniformTypeIdentifiers

/// Folder full-text search (`features/search/SearchPage.tsx`): pick folders in Files, index their PDFs, then
/// search every page and jump straight to a hit. Results sit next to the folder list on wide screens.
struct SearchView: View {
    @Environment(AppModel.self) private var app
    @State private var addingFolder = false
    @State private var overlap = false

    var body: some View {
        MeasuredLayout {
            SearchBody(addFolder: { addingFolder = true })
        }
        .background(AmbientBackground())
        .navigationTitle(t("nav.search"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { addingFolder = true } label: { Label(t("search.addFolder"), systemImage: "folder.badge.plus") }
                    .disabled(SearchIndex.shared.isIndexing)
            }
        }
        .fileImporter(isPresented: $addingFolder, allowedContentTypes: [.folder]) { result in
            guard case .success(let url) = result else { return }
            do { try SearchIndex.shared.addFolder(url) } catch SearchIndex.AddError.overlap { overlap = true } catch {}
        }
        .alert(t("search.overlap"), isPresented: $overlap) { Button(t("common.close"), role: .cancel) {} }
    }
}

private struct SearchBody: View {
    let addFolder: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.layout) private var layout
    @Environment(\.locale) private var locale
    @AppStorage("vivepdf.search.autoIndex") private var autoIndex = true
    @State private var query = ""
    @State private var result: SearchIndex.Result?
    @State private var searching = false
    @State private var history = SearchHistory.read()
    @State private var filters = SearchFilterState()
    @State private var editingFilters = false
    @State private var showHelp = false
    @FocusState private var focused: Bool
    private var index: SearchIndex { .shared }

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var idle: Bool { result == nil && !searching && trimmed.isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if layout.isWide {
                    HStack(alignment: .top, spacing: 20) {
                        mainColumn.frame(maxWidth: .infinity)
                        FoldersPanel(addFolder: addFolder, onRemove: removed).frame(width: 330)
                    }
                } else {
                    mainColumn
                    FoldersPanel(addFolder: addFolder, onRemove: removed)
                }
            }
            .frame(maxWidth: 1240, alignment: .leading)
            .padding(.horizontal, layout.gutter)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .task(id: SearchKey(query: trimmed, filters: filters, documentPath: app.documents.active?.url.path, revision: index.totalPages)) {
            await runQuery()
        }
        .onAppear {
            if autoIndex, !index.folders.isEmpty, index.isStale { index.reindex() }
            if !index.folders.isEmpty { focused = true }
        }
        .sheet(isPresented: $editingFilters) { SearchFiltersSheet(filters: $filters) }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            ToneTile(symbol: "magnifyingglass", size: layout.isCompact ? 44 : 54)
            VStack(alignment: .leading, spacing: 4) {
                Text(t("nav.search")).font(layout.isCompact ? .title2.bold() : .largeTitle.bold())
                Text(t("search.description")).font(.callout).foregroundStyle(Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var mainColumn: some View {
        VStack(alignment: .leading, spacing: 14) {
            searchField
            filterBar
            if let error = index.lastError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(Palette.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(padding: 12)
            }
            if idle { idleCard } else { results }
        }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            if searching { ProgressView() } else { Image(systemName: "magnifyingglass").foregroundStyle(Palette.mutedForeground) }
            TextField(index.folders.isEmpty ? t("search.noFoldersHint") : t("search.placeholder"), text: $query)
                .focused($focused)
                .font(.body)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .onSubmit { if !trimmed.isEmpty { history = SearchHistory.push(trimmed) } }
                .disabled(index.folders.isEmpty)
                .accessibilityLabel(t("nav.search"))
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(t("common.close"))
            }
            Button { showHelp = true } label: { Image(systemName: "questionmark.circle") }
                .buttonStyle(.plain)
                .accessibilityLabel(t("search.syntaxHelp"))
                .popover(isPresented: $showHelp) {
                    Text(t("search.syntaxHelpText"))
                        .font(.callout)
                        .padding()
                        .frame(idealWidth: 300)
                        .fixedSize(horizontal: false, vertical: true)
                        .presentationCompactAdaptation(.popover)
                }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 54)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(focused ? Palette.primary.opacity(0.5) : Palette.border))
        .opacity(index.folders.isEmpty ? 0.7 : 1)
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Menu {
                    Picker(t("search.filterFolder"), selection: $filters.folderID) {
                        Text(t("search.allFolders")).tag(String?.none)
                        ForEach(index.folders) { Text($0.name).tag(Optional($0.id)) }
                    }
                } label: {
                    FilterChip(symbol: "folder", label: index.folders.first { $0.id == filters.folderID }?.name ?? t("search.allFolders"),
                               active: filters.folderID != nil)
                }
                Button { editingFilters = true } label: {
                    FilterChip(symbol: "calendar", label: filters.dateLabel(locale: locale) ?? t("search.filterDate"), active: filters.hasDates)
                }
                Button { editingFilters = true } label: {
                    FilterChip(symbol: "number", label: filters.pagesLabel ?? t("search.filterPages"), active: filters.hasPages)
                }
                if let active = app.documents.active {
                    Button { filters.documentOnly.toggle() } label: {
                        FilterChip(symbol: "doc.text", label: t("search.thisDocumentOnly", ["file": active.fileName]), active: filters.documentOnly)
                    }
                }
                if filters.isActive {
                    Button { filters = SearchFilterState() } label: { FilterChip(symbol: "xmark", label: t("search.clearFilters"), active: false) }
                }
            }
            .buttonStyle(.plain)
            .padding(.vertical, 2)
        }
    }

    private var idleCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                ToneTile(symbol: "doc.text.magnifyingglass", size: 48)
                VStack(alignment: .leading, spacing: 4) {
                    Text(t("search.idleTitle")).font(.headline)
                    Text(index.folders.isEmpty ? t("search.noFolders")
                         : t("search.idleDescription", ["files": index.totalFiles, "pages": index.totalPages]))
                        .font(.subheadline).foregroundStyle(Palette.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                    if index.folders.isEmpty {
                        Button(action: addFolder) { Label(t("search.addFolder"), systemImage: "folder.badge.plus") }
                            .buttonStyle(.borderedProminent)
                            .padding(.top, 6)
                            .disabled(index.isIndexing)
                    }
                }
            }
            if !history.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Eyebrow(text: t("search.recentSearches"))
                        Spacer()
                        Button(t("search.clearHistory")) { history = SearchHistory.clear() }.font(.footnote).buttonStyle(.borderless)
                    }
                    FlowLayout(spacing: 8) {
                        ForEach(history, id: \.self) { item in
                            Button { query = item; focused = true } label: {
                                Label(item, systemImage: "clock").font(.subheadline).lineLimit(1)
                                    .padding(.horizontal, 12).frame(minHeight: 34)
                                    .background(Palette.muted, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button(role: .destructive) { history = SearchHistory.remove(item) } label: {
                                    Label(t("search.removeHistory"), systemImage: "xmark")
                                }
                            }
                        }
                    }
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Label { Eyebrow(text: t("search.tips")) } icon: { Image(systemName: "lightbulb").font(.caption).foregroundStyle(Palette.mutedForeground) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
                    ForEach(Self.tips, id: \.key) { tip in
                        Button { query = tip.example; focused = true } label: {
                            HStack {
                                Text(t("search.\(tip.key)")).font(.subheadline).lineLimit(2)
                                Spacer(minLength: 8)
                                Text(tip.example).font(.caption.monospaced()).foregroundStyle(Palette.mutedForeground)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Palette.secondary, in: RoundedRectangle(cornerRadius: 5))
                            }
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .background(Palette.card.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.border))
                        }
                        .buttonStyle(.plain)
                        .disabled(index.folders.isEmpty)
                    }
                }
                Text(t("search.hint")).font(.caption).foregroundStyle(Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 20)
    }

    static let tips: [(key: String, example: String)] = [
        ("tipPhrase", "\"...\""), ("tipPrefix", "kelime*"), ("tipOr", "a OR b"), ("tipExclude", "-kelime"), ("tipNear", "NEAR(a b, 5)"),
    ]

    @ViewBuilder
    private var results: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let result, result.totalFiles > 0 {
                let hits = result.files.reduce(0) { $0 + $1.pageHits }
                Text([t("search.summary", ["files": result.totalFiles, "hits": hits]),
                      result.totalFiles > result.files.count ? t("search.limited", ["shown": result.files.count]) : nil]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Palette.mutedForeground)
            } else if result == nil {
                Text(t("search.hint")).font(.caption).foregroundStyle(Palette.mutedForeground)
            }
            if let result, result.files.isEmpty {
                VStack(spacing: 10) {
                    ToneTile(symbol: "magnifyingglass", size: 44)
                    Text(t("search.noResults")).font(.subheadline).foregroundStyle(Palette.mutedForeground).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 30)
                .card()
            }
            ForEach(result?.files ?? []) { file in
                FileHitCard(file: file, open: { page in open(file, page: page) })
            }
        }
    }

    private func runQuery() async {
        guard !trimmed.isEmpty else { result = nil; searching = false; return }
        searching = true
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        var applied = filters.indexFilters
        if filters.documentOnly { applied.documentPath = app.documents.active?.url.path }
        let found = await index.query(trimmed, filters: applied)
        guard !Task.isCancelled else { return }
        result = found
        searching = false
        // A query that stays put for a few seconds is remembered, like on desktop.
        try? await Task.sleep(for: .seconds(3))
        if !Task.isCancelled { history = SearchHistory.push(trimmed) }
    }

    private func open(_ file: SearchIndex.FileHit, page: Int) {
        if !trimmed.isEmpty { history = SearchHistory.push(trimmed) }
        guard let url = index.openableURL(for: file) else { return }
        app.viewerSearchRequest = trimmed.isEmpty ? nil : trimmed
        HomeActions.open(url, page: page, app: app)
    }

    private func removed(_ folder: SearchIndex.Folder) {
        if filters.folderID == folder.id { filters.folderID = nil }
        result = nil
    }
}

/// Identity of a query run; changing any part re-runs the search.
private struct SearchKey: Hashable {
    var query: String
    var filters: SearchFilterState
    var documentPath: String?
    var revision: Int
}

struct SearchFilterState: Hashable {
    var folderID: String?
    var after: Date?
    var before: Date?
    var minPages = ""
    var maxPages = ""
    var documentOnly = false

    var hasDates: Bool { after != nil || before != nil }
    var hasPages: Bool { Int(minPages) != nil || Int(maxPages) != nil }
    var isActive: Bool { folderID != nil || hasDates || hasPages || documentOnly }

    var indexFilters: SearchIndex.Filters {
        let calendar = Calendar.current
        return SearchIndex.Filters(
            folderID: folderID,
            modifiedAfter: after.map { calendar.startOfDay(for: $0) },
            modifiedBefore: before.map { calendar.date(bySettingHour: 23, minute: 59, second: 59, of: $0) ?? $0 },
            minPages: Int(minPages).map { max(0, $0) },
            maxPages: Int(maxPages).map { max(0, $0) })
    }

    func dateLabel(locale: Locale) -> String? {
        guard hasDates else { return nil }
        let style = Date.FormatStyle(date: .abbreviated, time: .omitted).locale(locale)
        return "\(after?.formatted(style) ?? "…") – \(before?.formatted(style) ?? "…")"
    }

    var pagesLabel: String? {
        guard hasPages else { return nil }
        return "\(Int(minPages).map(String.init) ?? "0")–\(Int(maxPages).map(String.init) ?? "∞")"
    }
}

private struct FilterChip: View {
    let symbol: String
    let label: String
    let active: Bool
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.caption)
            Text(label).font(.subheadline).lineLimit(1)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 36)
        .foregroundStyle(active ? Palette.accentForeground : Palette.foreground)
        .background(active ? Palette.accent : Palette.card, in: Capsule())
        .overlay(Capsule().strokeBorder(active ? Palette.primary.opacity(0.4) : Palette.border))
        .frame(maxWidth: 280)
    }
}

private struct SearchFiltersSheet: View {
    @Binding var filters: SearchFilterState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section(t("search.filterDate")) {
                    Toggle(t("search.modifiedAfter"), isOn: Binding(get: { filters.after != nil }, set: { filters.after = $0 ? (filters.after ?? Date().addingTimeInterval(-30 * 86_400)) : nil }))
                    if let after = filters.after {
                        DatePicker(t("search.modifiedAfter"), selection: Binding(get: { after }, set: { filters.after = $0 }), displayedComponents: .date)
                    }
                    Toggle(t("search.modifiedBefore"), isOn: Binding(get: { filters.before != nil }, set: { filters.before = $0 ? (filters.before ?? Date()) : nil }))
                    if let before = filters.before {
                        DatePicker(t("search.modifiedBefore"), selection: Binding(get: { before }, set: { filters.before = $0 }), displayedComponents: .date)
                    }
                }
                Section(t("search.filterPages")) {
                    LabeledContent(t("search.minPages")) {
                        TextField(t("search.minShort"), text: $filters.minPages).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    }
                    LabeledContent(t("search.maxPages")) {
                        TextField(t("search.maxShort"), text: $filters.maxPages).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    }
                }
                if filters.isActive {
                    Section { Button(t("search.clearFilters"), role: .destructive) { filters = SearchFilterState() } }
                }
            }
            .navigationTitle(t("search.filterDate") + " · " + t("search.filterPages"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("home.layout.done")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct FileHitCard: View {
    let file: SearchIndex.FileHit
    let open: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Button { open(file.matchedPages.first?.page ?? 1) } label: {
                    HStack(spacing: 10) {
                        ToneTile(symbol: "doc.text", size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(file.title.isEmpty ? file.fileName : file.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                            Text(file.path).font(.caption2.monospaced()).foregroundStyle(Palette.mutedForeground).lineLimit(1).truncationMode(.head)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Text("\(file.pages) \(t("info.pages"))").font(.caption2.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Palette.muted, in: Capsule())
                Menu {
                    Button { open(file.matchedPages.first?.page ?? 1) } label: { Label(t("home.history.open"), systemImage: "book") }
                    Button { HomeActions.revealInFiles(URL(fileURLWithPath: file.path)) } label: { Label(t("tools.reveal"), systemImage: "folder") }
                } label: { Image(systemName: "ellipsis").frame(width: 32, height: 36) }
            }
            VStack(spacing: 2) {
                ForEach(file.matchedPages) { hit in
                    Button { open(hit.page) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(t("search.page", ["page": hit.page]))
                                .font(.caption2.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Palette.secondary, in: RoundedRectangle(cornerRadius: 5))
                                .fixedSize()
                            Text(snippet(hit.snippet)).font(.subheadline).foregroundStyle(Palette.foreground.opacity(0.85))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .multilineTextAlignment(.leading)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            if file.pageHits > file.matchedPages.count {
                Text(t("search.moreHits", ["count": file.pageHits - file.matchedPages.count])).font(.caption).foregroundStyle(Palette.mutedForeground)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    private func snippet(_ snippet: SearchQuery.Snippet) -> AttributedString {
        var match = AttributedString(snippet.match)
        match.backgroundColor = Palette.primary.opacity(0.25)
        match.font = .subheadline.weight(.semibold)
        return AttributedString(snippet.before) + match + AttributedString(snippet.after)
    }
}

private struct FoldersPanel: View {
    let addFolder: () -> Void
    let onRemove: (SearchIndex.Folder) -> Void
    @Environment(\.locale) private var locale
    private var index: SearchIndex { .shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Eyebrow(text: t("search.folders"))
                Spacer()
                Text(t("search.indexed", ["files": index.totalFiles, "pages": index.totalPages]))
                    .font(.caption2.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
            }
            if index.folders.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "folder").font(.title).foregroundStyle(Palette.primary)
                    Text(t("search.noFoldersTitle")).font(.subheadline.weight(.semibold))
                    Text(t("search.noFolders")).font(.caption).foregroundStyle(Palette.mutedForeground).multilineTextAlignment(.center)
                    Button(action: addFolder) { Label(t("search.addFolder"), systemImage: "folder.badge.plus") }
                        .buttonStyle(.bordered).disabled(index.isIndexing)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            } else {
                VStack(spacing: 6) {
                    ForEach(index.folders) { folder in
                        HStack(spacing: 10) {
                            ToneTile(symbol: "folder", size: 32)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(folder.name).font(.subheadline.weight(.medium)).lineLimit(1)
                                Text(t("search.indexed", ["files": folder.files, "pages": folder.pages]))
                                    .font(.caption2.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                            }
                            Spacer(minLength: 0)
                            Button {
                                index.removeFolder(folder)
                                onRemove(folder)
                            } label: { Image(systemName: "xmark").frame(width: 32, height: 32) }
                                .buttonStyle(.borderless)
                                .disabled(index.isIndexing)
                                .accessibilityLabel(t("search.remove"))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Palette.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
            if index.isIndexing {
                HStack(spacing: 8) {
                    ProgressView()
                    Text(index.progress.map { t("search.indexing", ["current": $0.current, "total": $0.total]) } ?? t("search.indexingStart"))
                        .font(.caption).foregroundStyle(Palette.mutedForeground)
                    Spacer()
                    Button(t("common.cancel")) { index.cancelIndexing() }.font(.caption).buttonStyle(.borderless)
                }
            } else {
                let parts = [index.lastStats.map { s in
                    t("search.stats", ["indexed": s.indexed, "unchanged": s.unchanged, "skipped": s.skipped, "removed": s.removed])
                }, index.lastIndexed.map { t("search.lastIndexed", ["when": $0.formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(locale))]) }]
                    .compactMap { $0 }
                if !parts.isEmpty {
                    Text(parts.joined(separator: " · ")).font(.caption).foregroundStyle(Palette.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !index.folders.isEmpty {
                ViewThatFits(in: .horizontal) {
                    HStack { buttons }
                    VStack(alignment: .leading) { buttons }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    @ViewBuilder private var buttons: some View {
        Button(action: addFolder) { Label(t("search.addFolder"), systemImage: "folder.badge.plus").frame(maxWidth: .infinity) }
            .buttonStyle(.bordered)
            .disabled(index.isIndexing)
        Button { index.reindex(force: true) } label: { Label(t("search.reindex"), systemImage: "arrow.clockwise").frame(maxWidth: .infinity) }
            .buttonStyle(.bordered)
            .disabled(index.isIndexing)
    }
}

/// Wrapping row layout for chips (recent searches).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(maxX, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX, x + size.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
