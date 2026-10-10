import SwiftUI

/// "Customize home" (`HomeLayoutEditor.tsx`): reorder sections by dragging, move them between regions,
/// resize, hide/show, edit quick access, and pick the side column's side and width.
struct HomeLayoutEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var pickingTools = false
    @State private var confirmReset = false
    private var store: HomeLayoutStore { .shared }

    var body: some View {
        let layout = store.layout
        NavigationStack {
            List {
                Section {
                    Text(t("home.layout.editingHint"))
                        .font(.footnote).foregroundStyle(Palette.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(HomeRegion.allCases) { region in
                    let visible = layout.sections(in: region)
                    Section(t("home.layout.regions.\(region.rawValue)")) {
                        if visible.isEmpty {
                            Text(t("home.layout.dropHere")).font(.footnote).foregroundStyle(Palette.mutedForeground)
                        }
                        ForEach(visible) { section in SectionRow(section: section) }
                            .onMove { from, to in
                                guard let first = from.first else { return }
                                let id = visible[first].id
                                store.change { $0.moving(id, to: region, at: to) }
                            }
                    }
                }
                let hidden = layout.hiddenSections
                if !hidden.isEmpty {
                    Section(t("home.layout.hiddenLabel")) {
                        ForEach(hidden) { section in
                            HStack {
                                Label(t(section.id.titleKey), systemImage: "eye.slash").foregroundStyle(Palette.mutedForeground)
                                Spacer()
                                Button(t("home.layout.showShort")) { store.change { $0.updating(section.id) { $0.hidden = false } } }
                                    .buttonStyle(.bordered)
                                    .accessibilityLabel(t("home.layout.show", ["name": t(section.id.titleKey)]))
                            }
                        }
                    }
                }
                Section {
                    ForEach(layout.quickActions.compactMap(ToolCatalog.shortcut)) { tool in
                        Label { Text(tool.label) } icon: { Image(systemName: tool.symbol).foregroundStyle(tool.group.color) }
                    }
                    .onMove { from, to in
                        var ids = layout.quickActions
                        ids.move(fromOffsets: from, toOffset: to)
                        var next = layout
                        next.quickActions = ids
                        store.replace(next)
                    }
                    .onDelete { offsets in
                        let ids = offsets.map { layout.quickActions[$0] }
                        store.change { current in ids.reduce(current) { $0.removingQuickAction($1) } }
                    }
                    Button { pickingTools = true } label: { Label(t("home.layout.quick.add"), systemImage: "plus") }
                        .disabled(layout.quickActions.count >= HomeLayout.maxQuickActions)
                } header: {
                    Text(t("home.quickActions"))
                } footer: {
                    if layout.quickActions.count >= HomeLayout.maxQuickActions {
                        Text(t("home.layout.quick.full", ["count": HomeLayout.maxQuickActions]))
                    } else {
                        Text(t("home.layout.quick.dragHint"))
                    }
                }
                Section(t("home.layout.regions.side")) {
                    Picker(t("home.layout.sidebarSide"), selection: Binding(get: { layout.sidebar.side }, set: { side in
                        store.change { var copy = $0; copy.sidebar.side = side; return copy }
                    })) {
                        ForEach(SidebarSide.allCases) { Text(t("home.layout.sides.\($0.rawValue)")).tag($0) }
                    }
                    Picker(t("home.layout.sidebarWidth"), selection: Binding(get: { layout.sidebar.width }, set: { width in
                        store.change { var copy = $0; copy.sidebar.width = width; return copy }
                    })) {
                        ForEach(SidebarWidth.allCases) { Text(t("home.layout.widths.\($0.rawValue)")).tag($0) }
                    }
                }
                Section {
                    Button(role: .destructive) { confirmReset = true } label: { Label(t("home.layout.reset"), systemImage: "arrow.counterclockwise") }
                }
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle(t("home.layout.editing"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(t("home.layout.done")) { dismiss() } }
            }
            .confirmationDialog(t("home.layout.reset"), isPresented: $confirmReset, titleVisibility: .visible) {
                Button(t("home.layout.reset"), role: .destructive) { store.replace(.standard) }
                Button(t("common.cancel"), role: .cancel) {}
            }
            .sheet(isPresented: $pickingTools) { QuickActionPicker() }
        }
    }
}

private struct SectionRow: View {
    let section: HomeSectionLayout
    private var store: HomeLayoutStore { .shared }

    var body: some View {
        let title = t(section.id.titleKey)
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                Text(title).lineLimit(2)
                Spacer(minLength: 8)
                controls(title)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                HStack(spacing: 8) { controls(title) }
            }
        }
    }

    @ViewBuilder
    private func controls(_ title: String) -> some View {
        Menu {
            Picker(t("home.layout.sizeOf", ["name": title]), selection: Binding(get: { section.size }, set: { size in
                store.change { $0.updating(section.id) { $0.size = size } }
            })) {
                ForEach(HomeSize.allCases) { Text(t("home.layout.sizes.\($0.rawValue)")).tag($0) }
            }
            Picker(t("home.layout.regionOf", ["name": title]), selection: Binding(get: { section.region }, set: { region in
                store.change { $0.moving(section.id, to: region, at: Int.max) }
            })) {
                ForEach(HomeRegion.allCases) { Text(t("home.layout.regions.\($0.rawValue)")).tag($0) }
            }
            Divider()
            Button { store.change { $0.shifting(section.id, by: -1) } } label: { Label(t("home.layout.moveUp", ["name": title]), systemImage: "arrow.up") }
            Button { store.change { $0.shifting(section.id, by: 1) } } label: { Label(t("home.layout.moveDown", ["name": title]), systemImage: "arrow.down") }
        } label: {
            Text(t("home.layout.sizes.\(section.size.rawValue)")).font(.caption)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Palette.muted, in: Capsule())
        }
        .accessibilityLabel(t("home.layout.sizeOf", ["name": title]))
        Button { store.change { $0.updating(section.id) { $0.hidden = true } } } label: { Image(systemName: "eye.slash") }
            .buttonStyle(.borderless)
            .accessibilityLabel(t("home.layout.hide", ["name": title]))
    }
}

private struct QuickActionPicker: View {
    @Environment(\.dismiss) private var dismiss
    private var store: HomeLayoutStore { .shared }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(t("home.layout.quick.pickHint", ["count": store.layout.quickActions.count, "max": HomeLayout.maxQuickActions]))
                        .font(.footnote).foregroundStyle(Palette.mutedForeground)
                    ToolBrowser(grouped: true,
                                onPick: { tool in store.change { $0.addingQuickAction(tool.id) } },
                                isPicked: { store.layout.quickActions.contains($0.id) })
                }
                .padding()
            }
            .navigationTitle(t("home.layout.quick.pickTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("home.layout.done")) { dismiss() } } }
        }
    }
}
