import PDFKit
import SwiftUI

/// The one place where the shell reaches into the feature folders (Annotate, Comments, Reading, Presentation,
/// Document). Keeps the shell readable and the modules independent of each other.
@MainActor
enum ViewerModules {
    // MARK: Bars & overlays

    static func annotateBar(session: ViewerSession) -> some View { AnnotateBar(session: session) }
    static func readAloudBar(session: ViewerSession) -> some View { ReadAloudBar(session: session) }
    static func speechStatus(session: ViewerSession) -> some View { SpeechStatusBar(session: session) }
    static func canvasOverlay(session: ViewerSession) -> some View { AnnotationOverlay(session: session) }
    static func readingView(session: ViewerSession) -> some View { ReadingView(session: session) }
    static func presentation(session: ViewerSession) -> some View { PresentationView(session: session, startPage: session.currentPageIndex) }

    // MARK: Panels

    static func comments(session: ViewerSession) -> some View { CommentsPanel(session: session) }
    static func info(session: ViewerSession) -> some View { DocumentInfoPanel(session: session) }
    static func translate(session: ViewerSession) -> some View { TranslatePanel(session: session) }
    static func attachments(session: ViewerSession) -> some View { AttachmentsPanel(session: session) }
    static func signatures(session: ViewerSession) -> some View { SignaturesPanel(session: session) }
    static func layers(session: ViewerSession) -> some View { LayersPanel(session: session) }

    // MARK: Sheets

    static func printSheet(session: ViewerSession, initialPage: Int?) -> some View { PrintOptionsSheet(session: session, initialPage: initialPage) }
    static func makeSearchable(session: ViewerSession, pageIndex: Int?) -> some View { MakeSearchableSheet(session: session, pageIndex: pageIndex) }

    // MARK: Actions

    static func markup(_ subtype: PDFAnnotationSubtype, session: ViewerSession) {
        AnnotationController.of(session).markupSelection(subtype)
    }

    static func speak(_ text: String, session: ViewerSession) {
        session.showsReadAloud = true
        SpeechController.of(session).speak(text: text)
    }

    /// Stops background work of a closed document (speech, auto scroll).
    static func teardown(_ session: ViewerSession) {
        session.existingService(SpeechController.self)?.stop()
        session.existingService(ViewerAutoScroller.self)?.stop()
        session.existingService(ViewerSearchController.self)?.clear()
    }

    /// Navigation panels only appear when the document has something to show (desktop rail behaviour).
    static func isAvailable(_ panel: LeadingPanel, session: ViewerSession) -> Bool {
        switch panel {
        case .signatures: facts(session).signatureCount > 0
        case .layers: facts(session).hasLayers
        default: true
        }
    }

    /// "Signed and all signatures are valid" style banner (desktop `DocumentMessageBar`).
    static func signatureBanner(session: ViewerSession) -> (symbol: String, tint: Color, text: String)? {
        guard let summary = facts(session).signatures else { return nil }
        return (summary.symbol, summary.tint, summary.text)
    }

    // MARK: Cached document facts

    struct Facts {
        var signatureCount = 0
        var hasLayers = false
        var signatures: (symbol: String, tint: Color, text: String)?
    }

    final class FactsBox {
        var document: ObjectIdentifier?
        var facts = Facts()
    }

    static func facts(_ session: ViewerSession) -> Facts {
        let box = session.service(FactsBox.self) { FactsBox() }
        let id = ObjectIdentifier(session.pdf)
        if box.document != id {
            box.document = id
            box.facts = computeFacts(session.pdf, fileURL: session.document.url)
        }
        return box.facts
    }

    private static func computeFacts(_ pdf: PDFDocument, fileURL: URL) -> Facts {
        var facts = Facts()
        // Integrity needs the saved bytes, so signatures are checked against the file on disk.
        let fields = SignatureInspector.verifiedFields(in: pdf, fileURL: fileURL)
        facts.signatureCount = fields.count
        facts.hasLayers = LayerReader.hasLayers(pdf)
        if let summary = SignatureInspector.status(of: fields) {
            facts.signatures = signatureBannerContent(summary)
        }
        return facts
    }

    private static func signatureBannerContent(_ summary: SignaturesSummary) -> (symbol: String, tint: Color, text: String) {
        switch summary {
        case .valid: ("checkmark.shield.fill", Palette.success, t(summary.messageKey))
        case .attention: ("exclamationmark.shield.fill", Palette.warning, t(summary.messageKey))
        case .invalid: ("xmark.shield.fill", Palette.destructive, t(summary.messageKey))
        }
    }
}
