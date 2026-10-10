import PDFKit
import SwiftUI

/// Reading mode (desktop `ReadingView`): the document's text reflowed into a comfortable column, page by
/// page, with text size, column width and paper/sepia/dark themes. Follows read aloud (the spoken sentence
/// is highlighted) and keeps the page position in sync with the page view both ways.
struct ReadingView: View {
    let session: ViewerSession

    init(session: ViewerSession) {
        self.session = session
    }

    static let fontRange = 14...32

    @AppStorage("vivepdf.reading.fontSize") private var fontSize = 19
    @AppStorage("vivepdf.reading.width") private var width = ReadingWidth.medium.rawValue
    @AppStorage("vivepdf.reading.theme") private var theme = ReadingTheme.paper.rawValue
    @ScaledMetric(relativeTo: .body) private var typeScale: CGFloat = 1
    @State private var visible: Set<Int> = []
    @State private var settled = false

    private var columnWidth: ReadingWidth { ReadingWidth(rawValue: width) ?? .medium }
    private var palette: ReadingTheme { ReadingTheme(rawValue: theme) ?? .paper }
    private var cache: ReadingTextCache { session.service(ReadingTextCache.self) { ReadingTextCache() } }

    var body: some View {
        let speech = SpeechController.of(session)
        let active = speech.source == .document ? speech.active : nil
        VStack(spacing: 0) {
            toolbar
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 32) {
                        ForEach(0..<session.pageCount, id: \.self) { index in
                            section(index, active: active?.page == index ? active : nil)
                                .id(index)
                                .onAppear { visible.insert(index); publishPosition() }
                                .onDisappear { visible.remove(index); publishPosition() }
                        }
                    }
                    .frame(maxWidth: columnWidth.points * max(1, typeScale), alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 24)
                    .frame(maxWidth: .infinity)
                }
                .scrollContentBackground(.hidden)
                .onAppear {
                    proxy.scrollTo(session.currentPageIndex, anchor: .top)
                    // Ignore the burst of onAppear calls while the first screen lays out.
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(400))
                        settled = true
                    }
                }
                .onChange(of: session.currentPageIndex) { _, page in
                    if !visible.contains(page) { withAnimation { proxy.scrollTo(page, anchor: .top) } }
                }
                .onChange(of: active) { _, sentence in
                    guard let sentence else { return }
                    let paragraphs = cache.paragraphs(page: sentence.page, in: session.pdf)
                    if let index = paragraphs.firstIndex(where: { !$0.ranges(overlapping: sentence.range).isEmpty }) {
                        withAnimation { proxy.scrollTo(ParagraphID(page: sentence.page, index: index), anchor: .center) }
                    }
                }
            }
        }
        .background(palette.background.ignoresSafeArea())
        .foregroundStyle(palette.foreground)
        .environment(\.colorScheme, palette == .dark ? .dark : .light)
    }

    private func publishPosition() {
        guard settled, let first = visible.min(), first != session.currentPageIndex else { return }
        session.currentPageIndex = first
    }

    // MARK: Toolbar

    private var toolbar: some View {
        HStack(spacing: 4) {
            Text(t("viewer.reading.title"))
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.leading, 8)
            Spacer(minLength: 4)
            iconButton(t("viewer.reading.smaller"), "textformat.size.smaller") { fontSize = max(Self.fontRange.lowerBound, fontSize - 1) }
                .disabled(fontSize <= Self.fontRange.lowerBound)
            Text("\(fontSize)")
                .font(.subheadline.monospacedDigit())
                .frame(minWidth: 24)
                .accessibilityHidden(true)
            iconButton(t("viewer.reading.larger"), "textformat.size.larger") { fontSize = min(Self.fontRange.upperBound, fontSize + 1) }
                .disabled(fontSize >= Self.fontRange.upperBound)
            Menu {
                Picker(t("viewer.reading.width"), selection: $width) {
                    ForEach(ReadingWidth.allCases) { option in Text(t("viewer.reading.widths.\(option.rawValue)")).tag(option.rawValue) }
                }
                Picker(t("viewer.reading.theme"), selection: $theme) {
                    ForEach(ReadingTheme.allCases) { option in Text(t("viewer.reading.themes.\(option.rawValue)")).tag(option.rawValue) }
                }
            } label: {
                Image(systemName: "textformat").frame(width: 44, height: 44)
            }
            .accessibilityLabel("\(t("viewer.reading.width")), \(t("viewer.reading.theme"))")
            iconButton(t("viewer.reading.exit"), "xmark") { exit(to: nil) }
                .keyboardShortcut(.escape, modifiers: [])
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 8)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
        .environment(\.colorScheme, palette == .dark ? .dark : .light)
    }

    private func iconButton(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.body.weight(.semibold)).frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .accessibilityLabel(title)
        .help(title)
    }

    private func exit(to page: Int?) {
        let target = page ?? session.currentPageIndex
        session.readingMode = false
        Task { @MainActor in session.go(toPage: target) }
    }

    // MARK: Page sections

    @ViewBuilder
    private func section(_ index: Int, active: SpeechController.ActiveSentence?) -> some View {
        let size = CGFloat(fontSize) * typeScale
        VStack(alignment: .leading, spacing: size * 0.8) {
            Button { exit(to: index) } label: {
                Text(t("viewer.reading.page", ["page": session.label(ofPage: index)]))
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(palette.muted)
                    .frame(minHeight: 32)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isHeader)
            let paragraphs = cache.paragraphs(page: index, in: session.pdf)
            if paragraphs.isEmpty {
                Text(t("viewer.reading.noText"))
                    .font(.system(size: size * 0.85))
                    .italic()
                    .foregroundStyle(palette.muted)
            } else {
                ForEach(Array(paragraphs.enumerated()), id: \.offset) { offset, paragraph in
                    paragraphText(paragraph, active: active, size: size)
                        .id(ParagraphID(page: index, index: offset))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func paragraphText(_ paragraph: ReadingParagraph, active: SpeechController.ActiveSentence?, size: CGFloat) -> some View {
        var attributed = AttributedString(paragraph.text)
        if let active {
            for range in paragraph.ranges(overlapping: active.range) {
                if let span = Range(range, in: attributed) {
                    attributed[span].backgroundColor = palette.highlight
                }
            }
        }
        let rtl = ReadingDirection.isRightToLeft(paragraph.text)
        return Text(attributed)
            .font(.system(size: size, design: .serif))
            .lineSpacing(size * 0.45)
            .multilineTextAlignment(.leading)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.layoutDirection, rtl ? .rightToLeft : .leftToRight)
    }
}

private struct ParagraphID: Hashable {
    let page: Int
    let index: Int
}

enum ReadingWidth: String, CaseIterable, Identifiable {
    case narrow, medium, wide
    var id: String { rawValue }
    /// Column widths matching the desktop `max-w-[34rem|44rem|60rem]` at 16 px.
    var points: CGFloat {
        switch self {
        case .narrow: 544
        case .medium: 704
        case .wide: 960
        }
    }
}

enum ReadingTheme: String, CaseIterable, Identifiable {
    case paper, sepia, dark
    var id: String { rawValue }

    var background: Color {
        switch self {
        case .paper: .white
        case .sepia: Color(red: 244 / 255, green: 236 / 255, blue: 216 / 255)
        case .dark: Color(white: 0.04)
        }
    }

    var foreground: Color {
        switch self {
        case .paper: Color(white: 0.09)
        case .sepia: Color(red: 59 / 255, green: 47 / 255, blue: 30 / 255)
        case .dark: Color(white: 0.9)
        }
    }

    var muted: Color { foreground.opacity(0.6) }

    var highlight: Color {
        switch self {
        case .dark: Color.yellow.opacity(0.35)
        default: Color.yellow.opacity(0.5)
        }
    }
}

enum ReadingDirection {
    /// True when the first strong character is Arabic/Hebrew (and related scripts).
    static func isRightToLeft(_ text: String) -> Bool {
        for scalar in text.unicodeScalars.prefix(400) {
            let value = scalar.value
            if (0x0590...0x08FF).contains(value) || (0xFB1D...0xFDFF).contains(value) || (0xFE70...0xFEFF).contains(value) { return true }
            if scalar.properties.isAlphabetic { return false }
        }
        return false
    }
}

/// Page text and reflowed paragraphs, computed once per page (desktop `pageTextCache`).
final class ReadingTextCache {
    private var document: ObjectIdentifier?
    private var paragraphsByPage: [Int: [ReadingParagraph]] = [:]

    func paragraphs(page index: Int, in pdf: PDFDocument) -> [ReadingParagraph] {
        let id = ObjectIdentifier(pdf)
        if document != id {
            document = id
            paragraphsByPage.removeAll()
        }
        if let cached = paragraphsByPage[index] { return cached }
        let built = ReadingLayout.paragraphs(from: pdf.page(at: index)?.string ?? "")
        paragraphsByPage[index] = built
        return built
    }
}
