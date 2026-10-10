import PDFKit
import SwiftUI
import UIKit

/// System share sheet for files produced on demand (attachments), where `ShareLink` would need the file up front.
struct DocumentActivitySheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// A URL wrapper so `.sheet(item:)` can present the share sheet for one file.
struct SharedFile: Identifiable {
    let id = UUID()
    let url: URL
}

/// Re-reads panel content whenever the document changes (edit, save, reload replaces the `PDFDocument`).
struct DocumentReloadKey: Hashable {
    let revision: Int
    let document: ObjectIdentifier

    @MainActor init(_ session: ViewerSession) {
        revision = session.revision
        document = ObjectIdentifier(session.pdf)
    }
}

/// Muted explanatory footnote under a panel list.
struct PanelFootnote: View {
    let text: String
    var symbol: String? = nil

    var body: some View {
        Label {
            Text(text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            if let symbol { Image(systemName: symbol) }
        }
        .labelStyle(PanelFootnoteLabelStyle(hasIcon: symbol != nil))
        .font(.footnote)
        .foregroundStyle(Palette.mutedForeground)
    }
}

private struct PanelFootnoteLabelStyle: LabelStyle {
    let hasIcon: Bool
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if hasIcon { configuration.icon }
            configuration.title
        }
    }
}

enum DocumentFormat {
    static func date(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(L10n.shared.locale.foundationLocale))
    }

    /// Desktop `formatPageSize`: "210 × 297 mm".
    static func pageSize(_ size: CGSize) -> String {
        let mm = 25.4 / 72
        return "\(Int((size.width * mm).rounded())) × \(Int((size.height * mm).rounded())) mm"
    }
}
