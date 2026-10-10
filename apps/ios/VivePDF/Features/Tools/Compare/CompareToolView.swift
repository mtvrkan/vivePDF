import SwiftUI

// Placeholder until the module is ported.
struct CompareToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.compare"))
            .navigationTitle(t("nav.compare"))
    }
}
