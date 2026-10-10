import SwiftUI

/// Ornaments section of the elements panel: five categories of decorative art in a three-column grid.
/// Inserted art takes the design palette's first two colours (`paletteColours`); page frames and
/// patterns cover the whole page, everything else is centred at 40 % of the shorter side.
struct StudioOrnamentsPanel: View {
    let pageSize: CGSize
    var palette: [String] = []
    /// Receives the new element. Page-filling art sits at (0, 0) and should not be cascaded.
    let onInsert: (StudioElement) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(t("studio.elements.ornaments")).font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(Palette.mutedForeground)
            ForEach(StudioOrnaments.Category.allCases) { category in
                VStack(alignment: .leading, spacing: 6) {
                    Text(t(category.labelKey)).font(.caption).foregroundStyle(Palette.mutedForeground)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        ForEach(StudioOrnaments.all.filter { $0.category == category }) { item in
                            Button { insert(item) } label: {
                                StudioOrnamentPreview(id: item.id)
                                    .padding(6)
                                    .aspectRatio(1, contentMode: .fit)
                                    .frame(maxWidth: .infinity)
                                    .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.border))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(t(item.labelKey))
                            .hoverEffect(.lift)
                        }
                    }
                }
            }
        }
    }

    private func insert(_ item: StudioOrnaments.Ornament) {
        let element = StudioOrnaments.element(item, colors: StudioOrnaments.paletteColors(palette), pageWidth: pageSize.width, pageHeight: pageSize.height, name: t(item.labelKey))
        onInsert(element)
    }
}

/// Preview of an ornament in the default colours, rasterised once off the main thread.
struct StudioOrnamentPreview: View {
    let id: String
    @Environment(\.displayScale) private var displayScale
    @State private var image: CGImage?

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if let image {
                    Image(decorative: image, scale: 1).resizable().interpolation(.high).scaledToFit()
                } else {
                    ProgressView().controlSize(.small)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .task(id: Int(proxy.size.width * displayScale)) {
                let side = max(48, min(proxy.size.width, proxy.size.height) * displayScale)
                let key = "ornament|\(id)|\(Int(side))"
                let id = id
                image = await StudioThumbnailCache.shared.render(key: key) {
                    guard let item = StudioOrnaments.ornament(id) else { return nil }
                    let art = item.build(StudioOrnaments.defaultColors, item.size)
                    return StudioArtPainter.image(art.paths, viewWidth: art.viewWidth, viewHeight: art.viewHeight, side: side)
                }
            }
        }
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityHidden(true)
    }
}
