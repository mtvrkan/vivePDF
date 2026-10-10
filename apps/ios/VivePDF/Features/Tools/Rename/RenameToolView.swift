import Observation
import SwiftUI
import UniformTypeIdentifiers

/// Bulk rename by content (`features/tools/rename/RenamePage.tsx`). Files come from the Files app — single
/// files, or whole folders (folder access is what allows renaming in place and creating sub-folders).
struct RenameToolView: View {
    var tab: String? = nil
    @Environment(AppModel.self) private var app
    @Environment(\.locale) private var locale
    @State private var model = RenameModel()
    @State private var runner = JobRunner()
    @State private var importingFiles = false
    @State private var importingFolder = false
    @State private var choosingOutput = false

    var body: some View {
        ToolPage(title: t("nav.rename"), subtitle: t("tools.rename.description"), symbol: ToolID.rename.symbol, tone: .organize) {
            if let undo = model.undoMessage {
                HStack(spacing: 10) {
                    Image(systemName: "arrow.uturn.backward").foregroundStyle(Tone.organize.color)
                    Text(undo).font(.callout).frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                    if model.undoPlan != nil {
                        Button { model.undo() } label: {
                            if model.undoing { ProgressView() } else { Label(t("tools.rename.undo.run"), systemImage: "arrow.uturn.backward") }
                        }
                        .buttonStyle(.bordered)
                        .disabled(runner.isRunning || model.undoing)
                    }
                }
                .card(padding: 12)
            }
            filesSection
            patternSection
            optionsSection
            modeSection
            JobControls(runner: runner, title: t("tools.rename.run.\(model.mode.rawValue)", ["count": model.readyItems.count]),
                        symbol: "tag", tone: .organize, disabled: !model.ready || runner.isRunning) { run() }
        }
        .fileImporter(isPresented: $importingFiles, allowedContentTypes: [.pdf], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { model.add(urls) }
        }
        .fileImporter(isPresented: $importingFolder, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { model.addFolder(url) }
        }
        .fileImporter(isPresented: $choosingOutput, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { model.setOutputFolder(url) }
        }
        .onAppear {
            if model.dateOrder == nil { model.dateOrder = app.l10n.locale == .en ? .mdy : .dmy }
            let pending = app.inbox.filter { $0.pathExtension.lowercased() == "pdf" }
            if !pending.isEmpty { model.add(app.takeInbox().filter(pending.contains)) }
        }
        .onDisappear { model.releaseScopes() }
        .task(id: model.previewKey) { await model.refreshPreview() }
    }

    // MARK: Files

    private var filesSection: some View {
        OptionSection(title: t("tools.batch.files")) {
            if model.urls.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "doc.on.doc").font(.system(size: 34, weight: .light)).foregroundStyle(Tone.organize.color)
                    Text(t("tools.batch.dropTitle")).font(.headline)
                    Text(t("tools.rename.idle.description")).font(.caption).foregroundStyle(Palette.mutedForeground).multilineTextAlignment(.center)
                    addButtons
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            } else {
                HStack(spacing: 8) {
                    Picker(t("tools.rename.sort.label"), selection: $model.sortKey) {
                        ForEach(RenameModel.SortKey.allCases) { Text(t("tools.rename.sort.\($0.rawValue)")).tag($0) }
                    }
                    .pickerStyle(.menu)
                    Button { model.descending.toggle() } label: {
                        Image(systemName: model.descending ? "arrow.down.to.line" : "arrow.up.to.line")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel(t(model.descending ? "tools.rename.sort.descending" : "tools.rename.sort.ascending"))
                    Spacer()
                }
                VStack(spacing: 6) {
                    ForEach(Array(model.orderedURLs.enumerated()), id: \.element) { index, url in
                        RenameRow(model: model, url: url, position: index, disabled: runner.isRunning)
                    }
                }
                ViewThatFits(in: .horizontal) {
                    HStack { addButtons; clearButton }
                    VStack(alignment: .leading) { addButtons; clearButton }
                }
                if model.previewing {
                    Label(t(model.ocr ? "tools.rename.previewingOcr" : "tools.rename.previewing"), systemImage: "hourglass")
                        .font(.caption).foregroundStyle(Palette.mutedForeground)
                }
                if let error = model.previewError {
                    Text(error).font(.caption).foregroundStyle(Palette.destructive)
                }
            }
        }
    }

    @ViewBuilder private var addButtons: some View {
        HStack(spacing: 8) {
            Button { importingFiles = true } label: { Label(t("tools.batch.addFiles"), systemImage: "plus") }
            Button { importingFolder = true } label: { Label(t("tools.batch.addFolder"), systemImage: "folder.badge.plus") }
            if !app.documents.documents.isEmpty {
                Menu {
                    ForEach(app.documents.documents) { doc in Button(doc.fileName) { model.add([doc.url]) } }
                } label: { Label(t("ios.common.openDocuments"), systemImage: "book") }
            }
        }
        .buttonStyle(.bordered)
        .disabled(runner.isRunning)
    }

    private var clearButton: some View {
        Button(t("tools.batch.clear"), role: .destructive) { model.clear() }
            .buttonStyle(.borderless)
            .disabled(runner.isRunning)
    }

    // MARK: Pattern

    private var patternSection: some View {
        OptionSection(title: t("tools.rename.pattern"), footer: t("tools.rename.folderHint")) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(RenameEngine.presets, id: \.id) { preset in
                        let selected = model.pattern == preset.pattern
                        Button { model.pattern = preset.pattern } label: {
                            Text(t("tools.rename.presets.\(preset.id)")).font(.footnote)
                                .padding(.horizontal, 10).frame(minHeight: 32)
                                .foregroundStyle(selected ? Tone.organize.color : Palette.foreground)
                                .background(selected ? Tone.organize.soft : Palette.muted, in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
            }
            .accessibilityLabel(t("tools.rename.presets.label"))
            TextField(t("tools.rename.pattern"), text: $model.pattern)
                .font(.body.monospaced())
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            Text(t("tools.rename.patternHint")).font(.caption).foregroundStyle(Palette.mutedForeground)
            let stray = RenameEngine.unknownTokens(model.pattern, known: model.knownTokens)
            if !stray.isEmpty {
                Text(t("tools.rename.unknownField", ["fields": stray.map { "{\($0)}" }.joined(separator: ", ")]))
                    .font(.caption).foregroundStyle(Palette.warning)
            }
            firstPreview
            FlowLayout(spacing: 6) {
                ForEach(RenameEngine.tokens + (model.customRegex.trimmingCharacters(in: .whitespaces).isEmpty ? [] : [RenameEngine.customToken]), id: \.self) { token in
                    Button { model.insert(token) } label: {
                        HStack(spacing: 4) {
                            Text("{\(token)}").font(.caption.monospaced())
                            Text(t("tools.rename.tokens.\(token)")).font(.caption).foregroundStyle(Palette.mutedForeground)
                        }
                        .padding(.horizontal, 8).frame(minHeight: 32)
                        .background(Palette.muted, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(t("tools.rename.customRegex")).font(.subheadline.weight(.medium))
                TextField("Müşteri[:\\s]+([A-Za-zÇĞİÖŞÜçğıöşü ]+)", text: $model.customRegex)
                    .font(.callout.monospaced())
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                Text(t("tools.rename.customRegexHint")).font(.caption).foregroundStyle(Palette.mutedForeground)
            }
        }
    }

    private var firstPreview: some View {
        HStack(spacing: 8) {
            if model.previewing {
                Text(t("tools.rename.previewing")).foregroundStyle(Palette.mutedForeground)
            } else if let first = model.readyItems.first {
                Text(first.url.lastPathComponent).foregroundStyle(Palette.mutedForeground).lineLimit(1).truncationMode(.middle)
                Image(systemName: "arrow.forward").font(.caption).foregroundStyle(Palette.mutedForeground)
                Text(first.newName + "." + first.url.pathExtension)
                    .fontWeight(.medium)
                    .foregroundStyle(first.conflict ? Palette.warning : Palette.foreground)
                    .lineLimit(2)
                if model.readyItems.count > 1 {
                    Text(t("tools.rename.previewMore", ["count": model.readyItems.count - 1])).font(.caption).foregroundStyle(Palette.mutedForeground)
                }
            } else {
                Text(t("tools.rename.previewEmpty")).foregroundStyle(Palette.mutedForeground)
            }
            Spacer(minLength: 0)
        }
        .font(.subheadline)
        .padding(12)
        .background(Palette.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Options

    private var optionsSection: some View {
        OptionSection(title: t("tools.rename.options")) {
            AdaptiveRow(label: t("tools.rename.dateFormat")) {
                Picker(t("tools.rename.dateFormat"), selection: $model.dateFormat) {
                    ForEach(RenameEngine.dateFormats, id: \.value) { Text($0.sample).font(.body.monospaced()).tag($0.value) }
                }
                .pickerStyle(.menu)
            }
            VStack(alignment: .leading, spacing: 2) {
                AdaptiveRow(label: t("tools.rename.dateOrder.label")) {
                    Picker(t("tools.rename.dateOrder.label"), selection: Binding(get: { model.dateOrder ?? .dmy }, set: { model.dateOrder = $0 })) {
                        ForEach(RenameEngine.DateOrder.allCases) { Text(t("tools.rename.dateOrder.\($0.rawValue)")).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
                Text(t("tools.rename.dateOrder.hint")).font(.caption).foregroundStyle(Palette.mutedForeground)
            }
            Divider()
            Stepper(value: $model.counterStart, in: 0...1_000_000_000) {
                LabeledContent(t("tools.rename.counter.start"), value: "\(model.counterStart)")
            }
            Stepper(value: $model.counterStep, in: 1...1_000_000) {
                LabeledContent(t("tools.rename.counter.step"), value: "\(model.counterStep)")
            }
            AdaptiveRow(label: t("tools.rename.counter.digits")) {
                Picker(t("tools.rename.counter.digits"), selection: $model.counterDigits) {
                    ForEach(0...6, id: \.self) { digits in
                        Text(digits == 0 ? t("tools.rename.counter.auto") : String(repeating: "0", count: digits - 1) + "1").tag(digits)
                    }
                }
                .pickerStyle(.menu)
            }
            AdaptiveRow(label: t("tools.rename.case.label")) {
                Picker(t("tools.rename.case.label"), selection: $model.nameCase) {
                    ForEach(RenameEngine.NameCase.allCases) { Text(t("tools.rename.case.\($0.rawValue)")).tag($0) }
                }
                .pickerStyle(.menu)
            }
            Divider()
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 12) { findField; replaceField }
                VStack(alignment: .leading, spacing: 10) { findField; replaceField }
            }
            Toggle(isOn: $model.useRegex) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t("tools.rename.replace.regex"))
                    Text(t("tools.rename.replace.regexHint")).font(.caption).foregroundStyle(Palette.mutedForeground)
                }
            }
            Toggle(isOn: $model.ocr) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t("tools.rename.ocr"))
                    Text(OCRLanguageCatalog.supported.isEmpty ? t("tools.rename.ocrMissing") : t("tools.rename.ocrHint"))
                        .font(.caption).foregroundStyle(Palette.mutedForeground)
                }
            }
            .disabled(OCRLanguageCatalog.supported.isEmpty)
        }
    }

    private var findField: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(t("tools.rename.replace.find")).font(.subheadline)
            TextField("", text: $model.find).font(.callout.monospaced()).textFieldStyle(.roundedBorder)
                .autocorrectionDisabled().textInputAutocapitalization(.never)
        }
    }

    private var replaceField: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(t("tools.rename.replace.with")).font(.subheadline)
            TextField("", text: $model.replace).font(.callout.monospaced()).textFieldStyle(.roundedBorder)
                .autocorrectionDisabled().textInputAutocapitalization(.never)
        }
    }

    // MARK: Mode

    private var modeSection: some View {
        OptionSection(title: t("tools.rename.mode")) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 10) { modeCards }
                VStack(spacing: 10) { modeCards }
            }
            if model.mode == .copy {
                HStack(spacing: 10) {
                    FileIcon(url: model.outputFolder, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t("settings.files.outputFolder")).font(.caption).foregroundStyle(Palette.mutedForeground)
                        Text(model.outputFolder.lastPathComponent).font(.subheadline.weight(.medium)).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Button(t("settings.files.chooseFolder")) { choosingOutput = true }.buttonStyle(.bordered)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                AdaptiveRow(label: t("tools.rename.policy.label")) {
                    Picker(t("tools.rename.policy.label"), selection: $model.policy) {
                        ForEach(RenameEngine.ConflictPolicy.allCases) { Text(t("tools.rename.policy.\($0.rawValue)")).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
                Text(t("tools.rename.policy.\(model.policy.rawValue)Hint")).font(.caption).foregroundStyle(Palette.mutedForeground)
            }
            let conflicts = model.readyItems.filter(\.conflict).count
            if conflicts > 0 {
                Label(t("tools.rename.conflictCount", ["count": conflicts]), systemImage: "exclamationmark.triangle")
                    .font(.caption).foregroundStyle(Palette.warning)
            }
            if model.mode == .rename {
                Text(t("ios.rename.inPlaceHint")).font(.caption).foregroundStyle(Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private var modeCards: some View {
        ForEach(RenameEngine.Mode.allCases) { mode in
            let selected = model.mode == mode
            Button { model.mode = mode } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Image(systemName: selected ? "largecircle.fill.circle" : "circle").foregroundStyle(selected ? Tone.organize.color : Palette.mutedForeground)
                        Text(t("tools.rename.modes.\(mode.rawValue).title")).font(.subheadline.weight(.semibold))
                    }
                    Text(t("tools.rename.modes.\(mode.rawValue).description")).font(.caption).foregroundStyle(Palette.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(selected ? Tone.organize.soft : Palette.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? Tone.organize.color.opacity(0.5) : Palette.border))
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
        }
    }

    // MARK: Run

    private func run() {
        let model = model
        let items = model.readyItems
        let mode = model.mode, policy = model.policy, output = model.outputFolder
        runner.run(label: t("nav.rename")) { progress in
            let scoped = mode == .copy && output.startAccessingSecurityScopedResource()
            defer { if scoped { output.stopAccessingSecurityScopedResource() } }
            let result = try await RenameEngine.apply(items, mode: mode, outputDirectory: mode == .copy ? output : nil, policy: policy, progress: progress)
            await MainActor.run { model.didApply(result, mode: mode) }
            let failures = result.outcomes.filter { !$0.ok }
            var report: [String] = []
            if !failures.isEmpty {
                report.append(t("tools.rename.failure.title"))
                for failure in failures {
                    let reason = failure.error == "EXISTS" ? t("tools.rename.failure.exists", ["name": failure.output?.lastPathComponent ?? ""])
                                                           : t("tools.rename.failure.other", ["detail": failure.error ?? ""])
                    report.append("• \(failure.source.lastPathComponent): \(reason)")
                }
            }
            let copied = result.outcomes.filter(\.copiedInstead).count
            if copied > 0 { report.append(t("ios.rename.copiedInstead", ["count": copied])) }
            return JobResult(outputs: result.outcomes.filter(\.ok).compactMap(\.output).filter { !$0.hasDirectoryPath },
                             summary: "\(result.renamed) \(t("tools.rename.renamed", ["failed": failures.count]))",
                             report: report.isEmpty ? nil : report.joined(separator: "\n"))
        }
    }
}

/// One file: current name → editable new name, found fields, password prompt, conflict note.
private struct RenameRow: View {
    let model: RenameModel
    let url: URL
    let position: Int
    let disabled: Bool
    @State private var password = ""

    var body: some View {
        let item = model.previewByURL[url]
        let locked = item?.error == .NEEDS_PASSWORD
        HStack(alignment: .top, spacing: 10) {
            Text("\(position + 1)").font(.caption.monospacedDigit()).foregroundStyle(Palette.mutedForeground).frame(minWidth: 20).padding(.top, 9)
            VStack(alignment: .leading, spacing: 6) {
                Text(url.lastPathComponent).font(.subheadline).foregroundStyle(Palette.mutedForeground).lineLimit(1).truncationMode(.middle)
                if let item, item.error == nil {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.turn.down.right").font(.caption).foregroundStyle(Palette.mutedForeground)
                        TextField(t("tools.rename.newNameFor", ["name": url.lastPathComponent]),
                                  text: Binding(get: { model.overrides[url] ?? item.newName }, set: { model.overrides[url] = $0 }))
                            .font(.subheadline.weight(.medium))
                            .textFieldStyle(.roundedBorder)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .disabled(disabled)
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(item.conflict ? Palette.warning : .clear))
                        Text(".\(url.pathExtension)").font(.caption.monospaced()).foregroundStyle(Palette.mutedForeground)
                        if model.overrides[url] != nil {
                            Button { model.overrides[url] = nil } label: { Image(systemName: "arrow.counterclockwise") }
                                .buttonStyle(.borderless)
                                .accessibilityLabel(t("tools.rename.resetName"))
                        }
                    }
                    HStack(spacing: 6) {
                        if item.recognised {
                            Label(t("tools.rename.readWithOcr"), systemImage: "text.viewfinder").font(.caption2)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .foregroundStyle(Tone.organize.color).background(Tone.organize.soft, in: RoundedRectangle(cornerRadius: 4))
                        }
                        let found = ["date", "invoice", "amount", "title"].compactMap { key -> String? in
                            guard let value = item.fields[key], !value.isEmpty else { return nil }
                            return "\(t("tools.rename.tokens.\(key)")): \(value)"
                        }
                        Text(found.isEmpty ? t("tools.rename.noFields") : found.joined(separator: " · "))
                            .font(.caption2.monospaced()).foregroundStyle(Palette.mutedForeground).lineLimit(2)
                    }
                    if item.conflict {
                        Label(t("tools.rename.conflicts.\(model.policy.rawValue)"), systemImage: "exclamationmark.triangle")
                            .font(.caption).foregroundStyle(Palette.warning)
                    }
                } else if locked {
                    Text(t("errors.NEEDS_PASSWORD")).font(.caption).foregroundStyle(Palette.mutedForeground)
                    HStack {
                        SecureField(t("password.label"), text: $password)
                            .textFieldStyle(.roundedBorder)
                            .textContentType(.password)
                            .onSubmit { submit() }
                            .accessibilityLabel(t("tools.rename.passwordFor", ["name": url.lastPathComponent]))
                        Button(t("password.open")) { submit() }.buttonStyle(.borderedProminent).disabled(password.isEmpty || disabled)
                    }
                    if model.passwords[url] != nil { Text(t("password.wrong")).font(.caption).foregroundStyle(Palette.destructive) }
                } else if let error = item?.error {
                    Text(L10n.shared.has("errors.\(error.rawValue)") ? t("errors.\(error.rawValue)") : t("tools.rename.unreadable"))
                        .font(.caption).foregroundStyle(Palette.destructive)
                }
            }
            Button { model.remove(url) } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground) }
                .buttonStyle(.borderless)
                .frame(minWidth: 32, minHeight: 32)
                .disabled(disabled)
                .accessibilityLabel(t("tools.rename.remove", ["name": url.lastPathComponent]))
        }
        .padding(10)
        .background(Palette.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func submit() {
        guard !password.isEmpty else { return }
        model.passwords[url] = password
    }
}

/// State of the rename page; a class so the background job can hand results back to it.
@MainActor
@Observable
final class RenameModel: @unchecked Sendable {
    enum SortKey: String, CaseIterable, Identifiable { case added, name, modified, size, pages; var id: String { rawValue } }

    var urls: [URL] = []
    var pattern = "{date} {title}"
    var customRegex = ""
    var dateFormat = "%Y-%m-%d"
    var dateOrder: RenameEngine.DateOrder?
    var counterStart = 1
    var counterStep = 1
    var counterDigits = 0
    var nameCase: RenameEngine.NameCase = .keep
    var find = ""
    var replace = ""
    var useRegex = false
    var ocr = false
    var sortKey: SortKey = .added
    var descending = false
    var overrides: [URL: String] = [:]
    var passwords: [URL: String] = [:]
    var policy: RenameEngine.ConflictPolicy = .number
    var mode: RenameEngine.Mode = .rename
    var outputFolder: URL = Workspace.outputFolder

    private(set) var preview: [RenameEngine.Item] = []
    private(set) var previewing = false
    private(set) var previewError: String?
    private(set) var undoPlan: RenameEngine.UndoPlan?
    private(set) var undoMessage: String?
    private(set) var undoing = false
    @ObservationIgnored private var scopes: [URL] = []

    var previewByURL: [URL: RenameEngine.Item] { Dictionary(preview.map { ($0.url, $0) }, uniquingKeysWith: { a, _ in a }) }
    var readyItems: [RenameEngine.Item] { preview.filter { $0.error == nil } }
    var ready: Bool { !readyItems.isEmpty && !previewing }
    var knownTokens: [String] { customRegex.trimmingCharacters(in: .whitespaces).isEmpty ? RenameEngine.baseTokens : RenameEngine.baseTokens + [RenameEngine.customToken] }

    var orderedURLs: [URL] {
        let byURL = previewByURL
        func value(_ url: URL) -> Double? {
            guard let item = byURL[url], item.error == nil else { return nil }
            switch sortKey {
            case .modified: return item.modified?.timeIntervalSince1970
            case .size: return item.bytes > 0 ? Double(item.bytes) : nil
            case .pages: return Double(item.fields["pages"] ?? "").flatMap { $0 > 0 ? $0 : nil }
            default: return nil
            }
        }
        switch sortKey {
        case .added: return descending ? urls.reversed() : urls
        case .name:
            let sorted = urls.sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
            return descending ? sorted.reversed() : sorted
        default:
            let indexed = urls.enumerated().map { ($0.offset, $0.element, value($0.element)) }
            return indexed.sorted { a, b in
                switch (a.2, b.2) {
                case (nil, nil): return a.0 < b.0
                case (nil, _): return false
                case (_, nil): return true
                case let (x?, y?): return x == y ? a.0 < b.0 : (descending ? x > y : x < y)
                }
            }.map(\.1)
        }
    }

    struct PreviewKey: Hashable {
        var urls: [URL]
        var pattern, customRegex, dateFormat, find, replace: String
        var dateOrder: RenameEngine.DateOrder?
        var counter: [Int]
        var nameCase: RenameEngine.NameCase
        var useRegex, ocr: Bool
        var overrides: [URL: String]
        var passwords: [URL: String]
    }

    var previewKey: PreviewKey {
        PreviewKey(urls: orderedURLs, pattern: pattern, customRegex: customRegex, dateFormat: dateFormat, find: find, replace: replace,
                   dateOrder: dateOrder, counter: [counterStart, counterStep, counterDigits], nameCase: nameCase, useRegex: useRegex, ocr: ocr,
                   overrides: overrides, passwords: passwords)
    }

    func add(_ incoming: [URL]) {
        let pdfs = incoming.filter { $0.pathExtension.lowercased() == "pdf" && !urls.contains($0) }
        urls += pdfs
    }

    func addFolder(_ folder: URL) {
        if folder.startAccessingSecurityScopedResource() { scopes.append(folder) }
        add(SearchIndex.listPDFs(in: folder, recursive: false))
    }

    func setOutputFolder(_ folder: URL) {
        outputFolder = folder
    }

    func releaseScopes() {
        scopes.forEach { $0.stopAccessingSecurityScopedResource() }
        scopes = []
    }

    func remove(_ url: URL) {
        urls.removeAll { $0 == url }
        overrides[url] = nil
        passwords[url] = nil
    }

    func clear() {
        urls = []
        overrides = [:]
        passwords = [:]
        preview = []
    }

    func insert(_ token: String) {
        pattern += (pattern.isEmpty || pattern.hasSuffix(" ") ? "" : " ") + "{\(token)}"
    }

    func refreshPreview() async {
        let ordered = orderedURLs
        guard !ordered.isEmpty, !pattern.trimmingCharacters(in: .whitespaces).isEmpty else {
            preview = []
            previewError = nil
            previewing = false
            return
        }
        previewing = true
        try? await Task.sleep(for: .milliseconds(450))
        guard !Task.isCancelled else { return }
        var options = RenameEngine.Options()
        options.pattern = pattern
        options.customRegex = customRegex
        options.dateFormat = dateFormat
        options.dateOrder = dateOrder ?? .dmy
        options.counterStart = counterStart
        options.counterStep = counterStep
        options.counterDigits = counterDigits
        options.nameCase = nameCase
        options.turkishCase = L10n.shared.locale == .tr
        options.replacements = find.isEmpty ? [] : [RenameEngine.Replacement(find: find, replace: replace, regex: useRegex)]
        options.overrides = overrides
        options.passwords = passwords
        options.ocrLanguages = ocr && !OCRLanguageCatalog.supported.isEmpty ? OCRLanguageCatalog.defaultLanguages(appLocale: L10n.shared.locale) : nil
        do {
            let items = try await RenameEngine.preview(ordered, options: options)
            guard !Task.isCancelled else { return }
            preview = items
            previewError = nil
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            preview = []
            previewError = error.localizedDescription
        }
        previewing = false
    }

    func didApply(_ result: RenameEngine.ApplyResult, mode: RenameEngine.Mode) {
        guard mode == .rename else { return }
        let moved = Dictionary(result.outcomes.filter { $0.ok && !$0.copiedInstead }.compactMap { outcome in outcome.output.map { (outcome.source, $0) } },
                               uniquingKeysWith: { a, _ in a })
        urls = urls.map { moved[$0] ?? $0 }
        passwords = Dictionary(passwords.map { (moved[$0.key] ?? $0.key, $0.value) }, uniquingKeysWith: { a, _ in a })
        overrides = [:]
        if let plan = result.undo {
            undoPlan = plan
            undoMessage = [t("tools.rename.undo.available", ["count": plan.moves.count]),
                           plan.replaced > 0 ? t("tools.rename.undo.replaced", ["count": plan.replaced]) : nil].compactMap { $0 }.joined(separator: " ")
        }
    }

    func undo() {
        guard let plan = undoPlan, !undoing else { return }
        undoing = true
        Task {
            do {
                let outcome = try await RenameEngine.undo(plan)
                urls = urls.map { outcome.moved[$0] ?? $0 }
                undoPlan = nil
                undoMessage = [t("tools.rename.undo.done", ["count": outcome.restored]),
                               outcome.failed > 0 ? t("tools.rename.undo.failed", ["count": outcome.failed]) : nil].compactMap { $0 }.joined(separator: " ")
            } catch {
                undoMessage = error.localizedDescription
            }
            undoing = false
        }
    }
}
