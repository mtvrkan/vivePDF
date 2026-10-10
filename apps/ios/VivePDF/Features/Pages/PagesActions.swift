import PDFKit
import SwiftUI
import UniformTypeIdentifiers

// Commands of the page organizer: menus, keyboard, drag & drop, insertion, inspections and output.
extension OrganizerScreen {
    // MARK: Tapping & preview

    func tap(_ key: String) {
        gridFocused = true
        if multiSelect { model.toggle(key) } else { model.select([key], anchor: .some(key)) }
    }

    func openPreview(_ key: String) {
        if !model.selected.contains(key) { model.select([key], anchor: .some(key)) }
        sheet = .preview(key)
    }

    func openInViewer(_ tile: OrganizerTile) {
        guard case .page(let source, let index) = tile.kind, source == OrganizerOps.mainSourceID else { return }
        document.currentPageIndex = index - 1
        app.documents.activeID = document.id
        app.navigate(.viewer)
    }

    // MARK: Drag & drop

    func handleDrop(_ items: [String], at dropIndex: Int) -> Bool {
        guard let payload = items.compactMap(PagesTilePayload.parse).first else { return false }
        if payload.document != document.id {
            // Pages dragged in from another document's organizer are copied here.
            guard let other = OrganizerSessions.existing(payload.document), let otherDocument = app.documents.documents.first(where: { $0.id == payload.document }) else { return false }
            let keys = other.selected.contains(payload.key) ? other.selected : [payload.key]
            let chosen = other.tiles.filter { keys.contains($0.key) }
            importTiles(chosen, from: other, document: otherDocument, at: dropIndex)
            return true
        }
        let keys = model.selected.contains(payload.key) ? model.selected : [payload.key]
        withAnimation(.snappy) { model.move(keys, to: dropIndex) }
        return true
    }

    /// Copies tiles of another open document's organizer into this arrangement (sources shared by file).
    private func importTiles(_ chosen: [OrganizerTile], from other: OrganizerModel, document otherDocument: OpenDocument, at position: Int) {
        var mapped: [OrganizerTile] = []
        for tile in chosen {
            switch tile.kind {
            case .page(let source, let index):
                guard let info = other.source(source) else { continue }
                let url = source == OrganizerOps.mainSourceID ? otherDocument.url : info.url
                let id = model.addSource(url: url, password: info.password, document: info.document)
                mapped.append(OrganizerTile(key: OrganizerTile.newKey(), kind: .page(source: id, index: index), rotate: tile.rotate))
            default:
                mapped.append(tile.copy())
            }
        }
        withAnimation { model.insert(mapped, at: position) }
    }

    /// Drop on another document's chip: append the dragged pages to the end of that file.
    func copyTiles(fromPayloads items: [String], to target: OpenDocument) -> Bool {
        guard let payload = items.compactMap(PagesTilePayload.parse).first, payload.document == document.id else { return false }
        if target.isDirty {
            show(t("viewer.saveBeforePageDrop", ["name": target.fileName]), error: true)
            return false
        }
        let keys = model.selected.contains(payload.key) ? model.selected : [payload.key]
        let chosen = model.tiles.filter { keys.contains($0.key) }
        guard let mainURL = try? document.snapshotURL() else { return false }
        let sources = model.pageSources(mainURL: mainURL)
        let targetSource = PagesSource(id: "__target", url: target.url, password: target.password)
        let count = chosen.count
        runner.run(label: t("nav.pages")) { progress in
            progress(0.2, nil)
            let output = try PagesEngine.appendPages(to: targetSource, sources: sources, tiles: chosen)
            try await MainActor.run { try target.replaceFile(with: output) }
            return JobResult(summary: t("tools.pages.drag.copied", ["count": count, "name": target.fileName]))
        }
        return true
    }

    // MARK: Keyboard

    func handleKey(_ press: KeyPress) -> KeyPress.Result {
        let shift = press.modifiers.contains(.shift)
        let option = press.modifiers.contains(.option)
        let command = press.modifiers.contains(.command)
        if command { return .ignored }
        switch press.key {
        case .leftArrow, .rightArrow:
            let delta = press.key == .rightArrow ? 1 : -1
            if option { withAnimation { model.nudgeSelected(delta) } } else { model.moveFocus(by: delta, extend: shift) }
            return .handled
        case .upArrow, .downArrow:
            let delta = (press.key == .downArrow ? 1 : -1) * columns
            if option { withAnimation { model.nudgeSelected(delta) } } else { model.moveFocus(by: delta, extend: shift) }
            return .handled
        case .home, .end:
            let delta = (press.key == .end ? 1 : -1) * model.tiles.count
            if option { withAnimation { model.nudgeSelected(delta) } } else { model.moveFocus(by: delta, extend: shift) }
            return .handled
        case .delete, .deleteForward:
            withAnimation { model.deleteSelected() }
            return .handled
        case .escape:
            model.selectNone()
            return .handled
        case .space, .return:
            if let key = model.focusKey { openPreview(key) }
            return .handled
        default:
            break
        }
        switch press.characters.lowercased() {
        case "r":
            model.rotateSelected(shift ? -90 : 90)
        case "s":
            if shift { model.clearCuts() } else { model.toggleCutsAtSelection() }
        case "b":
            sheet = .blank
        case "m":
            if !model.selected.isEmpty, model.selected.count < model.tiles.count { sheet = .move }
        case "?":
            sheet = .shortcuts
        default:
            return .ignored
        }
        return .handled
    }

    /// ⌘ shortcuts (also listed in the iPad keyboard shortcut overlay).
    var shortcutButtons: some View {
        Group {
            Button(t("tools.pages.undo")) { withAnimation { model.undo() } }.keyboardShortcut("z")
            Button(t("tools.pages.redo")) { withAnimation { model.redo() } }.keyboardShortcut("z", modifiers: [.command, .shift])
            Button(t("tools.pages.redo")) { withAnimation { model.redo() } }.keyboardShortcut("y")
            Button(t("tools.pages.selectAll")) { model.selectAll() }.keyboardShortcut("a")
            Button(t("tools.pages.selectInvert")) { model.invertSelection() }.keyboardShortcut("i")
            Button(t("tools.pages.duplicate")) { withAnimation { model.duplicateSelected() } }.keyboardShortcut("d")
            Button(t("tools.pages.clipboard.copy")) { copyPages() }.keyboardShortcut("c")
            Button(t("tools.pages.clipboard.cut")) { cutPages() }.keyboardShortcut("x")
            Button(t("tools.pages.clipboard.paste")) { pastePages() }.keyboardShortcut("v")
            Button(t("tools.pages.print.menu")) { printPages() }.keyboardShortcut("p")
            Button(t("tools.pages.range.title")) { sheet = .range }.keyboardShortcut("g")
            Button(t("tools.pages.shortcut.extract")) { if !model.selected.isEmpty { apply(subset: true) } }.keyboardShortcut("e")
            Button(t("tools.pages.shortcut.apply")) { if model.isDirty { apply(subset: false) } }.keyboardShortcut(.return)
            Button(t("viewer.zoomIn")) { zoomBy(30) }.keyboardShortcut("+")
            Button(t("viewer.zoomIn")) { zoomBy(30) }.keyboardShortcut("=")
            Button(t("viewer.zoomOut")) { zoomBy(-30) }.keyboardShortcut("-")
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
        .disabled(sheet != nil)
    }

    // MARK: Menus

    @ViewBuilder var selectMenuItems: some View {
        let tiles = model.tiles
        Section {
            Button { model.selectAll() } label: { Label(t("tools.pages.selectAll"), systemImage: "checkmark.square") }.disabled(tiles.isEmpty)
            Button { model.selectNone() } label: { Label(t("tools.pages.selectNone"), systemImage: "square") }.disabled(model.selected.isEmpty)
            Button { sheet = .range } label: { Label(t("tools.pages.range.title"), systemImage: "character.cursor.ibeam") }
            Button { model.invertSelection() } label: { Label(t("tools.pages.selectInvert"), systemImage: "arrow.left.arrow.right.square") }.disabled(tiles.isEmpty)
            Button { model.selectParity(odd: true) } label: { Label(t("tools.pages.selectOdd"), systemImage: "1.square") }.disabled(tiles.isEmpty)
            Button { model.selectParity(odd: false) } label: { Label(t("tools.pages.selectEven"), systemImage: "2.square") }.disabled(tiles.count < 2)
        }
        Section {
            inspectionButton(.blank, t("tools.pages.selectBlank"), "doc") { selectAnalyzed(blank: true) }
            inspectionButton(.scanned, t("tools.pages.selectScanned"), "doc.viewfinder") { selectAnalyzed(blank: false) }
            inspectionButton(.duplicates, t("tools.pages.duplicates.select"), "square.on.square.dashed") { selectDuplicates() }
            inspectionButton(.text, t("tools.pages.textSelect.menu"), "text.magnifyingglass") { sheet = .text }
        }
        Section {
            let shapes = shapeGroups()
            Button { model.select(shapes.portrait) } label: { Label(t("tools.pages.selectPortrait"), systemImage: "rectangle.portrait") }.disabled(shapes.portrait.isEmpty)
            Button { model.select(shapes.landscape) } label: { Label(t("tools.pages.selectLandscape"), systemImage: "rectangle") }.disabled(shapes.landscape.isEmpty)
            Menu {
                ForEach(shapes.groups) { group in
                    Button(t("tools.pages.sizeGroup", ["size": sizeName(group), "count": group.keys.count])) { model.select(group.keys) }
                }
            } label: { Label(t("tools.pages.selectBySize"), systemImage: "ruler") }
            .disabled(shapes.groups.isEmpty)
        }
    }

    private func inspectionButton(_ kind: PagesInspection, _ title: String, _ symbol: String, run: @escaping () -> Void) -> some View {
        Button {
            if inspecting == kind { cancelInspection() } else { run() }
        } label: {
            Label(inspecting == kind ? t("tools.pages.inspecting") : title, systemImage: inspecting == kind ? "stop.circle" : symbol)
        }
        .disabled(model.tiles.isEmpty || (inspecting != nil && inspecting != kind))
    }

    @ViewBuilder var insertMenuItems: some View {
        Section {
            Button { sheet = .blank } label: { Label(t("tools.pages.insertBlank"), systemImage: "doc.badge.plus") }
            Button { present(.pdf(replacing: false)) } label: { Label(t("tools.pages.insertPdf"), systemImage: "doc.richtext") }
            Button { present(.images) } label: { Label(t("tools.pages.insertImages"), systemImage: "photo") }
            Button { showPhotos = true } label: { Label(t("ios.common.addPhotos"), systemImage: "photo.on.rectangle") }
            Button { pastePages() } label: { Label(t("tools.pages.clipboard.paste"), systemImage: "doc.on.clipboard.fill") }.disabled(PagesClipboard.isEmpty)
        }
        Section {
            Picker(selection: $insertPlaceRaw) {
                ForEach(OrganizerOps.InsertPlace.allCases, id: \.rawValue) { place in Text(t("tools.pages.insertPlace.\(place.rawValue)")).tag(place.rawValue) }
            } label: { Label(t("tools.pages.insertPlace.title"), systemImage: "text.insert") }
            .pickerStyle(.menu)
        }
        Section {
            Button { present(.pdf(replacing: true)) } label: { Label(t("tools.pages.replacePdf"), systemImage: "arrow.left.arrow.right") }
                .disabled(model.selected.isEmpty)
        }
    }

    @ViewBuilder var editMenuItems: some View {
        let count = model.selected.count
        let total = model.tiles.count
        Section {
            Button { model.rotateSelected(-90) } label: { Label(t("tools.pages.rotateLeft"), systemImage: "rotate.left") }.disabled(count == 0)
            Button { model.rotateSelected(90) } label: { Label(t("tools.pages.rotateRight"), systemImage: "rotate.right") }.disabled(count == 0)
            Button { withAnimation { model.duplicateSelected() } } label: { Label(t("tools.pages.duplicate"), systemImage: "plus.square.on.square") }.disabled(count == 0)
            Button { sheet = .copies } label: { Label(t("tools.pages.copies.menu"), systemImage: "square.on.square.badge.person.crop") }.disabled(count == 0)
            Button { withAnimation { model.reverseSelected() } } label: { Label(t("tools.pages.reverseSelection"), systemImage: "arrow.up.arrow.down") }.disabled(count < 2)
            Button { sheet = .move } label: { Label(t("tools.pages.menu.move", ["count": count]), systemImage: "arrow.right.doc.on.clipboard") }.disabled(count == 0 || count >= total)
            Button(role: .destructive) { withAnimation { model.deleteSelected() } } label: { Label(t("tools.pages.delete"), systemImage: "trash") }.disabled(count == 0 || count == total)
            Button(role: .destructive) { withAnimation { model.deleteRelative(before: true) } } label: { Label(t("tools.pages.deleteBefore"), systemImage: "arrow.backward.to.line") }.disabled(count != 1)
            Button(role: .destructive) { withAnimation { model.deleteRelative(before: false) } } label: { Label(t("tools.pages.deleteAfter"), systemImage: "arrow.forward.to.line") }.disabled(count != 1)
        }
        Section {
            Button { withAnimation { model.reverseAll() } } label: { Label(t("tools.pages.reverse"), systemImage: "arrow.left.arrow.right") }.disabled(total < 2)
            inspectionButton(.rotation, t("tools.pages.autoRotate"), "safari") { autoRotate() }
            Button { sheet = .duplex } label: { Label(t("tools.pages.duplex.title"), systemImage: "printer") }.disabled(total < 2)
            Button { if let key = model.focusKey { sheet = .label(key) } } label: { Label(t("tools.pages.labels.button"), systemImage: "tag") }.disabled(total == 0)
        }
    }

    @ViewBuilder var splitMenuItems: some View {
        Button { model.toggleCutsAtSelection() } label: { Label(t("tools.pages.cutAtSelection"), systemImage: "scissors") }.disabled(model.selected.isEmpty)
        inspectionButton(.bookmarks, t("tools.pages.chapters.cut"), "bookmark") { cutAtChapters() }
        Button { model.clearCuts() } label: { Label(t("tools.pages.clearCuts"), systemImage: "eraser") }.disabled(model.partStarts.isEmpty)
        if !model.partStarts.isEmpty {
            Divider()
            Button { saveParts() } label: { Label(t("tools.pages.splitParts", ["count": model.partStarts.count + 1]), systemImage: "square.split.2x1") }
                .disabled(runner.isRunning)
        }
    }

    /// Long-press menu of one tile (`organizerMenu.ts`); acts on the selection when the tile is part of it.
    @ViewBuilder func tileMenu(_ key: String) -> some View {
        let position = model.position(of: key) ?? 0
        let tile = model.tiles.indices.contains(position) ? model.tiles[position] : nil
        let inSelection = model.selected.contains(key)
        let count = inSelection ? model.selected.count : 1
        let total = model.tiles.count
        let isLast = position == total - 1
        let focus = { if !inSelection { model.select([key], anchor: .some(key)) } }
        Section {
            Button { openPreview(key) } label: { Label(t("tools.pages.menu.preview"), systemImage: "eye") }
            if let tile, tile.sourceID == OrganizerOps.mainSourceID {
                Button { openInViewer(tile) } label: { Label(t("tools.pages.menu.openInViewer"), systemImage: "book") }
            }
        }
        Section {
            Button { focus(); model.rotateSelected(-90) } label: { Label(t("tools.pages.rotateLeft"), systemImage: "rotate.left") }
            Button { focus(); model.rotateSelected(90) } label: { Label(t("tools.pages.rotateRight"), systemImage: "rotate.right") }
            Button { focus(); withAnimation { model.duplicateSelected() } } label: { Label(t("tools.pages.duplicate"), systemImage: "plus.square.on.square") }
            Button { focus(); sheet = .copies } label: { Label(t("tools.pages.copies.menu"), systemImage: "square.on.square.badge.person.crop") }
            Button { focus(); withAnimation { model.reverseSelected() } } label: { Label(t("tools.pages.reverseSelection"), systemImage: "arrow.up.arrow.down") }.disabled(count < 2)
            Button { focus(); sheet = .move } label: { Label(t("tools.pages.menu.move", ["count": count]), systemImage: "arrow.right.doc.on.clipboard") }.disabled(count >= total)
            Button(role: .destructive) { focus(); withAnimation { model.deleteSelected() } } label: { Label(t("tools.pages.delete"), systemImage: "trash") }.disabled(count >= total)
        }
        Section {
            Button { focus(); copyPages() } label: { Label(t("tools.pages.clipboard.copy"), systemImage: "doc.on.clipboard") }
            Button { focus(); cutPages() } label: { Label(t("tools.pages.clipboard.cut"), systemImage: "scissors.badge.ellipsis") }.disabled(count >= total)
            Button { focus(); pastePages() } label: { Label(t("tools.pages.clipboard.paste"), systemImage: "doc.on.clipboard.fill") }.disabled(PagesClipboard.isEmpty)
        }
        Section {
            Button { model.toggleCut(at: key) } label: {
                Label(t(model.cuts.contains(key) ? "tools.pages.menu.removeCut" : "tools.pages.menu.cutHere"), systemImage: "scissors")
            }
            .disabled(isLast)
            Button { focus(); apply(subset: true) } label: { Label(t("tools.pages.menu.extract", ["count": count]), systemImage: "square.and.arrow.up.on.square") }.disabled(runner.isRunning)
            Button { focus(); sheet = .images } label: { Label(t("tools.pages.exportImages.menu"), systemImage: "photo.on.rectangle") }.disabled(runner.isRunning)
            Button { focus(); printPages() } label: { Label(t("tools.pages.print.menu"), systemImage: "printer") }.disabled(runner.isRunning)
        }
        Section {
            Button { model.select([key], anchor: .some(key)); sheet = .blank } label: { Label(t("tools.pages.menu.insertBlank"), systemImage: "doc.badge.plus") }
            Button { sheet = .label(key) } label: { Label(t("tools.pages.menu.label"), systemImage: "tag") }
        }
    }

    // MARK: Shapes

    func shapeGroups() -> (portrait: [String], landscape: [String], groups: [OrganizerOps.SizeGroup]) {
        var portrait: [String] = [], landscape: [String] = []
        var sizes: [String: CGSize] = [:]
        for tile in model.tiles {
            guard let size = model.displaySize(of: tile) else { continue }
            sizes[tile.key] = size
            if abs(size.width - size.height) < 1 { continue }
            if size.height > size.width { portrait.append(tile.key) } else { landscape.append(tile.key) }
        }
        return (portrait, landscape, OrganizerOps.sizeGroups(model.tiles) { sizes[$0.key] })
    }

    func sizeName(_ group: OrganizerOps.SizeGroup) -> String {
        let millimetres = "\(Int((group.size.width * 25.4 / 72).rounded())) × \(Int((group.size.height * 25.4 / 72).rounded())) mm"
        guard let paper = group.paper else { return millimetres }
        return "\(t("tools.pages.papers.\(paper.rawValue)")) · \(millimetres)"
    }

    // MARK: Inserting files

    func present(_ kind: PagesImportKind) {
        pendingImport = kind
        importKind = kind
    }

    func handleImport(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let kind = pendingImport else { return }
        pendingImport = nil
        switch kind {
        case .images:
            insertFiles(urls)
        case .pdf(let replacing):
            guard let url = urls.first, let copy = try? Workspace.importCopy(of: url) else { return }
            insertQueue.append((copy, replacing))
            advanceInsertQueue()
        }
    }

    /// Images become picture pages; PDFs are inserted whole (or asked for a password first).
    func insertFiles(_ urls: [URL]) {
        var images: [OrganizerTile] = []
        for url in urls {
            guard let copy = (try? Workspace.importCopy(of: url)) else { continue }
            if PagesEngine.isImage(copy) {
                images.append(OrganizerTile(key: OrganizerTile.newKey(), kind: .image(url: copy)))
            } else if copy.pathExtension.lowercased() == "pdf" {
                guard let pdf = PDFDocument(url: copy) else { show(t("errors.INVALID_PDF"), error: true); continue }
                if pdf.isLocked {
                    insertQueue.append((copy, false))
                } else {
                    let id = model.addSource(url: copy, password: nil, document: pdf)
                    let pages = (0..<pdf.pageCount).map { OrganizerTile(key: OrganizerTile.newKey(), kind: .page(source: id, index: $0 + 1)) }
                    withAnimation { model.insert(pages, place: insertPlace) }
                }
            }
        }
        if !images.isEmpty { withAnimation { model.insert(images, place: insertPlace) } }
        advanceInsertQueue()
    }

    func advanceInsertQueue() {
        guard sheet == nil, !insertQueue.isEmpty else { return }
        let next = insertQueue.removeFirst()
        sheet = .insertPDF(next.url, replacing: next.replacing)
    }

    // MARK: Clipboard

    func copyPages() {
        guard !model.selected.isEmpty else { return }
        PagesClipboard.items = model.selectedTiles.map { tile in
            if case .page(let source, _) = tile.kind, let info = model.source(source) {
                let url = source == OrganizerOps.mainSourceID ? document.url : info.url
                return PagesClipboard.Clipped(kind: tile.kind, rotate: tile.rotate, source: (url, info.password, info.document))
            }
            return PagesClipboard.Clipped(kind: tile.kind, rotate: tile.rotate, source: nil)
        }
        show(t("tools.pages.clipboard.copied"))
    }

    func cutPages() {
        guard !model.selected.isEmpty, model.selected.count < model.tiles.count else { return }
        copyPages()
        withAnimation { model.deleteSelected() }
    }

    func pastePages() {
        guard !PagesClipboard.isEmpty else { return }
        var tiles: [OrganizerTile] = []
        for item in PagesClipboard.items {
            switch item.kind {
            case .page(_, let index):
                guard let source = item.source else { continue }
                let id = source.url.standardizedFileURL == document.url.standardizedFileURL
                    ? OrganizerOps.mainSourceID
                    : model.addSource(url: source.url, password: source.password, document: source.document)
                tiles.append(OrganizerTile(key: OrganizerTile.newKey(), kind: .page(source: id, index: index), rotate: item.rotate))
            default:
                tiles.append(OrganizerTile(key: OrganizerTile.newKey(), kind: item.kind, rotate: item.rotate))
            }
        }
        withAnimation { model.insert(tiles, place: insertPlace) }
    }

    // MARK: Output

    /// Apply (whole arrangement → new file or the original) or extract (selection → new file).
    func apply(subset: Bool) {
        let inPlace = !subset && applyInPlace
        let chosen = subset ? model.selectedTiles : model.tiles
        guard !chosen.isEmpty, !runner.isRunning else { return }
        let rules = subset ? OrganizerOps.subsetLabelRules(model.tiles, labels: model.labels, keep: model.selected)
                           : OrganizerOps.labelRules(chosen, labels: model.labels)
        let mainURL: URL
        do { mainURL = try document.snapshotURL() } catch { show(error.localizedDescription, error: true); return }
        let sources = model.pageSources(mainURL: mainURL)
        let password = document.pdf.isEncrypted ? document.password : nil
        let output = inPlace ? Workspace.scratch().appendingPathComponent(document.fileName)
                             : Workspace.output(for: document.url, suffix: t(subset ? "tools.pages.extractSuffix" : "tools.pages.suffix"), ext: "pdf")
        let target = document
        let name = document.fileName
        runner.run(label: t("nav.pages")) { progress in
            let count = try PagesEngine.assemble(sources: sources, tiles: chosen, labels: rules.isEmpty ? nil : rules, output: output,
                                                 password: password, progress: progress)
            if inPlace {
                try await MainActor.run { try target.replaceFile(with: output) }
                return JobResult(summary: t("tools.pages.inPlace.done", ["name": name]))
            }
            return JobResult(outputs: [output], summary: t("tools.done"), details: [(t("info.pages"), "\(count)")])
        }
    }

    /// Saves each part between split marks as its own file.
    func saveParts() {
        let starts = model.partStarts
        guard !starts.isEmpty, !runner.isRunning, let mainURL = try? document.snapshotURL() else { return }
        let rules = OrganizerOps.labelRules(model.tiles, labels: model.labels)
        let sources = model.pageSources(mainURL: mainURL)
        let tiles = model.tiles
        let password = document.pdf.isEncrypted ? document.password : nil
        let folder = Workspace.outputDirectory(for: document.url, suffix: t("tools.split.suffix"))
        let base = "\(document.title)-\(t("tools.pages.suffix"))"
        runner.run(label: t("nav.pages")) { progress in
            let outputs = try PagesEngine.assembleParts(sources: sources, tiles: tiles, cuts: starts, labels: rules.isEmpty ? nil : rules,
                                                        folder: folder, baseName: base, password: password, progress: progress)
            return JobResult(outputs: outputs, summary: "\(outputs.count) \(t("tools.split.parts"))")
        }
    }

    /// Prints the selected pages (or all) as arranged here.
    func printPages() {
        guard !preparingPrint, !model.tiles.isEmpty, let mainURL = try? document.snapshotURL() else { return }
        let chosen = model.selected.isEmpty ? model.tiles : model.selectedTiles
        let sources = model.pageSources(mainURL: mainURL)
        let output = Workspace.scratch().appendingPathComponent(document.fileName)
        let jobName = document.title
        preparingPrint = true
        Task {
            defer { preparingPrint = false }
            do {
                _ = try await Task.detached(priority: .userInitiated) {
                    try PagesEngine.assemble(sources: sources, tiles: chosen, labels: nil, output: output)
                }.value
                let info = UIPrintInfo(dictionary: nil)
                info.jobName = jobName
                info.outputType = .general
                let controller = UIPrintInteractionController.shared
                controller.printInfo = info
                controller.printingItem = output
                controller.present(animated: true)
            } catch {
                show(error.localizedDescription, error: true)
            }
        }
    }

    // MARK: Inspections (usePageInspections)

    /// Sources whose pages are in the arrangement, the open document read with unsaved changes.
    private func inspectionSources() -> [PagesSource]? {
        guard let mainURL = try? document.snapshotURL() else { return nil }
        let used = Set(model.tiles.compactMap(\.sourceID))
        return model.pageSources(mainURL: mainURL).filter { used.contains($0.id) }
    }

    func runInspection<R: Sendable>(_ kind: PagesInspection, work: @escaping @Sendable ([PagesSource]) throws -> R, then apply: @escaping @MainActor (R) -> Void) {
        guard inspecting == nil, let sources = inspectionSources() else { return }
        inspecting = kind
        inspectionTask = Task.detached(priority: .userInitiated) {
            let outcome = Result { try work(sources) }
            let cancelled = Task.isCancelled
            await MainActor.run {
                inspecting = nil
                inspectionTask = nil
                guard !cancelled else { return }
                switch outcome {
                case .success(let value): apply(value)
                case .failure(let error):
                    if !(error is CancellationError) { show(error.localizedDescription, error: true) }
                }
            }
        }
    }

    func cancelInspection() {
        inspectionTask?.cancel()
        inspectionTask = nil
        inspecting = nil
    }

    func selectAnalyzed(blank: Bool) {
        runInspection(blank ? .blank : .scanned) { sources in
            var pages: [String: Set<Int>] = [:]
            for source in sources {
                let analysis = try PageInspections.analyze(source)
                pages[source.id] = blank ? analysis.blank : analysis.scanned
            }
            return pages
        } then: { pages in
            let keys = model.tiles(matching: pages, includeBlankTiles: blank)
            if keys.isEmpty { show(t(blank ? "tools.pages.blankNone" : "tools.pages.scannedNone")); return }
            model.select(keys)
            show(t(blank ? "tools.pages.blankFound" : "tools.pages.scannedFound", ["count": keys.count]))
        }
    }

    func selectByText(_ query: PagesTextQuery) {
        runInspection(.text) { sources in
            var pages: [String: Set<Int>] = [:]
            for source in sources {
                pages[source.id] = Set(try PageInspections.findText(source, query: query.query, matchCase: query.matchCase, wholeWord: query.wholeWord))
            }
            return pages
        } then: { pages in
            let keys = model.tiles(matching: pages, includeBlankTiles: false)
            if keys.isEmpty { show(t("tools.pages.textSelect.none")); return }
            model.select(query.addToSelection ? Array(Set(keys).union(model.selected)) : keys, anchor: .some(keys.first))
            show(t("tools.pages.textSelect.found", ["count": keys.count]))
        }
    }

    func autoRotate() {
        runInspection(.rotation) { sources in
            var turns: [String: [Int: Int]] = [:], upright: [String: Set<Int>] = [:]
            for source in sources {
                let detected = try PageInspections.detectRotation(source)
                turns[source.id] = detected.turns
                upright[source.id] = detected.upright
            }
            return (turns, upright)
        } then: { result in
            let changed = withAnimation { model.applyDetectedRotation(result.0, upright: result.1) }
            show(changed == 0 ? t("tools.pages.autoRotateNone") : t("tools.pages.autoRotateDone", ["count": changed]))
        }
    }

    func cutAtChapters() {
        runInspection(.bookmarks) { sources in
            var starts: [String: Set<Int>] = [:]
            for source in sources { starts[source.id] = try PageInspections.chapterStarts(source) }
            return starts
        } then: { starts in
            var keys: [String] = []
            for (position, tile) in model.tiles.enumerated() where position > 0 {
                if case .page(let source, let index) = tile.kind, starts[source]?.contains(index) == true { keys.append(model.tiles[position - 1].key) }
            }
            if keys.isEmpty { show(t("tools.pages.chapters.none")); return }
            model.addCuts(keys)
            show(t("tools.pages.chapters.done", ["count": keys.count]))
        }
    }

    func selectDuplicates() {
        let imageURLs = Array(Set(model.tiles.compactMap { tile -> URL? in if case .image(let url) = tile.kind { url } else { nil } }))
        runInspection(.duplicates) { sources in
            let order = sources.map(\.url) + imageURLs
            var passwords: [URL: String?] = [:]
            for source in sources { passwords[source.url] = source.password }
            let groups = try PageInspections.duplicateGroups(passwords, order: order)
            var bySource: [String: [Int?]] = [:]
            for (position, source) in sources.enumerated() { bySource[source.id] = groups[position] }
            for (offset, url) in imageURLs.enumerated() { bySource["image:\(url.path)"] = groups[sources.count + offset] }
            return bySource
        } then: { groups in
            var seen = Set<String>()
            var duplicates: [String] = []
            for tile in model.tiles {
                let signature: String
                switch tile.kind {
                case .page(let source, let index):
                    let group = groups[source].flatMap { index - 1 < $0.count ? $0[index - 1] : nil }
                    signature = group.map { "group:\($0)" } ?? "page:\(source):\(index)"
                case .image(let url):
                    let group = groups["image:\(url.path)"]?.first ?? nil
                    signature = group.map { "group:\($0)" } ?? "image:\(url.path)"
                case .blank:
                    continue
                }
                if !seen.insert(signature).inserted { duplicates.append(tile.key) }
            }
            if duplicates.isEmpty { show(t("tools.pages.duplicates.none")); return }
            model.select(duplicates)
            show(t("tools.pages.duplicates.found", ["count": duplicates.count]))
        }
    }
}
