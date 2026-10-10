import NaturalLanguage
import SwiftUI
#if canImport(Translation)
import Translation
#endif

/// Translate panel (desktop `TranslatePanel`). Translates `session.translateText` (a selection, or the
/// current page on request) with Apple's on-device Translation framework:
/// iOS 18+ runs a `TranslationSession` inline (languages download on first use, the system asks);
/// iOS 17.4–17.x shows the system translation sheet; older systems get the Google Translate web fallback.
struct TranslatePanel: View {
    let session: ViewerSession

    init(session: ViewerSession) {
        self.session = session
    }

    @AppStorage("vivepdf.translate.source") private var source = ""
    @AppStorage("vivepdf.translate.target") private var target = TranslateLanguages.defaultTarget
    @Environment(\.openURL) private var openURL
    @State private var showOriginal = true

    private var fullText: String { session.translateText.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var text: String { String(fullText.prefix(TranslateWeb.maxChars)) }
    private var truncated: Bool { fullText.count > TranslateWeb.maxChars }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if fullText.isEmpty {
                    emptyState
                } else {
                    original
                    if truncated {
                        Label(t("viewer.translate.truncated", ["limit": TranslateWeb.maxChars]), systemImage: "scissors")
                            .font(.caption)
                            .foregroundStyle(Palette.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    engine
                    Divider()
                    Button {
                        if let url = TranslateWeb.url(for: text, target: VoiceChooser.baseLanguage(target)) { openURL(url) }
                    } label: {
                        Label(t("viewer.translate.openWeb"), systemImage: "arrow.up.right.square")
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.borderless)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: Pieces

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "translate").font(.system(size: 40, weight: .light)).foregroundStyle(Palette.primary)
            Text(t("viewer.translate.emptyTitle")).font(.headline).multilineTextAlignment(.center)
            Text(t("viewer.translate.emptyDescription"))
                .font(.callout)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            pageTextButton.buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    private var pageTextButton: some View {
        Button {
            session.translateText = session.text(ofPage: session.currentPageIndex)
        } label: {
            Label(t("ios.viewer.reading.usePageText", ["page": session.label(ofPage: session.currentPageIndex)]), systemImage: "doc.text")
                .frame(minHeight: 32)
        }
    }

    private var original: some View {
        DisclosureGroup(isExpanded: $showOriginal) {
            VStack(alignment: .leading, spacing: 8) {
                TextEditor(text: Binding(get: { session.translateText }, set: { session.translateText = $0 }))
                    .font(.callout)
                    .frame(minHeight: 90, maxHeight: 220)
                    .scrollContentBackground(.hidden)
                    .padding(6)
                    .background(Palette.muted, in: RoundedRectangle(cornerRadius: 10))
                    .environment(\.layoutDirection, ReadingDirection.isRightToLeft(text) ? .rightToLeft : .leftToRight)
                    .accessibilityLabel(t("viewer.translate.original"))
                HStack {
                    pageTextButton
                    Spacer()
                    Button(role: .destructive) { session.translateText = "" } label: {
                        Image(systemName: "xmark.circle").frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(t("viewer.signature.clear"))
                }
                .buttonStyle(.borderless)
                .font(.subheadline)
            }
            .padding(.top, 6)
        } label: {
            Text(t("viewer.translate.original")).font(.subheadline.weight(.semibold))
        }
    }

    @ViewBuilder private var languagePickers: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { sourcePicker; swapButton; targetPicker }
            VStack(alignment: .leading, spacing: 4) {
                sourcePicker
                HStack { swapButton; targetPicker }
            }
        }
    }

    private var sourcePicker: some View {
        Picker(t("viewer.translate.source"), selection: $source) {
            Text(t("ios.viewer.reading.detectLanguage")).tag("")
            ForEach(TranslateLanguages.codes, id: \.self) { code in Text(TranslateLanguages.name(code)).tag(code) }
        }
        .pickerStyle(.menu)
        .accessibilityLabel(t("viewer.translate.source"))
    }

    private var targetPicker: some View {
        Picker(t("viewer.translate.target"), selection: $target) {
            ForEach(TranslateLanguages.codes, id: \.self) { code in Text(TranslateLanguages.name(code)).tag(code) }
        }
        .pickerStyle(.menu)
        .accessibilityLabel(t("viewer.translate.target"))
    }

    private var swapButton: some View {
        Button {
            let from = source.isEmpty ? (SpeechController.language(of: text).map(TranslateLanguages.closest) ?? "") : source
            guard !from.isEmpty else { return }
            source = target
            target = from
        } label: {
            Image(systemName: "arrow.left.arrow.right").frame(width: 44, height: 44)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(t("viewer.translate.swap"))
    }

    @ViewBuilder private var engine: some View {
        #if canImport(Translation)
        if #available(iOS 18.0, *) {
            languagePickers
            InlineTranslator(session: session, text: text, source: source, target: target)
        } else if #available(iOS 17.4, *) {
            SystemTranslationSheet(text: text)
        } else {
            unavailable
        }
        #else
        unavailable
        #endif
    }

    private var unavailable: some View {
        VStack(alignment: .leading, spacing: 8) {
            targetPicker
            Text(t("ios.viewer.reading.translationUnavailable"))
                .font(.callout)
                .foregroundStyle(Palette.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

#if canImport(Translation)
/// iOS 18+: inline translation with a `TranslationSession` (on-device; the system offers the download).
@available(iOS 18.0, *)
private struct InlineTranslator: View {
    let session: ViewerSession
    let text: String
    let source: String
    let target: String

    enum Status: Equatable { case idle, loading, done, failed(String) }

    @State private var configuration: TranslationSession.Configuration?
    @State private var status: Status = .idle
    @State private var result = ""
    @State private var availability: LanguageAvailability.Status?
    @State private var requested: String?

    private var pairKey: String { "\(source)|\(target)|\(text.hashValue)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if availability == .unsupported {
                Label(t("ios.viewer.reading.unsupportedPair"), systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(Palette.warning)
                    .fixedSize(horizontal: false, vertical: true)
            } else if availability == .supported {
                Label(t("ios.viewer.reading.needsDownload"), systemImage: "arrow.down.circle")
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            switch status {
            case .loading:
                HStack(spacing: 10) {
                    ProgressView()
                    Text(t("progress.translating")).foregroundStyle(Palette.mutedForeground)
                }
                .frame(minHeight: 44)
            case .done:
                resultView
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(Palette.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            case .idle:
                EmptyView()
            }
            if status != .loading {
                Button(action: run) {
                    Label(t("viewer.translate.run"), systemImage: "translate")
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.borderedProminent)
                .disabled(text.isEmpty || availability == .unsupported)
                .keyboardShortcut(.return, modifiers: .command)
            }
        }
        .translationTask(configuration) { translation in
            do {
                let response = try await translation.translate(text)
                result = response.targetText
                status = .done
            } catch is CancellationError {
                status = .idle
            } catch {
                status = .failed(availability == .unsupported ? t("ios.viewer.reading.unsupportedPair") : t("ios.viewer.reading.translateFailed"))
            }
        }
        .task(id: pairKey) {
            status = status == .loading ? .loading : .idle
            let from = source.isEmpty ? SpeechController.language(of: text) : source
            guard let from else { availability = nil; return }
            availability = await LanguageAvailability().status(from: Locale.Language(identifier: from), to: Locale.Language(identifier: target))
        }
    }

    private var resultView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(t("viewer.translate.result")).font(.subheadline.weight(.semibold))
            Text(result)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Palette.accent.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
                .environment(\.layoutDirection, ReadingDirection.isRightToLeft(result) ? .rightToLeft : .leftToRight)
            HStack {
                Spacer()
                Button {
                    UIPasteboard.general.string = result
                    session.show(ViewerToast(text: t("viewer.selection.copied")))
                } label: {
                    Label(t("viewer.translate.copy"), systemImage: "doc.on.doc").frame(minHeight: 44)
                }
                .buttonStyle(.borderless)
                ShareLink(item: result) { Image(systemName: "square.and.arrow.up").frame(width: 44, height: 44) }
                    .accessibilityLabel(t("ios.common.share"))
            }
        }
    }

    private func run() {
        guard !text.isEmpty else { return }
        status = .loading
        let wanted = "\(source)|\(target)"
        let from = source.isEmpty ? nil : Locale.Language(identifier: source)
        let to = Locale.Language(identifier: target)
        if configuration != nil, requested == wanted {
            configuration?.invalidate()
        } else {
            requested = wanted
            configuration = TranslationSession.Configuration(source: from, target: to)
        }
    }
}

/// iOS 17.4–17.x: the system translation sheet (choose languages, copy or replace in place).
@available(iOS 17.4, *)
private struct SystemTranslationSheet: View {
    let text: String
    @State private var presented = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { presented = true } label: {
                Label(t("viewer.translate.run"), systemImage: "translate").frame(maxWidth: .infinity, minHeight: 32)
            }
            .buttonStyle(.borderedProminent)
            .disabled(text.isEmpty)
            .translationPresentation(isPresented: $presented, text: text)
            Text(t("ios.viewer.reading.needsDownload"))
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
#endif

/// Languages offered in the pickers (Apple Translation's languages; also used for the web fallback).
enum TranslateLanguages {
    static let codes = ["ar", "zh-Hans", "zh-Hant", "nl", "en", "fr", "de", "hi", "id", "it", "ja", "ko", "pl", "pt-BR", "ru", "es", "th", "tr", "uk", "vi"]

    static var defaultTarget: String { closest(L10n.shared.locale.rawValue) }

    /// Maps a detected/BCP-47 language onto an entry of `codes` ("pt" → "pt-BR", "zh" → "zh-Hans").
    static func closest(_ tag: String) -> String {
        if codes.contains(tag) { return tag }
        let base = VoiceChooser.baseLanguage(tag)
        return codes.first { VoiceChooser.baseLanguage($0) == base } ?? "en"
    }

    static func name(_ code: String) -> String {
        let locale = L10n.shared.locale.foundationLocale
        return locale.localizedString(forIdentifier: code)?.capitalized(with: locale) ?? code
    }
}
