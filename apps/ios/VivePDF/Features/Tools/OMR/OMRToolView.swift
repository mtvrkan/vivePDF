import SwiftUI

// Placeholder until the module is ported.
struct OMRToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.omr"))
            .navigationTitle(t("nav.omr"))
    }
}
