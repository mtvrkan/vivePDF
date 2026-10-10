import PDFKit
import SwiftUI

/// One open document: page canvas edge to edge, panels (leading column / inspector on iPad, sheets on iPhone),
/// bottom bars (annotate, read aloud), banners, toolbar and every modal the viewer needs.
struct ViewerDocumentView: View {
    @Bindable var session: ViewerSession
    let closer: ViewerCloser
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var shareURL: URL?
    @State private var bookmarkPage: Int?
    @State private var goToPageText = ""

    private var compact: Bool { sizeClass == .compact }
    private var chromeHidden: Bool { session.immersive && session.chromeHidden }

    var body: some View {
        VStack(spacing: 0) {
            if !compact && !session.immersive && app.documents.documents.count > 0 {
                ViewerTabStrip(closer: closer)
            }
            if !chromeHidden {
                ViewerBanners(session: session)
            }
            HStack(spacing: 0) {
                if !compact, !session.immersive, let panel = session.leadingPanel {
                    ViewerPanelContainer(session: session, panel: .leading(panel))
                        .frame(width: panelWidth(panel))
                        .transition(.move(edge: .leading))
                    Divider()
                }
                stage
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomBars }
        .inspector(isPresented: trailingPresented) {
            if let panel = session.trailingPanel {
                ViewerPanelContainer(session: session, panel: .trailing(panel))
                    .inspectorColumnWidth(min: 300, ideal: 360, max: 460)
                    .presentationDetents([.medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
            }
        }
        .sheet(isPresented: leadingSheetPresented) {
            if let panel = session.leadingPanel {
                ViewerPanelContainer(session: session, panel: .leading(panel))
                    .presentationDetents(panel == .search ? [.medium, .large] : [.medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                    .presentationContentInteraction(.scrolls)
            }
        }
        .navigationTitle(session.document.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarTitleMenu { ViewerDocumentsMenu(closer: closer) }
        .toolbar { ViewerToolbarContent(session: session, closer: closer, shareURL: $shareURL) }
        .toolbar(chromeHidden ? .hidden : .visible, for: .navigationBar)
        .toolbar(session.immersive ? .hidden : .automatic, for: .tabBar)
        .statusBarHidden(chromeHidden)
        .persistentSystemOverlays(chromeHidden ? .hidden : .automatic)
        .animation(.easeInOut(duration: 0.2), value: chromeHidden)
        .animation(.snappy, value: session.leadingPanel)
        .background { ViewerShortcuts(session: session, closer: closer) }
        .viewerShareSheet(url: $shareURL)
        .modifier(ViewerBookmarkPrompt(session: session, page: $bookmarkPage))
        .modifier(ViewerModals(session: session, goToPageText: $goToPageText))
        .fullScreenCover(isPresented: $session.presenting) {
            ViewerModules.presentation(session: session)
        }
        .onAppear(perform: appeared)
        .onDisappear {
            ViewerAutoScroller.of(session).stop()
            app.documents.remember(session.document)
        }
        .onChange(of: session.currentPageIndex) { _, _ in scheduleRemember() }
        .onChange(of: session.leadingPanel) { old, new in
            if old == .search && new != .search { ViewerSearchController.of(session).clear() }
        }
    }

    // MARK: Stage

    private var stage: some View {
        ZStack {
            Palette.background.ignoresSafeArea()
            if session.readingMode {
                ViewerModules.readingView(session: session)
            } else if session.splitActive {
                ViewerSplitStage(session: session) { canvas }
            } else {
                canvas
            }
        }
        .overlay(alignment: .bottom) {
            if !chromeHidden && !session.readingMode {
                VStack(spacing: 8) {
                    if session.autoScrolling { ViewerAutoScrollHUD(session: session) }
                    ViewerModules.speechStatus(session: session)
                    ViewerPageControl(session: session)
                }
                .padding(.bottom, 10)
                .padding(.horizontal, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .overlay(alignment: .top) {
            if let toast = session.toast {
                ViewerToastView(toast: toast) { session.toast = nil }
                    .padding(.top, 8)
                    .padding(.horizontal, 16)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .overlay(alignment: .topTrailing) {
            if session.immersive && !session.chromeHidden {
                Button { exitImmersive() } label: {
                    Label(t("viewer.exitFullscreen"), systemImage: "arrow.down.right.and.arrow.up.left")
                        .labelStyle(.iconOnly)
                        .frame(width: 44, height: 44)
                        .background(.thinMaterial, in: Circle())
                }
                .padding(12)
                .accessibilityLabel(t("viewer.exitFullscreen"))
            }
        }
        .animation(.snappy, value: session.toast)
    }

    private var canvas: some View {
        PDFCanvas(session: session) { view in
            ViewerSelectionMenu.install(on: view, session: session, bookmarkPage: $bookmarkPage, shareURL: $shareURL)
            view.onBackgroundTap = { _ in
                if session.autoScrolling { ViewerAutoScroller.of(session).stop(); return }
                if session.immersive { session.chromeHidden.toggle() }
            }
            view.onLinkLongPress = { link, _ in session.linkPreview = link }
        }
        .pageColorScheme(session.pageColors)
        .overlay { ViewerModules.canvasOverlay(session: session) }
        .ignoresSafeArea(.container, edges: session.immersive ? .all : [.bottom, .horizontal])
        .accessibilityLabel(t("viewer.documentPages"))
        .onChange(of: session.highlightFields) { _, on in ViewerFieldHighlights.apply(on, session: session) }
    }

    @ViewBuilder private var bottomBars: some View {
        if !chromeHidden {
            VStack(spacing: 0) {
                if session.showsReadAloud {
                    Divider()
                    ViewerModules.readAloudBar(session: session)
                }
                if session.showsAnnotate {
                    Divider()
                    ViewerModules.annotateBar(session: session)
                }
            }
            .background(.bar)
        }
    }

    // MARK: Panels

    private var trailingPresented: Binding<Bool> {
        Binding(get: { session.trailingPanel != nil && !session.immersive }, set: { if !$0 { session.trailingPanel = nil } })
    }

    private var leadingSheetPresented: Binding<Bool> {
        Binding(get: { compact && session.leadingPanel != nil && !session.immersive }, set: { if !$0 { session.leadingPanel = nil } })
    }

    private func panelWidth(_ panel: LeadingPanel) -> CGFloat {
        panel == .thumbnails ? 200 : 320
    }

    // MARK: Lifecycle

    private func appeared() {
        guard !session.didAppear else { return }
        session.didAppear = true
        if session.leadingPanel == nil, !compact,
           UserDefaults.standard.object(forKey: "vivepdf.viewer.thumbnailsOpen") as? Bool ?? true {
            session.leadingPanel = .thumbnails
        }
        // "Continuing where you left off" with a way back to page 1 (desktop ReadingPositionTracker).
        if session.currentPageIndex > 0 {
            session.show(ViewerToast(text: t("viewer.resume.toast"), symbol: "bookmark.fill", actionTitle: t("viewer.resume.fromStart"), action: { [weak session] in session?.go(toPage: 0) }))
        }
    }

    @State private var rememberTask: Task<Void, Never>?

    private func scheduleRemember() {
        rememberTask?.cancel()
        rememberTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            app.documents.remember(session.document)
        }
    }

    private func exitImmersive() {
        session.immersive = false
        session.chromeHidden = false
    }
}

// MARK: - Panel container

enum ViewerPanelKind: Hashable {
    case leading(LeadingPanel)
    case trailing(TrailingPanel)
}

/// Title bar + close button around a panel, the same in the iPad column, the inspector and iPhone sheets.
struct ViewerPanelContainer: View {
    let session: ViewerSession
    let panel: ViewerPanelKind
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button { close() } label: { Label(t("common.close"), systemImage: "xmark") }
                            .labelStyle(.iconOnly)
                    }
                    if case .leading = panel, sizeClass != .compact {
                        ToolbarItem(placement: .topBarLeading) {
                            Menu {
                                ForEach(availableLeading, id: \.self) { item in
                                    Button { session.leadingPanel = item } label: { Label(t(item.titleKey), systemImage: item.symbol) }
                                }
                            } label: { Image(systemName: "chevron.up.chevron.down") }
                            .accessibilityLabel(t("viewer.rails.navigation"))
                        }
                    }
                }
        }
    }

    private var availableLeading: [LeadingPanel] {
        LeadingPanel.allCases.filter { ViewerModules.isAvailable($0, session: session) }
    }

    private var title: String {
        switch panel {
        case .leading(let item): t(item.titleKey)
        case .trailing(let item): t(item.titleKey)
        }
    }

    @ViewBuilder private var content: some View {
        switch panel {
        case .leading(.thumbnails): ViewerThumbnailsPanel(session: session)
        case .leading(.outline): ViewerOutlinePanel(session: session)
        case .leading(.search): ViewerSearchPanel(session: session)
        case .leading(.attachments): ViewerModules.attachments(session: session)
        case .leading(.signatures): ViewerModules.signatures(session: session)
        case .leading(.layers): ViewerModules.layers(session: session)
        case .trailing(.comments): ViewerModules.comments(session: session)
        case .trailing(.info): ViewerModules.info(session: session)
        case .trailing(.translate): ViewerModules.translate(session: session)
        }
    }

    private func close() {
        switch panel {
        case .leading: session.leadingPanel = nil
        case .trailing: session.trailingPanel = nil
        }
    }
}

// MARK: - Page colours

extension View {
    /// Page colour schemes as view filters (desktop `pageColorStyle`): dark = invert(0.92) + hue-rotate(180°);
    /// duotones map luminance between an ink and a paper colour: out = ink + L · (paper − ink).
    @ViewBuilder
    func pageColorScheme(_ scheme: PageColorScheme) -> some View {
        switch scheme {
        case .normal:
            self
        case .dark:
            // invert(0.92) == colorInvert followed by contrast 0.84 (0.92 − 0.84·x).
            self.colorInvert().contrast(0.84).hueRotation(.degrees(180))
        case .sepia:
            self.grayscale(1)
                .colorMultiply(Color(red: (244 - 91) / 255, green: (236 - 70) / 255, blue: (216 - 54) / 255))
                .overlay(Color(red: 91 / 255, green: 70 / 255, blue: 54 / 255).blendMode(.plusLighter).allowsHitTesting(false))
                .compositingGroup()
        case .whiteOnBlack:
            self.grayscale(1).colorInvert()
        case .yellowOnBlack:
            self.grayscale(1).colorInvert().colorMultiply(Color(red: 1, green: 1, blue: 0))
        case .greenOnBlack:
            self.grayscale(1).colorInvert().colorMultiply(Color(red: 0, green: 1, blue: 0))
        }
    }
}
