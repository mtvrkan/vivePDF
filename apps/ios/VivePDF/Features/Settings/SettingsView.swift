import SwiftUI

/// Settings sections (`settingsShared.ts` minus the desktop-only "System" section).
enum SettingsSection: String, CaseIterable, Identifiable, Hashable {
    case appearance, general, files, web, viewer, reading, presentation, tools, updates, data, feedback
    var id: String { rawValue }

    static let groups: [(id: String, sections: [SettingsSection])] = [
        ("app", [.appearance, .general, .files, .web]),
        ("viewing", [.viewer, .reading, .presentation]),
        ("system", [.tools, .updates, .data, .feedback]),
    ]

    var titleKey: String { "settings.sections.\(rawValue).title" }
    var descriptionKey: String {
        switch self {
        case .tools: "ios.settings.toolsDescription"
        case .updates: "ios.settings.updatesDescription"
        case .data: "ios.settings.dataDescription"
        case .feedback: "ios.settings.feedbackDescription"
        default: "settings.sections.\(rawValue).description"
        }
    }

    var symbol: String {
        switch self {
        case .appearance: "paintpalette"
        case .general: "sparkles"
        case .files: "doc.badge.arrow.up"
        case .web: "globe"
        case .viewer: "book"
        case .reading: "speaker.wave.2"
        case .presentation: "rectangle.on.rectangle"
        case .tools: "wrench.and.screwdriver"
        case .updates: "arrow.down.circle"
        case .data: "externaldrive"
        case .feedback: "exclamationmark.bubble"
        }
    }

    /// Row labels per section, so the settings search can find a section by any of its settings.
    var rowKeys: [String] {
        switch self {
        case .appearance: ["common.language", "common.theme", "settings.appearance.uiScale", "settings.appearance.reduceMotion"]
        case .general: ["settings.general.rememberRecent", "settings.general.keepHistory", "settings.general.recentLimit", "settings.general.keepBackups"]
        case .files: ["settings.files.outputFolder", "settings.outputPattern", "settings.outputTokens", "settings.files.afterOperation"]
        case .web: ["settings.web.engine", "settings.web.customUrl", "settings.web.breachCheck"]
        case .viewer: ["settings.viewer.thumbnailSize", "settings.viewer.panelThumbnails", "settings.viewer.panelOutline", "settings.viewer.panelInspector",
                       "settings.viewer.panelComments", "settings.viewer.zoom", "settings.viewer.spread", "settings.viewer.scroll",
                       "settings.viewer.reloadOnFileChange", "settings.viewer.selectionColor", "settings.viewer.annotationAuthor"]
        case .reading: ["settings.reading.fontSize", "viewer.reading.width", "viewer.reading.theme", "viewer.pageDisplay.pageColors",
                        "settings.reading.rate", "settings.reading.defaultVoice"]
        case .presentation: ["settings.presentation.penColor", "settings.presentation.penWidth", "settings.presentation.laserColor",
                             "settings.presentation.laserSize", "settings.presentation.spotlightRadius", "presentation.toggleClock",
                             "presentation.toggleTimer", "settings.presentation.drawingsMode"]
        case .tools: ["settings.tools.ocrDefault", "settings.tools.compressProfile", "settings.tools.searchAutoIndex", "settings.ocrLanguages"]
        case .updates: ["update.currentVersion", "update.status"]
        case .data: ["settings.recentFiles", "settings.history", "settings.searchHistory", "settings.searchIndex", "ios.settings.storage", "settings.resetAll"]
        case .feedback: ["settings.feedback.reportBug", "settings.feedback.suggestFeature", "about.tabs.shortcuts", "settings.diagnostics"]
        }
    }
}

/// Settings (`features/settings/SettingsPage.tsx`). Wide windows show the section list beside the selected
/// section; narrow ones (iPhone, Slide Over) push each section from a grouped list.
struct SettingsView: View {
    var section: String? = nil

    var body: some View {
        MeasuredLayout {
            SettingsShell(initial: section.flatMap(SettingsSection.init(rawValue:)))
        }
        .navigationTitle(t("nav.settings"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct SettingsShell: View {
    let initial: SettingsSection?
    @Environment(\.layout) private var layout
    @State private var selected: SettingsSection = .appearance
    @State private var query = ""

    var body: some View {
        Group {
            if layout.width >= 700 {
                HStack(spacing: 0) {
                    SettingsIndex(query: $query, selection: $selected, pushes: false)
                        .frame(width: min(320, layout.width * 0.36))
                    Divider()
                    SettingsDetail(section: selected)
                        .id(selected)
                        .frame(maxWidth: .infinity)
                }
            } else if let initial {
                // Deep link (e.g. Home › Overview › OCR languages): show that section straight away.
                SettingsDetail(section: initial)
            } else {
                SettingsIndex(query: $query, selection: $selected, pushes: true)
            }
        }
        .onAppear { if let initial { selected = initial } }
    }
}

/// Grouped section list with search. In push mode rows are navigation links.
private struct SettingsIndex: View {
    @Binding var query: String
    @Binding var selection: SettingsSection
    let pushes: Bool
    @Environment(AppModel.self) private var app

    private var matches: [(section: SettingsSection, key: String)] {
        let needle = TextFolding.fold(query)
        guard !needle.isEmpty else { return [] }
        return SettingsSection.allCases.flatMap { section in
            ([section.titleKey] + section.rowKeys).filter { TextFolding.fold(t($0)).contains(needle) }.map { (section, $0) }
        }
    }

    var body: some View {
        List {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                ForEach(SettingsSection.groups, id: \.id) { group in
                    Section(t("settings.groups.\(group.id)")) {
                        ForEach(group.sections) { section in row(section, label: t(section.titleKey), subtitle: nil) }
                    }
                }
                Section {
                    Button { app.navigate(.about) } label: {
                        Label { Text(t("nav.about")) } icon: { Image(systemName: "info.circle") }
                    }
                    .foregroundStyle(Palette.foreground)
                }
            } else if matches.isEmpty {
                Text(t("settings.noMatch")).foregroundStyle(Palette.mutedForeground)
            } else {
                ForEach(Array(matches.enumerated()), id: \.offset) { _, match in
                    row(match.section, label: t(match.key), subtitle: match.key == match.section.titleKey ? nil : t(match.section.titleKey))
                }
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: t("settings.searchPlaceholder"))
    }

    @ViewBuilder
    private func row(_ section: SettingsSection, label: String, subtitle: String?) -> some View {
        let content = HStack(spacing: 12) {
            Image(systemName: section.symbol)
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Palette.primary, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(Palette.mutedForeground) }
            }
        }
        if pushes {
            NavigationLink { SettingsDetail(section: section) } label: { content }
        } else {
            Button { selection = section; query = "" } label: { content.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle()) }
                .foregroundStyle(Palette.foreground)
                .listRowBackground(selection == section ? Palette.accent : nil)
                .accessibilityAddTraits(selection == section ? .isSelected : [])
        }
    }
}

struct SettingsDetail: View {
    let section: SettingsSection

    var body: some View {
        Form {
            Section {
                Text(t(section.descriptionKey)).font(.footnote).foregroundStyle(Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
            }
            switch section {
            case .appearance: AppearanceSettings()
            case .general: GeneralSettings()
            case .files: FilesSettings()
            case .web: WebSettings()
            case .viewer: ViewerSettings()
            case .reading: ReadingSettings()
            case .presentation: PresentationSettings()
            case .tools: ToolsSettings()
            case .updates: UpdatesSettings()
            case .data: DataSettings()
            case .feedback: FeedbackSettings()
            }
        }
        .navigationTitle(t(section.titleKey))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// A settings label with an optional explanatory line under it.
struct SettingLabel: View {
    let title: String
    var hint: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            if let hint, !hint.isEmpty {
                Text(hint).font(.caption).foregroundStyle(Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
