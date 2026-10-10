import QuickLook
import SwiftUI

// MARK: - Hero

struct HeroSection: View {
    let size: HomeSize
    @Environment(AppModel.self) private var app
    @Environment(\.layout) private var layout
    @State private var clipboardFailed = false

    private var greetingKey: String {
        let hour = Calendar.current.component(.hour, from: Date())
        return hour < 12 ? "home.greeting.morning" : hour < 18 ? "home.greeting.afternoon" : "home.greeting.evening"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(t("home.eyebrow").uppercased())
                    .font(.caption2.weight(.semibold)).tracking(0.8)
                    .foregroundStyle(Palette.primary)
                Text(t(greetingKey))
                    .font(size.pick(Font.title3, Font.title2, Font.largeTitle).weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(t("home.subtitle"))
                    .font(.subheadline).foregroundStyle(Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            buttons
            if size != .small { dropZone }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: size.padding)
        .background(alignment: .topTrailing) {
            // Soft tint like the desktop's "glass-tinted" hero.
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(LinearGradient(colors: [Palette.primary.opacity(0.10), .clear], startPoint: .topTrailing, endPoint: .bottomLeading))
                .allowsHitTesting(false)
        }
        .alert(t("home.error.title"), isPresented: $clipboardFailed) {
            Button(t("common.close"), role: .cancel) {}
        } message: { Text(t("errors.reasons.clipboardEmpty")) }
    }

    private var buttons: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { openButton; clipboardButton; searchButton }
            VStack(alignment: .leading, spacing: 10) {
                openButton.frame(maxWidth: .infinity)
                HStack(spacing: 10) { clipboardButton; searchButton }
            }
            VStack(alignment: .leading, spacing: 10) { openButton; clipboardButton; searchButton }
        }
    }

    private var openButton: some View {
        Button { app.showOpenPicker = true } label: {
            Label(t("common.openPdf"), systemImage: "folder").frame(minHeight: 30).frame(maxWidth: layout.isCompact ? .infinity : nil)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
    }

    private var clipboardButton: some View {
        Button { clipboardFailed = !HomeActions.openClipboard(app: app) } label: {
            Label(t("clipboard.action"), systemImage: "doc.on.clipboard").frame(minHeight: 30)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .accessibilityHint(t("clipboard.hint"))
    }

    private var searchButton: some View {
        Button { app.navigate(.search) } label: {
            Label(t("nav.folderSearch"), systemImage: "magnifyingglass").frame(minHeight: 30)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
    }

    /// Tap target that also advertises drag & drop (RootView accepts drops anywhere on iPad).
    private var dropZone: some View {
        Button { app.showOpenPicker = true } label: {
            HStack(spacing: 12) {
                Image(systemName: "icloud.and.arrow.up").font(.title3)
                Text(t("home.dropHint"))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Palette.foreground)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                if !layout.isCompact {
                    HStack(spacing: 12) {
                        HStack(spacing: 4) { KeyCap(keys: "Ctrl+O"); Text(t("common.openPdf")) }
                        HStack(spacing: 4) { KeyCap(keys: "Ctrl+K"); Text(t("emptyDoc.palette")) }
                    }
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
                }
            }
            .foregroundStyle(Palette.mutedForeground)
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity, minHeight: size == .large ? 112 : 64, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.border, style: StrokeStyle(lineWidth: 2, dash: [6, 5])))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Quick actions

struct QuickActionsSection: View {
    let size: HomeSize
    @Environment(AppModel.self) private var app
    private var store: HomeLayoutStore { .shared }

    var body: some View {
        let actions = store.layout.quickActions.compactMap(ToolCatalog.shortcut)
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: t("home.quickActions"))
            if actions.isEmpty {
                Text(t("home.layout.quick.empty")).font(.subheadline).foregroundStyle(Palette.mutedForeground)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: size.pick(84, 104, 150)), spacing: 12)], spacing: 12) {
                    ForEach(actions) { tool in
                        Button { app.navigate(tool.route) } label: { QuickActionTile(tool: tool, size: size) }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button(role: .destructive) { store.change { $0.removingQuickAction(tool.id) } } label: {
                                    Label(t("home.layout.quick.remove", ["name": tool.label]), systemImage: "minus.circle")
                                }
                            }
                    }
                }
            }
        }
    }
}

struct QuickActionTile: View {
    let tool: ToolShortcut
    let size: HomeSize

    var body: some View {
        VStack(spacing: size.pick(6, 10, 12)) {
            ToneTile(symbol: tool.symbol, tone: tool.group.color, soft: tool.group.soft, size: size.pick(30, 42, 50))
            Text(tool.label)
                .font(size.pick(Font.caption, Font.subheadline, Font.body).weight(.medium))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, size.pick(10, 14, 18))
        .frame(maxWidth: .infinity, minHeight: size.pick(72, 100, 132))
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.border))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
        .contentShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Recent documents

struct RecentSection: View {
    let size: HomeSize
    @Environment(AppModel.self) private var app
    @AppStorage("vivepdf.home.recentSort") private var sort: RecentSort = .recent
    @State private var query = ""
    @State private var showAll = false
    @State private var confirmClear = false

    var body: some View {
        let store = app.documents
        let recents = store.recents
        let hasControls = recents.count > 1
        let ordered = RecentOrdering.pinnedFirst(RecentOrdering.sorted(RecentOrdering.matching(recents, query: hasControls ? query : ""), by: sort))
        let limit = size.pick(4, 6, 12)
        let shown = showAll ? ordered : Array(ordered.prefix(limit))
        let pinned = shown.filter(\.pinned)
        let others = shown.filter { !$0.pinned }
        let hasPinned = recents.contains(where: \.pinned)
        let hasUnpinned = recents.contains { !$0.pinned }

        HomeCard(title: t("home.recent"), size: size) {
            HStack(spacing: 4) {
                if hasControls {
                    Menu {
                        Picker(t("home.recentSort"), selection: $sort) {
                            ForEach(RecentSort.allCases) { Text(t($0.labelKey)).tag($0) }
                        }
                    } label: { Image(systemName: "arrow.up.arrow.down").frame(width: 32, height: 32) }
                    .accessibilityLabel(t("home.recentSort"))
                }
                if ordered.count > limit {
                    Button(showAll ? t("home.showLess") : "\(t("home.showAll")) · \(ordered.count)") { withAnimation { showAll.toggle() } }
                }
                if hasUnpinned {
                    Button(hasPinned ? t("home.clearRecentUnpinned") : t("home.clearRecent")) { confirmClear = true }
                }
            }
            .font(.footnote)
            .buttonStyle(.borderless)
        } content: {
            if hasControls {
                InlineSearchField(placeholder: t("home.recentSearch"), text: $query)
            }
            if recents.isEmpty {
                VStack(spacing: 10) {
                    ToneTile(symbol: "clock", size: 44)
                    Text(t("home.recentEmpty.title")).font(.subheadline.weight(.medium))
                    Text(t("home.recentEmpty.description")).font(.caption).foregroundStyle(Palette.mutedForeground).multilineTextAlignment(.center)
                    Button { app.showOpenPicker = true } label: { Label(t("common.openPdf"), systemImage: "folder") }
                        .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, size.pick(8, 24, 40))
            } else if ordered.isEmpty {
                Text(t("home.recentNoMatches", ["query": query.trimmingCharacters(in: .whitespaces)]))
                    .font(.subheadline).foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity).padding(.vertical, 20)
            } else {
                if !pinned.isEmpty { group(pinned, label: t("home.recentPinned")) }
                if !others.isEmpty { group(others, label: pinned.isEmpty ? nil : t("home.recentOthers")) }
            }
        }
        .confirmationDialog(hasPinned ? t("home.clearRecentUnpinned") : t("home.clearRecent"), isPresented: $confirmClear, titleVisibility: .visible) {
            Button(hasPinned ? t("home.clearRecentUnpinned") : t("home.clearRecent"), role: .destructive) { store.clearRecents() }
            Button(t("common.cancel"), role: .cancel) {}
        }
    }

    @ViewBuilder
    private func group(_ items: [RecentDocument], label: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label { Text(label).font(.caption.weight(.medium)).foregroundStyle(Palette.mutedForeground) }
            if size == .small {
                VStack(spacing: 2) { ForEach(items) { RecentRow(item: $0) } }
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: size == .large ? 200 : 140), spacing: 12)], spacing: 12) {
                    ForEach(items) { RecentCard(item: $0) }
                }
            }
        }
    }
}

private struct RecentMenu: View {
    let item: RecentDocument
    let url: URL?
    @Environment(AppModel.self) private var app

    var body: some View {
        if let url {
            Button { app.open(url) } label: { Label(t("home.history.open"), systemImage: "book") }
            ShareLink(item: url) { Label(t("ios.common.share"), systemImage: "square.and.arrow.up") }
            Button { HomeActions.revealInFiles(url) } label: { Label(t("tools.reveal"), systemImage: "folder") }
        }
        Button { app.documents.togglePin(item) } label: {
            Label(item.pinned ? t("home.unpinRecent", ["name": item.name]) : t("home.pinRecent", ["name": item.name]),
                  systemImage: item.pinned ? "pin.slash" : "pin")
        }
        Button(role: .destructive) { app.documents.forget(item) } label: {
            Label(t("home.removeRecent", ["name": item.name]), systemImage: "xmark")
        }
    }
}

private struct RecentCard: View {
    let item: RecentDocument
    @Environment(AppModel.self) private var app
    @Environment(\.locale) private var locale

    var body: some View {
        let url = item.resolve()
        VStack(alignment: .leading, spacing: 0) {
            Button { if let url { app.open(url) } } label: { FileThumbnail(url: url) }
                .buttonStyle(.plain)
                .disabled(url == nil)
                .accessibilityLabel(item.name)
            HStack(alignment: .top, spacing: 4) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        if item.pinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(Palette.primary) }
                        Text(item.name).font(.subheadline.weight(.medium)).lineLimit(1).truncationMode(.middle)
                    }
                    Text(url == nil ? t("home.collections.missing") : RelativeMoment.format(item.openedAt, locale: locale, justNow: t("home.justNow")))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(url == nil ? Palette.warning : Palette.mutedForeground)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Menu { RecentMenu(item: item, url: url) } label: {
                    Image(systemName: "ellipsis").frame(width: 32, height: 32).contentShape(Rectangle())
                }
                .accessibilityLabel(t("home.collections.actions", ["name": item.name]))
            }
            .padding(10)
        }
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.border))
        .opacity(url == nil ? 0.6 : 1)
        .contextMenu { RecentMenu(item: item, url: url) }
    }
}

private struct RecentRow: View {
    let item: RecentDocument
    @Environment(AppModel.self) private var app
    @Environment(\.locale) private var locale

    var body: some View {
        let url = item.resolve()
        HStack(spacing: 8) {
            Button { if let url { app.open(url) } } label: {
                HStack(spacing: 10) {
                    Image(systemName: url == nil ? "exclamationmark.triangle" : "doc.text")
                        .foregroundStyle(url == nil ? Palette.warning : Palette.mutedForeground)
                    Text(item.name).font(.subheadline).lineLimit(1).truncationMode(.middle)
                    if item.pinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(Palette.primary) }
                    Spacer(minLength: 4)
                    Text(url == nil ? t("home.collections.missing") : RelativeMoment.format(item.openedAt, locale: locale, justNow: t("home.justNow")))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(url == nil ? Palette.warning : Palette.mutedForeground)
                }
                .frame(minHeight: 40)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(url == nil)
            Menu { RecentMenu(item: item, url: url) } label: { Image(systemName: "ellipsis").frame(width: 32, height: 40) }
                .accessibilityLabel(t("home.collections.actions", ["name": item.name]))
        }
        .opacity(url == nil ? 0.6 : 1)
        .contextMenu { RecentMenu(item: item, url: url) }
    }
}

// MARK: - Continue reading

/// Documents you were reading, reopened at the last page (the iOS take on "restore last session").
struct ContinueSection: View {
    let size: HomeSize
    @Environment(AppModel.self) private var app
    @AppStorage("vivepdf.home.continueDismissedAt") private var dismissedAt: Double = 0

    var body: some View {
        let open = Set(app.documents.documents.map { $0.url.path })
        let items = app.documents.recents
            .filter { $0.lastPage > 0 && !open.contains($0.path) && $0.openedAt.timeIntervalSince1970 > dismissedAt }
            .compactMap { item in item.resolve().map { (item, $0) } }
        let shown = Array(items.prefix(size.pick(2, 3, 6)))
        if !shown.isEmpty {
            HomeCard(title: t("home.lastSession"), size: size, tinted: true) {
                Text(t("recovery.lastSessionDescription", ["count": items.count]))
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 6) {
                    ForEach(shown, id: \.0.id) { item, url in
                        Button { HomeActions.open(url, page: item.lastPage + 1, app: app) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "book").foregroundStyle(Tone.improve.color)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(item.name).font(.subheadline.weight(.medium)).lineLimit(1).truncationMode(.middle)
                                    Text(t("tools.pages.preview.title", ["page": item.lastPage + 1, "total": max(item.pageCount, item.lastPage + 1)]))
                                        .font(.caption).foregroundStyle(Palette.mutedForeground)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.forward").font(.caption).foregroundStyle(Palette.mutedForeground)
                            }
                            .padding(.horizontal, 12)
                            .frame(minHeight: 48)
                            .background(Palette.muted.opacity(0.7), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    if items.count > shown.count {
                        Text(t("common.andMore", ["count": items.count - shown.count])).font(.caption).foregroundStyle(Palette.mutedForeground)
                    }
                }
                VStack(spacing: 6) {
                    Button {
                        for (_, url) in items { app.documents.open(url) }
                        app.navigate(.viewer)
                    } label: { Label(t("recovery.restoreLast"), systemImage: "clock.arrow.circlepath").frame(maxWidth: .infinity, minHeight: 30) }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                    Button { dismissedAt = Date().timeIntervalSince1970 } label: {
                        Label(t("recovery.discard"), systemImage: "xmark").frame(maxWidth: .infinity, minHeight: 26)
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Palette.mutedForeground)
                }
            }
        }
    }
}

// MARK: - Operation history

struct HistorySection: View {
    let size: HomeSize
    @Environment(AppModel.self) private var app
    @Environment(\.locale) private var locale
    @State private var pendingDelete: OperationHistory.Entry?
    @State private var preview: URL?
    private var history: OperationHistory { .shared }

    var body: some View {
        let entries = history.entries
        if !entries.isEmpty {
            HomeCard(title: t("home.history.title"), size: size) {
                Button(t("home.clearRecent")) { history.clear() }.font(.footnote).buttonStyle(.borderless)
            } content: {
                VStack(spacing: 4) {
                    ForEach(entries.prefix(size.pick(3, 6, 12))) { entry in row(entry) }
                }
            }
            .confirmationDialog(t("home.history.confirmTitle"), isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                                titleVisibility: .visible, presenting: pendingDelete) { entry in
                Button(t("home.history.delete"), role: .destructive) { history.remove(entry, deleteFiles: true) }
                Button(t("common.cancel"), role: .cancel) {}
            } message: { entry in
                Text(t("home.history.confirmDescription", ["count": entry.outputs.count]) + "\n\n"
                     + entry.outputURLs.map(\.lastPathComponent).joined(separator: "\n"))
            }
            .quickLookPreview($preview)
        }
    }

    private func isMissing(_ entry: OperationHistory.Entry) -> Bool {
        !entry.outputs.isEmpty && entry.outputURLs.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) }
    }

    private func open(_ entry: OperationHistory.Entry) {
        guard let first = entry.outputURLs.first else { return }
        if first.pathExtension.lowercased() == "pdf" { app.open(first) } else { preview = first }
    }

    @ViewBuilder
    private func menu(_ entry: OperationHistory.Entry, missing: Bool) -> some View {
        if !missing, let first = entry.outputURLs.first {
            Button { open(entry) } label: { Label(t("home.history.open"), systemImage: "book") }
            Button { preview = first } label: { Label(t("ios.common.preview"), systemImage: "eye") }
            ShareLink(items: entry.outputURLs.filter { FileManager.default.fileExists(atPath: $0.path) }) {
                Label(t("ios.common.share"), systemImage: "square.and.arrow.up")
            }
            Button { HomeActions.revealInFiles(first) } label: { Label(t("tools.reveal"), systemImage: "folder") }
            Button { UIPasteboard.general.string = first.path } label: { Label(t("viewer.context.copyPath"), systemImage: "doc.on.doc") }
        }
        Divider()
        Button { history.remove(entry, deleteFiles: false) } label: { Label(t("home.history.removeFromList"), systemImage: "list.dash") }
        if !missing {
            Button(role: .destructive) { pendingDelete = entry } label: { Label(t("home.history.delete"), systemImage: "trash") }
        }
    }

    private func row(_ entry: OperationHistory.Entry) -> some View {
        let missing = isMissing(entry)
        let title = entry.outputs.count > 1 ? t("home.history.outputs", ["count": entry.outputs.count]) : (entry.outputURLs.first?.lastPathComponent ?? entry.label)
        let date = entry.date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(locale))
        let tool = HomeActions.tool(forLabel: entry.label)
        return HStack(spacing: 6) {
            Button { open(entry) } label: {
                HStack(spacing: 10) {
                    ToneTile(symbol: tool?.symbol ?? "clock.arrow.circlepath", tone: tool?.tone.color ?? Palette.primary,
                             soft: tool?.tone.soft ?? Palette.accent, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.subheadline).lineLimit(1).truncationMode(.middle)
                        Text("\(missing ? t("home.history.missing") : entry.label) · \(date)")
                            .font(.caption2).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(missing)
            Menu { menu(entry, missing: missing) } label: { Image(systemName: "ellipsis").frame(width: 32, height: 44) }
                .accessibilityLabel(t("home.collections.actions", ["name": title]))
        }
        .opacity(missing ? 0.5 : 1)
        .contextMenu { menu(entry, missing: missing) }
    }
}

// MARK: - Overview

struct StatsSection: View {
    let size: HomeSize
    @Environment(AppModel.self) private var app
    @Environment(\.layout) private var layout
    private var history: OperationHistory { .shared }

    var body: some View {
        let weekAgo = Date().addingTimeInterval(-7 * 86_400)
        let entries = history.entries
        let week = entries.filter { $0.date >= weekAgo }.count
        let counts = Dictionary(grouping: entries, by: \.label).mapValues(\.count)
        let top = counts.max { $0.value == $1.value ? $0.key > $1.key : $0.value < $1.value }?.key
        let ocrCount = OCRLanguageCatalog.supported.count

        HomeCard(title: t("home.stats.title"), size: size) {
            VStack(spacing: 0) {
                OverviewRow(label: t("home.stats.week"), value: "\(week)")
                if let top {
                    OverviewRow(label: t("home.stats.topTool"), value: top, mono: false) {
                        if let tool = HomeActions.tool(forLabel: top) { app.navigate(.tool(tool)) }
                    }
                }
                OverviewRow(label: t("home.stats.ocr"), value: t("home.stats.languages", ["count": ocrCount]), healthy: ocrCount > 0) {
                    app.navigate(.settings(section: "tools"))
                }
                OverviewRow(label: t("home.stats.office"), value: t("home.stats.ready"), healthy: true) {
                    app.navigate(.tool(.convert, tab: "file-to-pdf"))
                }
                OverviewRow(label: t("about.version"), value: AppInfo.version, healthy: true) { app.navigate(.about) }
            }
            if size != .small && !layout.isCompact {
                Divider().padding(.vertical, 4)
                Eyebrow(text: t("emptyDoc.shortcuts"))
                VStack(spacing: 0) {
                    ShortcutRow(label: t("common.openPdf"), keys: "Ctrl+O") { app.showOpenPicker = true }
                    ShortcutRow(label: t("emptyDoc.palette"), keys: "Ctrl+K") { app.showCommandPalette = true }
                    ShortcutRow(label: t("nav.folderSearch"), keys: "Ctrl+Shift+F") { app.navigate(.search) }
                    ShortcutRow(label: t("nav.settings"), keys: "Ctrl+,") { app.navigate(.settings()) }
                    if size == .large {
                        ShortcutRow(label: t("nav.home"), keys: "Ctrl+1") { app.navigate(.home) }
                        ShortcutRow(label: t("nav.viewer"), keys: "Ctrl+2") { app.navigate(.viewer) }
                    }
                }
            }
        }
    }
}

private struct OverviewRow: View {
    let label: String
    let value: String
    var healthy: Bool? = nil
    var mono = true
    var action: (() -> Void)? = nil

    var body: some View {
        let content = HStack(spacing: 10) {
            Text(label).foregroundStyle(Palette.mutedForeground).lineLimit(2)
            Spacer(minLength: 8)
            if let healthy {
                Circle().fill(healthy ? Palette.success : Palette.mutedForeground.opacity(0.5)).frame(width: 8, height: 8)
            }
            Text(value).font(mono ? .caption.monospacedDigit() : .subheadline).lineLimit(1)
        }
        .font(.subheadline)
        .frame(minHeight: 36)
        .contentShape(Rectangle())
        if let action {
            Button(action: action) { content }.buttonStyle(.plain)
        } else {
            content
        }
    }
}

private struct ShortcutRow: View {
    let label: String
    let keys: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack {
                Text(label).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                Spacer(minLength: 8)
                KeyCap(keys: keys)
            }
            .font(.subheadline)
            .frame(minHeight: 34)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Studio

struct StudioSection: View {
    let size: HomeSize
    @Environment(AppModel.self) private var app
    @Environment(\.locale) private var locale
    @State private var designs: [URL] = []

    var body: some View {
        HomeCard(title: t("home.studio.title"), size: size) {
            HStack(spacing: 8) {
                Button { app.navigate(.studio()) } label: { Label(t("home.studio.open"), systemImage: "paintpalette") }
                Button { app.navigate(.studio(cv: true)) } label: { Label(t("studio.cv.start"), systemImage: "person.text.rectangle") }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        } content: {
            let shown = designs.prefix(size.pick(3, 4, 8))
            if shown.isEmpty {
                Text(t("home.studio.empty")).font(.subheadline).foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity, alignment: size == .large ? .center : .leading)
                    .padding(.vertical, size == .large ? 30 : 0)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: size.pick(110, 140, 200)), spacing: 12)], spacing: 12) {
                    ForEach(Array(shown), id: \.self) { url in
                        Button { app.open(url) } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                ZStack {
                                    Palette.secondary.opacity(0.5)
                                    Image(systemName: "paintpalette").font(.title).foregroundStyle(Palette.mutedForeground)
                                }
                                .aspectRatio(4 / 3, contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                Text(url.deletingPathExtension().lastPathComponent).font(.subheadline.weight(.medium)).lineLimit(1)
                                if let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate {
                                    Text(RelativeMoment.format(date, locale: locale, justNow: t("home.justNow")))
                                        .font(.caption2.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                                }
                            }
                            .padding(8)
                            .background(Palette.card, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.border))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .task { designs = await Self.findDesigns() }
    }

    /// Studio projects saved in the app's folders, newest first.
    static func findDesigns() async -> [URL] {
        await Task.detached(priority: .utility) {
            let fm = FileManager.default
            var found: [URL] = []
            for root in [Workspace.outputFolder, Workspace.supportFolder("Studio")] {
                let enumerator = fm.enumerator(at: root, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])
                while let url = enumerator?.nextObject() as? URL {
                    if enumerator?.level ?? 0 > 2 { enumerator?.skipDescendants() }
                    if url.pathExtension.lowercased() == "vivestudio" { found.append(url) }
                }
            }
            func date(_ url: URL) -> Date { (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast }
            return found.sorted { date($0) > date($1) }
        }.value
    }
}

// MARK: - Tool catalogue on Home

struct ToolCatalogueSection: View {
    let size: HomeSize
    var body: some View {
        VStack(alignment: .leading) {
            ToolBrowser(title: t("home.catalog.title"), collapsible: true, limit: size.pick(6, 12, 24))
        }
        .card(padding: size.padding)
    }
}
