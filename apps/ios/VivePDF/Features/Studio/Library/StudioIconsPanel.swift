import SwiftUI

/// Icons section of the elements panel (`IconsSection.tsx`): search, the twelve best matches, and a
/// full library browser with categories. Tapping an icon inserts it as a vector element.
struct StudioIconsPanel: View {
    let pageSize: CGSize
    /// Design palette; icons take its first colour like the desktop.
    var palette: [String] = []
    let onInsert: (StudioElement) -> Void

    @State private var query = ""
    @State private var browsing = false
    @State private var terms: StudioIcons.LocalTerms = [:]
    @Environment(AppModel.self) private var app

    private static let shown = 12

    var body: some View {
        let results = Array(StudioIcons.search(query, local: terms).prefix(Self.shown))
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(t("studio.icons.title")).font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(Palette.mutedForeground)
                Spacer(minLength: 8)
                Button { browsing = true } label: {
                    HStack(spacing: 2) {
                        Text(t("studio.icons.seeAll"))
                        Image(systemName: "chevron.forward").font(.caption)
                    }
                    .font(.footnote.weight(.medium))
                }
                .buttonStyle(.borderless)
                .disabled(StudioIcons.entries.isEmpty)
            }
            StudioIconSearchField(text: $query)
            if StudioIcons.entries.isEmpty {
                Label(t("studio.icons.errorTitle"), systemImage: "exclamationmark.triangle").font(.callout).foregroundStyle(Palette.mutedForeground)
            } else if results.isEmpty {
                StudioIconsEmpty(query: query) { query = "" }
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 6), spacing: 6) {
                    ForEach(results) { entry in
                        Button { insert(entry) } label: {
                            StudioIconGlyph(name: entry.name)
                                .frame(width: 20, height: 20)
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(Palette.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Palette.border))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(t("studio.icons.insert", ["name": entry.label]))
                        .hoverEffect(.highlight)
                    }
                }
            }
        }
        .task(id: app.l10n.locale) { terms = StudioIcons.localTerms() }
        .sheet(isPresented: $browsing) {
            StudioIconBrowser(initialQuery: query, terms: terms) { entry in
                insert(entry)
                browsing = false
            }
        }
    }

    private func insert(_ entry: StudioIcons.Entry) {
        if let element = StudioIcons.element(entry, pageWidth: pageSize.width, pageHeight: pageSize.height, palette: palette) { onInsert(element) }
    }
}

/// The full icon library ("See all"): search, category chips, labelled grid.
struct StudioIconBrowser: View {
    let initialQuery: String
    let terms: StudioIcons.LocalTerms
    let onPick: (StudioIcons.Entry) -> Void
    @State private var query = ""
    @State private var category: StudioIcons.Category?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let results = StudioIcons.search(query, category: category, local: terms)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    StudioIconSearchField(text: $query)
                    StudioFlowLayout(spacing: 6) {
                        chip(nil)
                        ForEach(StudioIcons.Category.allCases) { chip($0) }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(t("studio.icons.categoriesLabel"))
                    Text(t("studio.icons.count", ["count": results.count])).font(.caption).foregroundStyle(Palette.mutedForeground)
                    if results.isEmpty {
                        StudioIconsEmpty(query: query) {
                            query = ""
                            category = nil
                        }
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 8)], spacing: 8) {
                            ForEach(results) { entry in
                                Button { onPick(entry) } label: {
                                    VStack(spacing: 6) {
                                        StudioIconGlyph(name: entry.name).frame(width: 28, height: 28)
                                        Text(entry.label).font(.caption2).foregroundStyle(Palette.mutedForeground).lineLimit(1).truncationMode(.tail)
                                    }
                                    .padding(.horizontal, 4)
                                    .frame(maxWidth: .infinity, minHeight: 84)
                                    .background(Palette.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.border))
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(t("studio.icons.insert", ["name": entry.label]))
                                .hoverEffect(.highlight)
                            }
                        }
                    }
                    Text(t("studio.icons.credit")).font(.caption).foregroundStyle(Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(t("studio.icons.library"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { query = initialQuery }
    }

    private func chip(_ value: StudioIcons.Category?) -> some View {
        let active = category == value
        return Button { category = value } label: {
            Text(value.map { t($0.labelKey) } ?? t("studio.icons.all"))
                .font(.footnote.weight(active ? .semibold : .regular))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .foregroundStyle(active ? Palette.primary : Palette.mutedForeground)
                .background(active ? Palette.accent : Color.clear, in: Capsule())
                .overlay(Capsule().strokeBorder(active ? Palette.primary.opacity(0.4) : Palette.border))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

struct StudioIconSearchField: View {
    @Binding var text: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.mutedForeground)
            TextField(t("studio.icons.search"), text: $text)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(t("studio.icons.clearSearch"))
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.border))
    }
}

private struct StudioIconsEmpty: View {
    let query: String
    let clear: () -> Void
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.title2).foregroundStyle(Palette.mutedForeground)
            Text(t("studio.icons.emptyTitle")).font(.subheadline.weight(.semibold))
            Text(t("studio.icons.emptyHint", ["query": query])).font(.caption).foregroundStyle(Palette.mutedForeground).multilineTextAlignment(.center)
            Button(t("studio.icons.clearSearch"), action: clear).buttonStyle(.bordered).controlSize(.small)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
}

/// An icon drawn in the current foreground colour (`IconGlyph`): outlines stroked, filled parts filled.
struct StudioIconGlyph: View {
    let name: String
    var body: some View {
        Canvas { context, size in
            guard let art = StudioIcons.art(name, color: "#000000") else { return }
            let scale = min(size.width, size.height) / CGFloat(StudioIcons.viewSize)
            var transform = CGAffineTransform(scaleX: scale, y: scale)
            let shading = GraphicsContext.Shading.style(.foreground)
            for path in art.paths {
                guard let scaled = StudioPath.cgPath(path.d).copy(using: &transform) else { continue }
                let shape = Path(scaled)
                if case .solid = path.fill { context.fill(shape, with: shading) }
                if let stroke = path.stroke {
                    context.stroke(shape, with: shading, style: StrokeStyle(lineWidth: stroke.width * scale, lineCap: .round, lineJoin: .round))
                }
            }
        }
        .foregroundStyle(Palette.foreground)
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityHidden(true)
    }
}
