import PDFKit
import SwiftUI

// Sheets of the page organizer (`InsertDialogs.tsx`, `OrganizerDialogs.tsx`, `ExportImagesDialog.tsx`).

/// Form sheet scaffold: title, Cancel and a confirm button.
struct PagesOrganizerSheet<Content: View>: View {
    let title: String
    var confirmTitle: String? = nil
    var confirmDisabled = false
    var onConfirm: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form { content() }
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                    if let confirmTitle, let onConfirm {
                        ToolbarItem(placement: .confirmationAction) {
                            Button(confirmTitle) { onConfirm() }.disabled(confirmDisabled).fontWeight(.semibold)
                        }
                    }
                }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: Insert blank

struct InsertBlankSheet: View {
    enum Preset: String, CaseIterable { case match, a4, a5, a3, letter }
    let matchSize: CGSize?
    let onInsert: (_ width: Double, _ height: Double, _ count: Int, _ paper: PagesPaperPattern?) -> Void

    @State private var preset: Preset = .a4
    @State private var landscape = false
    @State private var count = 1
    @State private var style: PagesPaperStyle?
    @State private var spacing = PagesPaperStyle.lined.defaultSpacing
    @State private var color = Color(red: 0.608, green: 0.706, blue: 0.816)
    @State private var margin = true

    private static let points: [Preset: CGSize] = [.a4: CGSize(width: 595, height: 842), .letter: CGSize(width: 612, height: 792),
                                                   .a5: CGSize(width: 420, height: 595), .a3: CGSize(width: 842, height: 1191)]

    private var size: CGSize {
        var base = preset == .match ? (matchSize ?? Self.points[.a4]!) : Self.points[preset]!
        if landscape != (base.width > base.height) { base = CGSize(width: base.height, height: base.width) }
        return base
    }

    private var paper: PagesPaperPattern? {
        style.map { PagesPaperPattern(style: $0, spacing: spacing, color: color.pagesHex, margin: $0 == .lined && margin) }
    }

    var body: some View {
        PagesOrganizerSheet(title: t("tools.pages.insertBlank"), confirmTitle: t("tools.pages.insert")) {
            onInsert(size.width, size.height, max(1, min(100, count)), paper)
        } content: {
            Section {
                Picker(t("tools.pages.paperSize"), selection: $preset) {
                    if matchSize != nil { Text(t("tools.pages.matchPage")).tag(Preset.match) }
                    Text("A4").tag(Preset.a4)
                    Text("A5").tag(Preset.a5)
                    Text("A3").tag(Preset.a3)
                    Text(t("tools.pages.papers.letter")).tag(Preset.letter)
                }
                Picker(t("tools.pages.orientation"), selection: $landscape) {
                    Text(t("tools.pages.portrait")).tag(false)
                    Text(t("tools.pages.landscape")).tag(true)
                }
                Stepper(value: $count, in: 1...100) {
                    LabeledContent(t("tools.pages.count"), value: "\(count)")
                }
            }
            Section {
                Picker(t("tools.pages.paper.label"), selection: $style) {
                    Text(t("tools.pages.paper.plain")).tag(PagesPaperStyle?.none)
                    ForEach(PagesPaperStyle.allCases, id: \.self) { style in
                        Text(t("tools.pages.paper.\(style.rawValue)")).tag(PagesPaperStyle?.some(style))
                    }
                }
                .onChange(of: style) { _, value in if let value { spacing = value.defaultSpacing } }
                if let paper {
                    VStack(alignment: .leading) {
                        LabeledContent(t("tools.pages.paper.spacing"), value: t("tools.pages.paper.millimetres", ["value": spacing]))
                        Slider(value: $spacing, in: PagesPaperPattern.spacingRange, step: PagesPaperPattern.spacingStep)
                            .accessibilityLabel(t("tools.pages.paper.spacing"))
                    }
                    ColorPicker(t("tools.pages.paper.color"), selection: $color, supportsOpacity: false)
                    if paper.style == .lined { Toggle(t("tools.pages.paper.margin"), isOn: $margin) }
                    PagesPaperPreview(size: size, paper: paper)
                        .frame(maxHeight: 220)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .onAppear { if matchSize != nil { preset = .match } }
    }
}

extension Color {
    /// `#rrggbb` of the colour in sRGB.
    var pagesHex: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        func byte(_ v: CGFloat) -> Int { Int((min(max(v, 0), 1) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b))
    }
}

// MARK: Insert / replace from PDF

struct InsertPDFSheet: View {
    let url: URL
    let replacing: Bool
    let onInsert: (_ document: PDFDocument, _ password: String?, _ pages: [Int]) -> Void

    @State private var document: PDFDocument?
    @State private var failed = false
    @State private var locked = false
    @State private var wrongPassword = false
    @State private var password = ""
    @State private var ranges = ""

    private var pages: [Int]? {
        guard let document else { return nil }
        if ranges.trimmingCharacters(in: .whitespaces).isEmpty { return Array(1...max(1, document.pageCount)) }
        return PagesSpecs.rangePages(ranges, pageCount: document.pageCount)
    }

    var body: some View {
        PagesOrganizerSheet(title: t(replacing ? "tools.pages.replacePdf" : "tools.pages.insertPdf"),
                       confirmTitle: document == nil ? nil : t(replacing ? "tools.pages.replaceCount" : "tools.pages.insertCount", ["count": pages?.count ?? 0]),
                       confirmDisabled: (pages ?? []).isEmpty) {
            if let document, let pages { onInsert(document, locked ? password : nil, pages) }
        } content: {
            Section {
                Label(url.lastPathComponent, systemImage: "doc.richtext").lineLimit(2)
                if failed { Text(t("errors.INVALID_PDF")).foregroundStyle(Palette.destructive) }
            }
            if locked && document == nil {
                Section {
                    SecureField(t("password.label"), text: $password)
                        .textContentType(.password)
                        .onSubmit(unlock)
                    if wrongPassword { Text(t("password.wrong")).foregroundStyle(Palette.destructive) }
                    Button(t("password.open"), action: unlock).disabled(password.isEmpty)
                }
            }
            if let document {
                Section {
                    TextField(t("tools.allPages"), text: $ranges)
                        .keyboardType(.numbersAndPunctuation)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .font(.body.monospaced())
                } header: {
                    Text(t("tools.pages.pagesToInsert", ["count": document.pageCount]))
                } footer: {
                    if pages == nil { Text(t("tools.pages.invalidRange")).foregroundStyle(Palette.destructive) } else { Text(t("tools.split.rangesHint")) }
                }
            }
        }
        .task { load() }
    }

    private func load() {
        guard let loaded = PDFDocument(url: url) else { failed = true; return }
        if loaded.isLocked { locked = true } else { document = loaded }
    }

    private func unlock() {
        guard let loaded = PDFDocument(url: url) else { failed = true; return }
        if loaded.unlock(withPassword: password) { document = loaded; wrongPassword = false } else { wrongPassword = true }
    }
}

// MARK: Select by page numbers

struct RangeSelectSheet: View {
    let total: Int
    let onSelect: ([Int]) -> Void
    @State private var spec = ""
    @FocusState private var focused: Bool

    var body: some View {
        let positions = spec.trimmingCharacters(in: .whitespaces).isEmpty ? nil : PagesSpecs.rangePages(spec, pageCount: total)
        let invalid = !spec.trimmingCharacters(in: .whitespaces).isEmpty && positions == nil
        PagesOrganizerSheet(title: t("tools.pages.range.title"), confirmTitle: t("tools.pages.range.select"), confirmDisabled: (positions ?? []).isEmpty) {
            if let positions { onSelect(positions) }
        } content: {
            Section {
                TextField("1-5, 9, 12-", text: $spec)
                    .keyboardType(.numbersAndPunctuation)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .font(.body.monospaced())
                    .focused($focused)
                    .onSubmit { if let positions, !positions.isEmpty { onSelect(positions) } }
            } header: {
                Text(t("tools.pages.range.label", ["total": total]))
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(t("tools.pages.range.hint"))
                    Text(invalid ? t("tools.pages.invalidRange") : t("tools.pages.selectedCount", ["count": positions?.count ?? 0]))
                        .foregroundStyle(invalid ? Palette.destructive : Palette.mutedForeground)
                }
            }
        }
        .onAppear { focused = true }
    }
}

// MARK: Move to page number

struct MovePagesSheet: View {
    let total: Int
    let count: Int
    let onMove: (Int) -> Void
    @State private var value = ""
    @FocusState private var focused: Bool

    var body: some View {
        let position = Int(value.trimmingCharacters(in: .whitespaces))
        let valid = position.map { $0 >= 1 && $0 <= total } ?? false
        let invalid = !value.trimmingCharacters(in: .whitespaces).isEmpty && !valid
        PagesOrganizerSheet(title: t("tools.pages.move.title"), confirmTitle: t("tools.pages.move.submit"), confirmDisabled: !valid) {
            if let position, valid { onMove(position) }
        } content: {
            Section {
                TextField("1", text: $value)
                    .keyboardType(.numberPad)
                    .font(.body.monospaced())
                    .focused($focused)
            } header: {
                Text(t("tools.pages.move.label", ["total": total]))
            } footer: {
                Text(invalid ? t("tools.pages.move.invalid", ["total": total]) : t("tools.pages.move.hint", ["count": count]))
                    .foregroundStyle(invalid ? Palette.destructive : Palette.mutedForeground)
            }
        }
        .onAppear { focused = true }
    }
}

// MARK: Copies

struct CopiesSheet: View {
    static let limit = 99
    let count: Int
    let onDuplicate: (Int, OrganizerOps.CopyLayout) -> Void
    @State private var copies = 1
    @State private var layout: OrganizerOps.CopyLayout = .each

    var body: some View {
        PagesOrganizerSheet(title: t("tools.pages.copies.title"), confirmTitle: t("tools.pages.copies.submit")) {
            onDuplicate(copies, layout)
        } content: {
            Section {
                Stepper(value: $copies, in: 1...Self.limit) {
                    LabeledContent(t("tools.pages.copies.count"), value: "\(copies)")
                }
            } footer: {
                Text(t("tools.pages.copies.hint", ["count": count]))
            }
            Section(t("tools.pages.copies.layout")) {
                Picker(t("tools.pages.copies.layout"), selection: $layout) {
                    Text(t("tools.pages.copies.each")).tag(OrganizerOps.CopyLayout.each)
                    Text(t("tools.pages.copies.block")).tag(OrganizerOps.CopyLayout.block)
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
        }
    }
}

// MARK: Select by text

struct PagesTextQuery: Sendable {
    var query = ""
    var matchCase = false
    var wholeWord = false
    var addToSelection = false
}

struct TextSelectSheet: View {
    let hasSelection: Bool
    let onSearch: (PagesTextQuery) -> Void
    @State private var query = PagesTextQuery()
    @FocusState private var focused: Bool

    var body: some View {
        let valid = !query.query.trimmingCharacters(in: .whitespaces).isEmpty
        PagesOrganizerSheet(title: t("tools.pages.textSelect.title"), confirmTitle: t("tools.pages.textSelect.submit"), confirmDisabled: !valid) {
            var chosen = query
            chosen.addToSelection = query.addToSelection && hasSelection
            onSearch(chosen)
        } content: {
            Section {
                TextField(t("tools.pages.textSelect.query"), text: $query.query)
                    .focused($focused)
                    .autocorrectionDisabled()
            } header: {
                Text(t("tools.pages.textSelect.query"))
            } footer: {
                Text(t("tools.pages.textSelect.hint"))
            }
            Section {
                Toggle(t("tools.pages.textSelect.matchCase"), isOn: $query.matchCase)
                Toggle(t("tools.pages.textSelect.wholeWord"), isOn: $query.wholeWord)
                Toggle(t("tools.pages.textSelect.addToSelection"), isOn: $query.addToSelection).disabled(!hasSelection)
            }
        }
        .onAppear { focused = true }
    }
}

// MARK: Duplex

struct DuplexSheet: View {
    let total: Int
    let onApply: (_ pad: Bool, _ reverseBacks: Bool, _ twoFiles: Bool) -> Void
    @State private var pad = true
    @State private var reverseBacks = true
    @State private var twoFiles = true

    private var preview: (fronts: String, backs: String) {
        let count = total % 2 == 1 && pad ? total + 1 : total
        func name(_ position: Int) -> String { position > total ? "□" : "\(position)" }
        let fronts = (0..<Int((Double(count) / 2).rounded(.up))).map { name($0 * 2 + 1) }
        var backs = (0..<(count / 2)).map { name($0 * 2 + 2) }
        if reverseBacks { backs.reverse() }
        func shorten(_ items: [String]) -> String {
            items.count > 8 ? items.prefix(4).joined(separator: ", ") + " … " + items.suffix(2).joined(separator: ", ") : items.joined(separator: ", ")
        }
        return (shorten(fronts), shorten(backs))
    }

    var body: some View {
        PagesOrganizerSheet(title: t("tools.pages.duplex.title"), confirmTitle: t("tools.pages.duplex.apply"), confirmDisabled: total < 2) {
            onApply(pad, reverseBacks, twoFiles)
        } content: {
            Section {
                Text(t("tools.pages.duplex.intro")).font(.callout).foregroundStyle(Palette.mutedForeground)
            }
            Section {
                toggle(t("tools.pages.duplex.pad"), hint: t("tools.pages.duplex.padHint"), isOn: $pad).disabled(total % 2 == 0)
                toggle(t("tools.pages.duplex.reverse"), hint: t("tools.pages.duplex.reverseHint"), isOn: $reverseBacks)
                toggle(t("tools.pages.duplex.twoFiles"), hint: t("tools.pages.duplex.twoFilesHint"), isOn: $twoFiles)
            }
            Section {
                LabeledContent(t("tools.pages.duplex.fronts")) { Text(preview.fronts).font(.caption.monospaced()) }
                LabeledContent(t("tools.pages.duplex.backs")) { Text(preview.backs.isEmpty ? "—" : preview.backs).font(.caption.monospaced()) }
            }
        }
    }

    private func toggle(_ title: String, hint: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(hint).font(.caption).foregroundStyle(Palette.mutedForeground)
            }
        }
    }
}

// MARK: Page labels

struct PageLabelSheet: View {
    let position: Int
    let current: PagesTileLabel?
    let hasLabels: Bool
    let onApply: (PagesTileLabel) -> Void
    let onRemove: () -> Void
    let onClearAll: () -> Void
    @State private var label = PagesTileLabel()

    var body: some View {
        let empty = label.style == .none && label.prefix.trimmingCharacters(in: .whitespaces).isEmpty
        PagesOrganizerSheet(title: t("tools.pages.labels.title", ["page": position + 1]), confirmTitle: t("tools.pages.labels.apply"), confirmDisabled: empty) {
            var chosen = label
            chosen.firstNumber = max(1, min(PagesTileLabel.numberLimit, chosen.firstNumber))
            chosen.prefix = String(chosen.prefix.prefix(PagesTileLabel.prefixLimit))
            onApply(chosen)
        } content: {
            Section {
                Text(t("tools.pages.labels.intro")).font(.callout).foregroundStyle(Palette.mutedForeground)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        Button(t("tools.pages.labels.preset.cover")) { label = PagesTileLabel(style: .none, prefix: t("tools.pages.labels.coverText"), firstNumber: 1) }
                        Button(t("tools.pages.labels.preset.roman")) { label = PagesTileLabel(style: .romanLower, prefix: "", firstNumber: 1) }
                        Button(t("tools.pages.labels.preset.fromOne")) { label = PagesTileLabel(style: .decimal, prefix: "", firstNumber: 1) }
                    }
                    .buttonStyle(.bordered)
                }
            }
            Section {
                Picker(t("tools.pages.labels.style"), selection: $label.style) {
                    ForEach(PageLabelStyle.allCases, id: \.self) { style in Text(t("tools.pages.labels.styles.\(style.labelKey)")).tag(style) }
                }
                VStack(alignment: .leading, spacing: 4) {
                    TextField(t("tools.pages.labels.prefix"), text: $label.prefix)
                    Text(t("tools.pages.labels.prefixHint")).font(.caption).foregroundStyle(Palette.mutedForeground)
                }
                if label.style != .none {
                    Stepper(value: $label.firstNumber, in: 1...PagesTileLabel.numberLimit) {
                        LabeledContent(t("tools.pages.labels.start"), value: "\(label.firstNumber)")
                    }
                }
                LabeledContent(t("tools.pages.labels.sample")) {
                    Text(label.style == .none ? (label.text(at: 0).isEmpty ? "—" : label.text(at: 0)) : (0..<3).map { label.text(at: $0) }.joined(separator: ", ") + " …")
                        .font(.body.monospaced())
                }
            }
            if current != nil || hasLabels {
                Section {
                    if current != nil { Button(t("tools.pages.labels.remove"), role: .destructive, action: onRemove) }
                    if hasLabels { Button(t("tools.pages.labels.clearAll"), role: .destructive, action: onClearAll) }
                }
            }
        }
        .onAppear { label = current ?? PagesTileLabel() }
    }
}

// MARK: Keyboard shortcuts

struct PagesShortcutsSheet: View {
    private static let rows: [(String, String)] = [
        ("Ctrl+Z / Ctrl+Shift+Z", "undoRedo"), ("Delete", "delete"), ("R / Shift+R", "rotate"), ("Ctrl+D", "duplicate"),
        ("Ctrl+C / Ctrl+X / Ctrl+V", "clipboard"), ("S", "cut"), ("Shift+S", "clearCuts"), ("B", "insertBlank"), ("Ctrl+E", "extract"),
        ("Ctrl+P", "print"), ("Ctrl+A / Esc", "selectAllNone"), ("Ctrl+I", "invertSelection"), ("Ctrl+G", "range"), ("Space / Enter", "preview"),
        ("← → ↑ ↓ (+Shift)", "navigate"), ("Alt+← → ↑ ↓", "nudge"), ("M", "move"), ("Home / End", "firstLast"), ("Ctrl +/−", "zoom"),
        ("Ctrl+Enter", "apply"), ("?", "help"),
    ]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(Self.rows, id: \.1) { keys, labelKey in
                ViewThatFits(in: .horizontal) {
                    HStack {
                        Text(t("tools.pages.shortcut.\(labelKey)")).foregroundStyle(Palette.mutedForeground)
                        Spacer(minLength: 12)
                        Text(L10n.shortcutLabel(keys)).font(.callout.monospaced())
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t("tools.pages.shortcut.\(labelKey)")).foregroundStyle(Palette.mutedForeground)
                        Text(L10n.shortcutLabel(keys)).font(.callout.monospaced())
                    }
                }
            }
            .navigationTitle(t("tools.pages.shortcuts"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: Export pictures

struct ExportImagesSheet: View {
    static let dpiChoices: [CGFloat] = [72, 96, 150, 200, 300, 400, 600]
    let count: Int
    let prepare: @MainActor () throws -> (sources: [PagesSource], tiles: [OrganizerTile], baseName: String, folderSource: URL)
    @AppStorage("vivepdf.pages.imageFormat") private var formatRaw = PageInspections.ImageFormat.png.rawValue
    @AppStorage("vivepdf.pages.imageDpi") private var dpi: Double = 150
    @AppStorage("vivepdf.pages.imageQuality") private var quality: Double = 90
    @State private var runner = JobRunner()
    @Environment(\.dismiss) private var dismiss

    private var format: PageInspections.ImageFormat { PageInspections.ImageFormat(rawValue: formatRaw) ?? .png }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(t("tools.pages.exportImages.scope", ["count": count])).font(.callout).foregroundStyle(Palette.mutedForeground)
                    OptionSection(title: t("tools.convert.imageFormat")) {
                        Picker(t("tools.convert.imageFormat"), selection: $formatRaw) {
                            ForEach(PageInspections.ImageFormat.allCases, id: \.rawValue) { Text($0.rawValue.uppercased()).tag($0.rawValue) }
                        }
                        .pickerStyle(.segmented)
                        AdaptiveRow(label: t("tools.convert.dpi")) {
                            Picker(t("tools.convert.dpi"), selection: $dpi) {
                                ForEach(Self.dpiChoices, id: \.self) { Text("\(Int($0))").tag(Double($0)) }
                            }
                            .labelsHidden()
                        }
                        if format.lossy {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(t("tools.convert.imageQuality")) · %\(Int(quality))")
                                Slider(value: $quality, in: 10...100, step: 1).accessibilityLabel(t("tools.convert.imageQuality"))
                            }
                        }
                    }
                    JobControls(runner: runner, title: t("tools.pages.exportImages.submit"), symbol: "photo.on.rectangle", disabled: count == 0, action: save)
                }
                .padding()
            }
            .background(Palette.background)
            .navigationTitle(t("tools.pages.exportImages.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.close")) { runner.cancel(); dismiss() }
                }
            }
        }
        .presentationDetents([.large])
    }

    private func save() {
        guard let input = try? prepare() else { return }
        let format = format, dpi = CGFloat(dpi), quality = quality
        let folder = Workspace.outputDirectory(for: input.folderSource, suffix: format.rawValue)
        runner.run(label: t("tools.pages.exportImages.title")) { progress in
            let outputs = try PageInspections.exportImages(sources: input.sources, tiles: input.tiles, format: format, dpi: dpi, quality: quality,
                                                           baseName: input.baseName, folder: folder, progress: progress)
            return JobResult(outputs: outputs, summary: t("tools.pages.exportImages.done", ["count": outputs.count]))
        }
    }
}
