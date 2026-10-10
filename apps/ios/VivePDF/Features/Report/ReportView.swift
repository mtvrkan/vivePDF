import SwiftUI

enum ReportCategory: String, CaseIterable, Identifiable, Hashable {
    case crash, bug, idea
    var id: String { rawValue }
    var labelKey: String { "report.category.\(rawValue)" }
    var githubLabel: String { self == .idea ? "enhancement" : "bug" }
}

/// Bug report / feature idea (`features/report/ReportDialog.tsx`). Nothing is sent automatically: the report
/// opens as a prefilled GitHub issue, is copied, or is shared (Mail, Messages, Save to Files…).
struct ReportView: View {
    @State var category: ReportCategory
    @State private var text = ""
    @State private var includeDiagnostics = true
    @State private var copied = false
    @Environment(\.openURL) private var openURL

    static let bodyLimit = 6000

    var body: some View {
        Form {
            Section {
                Picker(t("report.title"), selection: $category) {
                    ForEach(ReportCategory.allCases) { Text(t($0.labelKey)).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            Section {
                TextEditor(text: $text)
                    .frame(minHeight: 140)
                    .overlay(alignment: .topLeading) {
                        if text.isEmpty {
                            Text(t("report.descriptionPlaceholder")).foregroundStyle(Palette.mutedForeground)
                                .padding(.top, 8).padding(.leading, 5).allowsHitTesting(false)
                        }
                    }
            }
            Section {
                Toggle(t("report.includeDiagnostics"), isOn: $includeDiagnostics)
                if includeDiagnostics {
                    DisclosureGroup(t("report.diagnosticsPreview")) {
                        Text(AppInfo.diagnostics).font(.caption.monospaced()).textSelection(.enabled)
                    }
                }
            }
            Section {
                Button { openGitHub() } label: { Label(t("report.openGithub"), systemImage: "arrow.up.forward.app") }
                Button {
                    UIPasteboard.general.string = body(limit: nil)
                    copied = true
                } label: { Label(copied ? t("viewer.selection.copied") : t("report.copyToClipboard"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                ShareLink(item: body(limit: nil), subject: Text(title)) {
                    Label(t("ios.common.share"), systemImage: "square.and.arrow.up")
                }
            } footer: {
                Text(t("about.privacy.network.reports")).fixedSize(horizontal: false, vertical: true)
            }
        }
        .navigationTitle(t("report.title"))
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: text) { _, _ in copied = false }
    }

    private var title: String {
        let first = text.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n").first.map(String.init) ?? "(no description)"
        return String("[\(category.rawValue)] \(first)".prefix(80))
    }

    private func body(limit: Int?) -> String {
        var parts = ["Category: \(category.rawValue)", "", text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "(no description)" : text]
        if includeDiagnostics { parts += ["", "---", AppInfo.diagnostics] }
        let full = parts.joined(separator: "\n")
        guard let limit, full.count > limit else { return full }
        return String(full.prefix(limit))
    }

    private func openGitHub() {
        var components = URLComponents(url: AppInfo.issuesURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "title", value: title),
            URLQueryItem(name: "body", value: body(limit: Self.bodyLimit)),
            URLQueryItem(name: "labels", value: category.githubLabel),
        ]
        if let url = components?.url { openURL(url) }
    }
}

/// Presents `ReportView` in its own sheet (used from Settings and About).
struct ReportSheet: View {
    let category: ReportCategory
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ReportView(category: category)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { dismiss() } } }
        }
        .presentationDetents([.large])
    }
}
