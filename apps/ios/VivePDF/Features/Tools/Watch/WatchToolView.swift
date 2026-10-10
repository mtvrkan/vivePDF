import SwiftUI

// Placeholder until the module is ported.
struct WatchToolView: View {
    var tab: String? = nil
    var body: some View {
        EmptyStateView(symbol: "hammer", title: t("nav.watch"))
            .navigationTitle(t("nav.watch"))
    }
}
