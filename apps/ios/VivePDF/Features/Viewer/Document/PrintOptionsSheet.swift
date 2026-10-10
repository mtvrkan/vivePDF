import PDFKit
import SwiftUI
import UIKit

/// Print options before the system print panel (desktop `PrintDialog`). The printer, copies and paper are
/// picked in the AirPrint panel that follows; everything the desktop decides itself is set here.
struct PrintOptionsSheet: View {
    let session: ViewerSession
    @Environment(\.dismiss) private var dismiss
    @State private var options: PrintOptions
    @State private var printing = false

    init(session: ViewerSession, initialPage: Int?) {
        self.session = session
        var options = PrintOptions()
        options.currentPage = initialPage ?? session.currentPageIndex
        if initialPage != nil { options.pages = .current }
        _options = State(initialValue: options)
    }

    private var pageCount: Int { session.pageCount }
    private var selection: [Int]? { PrintJobEngine.pageIndices(options, pageCount: pageCount) }

    var body: some View {
        NavigationStack {
            Form {
                Section(t("viewer.printDialog.pages")) {
                    Picker(t("viewer.printDialog.pages"), selection: $options.pages) {
                        Text(t("viewer.printDialog.pagesAll", ["count": pageCount])).tag(PrintOptions.Pages.all)
                        Text(t("viewer.printDialog.pagesCurrent", ["page": session.label(ofPage: options.currentPage)])).tag(PrintOptions.Pages.current)
                        Text(t("viewer.printDialog.pagesRange")).tag(PrintOptions.Pages.range)
                    }
                    if options.pages == .range {
                        PageRangeField(text: $options.range, pageCount: pageCount, placeholder: t("viewer.printDialog.rangePlaceholder"))
                    }
                    Picker(t("viewer.printDialog.subset"), selection: $options.subset) {
                        Text(t("viewer.printDialog.subsetAll")).tag(PrintOptions.Subset.all)
                        Text(t("viewer.printDialog.subsetOdd")).tag(PrintOptions.Subset.odd)
                        Text(t("viewer.printDialog.subsetEven")).tag(PrintOptions.Subset.even)
                    }
                    Toggle(t("viewer.printDialog.reverse"), isOn: $options.reverse)
                }

                Section {
                    Picker(t("viewer.printDialog.pagesPerSheet"), selection: $options.pagesPerSheet) {
                        ForEach(PrintOptions.pagesPerSheetChoices, id: \.self) { Text("\($0)").tag($0) }
                    }
                    Picker(t("viewer.printDialog.scale"), selection: $options.scale) {
                        Text(t("viewer.printDialog.scaleFit")).tag(PrintOptions.Scale.fit)
                        Text(t("viewer.printDialog.scaleActual")).tag(PrintOptions.Scale.actual)
                    }
                    .disabled(options.pagesPerSheet > 1)
                    Toggle(t("viewer.printDialog.autoRotate"), isOn: $options.autoRotate)
                }

                Section {
                    Picker(t("viewer.printDialog.annotations"), selection: $options.includeAnnotations) {
                        Text(t("viewer.printDialog.annotationsInclude")).tag(true)
                        Text(t("viewer.printDialog.annotationsExclude")).tag(false)
                    }
                    Toggle(t("viewer.printDialog.grayscale"), isOn: $options.grayscale)
                    Picker(t("ios.viewer.document.duplex"), selection: $options.duplex) {
                        Text(t("ios.viewer.document.duplexNone")).tag(UIPrintInfo.Duplex.none)
                        Text(t("ios.viewer.document.duplexLong")).tag(UIPrintInfo.Duplex.longEdge)
                        Text(t("ios.viewer.document.duplexShort")).tag(UIPrintInfo.Duplex.shortEdge)
                    }
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        if let selection, selection.isEmpty {
                            Text(t("ios.viewer.document.noPagesToPrint")).foregroundStyle(Palette.destructive)
                        }
                        Text(t("ios.viewer.document.printHint"))
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            .navigationTitle(t("viewer.printDialog.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { startPrint() } label: {
                        if printing { ProgressView() } else { Text(t("viewer.printDialog.print")) }
                    }
                    .disabled(printing || (selection ?? []).isEmpty || !session.pdf.allowsPrinting)
                    .keyboardShortcut("p", modifiers: .command)
                }
            }
        }
        .presentationDetents([.large])
    }

    private func startPrint() {
        guard let pages = selection, !pages.isEmpty else { return }
        printing = true
        ViewerPrint.present(session: session, pages: pages, options: options) { completed in
            printing = false
            if completed { dismiss() }
        }
    }
}

/// Builds the print job and shows the system print panel.
@MainActor
enum ViewerPrint {
    /// "Print this page" and other one-step prints with default options.
    static func printDirectly(session: ViewerSession, pages: [Int]) {
        present(session: session, pages: pages, options: PrintOptions()) { _ in }
    }

    static func present(session: ViewerSession, pages: [Int], options: PrintOptions, completion: @escaping (Bool) -> Void) {
        // Print a copy: unsaved markup included, the view-only rotation left out, live edits unaffected.
        guard let data = session.withViewRotationRemoved({ session.pdf.dataRepresentation() }),
              let copy = PDFDocument(data: data) else {
            session.show(ViewerToast(text: t("errors.INTERNAL"), symbol: "exclamationmark.triangle.fill", isError: true))
            completion(false)
            return
        }
        if copy.isLocked, let password = session.document.password { copy.unlock(withPassword: password) }
        let controller = UIPrintInteractionController.shared
        controller.printInfo = PrintJobEngine.printInfo(options, jobName: session.document.fileName)
        controller.printPageRenderer = PDFPrintRenderer(document: copy, pages: pages, options: options)
        controller.showsNumberOfCopies = true
        controller.showsPaperOrientation = false
        let handler: UIPrintInteractionController.CompletionHandler = { _, completed, error in
            if let error {
                session.showError(error)
            } else if completed {
                session.show(ViewerToast(text: t("ios.viewer.document.printSent", ["count": pages.count]), symbol: "printer.fill"))
            }
            completion(completed)
        }
        guard let host = topController() else {
            controller.present(animated: true, completionHandler: handler)
            return
        }
        if host.traitCollection.horizontalSizeClass == .regular {
            let view = host.view!
            let anchor = CGRect(x: view.bounds.midX, y: view.safeAreaInsets.top + 8, width: 1, height: 1)
            controller.present(from: anchor, in: view, animated: true, completionHandler: handler)
        } else {
            controller.present(animated: true, completionHandler: handler)
        }
    }

    private static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? scenes.first?.windows.first
        var controller = window?.rootViewController
        while let presented = controller?.presentedViewController, !presented.isBeingDismissed { controller = presented }
        return controller
    }
}
