import AVFoundation
import SwiftUI

/// Every preference key this screen writes (documented in `apps/ios/parity/settings.md`).
enum SettingsKeys {
    static let rememberRecent = "vivepdf.general.rememberRecent"
    static let recentLimit = "vivepdf.general.recentLimit"
    static let keepHistory = "vivepdf.general.keepHistory"
    static let keepBackups = "vivepdf.general.keepBackups"
    static let outputPattern = "vivepdf.outputPattern"
    static let afterOperation = "vivepdf.files.afterOperation"
    static let webEngine = "vivepdf.web.engine"
    static let webCustomURL = "vivepdf.web.customUrl"
    static let breachCheck = "vivepdf.web.breachCheck"
    static let thumbnailSize = "vivepdf.pagesZoom"
    static let panelThumbnails = "vivepdf.viewer.panel.thumbnails"
    static let panelOutline = "vivepdf.viewer.panel.outline"
    static let panelInspector = "vivepdf.viewer.panel.inspector"
    static let panelComments = "vivepdf.viewer.panel.comments"
    static let viewerZoom = "vivepdf.viewer.zoom"
    static let viewerSpread = "vivepdf.viewer.spread"
    static let viewerScroll = "vivepdf.viewer.scroll"
    static let reloadOnFileChange = "vivepdf.viewer.reloadOnFileChange"
    static let selectionColor = "vivepdf.viewer.selectionColor"
    static let pageColors = "vivepdf.viewer.pageColors"
    static let readingFontSize = "vivepdf.reading.fontSize"
    static let readingWidth = "vivepdf.reading.width"
    static let readingTheme = "vivepdf.reading.theme"
    static let readingRate = "vivepdf.reading.rate"
    static let readingVoice = "vivepdf.reading.voice"
    static let penColor = "vivepdf.presentation.penColor"
    static let penWidth = "vivepdf.presentation.penWidth"
    static let laserColor = "vivepdf.presentation.laserColor"
    static let laserSize = "vivepdf.presentation.laserSize"
    static let spotlightRadius = "vivepdf.presentation.spotlightRadius"
    static let showClock = "vivepdf.presentation.showClock"
    static let showTimer = "vivepdf.presentation.showTimer"
    static let drawingsMode = "vivepdf.presentation.drawingsMode"
    static let ocrLanguage = OCRLanguageCatalog.defaultKey
    static let compressProfile = "vivepdf.tools.compressProfile"
    static let searchAutoIndex = "vivepdf.search.autoIndex"

    static let presentation = [penColor, penWidth, laserColor, laserSize, spotlightRadius, showClock, showTimer, drawingsMode]

    /// Preferences cleared by "Reset all settings" (user data such as recents, history and collections stays).
    static let resettable = [rememberRecent, recentLimit, keepHistory, keepBackups, outputPattern, afterOperation, webEngine, webCustomURL,
                             breachCheck, thumbnailSize, panelThumbnails, panelOutline, panelInspector, panelComments, viewerZoom, viewerSpread,
                             viewerScroll, reloadOnFileChange, selectionColor, pageColors, readingFontSize, readingWidth, readingTheme, readingRate,
                             readingVoice, ocrLanguage, compressProfile, searchAutoIndex, HomeLayoutStore.storageKey, "vivepdf.home.recentSort"]
        + presentation
}

// MARK: - Appearance

struct AppearanceSettings: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        @Bindable var l10n = app.l10n
        Section {
            Picker(selection: $l10n.locale) {
                ForEach(AppLocale.allCases) { Text($0.nativeName).tag($0) }
            } label: { SettingLabel(title: t("common.language")) }
            Picker(selection: $app.theme) {
                ForEach(ThemeMode.allCases) { Text(t($0.labelKey)).tag($0) }
            } label: { SettingLabel(title: t("common.theme"), hint: t("ios.settings.themeHint")) }
            .pickerStyle(.inline)
        }
        Section {
            Button { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) } label: {
                SettingLabel(title: t("settings.appearance.uiScale"), hint: t("ios.settings.textSizeHint"))
            }
            .foregroundStyle(Palette.foreground)
        } footer: {
            Text(t("ios.settings.motionHint"))
        }
    }
}

// MARK: - Startup and privacy

struct GeneralSettings: View {
    @AppStorage(SettingsKeys.rememberRecent) private var rememberRecent = true
    @AppStorage(SettingsKeys.keepHistory) private var keepHistory = true
    @AppStorage(SettingsKeys.recentLimit) private var recentLimit = 12
    @AppStorage(SettingsKeys.keepBackups) private var keepBackups = true

    var body: some View {
        Section {
            Toggle(isOn: $rememberRecent) { SettingLabel(title: t("settings.general.rememberRecent"), hint: t("settings.general.rememberRecentHint")) }
            Picker(selection: $recentLimit) {
                ForEach([5, 12, 25], id: \.self) { Text("\($0)").tag($0) }
            } label: { SettingLabel(title: t("settings.general.recentLimit"), hint: t("settings.general.recentLimitHint")) }
                .disabled(!rememberRecent)
            Toggle(isOn: $keepHistory) { SettingLabel(title: t("settings.general.keepHistory"), hint: t("settings.general.keepHistoryHint")) }
            Toggle(isOn: $keepBackups) { SettingLabel(title: t("settings.general.keepBackups"), hint: t("ios.settings.keepBackupsHint")) }
        }
    }
}

// MARK: - Files

struct FilesSettings: View {
    @AppStorage(SettingsKeys.outputPattern) private var pattern = "{name}-{suffix}"
    @AppStorage(SettingsKeys.afterOperation) private var afterOperation = "none"

    var body: some View {
        let valid = FileNaming.outputPatternIsValid(pattern)
        Section {
            LabeledContent {
                Text(t("ios.settings.outputFolderValue")).multilineTextAlignment(.trailing).foregroundStyle(Palette.mutedForeground)
            } label: { SettingLabel(title: t("settings.files.outputFolder"), hint: t("ios.settings.outputFolderHint")) }
            Button { HomeActions.revealInFiles(Workspace.outputFolder) } label: { Label(t("ios.settings.openInFiles"), systemImage: "folder") }
        }
        Section {
            Picker(selection: $afterOperation) {
                Text(t("settings.files.afterOperations.none")).tag("none")
                Text(t("settings.files.afterOperations.open")).tag("open")
            } label: { SettingLabel(title: t("settings.files.afterOperation"), hint: t("settings.files.afterOperationHint")) }
        }
        Section {
            HStack {
                TextField(t("settings.outputPattern"), text: $pattern)
                    .font(.body.monospaced())
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                Button(t("settings.reset")) { pattern = "{name}-{suffix}" }
                    .buttonStyle(.borderless)
                    .disabled(pattern == "{name}-{suffix}")
            }
            Text(valid ? t("settings.outputExample", ["example": Workspace.outputName(stem: t("settings.outputExampleName"), suffix: "ocr", pattern: pattern) + ".pdf"])
                       : t("settings.outputPatternInvalid"))
                .font(.caption)
                .foregroundStyle(valid ? Palette.mutedForeground : Palette.destructive)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(FileNaming.outputPatternTokens, id: \.self) { token in
                        Button { pattern += "{\(token)}" } label: {
                            Text("{\(token)}").font(.caption.monospaced())
                                .padding(.horizontal, 8).frame(minHeight: 30)
                                .background(Palette.muted, in: RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        } header: {
            Text(t("settings.outputPattern"))
        } footer: {
            Text(t("settings.outputPatternHint"))
        }
    }
}

// MARK: - Web

struct WebSettings: View {
    @AppStorage(SettingsKeys.webEngine) private var engine = "google"
    @AppStorage(SettingsKeys.webCustomURL) private var customURL = ""
    @AppStorage(SettingsKeys.breachCheck) private var breachCheck = false

    var body: some View {
        Section {
            Picker(selection: $engine) {
                ForEach(["google", "bing", "duckduckgo", "startpage", "brave", "yandex", "custom"], id: \.self) {
                    Text(t("settings.web.engines.\($0)")).tag($0)
                }
            } label: { SettingLabel(title: t("settings.web.engine")) }
            if engine == "custom" {
                VStack(alignment: .leading, spacing: 4) {
                    TextField("https://example.com/search?q={q}", text: $customURL)
                        .font(.body.monospaced())
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    Text(t("settings.web.customUrlHint")).font(.caption).foregroundStyle(Palette.mutedForeground)
                }
            }
        } footer: {
            Text("\(t("settings.web.lens")) · \(t("settings.web.lensHint"))")
        }
        Section {
            Toggle(isOn: $breachCheck) { SettingLabel(title: t("settings.web.breachCheck"), hint: t("settings.web.breachCheckHint")) }
        }
    }
}

// MARK: - Viewer

struct ViewerSettings: View {
    @Environment(AppModel.self) private var app
    @AppStorage(SettingsKeys.thumbnailSize) private var thumbnailSize = 160.0
    @AppStorage(SettingsKeys.panelThumbnails) private var panelThumbnails = true
    @AppStorage(SettingsKeys.panelOutline) private var panelOutline = false
    @AppStorage(SettingsKeys.panelInspector) private var panelInspector = false
    @AppStorage(SettingsKeys.panelComments) private var panelComments = false
    @AppStorage(SettingsKeys.viewerZoom) private var zoom = "fitWidth"
    @AppStorage(SettingsKeys.viewerSpread) private var spread = false
    @AppStorage(SettingsKeys.viewerScroll) private var scroll = "vertical"
    @AppStorage(SettingsKeys.reloadOnFileChange) private var reload = true
    @AppStorage(SettingsKeys.selectionColor) private var selectionColor = "#FFD400"

    var body: some View {
        @Bindable var app = app
        Section {
            VStack(alignment: .leading) {
                HStack {
                    SettingLabel(title: t("settings.viewer.thumbnailSize"), hint: t("settings.viewer.thumbnailSizeHint"))
                    Spacer()
                    Text("\(Int(thumbnailSize)) px").font(.callout.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                }
                Slider(value: $thumbnailSize, in: 80...400, step: 10) { Text(t("settings.viewer.thumbnailSize")) }
            }
        }
        Section {
            Toggle(t("settings.viewer.panelThumbnails"), isOn: $panelThumbnails)
            Toggle(t("settings.viewer.panelOutline"), isOn: $panelOutline)
            Toggle(t("settings.viewer.panelInspector"), isOn: $panelInspector)
            Toggle(t("settings.viewer.panelComments"), isOn: $panelComments)
        }
        Section {
            Picker(selection: $zoom) {
                ForEach(["fitWidth", "fitPage", "actual"], id: \.self) { Text(t("settings.viewer.zooms.\($0)")).tag($0) }
            } label: { SettingLabel(title: t("settings.viewer.zoom"), hint: t("settings.viewer.zoomHint")) }
            Toggle(isOn: $spread) { SettingLabel(title: t("settings.viewer.spread"), hint: t("settings.viewer.spreadHint")) }
            Picker(selection: $scroll) {
                ForEach(["vertical", "horizontal"], id: \.self) { Text(t("viewer.pageDisplay.\($0)")).tag($0) }
            } label: { SettingLabel(title: t("settings.viewer.scroll"), hint: t("settings.viewer.scrollHint")) }
            Toggle(isOn: $reload) { SettingLabel(title: t("settings.viewer.reloadOnFileChange"), hint: t("settings.viewer.reloadOnFileChangeHint")) }
            ColorPicker(selection: HexColor.binding($selectionColor), supportsOpacity: false) {
                SettingLabel(title: t("settings.viewer.selectionColor"), hint: t("settings.viewer.selectionColorHint"))
            }
        }
        Section {
            VStack(alignment: .leading, spacing: 6) {
                SettingLabel(title: t("settings.viewer.annotationAuthor"), hint: t("settings.viewer.annotationAuthorHint"))
                TextField(UIDevice.current.name, text: Binding(get: { app.authorName }, set: { app.authorName = String($0.prefix(200)) }))
                    .textContentType(.name)
            }
        }
    }
}

// MARK: - Reading

struct ReadingSettings: View {
    @Environment(\.locale) private var locale
    @AppStorage(SettingsKeys.readingFontSize) private var fontSize = 19.0
    @AppStorage(SettingsKeys.readingWidth) private var width = "medium"
    @AppStorage(SettingsKeys.readingTheme) private var theme = "paper"
    @AppStorage(SettingsKeys.pageColors) private var pageColors = "normal"
    @AppStorage(SettingsKeys.readingRate) private var rate = 1.0
    @AppStorage(SettingsKeys.readingVoice) private var voice = ""

    private var voices: [AVSpeechSynthesisVoice] {
        let language = L10n.shared.locale.rawValue.split(separator: "-").first.map(String.init) ?? "en"
        return AVSpeechSynthesisVoice.speechVoices().sorted { a, b in
            let aFirst = a.language.hasPrefix(language), bFirst = b.language.hasPrefix(language)
            return aFirst != bFirst ? aFirst : (a.language, a.name) < (b.language, b.name)
        }
    }

    var body: some View {
        Section {
            VStack(alignment: .leading) {
                HStack {
                    Text(t("settings.reading.fontSize"))
                    Spacer()
                    Text("\(Int(fontSize)) px").font(.callout.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                }
                Slider(value: $fontSize, in: 14...32, step: 1) { Text(t("settings.reading.fontSize")) }
            }
            Picker(t("viewer.reading.width"), selection: $width) {
                ForEach(["narrow", "medium", "wide"], id: \.self) { Text(t("viewer.reading.widths.\($0)")).tag($0) }
            }
            Picker(t("viewer.reading.theme"), selection: $theme) {
                ForEach(["paper", "sepia", "dark"], id: \.self) { Text(t("viewer.reading.themes.\($0)")).tag($0) }
            }
            Picker(selection: $pageColors) {
                ForEach(["normal", "dark", "sepia", "whiteOnBlack", "yellowOnBlack", "greenOnBlack"], id: \.self) {
                    Text(t("viewer.pageDisplay.colors.\($0)")).tag($0)
                }
            } label: { SettingLabel(title: t("viewer.pageDisplay.pageColors"), hint: t("settings.reading.pageColorsHint")) }
        }
        Section {
            VStack(alignment: .leading) {
                HStack {
                    Text(t("settings.reading.rate"))
                    Spacer()
                    Text(String(format: "%.1f×", rate)).font(.callout.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
                }
                Slider(value: $rate, in: 0.5...2, step: 0.1) { Text(t("settings.reading.rate")) }
            }
            Picker(selection: $voice) {
                Text(t("viewer.readAloud.autoVoice")).tag("")
                ForEach(voices, id: \.identifier) { voice in
                    Text("\(voice.name) (\(locale.localizedString(forIdentifier: voice.language) ?? voice.language))").tag(voice.identifier)
                }
            } label: { SettingLabel(title: t("settings.reading.defaultVoice"), hint: t("settings.reading.defaultVoiceHint")) }
        } footer: {
            Text(t("ios.settings.voicesHint"))
        }
    }
}

// MARK: - Presentation

struct PresentationSettings: View {
    @AppStorage(SettingsKeys.penColor) private var penColor = "#E5484D"
    @AppStorage(SettingsKeys.penWidth) private var penWidth = 3.0
    @AppStorage(SettingsKeys.laserColor) private var laserColor = "#E5484D"
    @AppStorage(SettingsKeys.laserSize) private var laserSize = 8.0
    @AppStorage(SettingsKeys.spotlightRadius) private var spotlight = 180.0
    @AppStorage(SettingsKeys.showClock) private var showClock = false
    @AppStorage(SettingsKeys.showTimer) private var showTimer = false
    @AppStorage(SettingsKeys.drawingsMode) private var drawingsMode = "temporary"

    var body: some View {
        Section {
            ColorPicker(t("settings.presentation.penColor"), selection: HexColor.binding($penColor), supportsOpacity: false)
            slider(t("settings.presentation.penWidth"), $penWidth, 1...12, 1)
            ColorPicker(t("settings.presentation.laserColor"), selection: HexColor.binding($laserColor), supportsOpacity: false)
            slider(t("settings.presentation.laserSize"), $laserSize, 4...24, 1)
            slider(t("settings.presentation.spotlightRadius"), $spotlight, 80...400, 10)
        }
        Section {
            Toggle(t("presentation.toggleClock"), isOn: $showClock)
            Toggle(t("presentation.toggleTimer"), isOn: $showTimer)
            Picker(selection: $drawingsMode) {
                Text(t("settings.presentation.drawings.temporary")).tag("temporary")
                Text(t("settings.presentation.drawings.annotations")).tag("annotations")
            } label: { SettingLabel(title: t("settings.presentation.drawingsMode"), hint: t("settings.presentation.drawingsModeHint")) }
        }
        Section {
            Button(t("settings.presentation.reset")) {
                SettingsKeys.presentation.forEach(UserDefaults.standard.removeObject(forKey:))
            }
        }
    }

    private func slider(_ title: String, _ value: Binding<Double>, _ range: ClosedRange<Double>, _ step: Double) -> some View {
        VStack(alignment: .leading) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int(value.wrappedValue)) px").font(.callout.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
            }
            Slider(value: value, in: range, step: step) { Text(title) }
        }
    }
}

// MARK: - Tools

struct ToolsSettings: View {
    @Environment(\.locale) private var locale
    @AppStorage(SettingsKeys.ocrLanguage) private var ocrLanguage = ""
    @AppStorage(SettingsKeys.compressProfile) private var compressProfile = "balanced"
    @AppStorage(SettingsKeys.searchAutoIndex) private var autoIndex = true

    var body: some View {
        Section {
            Picker(selection: $ocrLanguage) {
                Text(t("settings.tools.ocrAuto")).tag("")
                ForEach(OCRLanguageCatalog.supported, id: \.self) { Text(OCRLanguageCatalog.displayName($0, locale: locale)).tag($0) }
            } label: { SettingLabel(title: t("settings.tools.ocrDefault"), hint: t("settings.tools.ocrDefaultHint")) }
            Picker(selection: $compressProfile) {
                ForEach(["light", "balanced", "strong", "extreme"], id: \.self) { Text(t("tools.compress.profiles.\($0).title")).tag($0) }
            } label: { SettingLabel(title: t("settings.tools.compressProfile"), hint: t("settings.tools.compressProfileHint")) }
            Toggle(isOn: $autoIndex) { SettingLabel(title: t("settings.tools.searchAutoIndex"), hint: t("settings.tools.searchAutoIndexHint")) }
        }
        Section {
            Text(OCRLanguageCatalog.supported.map { OCRLanguageCatalog.displayName($0, locale: locale) }.joined(separator: ", "))
                .font(.callout)
                .foregroundStyle(Palette.mutedForeground)
                .textSelection(.enabled)
        } header: {
            Text(t("settings.ocrLanguages"))
        } footer: {
            Text(t("ios.settings.ocrSystemHint"))
        }
    }
}

// MARK: - Updates

struct UpdatesSettings: View {
    var body: some View {
        Section {
            LabeledContent(t("update.currentVersion")) {
                Text("\(AppInfo.version) (\(AppInfo.build))").font(.body.monospacedDigit())
            }
            LabeledContent(t("update.status"), value: t("ios.settings.appStoreUpdates"))
        }
    }
}

// MARK: - Data

struct DataSettings: View {
    @Environment(AppModel.self) private var app
    @State private var pending: PendingClear?
    @State private var confirmReset = false
    @State private var searchHistoryCount = SearchHistory.read().count
    @State private var usage: StorageUsage?
    @State private var cleared = false

    struct PendingClear: Identifiable {
        let id = UUID()
        let title: String
        let action: String
        let run: () -> Void
    }

    var body: some View {
        let recents = app.documents.recents.count
        let history = OperationHistory.shared.entries.count
        let index = SearchIndex.shared
        Section {
            dataRow(symbol: "clock", title: t("settings.recentFiles"), value: t("settings.recentFilesCount", ["count": recents]),
                    action: t("settings.clearRecent"), disabled: recents == 0) {
                app.documents.recents.removeAll()
                app.documents.persistRecents()
            }
            dataRow(symbol: "clock.arrow.circlepath", title: t("settings.history"), value: t("settings.historyCount", ["count": history]),
                    action: t("settings.clearHistory"), disabled: history == 0) { OperationHistory.shared.clear() }
            dataRow(symbol: "magnifyingglass", title: t("settings.searchHistory"), value: t("settings.searchHistoryCount", ["count": searchHistoryCount]),
                    action: t("settings.clearRecent"), disabled: searchHistoryCount == 0) {
                SearchHistory.clear()
                searchHistoryCount = 0
            }
            dataRow(symbol: "cylinder.split.1x2", title: t("settings.searchIndex"),
                    value: t("settings.searchIndexHint", ["files": index.totalFiles, "pages": index.totalPages, "size": Workspace.formatBytes(index.storageBytes)]),
                    action: t("settings.searchIndexClear"), disabled: index.folders.isEmpty, confirm: t("settings.searchIndexConfirm")) {
                index.clearAll()
            }
        }
        Section {
            if let usage {
                LabeledContent(t("ios.settings.storageResults"), value: Workspace.formatBytes(usage.results))
                LabeledContent(t("ios.settings.storageAppData"), value: Workspace.formatBytes(usage.appData))
                LabeledContent(t("ios.settings.storageTemporary"), value: Workspace.formatBytes(usage.temporary))
                Button(cleared ? t("ios.settings.clearedTemporary") : t("ios.settings.clearTemporary")) {
                    StorageUsage.clearTemporary(keeping: app.documents.documents.map(\.url))
                    cleared = true
                    Task { self.usage = await StorageUsage.measure() }
                }
                .disabled(usage.temporary == 0)
            } else {
                ProgressView()
            }
        } header: {
            Text(t("ios.settings.storage"))
        } footer: {
            Text(t("ios.settings.storageHint"))
        }
        .task { usage = await StorageUsage.measure() }
        Section {
            Button(role: .destructive) { confirmReset = true } label: {
                SettingLabel(title: t("settings.resetAll"), hint: t("settings.resetAllHint"))
            }
        }
        .confirmationDialog(pending?.title ?? "", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
                            titleVisibility: .visible, presenting: pending) { item in
            Button(item.action, role: .destructive) { item.run() }
            Button(t("common.cancel"), role: .cancel) {}
        } message: { item in
            Text(t("settings.clearConfirm", ["name": item.title]))
        }
        .confirmationDialog(t("settings.resetAll"), isPresented: $confirmReset, titleVisibility: .visible) {
            Button(t("settings.resetAllAction"), role: .destructive) { resetAll() }
            Button(t("common.cancel"), role: .cancel) {}
        } message: {
            Text(t("settings.resetAllConfirm"))
        }
    }

    private func dataRow(symbol: String, title: String, value: String, action: String, disabled: Bool, confirm: String? = nil,
                         run: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(Palette.primary).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(value).font(.caption).foregroundStyle(Palette.mutedForeground)
            }
            Spacer(minLength: 8)
            Button(action) { pending = PendingClear(title: title, action: action, run: run) }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(disabled)
        }
    }

    private func resetAll() {
        SettingsKeys.resettable.forEach(UserDefaults.standard.removeObject(forKey:))
        HomeLayoutStore.shared.replace(.standard)
        app.theme = .system
        app.l10n.locale = AppLocale.detect()
    }
}

/// Disk use of results, app data and temporary files.
struct StorageUsage {
    var results: Int64
    var appData: Int64
    var temporary: Int64

    static func size(of folder: URL) -> Int64 {
        guard let enumerator = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.totalFileAllocatedSizeKey, .fileSizeKey]) else { return 0 }
        var total: Int64 = 0
        for case let url as URL in enumerator {
            let values = try? url.resourceValues(forKeys: [.totalFileAllocatedSizeKey, .fileSizeKey])
            total += Int64(values?.totalFileAllocatedSize ?? values?.fileSize ?? 0)
        }
        return total
    }

    static var temporaryFolders: [URL] {
        let tmp = FileManager.default.temporaryDirectory
        let scratch = ((try? FileManager.default.contentsOfDirectory(at: tmp, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.lastPathComponent.hasPrefix("vivepdf-") }
        return scratch + [Workspace.supportFolder("Inbox")]
    }

    static func measure() async -> StorageUsage {
        await Task.detached(priority: .utility) {
            let support = size(of: Workspace.support)
            let inbox = size(of: Workspace.supportFolder("Inbox"))
            return StorageUsage(results: size(of: Workspace.outputFolder), appData: support - inbox,
                                temporary: temporaryFolders.reduce(0) { $0 + size(of: $1) })
        }.value
    }

    /// Deletes scratch folders and the import inbox, except files that are open right now.
    static func clearTemporary(keeping open: [URL]) {
        let keep = Set(open.map { $0.standardizedFileURL.path })
        for folder in temporaryFolders {
            if keep.contains(where: { $0.hasPrefix(folder.standardizedFileURL.path + "/") }) {
                let children = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
                for child in children where !keep.contains(child.standardizedFileURL.path) { try? FileManager.default.removeItem(at: child) }
            } else {
                try? FileManager.default.removeItem(at: folder)
            }
        }
    }
}

// MARK: - Feedback

struct FeedbackSettings: View {
    @State private var report: ReportCategory?
    @State private var showShortcuts = false
    @State private var copied = false

    var body: some View {
        Section {
            actionRow(symbol: "ladybug", title: t("settings.feedback.reportBug"), hint: t("settings.feedback.reportBugHint")) { report = .bug }
            actionRow(symbol: "lightbulb", title: t("settings.feedback.suggestFeature"), hint: t("settings.feedback.suggestFeatureHint")) { report = .idea }
            actionRow(symbol: "keyboard", title: t("about.tabs.shortcuts"), hint: t("settings.feedback.shortcutsHint")) { showShortcuts = true }
            actionRow(symbol: copied ? "checkmark" : "doc.on.clipboard", title: t("settings.diagnostics"),
                      hint: copied ? t("settings.diagnosticsCopied") : t("ios.settings.diagnosticsHint")) {
                UIPasteboard.general.string = AppInfo.diagnostics
                copied = true
            }
        }
        .sheet(item: $report) { ReportSheet(category: $0) }
        .sheet(isPresented: $showShortcuts) {
            NavigationStack {
                ShortcutsView()
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { showShortcuts = false } } }
            }
        }
    }

    private func actionRow(symbol: String, title: String, hint: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label { SettingLabel(title: title, hint: hint) } icon: { Image(systemName: symbol) }
        }
        .foregroundStyle(Palette.foreground)
    }
}

/// `#RRGGBB` string ↔ SwiftUI colour, for colour settings stored like on desktop.
enum HexColor {
    static func color(_ hex: String) -> Color {
        let clean = hex.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        guard clean.count == 6, let value = UInt32(clean, radix: 16) else { return .yellow }
        return Color(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }

    static func hex(_ color: Color) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        func byte(_ v: CGFloat) -> Int { Int((max(0, min(1, v)) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", byte(r), byte(g), byte(b))
    }

    static func binding(_ hex: Binding<String>) -> Binding<Color> {
        Binding(get: { color(hex.wrappedValue) }, set: { hex.wrappedValue = self.hex($0) })
    }
}
