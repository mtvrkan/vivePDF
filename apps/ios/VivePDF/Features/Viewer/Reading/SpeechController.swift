import AVFoundation
import MediaPlayer
import NaturalLanguage
import Observation
import PDFKit
import UIKit

/// Read aloud for one document (desktop `ReadAloudBar` + `speechStore`): speaks the document sentence by
/// sentence from the current page with AVSpeechSynthesizer, highlights the sentence on the page, turns pages
/// as it goes, and also reads a text selection on request. Settings are shared with the desktop names
/// (`vivepdf.reading.*`).
@MainActor
@Observable
final class SpeechController {
    enum Status { case idle, playing, paused }
    /// What is being read: the document (page by page) or a one-off text selection.
    enum Source { case document, selection }

    /// The sentence currently being spoken (page index + range in that page's text) — the reading view
    /// highlights it too.
    struct ActiveSentence: Equatable {
        let page: Int
        let index: Int
        let range: NSRange
    }

    static func of(_ session: ViewerSession) -> SpeechController {
        session.service(SpeechController.self) { SpeechController(session: session) }
    }

    private(set) var status: Status = .idle
    private(set) var source: Source = .document
    private(set) var page = 0
    private(set) var sentences: [SpokenSentence] = []
    private(set) var sentenceIndex = 0
    private(set) var active: ActiveSentence?
    /// Text of the selection being read (shown in the status capsule).
    private(set) var selectionText = ""

    var isSpeaking: Bool { status == .playing }
    var isPaused: Bool { status == .paused }
    var isActive: Bool { status != .idle }
    var currentSentenceText: String? { sentences.indices.contains(sentenceIndex) && isActive ? sentences[sentenceIndex].text : nil }

    /// Speed multiplier 0.5…2 (desktop `rate`).
    var rate: Double {
        didSet { UserDefaults.standard.set(rate, forKey: Keys.rate) }
    }
    var volume: Double {
        didSet { UserDefaults.standard.set(volume, forKey: Keys.volume) }
    }
    /// Chosen voice identifier; empty = automatic (by the text's language).
    var voiceID: String {
        didSet { UserDefaults.standard.set(voiceID, forKey: Keys.voice) }
    }

    enum Keys {
        static let rate = "vivepdf.reading.rate"
        static let volume = "vivepdf.reading.volume"
        static let voice = "vivepdf.reading.voice"
    }

    @ObservationIgnored private weak var session: ViewerSession?
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private let delegate = SpeechDelegate()
    @ObservationIgnored private var current: AVSpeechUtterance?
    @ObservationIgnored private var highlight: PDFSelection?
    @ObservationIgnored private var cache: [Int: [SpokenSentence]] = [:]
    @ObservationIgnored private var cachedDocument: ObjectIdentifier?
    @ObservationIgnored private var detectedLanguage: String?
    @ObservationIgnored private var warnedFallback = false
    @ObservationIgnored private var remoteTargets: [Any] = []
    @ObservationIgnored private var previewing = false

    init(session: ViewerSession) {
        self.session = session
        let defaults = UserDefaults.standard
        rate = min(2, max(0.5, defaults.object(forKey: Keys.rate) as? Double ?? 1))
        volume = min(1, max(0, defaults.object(forKey: Keys.volume) as? Double ?? 1))
        voiceID = defaults.string(forKey: Keys.voice) ?? ""
        synthesizer.delegate = delegate
        delegate.onFinish = { [weak self] utterance in
            Task { @MainActor in self?.finished(utterance) }
        }
    }

    // MARK: - Controls

    /// Starts reading at the current page, or resumes after a pause.
    func play() {
        if status == .paused {
            synthesizer.continueSpeaking()
            status = .playing
            updateNowPlaying()
            return
        }
        guard let session else { return }
        source = .document
        warnedFallback = false
        detectedLanguage = nil
        start(page: session.currentPageIndex, sentence: 0)
    }

    func pause() {
        guard status == .playing else { return }
        synthesizer.pauseSpeaking(at: .word)
        status = .paused
        updateNowPlaying()
    }

    func togglePlayPause() {
        if status == .playing { pause() } else { play() }
    }

    func stop() {
        current = nil
        synthesizer.stopSpeaking(at: .immediate)
        status = .idle
        sentences = []
        sentenceIndex = 0
        active = nil
        selectionText = ""
        clearHighlight()
        tearDownAudio()
    }

    /// Reads a text selection (desktop `viewer.readAloud.selection`) without touching the page position.
    func speak(text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        stopSpeech()
        clearHighlight()
        source = .selection
        selectionText = trimmed
        warnedFallback = false
        detectedLanguage = Self.language(of: trimmed)
        sentences = SentenceSplitter.sentences(in: trimmed)
        sentenceIndex = 0
        active = nil
        speakCurrent()
    }

    func previousSentence() {
        guard isActive else { return }
        if sentenceIndex > 0 {
            jump(to: sentenceIndex - 1)
        } else if source == .document, page > 0 {
            start(page: page - 1, sentence: 0, fromEnd: true)
        }
    }

    func nextSentence() {
        guard isActive else { return }
        if sentenceIndex + 1 < sentences.count {
            jump(to: sentenceIndex + 1)
        } else if source == .document {
            start(page: page + 1, sentence: 0)
        }
    }

    func previousPage() {
        guard let session else { return }
        let target = (isActive && source == .document ? page : session.currentPageIndex) - 1
        guard target >= 0 else { return }
        if isActive && source == .document { start(page: target, sentence: 0) } else { session.go(toPage: target) }
    }

    func nextPage() {
        guard let session else { return }
        let target = (isActive && source == .document ? page : session.currentPageIndex) + 1
        guard target < session.pageCount else { return }
        if isActive && source == .document { start(page: target, sentence: 0) } else { session.go(toPage: target) }
    }

    /// Speaks a short sample with the chosen voice (desktop `viewer.readAloud.preview`).
    func preview(voice identifier: String) {
        guard status == .idle else { return }
        let voice = AVSpeechSynthesisVoice(identifier: identifier) ?? resolvedVoice(for: nil).voice
        let sample = Self.sample(for: voice?.language ?? L10n.shared.locale.rawValue)
        prepareAudio()
        let utterance = makeUtterance(sample, voice: voice)
        previewing = true
        current = nil
        synthesizer.stopSpeaking(at: .immediate)
        synthesizer.speak(utterance)
    }

    // MARK: - Voices

    /// Every installed voice (personal voices are skipped unless authorised by the system).
    static func installedVoices() -> [VoiceInfo] {
        AVSpeechSynthesisVoice.speechVoices().map { voice in
            let quality: Int = switch voice.quality {
            case .premium: 3
            case .enhanced: 2
            default: 1
            }
            return VoiceInfo(id: voice.identifier, name: voice.name, language: voice.language, quality: quality)
        }
    }

    /// Voice to use for `text`'s language: the chosen one, else the best installed voice for the detected
    /// language, else the interface language's voice (`fallback` = true → tell the reader).
    func resolvedVoice(for language: String?) -> (voice: AVSpeechSynthesisVoice?, fallback: Bool) {
        if !voiceID.isEmpty, let chosen = AVSpeechSynthesisVoice(identifier: voiceID) { return (chosen, false) }
        let voices = Self.installedVoices()
        let region = Locale.current.region?.identifier
        if let language, let best = VoiceChooser.best(for: language, among: voices, preferredRegion: region) {
            return (AVSpeechSynthesisVoice(identifier: best.id), false)
        }
        let ui = L10n.shared.locale.rawValue
        if let best = VoiceChooser.best(for: ui, among: voices, preferredRegion: region) {
            return (AVSpeechSynthesisVoice(identifier: best.id), language != nil)
        }
        return (AVSpeechSynthesisVoice(language: ui) ?? AVSpeechSynthesisVoice(language: "en-US"), language != nil)
    }

    static func language(of text: String) -> String? {
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(String(text.prefix(2000)))
        guard let language = recognizer.dominantLanguage, language != .undetermined else { return nil }
        return language.rawValue
    }

    // MARK: - Reading loop

    private func start(page target: Int, sentence: Int, fromEnd: Bool = false) {
        guard let session else { return }
        stopSpeech()
        resetCacheIfNeeded()
        var index = target
        let step = fromEnd ? -1 : 1
        // Skip pages without text (scanned pages), in the reading direction.
        while index >= 0 && index < session.pageCount {
            let list = sentences(onPage: index)
            if !list.isEmpty {
                page = index
                sentences = list
                sentenceIndex = fromEnd ? list.count - 1 : min(sentence, list.count - 1)
                if detectedLanguage == nil { detectedLanguage = Self.language(of: session.text(ofPage: index)) }
                if session.currentPageIndex != index { session.go(toPage: index) }
                speakCurrent()
                return
            }
            index += step
        }
        let hadText = status != .idle
        stop()
        if !hadText { session.show(ViewerToast(text: t("viewer.pageText.empty"), symbol: "text.page.slash")) }
    }

    private func sentences(onPage index: Int) -> [SpokenSentence] {
        if let cached = cache[index] { return cached }
        let list = SentenceSplitter.sentences(in: session?.text(ofPage: index) ?? "")
        cache[index] = list
        return list
    }

    private func resetCacheIfNeeded() {
        guard let pdf = session?.pdf else { return }
        let id = ObjectIdentifier(pdf)
        if cachedDocument != id {
            cache.removeAll()
            cachedDocument = id
        }
    }

    private func jump(to index: Int) {
        stopSpeech()
        sentenceIndex = index
        speakCurrent()
    }

    private func speakCurrent() {
        guard sentences.indices.contains(sentenceIndex) else { stop(); return }
        let sentence = sentences[sentenceIndex]
        let (voice, fallback) = resolvedVoice(for: detectedLanguage)
        if fallback, !warnedFallback, voiceID.isEmpty, let voice {
            warnedFallback = true
            session?.show(ViewerToast(text: t("viewer.readAloud.otherVoice", ["voice": voice.name]), symbol: "speaker.wave.2"))
        }
        prepareAudio()
        let utterance = makeUtterance(sentence.text, voice: voice)
        current = utterance
        previewing = false
        synthesizer.speak(utterance)
        status = .playing
        if source == .document {
            active = ActiveSentence(page: page, index: sentenceIndex, range: sentence.range)
            highlightSentence(sentence)
        }
        updateNowPlaying()
    }

    private func makeUtterance(_ text: String, voice: AVSpeechSynthesisVoice?) -> AVSpeechUtterance {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        utterance.rate = Self.avRate(rate)
        utterance.volume = Float(volume)
        utterance.postUtteranceDelay = 0.05
        return utterance
    }

    /// Maps the desktop 0.5…2× speed onto AVSpeech's 0…1 scale (0.5 = normal).
    static func avRate(_ multiplier: Double) -> Float {
        let normal = Double(AVSpeechUtteranceDefaultSpeechRate)
        let maximum = Double(AVSpeechUtteranceMaximumSpeechRate)
        let value = multiplier <= 1 ? normal * multiplier : normal + (maximum - normal) * min(1, multiplier - 1)
        return Float(min(maximum, max(Double(AVSpeechUtteranceMinimumSpeechRate), value)))
    }

    private func finished(_ utterance: AVSpeechUtterance) {
        if previewing, current == nil { previewing = false; if status == .idle { tearDownAudio() }; return }
        guard utterance === current else { return }
        if sentenceIndex + 1 < sentences.count {
            sentenceIndex += 1
            speakCurrent()
        } else if source == .document, let session, page + 1 < session.pageCount {
            start(page: page + 1, sentence: 0)
        } else {
            stop()
        }
    }

    /// Stops the synthesizer without resetting position (used before jumps).
    private func stopSpeech() {
        current = nil
        if synthesizer.isSpeaking || synthesizer.isPaused { synthesizer.stopSpeaking(at: .immediate) }
    }

    // MARK: - Page highlight

    private func highlightSentence(_ sentence: SpokenSentence) {
        guard let session, let pdfView = session.pdfView, let pdfPage = session.pdf.page(at: page),
              sentence.range.location != NSNotFound, let selection = pdfPage.selection(for: sentence.range) else { return }
        selection.color = UIColor.systemYellow.withAlphaComponent(0.45)
        var shown = pdfView.highlightedSelections ?? []
        if let highlight { shown.removeAll { $0 === highlight } }
        shown.append(selection)
        highlight = selection
        pdfView.highlightedSelections = shown
        // Follow the sentence when it scrolls out of view (zoomed in, long pages).
        let bounds = pdfView.convert(selection.bounds(for: pdfPage), from: pdfPage)
        if !pdfView.bounds.insetBy(dx: 0, dy: 40).contains(bounds) { pdfView.go(to: selection) }
    }

    private func clearHighlight() {
        guard let highlight, let pdfView = session?.pdfView else { self.highlight = nil; return }
        var shown = pdfView.highlightedSelections ?? []
        shown.removeAll { $0 === highlight }
        pdfView.highlightedSelections = shown.isEmpty ? nil : shown
        self.highlight = nil
    }

    // MARK: - Audio session & Now Playing

    private func prepareAudio() {
        let audio = AVAudioSession.sharedInstance()
        try? audio.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? audio.setActive(true)
        installRemoteCommands()
    }

    private func tearDownAudio() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let center = MPRemoteCommandCenter.shared()
        for target in remoteTargets {
            center.playCommand.removeTarget(target)
            center.pauseCommand.removeTarget(target)
            center.togglePlayPauseCommand.removeTarget(target)
            center.nextTrackCommand.removeTarget(target)
            center.previousTrackCommand.removeTarget(target)
        }
        remoteTargets.removeAll()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func installRemoteCommands() {
        guard remoteTargets.isEmpty else { return }
        let center = MPRemoteCommandCenter.shared()
        func add(_ command: MPRemoteCommand, _ action: @escaping @MainActor (SpeechController) -> Void) {
            remoteTargets.append(command.addTarget { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    action(self)
                }
                return .success
            })
        }
        add(center.playCommand) { $0.play() }
        add(center.pauseCommand) { $0.pause() }
        add(center.togglePlayPauseCommand) { $0.togglePlayPause() }
        add(center.nextTrackCommand) { $0.nextSentence() }
        add(center.previousTrackCommand) { $0.previousSentence() }
    }

    private func updateNowPlaying() {
        guard let session else { return }
        var info: [String: Any] = [MPMediaItemPropertyTitle: session.document.title]
        info[MPMediaItemPropertyArtist] = source == .selection
            ? t("viewer.readAloud.selection")
            : t("viewer.readAloud.page", ["page": session.label(ofPage: page), "total": session.pageCount])
        info[MPNowPlayingInfoPropertyPlaybackRate] = status == .playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    /// A short preview sentence in the voice's language (falls back to the interface string).
    static func sample(for language: String) -> String {
        switch VoiceChooser.baseLanguage(language) {
        case "tr": "Merhaba, bu belgeyi sizin için okuyabilirim."
        case "de": "Hallo, ich kann Ihnen dieses Dokument vorlesen."
        case "fr": "Bonjour, je peux vous lire ce document."
        case "es": "Hola, puedo leerte este documento."
        case "it": "Ciao, posso leggerti questo documento."
        case "pt": "Olá, posso ler este documento para você."
        case "ar": "مرحبًا، يمكنني قراءة هذا المستند لك."
        default: "Hello, I can read this document to you."
        }
    }
}

/// AVSpeechSynthesizer needs an NSObject delegate; it forwards finished utterances to the controller.
private final class SpeechDelegate: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    var onFinish: ((AVSpeechUtterance) -> Void)?

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        onFinish?(utterance)
    }
}
