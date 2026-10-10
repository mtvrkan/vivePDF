import SwiftUI

/// Home dashboard (`features/home/HomePage.tsx`). One column on iPhone and narrow windows; on wide iPad
/// windows the "side" region becomes a second column whose side and width follow the saved layout.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var editing = false
    private var store: HomeLayoutStore { .shared }

    var body: some View {
        MeasuredLayout {
            HomeDashboard(onCustomize: { editing = true })
        }
        .background(AmbientBackground())
        .navigationTitle(t("home.title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .sheet(isPresented: $editing) { HomeLayoutEditor() }
        .onAppear { consumeEditRequest() }
        .onChange(of: store.editRequested) { _, _ in consumeEditRequest() }
    }

    private func consumeEditRequest() {
        guard store.editRequested else { return }
        store.editRequested = false
        editing = true
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button { app.showOpenPicker = true } label: { Label(t("common.openPdf"), systemImage: "plus") }
        }
        if sizeClass == .compact {
            ToolbarItem(placement: .secondaryAction) {
                Menu {
                    Button { app.showCommandPalette = true } label: { Label(t("palette.title"), systemImage: "command") }
                    Button { app.navigate(.search) } label: { Label(t("nav.folderSearch"), systemImage: "magnifyingglass") }
                    Button { editing = true } label: { Label(t("home.layout.edit"), systemImage: "rectangle.3.group") }
                    Divider()
                    Button { app.navigate(.settings()) } label: { Label(t("nav.settings"), systemImage: "gearshape") }
                    Button { app.navigate(.about) } label: { Label(t("nav.about"), systemImage: "info.circle") }
                } label: { Label(t("nav.settings"), systemImage: "ellipsis.circle") }
            }
        } else {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { app.showCommandPalette = true } label: { Label(t("palette.title"), systemImage: "command") }
                Button { editing = true } label: { Label(t("home.layout.edit"), systemImage: "rectangle.3.group") }
                Button { app.navigate(.settings()) } label: { Label(t("nav.settings"), systemImage: "gearshape") }
            }
        }
    }
}

private struct HomeDashboard: View {
    let onCustomize: () -> Void
    @Environment(\.layout) private var layout
    private var store: HomeLayoutStore { .shared }

    var body: some View {
        let homeLayout = store.layout
        let side = homeLayout.sections(in: .side)
        let twoColumns = layout.width >= 860 && !side.isEmpty && !homeLayout.sections(in: .main).isEmpty
        let sideWidth = min(homeLayout.sidebar.width.points, layout.width * 0.42)
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if homeLayout.sections.allSatisfy(\.hidden) {
                    EmptyStateView(symbol: "rectangle.3.group", title: t("home.layout.emptySection"),
                                   actionTitle: t("home.layout.edit"), action: onCustomize)
                }
                region(.top)
                if twoColumns {
                    HStack(alignment: .top, spacing: 20) {
                        if homeLayout.sidebar.side == .start { region(.side).frame(width: sideWidth) }
                        region(.main).frame(maxWidth: .infinity)
                        if homeLayout.sidebar.side == .end { region(.side).frame(width: sideWidth) }
                    }
                } else {
                    region(.main)
                    region(.side)
                }
                region(.bottom)
            }
            .frame(maxWidth: 1400, alignment: .leading)
            .padding(.horizontal, layout.gutter)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private func region(_ region: HomeRegion) -> some View {
        let sections = store.layout.sections(in: region)
        if !sections.isEmpty {
            VStack(alignment: .leading, spacing: 20) {
                ForEach(sections) { section in
                    HomeSectionContent(section: section)
                }
            }
        }
    }
}

struct HomeSectionContent: View {
    let section: HomeSectionLayout

    var body: some View {
        switch section.id {
        case .hero: HeroSection(size: section.size)
        case .quickActions: QuickActionsSection(size: section.size)
        case .recent: RecentSection(size: section.size)
        case .studio: StudioSection(size: section.size)
        case .collections: CollectionsSection(size: section.size)
        case .tools: ToolCatalogueSection(size: section.size)
        case .continue: ContinueSection(size: section.size)
        case .history: HistorySection(size: section.size)
        case .stats: StatsSection(size: section.size)
        }
    }
}
