import PDFKit
import UIKit

/// "Highlight fields" (desktop `FieldHighlights`): tints every fillable form widget so it stands out.
/// Drawn in PDFKit page overlays (they follow zoom and scrolling); filling itself is PDFKit's own widget
/// interaction, and the values are written when the document is saved.
@MainActor
enum ViewerFieldHighlights {
    static func apply(_ on: Bool, session: ViewerSession) {
        guard let view = session.pdfView else { return }
        if on {
            let provider = Provider()
            session.service(ProviderBox.self) { ProviderBox() }.provider = provider
            view.pageOverlayViewProvider = provider
        } else if view.pageOverlayViewProvider is Provider {
            view.pageOverlayViewProvider = nil
        }
        // Overlays are created on layout; nudge PDFKit to rebuild them.
        view.layoutDocumentView()
        if let page = view.currentPage { view.go(to: page) }
    }

    /// Keeps the provider alive (PDFView holds it weakly).
    final class ProviderBox { var provider: Provider? }

    final class Provider: NSObject, PDFPageOverlayViewProvider {
        nonisolated func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
            MainActor.assumeIsolated {
                let widgets = page.annotations.filter { $0.type == "Widget" && !$0.isReadOnly && $0.widgetFieldType != .signature }
                guard !widgets.isEmpty else { return nil }
                let overlay = FieldOverlay(page: page, rects: widgets.map(\.bounds))
                overlay.isUserInteractionEnabled = false
                return overlay
            }
        }
    }

    private final class FieldOverlay: UIView {
        let pageBounds: CGRect
        let rects: [CGRect]

        init(page: PDFPage, rects: [CGRect]) {
            pageBounds = page.bounds(for: .cropBox)
            self.rects = rects
            super.init(frame: .zero)
            backgroundColor = .clear
            isOpaque = false
            contentMode = .redraw
        }

        required init?(coder: NSCoder) { nil }

        override func draw(_ rect: CGRect) {
            guard let context = UIGraphicsGetCurrentContext(), pageBounds.width > 0, pageBounds.height > 0 else { return }
            // The overlay spans the page; map PDF space (origin bottom-left) into it.
            let sx = bounds.width / pageBounds.width
            let sy = bounds.height / pageBounds.height
            context.setFillColor(UIColor.systemBlue.withAlphaComponent(0.16).cgColor)
            context.setStrokeColor(UIColor.systemBlue.withAlphaComponent(0.7).cgColor)
            context.setLineWidth(1)
            for field in rects {
                let box = CGRect(x: (field.minX - pageBounds.minX) * sx,
                                 y: (pageBounds.maxY - field.maxY) * sy,
                                 width: field.width * sx, height: field.height * sy)
                context.fill(box)
                context.stroke(box.insetBy(dx: 0.5, dy: 0.5))
            }
        }
    }
}
