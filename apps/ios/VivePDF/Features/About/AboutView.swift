import SwiftUI

/// About (`features/about/AboutPage.tsx`): product, principles, credits, privacy, shortcuts, licences and links.
struct AboutView: View {
    var body: some View {
        MeasuredLayout { AboutBody() }
            .background(AmbientBackground())
            .navigationTitle(t("nav.about"))
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct AboutBody: View {
    @Environment(AppModel.self) private var app
    @Environment(\.layout) private var layout
    @State private var report: ReportCategory?
    @State private var showLicences = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                hero
                if layout.isWide {
                    HStack(alignment: .top, spacing: 20) {
                        product.frame(maxWidth: .infinity)
                        VStack(spacing: 16) { more; support }.frame(width: 300)
                    }
                } else {
                    product
                    more
                    support
                }
                footer
            }
            .frame(maxWidth: 1000, alignment: .leading)
            .padding(.horizontal, layout.gutter)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
        .sheet(item: $report) { ReportSheet(category: $0) }
        .sheet(isPresented: $showLicences) {
            NavigationStack {
                LicencesView()
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { showLicences = false } } }
            }
        }
    }

    private var hero: some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.richtext.fill")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 72, height: 72)
                .background(LinearGradient(colors: [Palette.primary, Tone.fromPdf.color], startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .accessibilityHidden(true)
            (Text("vive") + Text("PDF").foregroundStyle(Palette.primary))
                .font(.system(.largeTitle, design: .default).weight(.semibold))
                .accessibilityLabel("vivePDF")
            Text(t("about.tagline")).font(.body).foregroundStyle(Palette.mutedForeground).multilineTextAlignment(.center)
            HStack(spacing: 8) {
                chip("\(t("about.version")) \(AppInfo.version)")
                chip("iPhone · iPad")
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { heroButtons }
                VStack(spacing: 10) { heroButtons }
            }
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, layout.isCompact ? 24 : 36)
        .padding(.horizontal, 16)
        .card(padding: 0)
    }

    @ViewBuilder private var heroButtons: some View {
        Link(destination: AppInfo.websiteURL) { Label("vivepdf.com", systemImage: "globe") }
            .buttonStyle(.borderedProminent)
        Button { app.navigate(.settings(section: SettingsSection.updates.rawValue)) } label: {
            Label(t("about.actions.checkUpdates"), systemImage: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
    }

    private func chip(_ text: String) -> some View {
        Text(text).font(.caption.weight(.medium)).foregroundStyle(Palette.mutedForeground)
            .padding(.horizontal, 12).padding(.vertical, 5)
            .background(Palette.muted, in: Capsule())
            .lineLimit(1)
    }

    private var product: some View {
        VStack(alignment: .leading, spacing: 14) {
            Eyebrow(text: t("about.productTitle"))
            Text(t("about.statement")).font(.body).fixedSize(horizontal: false, vertical: true)
            Text(t("ios.about.statementSecondary")).font(.subheadline).foregroundStyle(Palette.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
            Divider()
            Eyebrow(text: t("about.principlesTitle"))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 12)], spacing: 12) {
                principle("wifi.slash", "offline")
                principle("lock", "noTelemetry")
                principle("sparkles", "free")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 20)
    }

    private func principle(_ symbol: String, _ key: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ToneTile(symbol: symbol, size: 36)
            Text(t("about.principles.\(key).title")).font(.subheadline.weight(.semibold))
            Text(t("about.principles.\(key).description")).font(.caption).foregroundStyle(Palette.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.border))
    }

    private var more: some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(text: t("about.moreTitle")).padding(.horizontal, 8).padding(.bottom, 4)
            NavigationLink { CreditsView() } label: { listRow("person.2", t("about.tabs.credits"), chevron: true) }
            NavigationLink { PrivacyView() } label: { listRow("checkmark.shield", t("about.tabs.privacy"), chevron: true) }
            NavigationLink { ShortcutsView() } label: { listRow("keyboard", t("about.tabs.shortcuts"), chevron: true) }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 12)
    }

    private var support: some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(text: t("about.supportTitle")).padding(.horizontal, 8).padding(.bottom, 4)
            Button { report = .bug } label: { listRow("ladybug", t("about.reportBug")) }
            Button { report = .idea } label: { listRow("lightbulb", t("about.suggestFeature")) }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 12)
    }

    private func listRow(_ symbol: String, _ label: String, chevron: Bool = false) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(Palette.mutedForeground).frame(width: 24)
            Text(label).foregroundStyle(Palette.foreground)
            Spacer(minLength: 0)
            if chevron { Image(systemName: "chevron.forward").font(.caption).foregroundStyle(Palette.mutedForeground) }
        }
        .padding(.horizontal, 8)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack { footerBrand; Spacer(); footerLinks }
                VStack(alignment: .leading, spacing: 10) { footerBrand; footerLinks }
            }
            Divider()
            ViewThatFits(in: .horizontal) {
                HStack {
                    Text(t("about.footer.copyright", ["year": Calendar.current.component(.year, from: Date())]))
                    Spacer()
                    Text("\(t("about.version")) \(AppInfo.version) (\(AppInfo.build))").monospacedDigit()
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(t("about.footer.copyright", ["year": Calendar.current.component(.year, from: Date())]))
                    Text("\(t("about.version")) \(AppInfo.version) (\(AppInfo.build))").monospacedDigit()
                }
            }
            .font(.caption)
            .foregroundStyle(Palette.mutedForeground)
        }
        .card(padding: 18)
    }

    private var footerBrand: some View {
        VStack(alignment: .leading, spacing: 2) {
            (Text("vive") + Text("PDF").foregroundStyle(Palette.primary)).font(.subheadline.weight(.semibold))
            Text(t("about.tagline")).font(.caption).foregroundStyle(Palette.mutedForeground)
        }
    }

    private var footerLinks: some View {
        HStack(spacing: 4) {
            Link(destination: AppInfo.websiteURL) { Label("vivepdf.com", systemImage: "globe") }
            Button { showLicences = true } label: { Label(t("about.footer.licences"), systemImage: "scale.3d") }
            Link(destination: AppInfo.repositoryURL) { Label(t("about.footer.source"), systemImage: "chevron.left.forwardslash.chevron.right") }
        }
        .font(.caption.weight(.medium))
        .buttonStyle(.bordered)
        .controlSize(.small)
    }
}

// MARK: - Licences

struct LicencesView: View {
    struct Entry: Identifiable {
        let name: String
        let licence: String
        let url: URL
        var id: String { name }
    }

    static let components: [Entry] = [
        Entry(name: "Apple PDFKit · Core Graphics · Core Text", licence: "Apple SDK", url: URL(string: "https://developer.apple.com/documentation/pdfkit")!),
        Entry(name: "Apple Vision · VisionKit", licence: "Apple SDK", url: URL(string: "https://developer.apple.com/documentation/vision")!),
        Entry(name: "Apple Security · CryptoKit · Compression", licence: "Apple SDK", url: URL(string: "https://developer.apple.com/documentation/cryptokit")!),
        Entry(name: "Apple WebKit · Quick Look · AVFoundation", licence: "Apple SDK", url: URL(string: "https://developer.apple.com/documentation/webkit")!),
        Entry(name: "SF Symbols", licence: "Apple", url: URL(string: "https://developer.apple.com/sf-symbols/")!),
        Entry(name: "Have I Been Pwned: Pwned Passwords", licence: "CC BY 4.0", url: URL(string: "https://haveibeenpwned.com/Passwords")!),
    ]

    var body: some View {
        List {
            Section {
                Text(t("about.licences.intro")).font(.callout)
            }
            Section {
                ForEach(Self.components) { entry in
                    Link(destination: entry.url) {
                        HStack {
                            Text(entry.name).foregroundStyle(Palette.foreground)
                            Spacer(minLength: 8)
                            Text(entry.licence).font(.caption.monospaced()).foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }
            }
            Section {
                NavigationLink(t("ios.about.notices")) { BundledTextView(title: t("ios.about.notices"), resource: "THIRD_PARTY_NOTICES") }
                NavigationLink(t("ios.about.fullLicence")) { BundledTextView(title: "AGPL-3.0", resource: "LICENSE") }
            }
        }
        .navigationTitle(t("about.licences.title"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Shows a bundled `.txt` resource (licence, notices) in a selectable monospaced view.
struct BundledTextView: View {
    let title: String
    let resource: String
    @State private var text = ""

    var body: some View {
        ScrollView([.vertical]) {
            Text(text)
                .font(.footnote.monospaced())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let url = Bundle.main.url(forResource: resource, withExtension: "txt")
                ?? Bundle.main.url(forResource: resource, withExtension: "txt", subdirectory: "About")
            text = url.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        }
    }
}

// MARK: - Credits

struct CreditsView: View {
    struct Person: Identifiable, Hashable {
        let login: String
        let name: String
        let roleKey: String
        var avatar: URL? = nil
        var contributions: Int? = nil
        var id: String { login.lowercased() }
        var profile: URL { URL(string: "https://github.com/\(login)")! }
    }

    static let founders = [Person(login: "mtvrkan", name: "Mehmet Türkan", roleKey: "about.credits.roles.founder")]
    static let thanks = [
        Person(login: "batukar", name: "Batuhan Karadağ", roleKey: "about.credits.roles.supporter"),
        Person(login: "kilincesad", name: "Muhammed Esad Kılınç", roleKey: "about.credits.roles.supporter"),
        Person(login: "bkguzel", name: "Burak Kemal Güzel", roleKey: "about.credits.roles.supporter"),
    ]

    enum LoadState { case idle, loading, loaded, failed }
    @State private var contributors = CreditsView.founders
    @State private var state: LoadState = .idle

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(t("about.credits.intro")).font(.callout).foregroundStyle(Palette.mutedForeground)
                HStack {
                    Eyebrow(text: t("about.credits.contributors.title"))
                    Spacer()
                    Button { Task { await refresh() } } label: {
                        if state == .loading { ProgressView() } else { Label(t("about.credits.contributors.refresh"), systemImage: "arrow.clockwise") }
                    }
                    .font(.footnote)
                    .buttonStyle(.bordered)
                    .disabled(state == .loading)
                }
                if state == .failed {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t("about.credits.contributors.errorTitle")).font(.subheadline.weight(.semibold))
                        Text(t("about.credits.contributors.errorMessage")).font(.caption).foregroundStyle(Palette.mutedForeground)
                    }
                    .foregroundStyle(Palette.destructive)
                }
                grid(contributors)
                Eyebrow(text: t("about.credits.thanks.title"))
                Text(t("about.credits.thanks.intro")).font(.callout).foregroundStyle(Palette.mutedForeground)
                grid(Self.thanks)
            }
            .frame(maxWidth: 900, alignment: .leading)
            .padding()
            .frame(maxWidth: .infinity)
        }
        .background(AmbientBackground())
        .navigationTitle(t("about.tabs.credits"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func grid(_ people: [Person]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            ForEach(people) { person in
                Link(destination: person.profile) {
                    VStack(spacing: 8) {
                        avatar(person)
                        Text(person.name).font(.subheadline.weight(.semibold)).lineLimit(1).foregroundStyle(Palette.foreground)
                        Text("@\(person.login)").font(.caption.monospaced()).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                        Text(t(person.roleKey)).font(.caption2.weight(.medium)).foregroundStyle(Palette.mutedForeground)
                            .padding(.horizontal, 8).padding(.vertical, 3).background(Palette.muted, in: Capsule())
                        if let count = person.contributions {
                            Text(t("about.credits.contributors.commitCount", ["count": count])).font(.caption2).foregroundStyle(Palette.mutedForeground)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .card(padding: 16)
                }
            }
        }
    }

    @ViewBuilder
    private func avatar(_ person: Person) -> some View {
        let initials = Text(String(person.name.prefix(2)).uppercased()).font(.headline).foregroundStyle(Palette.mutedForeground)
            .frame(width: 56, height: 56).background(Palette.muted, in: Circle())
        if let image = UIImage(named: "avatar-\(person.login)") {
            Image(uiImage: image).resizable().scaledToFill().frame(width: 56, height: 56).clipShape(Circle())
        } else if let url = person.avatar {
            AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initials }
                .frame(width: 56, height: 56).clipShape(Circle())
        } else {
            initials
        }
    }

    /// Fetches GitHub contributors on demand only (see About › Privacy) and merges them with the curated list.
    private func refresh() async {
        state = .loading
        do {
            let (data, response) = try await URLSession.shared.data(from: AppInfo.contributorsAPI)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let list = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { throw URLError(.badServerResponse) }
            let fetched = list.compactMap { item -> Person? in
                guard let login = item["login"] as? String, let count = item["contributions"] as? Int else { return nil }
                let avatar = (item["avatar_url"] as? String).flatMap { URL(string: $0 + ($0.contains("?") ? "&" : "?") + "s=128") }
                return Person(login: login, name: login, roleKey: "about.credits.roles.contributor", avatar: avatar, contributions: count)
            }
            let byLogin = Dictionary(fetched.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            let curated = Self.founders.map { person -> Person in
                var merged = person
                if let match = byLogin[person.id] { merged.contributions = match.contributions; merged.avatar = match.avatar }
                return merged
            }
            let curatedIDs = Set(curated.map(\.id))
            contributors = curated + fetched.filter { !curatedIDs.contains($0.id) }.sorted { ($0.contributions ?? 0) > ($1.contributions ?? 0) }
            state = .loaded
        } catch {
            state = .failed
        }
    }
}

// MARK: - Privacy

struct PrivacyView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        List {
            Section { Text(t("about.privacy.intro")).font(.callout) }
            Section(t("about.privacy.networkTitle")) {
                item("internaldrive", t("about.privacy.network.documents"))
                item("arrow.clockwise", t("ios.about.privacyUpdates"))
                item("person.2", t("about.privacy.network.contributors"))
                item("magnifyingglass", t("about.privacy.network.webSearch"))
                item("checkmark.shield", t("about.privacy.network.timestamp"))
                item("ladybug", t("about.privacy.network.reports"))
            }
            Section {
                ForEach(["recent", "settings", "certificate", "searchIndex", "history", "signatures"], id: \.self) { key in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t("about.privacy.stored.\(key).title")).font(.subheadline.weight(.medium))
                        Text(t("about.privacy.stored.\(key).description")).font(.caption).foregroundStyle(Palette.mutedForeground)
                    }
                }
                Button(t("about.privacy.openData")) { app.navigate(.settings(section: SettingsSection.data.rawValue)) }
            } header: {
                Text(t("ios.about.storedTitle"))
            } footer: {
                Text(t("about.privacy.clear"))
            }
        }
        .navigationTitle(t("about.tabs.privacy"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func item(_ symbol: String, _ text: String) -> some View {
        Label { Text(text).font(.subheadline).fixedSize(horizontal: false, vertical: true) } icon: {
            Image(systemName: symbol).foregroundStyle(Palette.mutedForeground)
        }
    }
}

// MARK: - Shortcuts

/// Hardware-keyboard shortcuts available on iPad (the ⌘ overlay lists the ones of the current screen too).
struct ShortcutsView: View {
    @State private var query = ""

    static let items: [(keys: String, label: String)] = [
        ("Ctrl+O", "about.shortcuts.items.open"),
        ("Ctrl+K", "about.shortcuts.items.palette"),
        ("Ctrl+Shift+F", "nav.folderSearch"),
        ("Ctrl+,", "nav.settings"),
        ("Ctrl+1", "nav.home"),
        ("Ctrl+2", "nav.viewer"),
        ("Ctrl+3", "nav.pages"),
        ("Ctrl+4", "nav.studio"),
        ("Esc", "about.shortcuts.items.closeDialog"),
    ]

    var body: some View {
        let needle = TextFolding.fold(query)
        let shown = Self.items.filter { needle.isEmpty || TextFolding.fold(t($0.label)).contains(needle) || TextFolding.fold($0.keys).contains(needle) }
        List {
            Section {
                if shown.isEmpty { Text(t("about.shortcuts.noMatch")).foregroundStyle(Palette.mutedForeground) }
                ForEach(shown, id: \.keys) { item in
                    HStack {
                        Text(t(item.label))
                        Spacer(minLength: 8)
                        KeyCap(keys: item.keys)
                    }
                }
            } header: {
                Text(t("about.shortcuts.groups.global"))
            } footer: {
                Text(t("ios.about.shortcutsHint"))
            }
        }
        .searchable(text: $query, prompt: t("about.shortcuts.search"))
        .navigationTitle(t("about.tabs.shortcuts"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
