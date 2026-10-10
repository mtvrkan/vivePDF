import SwiftUI

/// Template picker (`TemplateGallery.tsx`): search, category filter (chips when narrow, a category list
/// with counts when wide), per-category sections with "See all", lazily rendered previews.
/// Not scrollable itself, so it can sit inside the start screen's ScrollView or a sheet's.
struct StudioTemplateGallery: View {
    let language: String
    /// Preview box edge in points (desktop: 140 on the start screen, 104 in the editor panel).
    var box: CGFloat = 140
    let onPick: (StudioDesign) -> Void

    private enum Filter: Hashable { case all, category(StudioTemplates.Category) }

    @State private var query = ""
    @State private var filter: Filter = .all
    @State private var width: CGFloat = 0
    @Environment(\.layout) private var layout

    private static let cardPadding: CGFloat = 26
    private static let gap: CGFloat = 12

    private var wideCards: Bool { box >= 140 }
    /// Category list beside results once the gallery itself is wide enough (`@3xl` ≈ 768 pt).
    private var sidebar: Bool { wideCards && width >= 768 && !layout.isCompact }
    private var gridWidth: CGFloat { sidebar ? width - 208 - 20 : width }
    private var columns: Int { max(1, Int((gridWidth + Self.gap) / (box + Self.cardPadding + Self.gap))) }
    private var sectionLimit: Int { max(2, columns * (wideCards ? 1 : 2)) }

    private var matching: [StudioTemplates.Info] { StudioTemplates.search(query, language: language) }

    var body: some View {
        let matching = matching
        Group {
            if sidebar {
                HStack(alignment: .top, spacing: 20) {
                    categoryList(matching).frame(width: 208)
                    VStack(alignment: .leading, spacing: 12) {
                        searchField
                        results(matching)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    searchField
                    chips
                    results(matching)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    // MARK: Pieces

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.mutedForeground)
            TextField(t("studio.templates.search"), text: $query)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(t("studio.templates.clearSearch"))
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.border))
        .accessibilityElement(children: .contain)
    }

    private var chips: some View {
        StudioFlowLayout(spacing: 6) {
            chip(.all)
            ForEach(StudioTemplates.Category.allCases) { chip(.category($0)) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("studio.templates.categoriesLabel"))
    }

    private func label(_ item: Filter) -> String {
        switch item {
        case .all: t("studio.templates.all")
        case .category(let c): t(c.labelKey)
        }
    }

    private func chip(_ item: Filter) -> some View {
        let active = filter == item
        return Button { withAnimation(.snappy) { filter = item } } label: {
            Text(label(item))
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

    private func categoryList(_ matching: [StudioTemplates.Info]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach([Filter.all] + StudioTemplates.Category.allCases.map(Filter.category), id: \.self) { item in
                let active = filter == item
                let count = count(of: item, in: matching)
                Button { filter = item } label: {
                    HStack(spacing: 10) {
                        Image(systemName: symbol(item))
                            .frame(width: 20)
                            .foregroundStyle(active ? Palette.primary : Palette.mutedForeground)
                        Text(label(item)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                        Text("\(count)").font(.caption.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                    }
                    .font(.subheadline.weight(active ? .medium : .regular))
                    .foregroundStyle(active ? Palette.foreground : Palette.mutedForeground)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 36)
                    .background(active ? Palette.accent : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("studio.templates.categoriesLabel"))
    }

    private func symbol(_ item: Filter) -> String {
        switch item {
        case .all: "square.grid.2x2"
        case .category(let c): c.symbol
        }
    }

    private func count(of item: Filter, in matching: [StudioTemplates.Info]) -> Int {
        switch item {
        case .all: matching.count
        case .category(let c): matching.filter { $0.category == c }.count
        }
    }

    @ViewBuilder
    private func results(_ matching: [StudioTemplates.Info]) -> some View {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if filter == .all && needle.isEmpty {
            VStack(alignment: .leading, spacing: 22) {
                ForEach(StudioTemplates.Category.allCases) { category in
                    let items = matching.filter { $0.category == category }
                    if !items.isEmpty { section(category, items) }
                }
            }
        } else {
            let shown = filter == .all ? matching : matching.filter { if case .category(let c) = filter { $0.category == c } else { true } }
            if shown.isEmpty {
                emptyState
            } else {
                grid(shown)
            }
        }
    }

    private func section(_ category: StudioTemplates.Category, _ items: [StudioTemplates.Info]) -> some View {
        let name = t(category.labelKey)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: category.symbol).foregroundStyle(Palette.primary)
                Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 8)
                if items.count > sectionLimit {
                    Button { withAnimation(.snappy) { filter = .category(category) } } label: {
                        HStack(spacing: 2) {
                            Text(t("studio.templates.seeAll", ["total": items.count]))
                            Image(systemName: "chevron.forward").font(.caption)
                        }
                        .font(.footnote.weight(.medium))
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(t("studio.templates.seeAllIn", ["category": name, "total": items.count]))
                }
            }
            .accessibilityElement(children: .contain)
            grid(Array(items.prefix(sectionLimit)))
        }
    }

    private func grid(_ items: [StudioTemplates.Info]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: box + Self.cardPadding), spacing: Self.gap, alignment: .top)], spacing: Self.gap) {
            ForEach(items) { info in
                StudioTemplateCard(info: info, box: box, language: language) {
                    if let design = StudioTemplates.design(id: info.id, language: language) { onPick(design) }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "rectangle.on.rectangle.slash").font(.system(size: 36, weight: .light)).foregroundStyle(Palette.primary)
            Text(t("studio.templates.noResults")).font(.headline).multilineTextAlignment(.center)
            Text(t("studio.templates.noResultsHint")).font(.callout).foregroundStyle(Palette.mutedForeground).multilineTextAlignment(.center)
            Button(t("studio.templates.showAll")) {
                query = ""
                filter = .all
            }
            .buttonStyle(.borderless)
        }
        .padding(28)
        .frame(maxWidth: .infinity)
    }
}

/// One template card: preview fitted into a square box plus the template name.
struct StudioTemplateCard: View {
    let info: StudioTemplates.Info
    let box: CGFloat
    let language: String
    let action: () -> Void

    var body: some View {
        let scale = box / CGFloat(max(info.width, info.height))
        let name = info.name
        Button(action: action) {
            VStack(spacing: 8) {
                StudioTemplateThumbnail(id: info.id, language: language, box: box)
                    .frame(width: CGFloat(info.width) * scale, height: CGFloat(info.height) * scale)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                    .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(Palette.border))
                    .shadow(color: .black.opacity(0.08), radius: 3, y: 1)
                    .frame(width: box, height: box)
                Text(name)
                    .font(.caption.weight(.medium))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
            .padding(10)
            .frame(maxWidth: .infinity)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
        .hoverEffect(.lift)
    }
}

/// Lazily rendered template preview (first page, empty photo frames as placeholders).
struct StudioTemplateThumbnail: View {
    let id: String
    let language: String
    let box: CGFloat
    @Environment(\.displayScale) private var displayScale
    @State private var image: CGImage?
    @State private var failed = false
    @State private var pulse = false

    private var side: CGFloat { min(640, (box * displayScale * 1.25).rounded(.up)) }
    private var key: String { "\(id)|\(language)|\(Int(side))|\(StudioFonts.shared.revision)" }

    var body: some View {
        ZStack {
            Color.white
            if let image {
                Image(decorative: image, scale: 1).resizable().interpolation(.high)
            } else if !failed {
                Palette.muted.opacity(pulse ? 0.9 : 0.4)
                    .onAppear { withAnimation(.easeInOut(duration: 0.9).repeatForever()) { pulse = true } }
            }
        }
        .task(id: key) {
            if let hit = StudioThumbnailCache.shared.cached(key) { image = hit; return }
            let id = id, language = language, side = side, key = key
            let rendered = await StudioThumbnailCache.shared.render(key: key) {
                guard let page = StudioTemplates.design(id: id, language: language)?.pages.first else { return nil }
                return StudioRenderer.thumbnail(page: StudioTemplates.thumbnailPage(page), side: side, language: language)
            }
            if Task.isCancelled { return }
            image = rendered
            failed = rendered == nil
        }
    }
}

/// Renders library previews two at a time off the main actor and keeps them in memory.
final class StudioThumbnailCache: @unchecked Sendable {
    static let shared = StudioThumbnailCache()
    private let cache = NSCache<NSString, CGImageBox>()
    private let gate = StudioRenderGate(limit: 2)

    final class CGImageBox { let image: CGImage; init(_ image: CGImage) { self.image = image } }

    func cached(_ key: String) -> CGImage? { cache.object(forKey: key as NSString)?.image }

    func render(key: String, _ work: @escaping @Sendable () -> CGImage?) async -> CGImage? {
        if let hit = cached(key) { return hit }
        await gate.enter()
        defer { Task { await gate.leave() } }
        if Task.isCancelled { return nil }
        if let hit = cached(key) { return hit }
        let image = await Task.detached(priority: .utility) { work() }.value
        if let image { cache.setObject(CGImageBox(image), forKey: key as NSString) }
        return image
    }
}

/// A tiny async semaphore.
actor StudioRenderGate {
    private let limit: Int
    private var running = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []

    init(limit: Int) { self.limit = limit }

    func enter() async {
        if running < limit { running += 1; return }
        await withCheckedContinuation { waiting.append($0) }
    }

    func leave() {
        if waiting.isEmpty { running -= 1 } else { waiting.removeFirst().resume() }
    }
}

/// Wrapping row layout for chips (CSS `flex-wrap`), mirroring for right-to-left automatically.
struct StudioFlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth { y += row + spacing; x = 0; row = 0 }
            x += size.width + spacing
            row = max(row, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { y += row + spacing; x = bounds.minX; row = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}
