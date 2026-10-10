import SwiftUI
import UniformTypeIdentifiers

/// Adaptive shell. Regular width (iPad, iPad split view ≥ ½, large iPhones in landscape) gets a sidebar
/// split view like the desktop app; compact width (iPhone, Slide Over, narrow split view) gets a tab bar.
/// The decision follows the horizontal size class, so it updates live on rotation and multitasking.
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        @Bindable var app = app
        @Bindable var documents = app.documents
        Group {
            if sizeClass == .compact {
                CompactShell()
            } else {
                RegularShell()
            }
        }
        .tint(Palette.primary)
        .preferredColorScheme(app.theme.colorScheme)
        .environment(\.layoutDirection, app.l10n.locale.layoutDirection)
        .environment(\.locale, app.l10n.locale.foundationLocale)
        .onOpenURL { url in app.open(url) }
        .fileImporter(isPresented: $app.showOpenPicker, allowedContentTypes: [.pdf], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { urls.forEach(app.open) }
        }
        .sheet(item: $documents.pendingPassword) { pending in
            PasswordPrompt(pending: pending) { password in
                if app.documents.open(pending.url, password: password) != nil { app.navigate(.viewer) }
            }
        }
        .sheet(isPresented: $app.showCommandPalette) { CommandPaletteView() }
        .alert(t("home.error.title"), isPresented: Binding(get: { documents.lastError != nil }, set: { if !$0 { documents.lastError = nil } })) {
            Button(t("common.close"), role: .cancel) {}
        } message: { Text(documents.lastError ?? "") }
        .dropDestination(for: URL.self) { urls, _ in
            urls.forEach(app.open)
            return !urls.isEmpty
        }
    }
}

// MARK: - Regular width: sidebar + detail

private struct RegularShell: View {
    @Environment(AppModel.self) private var app
    @State private var columns: NavigationSplitViewVisibility = .automatic

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 340)
        } detail: {
            NavigationStack {
                RouteView(route: app.route)
                    .id(app.route.section)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: app.route.section) { _, section in
            // Full-bleed work surfaces get the whole window; the sidebar stays one tap away.
            if ["viewer", "studio", "pages"].contains(section) { columns = .detailOnly }
        }
    }
}

private struct Sidebar: View {
    @Environment(AppModel.self) private var app

    private var selection: Binding<String?> {
        Binding(get: { app.route.section }, set: { section in
            guard let section, let route = Sidebar.route(for: section) else { return }
            app.navigate(route)
        })
    }

    static func route(for section: String) -> Route? {
        switch section {
        case "home": .home
        case "viewer": .viewer
        case "pages": .pages
        case "studio": .studio()
        case "search": .search
        case "settings": .settings()
        case "about": .about
        default:
            section.hasPrefix("tool.") ? ToolID(rawValue: String(section.dropFirst(5))).map { .tool($0) } : nil
        }
    }

    var body: some View {
        List(selection: selection) {
            Section {
                ForEach([Route.home, .viewer, .pages, .studio(), .search], id: \.section) { route in
                    Label(t(route.labelKey), systemImage: route.symbol).tag(route.section as String?)
                        .badge(route == .viewer ? app.documents.documents.count : 0)
                }
            }
            ForEach(ToolCatalog.groups) { group in
                let tools = ToolID.navigable.filter { $0.tone == group }
                if !tools.isEmpty {
                    Section(t(group.labelKey)) {
                        ForEach(tools) { tool in
                            Label {
                                Text(t(tool.labelKey))
                            } icon: {
                                Image(systemName: tool.symbol).foregroundStyle(tool.tone.color)
                            }
                            .tag("tool.\(tool.rawValue)" as String?)
                        }
                    }
                }
            }
            Section {
                Label(t("nav.settings"), systemImage: "gearshape").tag("settings" as String?)
                Label(t("nav.about"), systemImage: "info.circle").tag("about" as String?)
            }
        }
        .navigationTitle("vivePDF")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { app.showOpenPicker = true } label: { Label(t("common.openPdf"), systemImage: "plus") }
                    .keyboardShortcut("o", modifiers: .command)
            }
            ToolbarItem(placement: .secondaryAction) {
                Button { app.showCommandPalette = true } label: { Label(t("palette.title"), systemImage: "command") }
                    .keyboardShortcut("k", modifiers: .command)
            }
        }
    }
}

// MARK: - Compact width: tab bar

enum CompactTab: String, Hashable {
    case home, viewer, pages, tools, studio

    static func of(_ route: Route) -> CompactTab {
        switch route {
        case .home, .search, .settings, .about: .home
        case .viewer: .viewer
        case .pages: .pages
        case .studio: .studio
        case .tool: .tools
        }
    }
}

private struct CompactShell: View {
    @Environment(AppModel.self) private var app
    @State private var homePath: [Route] = []
    @State private var toolsPath: [Route] = []

    private var tab: Binding<CompactTab> {
        Binding(get: { CompactTab.of(app.route) }, set: { newTab in
            guard newTab != CompactTab.of(app.route) else {
                // Re-tapping a tab pops to its root, as in every iOS app.
                if newTab == .home { homePath = []; app.route = .home }
                if newTab == .tools { toolsPath = [] }
                return
            }
            switch newTab {
            case .home: app.navigate(homePath.last ?? .home)
            case .viewer: app.navigate(.viewer)
            case .pages: app.navigate(.pages)
            case .studio: app.navigate(.studio())
            case .tools: app.navigate(toolsPath.last ?? .tool(.merge))
            }
        })
    }

    var body: some View {
        TabView(selection: tab) {
            NavigationStack(path: $homePath) {
                HomeView().navigationDestination(for: Route.self) { RouteView(route: $0) }
            }
            .tabItem { Label(t("nav.home"), systemImage: "house") }
            .tag(CompactTab.home)

            NavigationStack { ViewerView() }
                .tabItem { Label(t("nav.viewer"), systemImage: "book") }
                .tag(CompactTab.viewer)
                .badge(app.documents.documents.count)

            NavigationStack { PagesView() }
                .tabItem { Label(t("nav.pages"), systemImage: "square.grid.2x2") }
                .tag(CompactTab.pages)

            NavigationStack(path: $toolsPath) {
                ToolCatalogView().navigationDestination(for: Route.self) { RouteView(route: $0) }
            }
            .tabItem { Label(t("nav.tools"), systemImage: "wrench.and.screwdriver") }
            .tag(CompactTab.tools)

            NavigationStack { StudioView(startWithCV: app.route == .studio(cv: true)) }
                .tabItem { Label(t("nav.studio"), systemImage: "paintpalette") }
                .tag(CompactTab.studio)
        }
        .onAppear { sync(app.route) }
        .onChange(of: app.route) { _, route in sync(route) }
    }

    /// Mirrors global navigation (e.g. "Open in viewer", catalog taps) into the per-tab stacks.
    private func sync(_ route: Route) {
        switch route {
        case .search, .settings, .about:
            if homePath.last != route { homePath = [route] }
        case .home:
            homePath = []
        case .tool:
            if toolsPath.last?.section != route.section || toolsPath.last != route { toolsPath = [route] }
        default: break
        }
    }
}

// MARK: - Route → screen

struct RouteView: View {
    let route: Route

    var body: some View {
        switch route {
        case .home: HomeView()
        case .viewer: ViewerView()
        case .pages: PagesView()
        case .studio(let cv): StudioView(startWithCV: cv)
        case .search: SearchView()
        case .settings(let section): SettingsView(section: section)
        case .about: AboutView()
        case .tool(let tool, let tab): ToolRouteView(tool: tool, tab: tab)
        }
    }
}

struct ToolRouteView: View {
    let tool: ToolID
    let tab: String?

    var body: some View {
        switch tool {
        case .merge: MergeToolView(tab: tab)
        case .split: SplitToolView(tab: tab)
        case .compress: CompressToolView(tab: tab)
        case .convert: ConvertToolView(tab: tab)
        case .create: CreateToolView(tab: tab)
        case .ocr: OCRToolView(tab: tab)
        case .scan: ScanToolView(tab: tab)
        case .edit: EditToolView(tab: tab)
        case .codes: CodesToolView(tab: tab)
        case .omr: OMRToolView(tab: tab)
        case .security: SecurityToolView(tab: tab)
        case .sign: SignToolView(tab: tab)
        case .forms: FormsToolView(tab: tab)
        case .compare: CompareToolView(tab: tab)
        case .access: AccessToolView(tab: tab)
        case .preflight: PreflightToolView(tab: tab)
        case .pdfa: PDFAToolView(tab: tab)
        case .rename: RenameToolView(tab: tab)
        case .batch: BatchToolView(tab: tab)
        case .watch: WatchToolView(tab: tab)
        case .pageTools: PageToolsView(tab: tab)
        }
    }
}
