import PDFKit
import SwiftUI
import UniformTypeIdentifiers

/// The page organizer (`PagesPage.tsx`): a thumbnail grid of the active document to select, reorder,
/// rotate, delete, duplicate, insert, label, split and extract pages, then apply in place or save a copy.
struct PagesView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if let document = app.documents.active {
                OrganizerScreen(document: document).id(document.id)
            } else {
                EmptyStateView(symbol: "square.grid.2x2", title: t("viewer.empty.title"), message: t("tools.pages.needDocument"),
                               actionTitle: t("common.openPdf")) { app.showOpenPicker = true }
                    .background(AmbientBackground())
                    .navigationTitle(t("nav.pages"))
            }
        }
        .onChange(of: app.documents.documents.map(\.id)) { _, ids in OrganizerSessions.prune(keeping: Set(ids)) }
    }
}

/// Drag payload for tiles: `vivepdf-tile:<document id>:<tile key>`.
enum PagesTilePayload {
    static let prefix = "vivepdf-tile:"
    static func make(document: OpenDocument.ID, key: String) -> String { "\(prefix)\(document.uuidString):\(key)" }
    static func parse(_ value: String) -> (document: UUID, key: String)? {
        guard value.hasPrefix(prefix) else { return nil }
        let parts = value.dropFirst(prefix.count).split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2, let id = UUID(uuidString: parts[0]) else { return nil }
        return (id, parts[1])
    }
}

struct OrganizerScreen: View {
    let document: OpenDocument
    @Environment(AppModel.self) var app
    @Environment(\.horizontalSizeClass) var sizeClass
    @State var model: OrganizerModel
    @AppStorage("vivepdf.pagesZoom") var zoom: Double = 150
    @AppStorage("vivepdf.pagesInsertPlace") var insertPlaceRaw = OrganizerOps.InsertPlace.after.rawValue
    @AppStorage("vivepdf.pagesApplyInPlace") var applyInPlace = false
    @State var multiSelect = false
    @State var sheet: OrganizerSheetKind?
    @State var importKind: PagesImportKind?
    @State var pendingImport: PagesImportKind?
    @State var showPhotos = false
    @State var runner = JobRunner()
    @State var inspecting: PagesInspection?
    @State var inspectionTask: Task<Void, Never>?
    @State var toast: PagesToast?
    @State var dropTarget: String?
    @State var gridWidth: CGFloat = 390
    @State var preparingPrint = false
    @State var insertQueue: [(url: URL, replacing: Bool)] = []
    @FocusState var gridFocused: Bool

    static let zoomRange: ClosedRange<Double> = 80...400
    static let spacing: CGFloat = 12

    init(document: OpenDocument) {
        self.document = document
        _model = State(initialValue: OrganizerSessions.model(for: document))
    }

    var isCompact: Bool { sizeClass == .compact || gridWidth < 600 }
    var insertPlace: OrganizerOps.InsertPlace { OrganizerOps.InsertPlace(rawValue: insertPlaceRaw) ?? .after }

    var body: some View {
        VStack(spacing: 0) {
            PagesDocumentStrip(current: document, onDropTiles: copyTiles(fromPayloads:to:))
            statusLine
            grid
        }
        .background(Palette.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                if !model.selected.isEmpty { selectionBar.transition(.move(edge: .bottom).combined(with: .opacity)) }
                bottomBar
            }
            .animation(.snappy, value: model.selected.isEmpty)
        }
        .overlay(alignment: .top) { toastView }
        .overlay { busyOverlay }
        .navigationTitle(t("nav.pages"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .background { shortcutButtons }
        .sheet(item: $sheet, onDismiss: advanceInsertQueue) { kind in sheetContent(kind) }
        .sheet(isPresented: Binding(get: { runner.result.map { !$0.outputs.isEmpty } ?? false }, set: { if !$0 { runner.reset() } })) { resultSheet }
        .sheet(isPresented: $showPhotos) { PhotoPicker { urls in insertFiles(urls) } }
        .fileImporter(isPresented: Binding(get: { importKind != nil }, set: { if !$0 { importKind = nil } }),
                      allowedContentTypes: importKind == .images ? [.image] : [.pdf],
                      allowsMultipleSelection: importKind == .images) { result in handleImport(result) }
        .alert(t("tools.failed"), isPresented: Binding(get: { if case .failed = runner.state { true } else { false } }, set: { if !$0 { runner.reset() } })) {
            Button(t("common.close"), role: .cancel) { runner.reset() }
        } message: {
            if case .failed(let message) = runner.state { Text(message) }
        }
        .onChange(of: ObjectIdentifier(document.pdf)) { _, _ in
            if !model.isCurrent(for: document) { model.reset(to: document) }
        }
        .onChange(of: runner.result?.summary) { _, _ in
            // In-place results have no files to list: confirm with a toast instead of a sheet.
            if let result = runner.result, result.outputs.isEmpty {
                show(result.summary ?? t("tools.done"))
                runner.reset()
            }
        }
        .onDisappear { inspectionTask?.cancel() }
    }

    // MARK: Status

    private var statusLine: some View {
        HStack(spacing: 8) {
            Text("\(document.fileName) · \(model.tiles.count) \(t("info.pages")) · \(model.selected.count) \(t("tools.pages.selected"))")
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 4)
            if let inspecting {
                Button { cancelInspection() } label: {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.mini)
                        Text(t("tools.pages.inspecting")).font(.caption).lineLimit(1)
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .accessibilityLabel(t("tools.pages.inspecting"))
                .id(inspecting)
            }
        }
        .padding(.horizontal, isCompact ? 12 : 20)
        .padding(.vertical, 6)
    }

    // MARK: Grid

    var tileMinimum: CGFloat {
        let zoom = CGFloat(min(max(zoom, Self.zoomRange.lowerBound), Self.zoomRange.upperBound))
        return isCompact ? max(80, zoom * 0.7) : zoom
    }

    var gridPadding: CGFloat { isCompact ? 12 : 20 }

    var columns: Int {
        max(1, Int((gridWidth - 2 * gridPadding + Self.spacing) / (tileMinimum + Self.spacing)))
    }

    var cellWidth: CGFloat {
        let available = gridWidth - 2 * gridPadding - CGFloat(columns - 1) * Self.spacing
        return max(60, available / CGFloat(columns))
    }

    private var grid: some View {
        let labelTexts = model.labelTexts
        let box = CGSize(width: cellWidth, height: cellWidth * 1.3)
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Self.spacing, alignment: .top), count: columns), spacing: 14) {
                    ForEach(Array(model.tiles.enumerated()), id: \.element.key) { position, tile in
                        tileCell(tile, position: position, labelText: labelTexts?[position], box: box)
                            .id(tile.key)
                    }
                    endCell(box: box)
                }
                .padding(gridPadding)
                .animation(.snappy(duration: 0.25), value: model.tiles.map(\.key))
            }
            .onChange(of: model.anchor) { _, key in
                if let key { withAnimation { proxy.scrollTo(key) } }
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { gridWidth = $0 }
        .focusable()
        .focusEffectDisabled()
        .focused($gridFocused)
        .onKeyPress(phases: .down) { press in handleKey(press) }
        .onAppear { gridFocused = true }
        .simultaneousGesture(MagnifyGesture().onEnded { value in
            zoom = min(max(zoom * Double(value.magnification), Self.zoomRange.lowerBound), Self.zoomRange.upperBound)
        })
        .dropDestination(for: URL.self) { urls, _ in
            let accepted = urls.filter { PagesEngine.isImage($0) || $0.pathExtension.lowercased() == "pdf" }
            insertFiles(accepted)
            return !accepted.isEmpty
        }
    }

    private func tileCell(_ tile: OrganizerTile, position: Int, labelText: String?, box: CGSize) -> some View {
        let selected = model.selected.contains(tile.key)
        let isLast = position == model.tiles.count - 1
        return PagesTileCell(tile: tile, model: model, position: position, box: box, selected: selected,
                        isCut: !isLast && model.cuts.contains(tile.key), labelText: labelText, labelStart: model.labels[tile.key] != nil,
                        dropBefore: dropTarget == tile.key, onCheck: { model.toggle(tile.key) })
            .contentShape(Rectangle())
            .onTapGesture { tap(tile.key) }
            .simultaneousGesture(TapGesture(count: 2).onEnded { openPreview(tile.key) })
            .contextMenu { tileMenu(tile.key) }
            .draggable(PagesTilePayload.make(document: document.id, key: tile.key)) {
                PagesDragBadge(count: selected ? model.selected.count : 1)
            }
            .dropDestination(for: String.self) { items, _ in
                dropTarget = nil
                return handleDrop(items, at: position)
            } isTargeted: { targeted in
                if targeted { dropTarget = tile.key } else if dropTarget == tile.key { dropTarget = nil }
            }
            .hoverEffect(.highlight)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(t("tools.pagePicker.page", ["page": position + 1]) + (labelText.map { ", " + t("tools.pages.labels.shown", ["label": $0]) } ?? ""))
            .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            .accessibilityAction { tap(tile.key) }
            .accessibilityAction(named: t("tools.pages.menu.preview")) { openPreview(tile.key) }
            .accessibilityAction(named: t("tools.pages.tile.rotateRight", ["page": position + 1])) { model.rotate(tile.key, by: 90) }
            .accessibilityAction(named: t("tools.pages.tile.rotateLeft", ["page": position + 1])) { model.rotate(tile.key, by: -90) }
            .accessibilityAction(named: t("tools.pages.tile.delete", ["page": position + 1])) { model.delete(tile.key) }
    }

    /// Drop target after the last page; also a shortcut to insert pages.
    private func endCell(box: CGSize) -> some View {
        Menu { insertMenuItems } label: {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(dropTarget == "__end" ? Palette.primary : Palette.border, style: StrokeStyle(lineWidth: dropTarget == "__end" ? 3 : 1.5, dash: [6, 5]))
                .background(dropTarget == "__end" ? Palette.accent.opacity(0.5) : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay { Image(systemName: "plus").font(.title2).foregroundStyle(Palette.mutedForeground) }
                .frame(width: box.width * 0.8, height: box.height * 0.8)
                .frame(width: box.width, height: box.height)
        }
        .accessibilityLabel(t("tools.pages.groups.insert"))
        .dropDestination(for: String.self) { items, _ in
            dropTarget = nil
            return handleDrop(items, at: model.tiles.count)
        } isTargeted: { targeted in
            if targeted { dropTarget = "__end" } else if dropTarget == "__end" { dropTarget = nil }
        }
    }

    // MARK: Selection bar & bottom bar

    private var selectionBar: some View {
        let count = model.selected.count
        let all = count == model.tiles.count
        return HStack(spacing: 4) {
            Text(t("tools.pages.selectedCount", ["count": count]))
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.horizontal, 6)
            Divider().frame(height: 22)
            barButton("rotate.left", t("tools.pages.rotateLeft")) { model.rotateSelected(-90) }
            barButton("rotate.right", t("tools.pages.rotateRight")) { model.rotateSelected(90) }
            if !isCompact {
                barButton("plus.square.on.square", t("tools.pages.duplicate")) { model.duplicateSelected() }
                barButton("doc.on.clipboard", t("tools.pages.clipboard.copy")) { copyPages() }
                barButton("scissors.badge.ellipsis", t("tools.pages.clipboard.cut"), disabled: all) { cutPages() }
                barButton("scissors", t("tools.pages.cutAtSelection")) { model.toggleCutsAtSelection() }
                barButton("square.and.arrow.up.on.square", t("tools.pages.shortcut.extract"), disabled: runner.isRunning) { apply(subset: true) }
                barButton("photo.on.rectangle", t("tools.pages.exportImages.menu"), disabled: runner.isRunning) { sheet = .images }
                barButton("printer", t("tools.pages.print.menu"), disabled: runner.isRunning || preparingPrint) { printPages() }
            }
            barButton("trash", t("tools.pages.delete"), role: .destructive, disabled: all) { withAnimation { model.deleteSelected() } }
            if isCompact {
                Menu {
                    Button { model.selectAll() } label: { Label(t("tools.pages.selectAll"), systemImage: "checkmark.square") }.disabled(all)
                    Button { model.duplicateSelected() } label: { Label(t("tools.pages.duplicate"), systemImage: "plus.square.on.square") }
                    Button { copyPages() } label: { Label(t("tools.pages.clipboard.copy"), systemImage: "doc.on.clipboard") }
                    Button { cutPages() } label: { Label(t("tools.pages.clipboard.cut"), systemImage: "scissors.badge.ellipsis") }.disabled(all)
                    Button { model.toggleCutsAtSelection() } label: { Label(t("tools.pages.cutAtSelection"), systemImage: "scissors") }
                    Divider()
                    Button { apply(subset: true) } label: { Label(t("tools.pages.shortcut.extract"), systemImage: "square.and.arrow.up.on.square") }
                    Button { sheet = .images } label: { Label(t("tools.pages.exportImages.menu"), systemImage: "photo.on.rectangle") }
                    Button { printPages() } label: { Label(t("tools.pages.print.menu"), systemImage: "printer") }
                } label: {
                    Image(systemName: "ellipsis.circle").frame(width: 40, height: 40)
                }
                .accessibilityLabel(t("tools.pages.selectionBar"))
            }
            Divider().frame(height: 22)
            barButton("xmark", t("tools.pages.selectNone")) { model.selectNone() }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.border))
        .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
        .padding(.horizontal, 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("tools.pages.selectionBar"))
    }

    func barButton(_ symbol: String, _ label: String, role: ButtonRole? = nil, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            Image(systemName: symbol).frame(width: 40, height: 40)
        }
        .buttonStyle(.borderless)
        .disabled(disabled)
        .accessibilityLabel(label)
        .help(label)
    }

    private var bottomBar: some View {
        HStack(spacing: isCompact ? 2 : 6) {
            if isCompact {
                barButton("arrow.uturn.backward", t("tools.pages.undo"), disabled: !model.canUndo) { withAnimation { model.undo() } }
                barButton("arrow.uturn.forward", t("tools.pages.redo"), disabled: !model.canRedo) { withAnimation { model.redo() } }
            }
            groupMenu(t("tools.pages.groups.select"), symbol: "checkmark.square") { selectMenuItems }
            Button { multiSelect.toggle() } label: {
                Image(systemName: multiSelect ? "checklist.checked" : "checklist").frame(width: 40, height: 40)
            }
            .buttonStyle(.borderless)
            .background(multiSelect ? Palette.accent : Color.clear, in: RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel(t("tools.pages.multiSelectMode"))
            .accessibilityAddTraits(multiSelect ? .isSelected : [])
            .help(t("tools.pages.multiSelectMode"))
            groupMenu(t("tools.pages.groups.insert"), symbol: "doc.badge.plus") { insertMenuItems }
            groupMenu(t("tools.pages.groups.edit"), symbol: "pencil.and.ruler") { editMenuItems }
            groupMenu(t("tools.pages.groups.split"), symbol: "scissors") { splitMenuItems }
            Spacer(minLength: 0)
            if isCompact {
                Menu {
                    Button { zoomBy(30) } label: { Label(t("viewer.zoomIn"), systemImage: "plus.magnifyingglass") }.disabled(zoom >= Self.zoomRange.upperBound)
                    Button { zoomBy(-30) } label: { Label(t("viewer.zoomOut"), systemImage: "minus.magnifyingglass") }.disabled(zoom <= Self.zoomRange.lowerBound)
                } label: {
                    Image(systemName: "magnifyingglass").frame(width: 40, height: 40)
                }
                .accessibilityLabel(t("tools.pages.thumbnailSize"))
            } else {
                barButton("minus.magnifyingglass", t("viewer.zoomOut"), disabled: zoom <= Self.zoomRange.lowerBound) { zoomBy(-30) }
                Slider(value: $zoom, in: Self.zoomRange, step: 10)
                    .frame(width: 120)
                    .accessibilityLabel(t("tools.pages.thumbnailSize"))
                barButton("plus.magnifyingglass", t("viewer.zoomIn"), disabled: zoom >= Self.zoomRange.upperBound) { zoomBy(30) }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .frame(maxWidth: .infinity)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private func groupMenu<Items: View>(_ title: String, symbol: String, @ViewBuilder items: () -> Items) -> some View {
        Menu { items() } label: {
            if isCompact {
                Image(systemName: symbol).frame(width: 40, height: 40)
            } else {
                Label(title, systemImage: symbol).padding(.horizontal, 8).frame(minHeight: 40)
            }
        }
        .accessibilityLabel(title)
        .help(title)
    }

    func zoomBy(_ delta: Double) {
        withAnimation(.snappy) { zoom = min(max(zoom + delta, Self.zoomRange.lowerBound), Self.zoomRange.upperBound) }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if !isCompact {
                Button { withAnimation { model.undo() } } label: { Label(t("tools.pages.undo"), systemImage: "arrow.uturn.backward") }
                    .disabled(!model.canUndo)
                Button { withAnimation { model.redo() } } label: { Label(t("tools.pages.redo"), systemImage: "arrow.uturn.forward") }
                    .disabled(!model.canRedo)
            }
            Menu { moreMenuItems } label: { Label(t("tools.pages.export.menu"), systemImage: "ellipsis.circle") }
            Button { apply(subset: false) } label: {
                Text(t(applyInPlace ? "tools.pages.inPlace.apply" : "tools.pages.apply")).fontWeight(.semibold).lineLimit(1)
            }
            .buttonStyle(.borderedProminent)
            .tint(Tone.organize.color)
            .disabled(!model.isDirty || model.tiles.isEmpty || runner.isRunning)
        }
    }

    @ViewBuilder private var moreMenuItems: some View {
        Section {
            Button { apply(subset: true) } label: { Label(t("tools.pages.extract"), systemImage: "square.and.arrow.up.on.square") }
                .disabled(model.selected.isEmpty || runner.isRunning)
            if !model.partStarts.isEmpty {
                Button { saveParts() } label: { Label(t("tools.pages.splitParts", ["count": model.partStarts.count + 1]), systemImage: "scissors") }
                    .disabled(runner.isRunning)
            }
            Button { sheet = .images } label: { Label(t("tools.pages.exportImages.menu"), systemImage: "photo.on.rectangle") }
                .disabled(model.tiles.isEmpty || runner.isRunning)
            Button { printPages() } label: { Label(t("tools.pages.print.menu"), systemImage: "printer") }
                .disabled(model.tiles.isEmpty || runner.isRunning || preparingPrint)
        }
        Section {
            Toggle(isOn: $applyInPlace) { Label(t("tools.pages.inPlace.toggle"), systemImage: "arrow.triangle.2.circlepath.doc.on.clipboard") }
            Button { withAnimation { model.resetArrangement() } } label: { Label(t("tools.pages.reset"), systemImage: "clock.arrow.circlepath") }
                .disabled(!model.hasUnsavedWork)
            Button { sheet = .shortcuts } label: { Label(t("tools.pages.shortcuts"), systemImage: "keyboard") }
        }
    }

    // MARK: Overlays

    @ViewBuilder private var toastView: some View {
        if let toast {
            Label(toast.message, systemImage: toast.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.callout)
                .foregroundStyle(toast.isError ? Palette.destructive : Palette.foreground)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .frame(maxWidth: 560)
                .transition(.move(edge: .top).combined(with: .opacity))
                .onTapGesture { self.toast = nil }
                .accessibilityAddTraits(.isStaticText)
        }
    }

    @ViewBuilder private var busyOverlay: some View {
        if case .running(let fraction, let message) = runner.state {
            VStack(spacing: 12) {
                ProgressView(value: fraction > 0 ? fraction : nil) { Text(message ?? t("tools.working")) }
                    .tint(Tone.organize.color)
                Button(t("common.cancel"), role: .cancel) { runner.cancel() }.buttonStyle(.bordered)
            }
            .padding(20)
            .frame(maxWidth: 360)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(radius: 20)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.opacity(0.15))
        }
    }

    private var resultSheet: some View {
        NavigationStack {
            ScrollView {
                if let result = runner.result { ResultPanel(result: result, tone: .organize).padding() }
            }
            .background(Palette.background)
            .navigationTitle(t("nav.pages"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { runner.reset() } } }
        }
        .presentationDetents([.medium, .large])
    }

    func show(_ message: String, error: Bool = false) {
        let next = PagesToast(message: message, isError: error)
        withAnimation { toast = next }
        Task {
            try? await Task.sleep(for: .seconds(3.5))
            if toast == next { withAnimation { toast = nil } }
        }
    }

    // MARK: Sheets

    @ViewBuilder private func sheetContent(_ kind: OrganizerSheetKind) -> some View {
        switch kind {
        case .blank:
            InsertBlankSheet(matchSize: document.pdf.page(at: 0)?.bounds(for: .mediaBox).size) { width, height, count, paper in
                sheet = nil
                let incoming = (0..<count).map { _ in OrganizerTile(key: OrganizerTile.newKey(), kind: .blank(width: width, height: height, paper: paper)) }
                withAnimation { model.insert(incoming, place: insertPlace) }
            }
        case .insertPDF(let url, let replacing):
            InsertPDFSheet(url: url, replacing: replacing) { pdf, password, pages in
                sheet = nil
                let id = model.addSource(url: url, password: password, document: pdf)
                let incoming = pages.map { OrganizerTile(key: OrganizerTile.newKey(), kind: .page(source: id, index: $0)) }
                withAnimation { replacing ? model.replaceSelection(with: incoming) : model.insert(incoming, place: insertPlace) }
            }
        case .range:
            RangeSelectSheet(total: model.tiles.count) { positions in
                sheet = nil
                model.select(OrganizerOps.positionsToKeys(model.tiles, positions: positions))
            }
        case .move:
            MovePagesSheet(total: model.tiles.count, count: model.selected.count) { position in
                sheet = nil
                withAnimation { model.moveSelected(toPosition: position) }
            }
        case .copies:
            CopiesSheet(count: model.selected.count) { copies, layout in
                sheet = nil
                withAnimation { model.duplicateSelected(copies: copies, layout: layout) }
            }
        case .text:
            TextSelectSheet(hasSelection: !model.selected.isEmpty) { query in
                sheet = nil
                selectByText(query)
            }
        case .duplex:
            DuplexSheet(total: model.tiles.count) { pad, reverse, twoFiles in
                sheet = nil
                withAnimation { model.applyDuplex(pad: pad, reverseBacks: reverse, twoFiles: twoFiles) }
                show(t(twoFiles ? "tools.pages.duplex.doneTwoFiles" : "tools.pages.duplex.done"))
            }
        case .label(let key):
            PageLabelSheet(position: model.position(of: key) ?? 0, current: model.labels[key], hasLabels: model.labelTexts != nil) { label in
                sheet = nil
                model.setLabel(label, for: key)
            } onRemove: {
                sheet = nil
                model.setLabel(nil, for: key)
            } onClearAll: {
                sheet = nil
                model.clearLabels()
            }
        case .preview(let key):
            PagePreviewSheet(model: model, key: key) { tile in openInViewer(tile) }
        case .images:
            ExportImagesSheet(count: model.selected.isEmpty ? model.tiles.count : model.selected.count) {
                let chosen = model.selected.isEmpty ? model.tiles : model.selectedTiles
                return (model.pageSources(mainURL: try document.snapshotURL()), chosen, document.title, document.url)
            }
        case .shortcuts:
            PagesShortcutsSheet()
        }
    }
}

enum OrganizerSheetKind: Identifiable, Equatable {
    case blank, range, move, copies, text, duplex, images, shortcuts
    case insertPDF(URL, replacing: Bool)
    case label(String)
    case preview(String)

    var id: String {
        switch self {
        case .blank: "blank"
        case .range: "range"
        case .move: "move"
        case .copies: "copies"
        case .text: "text"
        case .duplex: "duplex"
        case .images: "images"
        case .shortcuts: "shortcuts"
        case .insertPDF(let url, let replacing): "pdf-\(url.path)-\(replacing)"
        case .label(let key): "label-\(key)"
        case .preview(let key): "preview-\(key)"
        }
    }
}

enum PagesImportKind: Equatable { case pdf(replacing: Bool), images }

enum PagesInspection: String { case blank, scanned, rotation, bookmarks, duplicates, text }

struct PagesToast: Equatable {
    let id = UUID()
    var message: String
    var isError = false
}

/// The little stack shown under the finger while dragging pages.
struct PagesDragBadge: View {
    let count: Int
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "doc.on.doc.fill")
            Text("\(count) \(t("info.pages"))").font(.callout.weight(.semibold))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Palette.primary, in: Capsule())
        .foregroundStyle(Palette.primaryForeground)
    }
}

/// One page card: thumbnail, selection ring and check, number or label, source badge and split mark.
struct PagesTileCell: View {
    let tile: OrganizerTile
    let model: OrganizerModel
    let position: Int
    let box: CGSize
    let selected: Bool
    let isCut: Bool
    let labelText: String?
    let labelStart: Bool
    let dropBefore: Bool
    let onCheck: () -> Void

    var body: some View {
        VStack(spacing: 6) {
            ZStack(alignment: .topLeading) {
                PagesTileThumbnail(tile: tile, model: model, box: box)
                    .padding(4)
                    .background(selected ? Palette.accent : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(selected ? Palette.primary : Color.clear, lineWidth: 2.5))
                Button(action: onCheck) {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(selected ? Palette.primaryForeground : Palette.mutedForeground, selected ? Palette.primary : Palette.card)
                        .background(Circle().fill(Palette.card.opacity(selected ? 0 : 0.9)).padding(2))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityHidden(true)
                if tile.rotate != 0 {
                    Text("\(tile.rotate)°")
                        .font(.caption2.weight(.semibold).monospacedDigit())
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(.thinMaterial, in: Capsule())
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                        .padding(8)
                }
            }
            .overlay(alignment: .leading) {
                if dropBefore {
                    Capsule().fill(Palette.primary).frame(width: 4).padding(.vertical, 6).offset(x: -8)
                }
            }
            .overlay(alignment: .trailing) {
                if isCut {
                    VStack(spacing: 2) {
                        Image(systemName: "scissors").font(.caption.weight(.bold))
                            .padding(4)
                            .background(Palette.destructive, in: Circle())
                            .foregroundStyle(.white)
                        Rectangle().fill(Palette.destructive).frame(width: 2)
                    }
                    .padding(.vertical, 4)
                    .offset(x: 9)
                    .accessibilityHidden(true)
                }
            }
            HStack(spacing: 4) {
                if labelStart { Image(systemName: "tag.fill").font(.caption2).foregroundStyle(Palette.primary) }
                Text(labelText ?? "\(position + 1)")
                    .font(.caption.weight(selected ? .semibold : .regular).monospacedDigit())
                    .lineLimit(1)
                badge
            }
            .foregroundStyle(selected ? Palette.primary : Palette.mutedForeground)
            .frame(maxWidth: box.width)
        }
    }

    @ViewBuilder private var badge: some View {
        switch tile.kind {
        case .page(let source, let index):
            if source != OrganizerOps.mainSourceID {
                Text("· \(model.source(source)?.fileName ?? "") \(index)")
                    .font(.caption2)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        case .blank(_, _, let paper):
            Image(systemName: paper == nil ? "doc" : "note.text").font(.caption2)
        case .image:
            Image(systemName: "photo").font(.caption2)
        }
    }
}

/// Open documents as chips: tap to switch, drop pages on another document to copy them to its end.
struct PagesDocumentStrip: View {
    let current: OpenDocument
    let onDropTiles: ([String], OpenDocument) -> Bool
    @Environment(AppModel.self) private var app
    @State private var targeted: OpenDocument.ID?

    var body: some View {
        let documents = app.documents.documents
        if documents.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(documents) { doc in
                        let active = doc.id == current.id
                        Button { app.documents.activeID = doc.id } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "doc.richtext")
                                Text(doc.fileName).lineLimit(1).truncationMode(.middle)
                                if doc.isDirty { Circle().fill(Palette.warning).frame(width: 6, height: 6) }
                            }
                            .font(.subheadline.weight(active ? .semibold : .regular))
                            .padding(.horizontal, 12)
                            .frame(minHeight: 36)
                            .frame(maxWidth: 240)
                            .foregroundStyle(active ? Tone.organize.color : Palette.foreground)
                            .background(active ? Tone.organize.soft : Palette.card, in: Capsule())
                            .overlay(Capsule().strokeBorder(targeted == doc.id ? Palette.primary : (active ? Tone.organize.color.opacity(0.45) : Palette.border),
                                                            lineWidth: targeted == doc.id ? 2.5 : 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(active ? .isSelected : [])
                        .accessibilityHint(active ? "" : t("tools.pages.drag.copyTo", ["name": doc.fileName]))
                        .dropDestination(for: String.self) { items, _ in
                            targeted = nil
                            return doc.id != current.id && onDropTiles(items, doc)
                        } isTargeted: { isTargeted in
                            if doc.id != current.id { targeted = isTargeted ? doc.id : (targeted == doc.id ? nil : targeted) }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            .accessibilityLabel(t("viewer.tabs"))
        }
    }
}
