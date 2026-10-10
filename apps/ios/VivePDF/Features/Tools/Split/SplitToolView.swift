import SwiftUI

// Placeholder until the module is ported.
struct SplitToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.split"))
            .navigationTitle(t("nav.split"))
    }
}
