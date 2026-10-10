import AVFoundation
import SwiftUI

/// Read-aloud controls under the page (desktop `ReadAloudBar`). Wide windows show everything in one row;
/// phones keep transport + status and move voice, speed and volume into a settings sheet.
struct ReadAloudBar: View {
    let session: ViewerSession
    @State private var showSettings = false

    init(session: ViewerSession) {
        self.session = session
    }

    private var speech: SpeechController { SpeechController.of(session) }

    var body: some View {
        let speech = speech
        VStack(alignment: .leading, spacing: 6) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 4) {
                    pageButtons(speech)
                    transport(speech)
                    status(speech).frame(minWidth: 120, alignment: .leading)
                    Spacer(minLength: 8)
                    ratePicker(speech)
                    settingsButton
                    closeButton(speech)
                }
                HStack(spacing: 2) {
                    transport(speech)
                    status(speech).frame(maxWidth: .infinity, alignment: .leading)
                    settingsButton
                    closeButton(speech)
                }
            }
            if let sentence = speech.currentSentenceText, speech.source == .document {
                Text(sentence)
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .popover(isPresented: $showSettings) {
            VoiceSettingsView(speech: speech)
                .presentationDetents([.medium, .large])
                .presentationCompactAdaptation(.sheet)
                .frame(minWidth: 320, idealWidth: 380, minHeight: 420)
        }
    }

    @ViewBuilder private func pageButtons(_ speech: SpeechController) -> some View {
        barButton(t("viewer.previousPage"), "backward.end.fill") { speech.previousPage() }
        barButton(t("viewer.nextPage"), "forward.end.fill") { speech.nextPage() }
        Divider().frame(height: 22)
    }

    @ViewBuilder private func transport(_ speech: SpeechController) -> some View {
        barButton(t("viewer.readAloud.previousSentence"), "backward.fill") { speech.previousSentence() }
            .disabled(!speech.isActive)
        if speech.isSpeaking {
            barButton(t("viewer.readAloud.pause"), "pause.fill") { speech.pause() }
                .keyboardShortcut(.space, modifiers: [])
        } else {
            barButton(t("viewer.readAloud.play"), "play.fill") { speech.play() }
                .keyboardShortcut(.space, modifiers: [])
        }
        barButton(t("viewer.readAloud.nextSentence"), "forward.fill") { speech.nextSentence() }
            .disabled(!speech.isActive)
        barButton(t("viewer.readAloud.stop"), "stop.fill") { speech.stop() }
            .disabled(!speech.isActive)
    }

    private func status(_ speech: SpeechController) -> some View {
        let text: String = switch (speech.status, speech.source) {
        case (.idle, _): t("viewer.readAloud.idle")
        case (_, .selection): t("viewer.readAloud.selection")
        default: t("viewer.readAloud.page", ["page": session.label(ofPage: speech.page), "total": session.pageCount])
        }
        return Text(text)
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(Palette.mutedForeground)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .accessibilityAddTraits(.updatesFrequently)
    }

    private func ratePicker(_ speech: SpeechController) -> some View {
        Menu {
            Picker(t("viewer.readAloud.rate"), selection: Binding(get: { speech.rate }, set: { speech.rate = $0 })) {
                ForEach([0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0], id: \.self) { value in
                    Text(String(format: "%.2g×", value)).tag(value)
                }
            }
        } label: {
            Text(String(format: "%.1f×", speech.rate))
                .font(.subheadline.monospacedDigit().weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel(t("viewer.readAloud.rate"))
    }

    private var settingsButton: some View {
        barButton(t("viewer.readAloud.manageVoices"), "slider.horizontal.3") { showSettings = true }
    }

    private func closeButton(_ speech: SpeechController) -> some View {
        barButton(t("common.close"), "xmark") {
            speech.stop()
            session.showsReadAloud = false
        }
    }

    private func barButton(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.body.weight(.semibold))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(title)
        .help(title)
    }
}

/// Voice, speed and volume (desktop voice select + sliders, "Voices" settings link).
struct VoiceSettingsView: View {
    let speech: SpeechController
    @Environment(\.dismiss) private var dismiss
    @State private var showHelp = false

    private var languageNames: Locale { L10n.shared.locale.foundationLocale }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent(t("viewer.readAloud.rate")) {
                        Text(String(format: "%.1f×", speech.rate)).monospacedDigit()
                    }
                    Slider(value: Binding(get: { speech.rate }, set: { speech.rate = ($0 * 10).rounded() / 10 }), in: 0.5...2, step: 0.1) {
                        Text(t("viewer.readAloud.rate"))
                    } minimumValueLabel: { Image(systemName: "tortoise") } maximumValueLabel: { Image(systemName: "hare") }
                    LabeledContent(t("viewer.readAloud.volume")) {
                        Text("\(Int((speech.volume * 100).rounded()))%").monospacedDigit()
                    }
                    Slider(value: Binding(get: { speech.volume }, set: { speech.volume = $0 }), in: 0...1, step: 0.05) {
                        Text(t("viewer.readAloud.volume"))
                    } minimumValueLabel: { Image(systemName: "speaker") } maximumValueLabel: { Image(systemName: "speaker.wave.3") }
                }
                Section(t("viewer.readAloud.voice")) {
                    voiceRow(id: "", name: t("viewer.readAloud.autoVoice"), detail: nil)
                }
                let voices = SpeechController.installedVoices()
                if voices.isEmpty {
                    Text(t("viewer.readAloud.noVoices")).foregroundStyle(Palette.mutedForeground)
                }
                ForEach(VoiceChooser.grouped(voices, firstLanguage: L10n.shared.locale.rawValue, name: languageName), id: \.language) { group in
                    Section(languageName(group.language)) {
                        ForEach(group.voices) { voice in
                            voiceRow(id: voice.id, name: voice.name, detail: detail(for: voice))
                        }
                    }
                }
                Section {
                    Button { showHelp = true } label: { Label(t("viewer.readAloud.installVoice"), systemImage: "arrow.down.circle") }
                } footer: {
                    Text(t("ios.viewer.reading.voicesHelp")).fixedSize(horizontal: false, vertical: true)
                }
            }
            .navigationTitle(t("viewer.readAloud.manageVoices"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { dismiss() } }
            }
            .alert(t("viewer.readAloud.installVoice"), isPresented: $showHelp) {
                Button(t("common.close"), role: .cancel) {}
            } message: {
                Text(t("ios.viewer.reading.voicesHelp"))
            }
        }
    }

    private func voiceRow(id: String, name: String, detail: String?) -> some View {
        HStack(spacing: 8) {
            Button {
                speech.voiceID = id
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name).foregroundStyle(Palette.foreground)
                        if let detail { Text(detail).font(.caption).foregroundStyle(Palette.mutedForeground) }
                    }
                    Spacer(minLength: 8)
                    if speech.voiceID == id {
                        Image(systemName: "checkmark").foregroundStyle(Palette.primary).accessibilityHidden(true)
                    }
                }
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(speech.voiceID == id ? .isSelected : [])
            if !id.isEmpty {
                Button { speech.preview(voice: id) } label: {
                    Image(systemName: "play.circle").font(.title3).frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(t("viewer.readAloud.preview"))
                .disabled(speech.isActive)
            }
        }
    }

    private func detail(for voice: VoiceInfo) -> String {
        var parts = [languageNames.localizedString(forIdentifier: voice.language) ?? voice.language]
        if voice.quality >= 2 { parts.append(t("viewer.readAloud.neural")) }
        return parts.joined(separator: " · ")
    }

    private func languageName(_ code: String) -> String {
        languageNames.localizedString(forLanguageCode: code)?.capitalized(with: languageNames) ?? code
    }
}

/// Small capsule while a text selection is read aloud and the bar is closed (desktop `SpeechStatusBar`).
struct SpeechStatusBar: View {
    let session: ViewerSession

    init(session: ViewerSession) {
        self.session = session
    }

    var body: some View {
        let speech = SpeechController.of(session)
        if speech.isActive && !session.showsReadAloud {
            HStack(spacing: 4) {
                Image(systemName: "speaker.wave.2.fill").foregroundStyle(Palette.primary).accessibilityHidden(true)
                Text(speech.source == .selection ? speech.selectionText : t("viewer.readAloud.page", ["page": session.label(ofPage: speech.page), "total": session.pageCount]))
                    .font(.footnote)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 260, alignment: .leading)
                Button {
                    speech.togglePlayPause()
                } label: {
                    Image(systemName: speech.isSpeaking ? "pause.fill" : "play.fill").frame(width: 44, height: 44)
                }
                .accessibilityLabel(speech.isSpeaking ? t("viewer.readAloud.pause") : t("viewer.readAloud.play"))
                Button { speech.stop() } label: {
                    Image(systemName: "stop.fill").frame(width: 44, height: 44)
                }
                .accessibilityLabel(t("viewer.readAloud.stop"))
            }
            .buttonStyle(.borderless)
            .padding(.leading, 14)
            .padding(.trailing, 4)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.border))
            .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(t("viewer.readAloud.title"))
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
