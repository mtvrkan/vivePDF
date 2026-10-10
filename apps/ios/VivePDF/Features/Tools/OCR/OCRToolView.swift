import SwiftUI

// Placeholder until the module is ported.
struct OCRToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.ocr"))
            .navigationTitle(t("nav.ocr"))
    }
}
