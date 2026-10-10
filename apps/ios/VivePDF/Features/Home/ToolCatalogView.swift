import SwiftUI

/// The Tools tab on iPhone: the twenty tools, then every task shortcut (`toolShortcuts`) with search and
/// group filters, as in the desktop catalogue.
struct ToolCatalogView: View {
    @Environment(AppModel.self) private var app
    @State private var query = ""

    var body: some View {
        MeasuredLayout {
            ToolCatalogBody(query: $query)
        }
        .background(AmbientBackground())
        .navigationTitle(t("nav.tools"))
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: t("home.catalog.search"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { app.showCommandPalette = true } label: { Label(t("palette.title"), systemImage: "command") }
            }
        }
    }
}

private struct ToolCatalogBody: View {
    @Binding var query: String
    @Environment(AppModel.self) private var app
    @Environment(\.layout) private var layout

    private var matchingTools: [ToolID] {
        let needle = TextFolding.fold(query)
        return ToolID.navigable.filter { needle.isEmpty || TextFolding.fold(t($0.labelKey)).contains(needle) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                let tools = matchingTools
                if !tools.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Eyebrow(text: t("nav.tools"))
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: layout.isCompact ? 96 : 120), spacing: 10)], spacing: 10) {
                            ForEach(tools) { tool in
                                Button { app.navigate(.tool(tool)) } label: {
                                    QuickActionTile(tool: ToolShortcut(id: tool.rawValue, labelKey: tool.labelKey, route: .tool(tool),
                                                                       group: tool.tone, symbol: tool.symbol, keywords: ""),
                                                    size: .small)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                ToolBrowser(externalQuery: query, sectionsWhenAll: true)
            }
            .frame(maxWidth: min(layout.width - layout.gutter * 2, 1200), alignment: .leading)
            .padding(.horizontal, layout.gutter)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

/// Searchable, filterable grid of tool shortcuts (`ToolBrowser.tsx`). Used by the Tools tab, the Home
/// catalogue section and the quick-access picker (`onPick`).
struct ToolBrowser: View {
    var title: String? = nil
    /// When set, the search text comes from outside (e.g. `.searchable`) and no field is drawn.
    var externalQuery: String? = nil
    var collapsible = false
    var grouped = false
    /// Shows group sections while no filter chip or search is active (Tools tab).
    var sectionsWhenAll = false
    var limit = 12
    var onPick: ((ToolShortcut) -> Void)? = nil
    var isPicked: ((ToolShortcut) -> Bool)? = nil

    @Environment(AppModel.self) private var app
    @State private var ownQuery = ""
    @State private var group: Tone?
    @State private var showAll = false

    private var query: String { externalQuery ?? ownQuery }

    private var results: [ToolShortcut] {
        ToolCatalog.shortcuts.filter { (grouped || group == nil || $0.group == group) && $0.matches(query) }
    }

    var body: some View {
        let results = results
        let collapse = collapsible && query.trimmingCharacters(in: .whitespaces).isEmpty && group == nil && results.count > limit
        let shown = collapse && !showAll ? Array(results.prefix(limit)) : results
        VStack(alignment: .leading, spacing: 14) {
            if title != nil || externalQuery == nil {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        if let title { Eyebrow(text: title) }
                        Spacer(minLength: 8)
                        if externalQuery == nil { InlineSearchField(placeholder: t("home.catalog.search"), text: $ownQuery).frame(maxWidth: 300) }
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        if let title { Eyebrow(text: title) }
                        if externalQuery == nil { InlineSearchField(placeholder: t("home.catalog.search"), text: $ownQuery) }
                    }
                }
            }
            if !grouped { filterChips }
            if results.isEmpty {
                Text(t("home.catalog.empty")).font(.subheadline).foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity).padding(.vertical, 30)
            } else if grouped || (sectionsWhenAll && group == nil && query.trimmingCharacters(in: .whitespaces).isEmpty) {
                ForEach(ToolCatalog.groups) { tone in
                    let items = results.filter { $0.group == tone }
                    if !items.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                Image(systemName: tone.symbol).foregroundStyle(tone.color).font(.caption)
                                Eyebrow(text: t(tone.labelKey))
                                Text("\(items.count)").font(.caption2.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                            }
                            grid(items)
                        }
                    }
                }
            } else {
                grid(shown)
            }
            if collapse {
                Button(showAll ? t("home.showLess") : "\(t("home.showAll")) · \(results.count)") { withAnimation { showAll.toggle() } }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(label: t("home.catalog.all"), count: ToolCatalog.shortcuts.count, symbol: nil, tone: nil)
                ForEach(ToolCatalog.groups) { tone in
                    chip(label: t(tone.labelKey), count: ToolCatalog.shortcuts(in: tone).count, symbol: tone.symbol, tone: tone)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func chip(label: String, count: Int, symbol: String?, tone: Tone?) -> some View {
        let selected = group == tone
        let color = tone?.color ?? Palette.primary
        return Button { withAnimation(.snappy) { group = tone } } label: {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).font(.caption).foregroundStyle(color) }
                Text(label).font(.subheadline.weight(selected ? .semibold : .regular)).lineLimit(1)
                Text("\(count)").font(.caption.monospacedDigit()).opacity(0.6)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .foregroundStyle(selected ? color : Palette.foreground)
            .background(selected ? (tone?.soft ?? Palette.accent) : Palette.card, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? color.opacity(0.45) : Palette.border))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func grid(_ items: [ToolShortcut]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 10)], spacing: 10) {
            ForEach(items) { tool in
                let picked = isPicked?(tool) ?? false
                Button {
                    if let onPick { onPick(tool) } else { app.navigate(tool.route) }
                } label: { ToolCard(tool: tool, picked: picked) }
                    .buttonStyle(.plain)
                    .disabled(picked)
            }
        }
    }
}

struct ToolCard: View {
    let tool: ToolShortcut
    var picked = false

    var body: some View {
        HStack(spacing: 12) {
            ToneTile(symbol: tool.symbol, tone: tool.group.color, soft: tool.group.soft, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(tool.label).font(.subheadline.weight(.medium)).lineLimit(2)
                if !tool.detail.isEmpty {
                    Text(tool.detail).font(.caption).foregroundStyle(Palette.mutedForeground).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if picked { Image(systemName: "checkmark").foregroundStyle(Palette.primary) }
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .background(Palette.card.opacity(0.7), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.border))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .opacity(picked ? 0.6 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}
