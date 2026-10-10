import SwiftUI

/// Command palette (`components/layout/CommandPalette.tsx`), shown as a sheet by RootView (⌘K).
/// Prefixes: `>` actions, `/` pages & settings, `@` documents & files, `#` go to page.
struct CommandPaletteView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @State private var query = ""
    @State private var cursor = 0
    @State private var report: ReportCategory?
    @State private var recentIDs = PaletteRecents.read()
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            let groups = groups
            let flat = groups.flatMap(\.entries)
            ScrollViewReader { proxy in
                List {
                    if query.isEmpty {
                        Section {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(PaletteMatch.prefixHints, id: \.prefix) { hint in
                                        Button { query = hint.prefix; focused = true } label: {
                                            HStack(spacing: 6) {
                                                KeyCap(keys: hint.prefix)
                                                Text(PaletteMatch.stripPrefix(t(hint.labelKey))).font(.footnote)
                                            }
                                            .padding(.horizontal, 10).frame(minHeight: 34)
                                            .background(Palette.muted, in: Capsule())
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                            .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
                        }
                    }
                    if flat.isEmpty {
                        Text(t("palette.empty")).foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(groups, id: \.key) { group in
                        Section(group.label) {
                            ForEach(group.entries) { entry in
                                let index = flat.firstIndex { $0.id == entry.id } ?? 0
                                PaletteRow(entry: entry, highlighted: index == cursor, query: PaletteMatch.mode(of: query).rest) { run(entry) }
                                    .id(entry.id)
                                    .swipeActions {
                                        if let secondary = entry.secondary {
                                            Button { runSecondary(entry, secondary) } label: { Label(secondary.label, systemImage: secondary.symbol) }
                                        }
                                    }
                                    .contextMenu {
                                        Button { run(entry) } label: { Label(entry.title, systemImage: entry.symbol) }
                                        if let secondary = entry.secondary {
                                            Button { runSecondary(entry, secondary) } label: { Label(secondary.label, systemImage: secondary.symbol) }
                                        }
                                    }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .onChange(of: cursor) { _, value in
                    if flat.indices.contains(value) { withAnimation { proxy.scrollTo(flat[value].id) } }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) { searchBar(flat) }
            .navigationTitle(t("palette.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.close")) { dismiss() }.keyboardShortcut(.cancelAction)
                }
            }
            .navigationDestination(item: $report) { category in ReportView(category: category) }
        }
        .presentationDetents([.large])
        .onAppear { focused = true }
        .onChange(of: query) { _, _ in cursor = 0 }
    }

    private func searchBar(_ flat: [PaletteEntry]) -> some View {
        let mode = PaletteMatch.mode(of: query).mode
        return HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.mutedForeground)
            if let mode {
                Text(t("palette.modeChip.\(mode.rawValue)")).font(.caption.weight(.medium))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .foregroundStyle(Palette.primary)
                    .background(Palette.primary.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
            }
            TextField(t("palette.placeholder"), text: $query)
                .focused($focused)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.go)
                .onSubmit { if flat.indices.contains(cursor) { run(flat[cursor]) } }
                .onKeyPress(.downArrow) { cursor = min(flat.count - 1, cursor + 1); return .handled }
                .onKeyPress(.upArrow) { cursor = max(0, cursor - 1); return .handled }
                .onKeyPress(.escape) {
                    if mode != nil, !query.isEmpty { query = ""; return .handled }
                    dismiss()
                    return .handled
                }
                .accessibilityLabel(t("palette.title"))
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(t("common.close"))
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.border))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: Entries

    private var groups: [PaletteGroup] {
        let (mode, rest) = PaletteMatch.mode(of: query)
        let tools = toolEntries, pages = pageEntries, settings = settingsEntries, actions = actionEntries
        let documents = documentEntries, recents = recentEntries
        if mode == .page {
            let jumps = documentQueryEntries(rest).filter { $0.kind == .pageJump }
            return jumps.isEmpty ? [] : [PaletteGroup(key: "page", label: t("palette.group.document"), entries: jumps)]
        }
        let pool: [PaletteEntry]
        switch mode {
        case .actions: pool = actions
        case .pages: pool = pages + settings
        case .documents: pool = documents + recents
        default: pool = tools + pages + settings + actions + documents + recents + documentQueryEntries(query)
        }
        if rest.trimmingCharacters(in: .whitespaces).isEmpty {
            if mode == nil {
                let all = Dictionary((tools + pages + settings + actions + documents + recents).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
                return [
                    PaletteGroup(key: "recentCommands", label: t("palette.group.recentCommands"), entries: recentIDs.compactMap { all[$0] }),
                    PaletteGroup(key: "openDocuments", label: t("palette.group.documents"), entries: documents),
                    PaletteGroup(key: "recentFiles", label: t("palette.group.recentFiles"), entries: Array(recents.prefix(4))),
                    PaletteGroup(key: "suggested", label: t("palette.group.suggested"), entries: Array(tools.prefix(6))),
                ].filter { !$0.entries.isEmpty }
            }
            return PaletteGroup.byKind(Array(pool.prefix(PaletteMatch.maxResults)))
        }
        let scored = pool.map { ($0, PaletteMatch.score(rest, title: $0.title, subtitle: $0.subtitle, keywords: $0.keywords)) }
            .filter { $0.1 > 0 }
            .sorted { a, b in
                if a.1 != b.1 { return a.1 > b.1 }
                return (recentIDs.firstIndex(of: a.0.id) ?? .max) < (recentIDs.firstIndex(of: b.0.id) ?? .max)
            }
            .map(\.0)
        return PaletteGroup.byKind(Array(scored.prefix(PaletteMatch.maxResults)))
    }

    private var toolEntries: [PaletteEntry] {
        ToolCatalog.shortcuts.map { tool in
            PaletteEntry(id: "tool:\(tool.id)", kind: .tool, title: tool.label, subtitle: t(tool.group.labelKey),
                         keywords: "\(tool.keywords) \(tool.detail)", symbol: tool.symbol, tone: tool.group.color) { app.navigate(tool.route) }
        }
    }

    private var pageEntries: [PaletteEntry] {
        let shortcutLabels = Set(ToolCatalog.shortcuts.map(\.labelKey))
        let routes: [Route] = [.home, .viewer, .pages, .studio(), .search] + ToolID.navigable.filter { !shortcutLabels.contains($0.labelKey) }.map { .tool($0) }
            + [.settings(), .about]
        return routes.map { route in
            PaletteEntry(id: "page:\(route.section)", kind: .page, title: t(route.labelKey), subtitle: t("palette.page"),
                         keywords: "", symbol: route.symbol) { app.navigate(route) }
        }
    }

    private var settingsEntries: [PaletteEntry] {
        SettingsSection.allCases.map { section in
            PaletteEntry(id: "settings:\(section.rawValue)", kind: .settings, title: t(section.titleKey), subtitle: t("palette.settings"),
                         keywords: "settings ayarlar", symbol: section.symbol) { app.navigate(.settings(section: section.rawValue)) }
        }
    }

    private var actionEntries: [PaletteEntry] {
        func action(_ id: String, _ key: String, _ keywords: String, _ symbol: String, run: @escaping () -> Void) -> PaletteEntry {
            PaletteEntry(id: "action:\(id)", kind: .action, title: t(key), subtitle: t("palette.actionLabel"), keywords: keywords, symbol: symbol, run: run)
        }
        var entries = [
            action("open", "palette.action.open", "open pdf ac", "doc.badge.plus") { app.showOpenPicker = true },
            action("clipboard", "palette.action.clipboard", "clipboard paste screenshot pano yapistir", "doc.on.clipboard") { _ = HomeActions.openClipboard(app: app) },
            action("editHome", "palette.action.editHome", "home page customize layout quick access ana sayfa duzenle", "rectangle.3.group") {
                HomeLayoutStore.shared.editRequested = true
                app.navigate(.home)
            },
            action("searchFolder", "palette.action.searchFolder", "search folder index klasor ara", "magnifyingglass") { app.navigate(.search) },
            action("themeLight", "palette.action.themeLight", "theme light aydinlik", "sun.max") { app.theme = .light },
            action("themeDark", "palette.action.themeDark", "theme dark karanlik", "moon") { app.theme = .dark },
            action("themeSystem", "palette.action.themeSystem", "theme system sistem", "circle.lefthalf.filled") { app.theme = .system },
            action("checkUpdates", "palette.action.checkUpdates", "update guncelle version", "arrow.clockwise") { app.navigate(.settings(section: SettingsSection.updates.rawValue)) },
        ]
        // Report screens open inside the palette, since it is already a sheet.
        entries.append(PaletteEntry(id: "action:reportBug", kind: .action, title: t("palette.action.reportBug"), subtitle: t("palette.actionLabel"),
                                    keywords: "bug report hata bildir", symbol: "ladybug", keepsOpen: true) { report = .bug })
        entries.append(PaletteEntry(id: "action:suggestFeature", kind: .action, title: t("palette.action.suggestFeature"), subtitle: t("palette.actionLabel"),
                                    keywords: "feature idea oneri", symbol: "lightbulb", keepsOpen: true) { report = .idea })
        if let active = app.documents.active {
            entries.append(action("print", "palette.action.print", "print yazdir", "printer") { PrintHelper.print(active) })
        }
        return entries
    }

    private var documentEntries: [PaletteEntry] {
        let store = app.documents
        return store.documents.filter { $0.id != store.active?.id }.map { doc in
            PaletteEntry(id: "document:\(doc.id)", kind: .document, title: t("palette.action.switchTo", ["fileName": doc.fileName]),
                         subtitle: doc.url.path, keywords: doc.fileName, symbol: "doc.text", monoSubtitle: true,
                         secondary: (t("palette.action.closeDocument"), "xmark", { store.close(doc) })) {
                store.active = doc
                app.navigate(.viewer)
            }
        }
    }

    private var recentEntries: [PaletteEntry] {
        app.documents.recents.map { item in
            PaletteEntry(id: "recent:\(item.path)", kind: .recent, title: item.name, subtitle: item.path, keywords: item.name,
                         symbol: "clock", monoSubtitle: true,
                         secondary: (t("palette.action.revealInFolder"), "folder", { HomeActions.revealInFiles(URL(fileURLWithPath: item.path)) })) {
                if let url = item.resolve() { app.open(url) }
            }
        }
    }

    private func documentQueryEntries(_ text: String) -> [PaletteEntry] {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let active = app.documents.active else { return [] }
        if let page = PaletteMatch.pageNumber(trimmed) {
            return [PaletteEntry(id: "page-jump:current", kind: .pageJump, title: t("palette.goToPage", ["page": page]),
                                 subtitle: active.fileName, keywords: "", symbol: "number") {
                active.currentPageIndex = max(0, min(active.pageCount - 1, page - 1))
                app.navigate(.viewer)
            }]
        }
        return [PaletteEntry(id: "search:document", kind: .search, title: t("palette.searchInDocument", ["query": trimmed]),
                             subtitle: active.fileName, keywords: "", symbol: "doc.text.magnifyingglass") {
            app.viewerSearchRequest = trimmed
            app.navigate(.viewer)
        }]
    }

    // MARK: Running

    private func run(_ entry: PaletteEntry) {
        recentIDs = PaletteRecents.record(entry.id)
        if entry.keepsOpen { entry.run(); return }
        dismiss()
        // Let the sheet finish closing before presenting pickers or navigating.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { entry.run() }
    }

    private func runSecondary(_ entry: PaletteEntry, _ secondary: (label: String, symbol: String, run: () -> Void)) {
        recentIDs = PaletteRecents.record(entry.id)
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { secondary.run() }
    }
}

struct PaletteEntry: Identifiable {
    enum Kind: String { case tool, page, settings, action, document, recent, search, pageJump }
    let id: String
    let kind: Kind
    let title: String
    let subtitle: String
    let keywords: String
    let symbol: String
    var tone: Color? = nil
    var monoSubtitle = false
    var keepsOpen = false
    var secondary: (label: String, symbol: String, run: () -> Void)? = nil
    let run: () -> Void
}

struct PaletteGroup {
    let key: String
    let label: String
    let entries: [PaletteEntry]

    static func label(for kind: PaletteEntry.Kind) -> String {
        switch kind {
        case .tool: t("palette.group.tools")
        case .page: t("palette.group.pages")
        case .settings: t("palette.group.settings")
        case .action: t("palette.group.actions")
        case .document: t("palette.group.documents")
        case .recent: t("palette.group.recentFiles")
        case .search, .pageJump: t("palette.group.document")
        }
    }

    static func byKind(_ entries: [PaletteEntry]) -> [PaletteGroup] {
        var order: [PaletteEntry.Kind] = []
        var map: [PaletteEntry.Kind: [PaletteEntry]] = [:]
        for entry in entries {
            if map[entry.kind] == nil { order.append(entry.kind) }
            map[entry.kind, default: []].append(entry)
        }
        return order.map { PaletteGroup(key: $0.rawValue, label: label(for: $0), entries: map[$0] ?? []) }
    }
}

private struct PaletteRow: View {
    let entry: PaletteEntry
    let highlighted: Bool
    let query: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: entry.symbol)
                    .foregroundStyle(entry.tone ?? Palette.mutedForeground)
                    .frame(width: 28, height: 28)
                    .background((entry.tone ?? Palette.mutedForeground).opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
                VStack(alignment: .leading, spacing: 1) {
                    Text(PaletteMatch.highlight(entry.title, query: query)).lineLimit(1)
                    Text(entry.subtitle)
                        .font(entry.monoSubtitle ? .caption2.monospaced() : .caption)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1).truncationMode(.middle)
                }
                Spacer(minLength: 0)
                if highlighted { Image(systemName: "return").font(.caption).foregroundStyle(Palette.mutedForeground) }
            }
            .contentShape(Rectangle())
        }
        .foregroundStyle(Palette.foreground)
        .listRowBackground(highlighted ? Palette.accent : nil)
    }
}

/// Scoring and prefix modes (`paletteMatch.ts`).
enum PaletteMatch {
    enum Mode: String { case actions, pages, documents, page }
    static let maxResults = 40
    static let prefixHints: [(prefix: String, labelKey: String)] = [
        (">", "palette.hint.actions"), ("/", "palette.hint.pages"), ("@", "palette.hint.documents"), ("#", "palette.hint.page"),
    ]

    static func stripPrefix(_ label: String) -> String {
        FileNaming.replace(label, #"^[>/@#]\s*"#, with: "")
    }

    static func mode(of query: String) -> (mode: Mode?, rest: String) {
        guard let first = query.first else { return (nil, query) }
        let rest = String(query.dropFirst()).trimmingCharacters(in: .whitespaces)
        switch first {
        case ">": return (.actions, rest)
        case "/": return (.pages, rest)
        case "@": return (.documents, rest)
        case "#": return (.page, rest)
        default: return (nil, query)
        }
    }

    /// "12", "p12", "#12" → 12.
    static func pageNumber(_ query: String) -> Int? {
        var text = query.trimmingCharacters(in: .whitespaces).lowercased()
        if let first = text.first, "ps#".contains(first) { text = String(text.dropFirst()).trimmingCharacters(in: .whitespaces) }
        guard !text.isEmpty, text.allSatisfy(\.isASCII), let page = Int(text), page > 0 else { return nil }
        return page
    }

    private static func scoreToken(_ token: String, title: String, subtitle: String, keywords: String) -> Int {
        if title.hasPrefix(token) { return 100 }
        if title.split(separator: " ").contains(where: { $0.hasPrefix(token) }) { return 60 }
        if title.contains(token) { return 30 }
        if keywords.contains(token) { return 20 }
        if subtitle.contains(token) { return 10 }
        return 0
    }

    static func score(_ query: String, title: String, subtitle: String = "", keywords: String = "") -> Int {
        let tokens = TextFolding.fold(query).split(separator: " ").map(String.init)
        guard !tokens.isEmpty else { return 0 }
        let title = TextFolding.fold(title), subtitle = TextFolding.fold(subtitle), keywords = TextFolding.fold(keywords)
        var total = 0
        for token in tokens {
            let value = scoreToken(token, title: title, subtitle: subtitle, keywords: keywords)
            if value == 0 { return 0 }
            total += value
        }
        let full = TextFolding.fold(query)
        if title == full { total += 40 } else if title.hasPrefix(full) { total += 20 }
        return total
    }

    static func highlight(_ title: String, query: String) -> AttributedString {
        var text = AttributedString(title)
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty, let range = text.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) else { return text }
        text[range].font = .body.weight(.semibold)
        text[range].foregroundColor = Palette.primary
        return text
    }
}

/// Most recently run palette commands (newest first).
enum PaletteRecents {
    static let key = "vivepdf.palette.recent"
    static func read() -> [String] { UserDefaults.standard.stringArray(forKey: key) ?? [] }
    static func record(_ id: String) -> [String] {
        let next = Array(([id] + read().filter { $0 != id }).prefix(8))
        UserDefaults.standard.set(next, forKey: key)
        return next
    }
}

/// System print sheet for an open document (palette "Print").
enum PrintHelper {
    @MainActor
    static func print(_ doc: OpenDocument) {
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo.printInfo()
        info.jobName = doc.fileName
        info.outputType = .general
        controller.printInfo = info
        controller.printingItem = (try? doc.snapshotURL()) ?? doc.url
        controller.present(animated: true)
    }
}
