import PDFKit
import SwiftUI

/// Full-text search in the open document (desktop `SearchBar`): debounced, match case / whole word,
/// all hits highlighted on the pages, results grouped by page with context.
@MainActor
final class ViewerSearchController: NSObject, PDFDocumentDelegate {
    private weak var session: ViewerSession?
    private var debounce: Task<Void, Never>?
    private var searchedDocument: PDFDocument?
    private var pending: [PDFSelection] = []
    private var flushTask: Task<Void, Never>?
    private var wholeWord = false

    static func of(_ session: ViewerSession) -> ViewerSearchController {
        session.service(ViewerSearchController.self) { ViewerSearchController(session: session) }
    }

    private init(session: ViewerSession) {
        self.session = session
    }

    /// Re-runs the search after typing stops (250 ms like the desktop).
    func schedule() {
        debounce?.cancel()
        debounce = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            self?.run()
        }
    }

    func run() {
        guard let session else { return }
        cancel()
        let query = ViewerText.effectiveSearchQuery(session.searchQuery)
        session.searchResults = []
        session.searchIndex = -1
        session.pdfView?.highlightedSelections = nil
        guard !query.isEmpty else { return }
        let pdf = session.pdf
        searchedDocument = pdf
        wholeWord = session.searchWholeWord
        pdf.delegate = self
        session.searching = true
        var options: NSString.CompareOptions = [.diacriticInsensitive]
        if !session.searchMatchCase { options.insert(.caseInsensitive) }
        pdf.beginFindString(query, withOptions: options)
    }

    func cancel() {
        if let searchedDocument, searchedDocument.isFinding { searchedDocument.cancelFindString() }
        flushTask?.cancel()
        pending.removeAll()
        session?.searching = false
    }

    /// Clears results and highlights (search panel closed).
    func clear() {
        cancel()
        debounce?.cancel()
        session?.searchResults = []
        session?.searchIndex = -1
        session?.pdfView?.highlightedSelections = nil
    }

    func next() { step(1) }
    func previous() { step(-1) }

    func select(_ index: Int) {
        guard let session, session.searchResults.indices.contains(index) else { return }
        session.searchIndex = index
        let hit = session.searchResults[index]
        session.reveal(hit, select: true)
    }

    private func step(_ delta: Int) {
        guard let session, !session.searchResults.isEmpty else { return }
        let count = session.searchResults.count
        let start = session.searchIndex < 0 ? (delta > 0 ? -1 : 0) : session.searchIndex
        select(((start + delta) % count + count) % count)
    }

    // MARK: PDFDocumentDelegate (called on the main thread while PDFKit searches in the background)

    nonisolated func didMatchString(_ instance: PDFSelection) {
        MainActor.assumeIsolated {
            guard searchedDocument != nil else { return }
            if wholeWord, !Self.isWholeWord(instance) { return }
            instance.color = UIColor.systemYellow.withAlphaComponent(0.55)
            pending.append(instance)
            // Batch UI updates: thousands of hits otherwise re-render the list for each one.
            if flushTask == nil {
                flushTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .milliseconds(120))
                    self?.flush()
                }
            }
        }
    }

    nonisolated func documentDidEndDocumentFind(_ notification: Notification) {
        MainActor.assumeIsolated {
            flush()
            session?.searching = false
        }
    }

    private func flush() {
        flushTask = nil
        guard let session, !pending.isEmpty else { return }
        session.searchResults.append(contentsOf: pending)
        pending.removeAll()
        session.pdfView?.highlightedSelections = session.searchResults
        if session.searchIndex < 0, let first = session.searchResults.indices.first(where: { index in
            guard let page = session.searchResults[index].pages.first else { return false }
            return session.pdf.index(for: page) >= session.currentPageIndex
        }) ?? session.searchResults.indices.first {
            select(first)
        }
    }

    /// True when the hit is not part of a longer word (desktop `MatchWholeWord`).
    static func isWholeWord(_ selection: PDFSelection) -> Bool {
        guard let page = selection.pages.first, let text = page.string as NSString? else { return true }
        let range = selection.range(at: 0, on: page)
        guard range.location != NSNotFound else { return true }
        func isWordChar(_ index: Int) -> Bool {
            guard index >= 0, index < text.length else { return false }
            guard let scalar = UnicodeScalar(text.character(at: index)) else { return false }
            return CharacterSet.alphanumerics.contains(scalar)
        }
        return !isWordChar(range.location - 1) && !isWordChar(range.location + range.length)
    }

    /// Text around a hit for the results list.
    static func context(of selection: PDFSelection) -> (before: String, match: String, after: String) {
        let match = selection.string ?? ""
        guard let page = selection.pages.first, let text = page.string as NSString? else { return ("", match, "") }
        let range = selection.range(at: 0, on: page)
        guard range.location != NSNotFound, NSMaxRange(range) <= text.length else { return ("", match, "") }
        let span = 36
        let start = max(0, range.location - span)
        let end = min(text.length, NSMaxRange(range) + span)
        let clean = { (s: String) in s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression) }
        let before = clean(text.substring(with: NSRange(location: start, length: range.location - start)))
        let after = clean(text.substring(with: NSRange(location: NSMaxRange(range), length: end - NSMaxRange(range))))
        return ((start > 0 ? "…" : "") + before, clean(text.substring(with: range)), after + (end < text.length ? "…" : ""))
    }
}

struct ViewerSearchPanel: View {
    @Bindable var session: ViewerSession
    @FocusState private var focused: Bool

    private var controller: ViewerSearchController { ViewerSearchController.of(session) }

    private var groups: [(page: Int, indices: [Int])] {
        var buckets: [Int: [Int]] = [:]
        for (index, hit) in session.searchResults.enumerated() {
            let page = hit.pages.first.map { session.pdf.index(for: $0) } ?? 0
            buckets[page, default: []].append(index)
        }
        return buckets.keys.sorted().map { ($0, buckets[$0] ?? []) }
    }

    var body: some View {
        VStack(spacing: 0) {
            searchField
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            Divider()
            results
        }
        .onAppear { focused = session.searchQuery.isEmpty }
        .onChange(of: session.searchQuery) { controller.schedule() }
        .onChange(of: session.searchMatchCase) { controller.run() }
        .onChange(of: session.searchWholeWord) { controller.run() }
    }

    private var searchField: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(t("viewer.searchPlaceholder"), text: $session.searchQuery)
                    .textFieldStyle(.plain)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onSubmit { controller.next(); focused = true }
                    .accessibilityLabel(t("viewer.search"))
                if !session.searchQuery.isEmpty {
                    Button { session.searchQuery = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .buttonStyle(.plain)
                        .accessibilityLabel(t("common.close"))
                }
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 40)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            HStack(spacing: 6) {
                Toggle(isOn: $session.searchMatchCase) { Image(systemName: "textformat") }
                    .toggleStyle(.button)
                    .accessibilityLabel(t("viewer.searchMatchCase"))
                    .help(t("viewer.searchMatchCase"))
                Toggle(isOn: $session.searchWholeWord) { Image(systemName: "text.word.spacing") }
                    .toggleStyle(.button)
                    .accessibilityLabel(t("viewer.searchWholeWord"))
                    .help(t("viewer.searchWholeWord"))
                Spacer(minLength: 4)
                Group {
                    if session.searching && session.searchResults.isEmpty {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(session.searchResults.isEmpty ? "0 / 0" : "\(session.searchIndex + 1) / \(session.searchResults.count)")
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityAddTraits(.updatesFrequently)
                Button { controller.previous() } label: { Image(systemName: "chevron.up") }
                    .disabled(session.searchResults.isEmpty)
                    .accessibilityLabel(t("viewer.previousResult"))
                    .keyboardShortcut("g", modifiers: [.command, .shift])
                Button { controller.next() } label: { Image(systemName: "chevron.down") }
                    .disabled(session.searchResults.isEmpty)
                    .accessibilityLabel(t("viewer.nextResult"))
                    .keyboardShortcut("g", modifiers: .command)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .labelStyle(.iconOnly)
        }
    }

    @ViewBuilder private var results: some View {
        if session.searchResults.isEmpty {
            Spacer(minLength: 0)
            if !session.searching && !ViewerText.effectiveSearchQuery(session.searchQuery).isEmpty {
                Text(t("search.noResults"))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
            }
            Spacer(minLength: 0)
        } else {
            ScrollViewReader { proxy in
                List {
                    ForEach(groups, id: \.page) { group in
                        Section(t("viewer.searchPageGroup", ["page": session.label(ofPage: group.page), "count": group.indices.count])) {
                            ForEach(group.indices, id: \.self) { index in
                                row(index).id(index)
                            }
                        }
                    }
                }
                .listStyle(.plain)
                .onChange(of: session.searchIndex) { _, index in
                    guard index >= 0 else { return }
                    withAnimation { proxy.scrollTo(index, anchor: .center) }
                }
            }
        }
    }

    private func row(_ index: Int) -> some View {
        let parts = ViewerSearchController.context(of: session.searchResults[index])
        let active = index == session.searchIndex
        return Button { controller.select(index) } label: {
            Text(Self.attributed(parts))
                .font(.callout)
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(active ? Palette.accent : Color.clear)
    }

    private static func attributed(_ parts: (before: String, match: String, after: String)) -> AttributedString {
        var match = AttributedString(parts.match)
        match.inlinePresentationIntent = .stronglyEmphasized
        match.foregroundColor = Palette.primary
        return AttributedString(parts.before) + match + AttributedString(parts.after)
    }
}
