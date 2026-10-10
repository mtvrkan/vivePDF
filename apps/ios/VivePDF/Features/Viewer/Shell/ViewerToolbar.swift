import PDFKit
import SwiftUI

/// Navigation-bar items. Wide windows show the desktop rails as buttons; compact width keeps search and
/// annotate visible and folds everything else into menus (`ellipsis.circle`).
struct ViewerToolbarContent: ToolbarContent {
    @Bindable var session: ViewerSession
    let closer: ViewerCloser
    @Binding var shareURL: URL?
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var compact: Bool { sizeClass == .compact }

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) {
            panelsMenu
            if session.canGoBack {
                Button { session.goBack() } label: { Label(t("ios.viewer.back"), systemImage: "arrow.uturn.backward") }
                    .help(t("ios.viewer.back"))
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            if session.document.isDirty { saveButton }
            if !compact {
                toggle(t("viewer.search"), "magnifyingglass", session.leadingPanel == .search) { togglePanel(.search) }
                toggle(t("viewer.comments.title"), "text.bubble", session.trailingPanel == .comments) { toggleTrailing(.comments) }
            }
            toggle(t("viewer.annotate"), "pencil.tip.crop.circle", session.showsAnnotate) {
                session.showsAnnotate.toggle()
                if session.showsAnnotate { session.readingMode = false }
            }
            if !compact {
                toggle(t("viewer.readAloud.title"), "speaker.wave.2", session.showsReadAloud) { session.showsReadAloud.toggle() }
                Menu { ViewerShareMenu(session: session, shareURL: $shareURL) } label: { Label(t("ios.common.share"), systemImage: "square.and.arrow.up") }
            }
            moreMenu
        }
    }

    // MARK: Pieces

    private func toggle(_ title: String, _ symbol: String, _ on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .symbolVariant(on ? .fill : .none)
        }
        .tint(on ? Palette.primary : nil)
        .accessibilityAddTraits(on ? .isSelected : [])
        .help(title)
    }

    private var saveButton: some View {
        Menu {
            Button { session.save() } label: { Label(t("viewer.save.save"), systemImage: "square.and.arrow.down") }
            Button { if let url = session.saveCopy() { shareURL = url } } label: { Label(t("annotate.saveAs"), systemImage: "square.and.arrow.down.on.square") }
            Divider()
            Button(role: .destructive) { session.discardChanges() } label: { Label(t("viewer.save.discard"), systemImage: "arrow.uturn.backward") }
        } label: {
            Label(t("viewer.save.save"), systemImage: "circle.fill")
                .labelStyle(.titleOnly)
                .font(.subheadline.weight(.semibold))
        } primaryAction: {
            session.save()
        }
        .tint(Palette.primary)
        .accessibilityHint(t("viewer.save.unsaved"))
    }

    private var panelsMenu: some View {
        Menu {
            Section(t("viewer.rails.navigation")) {
                ForEach(LeadingPanel.allCases.filter { ViewerModules.isAvailable($0, session: session) }) { panel in
                    Button { togglePanel(panel) } label: {
                        Label(t(panel.titleKey), systemImage: panel.symbol)
                    }
                    .accessibilityAddTraits(session.leadingPanel == panel ? .isSelected : [])
                }
            }
            Section(t("viewer.rails.tools")) {
                ForEach(TrailingPanel.allCases) { panel in
                    Button { toggleTrailing(panel) } label: { Label(t(panel.titleKey), systemImage: panel.symbol) }
                }
            }
        } label: {
            Label(t("viewer.rails.navigation"), systemImage: session.leadingPanel == nil ? "sidebar.leading" : "sidebar.squares.leading")
        } primaryAction: {
            togglePanel(session.leadingPanel ?? .thumbnails)
        }
        .help(t("viewer.thumbnails"))
    }

    private var moreMenu: some View {
        Menu {
            if compact {
                Section {
                    Button { togglePanel(.search) } label: { Label(t("viewer.search"), systemImage: "magnifyingglass") }
                    Button { toggleTrailing(.comments) } label: { Label(t("viewer.comments.title"), systemImage: "text.bubble") }
                    Button { session.showsReadAloud.toggle() } label: { Label(t("viewer.readAloud.title"), systemImage: "speaker.wave.2") }
                    Menu { ViewerShareMenu(session: session, shareURL: $shareURL) } label: { Label(t("ios.common.share"), systemImage: "square.and.arrow.up") }
                }
            }
            Section {
                Button { session.presenting = true } label: { Label(t("viewer.presentationTools"), systemImage: "play.rectangle") }
                Button { session.immersive = true; session.chromeHidden = true } label: { Label(t("viewer.fullscreen"), systemImage: "arrow.up.left.and.arrow.down.right") }
                Button { session.readingMode.toggle() } label: { Label(t("viewer.reading.title"), systemImage: "text.justify.leading") }
                Button { toggleTrailing(.translate) } label: { Label(t("viewer.translate.title"), systemImage: "translate") }
            }
            Section {
                ViewerDisplayMenu(session: session)
                ViewerZoomMenu(session: session)
                Menu {
                    ViewerPageMenuItems(session: session, pageIndex: session.currentPageIndex, includeNavigation: false, shareURL: $shareURL, bookmarkPage: .constant(nil))
                } label: { Label(t("viewer.context.pageGroup"), systemImage: "doc.text") }
            }
            Section {
                Button { session.showPrint = true; session.printPageIndex = nil } label: { Label(t("viewer.print"), systemImage: "printer") }
                Button { toggleTrailing(.info) } label: { Label(t("viewer.inspector"), systemImage: "info.circle") }
                ViewerOpenInMenu(session: session)
                if session.looksScanned {
                    Button { session.makeSearchablePage = .some(nil) } label: { Label(t("viewer.searchable.wholeDocument"), systemImage: "text.viewfinder") }
                }
            }
            Section {
                Button { session.save() } label: { Label(t("viewer.save.save"), systemImage: "square.and.arrow.down") }
                    .disabled(!session.document.isDirty)
                Button { if let url = session.saveCopy() { shareURL = url } } label: { Label(t("annotate.saveAs"), systemImage: "square.and.arrow.down.on.square") }
                Toggle(isOn: Binding(get: { UserDefaults.standard.bool(forKey: ViewerCloser.autosaveKey) }, set: { UserDefaults.standard.set($0, forKey: ViewerCloser.autosaveKey) })) {
                    Label(t("ios.viewer.autosave"), systemImage: "clock.arrow.circlepath")
                }
                Button(role: .destructive) { closer.close([session.document], in: app.documents) } label: { Label(t("common.close"), systemImage: "xmark") }
            }
        } label: {
            Label(t("ios.viewer.more"), systemImage: "ellipsis.circle")
        }
    }

    private func togglePanel(_ panel: LeadingPanel) {
        withAnimation(.snappy) {
            session.leadingPanel = session.leadingPanel == panel ? nil : panel
        }
        if sizeClass != .compact {
            UserDefaults.standard.set(session.leadingPanel == .thumbnails, forKey: "vivepdf.viewer.thumbnailsOpen")
        }
    }

    private func toggleTrailing(_ panel: TrailingPanel) {
        if panel == .translate, session.translateText.isEmpty { session.translateText = session.selectedText }
        session.trailingPanel = session.trailingPanel == panel ? nil : panel
    }
}

/// Switch / close open documents from the title (every width).
struct ViewerDocumentsMenu: View {
    let closer: ViewerCloser
    @Environment(AppModel.self) private var app

    var body: some View {
        Section(t("viewer.tabs")) {
            ForEach(app.documents.documents) { document in
                Button { app.documents.activeID = document.id } label: {
                    if document.id == app.documents.active?.id {
                        Label(document.fileName, systemImage: "checkmark")
                    } else {
                        Text(document.isDirty ? "● \(document.fileName)" : document.fileName)
                    }
                }
            }
        }
        Button { app.showOpenPicker = true } label: { Label(t("common.openPdf"), systemImage: "plus") }
        if let active = app.documents.active {
            Button { closer.close([active], in: app.documents) } label: { Label(t("common.close"), systemImage: "xmark") }
            if app.documents.documents.count > 1 {
                Button { closer.close(app.documents.documents.filter { $0.id != active.id }, in: app.documents) } label: { Label(t("viewer.context.closeOthers"), systemImage: "xmark.square") }
                Button { closer.close(app.documents.documents, in: app.documents) } label: { Label(t("viewer.context.closeAll"), systemImage: "xmark.rectangle") }
            }
        }
    }
}

/// Page display menu (desktop `PageDisplayMenu`): spread, scrolling direction, paging, auto scroll, split
/// window, page colours, view rotation.
struct ViewerDisplayMenu: View {
    @Bindable var session: ViewerSession

    var body: some View {
        Menu {
            Picker(selection: $session.spread) {
                ForEach(PageSpread.allCases) { spread in Label(t(spread.labelKey), systemImage: spread.symbol).tag(spread) }
            } label: { Text(t("viewer.pageDisplay.title")) }
            .pickerStyle(.inline)
            Picker(selection: $session.direction) {
                ForEach(ScrollDirection.allCases) { direction in Label(t(direction.labelKey), systemImage: direction.symbol).tag(direction) }
            } label: { Text(t("viewer.pageDisplay.vertical")) }
            .pickerStyle(.inline)
            Toggle(isOn: $session.paged) { Label(t("ios.viewer.pageByPage"), systemImage: "book.pages") }
            Divider()
            Button { ViewerAutoScroller.of(session).toggle() } label: {
                Label(t("viewer.pageDisplay.autoScroll"), systemImage: session.autoScrolling ? "pause.circle" : "play.circle")
            }
            Picker(selection: splitMode) {
                Text(t("viewer.split.off")).tag(0)
                Label(t("viewer.split.columns"), systemImage: "rectangle.split.2x1").tag(1)
                Label(t("viewer.split.rows"), systemImage: "rectangle.split.1x2").tag(2)
            } label: { Label(t("viewer.split.title"), systemImage: "rectangle.split.2x1") }
            .pickerStyle(.menu)
            Picker(selection: $session.pageColors) {
                ForEach(PageColorScheme.allCases) { scheme in Text(t(scheme.labelKey)).tag(scheme) }
            } label: { Label(t("viewer.pageDisplay.pageColors"), systemImage: "circle.lefthalf.filled") }
            .pickerStyle(.menu)
            Divider()
            Button { session.rotateView(clockwise: true) } label: { Label(t("viewer.context.rotateViewForward"), systemImage: "rotate.right") }
            Button { session.rotateView(clockwise: false) } label: { Label(t("viewer.context.rotateViewBackward"), systemImage: "rotate.left") }
        } label: {
            Label(t("viewer.pageDisplay.title"), systemImage: session.spread.symbol)
        }
    }
}

extension ViewerDisplayMenu {
    /// 0 = off, 1 = side by side, 2 = stacked.
    var splitMode: Binding<Int> {
        Binding(get: { session.splitActive ? (session.splitStacked ? 2 : 1) : 0 }, set: { mode in
            session.splitStacked = mode == 2
            session.splitActive = mode != 0
        })
    }
}

/// Zoom presets (desktop toolbar "Scale" select).
struct ViewerZoomMenu: View {
    let session: ViewerSession

    var body: some View {
        Menu {
            Button { session.zoom(.fitWidth) } label: { Label(t("viewer.fitWidth"), systemImage: "arrow.left.and.right") }
            Button { session.zoom(.fitPage) } label: { Label(t("viewer.fitPage"), systemImage: "arrow.up.left.and.down.right.magnifyingglass") }
            Button { session.zoom(.actualSize) } label: { Label(t("viewer.actualSize"), systemImage: "1.magnifyingglass") }
            Divider()
            ForEach(ViewerSession.zoomPresets, id: \.self) { level in
                Button("\(Int(level * 100))%") { session.zoom(.level(level)) }
            }
            Divider()
            Button { session.zoom(.zoomIn) } label: { Label(t("viewer.zoomIn"), systemImage: "plus.magnifyingglass") }
            Button { session.zoom(.zoomOut) } label: { Label(t("viewer.zoomOut"), systemImage: "minus.magnifyingglass") }
        } label: {
            Label("\(t("viewer.zoom")) · \(Int((session.scale * 100).rounded()))%", systemImage: "magnifyingglass")
        }
    }
}

/// Share the current document (with unsaved edits) or export it.
struct ViewerShareMenu: View {
    let session: ViewerSession
    @Binding var shareURL: URL?

    var body: some View {
        Button { shareURL = session.snapshotURL() } label: { Label(t("ios.common.share"), systemImage: "square.and.arrow.up") }
        Button {
            UIPasteboard.general.string = session.document.fileName
            session.showMessage(t("viewer.selection.copied"))
        } label: { Label(t("viewer.context.copyFileName"), systemImage: "doc.on.doc") }
    }
}

/// "Open in" other tools with the current document (unsaved edits included).
struct ViewerOpenInMenu: View {
    let session: ViewerSession
    @Environment(AppModel.self) private var app

    private static let tools: [(ToolID, String?)] = [
        (.compress, nil), (.convert, "docx"), (.ocr, nil), (.split, nil), (.merge, nil), (.edit, nil),
        (.forms, "fill"), (.sign, "sign"), (.security, "encrypt"), (.compare, nil), (.access, nil), (.pdfa, nil), (.preflight, nil),
    ]

    var body: some View {
        Menu {
            Button { handOff(.pages) } label: { Label(t("tools.grid.organizer"), systemImage: "square.grid.2x2") }
            ForEach(Self.tools, id: \.0) { tool, tab in
                Button { handOff(.tool(tool, tab: tab)) } label: { Label(t(tool.labelKey), systemImage: tool.symbol) }
            }
        } label: { Label(t("ios.viewer.openIn"), systemImage: "arrow.up.forward.app") }
    }

    private func handOff(_ route: Route) {
        if let url = session.snapshotURL() { app.inbox = [url] }
        app.navigate(route)
    }
}
