import PDFKit
import SwiftUI
import UIKit

/// Text-selection actions in the system edit menu (desktop `SelectionActions` + the "Selected text" group of
/// `ViewerContextMenu`): mark up, copy variants, translate, read aloud, look up, search, web search, share,
/// bookmark.
@MainActor
enum ViewerSelectionMenu {
    static func install(on view: VivePDFView, session: ViewerSession, bookmarkPage: Binding<Int?>, shareURL: Binding<URL?>) {
        view.editMenuBuilder = { [weak session, weak view] builder in
            guard let session, let view, let selection = view.currentSelection, let raw = selection.string,
                  !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            let menu = UIMenu(options: .displayInline, children: actions(session: session, view: view, selection: selection, text: raw, bookmarkPage: bookmarkPage))
            builder.insertChild(menu, atStartOfMenu: .root)
        }
    }

    private static func pageNumber(_ session: ViewerSession, _ selection: PDFSelection) -> Int {
        selection.pages.first.map { session.pdf.index(for: $0) } ?? session.currentPageIndex
    }

    private static func copy(_ text: String, session: ViewerSession) {
        UIPasteboard.general.string = text
        session.showMessage(t("viewer.selection.copied"))
    }

    private static func actions(session: ViewerSession, view: VivePDFView, selection: PDFSelection, text raw: String, bookmarkPage: Binding<Int?>) -> [UIMenuElement] {
        let cleaned = ViewerText.cleanCopiedText([raw])
        let paragraph = ViewerText.reflowParagraphs(cleaned)
        let pageIndex = pageNumber(session, selection)
        let locale = L10n.shared.locale.rawValue

        let markup = UIMenu(title: t("viewer.selection.moreMarkup"), image: UIImage(systemName: "highlighter"), children: [
            UIAction(title: t("annotate.underline"), image: UIImage(systemName: "underline")) { _ in ViewerModules.markup(.underline, session: session) },
            UIAction(title: t("annotate.strikeout"), image: UIImage(systemName: "strikethrough")) { _ in ViewerModules.markup(.strikeOut, session: session) },
            UIAction(title: t("annotate.squiggly"), image: UIImage(systemName: "scribble")) { _ in ViewerModules.markup(PDFAnnotationSubtype(rawValue: "/Squiggly"), session: session) },
        ])
        let copyAs = UIMenu(title: t("viewer.context.copyAs"), image: UIImage(systemName: "doc.on.clipboard"), children: [
            UIAction(title: t("viewer.context.copyText"), image: UIImage(systemName: "doc.on.doc")) { _ in copy(cleaned, session: session) },
            UIAction(title: t("viewer.context.copyParagraph"), image: UIImage(systemName: "text.alignleft")) { _ in copy(paragraph, session: session) },
            UIAction(title: t("viewer.context.copyQuotation"), image: UIImage(systemName: "quote.opening")) { _ in
                copy(t("viewer.context.quotation", ["text": paragraph, "page": session.label(ofPage: pageIndex)]), session: session)
            },
            UIAction(title: t("viewer.context.copyMarkdown"), image: UIImage(systemName: "number")) { _ in copy(ViewerText.markdown(cleaned), session: session) },
        ])
        let web = UIMenu(title: t("viewer.context.searchWeb"), image: UIImage(systemName: "globe"), children: [
            webAction("Google", ViewerText.searchURL(.google, paragraph)),
            webAction("Bing", ViewerText.searchURL(.bing, paragraph)),
            webAction("DuckDuckGo", ViewerText.searchURL(.duckduckgo, paragraph)),
            webAction(t("viewer.context.googleScholar"), ViewerText.scholarURL(paragraph)),
            webAction("Wikipedia", ViewerText.wikipediaURL(paragraph, locale: locale)),
            webAction(t("viewer.context.define"), ViewerText.defineURL(paragraph, locale: locale)),
            webAction(t("viewer.context.googleTranslate"), ViewerText.translateURL(paragraph, locale: locale)),
        ])
        var items: [UIMenuElement] = [
            UIAction(title: t("annotate.highlight"), image: UIImage(systemName: "highlighter")) { _ in ViewerModules.markup(.highlight, session: session) },
            markup,
            copyAs,
            UIAction(title: t("viewer.selection.translate"), image: UIImage(systemName: "translate")) { _ in
                session.translateText = paragraph
                session.trailingPanel = .translate
            },
            UIAction(title: t("viewer.selection.readAloud"), image: UIImage(systemName: "speaker.wave.2")) { _ in
                ViewerModules.speak(paragraph, session: session)
            },
        ]
        if UIReferenceLibraryViewController.dictionaryHasDefinition(forTerm: paragraph) {
            items.append(UIAction(title: t("viewer.context.define"), image: UIImage(systemName: "character.book.closed")) { [weak view] _ in
                guard let view, let presenter = view.window?.rootViewController.map(topmost) else { return }
                let controller = UIReferenceLibraryViewController(term: paragraph)
                presenter.present(controller, animated: true)
            })
        }
        items += [
            UIAction(title: t("viewer.context.searchInDocument"), image: UIImage(systemName: "magnifyingglass")) { _ in
                session.searchQuery = String(paragraph.prefix(120))
                session.leadingPanel = .search
                ViewerSearchController.of(session).run()
            },
            web,
            UIAction(title: t("viewer.context.addBookmark"), image: UIImage(systemName: "bookmark")) { _ in bookmarkPage.wrappedValue = pageIndex },
            UIAction(title: t("ios.common.share"), image: UIImage(systemName: "square.and.arrow.up")) { [weak view] _ in
                guard let view, let presenter = view.window?.rootViewController.map(topmost) else { return }
                let controller = UIActivityViewController(activityItems: [paragraph], applicationActivities: nil)
                controller.popoverPresentationController?.sourceView = view
                controller.popoverPresentationController?.sourceRect = view.convert(selection.bounds(for: selection.pages.first ?? PDFPage()), from: selection.pages.first ?? PDFPage())
                presenter.present(controller, animated: true)
            },
        ]
        return items
    }

    private static func webAction(_ title: String, _ url: URL?) -> UIAction {
        UIAction(title: title) { _ in if let url { UIApplication.shared.open(url) } }
    }

    private static func topmost(_ controller: UIViewController) -> UIViewController {
        if let presented = controller.presentedViewController { return topmost(presented) }
        return controller
    }
}
