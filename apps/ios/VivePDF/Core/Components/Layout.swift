import PhotosUI
import SwiftUI

/// Responsive metrics derived from the available width rather than the device model, so iPhone SE,
/// Pro Max, iPad split view, Slide Over and Stage Manager windows all get a fitting layout.
struct LayoutMetrics {
    let width: CGFloat
    var isCompact: Bool { width < 600 }
    var isWide: Bool { width >= 900 }
    /// Horizontal page padding.
    var gutter: CGFloat { width < 380 ? 12 : (width < 600 ? 16 : 24) }
    /// Max width for reading/form content.
    var contentWidth: CGFloat { min(width - gutter * 2, 920) }
    /// Number of columns for card grids with a minimum card width.
    func columns(minimum: CGFloat, spacing: CGFloat = 12) -> Int {
        max(1, Int((contentWidth + spacing) / (minimum + spacing)))
    }
}

private struct LayoutMetricsKey: EnvironmentKey {
    static let defaultValue = LayoutMetrics(width: 390)
}

extension EnvironmentValues {
    var layout: LayoutMetrics {
        get { self[LayoutMetricsKey.self] }
        set { self[LayoutMetricsKey.self] = newValue }
    }
}

/// Measures its width and publishes `LayoutMetrics` to the subtree.
struct MeasuredLayout<Content: View>: View {
    @ViewBuilder var content: () -> Content
    @State private var width: CGFloat = 390
    var body: some View {
        content()
            .environment(\.layout, LayoutMetrics(width: width))
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

/// Standard tool page: tone icon + title + description, optional tab chips, scrolling options column.
/// On wide screens an optional `side` view (preview, help) sits next to the options.
struct ToolPage<Content: View, Side: View>: View {
    let title: String
    var subtitle: String? = nil
    var symbol: String
    var tone: Tone
    var tabs: [ToolTab] = []
    var selectedTab: Binding<String>? = nil
    @ViewBuilder var content: () -> Content
    @ViewBuilder var side: () -> Side

    var body: some View {
        MeasuredLayout {
            ToolPageBody(title: title, subtitle: subtitle, symbol: symbol, tone: tone, tabs: tabs, selectedTab: selectedTab, content: content, side: side)
        }
        .background(AmbientBackground())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

extension ToolPage where Side == EmptyView {
    init(title: String, subtitle: String? = nil, symbol: String, tone: Tone, tabs: [ToolTab] = [], selectedTab: Binding<String>? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, subtitle: subtitle, symbol: symbol, tone: tone, tabs: tabs, selectedTab: selectedTab, content: content, side: { EmptyView() })
    }
}

private struct ToolPageBody<Content: View, Side: View>: View {
    let title: String
    let subtitle: String?
    let symbol: String
    let tone: Tone
    let tabs: [ToolTab]
    let selectedTab: Binding<String>?
    let content: () -> Content
    let side: () -> Side
    @Environment(\.layout) private var layout

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if let selectedTab, tabs.count > 1 {
                    TabChips(tabs: tabs, selection: selectedTab, tone: tone)
                }
                if layout.isWide && Side.self != EmptyView.self {
                    HStack(alignment: .top, spacing: 20) {
                        VStack(alignment: .leading, spacing: 16, content: content).frame(maxWidth: .infinity)
                        VStack(alignment: .leading, spacing: 16, content: side).frame(width: min(380, layout.contentWidth * 0.4))
                    }
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        content()
                        side()
                    }
                }
            }
            .frame(maxWidth: layout.isWide && Side.self != EmptyView.self ? 1180 : layout.contentWidth, alignment: .leading)
            .padding(.horizontal, layout.gutter)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: layout.isCompact ? 20 : 24, weight: .semibold))
                .foregroundStyle(tone.color)
                .frame(width: layout.isCompact ? 44 : 54, height: layout.isCompact ? 44 : 54)
                .background(tone.soft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(layout.isCompact ? .title2.bold() : .largeTitle.bold())
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.callout).foregroundStyle(Palette.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

struct ToolTab: Identifiable, Hashable {
    let id: String
    let title: String
    var symbol: String? = nil
}

/// Horizontally scrolling segmented chips — fits any width, unlike a segmented Picker with many tabs.
struct TabChips: View {
    let tabs: [ToolTab]
    @Binding var selection: String
    var tone: Tone = .organize

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tabs) { tab in
                        let selected = tab.id == selection
                        Button {
                            withAnimation(.snappy) { selection = tab.id }
                        } label: {
                            HStack(spacing: 6) {
                                if let symbol = tab.symbol { Image(systemName: symbol).font(.footnote) }
                                Text(tab.title).font(.subheadline.weight(selected ? .semibold : .regular)).lineLimit(1)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .foregroundStyle(selected ? tone.color : Palette.foreground)
                            .background(selected ? tone.soft : Palette.card, in: Capsule())
                            .overlay(Capsule().strokeBorder(selected ? tone.color.opacity(0.45) : Palette.border))
                        }
                        .buttonStyle(.plain)
                        .id(tab.id)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
                .padding(.vertical, 2)
            }
            .onAppear { proxy.scrollTo(selection, anchor: .center) }
            .onChange(of: selection) { _, value in withAnimation { proxy.scrollTo(value, anchor: .center) } }
        }
    }
}

/// A titled card grouping a few options.
struct OptionSection<Content: View>: View {
    let title: String
    var footer: String? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline)
            content()
            if let footer {
                Text(footer).font(.caption).foregroundStyle(Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

/// Label + control on one line when it fits, stacked when it does not (long translations, small phones).
struct AdaptiveRow<Control: View>: View {
    let label: String
    @ViewBuilder var control: () -> Control
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack { Text(label); Spacer(minLength: 12); control() }
            VStack(alignment: .leading, spacing: 6) { Text(label); control() }
        }
    }
}

/// Photo library picker that copies the chosen images into scratch files.
struct PhotoPicker: View {
    var limit = 0
    let onPick: ([URL]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var items: [PhotosPickerItem] = []
    @State private var loading = false

    var body: some View {
        NavigationStack {
            VStack {
                if loading { ProgressView() } else {
                    PhotosPicker(selection: $items, maxSelectionCount: limit == 0 ? nil : limit, matching: .images, photoLibrary: .shared()) {
                        Label(t("ios.common.addPhotos"), systemImage: "photo.on.rectangle").font(.headline)
                    }
                    .photosPickerStyle(.inline)
                    .photosPickerDisabledCapabilities([.selectionActions])
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("common.continue")) { Task { await finish() } }.disabled(items.isEmpty || loading)
                }
            }
        }
    }

    private func finish() async {
        loading = true
        let folder = Workspace.scratch()
        var urls: [URL] = []
        for (index, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            let url = folder.appendingPathComponent(String(format: "photo-%03d.%@", index + 1, ext))
            if (try? data.write(to: url)) != nil { urls.append(url) }
        }
        onPick(urls)
        dismiss()
    }
}

/// Asks for a document password (shown for `DocumentStore.pendingPassword`).
struct PasswordPrompt: View {
    let pending: DocumentStore.PendingPassword
    let onSubmit: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var reveal = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(t("password.description", ["name": pending.url.lastPathComponent]))
                    HStack {
                        Group {
                            if reveal { TextField(t("password.label"), text: $password) } else { SecureField(t("password.label"), text: $password) }
                        }
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onSubmit(submit)
                        Button { reveal.toggle() } label: { Image(systemName: reveal ? "eye.slash" : "eye") }
                            .accessibilityLabel(reveal ? t("password.hide") : t("password.show"))
                    }
                    if pending.wrong { Text(t("password.wrong")).foregroundStyle(Palette.destructive) }
                }
            }
            .navigationTitle(t("password.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(t("password.open"), action: submit).disabled(password.isEmpty) }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func submit() {
        guard !password.isEmpty else { return }
        dismiss()
        onSubmit(password)
    }
}
