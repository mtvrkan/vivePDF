import SwiftUI

// Placeholder until the module is ported.
struct PDFAToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.pdfa"))
            .navigationTitle(t("nav.pdfa"))
    }
}
