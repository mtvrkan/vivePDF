import SwiftUI

// Placeholder until the module is ported.
struct CompressToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.compress"))
            .navigationTitle(t("nav.compress"))
    }
}
